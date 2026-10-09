import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/lib/api';

// A station password gate can sit behind a separate HTTP proxy login.
test('station auth keeps proxy credentials scoped and reads stream passwords at call time', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { status: 200 };
  });
  let password: string | null = null;
  const api = createApi('https://radio.example', { username: 'listener', password: 'proxy-secret' }, () => password);
  const expected = { Authorization: 'Basic bGlzdGVuZXI6cHJveHktc2VjcmV0' };
  assert.equal(await api.checkStationAuth('station-secret'), 'ok');
  assert.equal(calls[0].url, 'https://radio.example/api/station-auth');
  assert.deepEqual(calls[0].init.headers, { ...expected, 'Content-Type': 'application/json' });
  assert.equal(calls[0].init.body, JSON.stringify({ password: 'station-secret' }));
  assert.equal(api.streamUrl(), 'https://radio.example/stream.mp3');
  password = 'station & secret';
  for (const format of ['mp3', 'aac', 'opus', 'flac'] as const) {
    assert.equal(api.streamUrl(format), `https://radio.example/stream.${format}?auth=station%20%26%20secret`);
  }
  assert.deepEqual(api.streamHeaders(), expected);
  assert.deepEqual(api.avatar('https://images.example/avatar.png'), { uri: 'https://images.example/avatar.png' });
  const other = createApi('https://other.example');
  assert.equal(other.streamUrl(), 'https://other.example/stream.mp3');
  assert.equal(other.streamHeaders(), undefined);
});

test('station-auth network failures remain unavailable', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network unavailable'); });
  assert.equal(await createApi('https://radio.example').checkStationAuth('secret'), 'unavailable');
});
