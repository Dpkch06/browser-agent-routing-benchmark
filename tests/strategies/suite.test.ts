import { describe, expect, it } from 'vitest';
import { createStrategySuite } from '../../src/strategies/index.js';
import type { DecisionProvider } from '../../src/strategies/providers.js';

describe('createStrategySuite', () => {
  it('exposes the six configured approaches without calling providers', () => {
    const unusedProvider: DecisionProvider = {
      choose: async () => {
        throw new Error('Providers should not run while the suite is created.');
      },
    };

    const suite = createStrategySuite({
      jev: unusedProvider,
      reasoning: unusedProvider,
    });

    expect(Object.keys(suite.direct).sort()).toEqual([
      'deterministic-playwright',
      'jev-guided-playwright',
      'reasoning-model-playwright',
    ]);
    expect(Object.keys(suite.routers).sort()).toEqual([
      'jev-router',
      'reasoning-model-router',
      'rule-based-router',
    ]);
  });
});
