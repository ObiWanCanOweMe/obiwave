import assert from 'node:assert/strict';

import { streamBufferSecondsByFormat } from '../src/broadcast/stream-buffer.js';

assert.deepEqual(streamBufferSecondsByFormat(22), {
  mp3: 22,
  opus: 0,
  aac: 22,
  flac: 0,
});
assert.deepEqual(streamBufferSecondsByFormat(0), {
  mp3: 0,
  opus: 0,
  aac: 0,
  flac: 0,
});

console.log('stream-buffer-formats.test.ts: API publishes exact per-format delays');
