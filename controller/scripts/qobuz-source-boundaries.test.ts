import test from 'node:test';
import assert from 'node:assert/strict';
import * as subsonic from '../src/music/subsonic.js';
import { planNavidrome } from '../src/broadcast/scrobble-pure.js';
import { listenerLyrics, onTrackQueued, onTrackStarted } from '../src/music/lyrics-sources.js';
import { resolveGainDb } from '../src/music/loudness.js';
import { isExternalTrackId } from '../src/music/track-source.js';
import * as settings from '../src/settings.js';
import { queue } from '../src/broadcast/queue.js';
import * as likes from '../src/broadcast/likes.js';

test('external IDs never become Navidrome reads, stream URLs or scrobble plans', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('external ID leaked to Navidrome'); });
  assert.equal(await subsonic.getSong('qobuz:123'), null);
  assert.deepEqual(await subsonic.getSimilarSongs('qobuz:123'), []);
  assert.deepEqual(await subsonic.getSonicSimilarTracks('qobuz:123'), []);
  assert.throws(() => subsonic.getStreamUrl('qobuz:123'), /external/i);
  assert.throws(() => subsonic.getRawStreamUrl('qobuz:123'), /external/i);
  const plan = planNavidrome({ enabled: true, configured: true, incoming: { id: 'qobuz:123', duration: 200 }, outgoing: { id: 'qobuz:123', duration: 200 }, outgoingStartedAt: new Date(Date.now()-150000).toISOString() });
  assert.equal(plan.nowPlayingId, null); assert.equal(plan.submitId, null);
  assert.equal(calls, 0); assert.equal(isExternalTrackId('qobuz:123'), true);
});
test('external lyrics, gain and public projections use metadata without leaking private references', async t => {
  await settings.load(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('unexpected provider lookup'); });
  const lyrics = await listenerLyrics('qobuz:123'); assert.equal(lyrics.lyrics, null); assert.equal(lyrics.pending, false);
  onTrackQueued('qobuz:123'); onTrackStarted('qobuz:123');
  assert.equal(await resolveGainDb({ id: 'qobuz:123' }), null);
  queue.upcoming = [{ track: { id: 'qobuz:123', title: 'Song', artist: 'Artist', providerRef: { provider: 'qobuz', trackId: '123', accountKey: 'private-account', generation: 'private-generation' } } }];
  const publicData = JSON.stringify(queue.snapshot()); assert.equal(publicData.includes('private-account'), false); assert.equal(publicData.includes('private-generation'), false);
  queue.upcoming = []; assert.equal(calls, 0);
});
test('external metadata likes never seed local discovery', async () => {
  await likes.load(); await likes.operatorLike({ id: 'qobuz:123', title: 'Song', artist: 'Artist' });
  assert.equal(likes.djFavourites({ enabled: true, influenceDj: true }).some(row => row.track.id === 'qobuz:123'), false);
});
