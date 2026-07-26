import assert from 'node:assert/strict';
import { buildModelDiscoveryRequest } from '../lib/modelDiscoveryRequest.ts';
import { buildVoiceDiscoveryRequest } from '../lib/voiceDiscoveryRequest.ts';

for (const owner of ['chat', 'embedding', 'tts'] as const) {
  const request = buildModelDiscoveryRequest({
    owner,
    provider: 'openai-compatible',
    leg: owner === 'chat' ? 'fallback' : undefined,
    baseUrl: `https://${owner}.example/v1`,
    ollamaUrl: '',
    apiKey: `${owner}-secret`,
  });
  assert.equal(request.url, '/settings/llm/models');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers?.['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    owner,
    provider: 'openai-compatible',
    ...(owner === 'chat' ? { leg: 'fallback' } : {}),
    baseUrl: `https://${owner}.example/v1`,
    apiKey: `${owner}-secret`,
  });
  assert.doesNotMatch(request.url, /example|secret|apiKey|baseUrl/);
}

const voiceRequest = buildVoiceDiscoveryRequest({
  provider: 'openai-compatible',
  baseUrl: 'https://tts.example/v1',
  apiKey: 'tts-voice-secret',
});
assert.equal(voiceRequest.url, '/settings/tts/voices');
assert.equal(voiceRequest.init.method, 'POST');
assert.deepEqual(JSON.parse(String(voiceRequest.init.body)), {
  provider: 'openai-compatible',
  baseUrl: 'https://tts.example/v1',
  apiKey: 'tts-voice-secret',
});
assert.doesNotMatch(voiceRequest.url, /example|secret|apiKey|baseUrl/);

console.log('model-discovery-request.test.ts: model and voice discovery use credential-safe POST bodies');
