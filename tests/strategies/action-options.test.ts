import { describe, expect, it } from 'vitest';
import {
  buildActionChoices,
  pageObservationSchema,
} from '../../src/strategies/actions.js';
import { createSafeDecisionState } from '../../src/strategies/direct.js';
import type { TaskDefinition } from '../../src/domain/schema.js';

const task: TaskDefinition = {
  id: 'the-internet-login',
  site: 'the-internet',
  instruction: 'Sign in using the provided practice credentials.',
  inputs: { username: 'demo-user', password: 'private-value' },
};

const observation = pageObservationSchema.parse({
  url: 'https://example.test/login',
  title: 'Login',
  text: 'Login to the secure area.',
  controls: [
    { id: 'control-0', role: 'textbox', name: 'Username', occurrence: 0, disabled: false },
    { id: 'control-1', role: 'textbox', name: 'Password', occurrence: 0, disabled: false },
    { id: 'control-2', role: 'button', name: 'Login', occurrence: 0, disabled: false },
    { id: 'control-3', role: 'checkbox', name: 'Remember me', occurrence: 0, checked: false, disabled: false },
  ],
});

const todoTask: TaskDefinition = {
  id: 'todomvc-add-complete',
  site: 'playwright-todomvc',
  instruction: 'Add the provided support follow-up task, Review support request 1042, then mark it complete.',
  inputs: { todoTitle: 'Review support request 1042' },
};

describe('buildActionChoices', () => {
  it('offers only visible controls and known task inputs', () => {
    const choices = buildActionChoices(observation, task);
    expect(choices.map(({ id }) => id)).toEqual([
      'fill:control-0:username',
      'fill:control-0:password',
      'fill:control-1:username',
      'fill:control-1:password',
      'click:control-2',
      'check:control-3',
      'finish',
    ]);
  });

  it('does not put task input values in choice descriptions', () => {
    const choices = buildActionChoices(observation, task);
    const descriptions = choices.map(({ description }) => description).join(' ');
    expect(descriptions).not.toContain('demo-user');
    expect(descriptions).not.toContain('private-value');
  });

  it('omits task input values from model state', () => {
    const taskWithEchoedInputs: TaskDefinition = {
      ...task,
      instruction: 'Sign in as demo-user with private-value.',
    };
    const pageWithEchoedInputs = pageObservationSchema.parse({
      ...observation,
      url: 'https://example.test/private-value?token=demo-user#private-value',
      title: 'Signed in as demo-user',
      text: 'Logged in with private-value',
      controls: [
        ...observation.controls,
        { id: 'control-4', role: 'button', name: 'private-value', occurrence: 0, disabled: false },
      ],
    });
    const state = createSafeDecisionState(taskWithEchoedInputs, pageWithEchoedInputs);
    expect(state).not.toContain('demo-user');
    expect(state).not.toContain('private-value');
    expect(state).toContain('inputKeys');
  });

  it('does not offer actions for disabled controls', () => {
    const page = pageObservationSchema.parse({
      ...observation,
      controls: [
        ...observation.controls,
        { id: 'control-4', role: 'button', name: 'Delete', occurrence: 0, disabled: true },
      ],
    });
    expect(buildActionChoices(page, task).some((choice) => choice.id === 'click:control-4')).toBe(false);
  });

  it('offers Enter for the TodoMVC add-item input', () => {
    const page = pageObservationSchema.parse({
      url: 'https://example.test/todos',
      title: 'Todos',
      text: 'What needs to be done?',
      controls: [
        { id: 'control-0', role: 'textbox', name: 'What needs to be done?', occurrence: 0, disabled: false },
      ],
    });
    const choices = buildActionChoices(page, todoTask);

    expect(choices.some((choice) =>
      choice.id === 'press-enter:control-0'
      && choice.action.kind === 'press'
      && choice.action.key === 'Enter'
    )).toBe(true);
    expect(choices.some((choice) =>
      choice.id === 'fill:control-0:todoTitle'
      && choice.action.kind === 'fill'
      && choice.action.inputKey === 'todoTitle'
    )).toBe(true);
  });
});
