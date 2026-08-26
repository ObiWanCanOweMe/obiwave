// Contract for the focused-test harness itself. The runner must treat every
// selector after `npm test --` as part of one OR union — operators use that
// form in integration plans, and silently ignoring selector #2 makes a green
// command lie about what it exercised.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'run-tests.ts');

function run(selectors: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', runner, ...selectors],
    { cwd: join(here, '..'), encoding: 'utf8' },
  );
}

function occurrences(text: string, needle: string) {
  return text.split(needle).length - 1;
}

test('multiple selectors execute their union exactly once', () => {
  const result = run(['show-playlist', 'max-listeners']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Running 2 test file\(s\) matching "show-playlist" or "max-listeners"/);
  assert.equal(occurrences(result.stdout, 'show-playlist merge checks passed'), 1);
  assert.equal(occurrences(result.stdout, 'cold bootstrap repairs a missing max-listener handoff'), 1);
});

test('a missing selector fails safely instead of running every test', () => {
  const result = run(['not-a-real-test-selector']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No test files match "not-a-real-test-selector"/);
  assert.doesNotMatch(result.stdout, /Running \d+ test file/);
});
