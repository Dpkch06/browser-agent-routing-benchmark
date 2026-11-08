import type { DirectStrategyId, RouterId } from '../domain/schema.js';
import {
  createDirectStrategies,
  type DirectStrategy,
} from './direct.js';
import {
  createRouters,
  type StrategyRouter,
} from './routers.js';
import type { DecisionProvider } from './providers.js';
export { StrategyExecutionError, type StrategyExecutionFailure } from './errors.js';

export type StrategyProviders = {
  jev: DecisionProvider;
  reasoning: DecisionProvider;
};

export type StrategySuite = {
  direct: Record<DirectStrategyId, DirectStrategy>;
  routers: Record<RouterId, StrategyRouter>;
};

export function createStrategySuite(providers: StrategyProviders): StrategySuite {
  return {
    direct: createDirectStrategies(providers),
    routers: createRouters(providers),
  };
}

export { buildActionChoices, observePage, performBrowserAction } from './actions.js';
export {
  DeterministicPlaywrightStrategy,
  GuidedPlaywrightStrategy,
  JevGuidedPlaywrightStrategy,
  ReasoningModelPlaywrightStrategy,
  createDirectStrategies,
} from './direct.js';
export {
  JevRouter,
  ModelBasedRouter,
  ReasoningModelRouter,
  RuleBasedRouter,
  chooseRuleBasedStrategy,
  createRouters,
} from './routers.js';
export {
  OpenAICompatibleChoiceProvider,
  TypeSafeChoiceProvider,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
  type OpenAICompatibleProviderConfig,
  type TypeSafeProviderConfig,
} from './providers.js';
