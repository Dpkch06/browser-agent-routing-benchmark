import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  buildActionChoices,
  observePage,
  performBrowserAction,
} from '../../src/strategies/actions.js';
import type { TaskDefinition } from '../../src/domain/schema.js';

const todoTask: TaskDefinition = {
  id: 'todomvc-add-complete',
  site: 'playwright-todomvc',
  instruction: 'Mark the provided task complete.',
  inputs: { todoTitle: 'Review support request 1042' },
};

describe('TodoMVC checkbox label fallback', () => {
  it('offers a check action for a native toggle next to its list item label', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(1000);
      await page.setContent([
        '<ul id="todo-list">',
        '  <li><div class="view">',
        '    <input class="toggle" type="checkbox">',
        '    <label>Review support request 1042</label>',
        '  </div></li>',
        '</ul>',
      ].join(''));

      const observation = await observePage(page);
      const checkbox = observation.controls.find((control) => control.role === 'checkbox');
      const choices = buildActionChoices(observation, todoTask);

      expect(checkbox?.name).toBe('Review support request 1042');
      expect(choices.some((choice) =>
        choice.action.kind === 'check'
        && choice.action.targetId === checkbox?.id
      )).toBe(true);
    } finally {
      await browser.close();
    }
  });
  it('executes a check action for the adjacent-label TodoMVC checkbox', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(1000);
      await page.setContent([
        '<ul id="todo-list">',
        '  <li><div class="view">',
        '    <input class="toggle" type="checkbox">',
        '    <label>Review support request 1042</label>',
        '  </div></li>',
        '</ul>',
      ].join(''));

      const observation = await observePage(page);
      const checkbox = observation.controls.find((control) => control.role === 'checkbox');
      if (!checkbox) throw new Error('Expected a TodoMVC checkbox control.');
      const choice = buildActionChoices(observation, todoTask).find((candidate) =>
        candidate.action.kind === 'check' && candidate.action.targetId === checkbox.id
      );
      if (!choice) throw new Error('Expected a check action for the TodoMVC checkbox.');

      await performBrowserAction(page, observation, todoTask, choice.action);
      expect(await page.locator('#todo-list input.toggle').isChecked()).toBe(true);
    } finally {
      await browser.close();
    }
  });
});


