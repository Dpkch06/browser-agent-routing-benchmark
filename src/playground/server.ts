import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, extname, resolve, sep } from 'node:path';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  benchmarkReportSchema,
  type BenchmarkReport,
} from '../domain/schema.js';
import type { MatrixProgress } from '../runner/matrix.js';

const startRequestSchema = z.object({ confirmPaidRun: z.literal(true) }).strict();
const idempotencyKeySchema = z.uuid();
const reportFileNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);
const maximumRequestBytes = 1_024;
const defaultSampleReport = 'sample-report.json';

export type PlaygroundRunner = (args: {
  onCellComplete: (progress: MatrixProgress) => void;
}) => Promise<{ report: BenchmarkReport; filePath: string }>;

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; runId: string; startedAt: string; progress: MatrixProgress | null }
  | { kind: 'completed'; runId: string; startedAt: string; completedAt: string; reportFile: string }
  | { kind: 'failed'; runId: string; startedAt: string; completedAt: string; errorCode: 'benchmark_failed' };

type ReportSummary = {
  fileName: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  totalCells: number;
  succeededCells: number;
  kind: 'sample' | 'measured';
};

export type PlaygroundServer = {
  url: string;
  close: () => Promise<void>;
};

export async function createPlaygroundServer(args: {
  reportDirectory: string;
  runner: PlaygroundRunner;
  checkConfiguration: () => void;
  host?: string;
  port?: number;
  staticDirectory?: string;
  sampleReportFile?: string;
}): Promise<PlaygroundServer> {
  const host = args.host ?? '127.0.0.1';
  const port = args.port ?? 4173;
  if (host !== '127.0.0.1') throw new Error('The playground server must bind to 127.0.0.1.');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Invalid playground port.');

  const reportDirectory = resolve(args.reportDirectory);
  const staticDirectory = args.staticDirectory === undefined ? undefined : resolve(args.staticDirectory);
  const sampleReportFile = args.sampleReportFile ?? defaultSampleReport;
  let state: RunState = { kind: 'idle' };
  const submissionKeys = new Set<string>();
  const server = createServer((request, response) => {
    const address = server.address();
    const activePort = address && typeof address !== 'string' ? address.port : port;
    void routeRequest({
      request,
      response,
      host,
      port: activePort,
      reportDirectory,
      sampleReportFile,
      staticDirectory,
      runner: args.runner,
      checkConfiguration: args.checkConfiguration,
      getState: () => state,
      setState: (next) => { state = next; },
      submissionKeys,
    }).catch(() => sendJson(response, 500, { error: 'request_failed' }));
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('The local playground server failed to bind.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function routeRequest(args: {
  request: IncomingMessage;
  response: ServerResponse;
  host: string;
  port: number;
  reportDirectory: string;
  sampleReportFile: string;
  staticDirectory: string | undefined;
  runner: PlaygroundRunner;
  checkConfiguration: () => void;
  getState: () => RunState;
  setState: (state: RunState) => void;
  submissionKeys: Set<string>;
}): Promise<void> {
  const { request, response } = args;
  if (!isLoopbackRequest(request) || !isExpectedHost(request.headers.host, args.host, args.port)) {
    sendJson(response, 403, { error: 'local_access_only' });
    return;
  }
  if (!isAllowedOrigin(request.headers.origin, args.host, args.port)) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return;
  }

  let path: string;
  try {
    path = new URL(request.url ?? '/', `http://${args.host}:${args.port}`).pathname;
  } catch {
    sendJson(response, 400, { error: 'invalid_request' });
    return;
  }

  if (request.method === 'GET' && path === '/api/status') {
    sendJson(response, 200, { state: args.getState() });
    return;
  }
  if (request.method === 'POST' && path === '/api/runs') {
    await startRun(args);
    return;
  }
  if (request.method === 'GET' && path === '/api/reports') {
    const reports = await listReports(args.reportDirectory, args.sampleReportFile);
    sendJson(response, 200, { reports });
    return;
  }
  const reportMatch = /^\/api\/reports\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && reportMatch) {
    await getReport({
      fileName: decodeURIComponent(reportMatch[1] ?? ''),
      reportDirectory: args.reportDirectory,
      sampleReportFile: args.sampleReportFile,
      response,
    });
    return;
  }
  if (request.method === 'GET' && args.staticDirectory) {
    await serveStatic({ path, directory: args.staticDirectory, response });
    return;
  }
  sendJson(response, 404, { error: 'not_found' });
}

async function startRun(args: {
  request: IncomingMessage;
  response: ServerResponse;
  runner: PlaygroundRunner;
  checkConfiguration: () => void;
  getState: () => RunState;
  setState: (state: RunState) => void;
  submissionKeys: Set<string>;
}): Promise<void> {
  if (args.request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    sendJson(args.response, 415, { error: 'application_json_required' });
    return;
  }

  const body = await readJsonBody(args.request);
  if (!body.success) {
    sendJson(args.response, body.error === 'too_large' ? 413 : 400, { error: body.error });
    return;
  }
  if (!startRequestSchema.safeParse(body.value).success) {
    sendJson(args.response, 400, { error: 'confirmation_required' });
    return;
  }

  const keyResult = idempotencyKeySchema.safeParse(args.request.headers['idempotency-key']);
  if (!keyResult.success) {
    sendJson(args.response, 400, { error: 'idempotency_key_required' });
    return;
  }
  const key = keyResult.data;
  if (args.submissionKeys.has(key)) {
    sendJson(args.response, 409, { error: 'duplicate_submission' });
    return;
  }
  if (args.getState().kind === 'running') {
    sendJson(args.response, 409, { error: 'run_in_progress' });
    return;
  }

  try {
    args.checkConfiguration();
  } catch {
    args.submissionKeys.add(key);
    sendJson(args.response, 503, {
      error: 'provider_configuration_missing',
      requiredSettings: ['TYPESAFE_API_KEY', 'REASONING_API_ENDPOINT', 'REASONING_API_KEY', 'REASONING_MODEL'],
    });
    return;
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  args.submissionKeys.add(key);
  args.setState({ kind: 'running', runId, startedAt, progress: null });
  sendJson(args.response, 202, { runId, state: args.getState() });

  void Promise.resolve().then(() => args.runner({
    onCellComplete: (progress) => {
      const currentState = args.getState();
      if (currentState.kind === 'running' && currentState.runId === runId) {
        args.setState({ kind: 'running', runId, startedAt, progress });
      }
    },
  })).then(({ filePath }) => {
    const reportFile = basename(filePath);
    if (!reportFileNameSchema.safeParse(reportFile).success) throw new Error('Invalid report output path.');
    args.setState({
      kind: 'completed',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      reportFile,
    });
  }).catch(() => {
    args.setState({
      kind: 'failed',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      errorCode: 'benchmark_failed',
    });
  });
}

async function listReports(directory: string, sampleReportFile: string): Promise<ReportSummary[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }

  const reports = await Promise.all(names
    .filter((name) => name.endsWith('.json') && reportFileNameSchema.safeParse(name).success)
    .map(async (fileName) => {
      const report = await readReport(directory, fileName);
      if (!report) return undefined;
      const succeededCells = report.results.filter((result) => result.outcome.status === 'succeeded').length;
      return {
        fileName,
        runId: report.runId,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        totalCells: report.results.length,
        succeededCells,
        kind: fileName === sampleReportFile ? 'sample' as const : 'measured' as const,
      };
    }));
  return reports.filter((report): report is ReportSummary => report !== undefined)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

async function getReport(args: {
  fileName: string;
  reportDirectory: string;
  sampleReportFile: string;
  response: ServerResponse;
}): Promise<void> {
  if (!reportFileNameSchema.safeParse(args.fileName).success || basename(args.fileName) !== args.fileName) {
    sendJson(args.response, 404, { error: 'report_not_found' });
    return;
  }
  const report = await readReport(args.reportDirectory, args.fileName);
  if (!report) {
    sendJson(args.response, 404, { error: 'report_not_found' });
    return;
  }
  sendJson(args.response, 200, {
    kind: args.fileName === args.sampleReportFile ? 'sample' : 'measured',
    report,
  });
}

async function readReport(directory: string, fileName: string): Promise<BenchmarkReport | undefined> {
  try {
    const [realDirectory, realFile] = await Promise.all([
      realpath(directory),
      realpath(resolve(directory, fileName)),
    ]);
    if (realFile !== realDirectory && !realFile.startsWith(realDirectory + sep)) return undefined;
    const bytes = await readFile(realFile, 'utf8');
    const parsed: unknown = JSON.parse(bytes);
    const result = benchmarkReportSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

async function serveStatic(args: {
  path: string;
  directory: string;
  response: ServerResponse;
}): Promise<void> {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(args.path === '/' ? '/index.html' : args.path).replace(/^[/\\]+/, '');
  } catch {
    sendJson(args.response, 400, { error: 'invalid_request' });
    return;
  }
  const filePath = resolve(args.directory, relativePath);
  const directoryPath = resolve(args.directory);
  if (filePath !== directoryPath && !filePath.startsWith(directoryPath + sep)) {
    sendJson(args.response, 404, { error: 'not_found' });
    return;
  }
  try {
    const [realDirectory, realFile] = await Promise.all([realpath(directoryPath), realpath(filePath)]);
    if (realFile !== realDirectory && !realFile.startsWith(realDirectory + sep)) {
      sendJson(args.response, 404, { error: 'not_found' });
      return;
    }
    const content = await readFile(realFile);
    const contentType = staticContentType(extname(realFile));
    args.response.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    args.response.end(content);
  } catch {
    sendJson(args.response, 404, { error: 'not_found' });
  }
}

function staticContentType(extension: string): string {
  switch (extension) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function readJsonBody(request: IncomingMessage): Promise<
  | { success: true; value: unknown }
  | { success: false; error: 'invalid_json' | 'too_large' }
> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maximumRequestBytes && !finished) {
        finished = true;
        resolveBody({ success: false, error: 'too_large' });
      } else if (!finished) {
        chunks.push(bytes);
      }
    });
    request.on('end', () => {
      if (finished) return;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        finished = true;
        resolveBody({ success: true, value });
      } catch {
        finished = true;
        resolveBody({ success: false, error: 'invalid_json' });
      }
    });
    request.on('error', () => {
      if (finished) return;
      finished = true;
      resolveBody({ success: false, error: 'invalid_json' });
    });
  });
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function isExpectedHost(hostHeader: string | undefined, host: string, port: number): boolean {
  if (!hostHeader) return false;
  try {
    const parsed = new URL('http://' + hostHeader);
    return parsed.hostname === host && parsed.port === String(port);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string | undefined, host: string, port: number): boolean {
  return origin === undefined || origin === `http://${host}:${port}`;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}
