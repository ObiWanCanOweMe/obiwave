import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/lib/api.ts';
import { pollAsync } from '../src/lib/poll.ts';

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

for (const cancel of ['deadline', 'station change'] as const) {
  test(`a stalled JSON body is cancelled after headers by ${cancel}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const bodies: AbortSignal[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        const signal = init.signal!;
        bodies.push(signal);
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    }));
    const api = createApi('https://radio.example');
    let failures = 0;
    const stop = pollAsync(async signal => {
      try { await api.nowPlaying(signal); }
      catch { failures++; }
    }, 5000);
    t.after(stop);
    await settle();
    assert.equal(bodies.length, 1, 'headers arrived and JSON consumption started');
    if (cancel === 'deadline') t.mock.timers.tick(8000);
    else stop();
    await settle();
    assert.equal(bodies[0]?.aborted, true);
    assert.equal(failures, 1, 'body consumption settles after cancellation');
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(bodies.length, cancel === 'deadline' ? 2 : 1,
      'deadline releases serialized polling; station change prevents new requests');
  });
}
