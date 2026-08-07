import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as manifestModule from './recovery-manifest.mjs';

const scannerConfig = {
  schemaVersion: 1,
  version: '0.67.2',
  imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
};

function exactV13Manifest() {
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

function exactV15Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.5.0-obiwave.1',
    sourceCommit: 'fe269a1e632fe6f886ac987f641f41326e1392e0',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:cdf89341b5a0c5c31493f6b2653b45631aac6e184148af8a46db02ff3072f235' },
      { name: 'subwave-broadcast', digest: 'sha256:32eb3d4c2a4146e31f37a389bc4d3b8309d3f13bf31edf5e7bf3a687f96ad5d0' },
      { name: 'subwave-controller', digest: 'sha256:5aa26e9be46fdb2d733e7da2c74af63bbfeb7630575cae6bcbf0bf7c9b29ee55' },
      { name: 'subwave-web', digest: 'sha256:f2f635a3b9d581db1478a74e5dfddbdae6faa31bb4b7694c7e03095915130008' },
      { name: 'subwave-aio', digest: 'sha256:f745b4ae1133af9e77f1006ccf2ca219a6df0243451b4e633c143f0b6cc1ab8a' },
      { name: 'subwave-aio-heavy', digest: 'sha256:2d37d9c15e88b90523c437e8330c7245050f92a2eefc513ac6a556ca7c68a90b' },
      { name: 'subwave-tts-heavy', digest: 'sha256:41a6be4327f9f321b0993da4bac93a6359e440c1c26f7af52b663bcb083a3784' },
      { name: 'subwave-analyzer', digest: 'sha256:ec22ae65a95f60d070414b2fa73a7ec481190d66355426ce1cdbfdb142ef9f2c' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:290e2cd443bcee737fc4806f77384f172858e133f4fc0c0292195be9d53c9c5c' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:a69d2f866eb9d991a69212b5605c15a3631d4d21cec8c4608a6cb29f9d7c9cc2' },
    ],
  };
}

function exactV16PartialManifest() {
  return {
    schemaVersion: 2,
    kind: 'partial-publication-recovery',
    releaseTag: 'v1.6.0-obiwave.1',
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scanner: { version: scannerConfig.version, imageRef: scannerConfig.imageRef },
    images: [
      { name: 'subwave-caddy', action: 'build' },
      { name: 'subwave-broadcast', action: 'preserve', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' },
      { name: 'subwave-controller', action: 'preserve', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' },
      { name: 'subwave-web', action: 'build' },
      { name: 'subwave-aio', action: 'preserve', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' },
      { name: 'subwave-aio-heavy', action: 'build' },
      { name: 'subwave-tts-heavy', action: 'build' },
      { name: 'subwave-analyzer', action: 'preserve', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' },
      { name: 'subwave-analyzer-heavy', action: 'build' },
      { name: 'subwave-analyzer-cuda', action: 'preserve', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  };
}

test('accepts only the approved partial recovery identity', () => {
  const value = manifestModule.validatePartialRecoveryManifest({
    manifest: exactV16PartialManifest(), scannerConfig,
  });
  assert.equal(value.releaseTag, 'v1.6.0-obiwave.1');
  assert.equal(value.images.filter((image) => image.action === 'build').length, 5);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.images));
  assert.ok(Object.isFrozen(value.images[0]));
});

function rejectsPartial(label, mutate) {
  test(`partial recovery rejects ${label}`, () => {
    const manifest = exactV16PartialManifest();
    mutate(manifest);
    assert.throws(
      () => manifestModule.validatePartialRecoveryManifest({ manifest, scannerConfig }),
      /Recovery manifest invalid:/,
    );
  });
}

rejectsPartial('a changed source', (manifest) => { manifest.sourceCommit = 'a'.repeat(40); });
rejectsPartial('a changed scanner', (manifest) => { manifest.scanner.version = '0.68.0'; });
rejectsPartial('a changed action', (manifest) => { manifest.images[0].action = 'preserve'; });
rejectsPartial('a changed preserved digest', (manifest) => { manifest.images[1].digest = `sha256:${'a'.repeat(64)}`; });
rejectsPartial('out-of-order images', (manifest) => { [manifest.images[0], manifest.images[1]] = [manifest.images[1], manifest.images[0]]; });
rejectsPartial('a missing image', (manifest) => { manifest.images.pop(); });
rejectsPartial('an extra image', (manifest) => { manifest.images.push({ name: 'subwave-surprise', action: 'build' }); });
rejectsPartial('a digest on a build image', (manifest) => { manifest.images[0].digest = `sha256:${'a'.repeat(64)}`; });
rejectsPartial('a missing digest on a preserved image', (manifest) => { delete manifest.images[1].digest; });

const buildDigests = Object.freeze({
  'subwave-caddy': `sha256:${'1'.repeat(64)}`,
  'subwave-web': `sha256:${'2'.repeat(64)}`,
  'subwave-aio-heavy': `sha256:${'3'.repeat(64)}`,
  'subwave-tts-heavy': `sha256:${'4'.repeat(64)}`,
  'subwave-analyzer-heavy': `sha256:${'5'.repeat(64)}`,
});

function exactV16RegistryDigests() {
  return Object.fromEntries(exactV16PartialManifest().images.map((image) => [
    image.name,
    image.action === 'build' ? buildDigests[image.name] : image.digest,
  ]));
}

function exactV16SealedManifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.6.0-obiwave.1',
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scanner: { version: scannerConfig.version, imageRef: scannerConfig.imageRef },
    images: exactV16PartialManifest().images.map((image) => ({
      name: image.name,
      digest: image.action === 'build' ? buildDigests[image.name] : image.digest,
    })),
  };
}

test('seals partial recovery build and registry evidence into a canonical manifest', () => {
  const sealed = manifestModule.sealRecoveryManifest({
    partialManifest: exactV16PartialManifest(),
    buildDigests,
    registryDigests: exactV16RegistryDigests(),
  });
  assert.deepEqual(sealed, exactV16SealedManifest());
  assert.ok(Object.isFrozen(sealed));
  assert.ok(Object.isFrozen(sealed.images));
  assert.ok(Object.isFrozen(sealed.images[0]));
});

test('validates a sealed recovery manifest against the approved partial identity', () => {
  const sealed = manifestModule.validateSealedRecoveryManifest({
    manifest: exactV16SealedManifest(),
    partialManifest: exactV16PartialManifest(),
    scannerConfig,
  });
  assert.deepEqual(sealed, exactV16SealedManifest());
});

function rejectsSeal(label, mutate) {
  test(`seal rejects ${label}`, () => {
    const input = {
      partialManifest: exactV16PartialManifest(),
      buildDigests: { ...buildDigests },
      registryDigests: exactV16RegistryDigests(),
    };
    mutate(input);
    assert.throws(
      () => manifestModule.sealRecoveryManifest(input),
      /Recovery manifest invalid:/,
    );
  });
}

rejectsSeal('missing build evidence', (input) => { delete input.buildDigests['subwave-web']; });
rejectsSeal('extra build evidence', (input) => { input.buildDigests['subwave-surprise'] = `sha256:${'a'.repeat(64)}`; });
rejectsSeal('a changed preserved digest', (input) => { input.registryDigests['subwave-broadcast'] = `sha256:${'a'.repeat(64)}`; });
rejectsSeal('registry and build digest disagreement', (input) => { input.registryDigests['subwave-web'] = `sha256:${'a'.repeat(64)}`; });
rejectsSeal('a malformed build digest', (input) => { input.buildDigests['subwave-web'] = 'sha256:bad'; });
rejectsSeal('registry evidence in the wrong order', (input) => {
  input.registryDigests = Object.fromEntries(Object.entries(input.registryDigests).reverse());
});
rejectsSeal('a foreign registry image', (input) => { input.registryDigests['subwave-surprise'] = `sha256:${'a'.repeat(64)}`; });

function rejectsSealed(label, mutate) {
  test(`sealed recovery rejects ${label}`, () => {
    const manifest = exactV16SealedManifest();
    mutate(manifest);
    assert.throws(
      () => manifestModule.validateSealedRecoveryManifest({
        manifest,
        partialManifest: exactV16PartialManifest(),
        scannerConfig,
      }),
      /Recovery manifest invalid:/,
    );
  });
}

rejectsSealed('a changed preserved digest', (manifest) => { manifest.images[1].digest = `sha256:${'a'.repeat(64)}`; });
rejectsSealed('a malformed build digest', (manifest) => { manifest.images[0].digest = 'sha256:bad'; });
rejectsSealed('out-of-order images', (manifest) => { [manifest.images[0], manifest.images[1]] = [manifest.images[1], manifest.images[0]]; });
rejectsSealed('a foreign image', (manifest) => { manifest.images[0].name = 'subwave-surprise'; });

function rejects(label, mutate) {
  for (const [release, exactManifest] of [
    ['v1.3', exactV13Manifest],
    ['v1.5', exactV15Manifest],
  ]) {
    test(`rejects ${label} for ${release}`, () => {
      const manifest = exactManifest();
      mutate(manifest);
      assert.throws(
        () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
        /Recovery manifest invalid:/,
      );
    });
  }
}

test('accepts each literal approved recovery identity', () => {
  for (const [manifest, tag, source] of [
    [exactV13Manifest(), 'v1.3.0-obiwave.2', '41c8a329670f99c3b440a468adbb9fe2d900a4fe'],
    [exactV15Manifest(), 'v1.5.0-obiwave.1', 'fe269a1e632fe6f886ac987f641f41326e1392e0'],
  ]) {
    const value = manifestModule.validateRecoveryManifest({ manifest, scannerConfig });
    assert.equal(value.releaseTag, tag);
    assert.equal(value.sourceCommit, source);
    assert.equal(value.images.length, 10);
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.images));
  }
});

test('rejects a valid manifest assembled from cross-release identity parts', () => {
  const manifest = exactV15Manifest();
  manifest.sourceCommit = exactV13Manifest().sourceCommit;
  assert.throws(
    () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
    /Recovery manifest invalid:/,
  );
});

test('rejects an unsupported recovery tag even when its manifest is internally consistent', () => {
  const manifest = exactV15Manifest();
  manifest.releaseTag = 'v1.6.0-obiwave.1';
  assert.throws(
    () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
    /releaseTag is not approved/,
  );
});

test('returns canonical and digest-qualified references', () => {
  assert.deepEqual(manifestModule.recoveryImage(exactV13Manifest(), 'subwave-web'), {
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
for (const [release, exactManifest] of [
  ['v1.3', exactV13Manifest],
  ['v1.5', exactV15Manifest],
]) {
  test(`rejects scanner-config disagreement for ${release}`, () => {
    assert.throws(
      () => manifestModule.validateRecoveryManifest({
        manifest: exactManifest(),
        scannerConfig: { ...scannerConfig, version: '0.68.0' },
      }),
      /Recovery manifest invalid:/,
    );
  });
}
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
    () => manifestModule.recoveryImage(exactV13Manifest(), 'subwave-surprise'),
    /Recovery manifest has no image: subwave-surprise/,
  );
});

function digestOutput(name) {
  return JSON.stringify(exactV13Manifest().images.find((image) => image.name === name).digest);
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
    manifest: exactV13Manifest(), imageName: 'subwave-web', run,
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
    () => manifestModule.verifyRecoveryImage({ manifest: exactV13Manifest(), imageName: 'subwave-web', run }),
    /Recovery image digest mismatch: subwave-web/,
  );
});

test('fails a single-image inspection with malformed output', () => {
  const { run } = preflightRunner({ 'subwave-web': 'not-json' });
  assert.throws(
    () => manifestModule.verifyRecoveryImage({ manifest: exactV13Manifest(), imageName: 'subwave-web', run }),
    /Recovery image inspection returned an invalid digest/,
  );
});

test('sanitizes a single-image child process failure', () => {
  assert.throws(
    () => manifestModule.verifyRecoveryImage({
      manifest: exactV13Manifest(),
      imageName: 'subwave-web',
      run() { throw new Error('registry password leaked here'); },
    }),
    (error) => error.message === 'Recovery image inspection command failed',
  );
});

test('preflight runs the exact tag, release, image, and scanner checks', () => {
  const { calls, run } = preflightRunner();
  const result = manifestModule.verifyRecoveryPreflight({
    manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run,
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
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery release tag source mismatch/,
  );
});

test('preflight rejects release metadata pointing at another source commit', () => {
  const { run } = preflightRunner({ release: JSON.stringify({ tagName: 'v1.3.0-obiwave.2', targetCommitish: 'a'.repeat(40) }) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery GitHub release source mismatch/,
  );
});

test('preflight rejects release metadata for another tag', () => {
  const { run } = preflightRunner({ release: JSON.stringify({
    tagName: 'v1.3.0-obiwave.1',
    targetCommitish: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
  }) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery GitHub release source mismatch/,
  );
});

test('preflight rejects any image whose inspected digest differs', () => {
  const { run } = preflightRunner({ 'subwave-controller': JSON.stringify(`sha256:${'a'.repeat(64)}`) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery image digest mismatch: subwave-controller/,
  );
});

test('preflight rejects a scanner reporting another version', () => {
  const { run } = preflightRunner({ scanner: 'Version: 0.68.0\n' });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
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

test('legacy CLI commands reject partial-recovery-only arguments', () => {
  const result = runImageCli(['--partial-manifest', 'secret-value']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Recovery command arguments are invalid/);
  assert.doesNotMatch(result.stderr, /secret-value/);
});

function partialPreflightRunner(overrides = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === 'git') return overrides.git ?? '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787\n';
    if (command === 'gh') return overrides.release ?? JSON.stringify({
      tagName: 'v1.6.0-obiwave.1',
      targetCommitish: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
      isDraft: false,
      isPrerelease: false,
    });
    if (args[0] === 'run') return overrides.scanner ?? 'Version: 0.67.2\n';
    const image = args[3].split('/').at(-1).split(':')[0];
    return overrides[image] ?? JSON.stringify(exactV16RegistryDigests()[image]);
  };
  return { calls, run };
}

test('partial recovery preflight checks release identity, preserved tags, and scanner', () => {
  const { calls, run } = partialPreflightRunner();
  const result = manifestModule.verifyPartialRecoveryPreflight({
    manifest: exactV16PartialManifest(), repository: 'ObiWanCanOweMe/obiwave', run,
  });
  assert.deepEqual(result, {
    tag: 'v1.6.0-obiwave.1',
    source: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scannerVersion: '0.67.2',
    images: [
      { image: 'subwave-broadcast', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' },
      { image: 'subwave-controller', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' },
      { image: 'subwave-aio', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' },
      { image: 'subwave-analyzer', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' },
      { image: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  });
  assert.deepEqual(calls.map(({ command, args }) => [command, args[0]]), [
    ['git', 'rev-parse'], ['gh', 'release'],
    ['docker', 'buildx'], ['docker', 'buildx'], ['docker', 'buildx'], ['docker', 'buildx'], ['docker', 'buildx'],
    ['docker', 'run'],
  ]);
});

test('partial recovery preflight rejects a non-public GitHub release', () => {
  const { run } = partialPreflightRunner({ release: JSON.stringify({
    tagName: 'v1.6.0-obiwave.1', targetCommitish: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787', isDraft: true, isPrerelease: false,
  }) });
  assert.throws(
    () => manifestModule.verifyPartialRecoveryPreflight({
      manifest: exactV16PartialManifest(), repository: 'ObiWanCanOweMe/obiwave', run,
    }),
    /Recovery GitHub release is not public/,
  );
});

const partialManifestPath = fileURLToPath(new URL('../../security/releases/v1.6.0-obiwave.1.partial.json', import.meta.url));

function runPartialCli(command, args = [], env = process.env) {
  return spawnSync(process.execPath, [
    scriptPath,
    command,
    '--manifest', partialManifestPath,
    '--scanner', scannerPath,
    ...args,
  ], { encoding: 'utf8', env });
}

test('validate-partial CLI accepts the checked-in partial identity', () => {
  const result = runPartialCli('validate-partial');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('materialize-sealed and sealed-image CLI strictly transport a sealed manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-sealed-'));
  const outputPath = join(directory, 'runtime.json');
  try {
    const encoded = Buffer.from(`${JSON.stringify(exactV16SealedManifest())}\n`).toString('base64');
    const materialized = runPartialCli('materialize-sealed', ['--output', outputPath], {
      ...process.env,
      SEALED_RECOVERY_MANIFEST_B64: encoded,
    });
    assert.equal(materialized.status, 0, materialized.stderr);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), exactV16SealedManifest());
    const image = spawnSync(process.execPath, [
      scriptPath,
      'sealed-image',
      '--manifest', outputPath,
      '--partial-manifest', partialManifestPath,
      '--scanner', scannerPath,
      '--image', 'subwave-web',
    ], { encoding: 'utf8' });
    assert.equal(image.status, 0, image.stderr);
    assert.deepEqual(JSON.parse(image.stdout), {
      image: 'subwave-web',
      tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1',
      pullRef: `ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1@${buildDigests['subwave-web']}`,
      digest: buildDigests['subwave-web'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('seal CLI accepts exactly five build records and emits a base64 sealed manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-seal-'));
  const recordsDirectory = join(directory, 'records');
  const binDirectory = join(directory, 'bin');
  const outputPath = join(directory, 'runtime.json');
  const githubOutput = join(directory, 'github-output');
  try {
    await mkdir(recordsDirectory);
    await mkdir(binDirectory);
    for (const [image, digest] of Object.entries(buildDigests)) {
      await writeFile(join(recordsDirectory, `${image}.json`), `${JSON.stringify({ image, digest })}\n`);
    }
    const cases = Object.entries(exactV16RegistryDigests())
      .map(([image, digest]) => `  *${image}:*) printf '%s\\n' '"${digest}"' ;;`)
      .join('\n');
    const dockerPath = join(binDirectory, 'docker');
    await writeFile(dockerPath, `#!/bin/sh\ncase "$4" in\n${cases}\nesac\n`);
    await chmod(dockerPath, 0o755);
    const result = runPartialCli('seal', ['--build-digests', recordsDirectory, '--output', outputPath], {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      GITHUB_OUTPUT: githubOutput,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), exactV16SealedManifest());
    assert.match(await readFile(githubOutput, 'utf8'), /^manifest_b64=[A-Za-z0-9+/=]+\n$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
