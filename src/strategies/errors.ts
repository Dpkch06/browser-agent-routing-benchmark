import type { ModelMetadata } from '../domain/schema.js';
import type { ProviderUsage } from './providers.js';

export type StrategyExecutionFailure =
  | {
      phase: 'action';
      failureCode: 'provider_failed' | 'invalid_action_choice' | 'browser_action_failed' | 'action_limit_reached';
      usage: ProviderUsage;
      models: ModelMetadata[];
    }
  | {
      phase: 'route';
      failureCode: 'router_provider_failed' | 'invalid_route_choice';
      usage: ProviderUsage;
      models: ModelMetadata[];
    };

export class StrategyExecutionError extends Error {
  readonly failure: StrategyExecutionFailure;

  constructor(failure: StrategyExecutionFailure) {
    super(failure.failureCode);
    this.name = 'StrategyExecutionError';
    this.failure = failure;
  }

  get phase(): StrategyExecutionFailure['phase'] {
    return this.failure.phase;
  }

  get failureCode(): StrategyExecutionFailure['failureCode'] {
    return this.failure.failureCode;
  }

  get usage(): ProviderUsage {
    return this.failure.usage;
  }

  get models(): ModelMetadata[] {
    return this.failure.models;
  }
}
