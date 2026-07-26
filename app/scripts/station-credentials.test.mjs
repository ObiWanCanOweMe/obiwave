import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { createApi } from '../src/lib/api.js';
import {
  parseStationAddress,
  sanitizeDiagnostic,
  secureKeyForOrigin,
} from '../src/lib/stationSecurity.js';
import {
  createStationRepository,
  STATIONS_KEY,
  STREAM_FORMAT_KEY,
} from '../src/lib/stationStorageCore.js';

class MemoryStore {
  values = new Map();
  failWrites = false;

  async getItem(key) {
    return this.values.get(key) ?? null;
  }

  async setItem(key, value) {
    if (this.failWrites) throw new Error('secure storage unavailable');
    this.values.set(key, value);
  }

  async removeItem(key) {
    this.values.delete(key);
  }
}

const legacyUrl = 'https://listener:p%40ss@Radio.Example:8443/ignored/path?secret=1';
const cleanOrigin = 'https://radio.example:8443';

async function main() {
{
  const parsed = parseStationAddress(legacyUrl);
  assert.equal(parsed.origin, cleanOrigin);
  assert.equal(parsed.authorization, `Basic ${Buffer.from('listener:p@ss').toString('base64')}`);
  assert.ok(!secureKeyForOrigin(cleanOrigin).includes('listener'));
  assert.equal(
    sanitizeDiagnostic(`failed ${legacyUrl} Authorization: Basic abc123`),
    'failed https://radio.example:8443/ignored/path Authorization: Basic [redacted]',
  );
}

{
  const publicStore = new MemoryStore();
  const secureStore = new MemoryStore();
  publicStore.values.set(STATIONS_KEY, JSON.stringify({
    activeStation: legacyUrl,
    recents: [
      { url: legacyUrl, name: 'listener:p@ss@Radio.Example:8443', lastUsed: 1 },
      { url: 'https://other.example', name: 'Other', lastUsed: 2 },
    ],
  }));
  publicStore.values.set(STREAM_FORMAT_KEY, JSON.stringify({
    [legacyUrl]: 'aac',
  }));

  const repo = createStationRepository(publicStore, secureStore, () => 1234);
  const migrated = await repo.load();
  assert.equal(migrated.activeStation, cleanOrigin);
  assert.deepEqual(migrated.recents, [
    { url: cleanOrigin, name: 'radio.example:8443', lastUsed: 1 },
    { url: 'https://other.example', name: 'Other', lastUsed: 2 },
  ]);
  assert.equal(
    await repo.authorizationFor(cleanOrigin),
    `Basic ${Buffer.from('listener:p@ss').toString('base64')}`,
  );

  const publicSnapshot = [...publicStore.values.values()].join('\n');
  assert.doesNotMatch(publicSnapshot, /listener|p%40ss|p@ss/i);
  assert.deepEqual(
    JSON.parse(publicStore.values.get(STREAM_FORMAT_KEY)),
    { [cleanOrigin]: 'aac' },
  );
  assert.equal(secureStore.values.size, 1);

  const selected = await repo.select({
    url: 'https://alice:new-secret@fresh.example/private/path',
    name: 'Fresh',
  });
  assert.equal(selected.activeStation, 'https://fresh.example');
  assert.doesNotMatch(publicStore.values.get(STATIONS_KEY), /alice|new-secret|@fresh/);
  assert.equal(
    await repo.authorizationFor('https://fresh.example'),
    `Basic ${Buffer.from('alice:new-secret').toString('base64')}`,
  );

  await repo.clearActive();
  await repo.remove('https://fresh.example');
  assert.equal(await repo.authorizationFor('https://fresh.example'), null);
}

{
  const publicStore = new MemoryStore();
  const secureStore = new MemoryStore();
  const newest = 'https://newest:new-secret@collision.example/private';
  const stale = 'https://old:stale-secret@collision.example/older';
  publicStore.values.set(STATIONS_KEY, JSON.stringify({
    activeStation: newest,
    recents: [
      { url: newest, name: 'Newest', lastUsed: 2 },
      { url: stale, name: 'Old duplicate', lastUsed: 1 },
    ],
  }));

  const repo = createStationRepository(publicStore, secureStore);
  const migrated = await repo.load();
  assert.deepEqual(migrated, {
    activeStation: 'https://collision.example',
    recents: [
      { url: 'https://collision.example', name: 'Newest', lastUsed: 2 },
    ],
  });
  assert.equal(
    await repo.authorizationFor('https://collision.example'),
    `Basic ${Buffer.from('newest:new-secret').toString('base64')}`,
    'regression: an ignored stale duplicate must not overwrite the active/newest credential',
  );
}

{
  const publicStore = new MemoryStore();
  const secureStore = new MemoryStore();
  const origin = 'https://clean-collision.example';
  const current = `Basic ${Buffer.from('current:canonical-token').toString('base64')}`;
  secureStore.values.set(secureKeyForOrigin(origin), current);
  publicStore.values.set(STATIONS_KEY, JSON.stringify({
    activeStation: origin,
    recents: [
      { url: origin, name: 'Newest clean record', lastUsed: 2 },
      { url: 'https://old:stale-secret@clean-collision.example/older', name: 'Stale', lastUsed: 1 },
    ],
  }));

  const repo = createStationRepository(publicStore, secureStore);
  await repo.load();
  assert.equal(
    await repo.authorizationFor(origin),
    current,
    'regression: a stale credentialed duplicate must not override a newer clean occurrence',
  );
  assert.doesNotMatch(publicStore.values.get(STATIONS_KEY), /old|stale-secret/);
}

{
  const publicStore = new MemoryStore();
  const secureStore = new MemoryStore();
  const origin = 'https://canonical-wins.example';
  const current = `Basic ${Buffer.from('current:canonical-token').toString('base64')}`;
  secureStore.values.set(secureKeyForOrigin(origin), current);
  publicStore.values.set(STATIONS_KEY, JSON.stringify({
    activeStation: 'https://legacy:old-secret@canonical-wins.example/private',
    recents: [
      { url: 'https://legacy:old-secret@canonical-wins.example/private', name: 'Legacy', lastUsed: 1 },
    ],
  }));

  const repo = createStationRepository(publicStore, secureStore);
  await repo.load();
  assert.equal(
    await repo.authorizationFor(origin),
    current,
    'regression: legacy migration must not overwrite an existing canonical SecureStore value',
  );
  assert.doesNotMatch(publicStore.values.get(STATIONS_KEY), /legacy|old-secret/);
}

{
  const publicStore = new MemoryStore();
  const secureStore = new MemoryStore();
  secureStore.failWrites = true;
  const repo = createStationRepository(publicStore, secureStore);

  await assert.rejects(
    repo.select({ url: 'https://listener:never-plaintext@private.example', name: 'Private' }),
    /secure storage unavailable/,
  );
  assert.equal(publicStore.values.get(STATIONS_KEY), undefined);
}

{
  const calls = [];
  const expected = `Basic ${Buffer.from('listener:network-secret').toString('base64')}`;
  const server = createServer((req, res) => {
    calls.push({
      url: req.url || '',
      method: req.method || 'GET',
      authorization: req.headers.authorization ?? null,
    });
    if (req.url === '/api/state') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(req.url === '/api/health' ? '{}' : JSON.stringify({ success: true }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  const raw = `http://listener:network-secret@127.0.0.1:${address.port}/ignored`;
  const origin = `http://127.0.0.1:${address.port}`;
  const api = createApi(raw);

  try {
    assert.equal(api.base, origin);
    await api.nowPlaying();
    await api.postRequest({ text: 'hello' });
    assert.deepEqual(await api.probeHealth(), { ok: true });
    await assert.rejects(api.state(), (error) => {
      assert.match(error.message, /^HTTP 500$/);
      assert.doesNotMatch(error.message, /network-secret|listener|127\\.0\\.0\\.1/);
      return true;
    });
  } finally {
    server.close();
    await once(server, 'close');
  }

  assert.deepEqual(
    calls.map(({ url, method, authorization }) => ({ url, method, authorization })),
    [
      { url: '/api/now-playing', method: 'GET', authorization: expected },
      { url: '/api/request', method: 'POST', authorization: expected },
      { url: '/api/health', method: 'GET', authorization: expected },
      { url: '/api/state', method: 'GET', authorization: expected },
    ],
  );

  assert.deepEqual(api.cover('song/id'), {
    uri: `${origin}/api/cover/song%2Fid`,
    headers: { Authorization: expected },
  });
  assert.deepEqual(api.avatar('/persona-avatar/dj'), {
    uri: `${origin}/api/persona-avatar/dj`,
    headers: { Authorization: expected },
  });
  assert.deepEqual(api.avatar('https://images.example/dj.png'), {
    uri: 'https://images.example/dj.png',
  });
  assert.equal(api.streamUrl(), `${origin}/stream.mp3`);
  assert.deepEqual(api.streamHeaders(), { Authorization: expected });
}

console.log('station-credentials.test.mjs: secure migration and authenticated boundaries passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
