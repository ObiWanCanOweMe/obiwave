import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-embedding-provider-'));
process.env.EMBEDDING_API_KEY = 'dedicated-embedding-env-key';

// Simulate a pre-fix settings.json where a compatible-server bearer survived
// after the embedding provider switched to managed OpenAI.
writeFileSync(
  join(process.env.STATE_DIR, 'settings.json'),
  JSON.stringify({
    llm: { provider: 'ollama' },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'stale-compat-embedding-key',
    },
  }),
);

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

await test('restart with blank embeddings and LiteLLM chat pins the embedding leg to Ollama', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'subwave-embedding-restart-'));
  writeFileSync(
    join(stateDir, 'settings.json'),
    JSON.stringify({
      llm: {
        provider: 'litellm',
        model: 'vendor/chat-model',
        providerBaseUrls: { litellm: 'https://litellm-chat.example/v1' },
        baseUrl: 'https://litellm-chat.example/v1',
      },
      embedding: { provider: '', model: '', providerBaseUrls: {}, baseUrl: '' },
    }),
  );
  const settingsUrl = new URL('../src/settings.ts', import.meta.url).href;
  const providerUrl = new URL('../src/llm/provider.ts', import.meta.url).href;
  const source = `
    const settings = await import(${JSON.stringify(settingsUrl)});
    const { resolveEmbeddingCfg } = await import(${JSON.stringify(providerUrl)});
    await settings.load();
    const cfg = resolveEmbeddingCfg();
    console.log(JSON.stringify({
      storedProvider: settings.get().embedding.provider,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
    }));
  `;
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, STATE_DIR: stateDir },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(
    JSON.parse(child.stdout.trim()),
    {
      storedProvider: 'ollama',
      provider: 'ollama',
      baseUrl: '',
    },
  );
});

await test('persisted compatible embedding bearer cannot mask the dedicated env key', async () => {
  assert.equal(settings.get().embedding.apiKey, '');
  assert.deepEqual(connection(), {
    provider: 'openai',
    model: 'text-embedding-3-small',
    baseUrl: '',
    apiKey: 'dedicated-embedding-env-key',
  });
  delete process.env.EMBEDDING_API_KEY;
});

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

await test('switching away from openai-compatible never reuses its embedding bearer', async () => {
  await settings.update({
    llm: {
      provider: 'locca',
      model: 'locca-chat-model',
      apiKey: 'locca-provider-key',
    },
    embedding: {
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      providerBaseUrls: { 'openai-compatible': 'https://compat-embed.example/v1' },
      apiKey: 'compat-embedding-key',
    },
  });
  assert.equal(connection().apiKey, 'compat-embedding-key');

  process.env.OPENAI_API_KEY = 'managed-openai-provider-key';
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'managed-google-provider-key';
  process.env.OPENROUTER_API_KEY = 'managed-openrouter-provider-key';

  const resolved: Record<string, string> = {};
  for (const provider of ['locca', 'openai', 'google', 'openrouter']) {
    await settings.update({ embedding: { provider, model: '' } });
    resolved[provider] = connection().apiKey;
  }

  assert.deepEqual(resolved, {
    locca: 'locca-provider-key',
    // Empty here is intentional: each managed AI SDK reads its own normal env
    // credential when no dedicated EMBEDDING_API_KEY override is supplied.
    openai: '',
    google: '',
    openrouter: '',
  });
  assert.equal(settings.get().embedding.apiKey, '');

  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

await test('dedicated embedding env key wins after switching away from compatible', async () => {
  await settings.update({
    embedding: {
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      apiKey: 'compat-embedding-key',
    },
  });
  process.env.EMBEDDING_API_KEY = 'dedicated-embedding-env-key';
  await settings.update({ embedding: { provider: 'google', model: 'text-embedding-004' } });

  assert.equal(connection().apiKey, 'dedicated-embedding-env-key');
  assert.equal(settings.get().embedding.apiKey, '');
  delete process.env.EMBEDDING_API_KEY;
});

if (failures) process.exit(1);
