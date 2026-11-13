// Regression pin for cache-side era overrides (#1418).
// Run from web/: `npm test -- library/queries`.

import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { applyEraYearEvent, libraryKeys, rowsOf } from './queries';
import type { Track } from './types';

const qc = new QueryClient();
const target: Track = {
  id: 'target', title: 'Song A', artist: 'Artist A', album: 'Greatest Hits',
  originalYear: 1978, originalYearSource: 'manual',
};
const sibling: Track = {
  id: 'sibling', title: 'Song B', artist: 'Artist A', album: 'Greatest Hits',
  originalYear: 1972, originalYearSource: 'musicbrainz',
};
const tagged: Track = {
  id: 'tagged', title: 'Song D', artist: 'Artist A', album: 'Greatest Hits',
  originalYear: 1973, originalYearSource: 'album-tag',
};
const namesake: Track = { id: 'namesake', title: 'Song C', artist: 'Artist B', album: 'Greatest Hits' };

qc.setQueryData(libraryKeys.recent(), [target, sibling, tagged, namesake]);

applyEraYearEvent(qc, {
  tracks: [
    { id: 'target', originalYear: null, originalYearSource: null },
    { id: 'sibling', originalYear: 1972, originalYearSource: 'musicbrainz' },
    { id: 'tagged', originalYear: 1973, originalYearSource: 'album-tag' },
  ],
});

const rows = rowsOf(qc.getQueryData(libraryKeys.recent()));
assert.deepEqual(
  rows.filter((r) => r.id !== 'namesake').map((r) => ({
    id: r.id,
    originalYear: r.originalYear,
    originalYearSource: r.originalYearSource,
  })),
  [
    { id: 'target', originalYear: null, originalYearSource: null },
    { id: 'sibling', originalYear: 1972, originalYearSource: 'musicbrainz' },
    { id: 'tagged', originalYear: 1973, originalYearSource: 'album-tag' },
  ],
  'a mixed-source clear must patch each row from the authoritative server value',
);
assert.equal(rows.find((r) => r.id === 'namesake')?.originalYear, undefined,
  'a same-title album outside the server response must remain untouched');

// The Era tab's album track list shows the saved year at once, not its old
// one until the refetch (the field falls back to the album year meanwhile).
const eraKey = libraryKeys.eraAlbum('greatest-hits');
qc.setQueryData(eraKey, { tracks: [
  { id: 'target', originalYear: null, originalYearSource: null, yearState: 'unchecked' },
  { id: 'other', originalYear: 1990, originalYearSource: 'musicbrainz', yearState: 'resolved' },
] });
applyEraYearEvent(qc, { tracks: [{ id: 'target', originalYear: 1975, originalYearSource: 'manual' }] });
const era = qc.getQueryData<{ tracks: Array<{ id: string; originalYear: number | null; originalYearSource: string | null; yearState: string }> }>(eraKey);
assert.deepEqual(era?.tracks.find((t) => t.id === 'target'),
  { id: 'target', originalYear: 1975, originalYearSource: 'manual', yearState: 'resolved' });
assert.equal(era?.tracks.find((t) => t.id === 'other')?.originalYear, 1990, 'another line keeps its year');
// A clear uses the server's resolved result, including an automatic fallback.
applyEraYearEvent(qc, { tracks: [{ id: 'target', originalYear: 1972, originalYearSource: 'musicbrainz' }] });
assert.deepEqual(qc.getQueryData<{ tracks: Array<{ id: string; originalYear: number | null; originalYearSource: string | null; yearState: string }> }>(eraKey)?.tracks[0],
  { id: 'target', originalYear: 1972, originalYearSource: 'musicbrainz', yearState: 'resolved' });

console.log('era-year cache targeting passed');
