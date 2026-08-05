import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as manifestModule from './recovery-manifest.mjs';

const scannerConfig = {
  schemaVersion: 1,
  version: '0.67.2',
  imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
};

function exactManifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.3.0-obiwave.2',
    sourceCommit: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' },
      { name: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' },
      { name: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' },
      { name: 'subwave-web', digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f' },
      { name: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' },
      { name: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' },
      { name: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' },
      { name: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' },
    ],
  };
}

function rejects(label, mutate) {
  test(`rejects ${label}`, () => {
    const manifest = exactManifest();
    mutate(manifest);
    assert.throws(
      () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
      /Recovery manifest invalid:/,
    );
  });
}

test('accepts the exact .2 identity and all ten images', () => {
  const value = manifestModule.validateRecoveryManifest({ manifest: exactManifest(), scannerConfig });
  assert.equal(value.releaseTag, 'v1.3.0-obiwave.2');
  assert.equal(value.sourceCommit, '41c8a329670f99c3b440a468adbb9fe2d900a4fe');
  assert.equal(value.images.length, 10);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.images));
});

test('returns canonical and digest-qualified references', () => {
  assert.deepEqual(manifestModule.recoveryImage(exactManifest(), 'subwave-web'), {
    image: 'subwave-web',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    pullRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
    digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
  });
});

rejects('a wrong fork tag', (manifest) => { manifest.releaseTag = 'v1.3.0'; });
rejects('a wrong source commit', (manifest) => { manifest.sourceCommit = 'a'.repeat(40); });
rejects('a wrong scanner version', (manifest) => { manifest.scanner.version = '0.68.0'; });
rejects('a wrong scanner image', (manifest) => {
  manifest.scanner.imageRef = 'aquasec/trivy@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});
test('rejects scanner-config disagreement', () => {
  assert.throws(
    () => manifestModule.validateRecoveryManifest({
      manifest: exactManifest(),
      scannerConfig: { ...scannerConfig, version: '0.68.0' },
    }),
    /Recovery manifest invalid:/,
  );
});
rejects('a foreign image namespace', (manifest) => { manifest.images[0].name = 'ghcr.io/foreign/subwave-caddy'; });
rejects('an uppercase digest', (manifest) => { manifest.images[0].digest = `sha256:${'A'.repeat(64)}`; });
rejects('a malformed digest', (manifest) => { manifest.images[0].digest = 'sha256:abc'; });
rejects('a valid lowercase digest that is not approved for the image', (manifest) => {
  manifest.images[0].digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});
rejects('a duplicate image', (manifest) => { manifest.images[1].name = 'subwave-caddy'; });
rejects('a missing image', (manifest) => { manifest.images.pop(); });
rejects('an extra image', (manifest) => {
  manifest.images.push({ name: 'subwave-surprise', digest: `sha256:${'a'.repeat(64)}` });
});
rejects('out-of-order images', (manifest) => { [manifest.images[0], manifest.images[1]] = [manifest.images[1], manifest.images[0]]; });
rejects('an unexpected manifest key', (manifest) => { manifest.unexpected = true; });

test('rejects an unknown image lookup', () => {
  assert.throws(
    () => manifestModule.recoveryImage(exactManifest(), 'subwave-surprise'),
    /Recovery manifest has no image: subwave-surprise/,
  );
});

function digestOutput(name) {
  return JSON.stringify(exactManifest().images.find((image) => image.name === name).digest);
}

function preflightRunner(overrides = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === 'git') return overrides.git ?? '41c8a329670f99c3b440a468adbb9fe2d900a4fe\n';
    if (command === 'gh') return overrides.release ?? JSON.stringify({
      tagName: 'v1.3.0-obiwave.2',
      targetCommitish: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    });
    if (args[0] === 'run') return overrides.scanner ?? 'Version: 0.67.2\n';
    const image = args[3].split('/').at(-1).split(':')[0];
    return overrides[image] ?? digestOutput(image);
  };
  return { calls, run };
}

test('verifies one image with the exact inspected digest', () => {
  const { calls, run } = preflightRunner();
  assert.deepEqual(manifestModule.verifyRecoveryImage({
    manifest: exactManifest(), imageName: 'subwave-web', run,
  }), {
    image: 'subwave-web',
    digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
  });
  assert.deepEqual(calls, [{
    command: 'docker',
    args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'],
  }]);
});

test('fails a single-image inspection whose digest differs', () => {
  const { run } = preflightRunner({ 'subwave-web': JSON.stringify(`sha256:${'a'.repeat(64)}`) });
  assert.throws(
    () => manifestModule.verifyRecoveryImage({ manifest: exactManifest(), imageName: 'subwave-web', run }),
    /Recovery image digest mismatch: subwave-web/,
  );
});

test('fails a single-image inspection with malformed output', () => {
  const { run } = preflightRunner({ 'subwave-web': 'not-json' });
  assert.throws(
    () => manifestModule.verifyRecoveryImage({ manifest: exactManifest(), imageName: 'subwave-web', run }),
    /Recovery image inspection returned an invalid digest/,
  );
});

test('sanitizes a single-image child process failure', () => {
  assert.throws(
    () => manifestModule.verifyRecoveryImage({
      manifest: exactManifest(),
      imageName: 'subwave-web',
      run() { throw new Error('registry password leaked here'); },
    }),
    (error) => error.message === 'Recovery image inspection command failed',
  );
});

test('preflight runs the exact tag, release, image, and scanner checks', () => {
  const { calls, run } = preflightRunner();
  const result = manifestModule.verifyRecoveryPreflight({
    manifest: exactManifest(), repository: 'ObiWanCanOweMe/obiwave', run,
  });
  assert.deepEqual(result, {
    tag: 'v1.3.0-obiwave.2',
    source: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    scannerVersion: '0.67.2',
    images: [
      { image: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' },
      { image: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' },
      { image: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' },
      { image: 'subwave-web', digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f' },
      { image: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' },
      { image: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' },
      { image: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' },
      { image: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' },
      { image: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' },
      { image: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' },
    ],
  });
  assert.deepEqual(calls, [
    { command: 'git', args: ['rev-parse', 'v1.3.0-obiwave.2^{commit}'] },
    { command: 'gh', args: ['release', 'view', 'v1.3.0-obiwave.2', '--repo', 'ObiWanCanOweMe/obiwave', '--json', 'tagName,targetCommitish'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-caddy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-broadcast:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-controller:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-aio:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-aio-heavy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-tts-heavy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-analyzer:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-analyzer-heavy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['run', '--rm', 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08', '--version'] },
  ]);
});

test('preflight rejects a tag that resolves to another source commit', () => {
  const { run } = preflightRunner({ git: `${'a'.repeat(40)}\n` });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactManifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery release tag source mismatch/,
  );
});

test('preflight rejects release metadata pointing at another source commit', () => {
  const { run } = preflightRunner({ release: JSON.stringify({ tagName: 'v1.3.0-obiwave.2', targetCommitish: 'a'.repeat(40) }) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactManifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery GitHub release source mismatch/,
  );
});

test('preflight rejects release metadata for another tag', () => {
  const { run } = preflightRunner({ release: JSON.stringify({
    tagName: 'v1.3.0-obiwave.1',
    targetCommitish: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
  }) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactManifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery GitHub release source mismatch/,
  );
});

test('preflight rejects any image whose inspected digest differs', () => {
  const { run } = preflightRunner({ 'subwave-controller': JSON.stringify(`sha256:${'a'.repeat(64)}`) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactManifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery image digest mismatch: subwave-controller/,
  );
});

test('preflight rejects a scanner reporting another version', () => {
  const { run } = preflightRunner({ scanner: 'Version: 0.68.0\n' });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactManifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery scanner version mismatch/,
  );
});

const scriptPath = fileURLToPath(new URL('./recovery-manifest.mjs', import.meta.url));
const manifestPath = fileURLToPath(new URL('../../security/releases/v1.3.0-obiwave.2.json', import.meta.url));
const scannerPath = fileURLToPath(new URL('../../security/trivy-scanner.json', import.meta.url));

function runImageCli(extra = [], env = process.env) {
  return spawnSync(process.execPath, [
    scriptPath,
    'image',
    '--manifest', manifestPath,
    '--scanner', scannerPath,
    '--image', 'subwave-web',
    ...extra,
  ], { encoding: 'utf8', env });
}

test('validate CLI accepts the exact manifest without external preflight', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', manifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('image CLI emits the canonical references as one JSON object', () => {
  const result = runImageCli();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    image: 'subwave-web',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    pullRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
    digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
  });
});

test('image CLI writes GitHub output instead of stdout when requested', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-manifest-'));
  const outputPath = join(directory, 'github-output');
  try {
    const result = runImageCli([], { ...process.env, GITHUB_OUTPUT: outputPath });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(
      await readFile(outputPath, 'utf8'),
      'tag_ref=ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2\n' +
        'pull_ref=ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f\n' +
        'digest=sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f\n',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI rejects duplicate and unknown arguments without echoing their values', () => {
  for (const args of [
    ['--image', 'subwave-caddy'],
    ['--unexpected', 'secret-value'],
  ]) {
    const result = runImageCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Recovery command arguments are invalid/);
    assert.doesNotMatch(result.stderr, /secret-value/);
  }
});
