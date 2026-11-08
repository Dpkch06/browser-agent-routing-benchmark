import type { Page } from 'playwright';
import {
  type DirectStrategyId,
  type ModelMetadata,
  type TaskDefinition,
} from '../domain/schema.js';
import {
  buildActionChoices,
  observePage,
  performBrowserAction,
  redactInputValues,
  safeTaskContext,
  type ActionChoice,
} from './actions.js';
import {
  type DecisionProvider,
  type DecisionRequest,
  type ProviderUsage,
} from './providers.js';

export type DirectStrategyRun = {
  actions: number;
  usage: ProviderUsage;
  models: ModelMetadata[];
};

export type DirectStrategyInput = {
  page: Page;
  task: TaskDefinition;
};

export interface DirectStrategy {
  readonly id: DirectStrategyId;
  run(input: DirectStrategyInput): Promise<DirectStrategyRun>;
}

export type DirectStrategyProviders = {
  jev: DecisionProvider;
  reasoning: DecisionProvider;
};

const maxAgentActions = 12;

export function createDirectStrategies(
  providers: DirectStrategyProviders,
): Record<DirectStrategyId, DirectStrategy> {
  const deterministic = new DeterministicPlaywrightStrategy();
  return {
    'deterministic-playwright': deterministic,
    'jev-guided-playwright': new JevGuidedPlaywrightStrategy(providers.jev),
    'reasoning-model-playwright': new ReasoningModelPlaywrightStrategy(providers.reasoning),
  };
}

export class DeterministicPlaywrightStrategy implements DirectStrategy {
  readonly id: DirectStrategyId = 'deterministic-playwright';

  async run({ page, task }: DirectStrategyInput): Promise<DirectStrategyRun> {
    switch (task.id) {
      case 'todomvc-add-complete': {
        const title = taskInput(task, 'todoTitle');
        const input = page.locator('#new-todo');
        await input.fill(title);
        await input.press('Enter');
        const row = page.locator('#todo-list li').filter({ hasText: title });
        await row.locator('input.toggle').check();
        return { actions: 3, usage: { modelCalls: 0 }, models: [] };
      }
      case 'the-internet-login': {
        const username = taskInput(task, 'username');
        const password = taskInput(task, 'password');
        await page.locator('#username').fill(username);
        await page.locator('#password').fill(password);
        await page.getByRole('button', { name: 'Login', exact: true }).click();
        return { actions: 3, usage: { modelCalls: 0 }, models: [] };
      }
      default: {
        const exhaustive: never = task;
        throw new Error('Unsupported deterministic task: ' + JSON.stringify(exhaustive));
      }
    }
  }
}

export class GuidedPlaywrightStrategy implements DirectStrategy {
  readonly id: DirectStrategyId;
  readonly #provider: DecisionProvider;

  constructor(config: {
    id: 'jev-guided-playwright' | 'reasoning-model-playwright';
    provider: DecisionProvider;
  }) {
    this.id = config.id;
    this.#provider = config.provider;
  }

  async run({ page, task }: DirectStrategyInput): Promise<DirectStrategyRun> {
    const decisions: Array<{
      usage: ProviderUsage;
      models: ModelMetadata[];
    }> = [];
    let actions = 0;

    while (actions < maxAgentActions) {
      const observation = await observePage(page);
      const choices = buildActionChoices(observation, task);
      const request: DecisionRequest = {
        stage: 'executor',
        question: 'Choose the next browser action. Choose finish only when the requested task is complete.',
        state: createSafeDecisionState(task, observation),
        options: choices.map((choice) => ({
          id: choice.id,
          description: choice.description,
        })),
      };
      const decision = await this.#provider.choose(request);
      const choice = findChoice(choices, decision.choiceId);
      decisions.push({ usage: decision.usage, models: decision.models });

      if (choice.action.kind === 'finish') {
        return {
          actions,
          usage: combineUsage(decisions.map((entry) => entry.usage)),
          models: uniqueModels(decisions.flatMap((entry) => entry.models)),
        };
      }

      const currentObservation = await observePage(page);
      const currentChoice = findChoice(
        buildActionChoices(currentObservation, task),
        decision.choiceId,
      );
      assertCurrentTarget(observation, currentObservation, choice);
      await performBrowserAction(page, currentObservation, task, currentChoice.action);
      actions += 1;
    }

    throw new Error('The browser agent reached its action limit before finishing.');
  }
}

export class JevGuidedPlaywrightStrategy extends GuidedPlaywrightStrategy {
  constructor(provider: DecisionProvider) {
    super({ id: 'jev-guided-playwright', provider });
  }
}

export class ReasoningModelPlaywrightStrategy extends GuidedPlaywrightStrategy {
  constructor(provider: DecisionProvider) {
    super({ id: 'reasoning-model-playwright', provider });
  }
}

export function createSafeDecisionState(
  task: TaskDefinition,
  observation: Awaited<ReturnType<typeof observePage>>,
): string {
  const safeInstruction = redactInputValues(task.instruction, Object.values(task.inputs));
  const safeText = redactInputValues(observation.text, Object.values(task.inputs));
  const url = new URL(observation.url);

  return JSON.stringify({
    task: safeTaskContext(task),
    page: {
      url: redactInputValues(url.origin + url.pathname, Object.values(task.inputs)),
      title: redactInputValues(observation.title, Object.values(task.inputs)),
      text: safeText,
      controls: observation.controls.map((control) => ({
        ...control,
        name: redactInputValues(control.name, Object.values(task.inputs)),
      })),
    },
  });
}

function findChoice(choices: ActionChoice[], choiceId: string): ActionChoice {
  const choice = choices.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error('Decision provider selected an action outside the offered choices.');
  return choice;
}

function assertCurrentTarget(
  before: Awaited<ReturnType<typeof observePage>>,
  current: Awaited<ReturnType<typeof observePage>>,
  choice: ActionChoice,
): void {
  const action = choice.action;
  if (action.kind === 'finish') return;
  const beforeControl = before.controls.find((control) => control.id === action.targetId);
  const currentControl = current.controls.find((control) => control.id === action.targetId);
  if (
    !beforeControl
    || !currentControl
    || beforeControl.role !== currentControl.role
    || beforeControl.name !== currentControl.name
    || beforeControl.occurrence !== currentControl.occurrence
  ) {
    throw new Error('The selected browser action target changed before execution.');
  }
}

function taskInput(task: TaskDefinition, key: string): string {
  const value = task.inputs[key];
  if (value === undefined) {
    throw new Error('The task is missing its required input: ' + key + '.');
  }
  return value;
}

function combineUsage(entries: ProviderUsage[]): ProviderUsage {
  const modelCalls = entries.reduce((total, usage) => total + usage.modelCalls, 0);
  const hasInputTokens = entries.length > 0 && entries.every((usage) => usage.inputTokens !== undefined);
  const hasOutputTokens = entries.length > 0 && entries.every((usage) => usage.outputTokens !== undefined);
  const hasCost = entries.length > 0 && entries.every((usage) => usage.costUsd !== undefined);
  const inputTokens = entries.reduce((total, usage) => total + (usage.inputTokens ?? 0), 0);
  const outputTokens = entries.reduce((total, usage) => total + (usage.outputTokens ?? 0), 0);
  const costUsd = entries.reduce((total, usage) => total + (usage.costUsd ?? 0), 0);

  return {
    modelCalls,
    ...(hasInputTokens ? { inputTokens } : {}),
    ...(hasOutputTokens ? { outputTokens } : {}),
    ...(hasCost ? { costUsd } : {}),
  };
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
