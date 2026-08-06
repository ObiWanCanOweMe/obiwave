import assert from 'node:assert/strict';
import { createElement, Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePlayer, type Player } from '../hooks/usePlayer.ts';
import { preferenceKey, streamEnablementFor } from '../lib/audioFormat.ts';
import { StationOriginProvider, type StationOrigin } from '../lib/stationOrigin.ts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const values = new Map<string, string>([[preferenceKey('/api'), 'opus']]);
let preferenceReads = 0;
const storage = {
  getItem: (key: string) => {
    if (key === preferenceKey('/api')) preferenceReads += 1;
    return values.get(key) ?? null;
  },
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const browserWindow = {
  localStorage: storage,
  addEventListener: () => {},
  removeEventListener: () => {},
};
const browserDocument = {
  visibilityState: 'visible',
  createElement: () => ({ canPlayType: () => 'probably' }),
  addEventListener: () => {},
  removeEventListener: () => {},
};
Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument });
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 Chrome/140', maxTouchPoints: 0 },
});

const origin: StationOrigin = {
  apiUrl: '/api',
  streams: {
    mp3: '/stream.mp3',
    opus: '/stream.opus',
    aac: '/stream.aac',
    flac: '/stream.flac',
  },
};

interface StreamState {
  opusEnabled: boolean;
  aacEnabled: boolean;
  flacEnabled: boolean;
}

let commits = 0;
const RENDER_LOOP_GUARD = 20;
const recordCommit: ProfilerOnRenderCallback = () => {
  commits += 1;
  assert.ok(
    commits <= RENDER_LOOP_GUARD,
    `format hydration did not settle after ${RENDER_LOOP_GUARD} commits`,
  );
};

function Harness({ stream }: { stream: StreamState }) {
  // This is PlayerCore's pre-fix call shape: streamEnablementFor returns a new
  // object on every render even when the advertised flags did not change.
  const player: Player = usePlayer({ streamEnablement: streamEnablementFor(stream) });
  return createElement('output', {
    'data-format': player.format,
    'data-opus-available': player.availability.opus.available,
  });
}

function tree(stream: StreamState) {
  return createElement(
    Profiler,
    { id: 'player-format-hydration', onRender: recordCommit },
    createElement(
      StationOriginProvider,
      { value: origin },
      createElement(Harness, { stream }),
    ),
  );
}

function output(renderer: ReactTestRenderer) {
  return renderer.root.findByType('output').props;
}

async function main() {
  const unavailable = { opusEnabled: false, aacEnabled: false, flacEnabled: false };
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(tree(unavailable)); });
    assert.equal(preferenceReads, 1, 'initial preference hydration runs exactly once');
    assert.equal(output(renderer)['data-format'], 'mp3', 'an unavailable persisted Opus preference falls back to MP3');
    assert.equal(output(renderer)['data-opus-available'], false, 'unadvertised Opus stays unavailable');

    const commitsAfterMount = commits;
    await act(async () => {
      renderer.update(tree({ ...unavailable, opusEnabled: true }));
    });
    assert.equal(preferenceReads, 2, 'a real advertised-mount change rehydrates exactly once');
    assert.equal(output(renderer)['data-format'], 'opus', 'the persisted Opus preference activates once advertised');
    assert.equal(output(renderer)['data-opus-available'], true, 'advertised supported Opus becomes available');
    assert.equal(commits - commitsAfterMount, 2, 'the advertised change commits once, then settles once');

    const commitsAfterChange = commits;
    await act(async () => {
      renderer.update(tree({ ...unavailable, opusEnabled: true }));
    });
    assert.equal(preferenceReads, 2, 'same scalar flags in a fresh object do not rehydrate again');
    assert.equal(commits - commitsAfterChange, 1, 'an equivalent parent update settles immediately');
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
  }

  console.log('player-format-hydration.test.ts: unstable objects settle and real mount changes hydrate once');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
