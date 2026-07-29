import assert from 'node:assert/strict';
import * as stationAuth from '../lib/stationAuth.ts';

const { clearStationAuthToken, setStationAuthToken, withStreamAuth } = stationAuth;

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  },
});

const stationA = 'https://station-a.example/api';
const stationB = 'https://station-b.example/api';
const tokenA = 'station A password/&';
const tokenB = 'station B password';

// The pre-fix global token must never be migrated or reused for any station.
values.set('subwave-station-auth', 'unsafe legacy password');
assert.equal(withStreamAuth(stationA, 'https://station-a.example/stream.mp3?t=123'), 'https://station-a.example/stream.mp3?t=123');
assert.equal(withStreamAuth(stationB, 'https://station-b.example/stream.mp3?t=123'), 'https://station-b.example/stream.mp3?t=123');

setStationAuthToken(stationA, tokenA);
for (const format of ['mp3', 'opus', 'aac', 'flac']) {
  assert.equal(
    withStreamAuth(stationA, `https://station-a.example/stream.${format}?t=123`),
    `https://station-a.example/stream.${format}?t=123&auth=${encodeURIComponent(tokenA)}`,
  );
}
assert.equal(
  withStreamAuth(stationB, 'https://station-b.example/stream.mp3?t=123'),
  'https://station-b.example/stream.mp3?t=123',
  'station A token must not leak into station B playback',
);
setStationAuthToken(stationB, tokenB);
assert.equal(
  withStreamAuth(stationB, 'https://station-b.example/stream.mp3?t=123'),
  `https://station-b.example/stream.mp3?t=123&auth=${encodeURIComponent(tokenB)}`,
);
clearStationAuthToken(stationA);
assert.equal(withStreamAuth(stationA, 'https://station-a.example/stream.mp3?t=123'), 'https://station-a.example/stream.mp3?t=123');
assert.equal(
  withStreamAuth(stationB, 'https://station-b.example/stream.mp3?t=123'),
  `https://station-b.example/stream.mp3?t=123&auth=${encodeURIComponent(tokenB)}`,
  'clearing station A must preserve station B credentials',
);

assert.equal(
  typeof stationAuth.stationAuthPresentation,
  'function',
  'station auth must expose public-mode presentation behavior',
);
const stationAuthPresentation = stationAuth.stationAuthPresentation as (
  required: boolean,
  phase: 'checking' | 'prompt' | 'ok',
) => { phase: 'checking' | 'prompt' | 'ok'; showGate: boolean };
assert.deepEqual(
  stationAuthPresentation(false, 'prompt'),
  { phase: 'ok', showGate: false },
  'disabling both privacy locks must clear a stale prompt immediately',
);
assert.deepEqual(
  stationAuthPresentation(true, 'prompt'),
  { phase: 'prompt', showGate: true },
  'a required password prompt must remain visible',
);
assert.equal(
  typeof stationAuth.stationAuthPhaseForContext,
  'function',
  'station auth must distinguish a public phase from private authorization',
);
const stationAuthPhaseForContext = stationAuth.stationAuthPhaseForContext as (
  required: boolean,
  apiBase: string,
  state: { required: boolean; apiBase: string; phase: 'checking' | 'prompt' | 'ok' },
) => 'checking' | 'prompt' | 'ok';
assert.equal(
  stationAuthPhaseForContext(true, stationA, {
    required: false,
    apiBase: stationA,
    phase: 'ok',
  }),
  'checking',
  'the first private render after public mode must synchronously require a fresh check',
);

let replacePlayerAudioElement: undefined | (<T>(
  elementRef: { current: T | null },
  cleanupRef: { current: (() => void) | null },
  next: T | null,
  bind: (element: T) => () => void,
) => void);
let teardownDetachedPlayerAudio: undefined | ((
  element: { pause: () => void; src: string },
  resetPlayback: () => void,
) => void);
let bindPlayerAudioEvents: any;
let playerAudioIsAdvancing: any;
let playerStatusAfterAudioEvent: any;
try {
  ({
    bindPlayerAudioEvents,
    playerAudioIsAdvancing,
    playerStatusAfterAudioEvent,
    replacePlayerAudioElement,
    teardownDetachedPlayerAudio,
  } = await import('../lib/playerAudioBinding.ts'));
} catch {
  // The assertion below records the intended RED before the binding seam exists.
}
assert.equal(
  typeof replacePlayerAudioElement,
  'function',
  'player must expose a behavioral audio-element replacement seam',
);
const elementRef = { current: null as { id: string } | null };
const cleanupRef = { current: null as (() => void) | null };
const lifecycle: string[] = [];
const bind = (element: { id: string }) => {
  lifecycle.push(`bind:${element.id}`);
  return () => lifecycle.push(`cleanup:${element.id}`);
};
replacePlayerAudioElement!(elementRef, cleanupRef, { id: 'a' }, bind);
replacePlayerAudioElement!(elementRef, cleanupRef, { id: 'b' }, bind);
replacePlayerAudioElement!(elementRef, cleanupRef, null, bind);
assert.deepEqual(lifecycle, ['bind:a', 'cleanup:a', 'bind:b', 'cleanup:b']);
assert.equal(elementRef.current, null);
assert.equal(cleanupRef.current, null);

assert.equal(
  typeof teardownDetachedPlayerAudio,
  'function',
  'detached player audio must expose an explicit playback teardown',
);
let tunedIn = true;
let status: 'idle' | 'connecting' | 'playing' = 'playing';
let pauseCalls = 0;
const detachedAudio = {
  src: 'https://station-a.example/stream.mp3?auth=secret',
  pause: () => { pauseCalls += 1; },
};
teardownDetachedPlayerAudio!(detachedAudio, () => {
  tunedIn = false;
  status = 'idle';
});
assert.equal(pauseCalls, 1);
assert.equal(detachedAudio.src, '');
assert.equal(tunedIn, false);
assert.equal(status, 'idle');

assert.equal(
  typeof bindPlayerAudioEvents,
  'function',
  'player media listeners must expose a behavioral binding seam',
);
assert.equal(
  typeof playerAudioIsAdvancing,
  'function',
  'player liveness must be derived from media progress',
);
assert.equal(
  typeof playerStatusAfterAudioEvent,
  'function',
  'player status transitions must expose a behavioral policy',
);

const movingAudio = { paused: false, readyState: 3, currentTime: 12 };
assert.equal(playerAudioIsAdvancing(movingAudio, 11), true);
assert.equal(playerAudioIsAdvancing({ ...movingAudio, paused: true }, 11), false);
assert.equal(playerAudioIsAdvancing({ ...movingAudio, readyState: 2 }, 11), false);
assert.equal(playerAudioIsAdvancing(movingAudio, 12), false);

assert.equal(playerStatusAfterAudioEvent('connecting', 'playing', movingAudio), 'playing');
assert.equal(playerStatusAfterAudioEvent('playing', 'waiting', movingAudio), 'connecting');
assert.equal(playerStatusAfterAudioEvent('playing', 'stalled', movingAudio), 'playing');
assert.equal(playerStatusAfterAudioEvent('connecting', 'timeupdate', movingAudio), 'playing');
assert.equal(
  playerStatusAfterAudioEvent('connecting', 'timeupdate', { ...movingAudio, readyState: 2 }),
  'connecting',
);
assert.equal(playerStatusAfterAudioEvent('playing', 'error', movingAudio), 'idle');

class FakeAudioEventTarget {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: EventListener): void {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new Event(name));
    }
  }
}

const eventRef = { current: null as FakeAudioEventTarget | null };
const eventCleanupRef = { current: null as (() => void) | null };
const eventLifecycle: string[] = [];
const bindEvents = (element: FakeAudioEventTarget) => {
  const unbind = bindPlayerAudioEvents(element, {
    playing: () => eventLifecycle.push(`${element.id}:playing`),
    waiting: () => eventLifecycle.push(`${element.id}:waiting`),
    stalled: () => eventLifecycle.push(`${element.id}:stalled`),
    timeupdate: () => eventLifecycle.push(`${element.id}:timeupdate`),
    error: () => eventLifecycle.push(`${element.id}:error`),
  });
  return () => {
    unbind();
    eventLifecycle.push(`${element.id}:cleanup`);
  };
};
const firstAudio = new FakeAudioEventTarget('a');
const secondAudio = new FakeAudioEventTarget('b');
replacePlayerAudioElement!(eventRef, eventCleanupRef, firstAudio, bindEvents);
firstAudio.dispatch('playing');
replacePlayerAudioElement!(eventRef, eventCleanupRef, secondAudio, bindEvents);
firstAudio.dispatch('error');
secondAudio.dispatch('stalled');
secondAudio.dispatch('timeupdate');
replacePlayerAudioElement!(eventRef, eventCleanupRef, null, bindEvents);
assert.deepEqual(eventLifecycle, [
  'a:playing',
  'a:cleanup',
  'b:stalled',
  'b:timeupdate',
  'b:cleanup',
]);

console.log('stream-auth-format: all assertions passed');
