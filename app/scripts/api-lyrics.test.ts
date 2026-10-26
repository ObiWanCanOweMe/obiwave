import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/lib/api.ts';

const payload = { songId: 'song one', synced: true, offsetMs: 0, lines: [{ startMs: 0, text: 'A line' }] };

test('lyrics combines scoped proxy credentials with the current station password', async t => {
  const requests: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  let password = 'first';
  const api = createApi('https://radio.example', { username: 'listener', password: 'proxy' }, () => password);
  assert.deepEqual(await api.currentLyrics('song one'), { kind: 'ok', payload });
  password = 'rotated';
  await api.currentLyrics('song one');
  for (const [index, request] of requests.entries()) {
    assert.equal(request.url, 'https://radio.example/api/lyrics/current?songId=song%20one');
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get('Authorization'), `Basic ${btoa('listener:proxy')}`);
    assert.equal(headers.get('x-station-auth'), index ? 'rotated' : 'first');
    assert.equal(request.init.cache, 'no-store');
  }
  await createApi('https://public.example').currentLyrics('song one');
  assert.equal(new Headers(requests[2].init.headers).get('Authorization'), null);
  assert.equal(new Headers(requests[2].init.headers).get('x-station-auth'), null);
});

test('lyrics deadlines cover a stalled response body and release the caller', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null = null;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => new Promise((_resolve, reject) => {
      signal = init.signal!;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }));
  const result = createApi('https://radio.example').currentLyrics('song one');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  t.mock.timers.tick(8000);
  assert.deepEqual(await result, { kind: 'unavailable', retryAfterSec: null });
  assert.equal((signal as unknown as AbortSignal).aborted, true);
});
