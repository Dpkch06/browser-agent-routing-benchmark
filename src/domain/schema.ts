import * as z from 'zod';

export const taskIds = ['todomvc-add-complete', 'the-internet-login'] as const;
export const siteIds = ['playwright-todomvc', 'the-internet'] as const;
export const directStrategyIds = [
  'deterministic-playwright',
  'jev-guided-playwright',
  'reasoning-model-playwright',
] as const;
export const routerIds = ['rule-based-router', 'jev-router', 'reasoning-model-router'] as const;

export const taskIdSchema = z.enum(taskIds);
export const siteIdSchema = z.enum(siteIds);
export const directStrategyIdSchema = z.enum(directStrategyIds);
export const routerIdSchema = z.enum(routerIds);

const taskFields = {
  instruction: z.string().trim().min(1),
  inputs: z.record(z.string(), z.string()),
};

export const taskDefinitionSchema = z.discriminatedUnion('id', [
  z.object({
    ...taskFields,
    id: z.literal('todomvc-add-complete'),
    site: z.literal('playwright-todomvc'),
  }).strict(),
  z.object({
    ...taskFields,
    id: z.literal('the-internet-login'),
    site: z.literal('the-internet'),
  }).strict(),
]);

const routeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('selected'),
    strategyId: directStrategyIdSchema,
    durationMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    failureCode: z.string().trim().min(1),
    durationMs: z.number().int().nonnegative(),
  }).strict(),
]);

export const executionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('direct'),
    strategyId: directStrategyIdSchema,
  }).strict(),
  z.object({
    kind: z.literal('router'),
    routerId: routerIdSchema,
    route: routeSchema,
  }).strict(),
]);

const outcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('succeeded'),
    verification: z.literal('passed'),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    phase: z.enum(['route', 'setup', 'action', 'verification']),
    failureCode: z.string().trim().min(1),
  }).strict(),
]);

const usageSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().finite().optional(),
  usagePartial: z.boolean().optional(),
}).strict();

export const modelMetadataSchema = z.object({
  stage: z.enum(['router', 'executor']),
  provider: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  version: z.string().trim().min(1).optional(),
}).strict();

export const benchmarkResultSchema = z.object({
  taskId: taskIdSchema,
  execution: executionSchema,
  outcome: outcomeSchema,
  durationMs: z.number().int().nonnegative(),
  usage: usageSchema,
  models: z.array(modelMetadataSchema).optional(),
}).strict().superRefine((result, context) => {
  if (result.execution.kind === 'router') {
    if (result.execution.route.status === 'failed' && result.outcome.status !== 'failed') {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'A failed route must have a failed outcome.',
      });
    }
    if (result.execution.route.status === 'selected' && result.outcome.status === 'failed' && result.outcome.phase === 'route') {
      context.addIssue({
        code: 'custom',
        path: ['outcome', 'phase'],
        message: 'A selected route cannot fail during routing.',
      });
    }
  }

  if (result.execution.kind === 'direct' && result.outcome.status === 'failed' && result.outcome.phase === 'route') {
    context.addIssue({
      code: 'custom',
      path: ['outcome', 'phase'],
      message: 'A direct strategy has no routing phase.',
    });
  }
});

export const benchmarkReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  environment: z.object({
    nodeVersion: z.string().trim().min(1),
    playwrightVersion: z.string().trim().min(1),
    browser: z.literal('chromium'),
    browserVersion: z.string().trim().min(1),
  }).strict(),
  results: z.array(benchmarkResultSchema),
}).strict().superRefine((report, context) => {
  if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'A benchmark cannot complete before it starts.',
    });
  }

  const expected = new Set<string>();
  for (const taskId of taskIds) {
    for (const strategyId of directStrategyIds) expected.add(`${taskId}:direct:${strategyId}`);
    for (const routerId of routerIds) expected.add(`${taskId}:router:${routerId}`);
  }

  const seen = new Set<string>();
  report.results.forEach((result, index) => {
    const strategyKey = result.execution.kind === 'direct'
      ? `direct:${result.execution.strategyId}`
      : `router:${result.execution.routerId}`;
    const key = `${result.taskId}:${strategyKey}`;
    if (seen.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['results', index],
        message: `Duplicate result for ${key}.`,
      });
    }
    seen.add(key);
  });

  const missing = [...expected].filter((key) => !seen.has(key));
  const unexpected = [...seen].filter((key) => !expected.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['results'],
      message: `The matrix must contain each task and strategy once. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`,
    });
  }
});

export type TaskId = z.infer<typeof taskIdSchema>;
export type SiteId = z.infer<typeof siteIdSchema>;
export type DirectStrategyId = z.infer<typeof directStrategyIdSchema>;
export type RouterId = z.infer<typeof routerIdSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type BenchmarkResult = z.infer<typeof benchmarkResultSchema>;
export type BenchmarkReport = z.infer<typeof benchmarkReportSchema>;
export type ModelMetadata = z.infer<typeof modelMetadataSchema>;
