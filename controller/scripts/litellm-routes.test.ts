import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-litellm-routes-'));
process.env.ADMIN_USER = 'route-admin';
process.env.ADMIN_PASS = 'route-password';

interface RecordedRequest { method: string; url: string; authorization: string }

async function recordingGateway() {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method || '',
      url: req.url || '',
      authorization: String(req.headers.authorization || ''),
    });
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'vendor/model' }] }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-route-test',
        object: 'chat.completion',
        created: 1,
        model: parsed.model || 'vendor/model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
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
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

const primary = await recordingGateway();
const fallback = await recordingGateway();
const onboarding = await recordingGateway();
const environment = await recordingGateway();
const compatFallback = await recordingGateway();
const unsavedLocca = await recordingGateway();
let routeServer: http.Server | undefined;

try {
  const settings = await import('../src/settings.js');
  const { router: settingsRouter } = await import('../src/routes/settings.js');
  const { router: onboardingRouter } = await import('../src/routes/onboarding.js');
  await settings.load();
  await settings.update({
    llm: {
      provider: 'litellm',
      model: 'vendor/model',
      baseUrl: primary.baseUrl,
      apiKey: 'saved-leg-token',
      fallback: {
        enabled: true,
        provider: 'litellm',
        model: 'vendor/model',
        baseUrl: fallback.baseUrl,
      },
    },
  });

  const app = express();
  app.use(express.json());
  app.use(settingsRouter);
  app.use(onboardingRouter);
  const server = app.listen(0, '127.0.0.1');
  routeServer = server;
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const authorization = `Basic ${Buffer.from('route-admin:route-password').toString('base64')}`;
  const post = (path: string, body: unknown) => fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  for (const leg of ['primary', 'fallback'] as const) {
    const response = await post('/settings/llm/models', { provider: 'litellm', leg });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
  }
  assert.deepEqual(primary.requests[0], {
    method: 'GET', url: '/v1/models', authorization: 'Bearer saved-leg-token',
  });
  assert.deepEqual(fallback.requests[0], {
    method: 'GET', url: '/v1/models', authorization: 'Bearer saved-leg-token',
  });

  const probe = await post('/settings/llm/probe-compat', {
    provider: 'litellm', leg: 'fallback', model: 'vendor/model',
  });
  assert.equal(probe.status, 200);
  assert.equal((await probe.json()).ok, true);
  assert.deepEqual(fallback.requests[1], {
    method: 'POST', url: '/v1/chat/completions', authorization: 'Bearer saved-leg-token',
  });

  const onboardingResponse = await post('/settings/llm/models', {
    provider: 'litellm',
    leg: 'onboarding',
    baseUrl: onboarding.baseUrl,
    apiKey: 'unsaved-onboarding-token',
  });
  assert.equal((await onboardingResponse.json()).ok, true);
  assert.deepEqual(onboarding.requests[0], {
    method: 'GET', url: '/v1/models', authorization: 'Bearer unsaved-onboarding-token',
  });

  const onboardingTestResponse = await post('/onboarding/test-llm', {
    provider: 'litellm',
    model: 'vendor/model',
    baseUrl: onboarding.baseUrl,
    apiKey: 'unsaved-onboarding-token',
  });
  assert.equal(onboardingTestResponse.status, 200);
  assert.equal((await onboardingTestResponse.json()).ok, true);
  assert.deepEqual(onboarding.requests[1], {
    method: 'POST', url: '/v1/chat/completions', authorization: 'Bearer unsaved-onboarding-token',
  });
  console.log('  ✓ mounted /onboarding/test-llm uses the unsaved URL and bearer token');

  await settings.update({
    llm: {
      provider: 'ollama',
      model: 'glm-5.1:cloud',
      baseUrl: '',
      fallback: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'vendor/model',
        baseUrl: compatFallback.baseUrl,
        apiKey: 'saved-compat-fallback-token',
      },
    },
  });
  const switchBackProbe = await post('/settings/llm/probe-compat', {
    provider: 'litellm',
    leg: 'primary',
    baseUrl: primary.baseUrl,
    model: 'vendor/model',
  });
  assert.equal(switchBackProbe.status, 200);
  assert.equal((await switchBackProbe.json()).ok, true);
  assert.deepEqual(primary.requests[1], {
    method: 'POST', url: '/v1/chat/completions', authorization: 'Bearer saved-leg-token',
  }, 'switching an unsaved form back to LiteLLM uses only the stored LiteLLM key');

  const legacyProbe = await post('/settings/llm/probe-compat', {
    provider: 'openai-compatible',
    baseUrl: compatFallback.baseUrl,
    model: 'vendor/model',
  });
  assert.equal(legacyProbe.status, 200);
  assert.equal((await legacyProbe.json()).ok, true);
  assert.deepEqual(compatFallback.requests[0], {
    method: 'POST', url: '/v1/chat/completions', authorization: 'Bearer saved-compat-fallback-token',
  });

  const mismatchedProbe = await post('/settings/llm/probe-compat', {
    provider: 'locca',
    leg: 'fallback',
    baseUrl: unsavedLocca.baseUrl,
    model: 'vendor/model',
  });
  assert.equal(mismatchedProbe.status, 200);
  assert.equal((await mismatchedProbe.json()).ok, true);
  assert.deepEqual(unsavedLocca.requests[0], {
    method: 'POST', url: '/v1/chat/completions', authorization: 'Bearer no-key',
  }, 'an unsaved Locca endpoint receives only the SDK placeholder, never the saved fallback provider token');

  await settings.update({
    llm: {
      provider: 'locca',
      model: 'vendor/model',
      baseUrl: unsavedLocca.baseUrl,
      apiKey: 'saved-locca-token',
    },
  });
  await settings.update({
    llm: {
      provider: 'ollama',
      model: 'glm-5.1:cloud',
      baseUrl: '',
      fallback: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'vendor/model',
        baseUrl: compatFallback.baseUrl,
      },
    },
  });
  const providerOwnedProbe = await post('/settings/llm/probe-compat', {
    provider: 'locca',
    leg: 'fallback',
    baseUrl: unsavedLocca.baseUrl,
    model: 'vendor/model',
  });
  assert.equal(providerOwnedProbe.status, 200);
  assert.equal((await providerOwnedProbe.json()).ok, true);
  assert.deepEqual(unsavedLocca.requests[1], {
    method: 'POST', url: '/v1/chat/completions', authorization: 'Bearer saved-locca-token',
  }, 'the submitted provider must resolve only its own stored token');

  await settings.update({
    llm: {
      provider: 'litellm',
      model: 'vendor/model',
      baseUrl: environment.baseUrl,
      apiKey: '',
    },
  });
  await settings.update({
    llm: { provider: 'ollama', model: 'glm-5.1:cloud', baseUrl: '', fallback: { enabled: false } },
  });
  process.env.LITELLM_API_BASE = environment.baseUrl;
  process.env.LITELLM_API_KEY = 'environment-only-token';
  const environmentResponse = await post('/settings/llm/models', { provider: 'litellm', leg: 'primary' });
  assert.equal((await environmentResponse.json()).ok, true);
  assert.deepEqual(environment.requests[0], {
    method: 'GET', url: '/v1/models', authorization: 'Bearer environment-only-token',
  });

  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  routeServer = undefined;
  console.log('✓ LiteLLM routes resolve authenticated primary, fallback, onboarding, and environment transports');
} finally {
  if (routeServer) {
    await new Promise<void>((resolve) => routeServer!.close(() => resolve()));
  }
  await Promise.all([
    primary.close(),
    fallback.close(),
    onboarding.close(),
    environment.close(),
    compatFallback.close(),
    unsavedLocca.close(),
  ]);
}
