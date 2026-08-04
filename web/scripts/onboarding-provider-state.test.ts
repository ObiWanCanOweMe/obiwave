import assert from 'node:assert/strict';
import * as providerState from '../components/onboarding/providerState.ts';

const {
  isCurrentDiscoveryRequest,
  llmDraftForProviderChange,
} = providerState;

const compatible = {
  provider: 'openai-compatible',
  model: 'local-model',
  apiKey: 'compatible-secret',
  baseUrl: 'https://compatible.example/v1',
  ollamaUrl: 'http://host.docker.internal:11434',
};

const toLiteLlm = llmDraftForProviderChange(compatible, 'litellm', {});
assert.deepEqual(toLiteLlm, {
  llm: {
    provider: 'litellm',
    model: '',
    apiKey: '',
    baseUrl: '',
    ollamaUrl: '',
  },
  drafts: {
    'openai-compatible': {
      model: 'local-model',
      apiKey: 'compatible-secret',
      baseUrl: 'https://compatible.example/v1',
      ollamaUrl: 'http://host.docker.internal:11434',
    },
  },
});

const editedLiteLlm = {
  ...toLiteLlm.llm,
  model: 'anthropic/claude-sonnet',
  apiKey: 'litellm-secret',
  baseUrl: 'https://litellm.example/v1',
};
const backToCompatible = llmDraftForProviderChange(
  editedLiteLlm,
  'openai-compatible',
  toLiteLlm.drafts,
);
assert.deepEqual(backToCompatible.llm, compatible);

const backToLiteLlm = llmDraftForProviderChange(
  backToCompatible.llm,
  'litellm',
  backToCompatible.drafts,
);
assert.deepEqual(backToLiteLlm.llm, editedLiteLlm);

const llmForSubmission = (providerState as typeof providerState & {
  llmForSubmission?: (llm: typeof compatible) => Record<string, string>;
}).llmForSubmission;
assert.equal(typeof llmForSubmission, 'function');
assert.deepEqual(llmForSubmission?.(backToCompatible.llm), {
  provider: 'openai-compatible',
  model: 'local-model',
  apiKey: 'compatible-secret',
  baseUrl: 'https://compatible.example/v1',
});
assert.deepEqual(llmForSubmission?.(backToLiteLlm.llm), {
  provider: 'litellm',
  model: 'anthropic/claude-sonnet',
  apiKey: 'litellm-secret',
  baseUrl: 'https://litellm.example/v1',
});

let activeDraft = backToLiteLlm.llm;
const compatibleRequestGeneration = 1;
const activeGeneration = 2;
if (isCurrentDiscoveryRequest(compatibleRequestGeneration, activeGeneration)) {
  activeDraft = { ...activeDraft, model: 'stale-compatible-model' };
}
assert.equal(activeDraft.model, 'anthropic/claude-sonnet');
assert.equal(isCurrentDiscoveryRequest(activeGeneration, activeGeneration), true);

console.log('onboarding-provider-state.test.ts: provider drafts, serialization, and discovery ownership stay isolated');
