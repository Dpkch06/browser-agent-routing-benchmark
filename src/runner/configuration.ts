import * as z from 'zod';
import {
  OpenAICompatibleChoiceProvider,
  TypeSafeChoiceProvider,
  type DecisionProvider,
} from '../strategies/providers.js';

const environmentSchema = z.object({
  TYPESAFE_API_KEY: z.string().trim().min(1),
  JEV_MODEL_ID: z.string().trim().min(1).default('jev-1.14.0'),
  REASONING_API_ENDPOINT: z.string().url().refine((value) => new URL(value).protocol === 'https:'),
  REASONING_API_KEY: z.string().trim().min(1),
  REASONING_MODEL: z.string().trim().min(1),
});
const providerSettingSchema = z.enum([
  'TYPESAFE_API_KEY',
  'JEV_MODEL_ID',
  'REASONING_API_ENDPOINT',
  'REASONING_API_KEY',
  'REASONING_MODEL',
]);

export type ProviderEnvironment = z.infer<typeof environmentSchema>;

export type ProviderConfig = {
  jev: DecisionProvider;
  reasoning: DecisionProvider;
};

export function createProvidersFromEnvironment(
  env: NodeJS.ProcessEnv,
): ProviderConfig {
  const parsed = parseProviderEnvironment(env);

  return {
    jev: new TypeSafeChoiceProvider({
      apiKey: parsed.TYPESAFE_API_KEY,
      modelId: parsed.JEV_MODEL_ID,
    }),
    reasoning: new OpenAICompatibleChoiceProvider({
      endpoint: parsed.REASONING_API_ENDPOINT,
      apiKey: parsed.REASONING_API_KEY,
      modelId: parsed.REASONING_MODEL,
    }),
  };
}

export function parseProviderEnvironment(
  env: NodeJS.ProcessEnv,
): ProviderEnvironment {
  const parsed = environmentSchema.safeParse({
    TYPESAFE_API_KEY: env.TYPESAFE_API_KEY,
    JEV_MODEL_ID: env.JEV_MODEL_ID,
    REASONING_API_ENDPOINT: env.REASONING_API_ENDPOINT,
    REASONING_API_KEY: env.REASONING_API_KEY,
    REASONING_MODEL: env.REASONING_MODEL,
  });

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error('Invalid benchmark configuration. Check: ' + fields.join(', '));
  }

  return parsed.data;
}

export function getProviderConfigurationIssues(env: NodeJS.ProcessEnv): string[] {
  const parsed = environmentSchema.safeParse({
    TYPESAFE_API_KEY: env.TYPESAFE_API_KEY,
    JEV_MODEL_ID: env.JEV_MODEL_ID,
    REASONING_API_ENDPOINT: env.REASONING_API_ENDPOINT,
    REASONING_API_KEY: env.REASONING_API_KEY,
    REASONING_MODEL: env.REASONING_MODEL,
  });
  if (parsed.success) return [];

  return [...new Set(parsed.error.issues
    .map((issue) => issue.path[0])
    .filter((field): field is string => typeof field === 'string')
    .flatMap((field) => {
      const setting = providerSettingSchema.safeParse(field);
      return setting.success ? [setting.data] : [];
    }))];
}
