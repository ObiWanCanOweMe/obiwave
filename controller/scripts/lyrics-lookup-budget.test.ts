// Queue bursts must not retain an unbounded LRCLIB request backlog. A busy
// lyrics lookup degrades immediately and is eligible again once room opens.
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createTempDir, removeTempDir } from './test-utils/temp-dir.js';

const stateDir = createTempDir(join(tmpdir(), 'subwave-lyrics-budget-'));
process.env.STATE_DIR = stateDir;
const held: ServerResponse[] = [];
let release = false;
const answer = (res: ServerResponse) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', song: {} } }));
};
const server = createServer((_req, res) => release ? answer(res) : held.push(res));
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.NAVIDROME_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.NAVIDROME_USER = 'test';
process.env.NAVIDROME_PASS = 'test';
const settings = await import('../src/settings.js');
const { ensureLookup, onTrackQueued } = await import('../src/music/lyrics-sources.js');

test('a queue burst has bounded pending lyrics work and can retry after it drains', async () => {
  await settings.load();
  const pending: Array<Promise<void>> = [];
  try {
    for (let i = 0; i < 32; i++) {
      const lookup = ensureLookup(`queued-${i}`, null);
      assert.ok(lookup, 'a free slot accepts work');
      pending.push(lookup);
    }
    assert.equal(ensureLookup('queued-0', null), pending[0], 'an existing track still joins its lookup');
    const overflow = ensureLookup('overflow', null);
    if (overflow) pending.push(overflow);
    assert.equal(overflow, null, 'a full backlog declines new work immediately');
  } finally {
    release = true;
    for (const res of held) answer(res);
    await Promise.all(pending);
  }
  const retried = ensureLookup('overflow', null);
  assert.ok(retried, 'declining work must not stamp a failed lookup or a stored miss');
  await retried;
});

test('background admission is bounded before music-server preflight begins', async () => {
  release = false;
  held.length = 0;
  const pending: Array<Promise<void>> = [];
  try {
    for (let i = 0; i < 32; i++) onTrackQueued(`background-${i}`);
    const overflow = ensureLookup('background-overflow', null);
    if (overflow) pending.push(overflow);
    // Background offers must already own their slots, before any async read.
    for (let i = 0; i < 32; i++) {
      const joined = ensureLookup(`background-${i}`, null);
      assert.ok(joined, 'same-track callers join at capacity');
      pending.push(joined);
    }
    assert.equal(overflow, null);
  } finally {
    release = true;
    for (const res of held) answer(res);
    await Promise.all(pending);
  }
});

test.after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await removeTempDir(stateDir);
});
