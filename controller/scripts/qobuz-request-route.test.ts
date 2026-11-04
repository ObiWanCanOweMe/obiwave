import test, { beforeEach, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { router } from '../src/routes/request.js';
import * as settings from '../src/settings.js';
import { queue } from '../src/broadcast/queue.js';
import { qobuzService } from '../src/music/qobuz/runtime.js';
import { primaryLeg } from '../src/llm/internal/provider/legs.js';
import { requestAgent } from '../src/broadcast/dj-agent/agents.js';
import { invalidateWeatherCache } from '../src/context.js';
import { tryQobuzRequest } from '../src/routes/request-qobuz.js';
import type { AddressInfo } from 'node:net';
const app = express(); app.use(express.json()); app.use(router);
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const realFetch = globalThis.fetch; after(() => server.close());
const cached = { id: 'qobuz:123', title: 'Song', artist: 'Artist', album: 'Album', duration: 200, explicit: false, providerRef: { provider: 'qobuz' as const, trackId: '123', accountKey: 'a'.repeat(64), generation: '11111111-1111-4111-8111-111111111111' } };
let externalCalls = 0; let agentCalls = 0; let renewals = 0; let releases = 0; let local = false; let ip = 0;
beforeEach(async context => {
  const t = context as TestContext;
  await settings.load(); await settings.update({ qobuz: { enabled: true }, tts: { enabled: false }, requests: { onePendingPerIp: false, maxPending: 50, globalHourlyCap: 1000, perIpHourlyCap: 100 }, llm: { requestMatching: 'direct', strictRequests: false, provider: 'openai-compatible', compatibleMode: 'local', baseUrl: 'http://model.invalid/v1', model: 'test', fallback: { enabled: false } } });
  queue.upcoming = []; queue.current = null; queue.history = []; queue._recentPlays = []; queue.senderBusy = true;
  externalCalls = agentCalls = renewals = releases = 0; local = false; invalidateWeatherCache();
  t.mock.method(qobuzService, 'acquire', async (_match, _signal, guard) => { externalCalls++; guard?.(cached); return { track: cached, authority: { accountKey: cached.providerRef.accountKey, revision: 1 }, release() { releases++; }, async accepted() { renewals++; } }; });
  t.mock.method(qobuzService, 'stillValid', () => true);
  t.mock.method(requestAgent, 'run', async () => { agentCalls++; throw Error('unexpected substitution'); });
  const leg = primaryLeg();
  for (const model of new Set([leg.model, leg.noThinkModel])) t.mock.method(model as any, 'doGenerate', async () => ({ content: [{ type: 'text', text: JSON.stringify({ kind: 'track', title: 'Song', artist: 'Artist', search_terms: ['Song', 'Artist'] }) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] }));
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin === base) return realFetch(input, init);
    if (!url.pathname.includes('/rest/')) throw Error('offline test dependency');
    const data = url.pathname.endsWith('/search3') ? { searchResult3: { song: local ? [{ ...cached, id: 'local-song', providerRef: undefined }] : [] } } : url.pathname.endsWith('/getStarred2') ? { starred2: { song: [] } } : {};
    return Response.json({ 'subsonic-response': { status: 'ok', ...data } });
  });
});
async function submit() {
  const response = await realFetch(`${base}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `198.51.100.${++ip}` }, body: JSON.stringify({ text: 'Play Song by Artist', name: 'Listener' }) });
  const receipt = await response.json() as any; assert.equal(response.status, 202);
  for (let n = 0; n < 300; n++) { const result = await (await realFetch(`${base}/request/${receipt.requestId}`)).json() as any; if (result.status !== 'pending') return result; await new Promise(r => setTimeout(r, 10)); }
  throw Error('request did not resolve');
}
test('Direct and agentic requests queue external exact matches before any substitute', async () => {
  for (const mode of ['direct', 'agentic']) {
    await settings.update({ llm: { requestMatching: mode } }); queue.upcoming = [];
    const result = await submit(); assert.equal(result.outcome, 'matched'); assert.equal(result.track.title, 'Song');
    assert.equal(queue.upcoming[0].track.id, 'qobuz:123'); assert.equal(agentCalls, 0);
    assert.equal(JSON.stringify(result).includes('accountKey'), false);
  }
  assert.equal(renewals, 2); assert.equal(releases, 2);
});
test('local catalogue hit bypasses external acquisition', async () => {
  local = true; const result = await submit(); assert.equal(result.outcome, 'matched'); assert.equal(queue.upcoming[0].track.id, 'local-song'); assert.equal(externalCalls, 0);
});
test('final queue refusal releases the cache lease without renewal', async () => {
  const result = await tryQobuzRequest({ match: { title: 'Song', artist: 'Artist' }, text: 'Play Song by Artist', requester: 'Listener', context: {}, queue: { ...queue, recentlyPlayedIds: () => new Set(), queuedIds: () => new Set(), push: async () => -1, dedupAck: () => 'Already queued', getDjRecap: () => '', getRecentTracks: () => [], getRecentOpeners: () => [] } as any, service: qobuzService });
  assert.equal(result.kind, 'refused'); assert.equal(renewals, 0); assert.equal(releases, 1);
});
test('disabled Qobuz preserves the ordinary Direct request path', async () => {
  await settings.update({ qobuz: { enabled: false } }); local = true;
  const result = await submit(); assert.equal(result.outcome, 'matched'); assert.equal(externalCalls, 0);
});
test('local cooldown refuses acquisition rather than buying around station policy', async () => {
  local = true; queue._recentPlays = [{ id: 'local-song', title: 'Song', artist: 'Artist', endedAt: new Date().toISOString() }];
  const result = await submit(); assert.equal(result.outcome, 'cooldown'); assert.equal(externalCalls, 0); assert.equal(queue.upcoming.length, 0);
});

test('queue admission checks the authority carried by the acquisition lease', async t => {
  t.mock.method(qobuzService, 'stillValid', authority => authority?.revision !== 1);
  const result = await tryQobuzRequest({ match: { title: 'Song', artist: 'Artist' }, text: 'Play Song by Artist', requester: 'Listener', context: {}, queue, service: qobuzService });
  assert.equal(result.kind, 'continue'); assert.equal(queue.upcoming.length, 0); assert.equal(renewals, 0); assert.equal(releases, 1);
});
