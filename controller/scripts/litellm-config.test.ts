import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-litellm-'));
const settings = await import('../src/settings.js');

process.env.LITELLM_API_BASE = 'https://env.example/litellm';
await settings.load();
let result = await settings.update({ llm: { provider: 'litellm', model: 'vendor/model', baseUrl: '' } });
assert.equal(result.saved.llm.provider, 'litellm');
result = await settings.update({ llm: { provider: 'litellm', apiKey: 'wizard-token' } });
assert.equal(result.saved.llm.keys.litellm, 'wizard-token');

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
