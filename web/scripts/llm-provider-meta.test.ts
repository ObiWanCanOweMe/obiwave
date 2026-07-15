import assert from 'node:assert/strict';
import { PROVIDER_META, PROVIDER_IDS, LLM_PROVIDER_LABELS, providerStatus } from '../components/admin/llm/providerMeta.ts';

assert.equal(PROVIDER_IDS.includes('litellm'), true);
assert.equal(PROVIDER_META.litellm.label, 'LiteLLM');
assert.equal(PROVIDER_META.litellm.kind, 'cloud');
assert.equal(LLM_PROVIDER_LABELS.litellm, 'LiteLLM (custom cloud gateway)');
assert.deepEqual(providerStatus('litellm', { LITELLM_API_KEY: true }, true), { label: 'key set', tone: 'ok' });
assert.deepEqual(providerStatus('litellm', { OPENAI_API_KEY: true }, true), { label: 'key set', tone: 'ok' });
assert.deepEqual(providerStatus('litellm', {}, true), { label: 'key optional', tone: 'ok' });
console.log('✓ LiteLLM provider metadata');
