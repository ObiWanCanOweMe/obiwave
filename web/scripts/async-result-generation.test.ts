import assert from 'node:assert/strict';

const stateModule = await import('../lib/asyncResultGeneration.ts').catch(() => null);
assert.ok(stateModule, 'async result generation guard module must exist');

const generation = new stateModule.AsyncResultGeneration();
const first = generation.begin();
assert.equal(generation.isCurrent(first), true);
generation.invalidate();
assert.equal(generation.isCurrent(first), false, 'input changes suppress stale async results');
const second = generation.begin();
assert.equal(generation.isCurrent(second), true);
assert.equal(generation.isCurrent(first), false);
console.log('✓ async result generations suppress stale responses');
