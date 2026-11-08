import { type Page } from 'playwright';
import {
  taskDefinitionSchema,
  type TaskDefinition,
  type TaskId,
} from '../domain/schema.js';

export type TaskFailureCode =
  | 'todo_item_missing'
  | 'todo_item_not_completed'
  | 'login_not_confirmed';

export type SiteSetupFailureCode =
  | 'todo_app_not_loaded'
  | 'login_site_not_loaded';

export type TaskVerification =
  | { status: 'passed' }
  | { status: 'failed'; failureCode: TaskFailureCode }
  | { status: 'unverifiable'; failureCode: SiteSetupFailureCode };

export type PracticeTask = {
  definition: TaskDefinition;
  startUrl: string;
  verify: (page: Page) => Promise<TaskVerification>;
};

const todoDefinition = taskDefinitionSchema.parse({
  id: 'todomvc-add-complete',
  site: 'playwright-todomvc',
  instruction: 'Add the provided support follow-up task, Review support request 1042, then mark it complete.',
  inputs: { todoTitle: 'Review support request 1042' },
});

const loginDefinition = taskDefinitionSchema.parse({
  id: 'the-internet-login',
  site: 'the-internet',
  instruction: 'Sign in to the practice account and stop when the secure area confirms success.',
  inputs: {
    username: 'tomsmith',
    password: 'SuperSecretPassword!',
  },
});

async function verifyTodoMvc(page: Page): Promise<TaskVerification> {
  const input = page.locator('#new-todo');
  const list = page.locator('#todo-list');
  if (await input.count() === 0 || await list.count() === 0) {
    return { status: 'unverifiable', failureCode: 'todo_app_not_loaded' };
  }

  const title = todoDefinition.inputs.todoTitle;
  const items = await list.locator('li').all();
  for (const item of items) {
    if (await item.locator('label').textContent() !== title) continue;

    const classes = (await item.getAttribute('class'))?.split(/\s+/) ?? [];
    const checkbox = item.locator('input.toggle');
    if (classes.includes('completed') && await checkbox.isChecked()) {
      return { status: 'passed' };
    }
    return { status: 'failed', failureCode: 'todo_item_not_completed' };
  }

  return { status: 'failed', failureCode: 'todo_item_missing' };
}

async function verifyPracticeLogin(page: Page): Promise<TaskVerification> {
  const secureHeading = page.getByRole('heading', { name: 'Secure Area', exact: true });
  const flash = page.locator('#flash');
  if (await secureHeading.count() > 0 && await flash.count() > 0) {
    const message = (await flash.innerText()).trim();
    if (message.includes('You logged into a secure area!')) {
      return { status: 'passed' };
    }
  }

  const loginForm = page.locator('form#login');
  const knownSecureArea = await secureHeading.count() > 0;
  const knownLoginPage = await loginForm.count() > 0;
  if (knownLoginPage || knownSecureArea || await flash.count() > 0) {
    return { status: 'failed', failureCode: 'login_not_confirmed' };
  }

  return { status: 'unverifiable', failureCode: 'login_site_not_loaded' };
}

const taskById = {
  'todomvc-add-complete': {
    definition: todoDefinition,
    startUrl: 'https://demo.playwright.dev/todomvc/',
    verify: verifyTodoMvc,
  },
  'the-internet-login': {
    definition: loginDefinition,
    startUrl: 'https://the-internet.herokuapp.com/login',
    verify: verifyPracticeLogin,
  },
} satisfies Record<TaskId, PracticeTask>;

export const practiceTasks: readonly PracticeTask[] = Object.freeze([
  taskById['todomvc-add-complete'],
  taskById['the-internet-login'],
]);

export function getPracticeTask(id: TaskId): PracticeTask {
  return taskById[id];
}

