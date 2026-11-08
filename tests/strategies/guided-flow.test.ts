import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { GuidedPlaywrightStrategy } from '../../src/strategies/direct.js';
import * as z from 'zod';
import { taskIdSchema, type TaskDefinition } from '../../src/domain/schema.js';
import type { DecisionProvider, DecisionRequest } from '../../src/strategies/providers.js';
import { browserActionSchema, type BrowserAction } from '../../src/strategies/actions.js';
import { StrategyExecutionError } from '../../src/strategies/index.js';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

const todoTask: TaskDefinition = {
  id: 'todomvc-add-complete',
  site: 'playwright-todomvc',
  instruction: 'Add Review support request 1042 and mark it complete.',
  inputs: { todoTitle: 'Review support request 1042' },
};

const loginTask: TaskDefinition = {
  id: 'the-internet-login',
  site: 'the-internet',
  instruction: 'Sign in as demo-user using private-value.',
  inputs: { username: 'demo-user', password: 'private-value' },
};

const decisionStateSchema = z.object({
  task: z.object({ id: taskIdSchema }).passthrough(),
  actionHistory: z.array(browserActionSchema),
}).passthrough();
function providerForFlow(): DecisionProvider {
  return {
    choose: async (request: DecisionRequest) => {
      const state = decisionStateSchema.parse(JSON.parse(request.state));
      const history = state.actionHistory;
      const filledInputs = new Set(
        history.filter((action) => action.kind === 'fill').map((action) => action.inputKey),
      );
      let choiceId: string;

      if (state.task.id === 'todomvc-add-complete') {
        if (!filledInputs.has('todoTitle')) choiceId = 'fill:control-0:todoTitle';
        else if (!history.some((action) => action.kind === 'press')) choiceId = 'press-enter:control-0';
        else if (!history.some((action) => action.kind === 'check')) {
          choiceId = request.options.find((option) => option.id.startsWith('check:'))?.id ?? '';
        } else choiceId = 'finish';
      } else {
        if (!filledInputs.has('username')) choiceId = 'fill:control-0:username';
        else if (!filledInputs.has('password')) choiceId = 'fill:control-1:password';
        else if (!history.some((action) => action.kind === 'click')) choiceId = 'click:control-2';
        else choiceId = 'finish';
      }

      if (!request.options.some((option) => option.id === choiceId)) {
        throw new Error('Expected action was not offered: ' + choiceId);
      }

      return {
        choiceId,
        usage: { modelCalls: 1 },
        models: [{ stage: request.stage, provider: 'test', modelId: 'fixture' }],
      };
    },
  };
}

describe('guided strategy action history', () => {
  it('fills, presses Enter, and checks the TodoMVC item without repeating the fill', async () => {
    const page = await browser.newPage();
    await page.setContent([
      '<input id="new-todo" placeholder="What needs to be done?">',
      '<ul id="todo-list"></ul>',
      '<script>',
      'const input = document.querySelector("#new-todo");',
      'input.addEventListener("keydown", (event) => {',
      '  if (event.key !== "Enter" || !input.value.trim()) return;',
      '  const row = document.createElement("li");',
      '  const view = document.createElement("div");',
      '  view.className = "view";',
      '  const toggle = document.createElement("input");',
      '  toggle.className = "toggle";',
      '  toggle.type = "checkbox";',
      '  const label = document.createElement("label");',
      '  label.textContent = input.value;',
      '  toggle.addEventListener("change", () => row.classList.toggle("completed", toggle.checked));',
      '  view.append(toggle, label); row.append(view); document.querySelector("#todo-list").append(row);',
      '  input.value = "";',
      '});',
      '</script>',
    ].join(''));

    const strategy = new GuidedPlaywrightStrategy({ id: 'jev-guided-playwright', provider: providerForFlow() });
    const result = await strategy.run({ page, task: todoTask });

    expect(result.actions).toBe(3);
    expect(await page.locator('#todo-list li.completed label').innerText()).toBe('Review support request 1042');
    expect(await page.locator('#todo-list input.toggle').isChecked()).toBe(true);
    await page.close();
  });

  it('fills username, then password, then submits the practice login form', async () => {
    const page = await browser.newPage();
    await page.setContent([
      '<form id="login">',
      '  <label for="username">Username</label><input id="username">',
      '  <label for="password">Password</label><input id="password" type="password">',
      '  <button type="submit">Login</button>',
      '</form>',
      '<script>',
      'document.querySelector("#login").addEventListener("submit", (event) => {',
      '  event.preventDefault(); document.body.innerHTML = "<h2>Secure Area</h2><p>You logged into a secure area!</p>";',
      '});',
      '</script>',
    ].join(''));

    const provider = providerForFlow();
    const requests: DecisionRequest[] = [];
    const captureProvider: DecisionProvider = {
      choose: async (request) => {
        requests.push(request);
        return provider.choose(request);
      },
    };
    const strategy = new GuidedPlaywrightStrategy({ id: 'reasoning-model-playwright', provider: captureProvider });
    const result = await strategy.run({ page, task: loginTask });

    expect(result.actions).toBe(3);
    expect(await page.getByRole('heading', { name: 'Secure Area' }).isVisible()).toBe(true);
    expect(requests.every(({ state }) => !state.includes('demo-user') && !state.includes('private-value'))).toBe(true);
    await page.close();
  });

  it('retains successful usage and counts a failed provider call as attempted', async () => {
    const page = await browser.newPage();
    await page.setContent('<input id="new-todo" placeholder="What needs to be done?">');
    let calls = 0;
    const provider: DecisionProvider = {
      choose: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            choiceId: 'fill:control-0:todoTitle',
            usage: { modelCalls: 1, inputTokens: 13, outputTokens: 7 },
            models: [{ stage: 'executor', provider: 'test', modelId: 'fixture' }],
          };
        }
        throw new Error('private provider response and key');
      },
    };
    const strategy = new GuidedPlaywrightStrategy({ id: 'jev-guided-playwright', provider });

    await expect(strategy.run({ page, task: todoTask })).rejects.toMatchObject({
      name: 'StrategyExecutionError',
      phase: 'action',
      failureCode: 'provider_failed',
      message: 'provider_failed',
      usage: { modelCalls: 2, inputTokens: 13, outputTokens: 7, usagePartial: true },
      models: [{ stage: 'executor', provider: 'test', modelId: 'fixture' }],
    });
    expect(calls).toBe(2);
    await page.close();
  });

  it('caps a guided task at six provider decisions, including finish', async () => {
    const page = await browser.newPage();
    await page.setContent('<input id="new-todo" placeholder="What needs to be done?">');
    let calls = 0;
    const provider: DecisionProvider = {
      choose: async (request) => {
        calls += 1;
        const state = decisionStateSchema.parse(JSON.parse(request.state));
        const filled = state.actionHistory.some((action) => action.kind === 'fill');
        const choiceId = filled
          ? request.options.find((option) => option.id.startsWith('press-enter:'))?.id ?? ''
          : 'fill:control-0:todoTitle';
        return {
          choiceId,
          usage: { modelCalls: 1, inputTokens: 11, outputTokens: 4 },
          models: [{ stage: 'executor', provider: 'test', modelId: 'fixture' }],
        };
      },
    };
    const strategy = new GuidedPlaywrightStrategy({ id: 'jev-guided-playwright', provider });

    await expect(strategy.run({ page, task: todoTask })).rejects.toMatchObject({
      name: 'StrategyExecutionError',
      failureCode: 'action_limit_reached',
      usage: { modelCalls: 6, inputTokens: 66, outputTokens: 24 },
    });
    expect(calls).toBe(6);
    await page.close();
  });
});
