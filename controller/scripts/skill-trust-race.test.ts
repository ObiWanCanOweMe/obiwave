import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempDir } from './test-utils/temp-dir.js';

process.env.STATE_DIR = createTempDir(join(tmpdir(), 'skill-trust-race-'));
const { quarantineTool, trustPendingTool, sha256 } = await import('../src/skills/install.js');

test('concurrent quarantine cannot replace the bytes approved by an in-flight trust', async t => {
  const slug = 'review-race';
  const reviewed = Buffer.from('export default () => "reviewed";');
  const incoming = Buffer.from('export default () => "unapproved";');
  const dir = join(process.env.STATE_DIR!, 'skills', slug);
  const pending = join(dir, 'tool.mjs.pending');
  await quarantineTool(slug, reviewed);

  let snapshotTaken!: () => void;
  const snapshot = new Promise<void>(r => { snapshotTaken = r; });
  let resumeTrust!: () => void;
  const resume = new Promise<void>(r => { resumeTrust = r; });
  const originalRead = fs.readFile;
  // Pause after trust has read the reviewed bytes, before it promotes the path.
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    const data = await originalRead(...args);
    if (String(args[0]) === pending) {
      snapshotTaken();
      await resume;
    }
    return data;
  });
  syncBuiltinESMExports();
  try {
    const trust = trustPendingTool(slug, sha256(reviewed));
    await snapshot;
    const replacement = quarantineTool(slug, incoming);
    // Old code completes the overwrite during the paused read. Correct code
    // serializes it behind trust; let trust proceed once that is established.
    await Promise.race([replacement, new Promise(r => setTimeout(r, 100))]);
    resumeTrust();
    assert.equal(await trust, 'trusted');
    await replacement;
    assert.deepEqual(await originalRead(join(dir, 'tool.mjs')), reviewed);
    assert.deepEqual(await originalRead(pending), incoming, 'new code still awaits its own review');
    assert.equal(await trustPendingTool(slug, sha256(reviewed)), 'changed');
  } finally {
    resumeTrust();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
