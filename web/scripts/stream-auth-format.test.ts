import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
try {
  ({ replacePlayerAudioElement, teardownDetachedPlayerAudio } = await import('../lib/playerAudioBinding.ts'));
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

const source = readFileSync(new URL('../hooks/usePlayer.ts', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../components/player/PlayerShell.tsx', import.meta.url), 'utf8');
const assignmentPattern = /\b(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*\.src\s*=\s*([^;]+);/g;

assert.equal(
  [...'playerNode.src = unauthenticatedUrl;'.matchAll(assignmentPattern)].length,
  1,
  'playback assignment scanner must catch arbitrary audio-element aliases',
);

assert.match(
  source,
  /audioElementRef:\s*RefCallback<HTMLAudioElement>/,
  'player must expose a callback ref so a post-unlock audio mount binds listeners',
);
assert.match(
  shellSource,
  /<audio\s+ref=\{audioElementRef\}/,
  'shell must attach the callback ref to each mounted audio element',
);
assert.match(
  source,
  /replacePlayerAudioElement\(audioRef,\s*audioListenerCleanupRef,\s*el,/,
  'each callback-ref attachment must detach the prior audio element before rebinding',
);
assert.match(
  source,
  /teardownDetachedPlayerAudio\(boundEl,[\s\S]*setTunedIn\(false\);[\s\S]*setStatus\('idle'\);/,
  'audio detach must reset the hook playback state before unlock remounts a fresh node',
);
for (const event of ['playing', 'waiting', 'stalled', 'error']) {
  assert.match(source, new RegExp(`addEventListener\\('${event}'`), `missing ${event} listener`);
  assert.match(source, new RegExp(`removeEventListener\\('${event}'`), `missing ${event} cleanup`);
}

const assignments = [...source.matchAll(assignmentPattern)]
  .map((match) => match[1])
  .filter((expression): expression is string =>
    typeof expression === 'string' && expression.trim() !== "''"
  );
assert.equal(assignments.length, 3, 'expected exactly tune, switch, and reconnect playback assignments');
for (const expression of assignments) {
  assert.match(
    expression,
    /withStreamAuth\(apiUrl,/,
    `playback assignment is not scoped to the active station: ${expression}`,
  );
}

console.log('stream-auth-format: all assertions passed');
