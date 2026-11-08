import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  directStrategyIds,
  routerIds,
  type DirectStrategyId,
  type ModelMetadata,
  type RouterId,
} from '../../src/domain/schema.js';
import { practiceTasks, type PracticeTask, type TaskVerification } from '../../src/tasks/registry.js';
import type { StrategySuite } from '../../src/strategies/index.js';
import type { DirectStrategy, DirectStrategyRun } from '../../src/strategies/direct.js';
import type { RouterSelection, StrategyRouter } from '../../src/strategies/routers.js';
import { runMatrix, type BrowserFactory, type MatrixProgress } from '../../src/runner/matrix.js';

let browser: Browser | undefined;
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function testTasks(): PracticeTask[] {
  return practiceTasks.map((task) => ({
    ...task,
    startUrl: 'https://fixture.invalid/' + task.definition.id,
    verify: async (page): Promise<TaskVerification> => {
      const completed = await page.locator('body').getAttribute('data-complete');
      return completed === 'true'
        ? { status: 'passed' }
        : { status: 'failed', failureCode: 'todo_item_missing' };
    },
  }));
}

function testBrowserFactory(testBrowser: Browser): {
  factory: BrowserFactory;
  createdSessions: () => number;
} {
  let count = 0;
  return {
    factory: {
      createSession: async () => {
        count += 1;
        const context = await testBrowser.newContext();
        const page = await context.newPage();
        return {
          page,
          navigate: async () => {
            await page.setContent('<!doctype html><html><body data-complete="false"></body></html>');
          },
          close: async () => context.close(),
        };
      },
      getEnvironment: async () => ({
        nodeVersion: process.version,
        playwrightVersion: 'test-version',
        browser: 'chromium',
        browserVersion: testBrowser.version(),
      }),
    },
    createdSessions: () => count,
  };
}

function fakeSuite(args: { failStrategy?: string; failRouter?: string } = {}): StrategySuite {
  const modelMetadata: Record<DirectStrategyId, ModelMetadata> = {
    'deterministic-playwright': {
      stage: 'executor', provider: 'local', modelId: 'deterministic', version: '1',
    },
    'jev-guided-playwright': {
      stage: 'executor', provider: 'TypeSafe', modelId: 'jev', version: 'jev-test',
    },
    'reasoning-model-playwright': {
      stage: 'executor', provider: 'fake', modelId: 'reasoning-test', version: '1',
    },
  };

  function directStrategy(strategyId: DirectStrategyId): DirectStrategy {
    return {
      id: strategyId,
      run: async ({ page, task }): Promise<DirectStrategyRun> => {
        if (args.failStrategy === task.id + ':' + strategyId) {
          throw new Error('Fixture strategy failure.');
        }
        await page.locator('body').evaluate((body) => {
          body.setAttribute('data-complete', 'true');
        });
        switch (strategyId) {
          case 'deterministic-playwright':
            return { actions: 1, usage: { modelCalls: 0 }, models: [] };
          case 'jev-guided-playwright':
            return {
              actions: 2,
              usage: { modelCalls: 2, inputTokens: 20, outputTokens: 8, costUsd: 0.0002 },
              models: [modelMetadata[strategyId]],
            };
          case 'reasoning-model-playwright':
            return {
              actions: 1,
              usage: { modelCalls: 1, inputTokens: 12, outputTokens: 4, costUsd: 0.0003 },
              models: [modelMetadata[strategyId]],
            };
          default: {
            const exhaustive: never = strategyId;
            throw new Error('Unexpected test strategy: ' + exhaustive);
          }
        }
      },
    };
  }

  const direct: Record<DirectStrategyId, DirectStrategy> = {
    'deterministic-playwright': directStrategy('deterministic-playwright'),
    'jev-guided-playwright': directStrategy('jev-guided-playwright'),
    'reasoning-model-playwright': directStrategy('reasoning-model-playwright'),
  };

  const routerModel: Record<RouterId, ModelMetadata> = {
    'rule-based-router': {
      stage: 'router', provider: 'local', modelId: 'rules', version: '1',
    },
    'jev-router': {
      stage: 'router', provider: 'TypeSafe', modelId: 'jev', version: 'jev-test',
    },
    'reasoning-model-router': {
      stage: 'router', provider: 'fake', modelId: 'reasoning-test', version: '1',
    },
  };
  const routerStrategy: Record<RouterId, DirectStrategyId> = {
    'rule-based-router': 'deterministic-playwright',
    'jev-router': 'reasoning-model-playwright',
    'reasoning-model-router': 'jev-guided-playwright',
  };

  function router(routerId: RouterId): StrategyRouter {
    return {
      id: routerId,
      route: async (task): Promise<RouterSelection> => {
        if (args.failRouter === task.id + ':' + routerId) {
          throw new Error('Fixture router failure.');
        }
        const hasModel = routerId !== 'rule-based-router';
        const usage = routerId === 'jev-router'
          ? { modelCalls: 1, inputTokens: 5, outputTokens: 2 }
          : routerId === 'reasoning-model-router'
            ? { modelCalls: 1, inputTokens: 7, outputTokens: 3, costUsd: 0.0001 }
            : { modelCalls: 0 };
        return {
          strategyId: routerStrategy[routerId],
          durationMs: 3,
          usage,
          models: hasModel ? [routerModel[routerId]] : [],
        };
      },
    };
  }

  const routers: Record<RouterId, StrategyRouter> = {
    'rule-based-router': router('rule-based-router'),
    'jev-router': router('jev-router'),
    'reasoning-model-router': router('reasoning-model-router'),
  };

  return { direct, routers };
}

async function createReportDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'browser-agent-routing-'));
  temporaryDirectories.push(directory);
  return directory;
}

function strategyKey(result: Awaited<ReturnType<typeof runMatrix>>['report']['results'][number]): string {
  switch (result.execution.kind) {
    case 'direct':
      return result.execution.strategyId;
    case 'router':
      return result.execution.routerId;
    default: {
      const exhaustive: never = result.execution;
      throw new Error('Unexpected test execution: ' + exhaustive);
    }
  }
}

describe('runMatrix', () => {
  it('runs all twelve cells in stable order with a fresh session and writes a schema-valid report', async () => {
    if (!browser) throw new Error('Test browser did not start.');
    const browserFactory = testBrowserFactory(browser);
    const reportDir = await createReportDirectory();
    const progress: MatrixProgress[] = [];
    const { report, filePath } = await runMatrix({
      browserFactory: browserFactory.factory,
      tasks: testTasks(),
      suite: fakeSuite(),
      reportDir,
      onCellComplete: (cell) => { progress.push(cell); },
    });

    expect(report.results).toHaveLength(12);
    expect(browserFactory.createdSessions()).toBe(12);
    expect(progress.map(({ index }) => index)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(progress.every(({ total }) => total === 12)).toBe(true);
    expect(progress.map(({ taskId, execution }) => ({ taskId, execution }))).toEqual(
      report.results.map(({ taskId, execution }) => ({ taskId, execution })),
    );
    expect(report.results.slice(0, 6).map(strategyKey)).toEqual([
      'deterministic-playwright',
      'jev-guided-playwright',
      'reasoning-model-playwright',
      'rule-based-router',
      'jev-router',
      'reasoning-model-router',
    ]);
    expect(report.results.every((result) => result.outcome.status === 'succeeded')).toBe(true);

    const jevRouted = report.results.find((result) =>
      result.taskId === 'todomvc-add-complete'
      && result.execution.kind === 'router'
      && result.execution.routerId === 'jev-router'
    );
    expect(jevRouted?.execution.kind).toBe('router');
    if (!jevRouted || jevRouted.execution.kind !== 'router') {
      throw new Error('Expected a Jev-routed result.');
    }
    expect(jevRouted.execution.route).toMatchObject({
      status: 'selected',
      strategyId: 'reasoning-model-playwright',
    });
    expect(jevRouted.usage).toEqual({
      modelCalls: 2,
      inputTokens: 17,
      outputTokens: 6,
    });
    expect(jevRouted.models?.map((model) => model.stage)).toEqual(['router', 'executor']);

    const saved = await readFile(filePath, 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ schemaVersion: 1, results: expect.any(Array) });
    for (const task of practiceTasks) {
      for (const value of Object.values(task.definition.inputs)) {
        expect(saved).not.toContain(value);
      }
    }
  });

  it('records router and strategy failures while continuing the matrix and verifying each loaded cell', async () => {
    if (!browser) throw new Error('Test browser did not start.');
    let verifications = 0;
    const tasks = testTasks().map((task) => ({
      ...task,
      verify: async (page: Page): Promise<TaskVerification> => {
        verifications += 1;
        const completed = await page.locator('body').getAttribute('data-complete');
        return completed === 'true'
          ? { status: 'passed' }
          : { status: 'failed', failureCode: 'todo_item_missing' };
      },
    }));
    const { report } = await runMatrix({
      browserFactory: testBrowserFactory(browser).factory,
      tasks,
      suite: fakeSuite({
        failStrategy: 'todomvc-add-complete:deterministic-playwright',
        failRouter: 'the-internet-login:jev-router',
      }),
      reportDir: await createReportDirectory(),
    });

    expect(report.results).toHaveLength(12);
    expect(verifications).toBe(12);
    const strategyFailure = report.results.find((result) =>
      result.taskId === 'todomvc-add-complete'
      && result.execution.kind === 'direct'
      && result.execution.strategyId === 'deterministic-playwright'
    );
    expect(strategyFailure?.outcome).toEqual({
      status: 'failed', phase: 'action', failureCode: 'strategy_execution_failed',
    });
    const routerFailure = report.results.find((result) =>
      result.taskId === 'the-internet-login'
      && result.execution.kind === 'router'
      && result.execution.routerId === 'jev-router'
    );
    expect(routerFailure?.execution.kind).toBe('router');
    if (!routerFailure || routerFailure.execution.kind !== 'router') {
      throw new Error('Expected a failed Jev router result.');
    }
    expect(routerFailure.execution.route).toMatchObject({ status: 'failed', failureCode: 'router_failed' });
    expect(routerFailure.outcome).toEqual({
      status: 'failed', phase: 'route', failureCode: 'router_failed',
    });
  });

  it('records navigation timeouts and continues through every matrix cell', async () => {
    if (!browser) throw new Error('Test browser did not start.');
    const testBrowser = browser;
    let sessions = 0;
    const verify = async (): Promise<TaskVerification> => ({
      status: 'unverifiable',
      failureCode: 'todo_app_not_loaded',
    });
    const tasks = testTasks().map((task) => ({ ...task, verify }));
    const browserFactory: BrowserFactory = {
      createSession: async () => {
        sessions += 1;
        const context = await testBrowser.newContext();
        const page = await context.newPage();
        return {
          page,
          navigate: async () => {
            const error = new Error('Simulated timeout.');
            error.name = 'TimeoutError';
            throw error;
          },
          close: async () => context.close(),
        };
      },
      getEnvironment: async () => ({
        nodeVersion: process.version,
        playwrightVersion: 'test-version',
        browser: 'chromium',
        browserVersion: testBrowser.version(),
      }),
    };
    const { report } = await runMatrix({
      browserFactory,
      tasks,
      suite: fakeSuite(),
      reportDir: await createReportDirectory(),
    });

    expect(sessions).toBe(12);
    expect(report.results).toHaveLength(12);
    expect(report.results.every((result) => result.outcome.status === 'failed'
      && result.outcome.phase === 'setup'
      && result.outcome.failureCode === 'navigation_timeout'
    )).toBe(true);
  });
});
