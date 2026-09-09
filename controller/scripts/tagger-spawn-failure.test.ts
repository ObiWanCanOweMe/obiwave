// A tagger run that cannot SPAWN must not take the station off air.
//
// `startTagger` spawns `npx tsx …` with `cwd: '/app'`. A ChildProcess 'error'
// event with no listener is THROWN rather than delivered, and nothing up the
// stack catches it — so any spawn that never starts (no `npx` on PATH, a
// missing cwd, EACCES on the binary, fork failure under memory pressure) took
// the whole controller down. Found live: pressing Start on a controller run
// outside its container printed `Error: spawn npx ENOENT` and the process
// exited, killing the broadcast with it.
//
// That is the "station must keep making sound" invariant: music never stops for
// a failed background job. A run that cannot start is a FAILED RUN — reported
// the same way a non-zero exit is reported — not a dead station.
//
// Run: npm test -- tagger-spawn-failure

import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STATE = mkdtempSync(join(tmpdir(), 'subwave-tagger-spawn-'));
process.env.STATE_DIR = STATE;

test.after(() => rmSync(STATE, { recursive: true, force: true }));

// The behaviour being relied on, pinned directly: node THROWS an 'error' event
// that has no listener. If this ever stops being true the guard below is still
// harmless, but the reason for it would be gone.
test('an unlistened ChildProcess error event is fatal (why the guard exists)', async () => {
  const child = spawn('definitely-not-a-real-binary-xyz', [], { stdio: 'ignore' });
  const threw = await new Promise<boolean>((resolve) => {
    // With a listener attached the error is delivered, not thrown — which is
    // exactly the fix. Without one it reaches the process as an uncaught
    // exception, which is what killed the controller.
    child.on('error', () => resolve(true));
    setTimeout(() => resolve(false), 2_000);
  });
  assert.equal(threw, true, 'spawning a missing binary must surface an error event');
});

test('startTagger reports a failed spawn without throwing', async () => {
  const tagger = await import('../src/broadcast/tagger.js');
  // The fork launches the installed tsx binary directly, so an empty PATH
  // only makes its shebang exit 127. Inject an actually missing executable
  // at the spawn boundary to exercise the same real asynchronous error.
  const realSpawn = childProcess.spawn;
  childProcess.spawn = ((...args: Parameters<typeof spawn>) =>
    realSpawn(join(STATE, 'missing-executable'), args[1], args[2])) as typeof spawn;
  syncBuiltinESMExports();
  try {
    assert.doesNotThrow(() => tagger.startTagger({ mode: 'tag', limit: 1 } as any));
    // The 'error' event lands on the next tick(s); give it room.
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(tagger.tagger.running, false, 'a run that never started must not read as running');
    assert.equal(tagger.tagger.lastRun?.outcome, 'failed');
    assert.ok(tagger.tagger.lastRun?.error, 'the reason must be recorded');
  } finally {
    childProcess.spawn = realSpawn;
    syncBuiltinESMExports();
  }
});

test('a failed kill cannot release a live worker, and retired callbacks cannot affect its successor', async () => {
  const { EventEmitter } = await import('node:events');
  const runtime = await import('../src/broadcast/tagger.js');
  const lock = await import('../src/music/tagger-lock.js');
  const children: Array<InstanceType<typeof EventEmitter> & { pid: number; stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter> }> = [];
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 700_000 + children.length, stdout: new EventEmitter(), stderr: new EventEmitter(),
    });
    children.push(child);
    return child;
  }) as typeof spawn;
  syncBuiltinESMExports();
  try {
    runtime.startAnalyzer();
    const first = children[0];
    first.emit('spawn');
    first.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
    assert.equal(runtime.tagger.running, true, 'failed kill leaves worker running');
    assert.equal(runtime.tagger.pid, first.pid);
    assert.equal(lock.readPidfile()?.pid, first.pid, 'live worker retains lock');
    first.emit('exit', 0, null);
    first.stderr.emit('data', Buffer.from('final buffered diagnostic\n'));
    assert.ok(runtime.taggerView().lastLog.includes('final buffered diagnostic'), 'stdio may finish draining after exit');
    runtime.startAnalyzer();
    const second = children[1];
    first.emit('close', 0, null);
    second.stdout.emit('data', Buffer.from('successor output\n'));
    assert.ok(runtime.taggerView().lastLog.includes('successor output'), 'retired close cannot stop successor capture');
    const before = structuredClone(runtime.taggerView());
    first.emit('error', new Error('late error'));
    first.stdout.emit('data', Buffer.from('[progress] {"phase":"stale"}\nold output\n'));
    first.emit('exit', 1, null);
    assert.deepEqual(runtime.taggerView(), before, 'retired callbacks cannot mutate successor state');
    assert.equal(lock.readPidfile()?.pid, second.pid, 'retired callbacks cannot remove successor lock');
    second.emit('exit', 0, null);
    second.emit('close', 0, null);
    const closed = structuredClone(runtime.taggerView());
    second.stderr.emit('data', Buffer.from('after close\n'));
    assert.deepEqual(runtime.taggerView(), closed, 'close retires capture ownership');
  } finally {
    children.at(-1)?.emit('exit', 1, null);
    childProcess.spawn = realSpawn;
    syncBuiltinESMExports();
    lock.clearPidfile();
  }
});
