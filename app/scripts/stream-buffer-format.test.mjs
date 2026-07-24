import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { bufferSecondsForFormat } from '../src/lib/streamBuffer.ts';

const stream = {
  bufferSeconds: 22,
  bufferSecondsByFormat: { mp3: 22, opus: 11, aac: 22, flac: 19 },
};
assert.equal(bufferSecondsForFormat(stream, 'opus'), 11);
assert.equal(bufferSecondsForFormat(stream, 'flac'), 19);
assert.equal(bufferSecondsForFormat({ bufferSeconds: 17 }, 'aac'), 17, 'legacy API fallback');
assert.equal(bufferSecondsForFormat(null, 'mp3'), null);

const stationFeedSource = readFileSync(new URL('../src/hooks/useStationFeed.ts', import.meta.url));
assert.equal(
  stationFeedSource.includes(0),
  false,
  'native station-feed TypeScript must not contain literal NUL bytes',
);

console.log('stream-buffer-format.test.mjs: native resolves its active-format delay');
