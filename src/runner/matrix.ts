import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Page } from 'playwright';
import {
  benchmarkReportSchema,
  directStrategyIds,
  routerIds,
  type BenchmarkReport,
  type BenchmarkResult,
  type DirectStrategyId,
  type Execution,
  type ModelMetadata,
  type RouterId,
  type TaskId,
} from '../domain/schema.js';
import {
  practiceTasks,
  type PracticeTask,
  type TaskVerification,
} from '../tasks/registry.js';
import { StrategyExecutionError, type StrategySuite } from '../strategies/index.js';
import type { ProviderUsage } from '../strategies/providers.js';
import { saveBenchmarkReport } from './report-writer.js';

export type BrowserEnvironment = {
  nodeVersion: string;
  playwrightVersion: string;
  browser: 'chromium';
  browserVersion: string;
};

export type BrowserSession = {
  page: Page;
  navigate: (url: string) => Promise<void>;
  close: () => Promise<void>;
};

export type BrowserFactory = {
  createSession: () => Promise<BrowserSession>;
  getEnvironment: () => Promise<BrowserEnvironment>;
};

export type MatrixApproach =
  | { kind: 'direct'; strategyId: DirectStrategyId }
  | { kind: 'router'; routerId: RouterId };

export type MatrixProgress = {
  index: number;
  total: number;
  taskId: TaskId;
  execution: MatrixApproach;
};

export type MatrixCellCompletion = {
  taskId: TaskId;
  execution: Execution;
  outcome: BenchmarkResult['outcome'];
  durationMs: number;
};

type CellOutput = {
  execution: Execution;
  outcome: BenchmarkResult['outcome'];
  usage: ProviderUsage;
  models: ModelMetadata[];
  durationMs: number;
};

const zeroUsage: ProviderUsage = { modelCalls: 0 };

export async function runMatrix(args: {
  browserFactory: BrowserFactory;
  tasks?: readonly PracticeTask[];
  suite: StrategySuite;
  reportDir: string;
  onCellStart?: (progress: MatrixProgress) => void | Promise<void>;
  onCellComplete?: (cell: MatrixCellCompletion) => void | Promise<void>;
}): Promise<{ report: BenchmarkReport; filePath: string }> {
  const tasks = args.tasks ?? practiceTasks;
  const startedAt = new Date();
  const results: BenchmarkResult[] = [];
  const totalCells = tasks.length * (directStrategyIds.length + routerIds.length);

  const executeCell = async (task: PracticeTask, approach: MatrixApproach): Promise<void> => {
    await args.onCellStart?.({
      index: results.length + 1,
      total: totalCells,
      taskId: task.definition.id,
      execution: approach,
    });
    const result = await runCell({
      browserFactory: args.browserFactory,
      suite: args.suite,
      task,
      approach,
    });
    results.push(result);
    await args.onCellComplete?.({
      taskId: result.taskId,
      execution: result.execution,
      outcome: result.outcome,
      durationMs: result.durationMs,
    });
  };

  for (const task of tasks) {
    for (const strategyId of directStrategyIds) {
      await executeCell(task, { kind: 'direct', strategyId });
    }

    for (const routerId of routerIds) {
      await executeCell(task, { kind: 'router', routerId });
    }
  }

  const environment = await args.browserFactory.getEnvironment();
  const report = benchmarkReportSchema.parse({
    schemaVersion: 1,
    runId: randomUUID(),
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    environment,
    results,
  });
  const filePath = await saveBenchmarkReport({
    report,
    outputDirectory: args.reportDir,
  });

  return { report, filePath };
}

async function runCell(args: {
  browserFactory: BrowserFactory;
  suite: StrategySuite;
  task: PracticeTask;
  approach: MatrixApproach;
}): Promise<BenchmarkResult> {
  const startedAt = performance.now();
  const usageParts: ProviderUsage[] = [];
  const models: ModelMetadata[] = [];
  let execution: Execution = args.approach.kind === 'direct'
    ? { kind: 'direct', strategyId: args.approach.strategyId }
    : {
      kind: 'router',
      routerId: args.approach.routerId,
      route: { status: 'failed', failureCode: 'route_not_run', durationMs: 0 },
    };
  let outcome: BenchmarkResult['outcome'] = {
    status: 'failed',
    phase: 'setup',
    failureCode: 'browser_setup_failed',
  };
  let session: BrowserSession | undefined;
  let selectedStrategyId: DirectStrategyId | undefined;
  let setupFailed = false;
  let routeFailed = false;
  let actionFailed = false;
  let actionFailureCode = 'strategy_execution_failed';
  let setupFailureCode = 'browser_setup_failed';
  let verificationOutcome: BenchmarkResult['outcome'] | undefined;

  try {
    session = await args.browserFactory.createSession();
  } catch {
    setupFailed = true;
  }

  if (session) {
    try {
      await session.navigate(args.task.startUrl);
    } catch (error: unknown) {
      setupFailed = true;
      setupFailureCode = isTimeoutError(error) ? 'navigation_timeout' : 'navigation_failed';
    }
  }

  if (args.approach.kind === 'direct') {
    selectedStrategyId = args.approach.strategyId;
  } else {
    const routeStartedAt = performance.now();
    try {
      const selection = await args.suite.routers[args.approach.routerId].route(args.task.definition);
      execution = {
        kind: 'router',
        routerId: args.approach.routerId,
        route: {
          status: 'selected',
          strategyId: selection.strategyId,
          durationMs: selection.durationMs,
        },
      };
      selectedStrategyId = selection.strategyId;
      usageParts.push(selection.usage);
      models.push(...selection.models);
    } catch (error: unknown) {
      if (error instanceof StrategyExecutionError && error.phase === 'route') {
        usageParts.push(error.usage);
        models.push(...error.models);
      }
      routeFailed = true;
      execution = {
        kind: 'router',
        routerId: args.approach.routerId,
        route: {
          status: 'failed',
          failureCode: error instanceof StrategyExecutionError && error.phase === 'route'
            ? error.failureCode
            : 'router_failed',
          durationMs: elapsed(routeStartedAt),
        },
      };
      outcome = {
        status: 'failed',
        phase: 'route',
        failureCode: error instanceof StrategyExecutionError && error.phase === 'route'
          ? error.failureCode
          : 'router_failed',
      };
    }
  }

  if (!routeFailed && !setupFailed && session && selectedStrategyId) {
    try {
      const run = await args.suite.direct[selectedStrategyId].run({
        page: session.page,
        task: args.task.definition,
      });
      usageParts.push(run.usage);
      models.push(...run.models);
    } catch (error: unknown) {
      actionFailed = true;
      if (error instanceof StrategyExecutionError && error.phase === 'action') {
        usageParts.push(error.usage);
        models.push(...error.models);
        actionFailureCode = error.failureCode;
      } else if (isTimeoutError(error)) {
        actionFailureCode = 'action_timeout';
      }
    }
  }

  if (session) {
    try {
      verificationOutcome = mapVerification(await args.task.verify(session.page));
    } catch (error: unknown) {
      verificationOutcome = {
        status: 'failed',
        phase: 'verification',
        failureCode: isTimeoutError(error) ? 'verification_timeout' : 'verifier_failed',
      };
    }
  }

  if (!routeFailed && setupFailed) {
    outcome = { status: 'failed', phase: 'setup', failureCode: setupFailureCode };
  } else if (!routeFailed && actionFailed) {
    outcome = verificationOutcome?.status === 'succeeded'
      ? verificationOutcome
      : {
        status: 'failed',
        phase: 'action',
        failureCode: actionFailureCode,
      };
  } else if (!routeFailed && verificationOutcome) {
    outcome = verificationOutcome;
  }

  try {
    await session?.close();
  } catch {
    // Cleanup errors do not replace the task outcome.
  }

  return benchmarkReportSchema.shape.results.element.parse({
    taskId: args.task.definition.id,
    execution,
    outcome,
    durationMs: elapsed(startedAt),
    usage: combineUsage(usageParts),
    ...(models.length === 0 ? {} : { models: uniqueModels(models) }),
  });
}

function mapVerification(verification: TaskVerification): BenchmarkResult['outcome'] {
  switch (verification.status) {
    case 'passed':
      return { status: 'succeeded', verification: 'passed' };
    case 'failed':
      return { status: 'failed', phase: 'verification', failureCode: verification.failureCode };
    case 'unverifiable':
      return { status: 'failed', phase: 'setup', failureCode: verification.failureCode };
    default: {
      const exhaustive: never = verification;
      throw new Error('Unsupported verification outcome: ' + JSON.stringify(exhaustive));
    }
  }
}

function combineUsage(entries: ProviderUsage[]): ProviderUsage {
  const modelCalls = entries.reduce((total, usage) => total + usage.modelCalls, 0);
  const inputTokens = sumMetric(entries, 'inputTokens');
  const outputTokens = sumMetric(entries, 'outputTokens');
  const costUsd = sumMetric(entries, 'costUsd');
  const usagePartial = entries.some((usage) => usage.usagePartial === true);
  return {
    modelCalls,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(usagePartial ? { usagePartial: true } : {}),
  };
}

function sumMetric(
  entries: ProviderUsage[],
  key: 'inputTokens' | 'outputTokens' | 'costUsd',
): number | undefined {
  const values = entries.map((entry) => entry[key]);
  if (!values.some((value) => value !== undefined)) return undefined;
  if (entries.some((entry) => (
    entry.modelCalls > 0
    && entry[key] === undefined
    && entry.usagePartial !== true
  ))) return undefined;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function uniqueModels(models: ModelMetadata[]): ModelMetadata[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = JSON.stringify(model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}
