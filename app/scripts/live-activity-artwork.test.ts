import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../src/lib/api';
import { resolveAirCard } from '../src/lib/air-card';

const track = {
  title: 'Private cut',
  artist: 'Resident',
  album: 'Archive',
  duration: 241,
  subsonic_id: 'shared-track-id',
};

test('a cached same-id cover cannot cross station boundaries', () => {
  const stationA = createApi('https://alice:station-a-secret@alpha.example.test/private');
  const stationB = createApi('https://bob:station-b-secret@beta.example.test/private');
  const cardA = resolveAirCard({
    api: stationA,
    nowPlaying: track,
    activeShow: null,
    talking: false,
  });
  const cardB = resolveAirCard({
    api: stationB,
    nowPlaying: track,
    activeShow: null,
    talking: false,
  });

  assert.ok(cardA.artworkKey);
  assert.ok(cardB.artworkKey);
  const cache = new Map([[cardA.artworkKey, 'alpha-private-cover.img']]);

  assert.equal(cache.get(cardB.artworkKey), undefined);
  assert.notEqual(cardA.artworkKey, cardB.artworkKey);
  assert.doesNotMatch(cardA.artworkKey, /alice|station-a-secret|Basic/i);
  assert.doesNotMatch(cardB.artworkKey, /bob|station-b-secret|Basic/i);
});

test('an in-flight same-avatar result cannot become the new station artwork', () => {
  const stationA = createApi('https://alpha.example.test');
  const stationB = createApi('https://beta.example.test');
  const activeShow = {
    name: 'Night Shift',
    persona: {
      id: 'resident',
      name: 'Resident',
      avatar: '/api/persona-avatar/shared',
    },
  };
  const cardA = resolveAirCard({ api: stationA, nowPlaying: track, activeShow, talking: true });
  const cardB = resolveAirCard({ api: stationB, nowPlaying: track, activeShow, talking: true });
  assert.ok(cardA.artworkKey);
  assert.ok(cardB.artworkKey);

  let currentArtworkKey = cardA.artworkKey;
  const accepted: string[] = [];
  const complete = (key: string, filename: string) => {
    if (currentArtworkKey === key) accepted.push(filename);
  };

  // The listener changes station before the first station's private avatar
  // download completes. The native completion guard compares these exact keys.
  currentArtworkKey = cardB.artworkKey;
  complete(cardA.artworkKey, 'alpha-private-avatar.img');

  assert.deepEqual(accepted, []);
  assert.notEqual(cardA.artworkKey, cardB.artworkKey);
});
