import assert from 'node:assert/strict';
import test from 'node:test';
import { nowPlayingProgress, trackElapsedSeconds } from '../src/lib/track-progress.ts';
import { bufferSecondsForFormat } from '../src/lib/streamBuffer.ts';

const LIVE_START = Date.parse('2026-10-11T12:00:00Z');
const AUDIBLE_START = LIVE_START + 22000;

test('the player and media session use listener time, including the 22s buffer', () => {
  const now = LIVE_START + 65000;
  assert.equal(trackElapsedSeconds(AUDIBLE_START, now), 43);
  assert.deepEqual(nowPlayingProgress({
    track: { duration: 180 }, trackStartedAt: AUDIBLE_START, talking: false, now,
  }), { duration: 180, elapsedTime: 43 });
});

test('a buffered future start stays at zero; media progress stops at the song duration', () => {
  assert.equal(trackElapsedSeconds(AUDIBLE_START, LIVE_START), 0);
  assert.deepEqual(nowPlayingProgress({
    track: { duration: 180 }, trackStartedAt: AUDIBLE_START, talking: false,
    now: AUDIBLE_START + 300000,
  }), { duration: 180, elapsedTime: 180 });
});

test('background refreshes derive elapsed from the absolute stamp, not a sleeping UI timer', () => {
  for (const seconds of [0, 30, 90]) {
    assert.equal(nowPlayingProgress({
      track: { duration: 180 }, trackStartedAt: AUDIBLE_START, talking: false,
      now: AUDIBLE_START + seconds * 1000,
    }).elapsedTime, seconds);
  }
});

test('DJ speech and unknown duration omit both clock fields instead of publishing zero', () => {
  assert.deepEqual(nowPlayingProgress({
    track: { duration: 180 }, trackStartedAt: AUDIBLE_START, talking: true,
  }), {});
  for (const duration of [undefined, 0, -1, NaN, Infinity]) {
    assert.deepEqual(nowPlayingProgress({
      track: { duration }, trackStartedAt: AUDIBLE_START, talking: false,
    }), {});
  }
  assert.deepEqual(nowPlayingProgress({
    track: null, trackStartedAt: AUDIBLE_START, talking: false,
  }), {});
});

test('a missing start omits elapsed and a new song resets to its own clock', () => {
  assert.deepEqual(nowPlayingProgress({
    track: { duration: 180 }, trackStartedAt: null, talking: false,
  }), { duration: 180 });
  assert.deepEqual(nowPlayingProgress({
    track: { duration: 240 }, trackStartedAt: AUDIBLE_START + 180000, talking: false,
    now: AUDIBLE_START + 181000,
  }), { duration: 240, elapsedTime: 1 });
});

test('media progress shares the selected mount buffer and legacy fallback with the feed', () => {
  const stream = { bufferSeconds: 22, bufferSecondsByFormat: { mp3: 22, opus: 11, aac: 22, flac: 19 } };
  for (const format of ['mp3', 'opus', 'aac', 'flac'] as const) {
    const delay = bufferSecondsForFormat(stream, format)!;
    assert.equal(nowPlayingProgress({
      track: { duration: 180 }, trackStartedAt: LIVE_START + delay * 1000,
      talking: false, now: LIVE_START + 65000,
    }).elapsedTime, 65 - delay);
  }
  assert.equal(bufferSecondsForFormat({ bufferSeconds: 17 }, 'aac'), 17);
});
