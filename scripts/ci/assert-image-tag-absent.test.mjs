import test from 'node:test';
import assert from 'node:assert/strict';

import { assertImageTagAbsent } from './assert-image-tag-absent.mjs';

const imageRef = 'ghcr.io/example/image:v1.2.3-obiwave.1';

test('rejects an image reference that already resolves', () => {
  assert.throws(() => assertImageTagAbsent(imageRef, () => ({
    status: 0, stdout: `Name: ${imageRef}`, stderr: '',
  })), /already exists.*never overwrite/i);
});

test('accepts only an explicit registry not-found response', () => {
  assert.doesNotThrow(() => assertImageTagAbsent(imageRef, () => ({
    status: 1, stdout: '', stderr: 'ERROR: manifest unknown: manifest unknown',
  })));
});

test('fails closed on authentication or registry errors', () => {
  for (const stderr of [
    'unauthorized: authentication required',
    '503 Service Unavailable',
    'docker credential helper executable not found',
  ]) {
    assert.throws(() => assertImageTagAbsent(imageRef, () => ({
      status: 1, stdout: '', stderr,
    })), /could not prove.*absent/i);
  }
});

test('requires a qualified immutable image reference', () => {
  assert.throws(
    () => assertImageTagAbsent('ghcr.io/example/image:latest', () => ({ status: 1, stderr: 'not found' })),
    /fork-qualified release tag/i,
  );
});
