import { performance } from 'node:perf_hooks';
import {
  directStrategyIdSchema,
  directStrategyIds,
  type DirectStrategyId,
  type RouterId,
  type TaskDefinition,
} from '../domain/schema.js';
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
} from './providers.js';
import { safeTaskContext } from './actions.js';
import { StrategyExecutionError } from './errors.js';

export type RouterSelection = {
  strategyId: DirectStrategyId;
  durationMs: number;
  usage: DecisionResponse['usage'];
  models: DecisionResponse['models'];
};

export interface StrategyRouter {
  readonly id: RouterId;
  route(task: TaskDefinition): Promise<RouterSelection>;
}

const strategyDescriptions: Record<DirectStrategyId, string> = {
  'deterministic-playwright': 'Use a fixed Playwright workflow for a known page and task.',
  'jev-guided-playwright': 'Use Jev to select bounded Playwright actions from the current page.',
  'reasoning-model-playwright': 'Use a reasoning model to select bounded Playwright actions from the current page.',
};

export function chooseRuleBasedStrategy(task: TaskDefinition): DirectStrategyId {
  switch (task.id) {
    case 'todomvc-add-complete':
      return 'deterministic-playwright';
    case 'the-internet-login':
      return 'jev-guided-playwright';
    default: {
      const exhaustive: never = task;
      throw new Error('Unsupported rule-routing task: ' + JSON.stringify(exhaustive));
    }
  }
}

export class RuleBasedRouter implements StrategyRouter {
  readonly id: RouterId = 'rule-based-router';

  async route(task: TaskDefinition): Promise<RouterSelection> {
    const startedAt = performance.now();
    return {
      strategyId: chooseRuleBasedStrategy(task),
      durationMs: Math.round(performance.now() - startedAt),
      usage: { modelCalls: 0 },
      models: [],
    };
  }
}

export class ModelBasedRouter implements StrategyRouter {
  readonly id: RouterId;
  readonly #provider: DecisionProvider;

  constructor(config: {
    id: Extract<RouterId, 'jev-router' | 'reasoning-model-router'>;
    provider: DecisionProvider;
  }) {
    this.id = config.id;
    this.#provider = config.provider;
  }

  async route(task: TaskDefinition): Promise<RouterSelection> {
    const startedAt = performance.now();
    const request: DecisionRequest = {
      stage: 'router',
      question: 'Which direct Playwright strategy should execute this task?',
      state: JSON.stringify({
        task: safeTaskContext(task),
      }),
      options: directStrategyIds.map((id) => ({
        id,
        description: strategyDescriptions[id],
      })),
    };
    let decision: DecisionResponse;
    try {
      decision = await this.#provider.choose(request);
    } catch {
      throw new StrategyExecutionError({
        phase: 'route',
        failureCode: 'router_provider_failed',
        usage: { modelCalls: 1, usagePartial: true },
        models: [],
      });
    }

    let strategyId: DirectStrategyId;
    try {
      strategyId = parseStrategyId(decision.choiceId);
    } catch {
      throw new StrategyExecutionError({
        phase: 'route',
        failureCode: 'invalid_route_choice',
        usage: decision.usage,
        models: decision.models,
      });
    }

    return {
      strategyId,
      durationMs: Math.round(performance.now() - startedAt),
      usage: decision.usage,
      models: decision.models,
    };
  }
}

export class JevRouter extends ModelBasedRouter {
  constructor(provider: DecisionProvider) {
    super({ id: 'jev-router', provider });
  }
}

export class ReasoningModelRouter extends ModelBasedRouter {
  constructor(provider: DecisionProvider) {
    super({ id: 'reasoning-model-router', provider });
  }
}

export type RouterProviders = {
  jev: DecisionProvider;
  reasoning: DecisionProvider;
};

export function createRouters(providers: RouterProviders): Record<RouterId, StrategyRouter> {
  return {
    'rule-based-router': new RuleBasedRouter(),
    'jev-router': new JevRouter(providers.jev),
    'reasoning-model-router': new ReasoningModelRouter(providers.reasoning),
  };
}

function parseStrategyId(value: string): DirectStrategyId {
  const parsed = directStrategyIdSchema.safeParse(value);
  if (!parsed.success || !directStrategyIds.includes(parsed.data)) {
    throw new Error('Router selected an unknown direct strategy.');
  }
  return parsed.data;
}
