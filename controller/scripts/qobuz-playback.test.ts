import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrackPlayback, isQobuzTrack, invalidateQobuzPlaybackProof, qobuzPlaybackProofStands } from '../src/music/track-source.js';
import { annotateTrackUri } from '../src/music/track-annotation.js';
const track = { id: 'qobuz:123', title: 'Song', artist: 'Artist', album: 'Album', providerRef: { provider: 'qobuz' as const, trackId: '123', accountKey: 'a'.repeat(64), generation: '11111111-1111-4111-8111-111111111111' } };
test('cached playback requires direct mixer proof and never uses a Subsonic fallback', async () => {
  const deps = { cachePath: async () => '/state/qobuz-cache/file.flac', readable: async () => 'yes' as const };
  const proof = await resolveTrackPlayback(track, { timeoutMs: 100 }, deps);
  assert.equal(proof.localPath, '/state/qobuz-cache/file.flac'); assert.equal(proof.resolveProbeId, undefined);
  assert.ok(qobuzPlaybackProofStands(proof)); invalidateQobuzPlaybackProof(); assert.equal(qobuzPlaybackProofStands(proof), false);
  assert.ok(isQobuzTrack(track));
  await assert.rejects(resolveTrackPlayback(track, { timeoutMs: 100 }, { ...deps, readable: async () => 'unknown' as const }), /unavailable/);
  await assert.rejects(resolveTrackPlayback(track, { timeoutMs: 100 }, { ...deps, cachePath: async () => null }), /unavailable/);
});
test('source-independent annotation preserves opaque identity and timing', () => {
  const uri = annotateTrackUri(track, '/state/cache/file.flac', { cueInSec: 1, cueOutSec: 150 });
  assert.ok(uri.endsWith(':/state/cache/file.flac'));
  assert.ok(uri.includes('subsonic_id="qobuz:123"'));
  assert.ok(uri.includes('liq_cue_in="1"')); assert.ok(uri.includes('liq_cue_out="150"'));
  assert.equal(uri.includes('subhttp'), false);
});
