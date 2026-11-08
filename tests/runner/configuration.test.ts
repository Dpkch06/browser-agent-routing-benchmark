import { describe, expect, it } from 'vitest';
import { parseProviderEnvironment } from '../../src/runner/configuration.js';

describe('parseProviderEnvironment', () => {
  it('pins a Jev model by default and accepts explicit reasoning settings', () => {
    const config = parseProviderEnvironment({
      TYPESAFE_API_KEY: 'test-jev-key',
      REASONING_API_ENDPOINT: 'https://models.example/v1/chat/completions',
      REASONING_API_KEY: 'test-reasoning-key',
      REASONING_MODEL: 'reasoning-test-model',
    });

    expect(config.JEV_MODEL_ID).toBe('jev-1.14.0');
    expect(config.REASONING_MODEL).toBe('reasoning-test-model');
  });

  it('fails before provider creation and names missing settings without echoing values', () => {
    const missingConfig = () => parseProviderEnvironment({
      TYPESAFE_API_KEY: 'never-print-this-key',
    });
    let message = '';
    try {
      missingConfig();
    } catch (error) {
      if (error instanceof Error) message = error.message;
    }
    expect(message).toMatch(/REASONING_API_ENDPOINT/);
    expect(message).toMatch(/REASONING_API_KEY/);
    expect(message).toMatch(/REASONING_MODEL/);
    expect(message).not.toContain('never-print-this-key');
  });

  it('rejects non-HTTPS reasoning endpoints', () => {
    expect(() => parseProviderEnvironment({
      TYPESAFE_API_KEY: 'test-jev-key',
      REASONING_API_ENDPOINT: 'http://models.example/v1/chat/completions',
      REASONING_API_KEY: 'test-reasoning-key',
      REASONING_MODEL: 'reasoning-test-model',
    })).toThrow(/REASONING_API_ENDPOINT/);
  });
});
