import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { getPracticeTask, practiceTasks } from '../../src/tasks/registry.js';

let browser: Browser | undefined;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

async function pageWith(html: string) {
  if (!browser) throw new Error('Browser did not start.');
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

describe('practice task registry', () => {
  it('contains the two approved tasks with their practice-site URLs', () => {
    expect(practiceTasks.map(({ definition }) => definition.id)).toEqual([
      'todomvc-add-complete',
      'the-internet-login',
    ]);
    expect(practiceTasks.map(({ startUrl }) => new URL(startUrl).hostname)).toEqual([
      'demo.playwright.dev',
      'the-internet.herokuapp.com',
    ]);
  });

  it('gives each approach the same task definition and fixed inputs', () => {
    const todoTask = getPracticeTask('todomvc-add-complete');
    expect(todoTask.definition.instruction).toContain('Review support request 1042');
    expect(todoTask.definition.inputs.todoTitle).toBe('Review support request 1042');

    const loginTask = getPracticeTask('the-internet-login');
    expect(loginTask.definition.instruction).toContain('practice account');
    expect(loginTask.definition.inputs.username).toBe('tomsmith');
    expect(loginTask.definition.inputs.password).toBeTruthy();
  });
});

describe('TodoMVC verifier', () => {
  it('passes when the requested item exists and is complete', async () => {
    const task = getPracticeTask('todomvc-add-complete');
    const page = await pageWith(`
      <input id="new-todo">
      <ul id="todo-list">
        <li class="completed">
          <input class="toggle" type="checkbox" checked>
          <label>Review support request 1042</label>
        </li>
      </ul>
    `);

    await expect(task.verify(page)).resolves.toEqual({ status: 'passed' });
    await page.close();
  });

  it('reports an incomplete item as task failure', async () => {
    const task = getPracticeTask('todomvc-add-complete');
    const page = await pageWith(`
      <input id="new-todo">
      <ul id="todo-list">
        <li>
          <input class="toggle" type="checkbox">
          <label>Review support request 1042</label>
        </li>
      </ul>
    `);

    await expect(task.verify(page)).resolves.toEqual({
      status: 'failed',
      failureCode: 'todo_item_not_completed',
    });
    await page.close();
  });

  it('reports an unrelated page as unverifiable setup', async () => {
    const task = getPracticeTask('todomvc-add-complete');
    const page = await pageWith('<main>Unknown page</main>');

    await expect(task.verify(page)).resolves.toEqual({
      status: 'unverifiable',
      failureCode: 'todo_app_not_loaded',
    });
    await page.close();
  });
});

describe('practice login verifier', () => {
  it('passes only when the secure area and success notice are present', async () => {
    const task = getPracticeTask('the-internet-login');
    const page = await pageWith(`
      <h2>Secure Area</h2>
      <div id="flash">You logged into a secure area!</div>
    `);

    await expect(task.verify(page)).resolves.toEqual({ status: 'passed' });
    await page.close();
  });

  it('reports a loaded login form without success as task failure', async () => {
    const task = getPracticeTask('the-internet-login');
    const page = await pageWith('<form id="login"><input name="username"></form>');

    await expect(task.verify(page)).resolves.toEqual({
      status: 'failed',
      failureCode: 'login_not_confirmed',
    });
    await page.close();
  });

  it('reports an unrelated page as unverifiable setup', async () => {
    const task = getPracticeTask('the-internet-login');
    const page = await pageWith('<main>Unknown page</main>');

    await expect(task.verify(page)).resolves.toEqual({
      status: 'unverifiable',
      failureCode: 'login_site_not_loaded',
    });
    await page.close();
  });
});



