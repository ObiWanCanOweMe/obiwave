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
