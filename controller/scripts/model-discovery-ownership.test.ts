import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-model-discovery-'));
process.env.ADMIN_USER = 'route-admin';
process.env.ADMIN_PASS = 'route-password';
delete process.env.EMBEDDING_API_KEY;

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string;
}

async function recordingProvider() {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method || '',
      url: req.url || '',
      authorization: String(req.headers.authorization || ''),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url?.endsWith('/embeddings')
      ? { data: [{ embedding: [0.1, 0.2], index: 0 }] }
      : {
          data: [
            { id: 'chat-model' },
            { id: 'text-embedding-model' },
            { id: 'studio-tts-voice' },
          ],
        }));
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

const chat = await recordingProvider();
const embedding = await recordingProvider();
const tts = await recordingProvider();
const unsaved = await recordingProvider();
let routeServer: http.Server | null = null;

try {
  const settings = await import('../src/settings.js');
  const { router } = await import('../src/routes/settings.js');
  const { discoverModels } = await import('../src/routes/settings/model-discovery.js');
  await settings.load();
  await settings.update({
    llm: {
      provider: 'openai-compatible',
      model: 'chat-model',
      baseUrl: chat.baseUrl,
      apiKey: 'chat-owner-token',
    },
    embedding: {
      provider: 'openai-compatible',
      model: 'text-embedding-model',
      baseUrl: embedding.baseUrl,
      apiKey: 'embedding-owner-token',
    },
    tts: {
      defaultEngine: 'cloud',
      cloud: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'studio-tts-voice',
        voice: 'default',
        baseUrl: tts.baseUrl,
        apiKey: 'tts-owner-token',
      },
    },
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), 'https://api.elevenlabs.io/v1/models');
      assert.equal(new Headers(init?.headers).get('xi-api-key'), 'eleven-unsaved-token');
      return new Response(JSON.stringify([
        { model_id: 'eleven_flash_v2_5', can_do_text_to_speech: true },
        { model_id: 'eleven_multilingual_v2', can_do_text_to_speech: true },
        { model_id: 'speech_to_speech_only', can_do_text_to_speech: false },
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    assert.deepEqual(
      (await discoverModels({
        owner: 'tts',
        provider: 'elevenlabs',
        apiKey: 'eleven-unsaved-token',
      })).models,
      ['eleven_flash_v2_5', 'eleven_multilingual_v2'],
      'regression: ElevenLabs TTS model IDs must not be discarded by a generic name heuristic',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const app = express();
  app.use(express.json());
  app.use(router);
  routeServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    routeServer!.once('listening', resolve);
    routeServer!.once('error', reject);
  });
  const address = routeServer.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const adminAuthorization = `Basic ${Buffer.from('route-admin:route-password').toString('base64')}`;
  const discover = (body: Record<string, unknown>) => fetch(`${origin}/settings/llm/models`, {
    method: 'POST',
    headers: {
      authorization: adminAuthorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const discoverVoices = (body: Record<string, unknown>) => fetch(`${origin}/settings/tts/voices`, {
    method: 'POST',
    headers: {
      authorization: adminAuthorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const probeEmbedding = (body: Record<string, unknown>) => fetch(`${origin}/settings/embedding/probe`, {
    method: 'POST',
    headers: {
      authorization: adminAuthorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const legacyGet = await fetch(
    `${origin}/settings/llm/models?provider=openai-compatible&baseUrl=${encodeURIComponent(unsaved.baseUrl)}`,
    { headers: { authorization: adminAuthorization } },
  );
  assert.equal(legacyGet.status, 405, 'query-based discovery must stay disabled');

  const directDiscoveryRequestCount = unsaved.requests.length;
  const legacyDirectGet = await fetch(
    `${origin}/settings/llm/discover?baseUrl=${encodeURIComponent(unsaved.baseUrl)}`,
    { headers: { authorization: adminAuthorization } },
  );
  assert.equal(
    unsaved.requests.length,
    directDiscoveryRequestCount,
    'legacy direct discovery GET must not contact an unsaved origin',
  );
  assert.equal(legacyDirectGet.status, 405);
  const directDiscovery = await fetch(`${origin}/settings/llm/discover`, {
    method: 'POST',
    headers: {
      authorization: adminAuthorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ baseUrl: unsaved.baseUrl }),
  });
  assert.equal((await directDiscovery.json() as { reachable: boolean }).reachable, true);
  assert.deepEqual(unsaved.requests.at(-1), {
    method: 'GET',
    url: '/v1/models',
    authorization: '',
  });

  const cases = [
    { owner: 'chat', leg: 'primary', server: chat, token: 'chat-owner-token', expected: ['chat-model'] },
    { owner: 'embedding', server: embedding, token: 'embedding-owner-token', expected: ['text-embedding-model'] },
    { owner: 'tts', server: tts, token: 'tts-owner-token', expected: ['studio-tts-voice'] },
  ] as const;

  for (const fixture of cases) {
    const response = await discover({
      owner: fixture.owner,
      provider: 'openai-compatible',
      ...('leg' in fixture ? { leg: fixture.leg } : {}),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; models: string[] };
    assert.equal(body.ok, true);
    assert.deepEqual(body.models, fixture.expected);
    assert.deepEqual(fixture.server.requests.at(-1), {
      method: 'GET',
      url: '/v1/models',
      authorization: `Bearer ${fixture.token}`,
    });
  }

  await settings.update({
    llm: {
      provider: 'ollama',
      model: 'local-chat-model',
    },
  });
  const switchedBackChat = await discover({
    owner: 'chat',
    provider: 'openai-compatible',
    leg: 'primary',
    baseUrl: chat.baseUrl,
  });
  assert.equal((await switchedBackChat.json() as { ok: boolean }).ok, true);
  assert.deepEqual(chat.requests.at(-1), {
    method: 'GET',
    url: '/v1/models',
    authorization: 'Bearer chat-owner-token',
  }, 'regression: exact saved-origin discovery must mirror runtime after switching back providers');

  await settings.update({
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
    },
  });
  process.env.EMBEDDING_API_KEY = 'dedicated-switch-token';
  const switchedEmbedding = await discover({
    owner: 'embedding',
    provider: 'openai-compatible',
    baseUrl: embedding.baseUrl,
  });
  delete process.env.EMBEDDING_API_KEY;
  assert.equal((await switchedEmbedding.json() as { ok: boolean }).ok, true);
  assert.deepEqual(embedding.requests.at(-1), {
    method: 'GET',
    url: '/v1/models',
    authorization: 'Bearer dedicated-switch-token',
  }, 'regression: exact saved embedding origin must use submitted-provider runtime precedence');

  for (const owner of ['chat', 'embedding', 'tts'] as const) {
    const response = await discover({
      owner,
      provider: 'openai-compatible',
      ...(owner === 'chat' ? { leg: 'primary' } : {}),
      baseUrl: unsaved.baseUrl,
    });
    assert.equal((await response.json() as { ok: boolean }).ok, true);
    assert.equal(
      unsaved.requests.at(-1)?.authorization,
      '',
      `regression: ${owner} discovery leaked a stored owner's bearer to an unsaved origin`,
    );
  }

  for (const owner of ['chat', 'embedding', 'tts'] as const) {
    const response = await discover({
      owner,
      provider: 'openai-compatible',
      ...(owner === 'chat' ? { leg: 'primary' } : {}),
      baseUrl: unsaved.baseUrl,
      apiKey: `${owner}-unsaved-token`,
    });
    assert.equal((await response.json() as { ok: boolean }).ok, true);
    assert.equal(
      unsaved.requests.at(-1)?.authorization,
      `Bearer ${owner}-unsaved-token`,
      `${owner} discovery did not use its explicit unsaved bearer`,
    );
  }

  const unsavedVoiceRequestCount = unsaved.requests.length;
  const legacyVoiceGet = await fetch(
    `${origin}/settings/tts/voices?provider=openai-compatible&baseUrl=${encodeURIComponent(unsaved.baseUrl)}`,
    { headers: { authorization: adminAuthorization } },
  );
  assert.equal(
    unsaved.requests.length,
    unsavedVoiceRequestCount,
    'regression: legacy GET voice discovery must not contact an unsaved origin with a stored bearer',
  );
  assert.equal(legacyVoiceGet.status, 405, 'query-based voice discovery must stay disabled');

  const savedVoiceResponse = await discoverVoices({ provider: 'openai-compatible' });
  assert.equal(savedVoiceResponse.status, 200);
  assert.equal((await savedVoiceResponse.json() as { ok: boolean }).ok, true);
  assert.deepEqual(tts.requests.at(-1), {
    method: 'GET',
    url: '/v1/audio/voices',
    authorization: 'Bearer tts-owner-token',
  });

  const changedVoiceResponse = await discoverVoices({
    provider: 'openai-compatible',
    baseUrl: unsaved.baseUrl,
  });
  assert.equal(changedVoiceResponse.status, 200);
  assert.equal((await changedVoiceResponse.json() as { ok: boolean }).ok, true);
  assert.equal(
    unsaved.requests.at(-1)?.authorization,
    '',
    'regression: voice discovery leaked the saved TTS bearer to an unsaved origin',
  );

  const explicitVoiceResponse = await discoverVoices({
    provider: 'openai-compatible',
    baseUrl: unsaved.baseUrl,
    apiKey: 'voice-unsaved-token',
  });
  assert.equal(explicitVoiceResponse.status, 200);
  assert.equal((await explicitVoiceResponse.json() as { ok: boolean }).ok, true);
  assert.equal(
    unsaved.requests.at(-1)?.authorization,
    'Bearer voice-unsaved-token',
    'voice discovery did not use its explicit unsaved bearer',
  );

  const changedEmbeddingResponse = await probeEmbedding({
    provider: 'openai-compatible',
    model: 'text-embedding-model',
    baseUrl: unsaved.baseUrl,
  });
  assert.equal((await changedEmbeddingResponse.json() as { ok: boolean }).ok, true);
  assert.deepEqual(unsaved.requests.at(-1), {
    method: 'POST',
    url: '/v1/embeddings',
    authorization: 'Bearer unused',
  }, 'regression: embedding probe leaked its saved bearer to an unsaved origin');

  const explicitEmbeddingResponse = await probeEmbedding({
    provider: 'openai-compatible',
    model: 'text-embedding-model',
    baseUrl: unsaved.baseUrl,
    apiKey: 'embedding-probe-unsaved-token',
  });
  assert.equal((await explicitEmbeddingResponse.json() as { ok: boolean }).ok, true);
  assert.deepEqual(unsaved.requests.at(-1), {
    method: 'POST',
    url: '/v1/embeddings',
    authorization: 'Bearer embedding-probe-unsaved-token',
  });

  const missingOwner = await discover({ provider: 'openai-compatible', baseUrl: unsaved.baseUrl });
  assert.equal(missingOwner.status, 400);
  assert.match(
    String((await missingOwner.json() as { error?: string }).error),
    /owner/,
  );

  console.log('✓ model discovery keeps chat, embedding, and TTS credentials origin-bound');
} finally {
  if (routeServer) {
    await new Promise<void>((resolve) => routeServer!.close(() => resolve()));
  }
  await Promise.all([chat.close(), embedding.close(), tts.close(), unsaved.close()]);
}
