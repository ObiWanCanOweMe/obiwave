import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StationReadsProvider } from '../components/player/StationGate.tsx';
import { useTrackLyrics, type TrackLyrics } from '../components/skins/lyrics.ts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: storage, addEventListener: () => {}, removeEventListener: () => {},
  setTimeout, clearTimeout,
} });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
const requests = new Map<string, (response: Response) => void>();
globalThis.fetch = ((url: string) => new Promise<Response>(resolve => {
  requests.set(new URL(url, 'http://test').searchParams.get('songId')!, resolve);
})) as typeof fetch;
let track!: TrackLyrics;
function Harness({ id }: { id: string | null }) {
  // Expose the mounted hook to assertions outside React.
  // eslint-disable-next-line react-hooks/globals
  track = useTrackLyrics(id);
  return null;
}
const reply = (id: string) => new Response(JSON.stringify({ songId: id, synced: true, offsetMs: 0, lines: [{ startMs: 0, text: id }] }));
test('old and hidden generations cannot publish lyrics', async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Harness, { id: 'old' })); });
  await act(async () => { renderer.update(createElement(Harness, { id: 'new' })); });
  await act(async () => { requests.get('new')!(reply('new')); });
  assert.equal(track.lyrics?.songId, 'new');
  await act(async () => { requests.get('old')!(reply('old')); });
  assert.equal(track.lyrics?.songId, 'new', 'a late previous generation cannot replace current lyrics');
  await act(async () => { renderer.update(createElement(Harness, { id: 'hidden' })); });
  await act(async () => { renderer.update(createElement(Harness, { id: null })); });
  await act(async () => { requests.get('hidden')!(reply('hidden')); });
  assert.equal(track.status, 'idle');
  assert.equal(track.lyrics, null, 'hiding lyrics invalidates an in-flight result');
  await act(async () => { renderer.unmount(); });

});

test('stream-only privacy defers lyrics until the shell has verified its password', async () => {
  requests.clear();
  const render = (open: boolean) => createElement(StationReadsProvider, { value: open }, createElement(Harness, { id: 'private-track' }));
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(render(false)); });
    assert.equal(requests.size, 0, 'a locked station must not spend an unauthenticated lyrics attempt');
    await act(async () => { renderer.update(render(true)); });
    assert.ok(requests.has('private-track'), 'unlock asks for the current song without waiting for a track change');
    await act(async () => { requests.get('private-track')!(reply('private-track')); });
    assert.equal(track.lyrics?.songId, 'private-track');
  } finally {
    await act(async () => { renderer.unmount(); });
  }
});
