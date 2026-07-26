import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navigation = await import('../lib/guardedNavigation.ts').catch(() => null);
assert.ok(navigation, 'shared guarded navigation contract must exist');
assert.equal(
  typeof navigation.UnsavedHistoryBarrier,
  'function',
  'guard lifecycle must own its temporary history barrier',
);
const scheduleLib = await import('../components/admin/schedule/lib.ts');
assert.equal(
  typeof scheduleLib.rebaseScheduleEdits,
  'function',
  'schedule saves must reconcile edits made after submission',
);

type PendingNavigation = {
  kind: 'push' | 'back';
  href?: string;
  currentHref?: string;
  proceed: () => void;
};

interface HistoryEntry {
  href: string;
  state: Record<string, unknown>;
}

class FakeHistory {
  entries: HistoryEntry[] = [
    { href: '/admin/shows', state: { route: 'shows' } },
    { href: '/admin/shows/schedule', state: { route: 'schedule' } },
  ];
  index = 1;
  onPopState: (() => void) | null = null;

  get state(): Record<string, unknown> {
    return this.entries[this.index]!.state;
  }

  pushState(state: Record<string, unknown>, _unused: string, href: string): void {
    this.entries.splice(this.index + 1);
    this.entries.push({ href, state });
    this.index = this.entries.length - 1;
  }

  back(): void {
    this.go(-1);
  }

  go(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next >= this.entries.length) return;
    this.index = next;
    this.onPopState?.();
  }
}

class FakePopStateEvents {
  readonly listeners = new Set<() => void>();

  add(listener: () => void): void {
    this.listeners.add(listener);
  }

  remove(listener: () => void): void {
    this.listeners.delete(listener);
  }

  dispatch(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

class AsyncFakeHistory extends FakeHistory {
  pendingDelta: number | null = null;
  private readonly events: FakePopStateEvents;

  constructor(events: FakePopStateEvents) {
    super();
    this.events = events;
  }

  override go(delta: number): void {
    this.pendingDelta = delta;
  }

  flushTraversal(): void {
    assert.notEqual(this.pendingDelta, null, 'a history traversal must be pending');
    const next = this.index + this.pendingDelta!;
    this.pendingDelta = null;
    if (next < 0 || next >= this.entries.length) return;
    this.index = next;
    this.events.dispatch();
  }
}

const currentHref = '/admin/shows/schedule';
const history = new FakeHistory();
const barrier = new navigation.UnsavedHistoryBarrier(history, currentHref, 'lifecycle-test');
const captured: PendingNavigation[] = [];
const removeGuard = navigation.installUnsavedNavigationGuard(
  barrier,
  intent => { captured.push(intent); },
);
history.onPopState = () => barrier.handlePopState(() => {
  navigation.requestGuardedNavigation({
    kind: 'back',
    currentHref,
    proceed: () => {},
  });
});

let sameRoutePushes = 0;
const sameRouteSettled = navigation.requestGuardedNavigation({
  kind: 'push',
  href: currentHref,
  currentHref,
  proceed: () => { sameRoutePushes++; },
});
assert.equal(sameRouteSettled, true);
assert.equal(sameRoutePushes, 0, 'current-route command navigation must be a no-op');
assert.equal(captured.length, 0, 'current-route commands must not open or disarm the guard');
assert.deepEqual(
  history.entries.map(entry => entry.href),
  ['/admin/shows', currentHref, currentHref],
  'same-route commands must leave exactly one temporary barrier in place',
);

navigation.requestGuardedNavigation({
  kind: 'push',
  href: '/admin/debug',
  currentHref,
  proceed: () => {},
});
navigation.requestGuardedNavigation({
  kind: 'push',
  href: '/admin/library',
  currentHref,
  proceed: () => {},
});
history.back();
assert.deepEqual(
  captured.map(intent => intent.kind),
  ['push', 'push', 'back'],
  'after a same-route command, later commands, anchors, and Back remain protected',
);
removeGuard();

const leavingHistory = new FakeHistory();
const leavingBarrier = new navigation.UnsavedHistoryBarrier(
  leavingHistory,
  currentHref,
  'cleanup-test',
);
let pendingLeave: PendingNavigation | null = null;
const removeLeavingGuard = navigation.installUnsavedNavigationGuard(
  leavingBarrier,
  intent => { pendingLeave = intent; },
);
leavingHistory.onPopState = () => leavingBarrier.handlePopState(() => {});
navigation.requestGuardedNavigation({
  kind: 'push',
  href: '/admin/debug',
  currentHref,
  proceed: () => leavingHistory.pushState({ route: 'debug' }, '', '/admin/debug'),
});
assert.ok(pendingLeave);
(pendingLeave as PendingNavigation).proceed();
assert.deepEqual(
  leavingHistory.entries.map(entry => entry.href),
  ['/admin/shows', currentHref, '/admin/debug'],
  'successful navigation must remove the temporary duplicate before pushing',
);
removeLeavingGuard();

const asyncEvents = new FakePopStateEvents();
const asyncHistory = new AsyncFakeHistory(asyncEvents);
let guardedBackCount = 0;
const asyncBarrier = new navigation.UnsavedHistoryBarrier(
  asyncHistory,
  currentHref,
  {
    marker: 'async-cleanup-test',
    events: asyncEvents,
    onGuardedBack: () => { guardedBackCount++; },
  },
);
let asyncPendingLeave: PendingNavigation | null = null;
const removeAsyncGuard = navigation.installUnsavedNavigationGuard(
  asyncBarrier,
  intent => { asyncPendingLeave = intent; },
);
let intendedPushCount = 0;
navigation.requestGuardedNavigation({
  kind: 'push',
  href: '/admin/debug',
  currentHref,
  proceed: () => {
    intendedPushCount++;
    asyncHistory.pushState({ route: 'debug' }, '', '/admin/debug');
  },
});
assert.ok(asyncPendingLeave);
(asyncPendingLeave as PendingNavigation).proceed();
assert.equal(intendedPushCount, 0, 'router push must wait for asynchronous history traversal');

// Models save making dirty=0: the React effect removes its interception
// listener and runs cleanup before the queued browser popstate arrives.
const effectPopStateListener = () => asyncBarrier.handlePopState(() => { guardedBackCount++; });
asyncEvents.add(effectPopStateListener);
asyncEvents.remove(effectPopStateListener);
removeAsyncGuard();
asyncBarrier.dispose();

asyncHistory.flushTraversal();
assert.equal(intendedPushCount, 1, 'cleanup must not strand the held router push');
assert.equal(guardedBackCount, 0, 'an internal cleanup traversal must not reopen the leave guard');
assert.deepEqual(
  asyncHistory.entries.map(entry => entry.href),
  ['/admin/shows', currentHref, '/admin/debug'],
  'asynchronous save-and-leave must remove the barrier before pushing',
);
asyncEvents.dispatch();
assert.equal(intendedPushCount, 1, 'the held router push must execute exactly once');
assert.equal(asyncEvents.listeners.size, 0, 'no internal popstate listener may be stranded');

let unguardedPushCount = 0;
navigation.requestGuardedNavigation({
  kind: 'push',
  href: '/admin/library',
  currentHref: '/admin/debug',
  proceed: () => { unguardedPushCount++; },
});
assert.equal(unguardedPushCount, 1, 'the completed transition must not strand a guard');

assert.equal(
  typeof navigation.UnsavedHistoryBarrierLifecycle,
  'function',
  'dirty effect cleanup needs a lifecycle lease that can detect genuine unmount',
);
const unmountEvents = new FakePopStateEvents();
const unmountHistory = new AsyncFakeHistory(unmountEvents);
const deferredDisposals: Array<() => void> = [];
let unmountedBackIntercepts = 0;
let unmountedLeavePrompts = 0;
const unmountLifecycle = new navigation.UnsavedHistoryBarrierLifecycle(
  callback => { deferredDisposals.push(callback); },
);
const initialLease = unmountLifecycle.acquire(() => new navigation.UnsavedHistoryBarrier(
  unmountHistory,
  currentHref,
  {
    marker: 'dirty-unmount-test',
    events: unmountEvents,
    onGuardedBack: () => {
      unmountedBackIntercepts++;
      navigation.requestGuardedNavigation({
        kind: 'back',
        currentHref,
        proceed: () => {},
      });
    },
  },
));
const unmountBarrier = initialLease.barrier;
const removeInitialUnmountGuard = navigation.installUnsavedNavigationGuard(
  unmountBarrier,
  () => { unmountedLeavePrompts++; },
);

// React Strict Mode first cleans up and then immediately replays the effect.
// The new lease must claim the existing barrier before deferred disposal runs.
removeInitialUnmountGuard();
initialLease.release();
const replayLease = unmountLifecycle.acquire(() => {
  throw new Error('Strict Mode replay must reuse the existing history barrier');
});
const removeReplayUnmountGuard = navigation.installUnsavedNavigationGuard(
  replayLease.barrier,
  () => { unmountedLeavePrompts++; },
);
assert.equal(replayLease.barrier, unmountBarrier);
const replayDisposal = deferredDisposals.shift();
assert.ok(replayDisposal, 'Strict Mode cleanup must defer its disposal decision');
replayDisposal();
assert.equal(unmountHistory.pendingDelta, null, 'effect replay must cancel deferred disposal');
assert.equal(unmountEvents.listeners.size, 1, 'effect replay must retain one Back listener');
assert.deepEqual(
  unmountHistory.entries.map(entry => entry.href),
  ['/admin/shows', currentHref, currentHref],
  'effect replay must retain exactly one history barrier',
);

// No replacement lease follows this cleanup: this is a dirty genuine unmount
// with no held navigation transition.
removeReplayUnmountGuard();
replayLease.release();
const unmountDisposal = deferredDisposals.shift();
assert.ok(unmountDisposal, 'genuine unmount must schedule a disposal decision');
unmountDisposal();
assert.equal(unmountHistory.pendingDelta, -1, 'genuine unmount must step off its barrier');
assert.equal(
  unmountEvents.listeners.size,
  1,
  'barrier listener must survive until the asynchronous disposal traversal completes',
);
unmountHistory.flushTraversal();
assert.equal(unmountHistory.index, 1, 'genuine unmount must return to the real route entry');
assert.equal(unmountEvents.listeners.size, 0, 'genuine unmount must remove the Back listener');

unmountHistory.back();
unmountHistory.flushTraversal();
assert.equal(unmountHistory.index, 0, 'Back after dirty unmount must reach the prior route');
assert.equal(unmountedBackIntercepts, 0, 'Back after dirty unmount must not be trapped');
assert.equal(unmountedLeavePrompts, 0, 'unmounted dirty state must not reopen a leave prompt');

const reactivationEvents = new FakePopStateEvents();
const reactivationHistory = new AsyncFakeHistory(reactivationEvents);
const reactivationDisposals: Array<() => void> = [];
const reactivationLifecycle = new navigation.UnsavedHistoryBarrierLifecycle(
  callback => { reactivationDisposals.push(callback); },
);
let reactivationBackIntercepts = 0;
let reactivationLeavePrompts = 0;
let reactivationBarrierCount = 0;
const createReactivationBarrier = () => new navigation.UnsavedHistoryBarrier(
  reactivationHistory,
  currentHref,
  {
    marker: `reactivation-test-${++reactivationBarrierCount}`,
    events: reactivationEvents,
    onGuardedBack: () => {
      reactivationBackIntercepts++;
      navigation.requestGuardedNavigation({
        kind: 'back',
        currentHref,
        proceed: () => {},
      });
    },
  },
);
const preDisposalLease = reactivationLifecycle.acquire(createReactivationBarrier);
const removePreDisposalGuard = navigation.installUnsavedNavigationGuard(
  preDisposalLease.barrier,
  () => { reactivationLeavePrompts++; },
);
removePreDisposalGuard();
preDisposalLease.release();
const beginReactivationDisposal = reactivationDisposals.shift();
assert.ok(beginReactivationDisposal, 'released barrier must begin deferred disposal');
beginReactivationDisposal();
assert.equal(reactivationHistory.pendingDelta, -1);

// Dirty state can return before the browser delivers the disposal popstate.
// Reclaiming here must not create a second barrier that mistakes the internal
// traversal for a user Back.
const reactivatedLease = reactivationLifecycle.acquire(createReactivationBarrier);
const removeReactivatedGuard = navigation.installUnsavedNavigationGuard(
  reactivatedLease.barrier,
  () => { reactivationLeavePrompts++; },
);
reactivationHistory.flushTraversal();
assert.equal(
  reactivationBackIntercepts,
  0,
  'reactivation during disposal must not reinterpret cleanup as user Back',
);
assert.equal(
  reactivationLeavePrompts,
  0,
  'reactivation during disposal must not open a spurious leave prompt',
);
assert.equal(reactivationEvents.listeners.size, 1, 'reactivation must retain exactly one listener');
assert.deepEqual(
  reactivationHistory.entries.map(entry => entry.href),
  ['/admin/shows', currentHref, currentHref],
  'reactivation must leave exactly one guarding barrier',
);

removeReactivatedGuard();
reactivatedLease.release();
const finishReactivationDisposal = reactivationDisposals.shift();
assert.ok(finishReactivationDisposal, 'reactivated barrier must remain disposable');
finishReactivationDisposal();
reactivationHistory.flushTraversal();
assert.equal(reactivationEvents.listeners.size, 0, 'final cleanup must release the reclaimed listener');

const submitted = scheduleLib.emptyWeek();
submitted[1]![8] = 'deleted-show';
submitted[1]![9] = 'morning';
const editedWhileSaving = scheduleLib.cloneWeek(submitted);
editedWhileSaving[1]![9] = 'breaking-news';
const authoritative = scheduleLib.cloneWeek(submitted);
authoritative[1]![8] = null;
const reconciled = scheduleLib.rebaseScheduleEdits(
  submitted,
  editedWhileSaving,
  authoritative,
);
assert.equal(reconciled[1]![8], null, 'controller sanitization must remain authoritative');
assert.equal(
  reconciled[1]![9],
  'breaking-news',
  'an edit made while save is in flight must remain as a new unsaved edit',
);

const [guardSource, shellSource, scheduleSource] = await Promise.all([
  readFile(new URL('../hooks/useUnsavedGuard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/AdminShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/schedule/SchedulePanel.tsx', import.meta.url), 'utf8'),
]);

assert.match(guardSource, /addEventListener\('popstate'/, 'unsaved guard must intercept browser Back');
assert.match(guardSource, /requestGuardedNavigation/, 'anchors and Back must use the shared contract');
assert.match(
  guardSource,
  /new UnsavedHistoryBarrierLifecycle\(\)/,
  'the hook must construct the tested effect lifecycle owner',
);
assert.match(guardSource, /\.acquire\(/, 'the active hook effect must claim a lifecycle lease');
assert.match(guardSource, /lease\.release\(\)/, 'hook cleanup must release its lifecycle lease');
assert.match(shellSource, /requestGuardedNavigation/, 'command-menu navigation must use the shared contract');
assert.match(scheduleSource, /navigation\.proceed\(\)/, 'leave decisions must resume the held navigation intent');
assert.match(scheduleSource, /setServerSchedule\(cloneWeek\(authoritativeSchedule\)\)/,
  'save must replace the server baseline with the controller-sanitized schedule');
assert.match(scheduleSource, /const liveSchedule = serverSchedule \?\? schedule;/,
  'the now band must stay on the controller schedule while edits are unsaved');
assert.match(scheduleSource, /blockAt\(liveSchedule, nowDay, nowHour\)/);
assert.match(scheduleSource, /slot\(s\) skipped/, 'save feedback must report skipped slots');

console.log('✓ navigation and authoritative schedule contracts hold');
