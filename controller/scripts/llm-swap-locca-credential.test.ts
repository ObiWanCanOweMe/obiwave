// A Locca key remains provider-owned when its configured chat leg moves to
// fallback. Reuse requires an enabled leg at the same resolved endpoint.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTempDir } from './test-utils/temp-dir.js';

process.env.STATE_DIR = createTempDir(path.join(tmpdir(), 'subwave-swap-locca-key-'));
delete process.env.EMBEDDING_API_KEY;
const settings = await import('../src/settings.js');
const { resolveEmbeddingCfg } = await import('../src/llm/provider.js');
const { planLlmSwap } = await import('../src/settings/llm-swap.js');
const { setCache } = await import('../src/settings/store.js');

const endpoint = 'http://server:8090/v1';
const key = 'locca-owned-key';
async function configure() {
  await settings.update({
    llm: {
      provider: 'locca', model: 'chat', baseUrl: endpoint, apiKey: key,
      headers: { 'x-route': 'locca-route' },
      fallback: { enabled: true, provider: 'ollama', model: 'backup', headers: {} },
    },
    embedding: { provider: 'locca', baseUrl: endpoint, apiKey: '', headers: {} },
  });
}

test('Locca swap preserves the resolved key without advertising an unsupported inline pin', async () => {
  await configure();
  const before = resolveEmbeddingCfg();
  assert.equal(before.apiKey, key);
  const plan = planLlmSwap(settings.get(), before);
  await settings.update(plan.patch);
  assert.equal(settings.get().llm.provider, 'ollama');
  assert.equal(settings.get().llm.fallback.provider, 'locca');
  assert.equal(settings.get().embedding.apiKey, '', 'the key stays in its provider-owned slot');
  assert.equal(settings.get().llm.keys.locca, key);
  const after = resolveEmbeddingCfg();
  assert.equal(after.apiKey, before.apiKey);
  assert.equal(plan.pinned.includes('apiKey'), false);
  assert.equal(plan.keyNotPinned, false);
  assert.equal(after.baseUrl, before.baseUrl);
  assert.deepEqual(after.headers, before.headers);
  setCache(null);
  await settings.load();
  assert.equal(resolveEmbeddingCfg().apiKey, key, 'the persisted matching fallback retains authorization after restart');
});

test('matching fallback credentials never follow an arbitrary embedding probe endpoint', async () => {
  await configure();
  await settings.update(planLlmSwap(settings.get(), resolveEmbeddingCfg()).patch);
  const probe = resolveEmbeddingCfg({ baseUrl: 'http://other-server:8090/v1' });
  assert.equal(probe.apiKey, '');
  assert.deepEqual(probe.headers, {});
});

test('a disabled or differently configured fallback does not authorize key sharing', async () => {
  await configure();
  await settings.update(planLlmSwap(settings.get(), resolveEmbeddingCfg()).patch);
  await settings.update({ llm: { fallback: { enabled: false } } });
  assert.equal(resolveEmbeddingCfg().apiKey, '');
  await settings.update({ llm: { fallback: { enabled: true, baseUrl: 'http://other-server:8090/v1' } } });
  assert.equal(resolveEmbeddingCfg().apiKey, '');
});
