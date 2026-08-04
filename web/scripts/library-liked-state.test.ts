import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';

import LibraryPanel from '../components/admin/LibraryPanel.tsx';
import {
  acceptLibraryResponse,
  beginLibraryRequest,
  clampLibraryPage,
} from '../components/admin/libraryState.ts';
import { V3AlertDialog } from '../components/ui/alert-dialog.tsx';
import type { Track } from '../components/admin/library/types.ts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A mutation can empty the last page while leaving a non-zero total. The UI
// must navigate to the newest valid page instead of stranding the operator on
// an empty offset.
assert.equal(clampLibraryPage(3, 21, 10), 2);
assert.equal(clampLibraryPage(1, 0, 10), 0);

// A new offset owns a new generation. An older page response that finishes
// later must not replace it.
let activeGeneration = 0;
const olderOffset = beginLibraryRequest({
  generation: activeGeneration,
  page: 3,
  pageSize: 10,
});
activeGeneration = olderOffset.generation;
assert.deepEqual(olderOffset, { generation: 1, offset: 30 });

const newerOffset = beginLibraryRequest({
  generation: activeGeneration,
  page: 0,
  pageSize: 10,
});
activeGeneration = newerOffset.generation;
assert.deepEqual(newerOffset, { generation: 2, offset: 0 }, 'mode changes reset paging before requesting');
assert.equal(acceptLibraryResponse(activeGeneration, olderOffset.generation), false);
assert.equal(acceptLibraryResponse(activeGeneration, newerOffset.generation), true);

// Sorting also resets the offset, and its new generation invalidates the
// response that belonged to the previous sort.
const priorSort = beginLibraryRequest({
  generation: activeGeneration,
  page: 2,
  pageSize: 10,
});
activeGeneration = priorSort.generation;
const changedSort = beginLibraryRequest({
  generation: activeGeneration,
  page: 0,
  pageSize: 10,
});
activeGeneration = changedSort.generation;
assert.equal(changedSort.offset, 0, 'sort changes request page zero');
assert.equal(acceptLibraryResponse(activeGeneration, priorSort.generation), false);

// Entering Liked mode starts another generation. A response from the prior
// mode cannot become the Liked table merely because it arrives afterwards.
const priorMode = changedSort;
const likedMode = beginLibraryRequest({
  generation: activeGeneration,
  page: 0,
  pageSize: 10,
});
activeGeneration = likedMode.generation;
assert.equal(acceptLibraryResponse(activeGeneration, priorMode.generation), false);
assert.equal(acceptLibraryResponse(activeGeneration, likedMode.generation), true);

// Pin the simple equality contract independently of the scenarios above.
assert.equal(acceptLibraryResponse(8, 7), false);
assert.equal(acceptLibraryResponse(8, 8), true);

function textContent(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

interface PendingRequest {
  path: string;
  init: RequestInit;
  resolve: (response: Response) => void;
}

const track = (id: string, title: string, likeCount = 4): Track => ({
  id,
  title,
  artist: 'The Testers',
  album: 'Controlled Responses',
  genre: 'Test',
  year: 2026,
  duration: 180,
  moods: ['focused'],
  energy: 'medium',
  source: 'manual',
  taggedAt: '2026-08-04T12:00:00.000Z',
  bpm: 120,
  musicalKey: 'C',
  loudnessLufs: -14,
  paceMean: 0.5,
  instrumental: false,
  similarity: null,
  likeCount,
  likedByOperator: true,
  lastLikedAt: '2026-08-04T12:00:00.000Z',
  blockedBy: null,
});

const trackWithoutInlineLikes = (id: string, title: string): Track => {
  const value = track(id, title);
  delete value.likeCount;
  delete value.likedByOperator;
  delete value.lastLikedAt;
  return value;
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

async function verifyLibraryPanelOwnsAsyncResultsAndClearMutations() {
  const saved = {
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };
  const likedRequests: PendingRequest[] = [];
  const likeIndexRequests: PendingRequest[] = [];
  const operatorMutationRequests: PendingRequest[] = [];
  const deleteRequests: Array<{ path: string; method: string }> = [];
  const storage = new Map<string, string>([['subwave_admin_auth', 'test-token']]);

  const controlledFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    const method = init.method || 'GET';
    if (path.startsWith('/api/library/liked?')) {
      return new Promise<Response>(resolve => {
        likedRequests.push({ path, init, resolve });
      });
    }
    if (path.endsWith('/operator') && method === 'DELETE') {
      return new Promise<Response>(resolve => {
        operatorMutationRequests.push({ path, init, resolve });
      });
    }
    if (path.startsWith('/api/likes/song/') && method === 'DELETE') {
      deleteRequests.push({ path, method });
      return jsonResponse({ ok: true, removed: 4 });
    }
    if (path === '/api/library/coverage') {
      return jsonResponse({
        tagged: 0,
        analysed: 0,
        audioEmbedded: 0,
        vocalAnalyzed: 0,
        total: 0,
        percent: 0,
        analysedPercent: 0,
        audioEmbeddedPercent: 0,
        vocalAnalyzedPercent: 0,
        vocalWanted: false,
        scannedAt: '2026-08-04T12:00:00.000Z',
        scanning: false,
        analysisAvailable: false,
        analysisBackend: null,
        audioAnalysisAvailable: false,
        soundSearchAvailable: false,
        vocalAnalysisAvailable: false,
        embeddedModel: null,
        embeddedDim: null,
        currentEmbeddingModel: null,
        embeddingStale: false,
        embeddingFormatStale: false,
        embeddedTextFormat: null,
        currentTextFormat: null,
        embeddedVectors: 0,
        labelOnlyVectors: 0,
        audioStatus: 'off',
        vocalStatus: 'off',
      });
    }
    if (path === '/api/library/tagger') return jsonResponse({ tagger: null });
    if (path === '/api/library/genres') return jsonResponse({ genres: [] });
    if (path === '/api/likes/index') {
      return new Promise<Response>(resolve => {
        likeIndexRequests.push({ path, init, resolve });
      });
    }
    if (path === '/api/settings') {
      return jsonResponse({
        tagger: null,
        libraryStats: {
          total: 0,
          byMood: {},
          byEnergy: {},
          byGenre: {},
          withEmbedding: 0,
          updatedAt: null,
        },
        values: {
          audio: {
            embeddings: false,
            vocalActivity: false,
            analyzeQuietOnly: false,
            analyzeQuietMinutes: 10,
          },
          llm: { provider: 'ollama', model: 'test-model' },
          embedding: {},
        },
        budget: { mode: 'normal' },
      });
    }
    if (path === '/api/dj/recent?limit=50') {
      return jsonResponse({ results: [trackWithoutInlineLikes('untouched-track', 'Untouched Track')] });
    }
    throw new Error(`unexpected admin request: ${method} ${path}`);
  };

  const fakeWindow = {
    location: {
      search: '?view=liked',
      pathname: '/admin/library',
      hash: '',
      replace: () => {},
    },
    history: { replaceState: () => {} },
    btoa: (value: string) => Buffer.from(value).toString('base64'),
  };
  const fakeDocument = {
    body: { nodeType: 1, style: {} },
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };

  Object.defineProperties(globalThis, {
    fetch: { configurable: true, writable: true, value: controlledFetch },
    window: { configurable: true, writable: true, value: fakeWindow },
    document: { configurable: true, writable: true, value: fakeDocument },
    localStorage: { configurable: true, writable: true, value: fakeStorage },
  });

  let renderer!: ReturnType<typeof create>;
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const respond = async (request: PendingRequest, rows: Track[], total: number) => {
    await act(async () => {
      request.resolve(jsonResponse({ rows, total }));
      await flush();
    });
  };
  const rowVisible = (title: string) =>
    renderer.root.findAllByProps({ 'aria-label': `select ${title}` }).length === 1;
  const buttonWithText = (label: string) => {
    const matches = renderer.root.findAllByType('button')
      .filter(button => textContent(button).trim() === label);
    assert.equal(matches.length, 1, `expected one “${label}” button`);
    return matches[0]!;
  };
  const radioWithText = (label: string) => {
    const matches = renderer.root.findAllByType('button')
      .filter(button => button.props.role === 'radio' && textContent(button).trim().startsWith(label));
    assert.equal(matches.length, 1, `expected one “${label}” radio button`);
    assert.equal(typeof matches[0]!.props.onClick, 'function');
    return matches[0]!;
  };

  try {
    await act(async () => {
      renderer = create(createElement(LibraryPanel));
      await flush();
    });
    assert.equal(likedRequests.length, 1, 'entering Liked mode starts its first owned request');
    assert.equal(likeIndexRequests.length, 1, 'mount starts the shared like-index request');
    await respond(likedRequests[0]!, [track('initial', 'Initial Row')], 101);
    assert.equal(rowVisible('Initial Row'), true);

    await act(async () => { buttonWithText('next ›').props.onClick({}); await flush(); });
    assert.match(likedRequests[1]!.path, /offset=50/);
    const countSort = radioWithText('Most liked');
    await act(async () => { countSort.props.onClick({}); await flush(); });
    assert.match(likedRequests[2]!.path, /offset=0/);
    assert.match(likedRequests[2]!.path, /sort=count/);

    await respond(likedRequests[2]!, [track('count-winner', 'Count Winner')], 101);
    assert.equal(rowVisible('Count Winner'), true);
    await respond(likedRequests[1]!, [track('stale-offset', 'Stale Offset')], 101);
    assert.equal(rowVisible('Count Winner'), true, 'the newer sort owns the rendered table');
    assert.equal(rowVisible('Stale Offset'), false, 'an older offset response cannot overwrite it');

    await act(async () => { buttonWithText('Refresh').props.onClick({}); await flush(); });
    const staleModeRequest = likedRequests[3]!;
    const allMode = radioWithText('All');
    await act(async () => { allMode.props.onClick({}); await flush(); });
    const likedModeControl = radioWithText('Liked');
    await act(async () => { likedModeControl.props.onClick({}); await flush(); });
    const currentModeRequest = likedRequests[4]!;
    await respond(currentModeRequest, [track('fresh-mode', 'Fresh Mode')], 101);
    await respond(staleModeRequest, [track('stale-mode', 'Stale Mode')], 101);
    assert.equal(rowVisible('Fresh Mode'), true, 'the re-entered mode owns its response');
    assert.equal(rowVisible('Stale Mode'), false, 'the prior-mode response stays rejected');

    await act(async () => { buttonWithText('next ›').props.onClick({}); await flush(); });
    assert.match(likedRequests[5]!.path, /offset=50/);
    await respond(likedRequests[5]!, [], 21);
    assert.equal(likedRequests.length, 7, 'an emptied invalid page triggers a clamped refetch');
    assert.match(likedRequests[6]!.path, /offset=0/);
    await respond(likedRequests[6]!, [track('clamped-track', 'Clamped Track')], 21);
    assert.equal(rowVisible('Clamped Track'), true, 'the newest valid page is rendered after clamping');

    // Hold an unlike while the operator changes sort. Mutation completion must
    // refresh the latest visible controls, not the render-time loader captured
    // by the click. The initial shared index is deliberately still pending too:
    // invalidating it for the mutation must start a replacement request so an
    // untouched row can recover its heart state.
    let unlikeMutation!: Promise<void>;
    await act(async () => {
      unlikeMutation = renderer.root.findByProps({ 'aria-label': 'unlike Clamped Track' }).props.onClick({});
      await flush();
    });
    assert.equal(operatorMutationRequests.length, 1, 'unlike remains in flight for the control change');

    const recentSort = radioWithText('Recent');
    await act(async () => { recentSort.props.onClick({}); await flush(); });
    assert.match(likedRequests[7]!.path, /sort=recent/);
    await respond(likedRequests[7]!, [track('clamped-track', 'Clamped Track')], 21);

    await act(async () => {
      operatorMutationRequests[0]!.resolve(jsonResponse({ ok: true, count: 3 }));
      await unlikeMutation;
      await flush();
    });
    const mutationRefresh = likedRequests[8]!;
    const mutationRefreshUsesCurrentSort = /sort=recent/.test(mutationRefresh.path);

    await act(async () => {
      likeIndexRequests[0]!.resolve(jsonResponse({
        songs: { 'untouched-track': { count: 99, operator: false } },
      }));
      await flush();
    });
    if (likeIndexRequests[1]) {
      await act(async () => {
        likeIndexRequests[1]!.resolve(jsonResponse({
          songs: { 'untouched-track': { count: 7, operator: true } },
        }));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await flush();
      });
    }
    await respond(mutationRefresh, [track('clamped-track', 'Clamped Track', 3)], 21);

    await act(async () => {
      radioWithText('All').props.onClick({});
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await flush();
    });
    assert.equal(rowVisible('Untouched Track'), true, 'All mode renders the untouched index-decorated row');
    const untouchedHeartLabels = renderer.root.findAllByType('button')
      .map(button => button.props['aria-label'])
      .filter(label => typeof label === 'string' && label.includes('Untouched Track'));
    const untouchedHeartRestored = untouchedHeartLabels.includes('unlike Untouched Track');
    assert.deepEqual({
      mutationRefreshUsesCurrentSort,
      replacementIndexRequests: likeIndexRequests.length,
      untouchedHeartRestored,
    }, {
      mutationRefreshUsesCurrentSort: true,
      replacementIndexRequests: 2,
      untouchedHeartRestored: true,
    }, 'mutation completion follows current controls and restores the invalidated shared index');

    await act(async () => { radioWithText('Liked').props.onClick({}); await flush(); });
    await respond(likedRequests[9]!, [track('clamped-track', 'Clamped Track', 3)], 21);

    const desktopClear = renderer.root.findByProps({ 'aria-label': 'clear all likes for Clamped Track' });
    await act(async () => { desktopClear.props.onClick({}); await flush(); });
    let dialog = renderer.root.findByType(V3AlertDialog);
    assert.equal(dialog.props.open, true, 'desktop clear opens the production confirmation dialog');
    await act(async () => { dialog.props.onConfirm(); await flush(); });
    assert.deepEqual(deleteRequests[0], {
      path: '/api/likes/song/clamped-track',
      method: 'DELETE',
    });
    assert.equal(likedRequests.length, 11, 'confirmed desktop clear refreshes the active liked page');
    await respond(likedRequests[10]!, [track('mobile-track', 'Mobile Track')], 1);

    const mobileTrigger = renderer.root.findByProps({ 'aria-label': 'actions for Mobile Track' });
    await act(async () => { mobileTrigger.props.onClick({}); });
    const mobileClear = renderer.root.findAllByType('button')
      .find(button => textContent(button).includes('Clear all likes (4)'));
    assert.ok(mobileClear, 'the mobile clear action remains available');
    await act(async () => { mobileClear.props.onClick({}); await flush(); });
    dialog = renderer.root.findByType(V3AlertDialog);
    assert.equal(dialog.props.open, true, 'mobile clear opens the same production confirmation dialog');
    await act(async () => { dialog.props.onConfirm(); await flush(); });
    assert.deepEqual(deleteRequests[1], {
      path: '/api/likes/song/mobile-track',
      method: 'DELETE',
    }, 'mobile confirmation invokes the same per-song DELETE mutation path');
    await respond(likedRequests[11]!, [], 0);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

verifyLibraryPanelOwnsAsyncResultsAndClearMutations()
  .then(() => console.log('library-liked-state.test.ts: all assertions passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
