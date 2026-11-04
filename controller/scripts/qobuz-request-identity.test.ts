import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectExactRecording } from '../src/music/request-recording.js';
const song = { id: '1', title: 'Song', artist: 'The Artist', album: 'Album', duration: 200 };
test('exact recording shares artist/title normalization and edition distinctions', () => {
  assert.equal(selectExactRecording({ title: 'Song', artist: 'Artist' }, [song])?.id, '1');
  assert.equal(selectExactRecording({ title: 'Song', artist: 'Artist' }, [{ ...song, title: 'Song (Live)' }]), null);
  assert.equal(selectExactRecording({ title: 'Song (Live)', artist: 'Artist' }, [song]), null);
  assert.equal(selectExactRecording({ artist: 'Artist' }, [song]), null);
});
test('ambiguous title and unknown duplicate recordings never choose first result', () => {
  assert.equal(selectExactRecording({ title: 'Song' }, [song, { ...song, id: '2', artist: 'Other' }]), null);
  assert.equal(selectExactRecording({ title: 'Song', artist: 'Artist' }, [song, { ...song, id: '2' }]), null);
  assert.equal(selectExactRecording({ title: 'Song', artist: 'Artist' }, [{ ...song, isrc: 'ABC' }, { ...song, id: '2', isrc: 'ABC' }])?.id, '1');
});

const { probeRequestedRecording } = await import('../src/music/request-recording.js');
const baseCatalog = { searchPage: async () => ({ songs: [], rawCount: 0 }), resolveArtist: async () => null, getArtist: async () => null, getAlbum: async () => [], getTopSongs: async () => [], resolveGenreName: async () => null, getSongsByGenreSampled: async () => [] };
const deps = { catalog: baseCatalog, text: 'Play Song by Artist', recentIds: new Set<string>(), queuedIds: new Set<string>(), blocked: () => false, heldBack: () => false };
test('only complete successful local absence admits an external lookup', async () => {
  assert.equal((await probeRequestedRecording({ title: 'Song', artist: 'Artist' }, deps)).kind, 'absent');
  assert.equal((await probeRequestedRecording({ title: 'Song', artist: 'Artist' }, { ...deps, catalog: { ...baseCatalog, searchPage: async () => { throw new Error('offline'); } } })).kind, 'indeterminate');
  assert.equal((await probeRequestedRecording({ title: 'Song', artist: 'Artist' }, { ...deps, catalog: { ...baseCatalog, searchPage: async () => ({ songs: [], rawCount: 25 }) } })).kind, 'indeterminate');
  const withSong = { ...deps, catalog: { ...baseCatalog, searchPage: async () => ({ songs: [song], rawCount: 1 }) } };
  assert.equal((await probeRequestedRecording({ title: 'Song', artist: 'Artist' }, { ...withSong, blocked: () => true })).kind, 'refused');
  const cooldown = await probeRequestedRecording({ title: 'Song', artist: 'Artist' }, { ...withSong, recentIds: new Set(['1']) });
  assert.equal(cooldown.kind, 'found'); if (cooldown.kind === 'found') assert.equal(cooldown.outcome, 'cooldown');
});
test('artist-only, chat and unprovable hard conditions do not acquire external audio', async () => {
  assert.equal((await probeRequestedRecording({ artist: 'Artist', title: null, search_terms: ['Artist'] }, { ...deps, text: 'Play Artist' })).kind, 'not-specific');
  assert.equal((await probeRequestedRecording({ kind: 'chat', title: 'hello' }, deps)).kind, 'not-specific');
  assert.equal((await probeRequestedRecording({ title: 'Song', artist: 'Artist', language: 'French' }, { ...deps, text: 'Play Song by Artist in French' })).kind, 'indeterminate');
});
