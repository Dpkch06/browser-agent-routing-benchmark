import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAICompatibleChoiceProvider,
  TypeSafeChoiceProvider,
  type DecisionRequest,
} from '../../src/strategies/providers.js';

const request: DecisionRequest = {
  stage: 'router',
  question: 'Choose the direct strategy for this task.',
  state: JSON.stringify({ taskId: 'todomvc-add-complete' }),
  options: [
    { id: 'deterministic-playwright', description: 'Use the fixed browser workflow.' },
    { id: 'jev-guided-playwright', description: 'Ask Jev to select browser actions.' },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TypeSafeChoiceProvider', () => {
  it('sets a 15-second abort timeout on the provider request', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const provider = new TypeSafeChoiceProvider({
      apiKey: 'test-key',
      modelId: 'jev-1.14.0',
      fetchFn: async (_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(JSON.stringify({
          model: 'jev-1.14.0',
          answers: { selection: { type: 'choice', choice: 'deterministic-playwright' } },
          usage: { input_tokens: 28, output_tokens: 4 },
        }), { status: 200 });
      },
    });

    await provider.choose(request);

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it('parses a typed Choice answer and usage metadata', async () => {
    const provider = new TypeSafeChoiceProvider({
      apiKey: 'test-key',
      modelId: 'jev-1.14.0',
      fetchFn: async () => new Response(JSON.stringify({
        model: 'jev-1.14.0',
        answers: { selection: { type: 'choice', choice: 'deterministic-playwright' } },
        usage: { input_tokens: 28, output_tokens: 4 },
      }), { status: 200 }),
    });

    const result = await provider.choose(request);
    expect(result.choiceId).toBe('deterministic-playwright');
    expect(result.models).toEqual([{ stage: 'router', provider: 'TypeSafe', modelId: 'jev', version: 'jev-1.14.0' }]);
    expect(result.usage).toEqual({ modelCalls: 1, inputTokens: 28, outputTokens: 4 });
  });

  it('marks token usage partial when a successful response omits counters', async () => {
    const provider = new TypeSafeChoiceProvider({
      apiKey: 'test-key',
      modelId: 'jev-1.14.0',
      fetchFn: async () => new Response(JSON.stringify({
        model: 'jev-1.14.0',
        answers: { selection: { type: 'choice', choice: 'deterministic-playwright' } },
        usage: { input_tokens: 28 },
      }), { status: 200 }),
    });

    const result = await provider.choose(request);

    expect(result.usage).toEqual({
      modelCalls: 1,
      inputTokens: 28,
      usagePartial: true,
    });
  });

  it('rejects a response that selects an option outside the offered set', async () => {
    const provider = new TypeSafeChoiceProvider({
      apiKey: 'test-key',
      modelId: 'jev-1.14.0',
      fetchFn: async () => new Response(JSON.stringify({
        model: 'jev-1.14.0',
        answers: { selection: { type: 'choice', choice: 'delete-everything' } },
      }), { status: 200 }),
    });

    await expect(provider.choose(request)).rejects.toThrow(/offered choices/i);
  });
});

describe('OpenAICompatibleChoiceProvider', () => {
  it('sets a 15-second abort timeout on the provider request', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const provider = new OpenAICompatibleChoiceProvider({
      endpoint: 'https://model.example/v1/chat/completions',
      apiKey: 'test-key',
      modelId: 'reasoning-model-test',
      fetchFn: async (_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(JSON.stringify({
          model: 'reasoning-model-test',
          choices: [{ message: { content: JSON.stringify({ choiceId: 'jev-guided-playwright' }) } }],
          usage: { prompt_tokens: 90, completion_tokens: 12 },
        }), { status: 200 });
      },
    });

    await provider.choose(request);

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it('parses a JSON choice and standard chat usage fields', async () => {
    const provider = new OpenAICompatibleChoiceProvider({
      endpoint: 'https://model.example/v1/chat/completions',
      apiKey: 'test-key',
      modelId: 'reasoning-model-test',
      fetchFn: async () => new Response(JSON.stringify({
        model: 'reasoning-model-test-2026-11',
        choices: [{ message: { content: JSON.stringify({ choiceId: 'jev-guided-playwright' }) } }],
        usage: { prompt_tokens: 90, completion_tokens: 12 },
      }), { status: 200 }),
    });

    const result = await provider.choose(request);
    expect(result.choiceId).toBe('jev-guided-playwright');
    expect(result.models).toEqual([{
      stage: 'router',
      provider: 'openai-compatible',
      modelId: 'reasoning-model-test',
      version: 'reasoning-model-test-2026-11',
    }]);
    expect(result.usage).toEqual({ modelCalls: 1, inputTokens: 90, outputTokens: 12 });
  });

  it('does not return API response bodies in provider errors', async () => {
    const provider = new OpenAICompatibleChoiceProvider({
      endpoint: 'https://model.example/v1/chat/completions',
      apiKey: 'private-key',
      modelId: 'reasoning-model-test',
      fetchFn: async () => new Response('private provider detail', { status: 429 }),
    });

    await expect(provider.choose(request)).rejects.toThrow(/HTTP 429/);
    await expect(provider.choose(request)).rejects.not.toThrow(/private provider detail|private-key/);
  });
});
