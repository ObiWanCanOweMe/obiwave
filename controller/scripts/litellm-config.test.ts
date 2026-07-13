import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-litellm-'));
const settings = await import('../src/settings.js');
const { resolveEmbeddingCfg } = await import('../src/llm/provider.js');

process.env.LITELLM_API_BASE = 'https://env.example/litellm';
await settings.load();
let result = await settings.update({ llm: { provider: 'litellm', model: 'vendor/model', baseUrl: '' } });
assert.equal(result.saved.llm.provider, 'litellm');
assert.deepEqual(
  { provider: resolveEmbeddingCfg().provider, model: resolveEmbeddingCfg().model },
  { provider: 'ollama', model: 'nomic-embed-text' },
  'saving a chat-only LiteLLM provider from defaults pins effective embeddings to Ollama',
);
result = await settings.update({ llm: { provider: 'litellm', apiKey: 'wizard-token' } });
assert.equal(result.saved.llm.keys.litellm, 'wizard-token');
const publicUpdateResult = (settings as any).publicUpdateResult;
assert.equal(typeof publicUpdateResult, 'function', 'settings updates need a public response serializer');
assert.deepEqual(publicUpdateResult(result), { requiresRestart: result.requiresRestart });
assert.equal(JSON.stringify(publicUpdateResult(result)).includes('wizard-token'), false);

delete process.env.LITELLM_API_BASE;
delete process.env.OPENAI_API_BASE;
await assert.rejects(
  () => settings.update({ llm: { provider: 'litellm', model: 'vendor/model', baseUrl: '' } }),
  /LiteLLM base URL is required/,
);

process.env.LITELLM_API_BASE = 'https://env.example/litellm';
await assert.rejects(
  () => settings.update({ llm: { provider: 'litellm', model: '', baseUrl: '' } }),
  /LiteLLM model is required/,
);

console.log('✓ LiteLLM settings accept env URL and reject a missing effective URL');
