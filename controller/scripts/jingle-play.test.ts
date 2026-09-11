// Pins the on-demand jingle path — POST /jingles/:filename/play →
// queue.playJingle → jingle-now.txt → Liquidsoap's priority queue and its own
// marker hook (NOT on_meta, which never sees that source).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STATE = mkdtempSync(join(tmpdir(), 'subwave-jingle-play-'));
process.env.STATE_DIR = STATE;

const { config } = await import('../src/config.js');
const { jingleUri } = await import('../src/broadcast/jingles.js');
const { bedUri } = await import('../src/broadcast/beds.js');
const { queue } = await import('../src/broadcast/queue.js');
const session = await import('../src/broadcast/session.js');
const { setJingleRotateOwner } = await import('../src/broadcast/jingle-rotate.js');

const here = dirname(fileURLToPath(import.meta.url));
const RADIO_LIQ = join(here, '..', '..', 'liquidsoap', 'radio.liq');
const QUEUE_URL = pathToFileURL(join(here, '..', 'src', 'broadcast', 'queue.ts')).href;
const SESSION_URL = pathToFileURL(join(here, '..', 'src', 'broadcast', 'session.ts')).href;
const ATOMIC_FILE_URL = pathToFileURL(join(here, '..', 'src', 'util', 'atomic-file.js')).href;

function makeJingleState(names: string[]) {
  const state = mkdtempSync(join(tmpdir(), 'subwave-jingle-restart-'));
  const dir = join(state, 'jingles');
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), 'audio');
  writeFileSync(join(state, 'jingles.json'), JSON.stringify({
    items: Object.fromEntries(names.map(name => [name, { text: name }])),
  }));
  return state;
}

function runFreshController(state: string, sourceBody: string) {
  const source = `
    import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const { queue } = await import(${JSON.stringify(QUEUE_URL)});
    ${sourceBody}
  `;
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source],
    {
      cwd: join(here, '..'),
      encoding: 'utf8',
      env: { ...process.env, STATE_DIR: state },
    },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const line = child.stdout.split('\n').find(value => value.startsWith('__RESULT__='));
  assert.ok(line, child.stdout);
  return JSON.parse(line.slice('__RESULT__='.length));
}

// Runs one controller process with a real atomic-file implementation whose
// first pre-jingle session snapshot is deliberately held after serialisation.
// Module mocking is limited to that timing seam: queue/session still operate
// against actual files, and the nested process mimics a controller crash.
function runWithHeldPreJingleSessionWrite(state: string, sourceBody: string) {
  const source = `
    import { mock } from 'node:test';
    import { rmSync, writeFileSync } from 'node:fs';
    import { rename, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    let oldSerialized;
    const oldSerializedReady = new Promise(resolve => { oldSerialized = resolve; });
    let oldFinished;
    const oldFinishedReady = new Promise(resolve => { oldFinished = resolve; });
    await mock.module(${JSON.stringify(ATOMIC_FILE_URL)}, {
      namedExports: {
        writeFileAtomic: async (path, contents, { mode } = {}) => {
          const staleSessionSnapshot = path.endsWith('/session.json')
            && !String(contents).includes('manualJingleId');
          if (staleSessionSnapshot) {
            oldSerialized();
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          const tmp = path + '.held-test.tmp';
          await writeFile(tmp, contents, mode == null ? {} : { mode });
          await rename(tmp, path);
          if (staleSessionSnapshot) oldFinished();
        },
      },
    });
    const { queue } = await import(${JSON.stringify(QUEUE_URL)});
    const session = await import(${JSON.stringify(SESSION_URL)});
    ${sourceBody}
  `;
  const child = spawnSync(
    process.execPath,
    ['--experimental-test-module-mocks', '--import', 'tsx', '--input-type=module', '-e', source],
    {
      cwd: join(here, '..'),
      encoding: 'utf8',
      env: { ...process.env, STATE_DIR: state },
    },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const line = child.stdout.split('\n').find(value => value.startsWith('__RESULT__='));
  assert.ok(line, child.stdout);
  return JSON.parse(line.slice('__RESULT__='.length));
}

const URI = jingleUri('/var/sub-wave/jingles/jingle_a1b2c3d4.wav');
assert.equal(URI, 'annotate:subwave_kind="jingle":/var/sub-wave/jingles/jingle_a1b2c3d4.wav');
assert.ok(URI.endsWith(':/var/sub-wave/jingles/jingle_a1b2c3d4.wav'));
assert.ok(!URI.includes('liq_cue_out'), 'a jingle is never cut short');
assert.ok(!URI.includes('liq_cross_duration'), 'a jingle takes the station crossfade');
assert.ok(bedUri('/x.mp3', { bedSec: 30, crossSec: 6 }).includes('liq_cue_out'), 'a bed still is');
assert.notEqual(
  URI.match(/subwave_kind="([^"]+)"/)?.[1],
  bedUri('/x.mp3', { bedSec: 30, crossSec: 6 }).match(/subwave_kind="([^"]+)"/)?.[1],
);

const filename = 'jingle_a1b2c3d4.wav';
const other = 'jingle_deadbeef.wav';
const jingleDir = join(STATE, 'jingles');
mkdirSync(jingleDir, { recursive: true });
writeFileSync(join(jingleDir, filename), 'audio');
writeFileSync(join(jingleDir, other), 'audio');
writeFileSync(join(STATE, 'jingles.json'), JSON.stringify({
  items: {
    [filename]: { text: 'Event announcement' },
    [other]: { text: 'Sponsor spot' },
  },
}));

// Liquidsoap consumed the handoff, and the clip has aired — which is what
// retires the pending press so the same jingle can be fired again.
async function markAired(name: string) {
  rmSync(join(STATE, 'jingle-now.txt'), { force: true });
  writeFileSync(join(STATE, 'jingle-playing.json'), JSON.stringify({
    filename: join(jingleDir, name),
    durationSec: 4,
    origin: 'manual',
    startedAt: Date.now() / 1000,
  }));
  await new Promise(resolve => setTimeout(resolve, 150));
}

function sessionContext() {
  return {
    at: new Date().toISOString(),
    time: { period: 'morning', vibe: 'morning', mood: 'calm' },
    weather: null,
    festival: null,
    dominantMood: 'calm',
    date: {},
    clock: {},
    listeners: 1,
    activeShow: null,
  } as any;
}

function manualJingleTurns() {
  return (session.getSession()?.messages || [])
    .filter(turn => turn.role === 'segment' && turn.kind === 'jingle');
}

test('manual jingle prompt memory is authenticated by the manual air marker exactly once', async () => {
  session.start(sessionContext());
  await queue.playJingle(filename);
  assert.deepEqual(manualJingleTurns(), [], 'a queued handoff is not an aired editorial turn');
  rmSync(join(STATE, 'jingle-now.txt'), { force: true });

  // The shared marker has no authority without the manual origin stamp. A
  // legacy marker and the automatic rotate must not invent a manual turn.
  for (const origin of [undefined, 'automatic']) {
    writeFileSync(join(STATE, 'jingle-playing.json'), JSON.stringify({
      filename: join(jingleDir, filename),
      durationSec: 4,
      ...(origin ? { origin } : {}),
      startedAt: Date.now() / 1000,
    }));
    await queue.retirePendingJingles();
    assert.deepEqual(manualJingleTurns(), [], `${origin || 'legacy'} marker is not a manual air event`);
  }

  writeFileSync(join(STATE, 'jingle-playing.json'), JSON.stringify({
    filename: join(jingleDir, filename),
    durationSec: 4,
    origin: 'manual',
    startedAt: Date.now() / 1000,
  }));
  await queue.retirePendingJingles();
  await queue.retirePendingJingles();
  assert.deepEqual(manualJingleTurns().map(turn => turn.text), ['Event announcement']);
});

test('manual jingle uses a priority handoff without touching the FIFO track handoff', async () => {
  writeFileSync(config.liquidsoap.queueFile, 'existing-track');

  await queue.playJingle(filename);

  assert.equal(readFileSync(config.liquidsoap.queueFile, 'utf8'), 'existing-track');
  assert.equal(
    readFileSync(join(STATE, 'jingle-now.txt'), 'utf8'),
    `annotate:subwave_kind="jingle":${join(jingleDir, filename)}`,
  );
  // Also settles the per-file release chain before the next test writes.
  await markAired(filename);
});

// The priority queue is a FIFO with no remove path, and the fallback keeps
// selecting it while it is non-empty — so a retried tool call or a
// double-clicked button would air the same announcement twice with no way back
// short of /restart-mixer.
test('a repeat press of an un-aired jingle is refused, not stacked', async () => {
  assert.deepEqual(await queue.playJingle(other), { ok: true });
  assert.ok(existsSync(join(STATE, 'jingle-now.txt')), 'the first press was handed over');
  rmSync(join(STATE, 'jingle-now.txt'));

  assert.deepEqual(await queue.playJingle(other), { ok: false, reason: 'already-queued' });
  assert.ok(!existsSync(join(STATE, 'jingle-now.txt')), 'the repeat wrote no second handoff');

  // Once it has been heard, the same jingle can be fired again.
  await markAired(other);
  assert.deepEqual(await queue.playJingle(other), { ok: true });
  await markAired(other);
});

test('simultaneous repeat presses reserve the jingle before its handoff', async () => {
  const handoff = join(STATE, 'jingle-now.txt');
  writeFileSync(handoff, 'occupied');
  let handoffs = 0;
  const consume = setInterval(() => {
    if (!existsSync(handoff)) return;
    if (readFileSync(handoff, 'utf8') !== 'occupied') handoffs += 1;
    rmSync(handoff);
  }, 10);

  try {
    const results = await Promise.all([
      queue.playJingle(filename),
      queue.playJingle(filename),
    ]);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(
      results.filter(result => !result.ok && result.reason === 'already-queued').length,
      1,
    );
    assert.equal(handoffs, 1, 'only one priority handoff was queued');
  } finally {
    clearInterval(consume);
    await markAired(filename);
  }
});

test('manual jingle rejects when its priority handoff cannot be written', async () => {
  const livePath = config.liquidsoap.jingleFile;
  config.liquidsoap.jingleFile = join(STATE, 'missing-parent', 'jingle-now.txt');
  try {
    await assert.rejects(queue.playJingle(filename));
  } finally {
    config.liquidsoap.jingleFile = livePath;
  }
  // A press that never reached the handoff leaves nothing pending behind it.
  assert.deepEqual(await queue.playJingle(filename), { ok: true });
  await markAired(filename);
});

test('a pending manual jingle survives a controller-only restart', () => {
  const state = makeJingleState([filename]);
  try {
    assert.deepEqual(runFreshController(state, `
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: true });

    // Liquidsoap has consumed the handoff into its still-live FIFO, but has not
    // aired it yet. Only the controller process restarts.
    rmSync(join(state, 'jingle-now.txt'));
    assert.deepEqual(runFreshController(state, `
      queue.recover();
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: false, reason: 'already-queued' });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('the watcher records a lone manual jingle marker without another button press', () => {
  const state = makeJingleState([filename]);
  const context = sessionContext();
  try {
    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      session.start(${JSON.stringify(context)});
      await queue.playJingle(${JSON.stringify(filename)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(process.env.STATE_DIR, 'jingles', ${JSON.stringify(filename)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      queue.startWatcher();
      await new Promise(resolve => setTimeout(resolve, 1700));
      const turns = session.getSession().messages
        .filter(turn => turn.role === 'segment' && turn.kind === 'jingle')
        .map(turn => turn.text);
      console.log('__RESULT__=' + JSON.stringify(turns));
      process.exit(0);
    `), [filename]);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('an observed manual marker survives a later automatic marker overwrite', () => {
  const state = makeJingleState([filename]);
  const context = sessionContext();
  try {
    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      session.start(${JSON.stringify(context)});
      await queue.playJingle(${JSON.stringify(filename)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(process.env.STATE_DIR, 'jingles', ${JSON.stringify(filename)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      queue.startWatcher();
      await new Promise(resolve => setTimeout(resolve, 1700));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(process.env.STATE_DIR, 'jingles', ${JSON.stringify(filename)}),
        origin: 'automatic',
        startedAt: Date.now() / 1000,
      }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const turns = session.getSession().messages
        .filter(turn => turn.role === 'segment' && turn.kind === 'jingle')
        .map(turn => turn.text);
      console.log('__RESULT__=' + JSON.stringify(turns));
      process.exit(0);
    `), [filename]);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('an immediate exit after marker retirement cannot lose or duplicate the jingle turn', () => {
  const state = makeJingleState([filename, other]);
  const context = sessionContext();
  try {
    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      session.start(${JSON.stringify(context)});
      await queue.playJingle(${JSON.stringify(filename)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(process.env.STATE_DIR, 'jingles', ${JSON.stringify(filename)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      // This retires the first reservation and writes the next ledger snapshot.
      // Exit immediately: the old implementation let that snapshot land before
      // session's debounced write, dropping the already-aired announcement.
      await queue.playJingle(${JSON.stringify(other)});
      console.log('__RESULT__=' + JSON.stringify(true));
      process.exit(0);
    `), true);

    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      await session.recover(${JSON.stringify(context)});
      queue.recover();
      const turns = session.getSession().messages
        .filter(turn => turn.role === 'segment' && turn.kind === 'jingle')
        .map(turn => turn.text);
      console.log('__RESULT__=' + JSON.stringify(turns));
    `), [filename]);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('a stale debounced session write cannot land after manual-jingle retirement', () => {
  const state = makeJingleState([filename]);
  const context = sessionContext();
  try {
    assert.equal(runWithHeldPreJingleSessionWrite(state, `
      session.start(${JSON.stringify(context)});
      await oldSerializedReady;
      await queue.playJingle(${JSON.stringify(filename)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(process.env.STATE_DIR, 'jingles', ${JSON.stringify(filename)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      await queue.reconcilePendingJingles();
      await oldFinishedReady;
      console.log('__RESULT__=' + JSON.stringify(true));
      process.exit(0);
    `), true);

    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      await session.recover(${JSON.stringify(context)});
      queue.recover();
      const turns = session.getSession().messages
        .filter(turn => turn.role === 'segment' && turn.kind === 'jingle')
        .map(turn => turn.text);
      const pending = JSON.parse(readFileSync(join(process.env.STATE_DIR, 'pending-jingles.json'), 'utf8')).pending;
      console.log('__RESULT__=' + JSON.stringify({ turns, pending }));
    `), { turns: [filename], pending: [] });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('a manual marker is remembered once across controller restart recovery', () => {
  const state = makeJingleState([filename, other]);
  const context = {
    at: new Date().toISOString(),
    time: { period: 'morning', vibe: 'morning', mood: 'calm' },
    weather: null,
    festival: null,
    dominantMood: 'calm',
    date: {},
    clock: {},
    listeners: 1,
    activeShow: null,
  };
  try {
    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      const context = ${JSON.stringify(context)};
      session.start(context);
      await queue.playJingle(${JSON.stringify(filename)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(process.env.STATE_DIR, 'jingles', ${JSON.stringify(filename)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      // The next FIFO press reconciles the prior marker and durably removes
      // that reservation before returning.
      await queue.playJingle(${JSON.stringify(other)});
      const turns = session.getSession().messages
        .filter(turn => turn.role === 'segment' && turn.kind === 'jingle')
        .map(turn => turn.text);
      console.log('__RESULT__=' + JSON.stringify(turns));
    `), [filename]);

    assert.deepEqual(runFreshController(state, `
      const session = await import(${JSON.stringify(SESSION_URL)});
      const context = ${JSON.stringify(context)};
      await session.recover(context);
      queue.recover();
      // Re-reading the same marker after recovery cannot add another turn.
      await queue.retirePendingJingles();
      const turns = session.getSession().messages
        .filter(turn => turn.role === 'segment' && turn.kind === 'jingle')
        .map(turn => turn.text);
      console.log('__RESULT__=' + JSON.stringify(turns));
    `), [filename]);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('an automatic same-file marker cannot retire a pending manual request', () => {
  const state = makeJingleState([filename]);
  try {
    assert.deepEqual(runFreshController(state, `
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: true });

    // Liquidsoap consumed the manual handoff but has not aired it. Its separate
    // automatic rotate then happens to feed the same library file and overwrites
    // the shared marker after the reservation timestamp.
    rmSync(join(state, 'jingle-now.txt'));
    writeFileSync(join(state, 'jingle-playing.json'), JSON.stringify({
      filename: join(state, 'jingles', filename),
      durationSec: 4,
      startedAt: Date.now() / 1000,
      origin: 'automatic',
    }));

    assert.deepEqual(runFreshController(state, `
      queue.recover();
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: false, reason: 'already-queued' });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('simultaneous different jingles are both durable across restart', () => {
  const state = makeJingleState([filename, other]);
  try {
    assert.deepEqual(runFreshController(state, `
      const handoff = join(process.env.STATE_DIR, 'jingle-now.txt');
      const consume = setInterval(() => {
        if (existsSync(handoff)) rmSync(handoff);
      }, 10);
      try {
        const results = await Promise.all([
          queue.playJingle(${JSON.stringify(filename)}),
          queue.playJingle(${JSON.stringify(other)}),
        ]);
        console.log('__RESULT__=' + JSON.stringify(results));
      } finally {
        clearInterval(consume);
      }
    `), [{ ok: true }, { ok: true }]);

    assert.deepEqual(runFreshController(state, `
      queue.recover();
      const results = await Promise.all([
        queue.playJingle(${JSON.stringify(filename)}),
        queue.playJingle(${JSON.stringify(other)}),
      ]);
      console.log('__RESULT__=' + JSON.stringify(results));
    `), [
      { ok: false, reason: 'already-queued' },
      { ok: false, reason: 'already-queued' },
    ]);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('a failed handoff stays released after restart', () => {
  const state = makeJingleState([filename]);
  try {
    assert.deepEqual(runFreshController(state, `
      const { config } = await import(${JSON.stringify(
        pathToFileURL(join(here, '..', 'src', 'config.ts')).href,
      )});
      config.liquidsoap.jingleFile = join(process.env.STATE_DIR, 'missing-parent', 'jingle-now.txt');
      let failed = false;
      try {
        await queue.playJingle(${JSON.stringify(filename)});
      } catch {
        failed = true;
      }
      console.log('__RESULT__=' + JSON.stringify({ failed }));
    `), { failed: true });

    assert.deepEqual(runFreshController(state, `
      queue.recover();
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: true });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('TTL retirement remains released after another restart', () => {
  const state = makeJingleState([filename]);
  try {
    assert.deepEqual(runFreshController(state, `
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: true });
    rmSync(join(state, 'jingle-now.txt'));

    assert.deepEqual(runFreshController(state, `
      const realNow = Date.now;
      Date.now = () => realNow() + 31 * 60 * 1000;
      queue.recover();
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('__RESULT__=' + JSON.stringify({ recovered: true }));
    `), { recovered: true });

    assert.deepEqual(runFreshController(state, `
      queue.recover();
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: true });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('a later FIFO marker retires earlier aired jingles before replay', () => {
  const state = makeJingleState([filename, other]);
  try {
    assert.deepEqual(runFreshController(state, `
      await queue.playJingle(${JSON.stringify(filename)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      await queue.playJingle(${JSON.stringify(other)});
      rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      const jingleDir = join(process.env.STATE_DIR, 'jingles');
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(jingleDir, ${JSON.stringify(filename)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
        filename: join(jingleDir, ${JSON.stringify(other)}),
        origin: 'manual',
        startedAt: Date.now() / 1000,
      }));
      const result = await queue.playJingle(${JSON.stringify(filename)});
      console.log('__RESULT__=' + JSON.stringify(result));
    `), { ok: true });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('aired FIFO entries do not consume the three-slot cap until TTL', () => {
  const names = Array.from({ length: 6 }, (_, index) => `jingle_0000000${index}.wav`);
  const state = makeJingleState(names);
  try {
    assert.deepEqual(runFreshController(state, `
      const names = ${JSON.stringify(names)};
      const jingleDir = join(process.env.STATE_DIR, 'jingles');
      for (const name of names.slice(0, 3)) {
        await queue.playJingle(name);
        rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'));
      }
      // Liquidsoap advances through all three while its single marker is
      // overwritten before the controller gets another reconciliation turn.
      for (const name of names.slice(0, 3)) {
        writeFileSync(join(process.env.STATE_DIR, 'jingle-playing.json'), JSON.stringify({
          filename: join(jingleDir, name),
          origin: 'manual',
          startedAt: Date.now() / 1000,
        }));
      }
      const results = [];
      for (const name of names.slice(3)) {
        results.push(await queue.playJingle(name));
        rmSync(join(process.env.STATE_DIR, 'jingle-now.txt'), { force: true });
      }
      console.log('__RESULT__=' + JSON.stringify(results));
    `), [{ ok: true }, { ok: true }, { ok: true }]);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

const liq = readFileSync(RADIO_LIQ, 'utf8');
const titleGate = liq.indexOf('elsif title != "" or artist != "" then');
const bedBranch = liq.indexOf('if m["subwave_kind"] == "bed" then');

assert.ok(bedBranch > 0, 'on_meta still has its bed branch');
assert.ok(titleGate > 0, 'on_meta still has its title/artist gate');
assert.ok(bedBranch < titleGate, 'bed branch remains above the title gate');

const markerHook = liq.indexOf('jingle_now_queue.on_metadata(synchronous=false');
const markerHookEnd = liq.indexOf('\n  )', markerHook);
assert.ok(markerHook > 0, 'the priority queue marks its own clips at feed time');
const branchBody = liq.slice(markerHook, markerHookEnd);
assert.ok(
  branchBody.includes('fun (m) -> begin'),
  'a multi-expression Liquidsoap callback must use a begin/end block',
);
assert.ok(branchBody.includes('jingle-playing.json'), 'writes the collision-guard marker');
assert.ok(branchBody.includes('origin = "manual"'), 'manual marker identifies its FIFO origin');
assert.ok(branchBody.includes('jingle_now_tmp_dir'), 'own temp dir — one per writer, #1240');
assert.ok(!branchBody.includes('temp_dir=jingle_tmp_dir'), 'never shares the rotate writer staging dir');
assert.ok(!branchBody.includes('now-playing.json'), 'an announcement is not a song');
assert.ok(!branchBody.includes('insert_metadata'), 'and never touches the ICY title');

// A dedicated source is the only way to get ahead of an already-populated
// FIFO dj_queue. Its availability gate preserves a manual press while deferring
// it past active speech or a bed/track pair.
const priorityQueue = liq.indexOf('jingle_now_queue = request.queue(id="jingle_now_queue")');
const priorityGate = liq.indexOf('jingle_now = source.available(jingle_now_queue');
const priorityFallback = liq.indexOf('[jingle_now, music]');
assert.ok(priorityQueue > 0, 'on-demand jingles have a dedicated request queue');
assert.ok(priorityGate > priorityQueue, 'the dedicated queue is wrapped in an availability gate');
assert.ok(priorityFallback > priorityGate, 'the dedicated queue wins the next safe boundary');
// Anchored at the gate itself, NOT at the queue declaration ~770 lines above:
// the automatic rotate's gate carries both of these strings, so a window that
// started any earlier passed even with this gate deleted outright.
const gateWindow = liq.slice(priorityGate, priorityFallback);
assert.ok(gateWindow.includes('not bed_on_air()'), 'a jingle cannot split a bed from its track');
assert.ok(gateWindow.includes('time() > voice_until()'), 'a jingle cannot start over active speech');
assert.ok(priorityFallback > liq.indexOf('rotate(weights=[1, jingle_ratio()]'),
  'manual priority wraps the automatic rotate so an automatic jingle cannot win first');

const rotateMarkerHook = liq.indexOf('jingles.on_metadata(synchronous=false');
const rotateMarkerBody = liq.slice(rotateMarkerHook, liq.indexOf('# A bed on air', rotateMarkerHook));
assert.ok(rotateMarkerHook > 0, 'the automatic rotate marks its clips at feed time');
assert.ok(rotateMarkerBody.includes('origin = "automatic"'),
  'automatic marker identifies that it did not consume the manual FIFO');

// The rotate must also stand down while a manual jingle is on air, or it stacks
// a stinger on top of the announcement.
const rotateGate = liq.slice(
  liq.indexOf('jingles = source.available(jingles, {'),
  liq.indexOf('rotate(weights=[1, jingle_ratio()]'),
);
assert.ok(rotateGate.includes('not jingle_now_on_air()'),
  'the rotate defers to a manual jingle already on air');
// ...and the flag has to be cleared by every on_meta branch, or it latches true
// and starves the rotate permanently (the bed_on_air failure, repeated).
const onMetaBody = liq.slice(liq.indexOf('def on_meta(m) ='), liq.indexOf('music_meta.on_metadata('));
// DERIVED from the branch count, not hardcoded: the point of the assertion is
// "every branch", and a literal silently stops meaning that the moment someone
// adds one (pause-talk made it four). Counting both sides is what catches the
// branch that forgot the clear.
const onMetaBranches = (onMetaBody.match(/^\s*(?:if|elsif|else)\b/gm) || []).length;
assert.equal(
  onMetaBody.split('jingle_now_on_air := false').length - 1, onMetaBranches,
  'every on_meta branch clears jingle_now_on_air',
);

// The two LATCHING flags follow the same rule one step removed: each is set
// true by its own branch and must be cleared by every OTHER one, or it starves
// the jingle rotate forever — the bed_on_air failure the comment above records,
// which pause_talk_on_air inherited wholesale by copying its shape.
for (const flag of ['bed_on_air', 'pause_talk_on_air']) {
  assert.equal(
    onMetaBody.split(`${flag} := false`).length - 1, onMetaBranches - 1,
    `every on_meta branch but its own clears ${flag}`,
  );
  assert.equal(
    onMetaBody.split(`${flag} := true`).length - 1, 1,
    `${flag} is latched by exactly one branch`,
  );
}

const pauseMarkerBranch = onMetaBody.slice(
  onMetaBody.indexOf('if m["subwave_kind"] == "pause-talk" then'),
  onMetaBody.indexOf('elsif m["subwave_kind"] == "bed" then'),
);
assert.ok(pauseMarkerBranch.includes('temp_dir=pause_talk_tmp_dir'),
  'the pause marker has its own atomic staging directory');
assert.ok(!pauseMarkerBranch.includes('temp_dir=bed_tmp_dir'),
  'the pause and bed writers cannot race through one atomic.write file');
assert.ok(liq.includes('pause_voice_accept_tmp_dir = ensure_tmp_dir("#{state_dir}/tmp/pause-voice-accept")'),
  'pause voice acceptance has one atomic writer directory');
assert.ok(liq.includes('pause_voice_start_tmp_dir = ensure_tmp_dir("#{state_dir}/tmp/pause-voice-start")'),
  'pause voice start has a separate atomic writer directory');
const voicePoll = liq.slice(liq.indexOf('def poll_voice() ='), liq.indexOf('def poll_intro() ='));
assert.ok(
  voicePoll.indexOf('voice_queue.push(request.create(contents))')
    < voicePoll.indexOf('write_pause_voice_accepted(contents)'),
  'acceptance is acknowledged only after the mixer owns the voice request',
);
const voiceMarker = liq.slice(liq.indexOf('def voice_marker(channel, tmp_dir) ='), liq.indexOf('voice_queue.on_metadata'));
assert.ok(voiceMarker.includes('"#{state_dir}/pause-talk-voice-started.json"'),
  'the actual first spoken sample gets a durable pause-specific marker');
assert.ok(voiceMarker.includes('temp_dir=pause_voice_start_tmp_dir'),
  'the pause start marker uses its own writer directory');

// Both gates gate the manual jingle AND the rotate: a stinger must not split
// either kind of break from the song it leads into.
assert.ok(gateWindow.includes('not pause_talk_on_air()'),
  'a jingle cannot split a pause-and-talk break from its track');
assert.ok(rotateGate.includes('not pause_talk_on_air()'),
  'the rotate cannot split a pause-and-talk break from its track');

// Clip length rides in the marker: the controller can only parse RIFF, and an
// import on a host without ffmpeg keeps its original container.
assert.ok(branchBody.includes('durationSec = jingle_duration(fname)'),
  'the marker carries a measured duration, not just a filename');
assert.ok(liq.includes('null.get(default=0., request.duration(fname))'),
  'jingle_duration measures via request.duration and degrades to 0 (unmeasured)');

// ---------------------------------------------------------------------------
// THE AUTOMATIC ROTATE, CONTROLLER-OWNED (#1619)
//
// broadcast/jingle-rotate.ts's own test covers the pure decisions — who owns
// the rotate, when it is due, which clip to draw, how the row arbitrates. What
// only reachable here is the QUEUE half: the handoff itself, the boundary count
// that makes it due, and the rule the whole design turns on — a rotate that
// fires and cannot draw SPENDS the offer rather than banking it.
// ---------------------------------------------------------------------------

// A track boundary normally hands a "track started" event to the session DJ
// agent, which reaches a real model over the network. That is not what these
// tests are about, and leaving it on makes them slow and dependent on whatever
// LLM the developer's settings happen to point at — so switch the auto-DJ off
// for the rest of the file, the same knob an idle-paused station uses.
queue.autoPick = false;
queue.autoLink = false;

// Seed the queue's in-memory state through the snapshot it actually restores
// from, rather than by poking privates: this is also the NB-3 half of the
// contract (the count is absolute, so it has to survive a controller rebuild).
function recoverWith(snapshot: Record<string, unknown>) {
  writeFileSync(config.queue.file, JSON.stringify({
    upcoming: [], current: null, history: [], ...snapshot,
  }));
  queue.recover();
}

test('the boundary count survives a controller restart, and repairs junk', () => {
  recoverWith({ tracksSinceJingle: 12, lastRotateJingle: other });
  assert.equal(queue.rotateJingleTracksSince(), 12,
    'a rebuilt controller must not restart the count — that costs a whole ratio of tracks');

  // The snapshot is on the operator's disk; a junk value here decides how long
  // the station goes without a stinger.
  for (const junk of [-4, 'twelve', null, undefined, NaN]) {
    recoverWith({ tracksSinceJingle: junk });
    assert.equal(queue.rotateJingleTracksSince(), 0, `junk count ${String(junk)} repairs to 0`);
  }
  // A snapshot written before #1619 has no such field at all — pre-existing
  // behaviour, which is a fresh count.
  recoverWith({});
  assert.equal(queue.rotateJingleTracksSince(), 0);
});

test('a track boundary is what makes the rotate due', () => {
  recoverWith({ tracksSinceJingle: 0 });
  queue.onTrackStarted({ title: 'One', artist: 'A', subsonic_id: 'id-1' } as any);
  queue.onTrackStarted({ title: 'Two', artist: 'B', subsonic_id: 'id-2' } as any);
  assert.equal(queue.rotateJingleTracksSince(), 2, 'each music boundary counts once');

  // The same metadata firing again is the watcher re-reading one boundary, not
  // a second track — it must not advance the rotate towards due.
  queue.onTrackStarted({ title: 'Two', artist: 'B', subsonic_id: 'id-2' } as any);
  assert.equal(queue.rotateJingleTracksSince(), 2, 'a repeated marker is one boundary');

  // A titleless marker is not a song (it is how a bed reaches this watcher).
  queue.onTrackStarted({ title: '', artist: '' } as any);
  queue.onTrackStarted(null);
  assert.equal(queue.rotateJingleTracksSince(), 2, 'only real music boundaries count');
});

test('a drawn rotate hands over through the same single writer, and restarts the count', async () => {
  recoverWith({ tracksSinceJingle: 30, lastRotateJingle: null });
  rmSync(join(STATE, 'jingle-now.txt'), { force: true });

  assert.equal(await queue.playRotateJingle(), true);
  const handed = readFileSync(join(STATE, 'jingle-now.txt'), 'utf8');
  assert.ok(handed.startsWith('annotate:subwave_kind="jingle":'),
    'the rotate writes nothing of its own — playJingle is still the only writer');
  assert.equal(queue.rotateJingleTracksSince(), 0,
    'the count restarts at the HANDOFF, so "1 every N" stays a count of tracks');

  await markAired(handed.split(':').pop()!.split('/').pop()!);
});

// The rule the design argues hardest for, and the one with no other home:
// radio.liq's rotate was gated by `source.available`, so a jingle that came due
// at a boundary where the gate was shut was SKIPPED, not banked. Banking it
// would leave the row due on every subsequent minute, holding the seam against
// the segment director until the library was filled.
test('a rotate that cannot draw a clip SPENDS the offer rather than banking it', async () => {
  const meta = readFileSync(join(STATE, 'jingles.json'), 'utf8');
  recoverWith({ tracksSinceJingle: 30 });
  rmSync(join(STATE, 'jingle-now.txt'), { force: true });
  writeFileSync(join(STATE, 'jingles.json'), JSON.stringify({ items: {} }));
  try {
    assert.equal(await queue.playRotateJingle(), false, 'an empty library draws nothing');
    assert.ok(!existsSync(join(STATE, 'jingle-now.txt')), 'and hands nothing over');
    assert.equal(queue.rotateJingleTracksSince(), 0,
      'the offer is spent — the next rotate is N tracks away, not this minute again');
  } finally {
    writeFileSync(join(STATE, 'jingles.json'), meta);
  }
});

// NB-4. The operator's button must never be wedged shut by bookkeeping the
// operator did not cause — controller/CLAUDE.md states that about a mixer
// restart, and a shared budget reintroduces it from the other side.
test('the rotate does not spend the operator press budget', async () => {
  recoverWith({ tracksSinceJingle: 30, lastRotateJingle: null });
  rmSync(join(STATE, 'jingle-now.txt'), { force: true });

  assert.equal(await queue.playRotateJingle(), true);
  // Liquidsoap drains the handoff within a poll; standing in for it here keeps
  // the next write off writeHandoff's 5s wait-for-drain.
  const rotated = readFileSync(join(STATE, 'jingle-now.txt'), 'utf8').split('/').pop()!;
  rmSync(join(STATE, 'jingle-now.txt'));

  // A second rotate is refused on its OWN cap of one — a second pending rotate
  // can only mean the first never aired, and the FIFO has no remove path.
  recoverWith({ tracksSinceJingle: 30, lastRotateJingle: null });
  assert.equal(await queue.playRotateJingle(), false, 'one rotate in flight at a time');
  assert.ok(!existsSync(join(STATE, 'jingle-now.txt')), 'and hands nothing over');

  // ...and the operator still has their own slots, unspent. A DIFFERENT clip
  // from the one the rotate is holding, so this is the budget answering and not
  // the shared de-duplication.
  const pressable = [filename, other].filter(f => f !== rotated);
  assert.ok(pressable.length >= 1, 'at least one clip the rotate is not holding');
  for (const f of pressable) {
    assert.deepEqual(await queue.playJingle(f), { ok: true },
      'a pending rotate must not answer queue-full to an operator');
    rmSync(join(STATE, 'jingle-now.txt'), { force: true });
  }

  for (const f of [rotated, ...pressable]) await markAired(f);
});

// NB-5. The counter runs on every boundary regardless of owner — onTrackStarted
// has no business branching on a setting — so without this a station that has
// been up for hours fires a stinger on the very first tick after the toggle,
// on top of a mixer that has not restarted yet.
test('handing the rotate to the controller starts a clean N-track cycle', () => {
  recoverWith({ tracksSinceJingle: 47 });
  assert.equal(queue.rotateJingleTracksSince(), 47);

  setJingleRotateOwner('controller');
  assert.equal(queue.rotateJingleTracksSince(), 0, 'the switch restarts the count');

  // Going back is not a symmetric event: the count nothing is reading is not
  // the operator's to lose, and zeroing it would be a change they did not ask
  // for. Nor does re-asserting the same owner reset anything.
  recoverWith({ tracksSinceJingle: 9 });
  setJingleRotateOwner('mixer');
  assert.equal(queue.rotateJingleTracksSince(), 9, 'switching back leaves the count alone');
  setJingleRotateOwner('mixer');
  assert.equal(queue.rotateJingleTracksSince(), 9, 'a no-op save fires nothing');
});

test('the count reaches the snapshot, so the next boot can restore it', async () => {
  recoverWith({ tracksSinceJingle: 0 });
  queue.onTrackStarted({ title: 'Three', artist: 'C', subsonic_id: 'id-3' } as any);
  queue.persist();
  await new Promise(resolve => setTimeout(resolve, 700));  // persist() is debounced
  const snap = JSON.parse(readFileSync(config.queue.file, 'utf8'));
  assert.equal(snap.tracksSinceJingle, 1, 'the absolute count is written, not only derived');
});

test.after(() => {
  if (existsSync(STATE)) rmSync(STATE, { recursive: true, force: true });
});
