import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQobuzCache } from '../src/music/qobuz/cache.js';
const week = 604800000;
const metadata = { id: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 200, explicit: false };
const authority = { accountKey: 'a'.repeat(64), revision: 1 };
const audio = { bytes: 4, duration: 200, suffix: 'flac' as const, samplingRate: 44100, bitDepth: 16, channelCount: 2 };
async function fixture(capacityBytes = 1000) {
  const root = await mkdtemp(join(tmpdir(), 'qobuz-cache-'));
  let clock = 100000; let refs: any[] = [];
  const cache = createQobuzCache({ root: join(root, 'cache'), now: () => clock, references: () => refs, capacityBytes: () => capacityBytes, freeBytes: async () => 1024**3 });
  await cache.load();
  const partial = await cache.reserve(4);
  await writeFile(partial.path, 'data');
  const lease = await cache.publish(metadata, { path: partial.path, audio }, authority); partial.release();
  return { root, cache, lease, setClock: (value: number) => { clock = value; }, setRefs: (value: any[]) => { refs = value; } };
}
test('accepted cache hits renew seven days; inspection and refused leases do not', async () => {
  const f = await fixture(); f.lease.release();
  const manifest = async () => JSON.parse(await readFile(join(f.root, 'cache/index.json'), 'utf8')).entries[0];
  assert.equal((await manifest()).expiresAt, 100000 + week);
  f.setClock(200000);
  const hit = await f.cache.lookup({ title: 'Song', artist: 'Artist' }, authority); assert.ok(hit);
  assert.equal((await manifest()).expiresAt, 100000 + week);
  await hit.accepted(200000); hit.release();
  assert.equal((await manifest()).expiresAt, 200000 + week);
  const refused = await f.cache.lookup({ title: 'Song', artist: 'Artist' }, authority); refused!.release();
  assert.equal((await manifest()).expiresAt, 200000 + week);
  await rm(f.root, { recursive: true, force: true });
});
test('expired queued and leased generations survive cleanup but never serve new requests', async () => {
  const f = await fixture(); const ref = f.lease.track.providerRef;
  f.setClock(100000 + week + 1); f.setRefs([ref]); f.lease.release();
  await f.cache.cleanup(); assert.ok(await f.cache.resolve(ref));
  assert.equal(await f.cache.lookup({ title: 'Song', artist: 'Artist' }, authority), null);
  f.setRefs([]); await f.cache.cleanup();
  f.setClock(100000 + week + 120002); await f.cache.cleanup();
  assert.equal(await f.cache.resolve(ref), null);
  await rm(f.root, { recursive: true, force: true });
});
test('a different account cannot reuse audio and capacity never evicts fresh files', async () => {
  const f = await fixture(4); f.lease.release();
  assert.equal(await f.cache.lookup({ title: 'Song' }, { accountKey: 'b'.repeat(64), revision: 1 }), null);
  await assert.rejects(f.cache.reserve(4), /capacity/);
  assert.ok(await f.cache.resolve(f.lease.track.providerRef));
  await rm(f.root, { recursive: true, force: true });
});
test('symlink audio is never served or followed by cleanup', async () => {
  const f = await fixture(); const ref = f.lease.track.providerRef; const path = await f.cache.resolve(ref); f.lease.release();
  await rm(path!); const outside = join(f.root, 'outside'); await writeFile(outside, 'keep'); await symlink(outside, path!);
  assert.equal(await f.cache.resolve(ref), null);
  f.setClock(100000 + week + 200000); await f.cache.cleanup();
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  await access(outside); await rm(f.root, { recursive: true, force: true });
});
test('restart restores a manifest and a missing cached file cannot satisfy a request', async () => {
  const f = await fixture(); f.lease.release();
  const cache = createQobuzCache({ root: join(f.root, 'cache'), references: () => [], capacityBytes: () => 1024**3, freeBytes: async () => 2*1024**3, now: () => 200000 });
  await cache.load();
  const hit = await cache.lookup({ title: 'Song', artist: 'Artist' }, authority); assert.ok(hit); hit.release();
  const path = await cache.resolve(hit.track.providerRef); await rm(path!);
  assert.equal(await cache.lookup({ title: 'Song', artist: 'Artist' }, authority), null);
  await rm(f.root, { recursive: true, force: true });
});
test('corrupt index and symlink cache root fail closed without touching unrelated files', async () => {
  const f = await fixture(); f.lease.release();
  const outside = join(f.root, 'outside'); await writeFile(outside, 'keep');
  await writeFile(join(f.root, 'cache/index.json'), '{broken');
  const make = (root: string) => createQobuzCache({ root, references: () => [], capacityBytes: () => 1024**3 });
  await assert.rejects(make(join(f.root, 'cache')).load(), /index/);
  await symlink(join(f.root, 'cache'), join(f.root, 'linked'));
  await assert.rejects(make(join(f.root, 'linked')).load(), /cache/);
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  await rm(f.root, { recursive: true, force: true });
});
