import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-embedding-provider-'));
delete process.env.EMBEDDING_API_KEY;

const settings = await import('../src/settings.js');
const { resolveEmbeddingCfg } = await import('../src/llm/provider.js');
const { embeddingBaseUrl } = await import('../src/llm/internal/provider/embedding.js');
const { DEFAULT_LOCCA_EMBED_BASE_URL } = await import('../src/llm/internal/provider/registry.js');

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

await test('blank Locca embeddings use the Locca default, never the LiteLLM chat URL', async () => {
  await settings.update({
    llm: {
      provider: 'litellm',
      model: 'vendor/chat-model',
      providerBaseUrls: {
        litellm: 'https://litellm-chat.example/v1',
        locca: '',
      },
      apiKey: 'litellm-key',
    },
    embedding: {
      provider: 'locca',
      model: 'nomic-embed-text',
      providerBaseUrls: { locca: '' },
      baseUrl: '',
    },
  });
  const cfg = resolveEmbeddingCfg();
  assert.equal(cfg.provider, 'locca');
  assert.equal(cfg.baseUrl, '', 'a different chat provider URL must not enter the embedding config');
  assert.equal(embeddingBaseUrl(cfg), DEFAULT_LOCCA_EMBED_BASE_URL);
});

await test('blank Locca embeddings never inherit a custom Locca chat URL', async () => {
  const result = await settings.update({
    llm: {
      provider: 'locca',
      model: 'locca-chat-model',
      providerBaseUrls: { locca: 'https://custom-locca-chat.example/v1' },
      apiKey: 'locca-key',
    },
    embedding: {
      provider: 'locca',
      model: 'nomic-embed-text',
      providerBaseUrls: { locca: '' },
      baseUrl: '',
    },
  });
  const persisted = JSON.parse(
    readFileSync(join(process.env.STATE_DIR!, 'settings.json'), 'utf8'),
  );
  const cfg = resolveEmbeddingCfg();
  assert.deepEqual(
    {
      savedBaseUrl: result.saved.embedding.baseUrl,
      storedBaseUrl: persisted.embedding.baseUrl,
      resolvedBaseUrl: cfg.baseUrl,
      effectiveBaseUrl: embeddingBaseUrl(cfg),
    },
    {
      savedBaseUrl: '',
      storedBaseUrl: '',
      resolvedBaseUrl: '',
      effectiveBaseUrl: DEFAULT_LOCCA_EMBED_BASE_URL,
    },
  );
});

if (failures) process.exit(1);
