import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-litellm-'));
const legacyStateDir = mkdtempSync(join(tmpdir(), 'subwave-litellm-legacy-'));
writeFileSync(
  join(legacyStateDir, 'settings.json'),
  JSON.stringify({
    llm: {
      provider: 'litellm',
      model: 'vendor/model',
      baseUrl: 'https://stored.example/litellm',
      apiKey: 'legacy-litellm-token',
    },
    embedding: { provider: '', model: '' },
  }),
);
const settingsUrl = new URL('../src/settings.ts', import.meta.url).href;
const providerUrl = new URL('../src/llm/provider.ts', import.meta.url).href;
const legacySource = `
  const settings = await import(${JSON.stringify(settingsUrl)});
  const { resolveEmbeddingCfg } = await import(${JSON.stringify(providerUrl)});
  await settings.load();
  const embedding = resolveEmbeddingCfg();
  console.log(JSON.stringify({
    litellmKey: settings.llmKeyFor('litellm'),
    compatibleKey: settings.llmKeyFor('openai-compatible'),
    embeddingProvider: embedding.provider,
    embeddingBaseUrl: embedding.baseUrl,
  }));
`;
const legacyChild = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', legacySource],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, STATE_DIR: legacyStateDir },
  },
);
assert.equal(legacyChild.status, 0, legacyChild.stderr);
assert.deepEqual(
  JSON.parse(legacyChild.stdout.trim()),
  {
    litellmKey: 'legacy-litellm-token',
    compatibleKey: '',
    embeddingProvider: 'ollama',
    embeddingBaseUrl: '',
  },
  'restart migrates the legacy LiteLLM key to its owner and pins blank embeddings to Ollama',
);

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
await settings.update({ embedding: { provider: '', model: '' } });
const embeddingOnlyClear = {
  provider: resolveEmbeddingCfg().provider,
  model: resolveEmbeddingCfg().model,
};
await settings.update({ embedding: { provider: 'ollama', model: 'nomic-embed-text' } });
await settings.update({
  llm: { provider: 'litellm', model: 'vendor/model', baseUrl: '' },
  embedding: { provider: '', model: '' },
});
const combinedClear = {
  provider: resolveEmbeddingCfg().provider,
  model: resolveEmbeddingCfg().model,
};
assert.deepEqual(
  { embeddingOnlyClear, combinedClear },
  {
    embeddingOnlyClear: { provider: 'ollama', model: 'nomic-embed-text' },
    combinedClear: { provider: 'ollama', model: 'nomic-embed-text' },
  },
  'LiteLLM stays chat-only after embedding-only and combined clear patches',
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
