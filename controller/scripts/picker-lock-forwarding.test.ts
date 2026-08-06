// Pins the hand-off of strict show locks from pickViaAgent (broadcast/dj-agent.ts)
// to the agent's discovery tools (broadcast/dj-agent/agents.ts → buildPickerTools).
//
// Why this needs a test rather than the typechecker: agent-factory's run() takes
// an untyped args bag and spreads it into buildTools, and buildTools destructures
// the keys it wants by NAME. A lock that pickViaAgent resolves and passes but
// that agents.ts forgets to name is not a type error and not a crash — it falls
// through to buildPickerTools' `null` default and that whole dimension silently
// stops being enforced on the agent path. The pool picker still honours it, so
// the two pick paths drift on the same show, which is the exact thing
// music/show-filter.ts exists to prevent. Caught in review on #1300 FR 13, where
// vocalLock was resolved, passed, and then dropped by both lists in agents.ts.
//
// The check is deliberately source-level and name-based, because the defect is
// name-based: there is no runtime seam between "passed" and "destructured".
//
// Run: npm test -- picker-lock-forwarding

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const djAgent = readFileSync(resolve(here, '../src/broadcast/dj-agent.ts'), 'utf8');
const agents = readFileSync(resolve(here, '../src/broadcast/dj-agent/agents.ts'), 'utf8');

// Take the text of a brace-delimited block starting at `marker`, matching braces
// so a nested object literal can't end it early.
function blockAfter(src: string, marker: string): string {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `could not find ${JSON.stringify(marker)} — did the call site move?`);
  const open = src.indexOf('{', start);
  assert.notEqual(open, -1, `no opening brace after ${JSON.stringify(marker)}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${JSON.stringify(marker)}`);
}

// Object keys ending in `Lock`, in shorthand (`fooLock,`) or explicit
// (`fooLock: bar`) form.
const lockNames = (block: string): string[] =>
  [...block.matchAll(/(?:^|[{,\s])(\w+Lock)\s*[,:}]/g)].map(m => m[1]).sort();

const passed = lockNames(blockAfter(djAgent, 'pickerAgent.run('));
const destructured = lockNames(blockAfter(agents, 'buildTools: ('));
const forwarded = lockNames(blockAfter(agents, 'buildPickerTools('));

test('pickViaAgent actually resolves some locks (the parse found something)', () => {
  // Guards the two tests below from passing vacuously if the call site is
  // reshaped past what blockAfter/lockNames understand.
  assert.ok(passed.length >= 4, `expected several *Lock args, parsed: ${passed.join(', ') || '(none)'}`);
});

test('every lock pickViaAgent passes is destructured by pickerAgent.buildTools', () => {
  const missing = passed.filter(l => !destructured.includes(l));
  assert.deepEqual(
    missing,
    [],
    `agents.ts buildTools drops ${missing.join(', ')} — resolved in pickViaAgent, never named here, so buildPickerTools falls back to null and the dimension goes unenforced on the agent path.`,
  );
});

test('buildTools forwards exactly what it destructures', () => {
  // A name can be destructured and still not handed on — same silent outcome.
  assert.deepEqual(
    forwarded,
    destructured,
    'the buildTools destructure and the buildPickerTools call must name the same locks',
  );
});

test('buildPickerTools accepts every lock it is handed', () => {
  const tools = readFileSync(resolve(here, '../src/llm/internal/tools/picker-tools.ts'), 'utf8');
  const unknown = forwarded.filter(l => !new RegExp(`\\b${l}\\b`).test(tools));
  assert.deepEqual(unknown, [], `picker-tools.ts has no ${unknown.join(', ')} — forwarded into a void`);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
