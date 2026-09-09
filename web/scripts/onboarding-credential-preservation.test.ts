import assert from 'node:assert/strict';
import test from 'node:test';
import { llmForSubmission } from '../components/onboarding/providerState.ts';

for (const provider of ['litellm', 'openai-compatible']) {
  for (const apiKey of ['', '   ']) {
    test(`${provider} onboarding omits an untouched blank credential`, () => {
      const payload = llmForSubmission({
        provider, apiKey, model: 'test-model', baseUrl: 'https://llm.example/v1', ollamaUrl: '',
      });
      assert.equal(Object.hasOwn(payload, 'apiKey'), false);
      assert.equal(payload.provider, provider);
      assert.equal(payload.model, 'test-model');
      assert.equal(payload.baseUrl, 'https://llm.example/v1');
    });
  }
  test(`${provider} onboarding submits an explicitly entered credential`, () => {
    const payload = llmForSubmission({
      provider, apiKey: 'new-test-key', model: 'test-model', baseUrl: 'https://llm.example/v1', ollamaUrl: '',
    });
    assert.equal(payload.apiKey, 'new-test-key');
  });
}
