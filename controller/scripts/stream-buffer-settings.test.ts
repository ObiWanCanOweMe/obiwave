import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const childCase = process.env.STREAM_BUFFER_CASE;

if (childCase) {
  const cases: Record<string, { stored: unknown; expected: number }> = {
    valid: { stored: 37, expected: 37 },
    rounded: { stored: 37.6, expected: 38 },
    below: { stored: -1, expected: 22 },
    above: { stored: 61, expected: 22 },
    wrongType: { stored: '37', expected: 22 },
  };
  const selected = cases[childCase];
  assert.ok(selected, `unknown child case ${childCase}`);

  const stateDir = mkdtempSync(join(tmpdir(), `subwave-stream-buffer-${childCase}-`));
  process.env.STATE_DIR = stateDir;
  writeFileSync(
    join(stateDir, 'settings.json'),
    JSON.stringify({ stream: { bufferSeconds: selected.stored } }),
  );

  const settings = await import('../src/settings.js');
  await settings.load();
  assert.equal(
    settings.get().stream.bufferSeconds,
    selected.expected,
    `${childCase}: load normalizes the persisted depth`,
  );

  // A later unrelated save must retain the reconstructed value rather than
  // erasing it or silently reverting to an undefined/default field.
  await settings.update({ stream: { idleWhenEmpty: true } });
  const persisted = JSON.parse(readFileSync(join(stateDir, 'settings.json'), 'utf8'));
  assert.equal(
    persisted.stream.bufferSeconds,
    selected.expected,
    `${childCase}: unrelated save preserves the normalized depth`,
  );
  process.exit(0);
}

const file = fileURLToPath(import.meta.url);
for (const name of ['valid', 'rounded', 'below', 'above', 'wrongType']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], {
    env: { ...process.env, STREAM_BUFFER_CASE: name },
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${name} round trip failed:\n${result.stdout}${result.stderr}`,
  );
}

console.log('stream-buffer-settings.test.ts: bounded load/save round trips passed');
