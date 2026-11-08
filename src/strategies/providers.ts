import * as z from 'zod';
import type { ModelMetadata } from '../domain/schema.js';

const PROVIDER_TIMEOUT_MS = 15_000;

export const decisionOptionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const decisionRequestSchema = z.object({
  stage: z.enum(['router', 'executor']),
  question: z.string().min(1),
  state: z.string().min(1),
  options: z.array(decisionOptionSchema).min(1),
}).strict();

export const providerUsageSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().finite().optional(),
  usagePartial: z.boolean().optional(),
}).strict();

export const decisionResponseSchema = z.object({
  choiceId: z.string().min(1),
  usage: providerUsageSchema,
  models: z.array(z.object({
    stage: z.enum(['router', 'executor']),
    provider: z.string().min(1),
    modelId: z.string().min(1),
    version: z.string().min(1).optional(),
  }).strict()),
}).strict();

export type DecisionOption = z.infer<typeof decisionOptionSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;

export interface DecisionProvider {
  choose(request: DecisionRequest): Promise<DecisionResponse>;
}

const typeSafeResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.object({
    type: z.literal('choice'),
    choice: z.string().min(1),
  }).passthrough()),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

export type TypeSafeProviderConfig = {
  apiKey: string;
  modelId: string;
};

export class TypeSafeChoiceProvider implements DecisionProvider {
  readonly #apiKey: string;
  readonly #modelId: string;
  readonly #fetchFn: typeof fetch;

  constructor(config: TypeSafeProviderConfig & { fetchFn?: typeof fetch }) {
    if (!config.apiKey.trim()) throw new Error('TYPESAFE_API_KEY is required.');
    if (!config.modelId.trim()) throw new Error('Jev model ID is required.');
    this.#apiKey = config.apiKey;
    this.#modelId = config.modelId;
    this.#fetchFn = config.fetchFn ?? fetch;
  }

  async choose(requestInput: DecisionRequest): Promise<DecisionResponse> {
    const request = decisionRequestSchema.parse(requestInput);
    const criteria = Object.fromEntries(
      request.options.map((option) => [option.id, option.description]),
    );
    const response = await this.#fetchFn('https://api.typesafe.ai/v1/systemone', {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.#apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.#modelId,
        state: request.state,
        questions: {
          selection: {
            type: 'choice',
            instructions: request.question,
            criteria,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error('TypeSafe provider returned HTTP ' + response.status + '.');
    }

    const payload: unknown = await response.json();
    const parsed = typeSafeResponseSchema.parse(payload);
    const selection = parsed.answers.selection;
    if (!selection) throw new Error('TypeSafe provider omitted its selection answer.');
    assertOfferedChoice(selection.choice, request.options);

    const inputTokens = parsed.usage?.input_tokens;
    const outputTokens = parsed.usage?.output_tokens;
    return decisionResponseSchema.parse({
      choiceId: selection.choice,
      usage: {
        modelCalls: 1,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(inputTokens === undefined || outputTokens === undefined ? { usagePartial: true } : {}),
      },
      models: [{
        stage: request.stage,
        provider: 'TypeSafe',
        modelId: 'jev',
        version: parsed.model,
      }],
    });
  }
}

const openAICompatibleResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
    }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    cost_usd: z.number().nonnegative().finite().optional(),
  }).passthrough().optional(),
}).passthrough();

const choiceOutputSchema = z.object({
  choiceId: z.string().min(1),
}).strict();

export type OpenAICompatibleProviderConfig = {
  endpoint: string;
  apiKey: string;
  modelId: string;
};

export class OpenAICompatibleChoiceProvider implements DecisionProvider {
  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #modelId: string;
  readonly #fetchFn: typeof fetch;

  constructor(config: OpenAICompatibleProviderConfig & { fetchFn?: typeof fetch }) {
    let endpoint: URL;
    try {
      endpoint = new URL(config.endpoint);
    } catch {
      throw new Error('REASONING_API_ENDPOINT must be a valid HTTPS URL.');
    }
    if (endpoint.protocol !== 'https:') {
      throw new Error('REASONING_API_ENDPOINT must use HTTPS.');
    }
    if (!config.apiKey.trim()) throw new Error('REASONING_API_KEY is required.');
    if (!config.modelId.trim()) throw new Error('REASONING_MODEL is required.');

    this.#endpoint = endpoint.toString();
    this.#apiKey = config.apiKey;
    this.#modelId = config.modelId;
    this.#fetchFn = config.fetchFn ?? fetch;
  }

  async choose(requestInput: DecisionRequest): Promise<DecisionResponse> {
    const request = decisionRequestSchema.parse(requestInput);
    const response = await this.#fetchFn(this.#endpoint, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.#apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.#modelId,
        messages: [
          {
            role: 'system',
            content: 'Choose one offered ID. Do not invent controls or values. Return only a JSON object with one string field named choiceId.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              question: request.question,
              state: request.state,
              options: request.options,
            }),
          },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 96,
      }),
    });

    if (!response.ok) {
      throw new Error('Reasoning provider returned HTTP ' + response.status + '.');
    }

    const payload: unknown = await response.json();
    const parsed = openAICompatibleResponseSchema.parse(payload);
    const content = parsed.choices[0]?.message.content;
    if (!content) throw new Error('Reasoning provider returned no choice content.');

    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new Error('Reasoning provider returned invalid JSON.');
    }
    const choice = choiceOutputSchema.parse(output);
    assertOfferedChoice(choice.choiceId, request.options);

    const inputTokens = parsed.usage?.prompt_tokens;
    const outputTokens = parsed.usage?.completion_tokens;
    const costUsd = parsed.usage?.cost_usd;
    const modelVersion = parsed.model;
    const model: ModelMetadata = {
      stage: request.stage,
      provider: 'openai-compatible',
      modelId: this.#modelId,
      ...(modelVersion === undefined ? {} : { version: modelVersion }),
    };

    return decisionResponseSchema.parse({
      choiceId: choice.choiceId,
      usage: {
        modelCalls: 1,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(inputTokens === undefined || outputTokens === undefined ? { usagePartial: true } : {}),
      },
      models: [model],
    });
  }
}

function assertOfferedChoice(choiceId: string, options: readonly DecisionOption[]): void {
  if (!options.some((option) => option.id === choiceId)) {
    throw new Error('Provider selected an ID outside the offered choices.');
  }
}
