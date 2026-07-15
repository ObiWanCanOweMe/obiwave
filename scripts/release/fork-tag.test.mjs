import test from 'node:test';
import assert from 'node:assert/strict';
import { makeForkTag, parseForkTag } from './fork-tag.mjs';

test('parses the initial fork release', () => {
  assert.deepEqual(parseForkTag('v0.42.0-obiwave.1'), {
    tag: 'v0.42.0-obiwave.1', version: '0.42.0', revision: 1,
  });
});

test('constructs a fork release', () => {
  assert.equal(makeForkTag('0.42.0', 2), 'v0.42.0-obiwave.2');
});

for (const value of ['v0.42.0', '0.42.0-obiwave.1', 'v0.42-obiwave.1',
  'v0.42.0-obiwave.0', 'v0.42.0-obiwave.01', 'v00.42.0-obiwave.1']) {
  test(`rejects ${value}`, () => {
    assert.throws(() => parseForkTag(value), /fork-qualified release tag/);
  });
}
