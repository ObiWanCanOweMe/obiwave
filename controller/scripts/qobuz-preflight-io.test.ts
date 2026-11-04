import test from 'node:test';
import assert from 'node:assert/strict';
import * as subsonic from '../src/music/subsonic.js';
import { probeRequestedRecording } from '../src/music/request-recording.js';
test('strict absence proof propagates secondary artist-index failures', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    return url.searchParams.get('query') === 'Example Artist'
      ? Response.json({ 'subsonic-response': { status: 'ok', searchResult3: { artist: [] } } })
      : new Response('unavailable', { status: 503 });
  });
  const options = { artistCount: 10, requireComplete: true };
  await assert.rejects(subsonic.resolveArtist('Example Artist', options));
});
test('a stalled local preflight cannot consume the request ledger lifetime', { timeout: 2000 }, async () => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20);
  const catalog = { searchPage: () => new Promise<never>(() => {}), resolveArtist: async () => null, getArtist: async () => null, getAlbum: async () => [], getTopSongs: async () => [], resolveGenreName: async () => null, getSongsByGenreSampled: async () => [] };
  const deps = { catalog, signal: controller.signal, text: 'Play Song by Artist', recentIds: new Set<string>(), queuedIds: new Set<string>(), blocked: () => false, heldBack: () => false };
  try { assert.equal((await probeRequestedRecording({title:'Song',artist:'Artist'}, deps)).kind, 'indeterminate'); }
  finally { clearTimeout(timer); }
});
