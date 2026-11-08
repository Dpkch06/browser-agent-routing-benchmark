import type { Page } from 'playwright';
import * as z from 'zod';
import type { TaskDefinition } from '../domain/schema.js';

export const browserRoleSchema = z.enum([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
]);

export const browserControlSchema = z.object({
  id: z.string().min(1),
  role: browserRoleSchema,
  name: z.string().min(1),
  occurrence: z.number().int().nonnegative(),
  disabled: z.boolean(),
  checked: z.boolean().optional(),
  nativeInput: z.boolean().optional(),
}).strict();

export const pageObservationSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  text: z.string().max(3000),
  controls: z.array(browserControlSchema),
}).strict();

export const browserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), targetId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('fill'), targetId: z.string().min(1), inputKey: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('press'), targetId: z.string().min(1), key: z.literal('Enter') }).strict(),
  z.object({ kind: z.literal('check'), targetId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('uncheck'), targetId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('finish') }).strict(),
]);

export const actionChoiceSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  action: browserActionSchema,
}).strict();

export type BrowserRole = z.infer<typeof browserRoleSchema>;
export type BrowserControl = z.infer<typeof browserControlSchema>;
export type PageObservation = z.infer<typeof pageObservationSchema>;
export type BrowserAction = z.infer<typeof browserActionSchema>;
export type ActionChoice = z.infer<typeof actionChoiceSchema>;

const interactiveSelector = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(', ');

export async function observePage(page: Page): Promise<PageObservation> {
  const [url, title, text, controls] = await Promise.all([
    Promise.resolve(page.url()),
    page.title(),
    page.locator('body').innerText({ timeout: 1500 }).catch(() => ''),
    page.locator(interactiveSelector).evaluateAll((elements) => {
      const readRole = (element: HTMLElement): BrowserRole | undefined => {
        switch (element.getAttribute('role')) {
          case 'button': return 'button';
          case 'link': return 'link';
          case 'textbox': return 'textbox';
          case 'checkbox': return 'checkbox';
          case 'radio': return 'radio';
        }

        if (element instanceof HTMLButtonElement) return 'button';
        if (element instanceof HTMLAnchorElement) return 'link';
        if (element instanceof HTMLTextAreaElement) return 'textbox';
        if (element instanceof HTMLInputElement) {
          const type = element.type.toLowerCase();
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
          return 'textbox';
        }

        return undefined;
      };

      const readName = (element: HTMLElement): string => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;

        const labelledBy = element.getAttribute('aria-labelledby')
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        if (labelledBy) return labelledBy;

        if (
          element instanceof HTMLInputElement
          || element instanceof HTMLTextAreaElement
        ) {
          const labelText = Array.from(element.labels ?? [])
            .map((label) => label.innerText.trim())
            .filter(Boolean)
            .join(' ');
          if (labelText) return labelText;
          const placeholder = element.getAttribute('placeholder')?.trim();
          if (placeholder) return placeholder;
        }

        return element.innerText.trim() || element.getAttribute('title')?.trim() || '';
      };

      const isDisabled = (element: HTMLElement): boolean => {
        if (element.getAttribute('aria-disabled') === 'true') return true;
        if (
          element instanceof HTMLButtonElement
          || element instanceof HTMLInputElement
          || element instanceof HTMLTextAreaElement
          || element instanceof HTMLSelectElement
        ) {
          return element.disabled;
        }
        return false;
      };

      const controls: Array<{
        role: BrowserRole;
        name: string;
        disabled: boolean;
        checked?: boolean;
        nativeInput?: boolean;
      }> = [];

      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.getClientRects().length === 0) continue;

        const role = readRole(element);
        if (!role) continue;

        const name = readName(element);
        if (!name) continue;

        const control: {
          role: BrowserRole;
          name: string;
          disabled: boolean;
          checked?: boolean;
        nativeInput?: boolean;
        } = {
          role,
          name,
          disabled: isDisabled(element),
          nativeInput: element instanceof HTMLInputElement,
        };

        if (element instanceof HTMLInputElement && (role === 'checkbox' || role === 'radio')) {
          control.checked = element.checked;
        }
        if (role === 'checkbox' && element.getAttribute('aria-checked') !== null) {
          control.checked = element.getAttribute('aria-checked') === 'true';
        }
        controls.push(control);
      }

      const counts = new Map<string, number>();
      return controls.slice(0, 80).map((control, index) => {
        const key = JSON.stringify([control.role, control.name]);
        const occurrence = counts.get(key) ?? 0;
        counts.set(key, occurrence + 1);
        return { ...control, id: 'control-' + index, occurrence };
      });
    }),
  ]);

  return pageObservationSchema.parse({
    url,
    title,
    text: text.slice(0, 3000),
    controls,
  });
}

export function buildActionChoices(
  observation: PageObservation,
  task: TaskDefinition,
): ActionChoice[] {
  const choices: ActionChoice[] = [];

  for (const control of observation.controls) {
    if (control.disabled) continue;
    const safeName = redactInputValues(control.name, Object.values(task.inputs));

    if (control.role === 'textbox') {
      for (const inputKey of Object.keys(task.inputs)) {
        choices.push({
          id: 'fill:' + control.id + ':' + inputKey,
          description: 'Fill the ' + JSON.stringify(safeName) + ' field with task input ' + JSON.stringify(inputKey) + '.',
          action: { kind: 'fill', targetId: control.id, inputKey },
        });
      }
      if (task.id === 'todomvc-add-complete') {
        choices.push({
          id: 'press-enter:' + control.id,
          description: 'Press Enter in the ' + JSON.stringify(safeName) + ' field.',
          action: { kind: 'press', targetId: control.id, key: 'Enter' },
        });
      }
      continue;
    }

    if (control.role === 'checkbox') {
      const kind = control.checked ? 'uncheck' : 'check';
      choices.push({
        id: kind + ':' + control.id,
        description: (control.checked ? 'Clear' : 'Select') + ' the ' + JSON.stringify(safeName) + ' checkbox.',
        action: { kind, targetId: control.id },
      });
      continue;
    }

    if (control.role === 'button' || control.role === 'link' || control.role === 'radio') {
      choices.push({
        id: 'click:' + control.id,
        description: 'Click the ' + control.role + ' named ' + JSON.stringify(safeName) + '.',
        action: { kind: 'click', targetId: control.id },
      });
    }
  }

  choices.push({
    id: 'finish',
    description: 'Finish if the requested task is complete.',
    action: { kind: 'finish' },
  });

  return choices;
}

export async function performBrowserAction(
  page: Page,
  observation: PageObservation,
  task: TaskDefinition,
  action: BrowserAction,
): Promise<void> {
  if (action.kind === 'finish') return;

  const control = observation.controls.find((candidate) => candidate.id === action.targetId);
  if (!control) throw new Error('The selected browser action target is no longer available.');

  const locator = page.getByRole(control.role, {
    name: control.name,
    exact: true,
  }).nth(control.occurrence);

  switch (action.kind) {
    case 'click':
      await locator.click();
      return;
    case 'fill': {
      const value = task.inputs[action.inputKey];
      if (value === undefined) throw new Error('The selected task input is unavailable.');
      await locator.fill(value);
      return;
    }
    case 'press':
      await locator.press(action.key);
      return;
    case 'check':
      if (control.nativeInput === true) {
        await locator.check();
      } else {
        await locator.click();
      }
      return;
    case 'uncheck':
      if (control.nativeInput === true) {
        await locator.uncheck();
      } else {
        await locator.click();
      }
      return;
    default: {
      const exhaustive: never = action;
      throw new Error('Unsupported browser action: ' + JSON.stringify(exhaustive));
    }
  }
}

export function safeTaskContext(task: TaskDefinition): {
  id: TaskDefinition['id'];
  site: TaskDefinition['site'];
  instruction: string;
  inputKeys: string[];
} {
  return {
    id: task.id,
    site: task.site,
    instruction: redactInputValues(task.instruction, Object.values(task.inputs)),
    inputKeys: Object.keys(task.inputs),
  };
}

export function redactInputValues(text: string, inputValues: string[]): string {
  return inputValues.reduce((result, value) => (
    value.length === 0 ? result : result.split(value).join('[task input]')
  ), text);
}
