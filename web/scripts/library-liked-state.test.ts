import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';

import {
  acceptLibraryResponse,
  beginLibraryRequest,
  clampLibraryPage,
} from '../components/admin/libraryState.ts';
import { TrackTable } from '../components/admin/library/TrackTable.tsx';
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

const likedTrack: Track = {
  id: 'liked-track',
  title: 'Liked Track',
  artist: 'The Testers',
  likeCount: 4,
  likedByOperator: true,
};

function ClearActionHarness() {
  const [pending, setPending] = useState('');
  return createElement('div', null,
    createElement(TrackTable, {
      tab: 'liked',
      rows: [likedTrack],
      loading: false,
      queuing: null,
      retagging: null,
      flashId: null,
      onQueue: () => {},
      onRetag: () => {},
      blocking: null,
      onBlock: () => {},
      onUnblock: () => {},
      vocab: [],
      editingId: null,
      manualBusy: null,
      onEdit: () => {},
      onSaveManual: () => {},
      onCancelEdit: () => {},
      selected: new Set<string>(),
      onToggleSelect: () => {},
      onToggleAll: () => {},
      likeIndex: {},
      liking: null,
      onToggleLike: () => {},
      onClearLikes: track => setPending(track.id),
    }),
    createElement('output', { 'data-pending': pending }),
  );
}

async function verifyDesktopAndMobileClearShareTheMutationPath() {
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(ClearActionHarness)); });
    const output = () => renderer.root.findByType('output').props['data-pending'];

    const desktopClear = renderer.root.findByProps({ 'aria-label': 'clear all likes for Liked Track' });
    await act(async () => { desktopClear.props.onClick({}); });
    assert.equal(output(), likedTrack.id, 'the desktop clear action reaches the shared pending mutation');

    await act(async () => { renderer.update(createElement(ClearActionHarness, { key: 'mobile' })); });
    const mobileTrigger = renderer.root.findByProps({ 'aria-label': 'actions for Liked Track' });
    await act(async () => { mobileTrigger.props.onClick({}); });
    const mobileClear = renderer.root.findAllByType('button')
      .find(button => textContent(button).includes('Clear all likes (4)'));
    assert.ok(mobileClear, 'the mobile clear action remains available');
    await act(async () => { mobileClear.props.onClick({}); });
    assert.equal(output(), likedTrack.id, 'the mobile clear action reaches the same pending mutation');
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: previousDocument,
    });
  }
}

verifyDesktopAndMobileClearShareTheMutationPath()
  .then(() => console.log('library-liked-state.test.ts: all assertions passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
