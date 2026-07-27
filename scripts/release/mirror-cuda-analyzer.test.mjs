import test from 'node:test';
import assert from 'node:assert/strict';

import { cudaMirrorRefs, mirrorCudaAnalyzer } from './mirror-cuda-analyzer.mjs';

const releaseTag = 'v1.0.0-obiwave.2';
const source = 'ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0';
const destination = 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.0.0-obiwave.2';
const digest = `sha256:${'a'.repeat(64)}`;
const otherDigest = `sha256:${'b'.repeat(64)}`;
const digestFormat = '{{json .Manifest.Digest}}';

function result(status, stdout = '', stderr = '') {
  return { status, stdout, stderr };
}

function runner(...results) {
  const calls = [];
  return {
    calls,
    run(command, args) {
      calls.push([command, args]);
      return results.shift();
    },
  };
}

function expectedCalls() {
  return [
    ['docker', ['buildx', 'imagetools', 'inspect', source, '--format', digestFormat]],
    ['docker', ['buildx', 'imagetools', 'inspect', destination]],
    ['docker', ['buildx', 'imagetools', 'create', '--tag', destination, source]],
    ['docker', ['buildx', 'imagetools', 'inspect', destination, '--format', digestFormat]],
  ];
}

test('derives exact upstream and mirror references from a fork release', () => {
  assert.deepEqual(cudaMirrorRefs('v1.0.0-obiwave.2'), { source, destination });
});

test('rejects non-fork and floating release tags', () => {
  for (const tag of ['1.0.0', 'v1.0.0', 'latest']) {
    assert.throws(() => cudaMirrorRefs(tag), /fork-qualified release tag/);
  }
});

test('copies an absent destination and requires equal digests', () => {
  const command = runner(
    result(0, JSON.stringify(digest)),
    result(1, '', 'ERROR: manifest unknown: manifest unknown'),
    result(0),
    result(0, JSON.stringify(digest)),
  );

  assert.deepEqual(mirrorCudaAnalyzer(releaseTag, { run: command.run }), { source, destination, digest });
  assert.deepEqual(command.calls, expectedCalls());
});

test('copies an absent destination with Docker exact not-found diagnostic', () => {
  const command = runner(
    result(0, JSON.stringify(digest)),
    result(1, '', `ERROR: ${destination}: not found`),
    result(0),
    result(0, JSON.stringify(digest)),
  );

  assert.deepEqual(mirrorCudaAnalyzer(releaseTag, { run: command.run }), { source, destination, digest });
  assert.deepEqual(command.calls, expectedCalls());
});

test('fails closed when the source cannot be inspected', () => {
  for (const stderr of ['unauthorized: authentication required', 'manifest unknown', 'transport: connection reset']) {
    const command = runner(result(1, '', stderr));
    assert.throws(() => mirrorCudaAnalyzer(releaseTag, { run: command.run }), /could not inspect source image/i);
    assert.deepEqual(command.calls, [expectedCalls()[0]]);
  }
});

test('refuses to overwrite an existing destination', () => {
  const command = runner(result(0, JSON.stringify(digest)), result(0, 'Name: existing'));

  assert.throws(() => mirrorCudaAnalyzer(releaseTag, { run: command.run }), /immutable-release.*never overwrite/i);
  assert.deepEqual(command.calls, expectedCalls().slice(0, 2));
});

test('fails closed when destination absence is ambiguous', () => {
  for (const stderr of [
    'unauthorized: authentication required',
    '503 Service Unavailable',
    'unauthorized: authentication required; manifest unknown',
  ]) {
    const command = runner(result(0, JSON.stringify(digest)), result(1, '', stderr));
    assert.throws(() => mirrorCudaAnalyzer(releaseTag, { run: command.run }), /could not prove destination.*absent/i);
    assert.deepEqual(command.calls, expectedCalls().slice(0, 2));
  }
});

test('rejects copy failure and source/destination digest mismatch', () => {
  const copyFailure = runner(
    result(0, JSON.stringify(digest)),
    result(1, '', 'manifest unknown'),
    result(1, '', 'denied'),
  );
  assert.throws(() => mirrorCudaAnalyzer(releaseTag, { run: copyFailure.run }), /could not mirror CUDA analyzer/i);
  assert.deepEqual(copyFailure.calls, expectedCalls().slice(0, 3));

  const mismatch = runner(
    result(0, JSON.stringify(digest)),
    result(1, '', 'manifest unknown'),
    result(0),
    result(0, JSON.stringify(otherDigest)),
  );
  assert.throws(() => mirrorCudaAnalyzer(releaseTag, { run: mismatch.run }), /digest mismatch/i);
  assert.deepEqual(mismatch.calls, expectedCalls());
});
