import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  discoveryKeys,
  fetchModels,
  fetchVoices,
  refreshDiscoveryQuery,
} from './discovery-queries';

test('discovery cache identity separates credentials without retaining their raw values', () => {
  const modelA = discoveryKeys.models({ owner: 'chat', provider: 'openai', apiKey: 'model-secret-a' });
  const modelB = discoveryKeys.models({ owner: 'chat', provider: 'openai', apiKey: 'model-secret-b' });
  const voice = discoveryKeys.voices({ provider: 'elevenlabs', apiKey: 'voice-secret' });

  assert.notDeepEqual(modelA, modelB, 'a changed unsaved credential must trigger a distinct discovery read');
  assert.doesNotMatch(JSON.stringify(modelA), /model-secret-a/);
  assert.doesNotMatch(JSON.stringify(modelB), /model-secret-b/);
  assert.doesNotMatch(JSON.stringify(voice), /voice-secret/);
});

test('query-backed model discovery keeps unsaved provider configuration in a POST body', async () => {
  const controller = new AbortController();
  let receivedPath = '';
  let receivedInit: RequestInit | undefined;
  const result = await fetchModels(async (path, init) => {
    receivedPath = path;
    receivedInit = init;
    return Response.json({ ok: true, models: ['body-safe-model'] });
  }, {
    owner: 'chat',
    provider: 'openai-compatible',
    leg: 'fallback',
    apiKey: 'unsaved-model-secret',
    baseUrl: 'https://models.example/v1',
    ollamaUrl: 'https://ollama.example',
  }, controller.signal);

  assert.deepEqual(result, { ok: true, models: ['body-safe-model'] });
  assert.equal(receivedPath, '/settings/llm/models');
  assert.equal(receivedInit?.method, 'POST');
  assert.equal(receivedInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), {
    owner: 'chat',
    provider: 'openai-compatible',
    leg: 'fallback',
    baseUrl: 'https://models.example/v1',
    ollamaUrl: 'https://ollama.example',
    apiKey: 'unsaved-model-secret',
  });
  assert.doesNotMatch(receivedPath, /secret|example|apiKey|baseUrl|ollamaUrl/);
});

test('query-backed voice discovery keeps unsaved provider configuration in a POST body', async () => {
  const controller = new AbortController();
  let receivedPath = '';
  let receivedInit: RequestInit | undefined;
  const result = await fetchVoices(async (path, init) => {
    receivedPath = path;
    receivedInit = init;
    return Response.json({ ok: true, voices: [{ id: 'voice-1', label: 'Voice One' }] });
  }, {
    provider: 'openai-compatible',
    apiKey: 'unsaved-voice-secret',
    baseUrl: 'https://voices.example/v1',
  }, controller.signal);

  assert.deepEqual(result, {
    ok: true,
    voices: [{ id: 'voice-1', label: 'Voice One' }],
  });
  assert.equal(receivedPath, '/settings/tts/voices');
  assert.equal(receivedInit?.method, 'POST');
  assert.equal(receivedInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), {
    provider: 'openai-compatible',
    baseUrl: 'https://voices.example/v1',
    apiKey: 'unsaved-voice-secret',
  });
  assert.doesNotMatch(receivedPath, /secret|example|apiKey|baseUrl/);
});

test('manual discovery refresh aborts and supersedes an in-flight same-key probe', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['discovery', 'models', { provider: 'ollama' }] as const;
  let firstAborted = false;
  let requests = 0;
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    requests++;
    if (requests === 1) {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          firstAborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    }
    return Promise.resolve('fresh');
  };

  const first = client.fetchQuery({ queryKey: key, queryFn }).catch(() => undefined);
  const result = await refreshDiscoveryQuery(client, key, queryFn);
  await first;

  assert.equal(firstAborted, true);
  assert.equal(requests, 2);
  assert.equal(result, 'fresh');
});
