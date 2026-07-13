import assert from 'node:assert/strict';
import {
  isCurrentDiscoveryRequest,
  llmDraftForProviderChange,
} from '../components/onboarding/providerState.ts';

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
assert.equal(isCurrentDiscoveryRequest(2, 2), true);
assert.equal(isCurrentDiscoveryRequest(1, 2), false);
console.log('✓ onboarding provider state stays scoped and current');
