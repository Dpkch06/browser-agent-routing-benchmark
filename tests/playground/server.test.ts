import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchmarkReportSchema, directStrategyIds, routerIds, taskIds, type BenchmarkReport } from '../../src/domain/schema.js';
import { createPlaygroundServer, type PlaygroundRunner } from '../../src/playground/server.js';
import type { MatrixProgress, MatrixCellCompletion } from '../../src/runner/matrix.js';

const servers: Array<{ close: () => Promise<void> }> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('playground server', () => {
  it('reports safe missing settings and an empty list when provider configuration is ready', async () => {
    const missingSettings = ['TYPESAFE_API_KEY', 'REASONING_API_KEY'];
    const missing = await createServer({ getRequiredSettings: () => missingSettings });
    const missingResponse = await fetch(missing.url + '/api/status');
    expect(await missingResponse.json()).toEqual({ state: { kind: 'idle' }, requiredSettings: missingSettings });

    const ready = await createServer({ getRequiredSettings: () => [] });
    const readyResponse = await fetch(ready.url + '/api/status');
    expect(await readyResponse.json()).toEqual({ state: { kind: 'idle' }, requiredSettings: [] });
  });

  it('requires an explicit paid-run confirmation and does not invoke the runner without it', async () => {
    let runCount = 0;
    const server = await createServer({
      runner: async () => {
        runCount += 1;
        return { report: reportFixture(), filePath: 'unused.json' };
      },
    });

    const response = await fetch(server.url + '/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000001' },
      body: JSON.stringify({ confirmPaidRun: false }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'confirmation_required' });
    expect(runCount).toBe(0);
  });

  it('rejects duplicate submissions and concurrent matrix runs', async () => {
    let resolveRun: ((value: { report: BenchmarkReport; filePath: string }) => void) | undefined;
    let runCount = 0;
    const pending = new Promise<{ report: BenchmarkReport; filePath: string }>((resolve) => {
      resolveRun = resolve;
    });
    const server = await createServer({
      runner: async () => {
        runCount += 1;
        return pending;
      },
    });

    const first = await submitRun(server.url, '00000000-0000-4000-8000-000000000002');
    expect(first.status).toBe(202);
    const repeated = await submitRun(server.url, '00000000-0000-4000-8000-000000000002');
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: 'duplicate_submission' });
    const concurrent = await submitRun(server.url, '00000000-0000-4000-8000-000000000003');
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toEqual({ error: 'run_in_progress' });
    expect(runCount).toBe(1);

    resolveRun?.({ report: reportFixture(), filePath: 'unused.json' });
  });

  it('returns cell progress while a run is active and a summary after it finishes', async () => {
    let resolveRun: ((value: { report: BenchmarkReport; filePath: string }) => void) | undefined;
    const pending = new Promise<{ report: BenchmarkReport; filePath: string }>((resolve) => {
      resolveRun = resolve;
    });
    const server = await createServer({
      runner: async ({ onCellStart, onCellComplete }) => {
        const firstStart: MatrixProgress = {
          index: 1,
          total: 12,
          taskId: 'todomvc-add-complete',
          execution: { kind: 'direct', strategyId: 'deterministic-playwright' },
        };
        const firstCompletion: MatrixCellCompletion = {
          taskId: 'todomvc-add-complete',
          execution: { kind: 'direct', strategyId: 'deterministic-playwright' },
          outcome: { status: 'succeeded', verification: 'passed' },
          durationMs: 321,
        };
        await onCellStart(firstStart);
        await onCellComplete(firstCompletion);
        await onCellStart({
          index: 2,
          total: 12,
          taskId: 'todomvc-add-complete',
          execution: { kind: 'direct', strategyId: 'jev-guided-playwright' },
        });
        return pending;
      },
    });

    const submitted = await submitRun(server.url, '00000000-0000-4000-8000-000000000004');
    const { runId } = await submitted.json() as { runId: string };
    await waitFor(async () => {
      const response = await fetch(server.url + '/api/status');
      const body = await response.json();
      return body.state?.progress?.index === 2;
    });

    const active = await fetch(server.url + '/api/status');
    const activeBody = await active.json();
    expect(activeBody.state).toMatchObject({
      kind: 'running',
      runId,
      progress: { index: 2, total: 12, execution: { kind: 'direct', strategyId: 'jev-guided-playwright' } },
      completedCells: [{
        taskId: 'todomvc-add-complete',
        execution: { kind: 'direct', strategyId: 'deterministic-playwright' },
        outcome: { status: 'succeeded', verification: 'passed' },
        durationMs: 321,
      }],
    });
    expect(JSON.stringify(activeBody)).not.toContain('task inputs');

    resolveRun?.({ report: reportFixture(), filePath: 'run.json' });
    await waitFor(async () => {
      const response = await fetch(server.url + '/api/status');
      const body = await response.json();
      return body.state?.kind === 'completed';
    });
    const completed = await fetch(server.url + '/api/status');
    expect(await completed.json()).toMatchObject({ state: { kind: 'completed', runId, reportFile: 'run.json' } });
  });

  it('lists and loads only schema-valid reports, marking the sample synthetic', async () => {
    const reportDirectory = await mkdtemp(join(tmpdir(), 'playground-reports-'));
    directories.push(reportDirectory);
    await writeFile(join(reportDirectory, 'sample-report.json'), JSON.stringify(reportFixture()), 'utf8');
    await writeFile(join(reportDirectory, 'run.json'), JSON.stringify(reportFixture()), 'utf8');
    await writeFile(join(reportDirectory, 'untrusted.json'), JSON.stringify({ secret: 'must not appear' }), 'utf8');
    const server = await createServer({ reportDirectory });

    const listing = await fetch(server.url + '/api/reports');
    const listed = await listing.json();
    expect(listed.reports).toHaveLength(2);
    expect(listed.reports).toContainEqual(expect.objectContaining({ fileName: 'sample-report.json', kind: 'sample' }));
    expect(listed.reports).toContainEqual(expect.objectContaining({ fileName: 'run.json', kind: 'measured' }));

    const sample = await fetch(server.url + '/api/reports/sample-report.json');
    expect(await sample.json()).toMatchObject({ kind: 'sample', report: { schemaVersion: 1 } });
    const traversal = await fetch(server.url + '/api/reports/%2e%2e%2fpackage.json');
    expect(traversal.status).toBe(404);
  });

  it('does not expose provider validation details or start the browser runner when config is missing', async () => {
    let runnerCalled = false;
    const server = await createServer({
      checkConfiguration: () => { throw new Error('key=secret-value'); },
      runner: async () => {
        runnerCalled = true;
        return { report: reportFixture(), filePath: 'unused.json' };
      },
    });

    const response = await submitRun(server.url, '00000000-0000-4000-8000-000000000005');
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('provider_configuration_missing');
    expect(body).not.toContain('secret-value');
    expect(runnerCalled).toBe(false);
  });

  it('rejects a run when status reports missing settings, even if the runner is available', async () => {
    let runnerCalled = false;
    const server = await createServer({
      getRequiredSettings: () => ['TYPESAFE_API_KEY'],
      runner: async () => {
        runnerCalled = true;
        return { report: reportFixture(), filePath: 'unused.json' };
      },
    });

    const response = await submitRun(server.url, '00000000-0000-4000-8000-000000000006');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'provider_configuration_missing',
      requiredSettings: ['TYPESAFE_API_KEY'],
    });
    expect(runnerCalled).toBe(false);
  });
});

async function createServer(overrides: {
  reportDirectory?: string;
  runner?: PlaygroundRunner;
  checkConfiguration?: () => void;
  getRequiredSettings?: () => string[];
} = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const reportDirectory = overrides.reportDirectory ?? await mkdtemp(join(tmpdir(), 'playground-reports-'));
  if (!overrides.reportDirectory) directories.push(reportDirectory);
  const server = await createPlaygroundServer({
    host: '127.0.0.1',
    port: 0,
    reportDirectory,
    runner: overrides.runner ?? (async () => ({ report: reportFixture(), filePath: 'unused.json' })),
    checkConfiguration: overrides.checkConfiguration ?? (() => undefined),
    getRequiredSettings: overrides.getRequiredSettings ?? (() => []),
  });
  servers.push(server);
  return server;
}

async function submitRun(url: string, key: string): Promise<Response> {
  return fetch(url + '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ confirmPaidRun: true }),
  });
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for server state.');
}

function reportFixture(): BenchmarkReport {
  const results = taskIds.flatMap((taskId) => [
    ...directStrategyIds.map((strategyId) => ({
      taskId,
      execution: { kind: 'direct' as const, strategyId },
      outcome: { status: 'succeeded' as const, verification: 'passed' as const },
      durationMs: 1,
      usage: { modelCalls: 0 },
    })),
    ...routerIds.map((routerId) => ({
      taskId,
      execution: {
        kind: 'router' as const,
        routerId,
        route: { status: 'selected' as const, strategyId: 'deterministic-playwright' as const, durationMs: 0 },
      },
      outcome: { status: 'succeeded' as const, verification: 'passed' as const },
      durationMs: 1,
      usage: { modelCalls: 0 },
    })),
  ]);
  return benchmarkReportSchema.parse({
    schemaVersion: 1,
    runId: '00000000-0000-4000-8000-000000000010',
    startedAt: '2026-11-08T00:00:00.000Z',
    completedAt: '2026-11-08T00:00:01.000Z',
    environment: { nodeVersion: 'v24.0.0', playwrightVersion: 'test', browser: 'chromium', browserVersion: 'test' },
    results,
  });
}
