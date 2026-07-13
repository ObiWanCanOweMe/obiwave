import assert from 'node:assert/strict';
import { llmDraftForProviderChange } from '../components/onboarding/providerState.ts';

const openAiDraft = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'openai-secret',
  baseUrl: '',
  ollamaUrl: 'http://host.docker.internal:11434',
};

assert.deepEqual(
  llmDraftForProviderChange(openAiDraft, 'litellm'),
  { ...openAiDraft, provider: 'litellm', apiKey: '' },
);
assert.deepEqual(llmDraftForProviderChange(openAiDraft, 'openai'), openAiDraft);
console.log('✓ onboarding provider credentials stay provider-scoped');
