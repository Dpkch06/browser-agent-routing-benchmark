import { describe, expect, it } from 'vitest';
import {
  chooseRuleBasedStrategy,
  ModelBasedRouter,
} from '../../src/strategies/routers.js';
import type {
  DecisionProvider,
  DecisionRequest,
} from '../../src/strategies/providers.js';
import type { TaskDefinition } from '../../src/domain/schema.js';

const todoTask: TaskDefinition = {
  id: 'todomvc-add-complete',
  site: 'playwright-todomvc',
  instruction: 'Add and complete the provided item.',
  inputs: { title: 'Renew key' },
};

const loginTask: TaskDefinition = {
  id: 'the-internet-login',
  site: 'the-internet',
  instruction: 'Sign in using the provided practice credentials.',
  inputs: { username: 'demo-user', password: 'private-value' },
};

describe('chooseRuleBasedStrategy', () => {
  it('uses a deterministic script for the fixed TodoMVC workflow', () => {
    expect(chooseRuleBasedStrategy(todoTask)).toBe('deterministic-playwright');
  });

  it('uses Jev-guided actions for the practice login workflow', () => {
    expect(chooseRuleBasedStrategy(loginTask)).toBe('jev-guided-playwright');
  });

  it('routes through the provider choice and omits input values from router state', async () => {
    let captured: DecisionRequest | undefined;
    const provider: DecisionProvider = {
      choose: async (request) => {
        captured = request;
        return {
          choiceId: 'reasoning-model-playwright',
          usage: { modelCalls: 1, inputTokens: 20, outputTokens: 3 },
          models: [{ stage: 'router', provider: 'test', modelId: 'test-model' }],
        };
      },
    };
    const router = new ModelBasedRouter({ id: 'jev-router', provider });

    const selection = await router.route(loginTask);

    expect(selection.strategyId).toBe('reasoning-model-playwright');
    expect(selection.usage.modelCalls).toBe(1);
    expect(captured?.stage).toBe('router');
    expect(captured?.state).not.toContain('private-value');
  });

  it('rejects a provider choice outside the direct strategy set', async () => {
    const provider: DecisionProvider = {
      choose: async () => ({
        choiceId: 'unknown-strategy',
        usage: { modelCalls: 1 },
        models: [],
      }),
    };
    const router = new ModelBasedRouter({ id: 'jev-router', provider });

    await expect(router.route(loginTask)).rejects.toThrow(/unknown direct strategy/i);
  });
});
