import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-embedding-provider-'));
delete process.env.EMBEDDING_API_KEY;

const settings = await import('../src/settings.js');
const { resolveEmbeddingCfg } = await import('../src/llm/provider.js');

function connection() {
  const { provider, model, baseUrl, apiKey } = resolveEmbeddingCfg();
  return { provider, model, baseUrl, apiKey };
}

let failures = 0;
async function test(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

await settings.load();

await test('switching to chat-only LiteLLM retains the inherited embedding connection', async () => {
  await settings.update({
    llm: {
      provider: 'openai-compatible',
      model: 'chat-model',
      providerBaseUrls: {
        'openai-compatible': 'https://compat-chat.example/v1',
        litellm: 'https://litellm-chat.example/v1',
      },
      apiKey: 'compat-key',
    },
    embedding: { provider: '', model: '' },
  });
  await settings.update({
    llm: {
      provider: 'litellm',
      model: 'vendor/chat-model',
      apiKey: 'litellm-key',
    },
  });
  assert.deepEqual(connection(), {
    provider: 'openai-compatible',
    model: 'text-embedding-3-small',
    baseUrl: 'https://compat-chat.example/v1',
    apiKey: 'compat-key',
  });
});

await test('an explicit embedding provider never receives the chat credential', async () => {
  await settings.update({
    llm: {
      provider: 'locca',
      model: 'locca-chat-model',
      providerBaseUrls: { locca: 'https://locca-chat.example/v1' },
      apiKey: 'locca-key',
    },
  });
  await settings.update({
    llm: {
      provider: 'openai-compatible',
      model: 'chat-model',
      apiKey: 'compat-key',
    },
    embedding: {
      provider: 'locca',
      model: 'nomic-embed-text',
      providerBaseUrls: { locca: 'https://locca-embed.example/v1' },
    },
  });
  assert.deepEqual(connection(), {
    provider: 'locca',
    model: 'nomic-embed-text',
    baseUrl: 'https://locca-embed.example/v1',
    apiKey: 'locca-key',
  });
});

await test('an explicit embedding provider inherits its same-provider LLM connection', async () => {
  await settings.update({
    llm: { provider: 'ollama', model: '' },
    embedding: {
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
    },
  });
  assert.deepEqual(connection(), {
    provider: 'openai-compatible',
    model: 'text-embedding-3-small',
    baseUrl: 'https://compat-chat.example/v1',
    apiKey: 'compat-key',
  });
});

if (failures) process.exit(1);
