import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  benchmarkReportSchema,
  directStrategyIds,
  modelMetadataSchema,
  routerIds,
  taskDefinitionSchema,
  taskIds,
  type DirectStrategyId,
  type RouterId,
  type TaskId,
} from '../../src/domain/schema.js';

type MatrixRow = z.input<typeof benchmarkReportSchema>['results'][number];

const directResult = (taskId: TaskId, strategyId: DirectStrategyId): MatrixRow => ({
  taskId,
  execution: { kind: 'direct', strategyId },
  outcome: { status: 'succeeded', verification: 'passed' },
  durationMs: 100,
  usage: { modelCalls: 0 },
});

const routedResult = (taskId: TaskId, routerId: RouterId): MatrixRow => ({
  taskId,
  execution: {
    kind: 'router',
    routerId,
    route: { status: 'selected', strategyId: 'deterministic-playwright', durationMs: 5 },
  },
  outcome: { status: 'succeeded', verification: 'passed' },
  durationMs: 110,
  usage: { modelCalls: 1, inputTokens: 20, outputTokens: 5, costUsd: 0.001 },
});

const validReport = (): z.input<typeof benchmarkReportSchema> => ({
  schemaVersion: 1,
  runId: 'b60b5e8a-432d-4ee6-9875-f5bad70fc47e',
  startedAt: '2026-11-08T10:00:00.000Z',
  completedAt: '2026-11-08T10:01:00.000Z',
  environment: {
    nodeVersion: 'v24.11.1',
    playwrightVersion: '1.65.0',
    browser: 'chromium',
    browserVersion: '142.0.0',
  },
  results: taskIds.flatMap((taskId) => [
    ...directStrategyIds.map((strategyId) => directResult(taskId, strategyId)),
    ...routerIds.map((routerId) => routedResult(taskId, routerId)),
  ]),
});

describe('benchmark report schema', () => {
  it('accepts every task and strategy combination in one matrix run', () => {
    const parsed = benchmarkReportSchema.parse(validReport());
    expect(parsed.results).toHaveLength(12);
  });

  it('round-trips the usage partial marker without storing private inputs', () => {
    const report = validReport();
    const direct = report.results.find((result) => result.execution.kind === 'direct');
    if (!direct) throw new Error('Expected a direct result in the matrix fixture');
    direct.usage.usagePartial = true;

    const parsed = benchmarkReportSchema.parse(report);

    expect(parsed.results.find((result) => result.execution.kind === 'direct')?.usage.usagePartial)
      .toBe(true);
  });

  it('rejects an incomplete matrix', () => {
    const report = validReport();
    report.results.pop();
    expect(() => benchmarkReportSchema.parse(report)).toThrow();
  });

  it('rejects duplicate task and strategy combinations', () => {
    const report = validReport();
    const firstResult = report.results[0];
    if (!firstResult) throw new Error('Expected a matrix fixture result');
    report.results[1] = firstResult;
    expect(() => benchmarkReportSchema.parse(report)).toThrow();
  });

  it('rejects a task ID paired with the wrong practice site', () => {
    expect(() => taskDefinitionSchema.parse({
      id: 'todomvc-add-complete',
      site: 'the-internet',
      instruction: 'Add and complete a todo item.',
      inputs: { title: 'Renew key' },
    })).toThrow();
  });

  it('rejects a report completed before it started', () => {
    const report = validReport();
    report.completedAt = '2026-11-08T09:59:00.000Z';
    expect(() => benchmarkReportSchema.parse(report)).toThrow();
  });

  it('round-trips optional model identity and version without storing prompts or credentials', () => {
    const report = validReport();
    const modelResult = report.results.find((result) =>
      result.execution.kind === 'direct' && result.execution.strategyId === 'jev-guided-playwright'
    );
    if (!modelResult) throw new Error('Expected a Jev strategy result in the matrix fixture');
    modelResult.models = [{
      stage: 'executor',
      provider: 'TypeSafe',
      modelId: 'jev',
      version: '1.13.0',
    }];

    const serialized = JSON.stringify(report);
    const parsed = benchmarkReportSchema.parse(JSON.parse(serialized));
    const parsedResult = parsed.results.find((result) =>
      result.execution.kind === 'direct' && result.execution.strategyId === 'jev-guided-playwright'
    );

    expect(parsedResult?.models).toEqual([{
      stage: 'executor',
      provider: 'TypeSafe',
      modelId: 'jev',
      version: '1.13.0',
    }]);
    expect(modelMetadataSchema.safeParse({
      stage: 'executor',
      provider: 'TypeSafe',
      modelId: 'jev',
      version: '1.13.0',
      apiKey: 'placeholder',
      prompt: 'not allowed in reports',
    }).success).toBe(false);
  });

  it('rejects a failed route paired with a successful outcome', () => {
    const report = validReport();
    const routed = report.results.find((result) => result.execution.kind === 'router');
    if (!routed || routed.execution.kind !== 'router') {
      throw new Error('Expected a routed result in the matrix fixture');
    }
    routed.execution.route = { status: 'failed', failureCode: 'route_timeout', durationMs: 9 };
    expect(() => benchmarkReportSchema.parse(report)).toThrow();
  });
});
