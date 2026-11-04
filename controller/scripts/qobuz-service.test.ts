import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQobuzService } from '../src/music/qobuz/service.js';
import { createQobuzCache } from '../src/music/qobuz/cache.js';
import { accountKeyOf } from '../src/music/qobuz/client.js';
const metadata = { id: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 200, explicit: false };
test('concurrent requests share acquisition and a subsequent hit has no provider lookup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qobuz-service-')); let downloads = 0; let searches = 0;
  const credentials = { appId: 'app', appSecret: 'secret', userAuthToken: 'token', userId: '42' };
  let authority = { accountKey: accountKeyOf('42'), revision: 1 };
  const cache = createQobuzCache({ root, capacityBytes: () => 1024**3, freeBytes: async () => 2*1024**3, references: () => [] }); await cache.load();
  const service = createQobuzService({ cache, enabled: () => true, credentials: () => credentials, authority: () => authority, verify: () => authority, allowed: () => true, client: () => ({ testConnection: async () => ({ accountKey: authority.accountKey, fullTrackAccess: true }), search: async () => { searches++; return [metadata]; }, fileUrl: async () => ({ url: 'https://example.com/media', duration: 200, sample: false }) }), download: async (_url, path) => { downloads++; await writeFile(path, 'data'); return { bytes: 4, duration: 200, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2 }; } });
  const match = { title: 'Song', artist: 'Artist' };
  const [a,b] = await Promise.all([service.acquire(match), service.acquire(match)]);
  assert.ok(a); assert.ok(b); a.release(); b.release();
  const c = await service.acquire(match); assert.ok(c); c.release();
  assert.equal(downloads, 1); assert.equal(searches, 1);
  authority = { ...authority, revision: 2 };
  await rm(root, { recursive: true, force: true });
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
for (const phase of ['publication', 'lease'] as const) test(`credential rotation during final ${phase} cannot publish or deliver stale work`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'qobuz-authority-'));
  const credentials = { appId: 'app', appSecret: 'secret', userAuthToken: 'token', userId: '42' };
  let authority = { accountKey: accountKeyOf('42'), revision: 1 };
  const blocked = deferred(); const unblock = deferred(); const downloaded = deferred(); const finishDownload = deferred(); const publishing = deferred();
  let blockCapacity = false; let releases = 0;
  const cache = createQobuzCache({ root, capacityBytes: () => 1024**3, references: () => [], freeBytes: async () => { if (blockCapacity) { blocked.resolve(); await unblock.promise; } return 2*1024**3; } });
  await cache.load();
  const publish = cache.publish.bind(cache); t.mock.method(cache, 'publish', (...args: Parameters<typeof cache.publish>) => { publishing.resolve(); return publish(...args); });
  const lease = cache.lease.bind(cache); t.mock.method(cache, 'lease', async (...args: Parameters<typeof cache.lease>) => { const result = await lease(...args); if (phase === 'lease') { authority = { ...authority, revision: 2 }; if (result) { const release = result.release; result.release = () => { releases++; release(); }; } } return result; });
  const service = createQobuzService({ cache, enabled: () => true, credentials: () => credentials, authority: () => authority, verify: () => authority, allowed: () => true,
    client: () => ({ testConnection: async () => ({ accountKey: authority.accountKey, fullTrackAccess: true }), search: async () => [metadata], fileUrl: async () => ({ url: 'https://example.com/media', duration: 200, sample: false }) }),
    download: async (_url, path) => { await writeFile(path, 'data'); downloaded.resolve(); await finishDownload.promise; return { bytes: 4, duration: 200, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2 }; } });
  const acquisition = service.acquire({ title: 'Song', artist: 'Artist' });
  const rejected = assert.rejects(acquisition, /changed/);
  await downloaded.promise;
  if (phase === 'publication') {
    blockCapacity = true; const blocker = cache.reserve(4); await blocked.promise;
    finishDownload.resolve(); await publishing.promise;
    authority = { ...authority, revision: 2 }; unblock.resolve(); (await blocker).release();
  } else finishDownload.resolve();
  await rejected;
  if (phase === 'publication') assert.equal(JSON.parse(await readFile(join(root, 'index.json'), 'utf8')).entries.length, 0);
  else assert.equal(releases, 1, 'a stale final lease must be released');
  await rm(root, { recursive: true, force: true });
});

test('a missing older generation cannot hide a valid replacement or force repeated downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qobuz-replacement-')); let searches = 0; let downloads = 0;
  const authority = { accountKey: accountKeyOf('42'), revision: 1 };
  const cache = createQobuzCache({ root, capacityBytes: () => 1024**3, freeBytes: async () => 2*1024**3, references: () => [] }); await cache.load();
  const credentials = { appId: 'app', appSecret: 'secret', userAuthToken: 'token', userId: '42' };
  const service = createQobuzService({ cache, enabled: () => true, credentials: () => credentials, authority: () => authority, verify: () => authority, allowed: () => true,
    client: () => ({ testConnection: async () => ({ accountKey: authority.accountKey, fullTrackAccess: true }), search: async () => { searches++; return [metadata]; }, fileUrl: async () => ({ url: 'https://example.com/media', duration: 200, sample: false }) }),
    download: async (_url, path) => { downloads++; await writeFile(path, 'data'); return { bytes: 4, duration: 200, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2 }; } });
  const match = { title: 'Song', artist: 'Artist' };
  const original = await service.acquire(match); assert.ok(original); const path = await cache.resolve(original.track.providerRef); original.release(); await rm(path!);
  const replacement = await service.acquire(match); assert.ok(replacement); replacement.release();
  const hit = await service.acquire(match); assert.ok(hit); hit.release();
  assert.equal(hit.track.providerRef.generation, replacement.track.providerRef.generation);
  assert.equal(downloads, 2); assert.equal(searches, 2);
  await rm(root, { recursive: true, force: true });
});
