import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LiveActivityLifecycle,
  type LiveActivityBridge,
} from '../src/hooks/live-activity-lifecycle.ts';
import type {
  LiveActivityConfig,
  LiveActivityState,
} from '../modules/live-activity/index.ts';

const state: LiveActivityState = {
  title: 'On air',
  artist: 'SUB/WAVE',
};

test('native module applies the same ownership cancellation before retaining state', () => {
  const nativeModule = readFileSync(
    new URL('../modules/live-activity/ios/SubwaveLiveActivityModule.swift', import.meta.url),
    'utf8',
  );

  assert.match(
    nativeModule,
    /private var lifecycleOwnership = LiveActivityLifecycleOwnership\(\)/,
  );
  assert.match(
    nativeModule,
    /let lifecycleToken = self\.lifecycleOwnership\.begin\(\)\s*[\s\S]*?await self\.endAll\(\)\s*guard self\.lifecycleOwnership\.owns\(lifecycleToken\) else \{ return false \}/,
    'a stale native start must stop before it can request a card',
  );
  assert.match(
    nativeModule,
    /guard self\.lifecycleOwnership\.owns\(lifecycleToken\) else \{\s*await activity\.end\(nil, dismissalPolicy: \.immediate\)\s*return false\s*\}/,
    'a start invalidated while requesting must end its exact stale activity',
  );
  assert.match(
    nativeModule,
    /AsyncFunction\("stop"\)[\s\S]*?let lifecycleToken = self\.lifecycleOwnership\.begin\(\)[\s\S]*?await self\.endAll\(\)\s*guard self\.lifecycleOwnership\.owns\(lifecycleToken\) else \{ return \}/,
    'a stale native cleanup must not clear the newer card state',
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controlledBridge() {
  const events: string[] = [];
  const entered = deferred<void>();
  const firstStart = deferred<boolean>();
  let active: string | null = null;
  let starts = 0;
  let failNextStop = false;

  const bridge: LiveActivityBridge = {
    start: async (config) => {
      starts++;
      events.push(`start:${config.station}:${config.accent}`);
      if (starts === 1) {
        entered.resolve();
        const result = await firstStart.promise;
        if (result) active = `${config.station}:${config.accent}`;
        return result;
      }
      active = `${config.station}:${config.accent}`;
      return true;
    },
    stop: async () => {
      events.push(`stop:${active ?? 'none'}`);
      active = null;
      if (failNextStop) {
        failNextStop = false;
        throw new Error('ActivityKit stop failed');
      }
    },
  };

  return {
    bridge,
    events,
    entered: entered.promise,
    releaseFirstStart: firstStart.resolve,
    rejectFirstStart: firstStart.reject,
    active: () => active,
    failNextStop: () => {
      failNextStop = true;
    },
  };
}

test('tuning out while start is held ends a stale card and never reports it started', async () => {
  const fake = controlledBridge();
  const lifecycle = new LiveActivityLifecycle(fake.bridge);

  const staleStart = lifecycle.start({ station: 'Alpha', accent: '#111111' }, state);
  await fake.entered;
  const tuneOut = lifecycle.stop();

  // The first native request is deliberately held across React cleanup.
  fake.releaseFirstStart(true);
  assert.equal(await staleStart, false);
  await tuneOut;

  assert.deepEqual(fake.events, [
    'start:Alpha:#111111',
    'stop:Alpha:#111111',
    'stop:none',
  ]);
  assert.equal(fake.active(), null);
});

for (const change of [
  {
    name: 'station switch',
    next: { station: 'Beta', accent: '#111111' },
  },
  {
    name: 'theme change',
    next: { station: 'Alpha', accent: '#222222' },
  },
] satisfies Array<{ name: string; next: LiveActivityConfig }>) {
  test(`${change.name} serializes after cleanup and tracks only the current card`, async () => {
    const fake = controlledBridge();
    const lifecycle = new LiveActivityLifecycle(fake.bridge);

    const staleStart = lifecycle.start({ station: 'Alpha', accent: '#111111' }, state);
    await fake.entered;
    const cleanup = lifecycle.stop();
    const currentStart = lifecycle.start(change.next, state);

    fake.releaseFirstStart(true);
    assert.equal(await staleStart, false);
    await cleanup;
    assert.equal(await currentStart, true);

    assert.deepEqual(fake.events, [
      'start:Alpha:#111111',
      'stop:Alpha:#111111',
      'stop:none',
      `start:${change.next.station}:${change.next.accent}`,
    ]);
    assert.equal(fake.active(), `${change.next.station}:${change.next.accent}`);
  });
}

test('start and stop errors fail closed without blocking the next lifecycle', async () => {
  const fake = controlledBridge();
  const lifecycle = new LiveActivityLifecycle(fake.bridge);

  const failedStart = lifecycle.start({ station: 'Alpha', accent: '#111111' }, state);
  await fake.entered;
  const cleanup = lifecycle.stop();
  fake.rejectFirstStart(new Error('ActivityKit request failed'));

  assert.equal(await failedStart, false);
  await cleanup;
  fake.failNextStop();
  await lifecycle.stop();

  assert.equal(
    await lifecycle.start({ station: 'Beta', accent: '#222222' }, state),
    true,
  );
  assert.deepEqual(fake.events, [
    'start:Alpha:#111111',
    'stop:none',
    'stop:none',
    'start:Beta:#222222',
  ]);
  assert.equal(fake.active(), 'Beta:#222222');
});
