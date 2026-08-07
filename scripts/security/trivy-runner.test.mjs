import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli, runTrivyScan } from './trivy-runner.mjs';

const digest = 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f';
const otherDigest = `sha256:${'b'.repeat(64)}`;
const scannerConfig = Object.freeze({
  schemaVersion: 1,
  version: '0.67.2',
  imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
});
const recoveryImage = Object.freeze({
  image: 'subwave-web',
  tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
  pullRef: `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@${digest}`,
  digest,
});
const exactRecovery = Object.freeze({
  schemaVersion: 1,
  releaseTag: 'v1.3.0-obiwave.2',
  sourceCommit: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
  scanner: Object.freeze({ version: '0.67.2', imageRef: scannerConfig.imageRef }),
  images: Object.freeze([
    Object.freeze({ name: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' }),
    Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' }),
    Object.freeze({ name: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' }),
    Object.freeze({ name: 'subwave-web', digest }),
    Object.freeze({ name: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' }),
    Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' }),
    Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' }),
    Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' }),
    Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' }),
    Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' }),
  ]),
});
const partialRecovery = Object.freeze({
  schemaVersion: 2,
  kind: 'partial-publication-recovery',
  releaseTag: 'v1.6.0-obiwave.1',
  sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
  scanner: Object.freeze({ version: '0.67.2', imageRef: scannerConfig.imageRef }),
  images: Object.freeze([
    Object.freeze({ name: 'subwave-caddy', action: 'build' }),
    Object.freeze({ name: 'subwave-broadcast', action: 'preserve', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' }),
    Object.freeze({ name: 'subwave-controller', action: 'preserve', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' }),
    Object.freeze({ name: 'subwave-web', action: 'build' }),
    Object.freeze({ name: 'subwave-aio', action: 'preserve', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' }),
    Object.freeze({ name: 'subwave-aio-heavy', action: 'build' }),
    Object.freeze({ name: 'subwave-tts-heavy', action: 'build' }),
    Object.freeze({ name: 'subwave-analyzer', action: 'preserve', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' }),
    Object.freeze({ name: 'subwave-analyzer-heavy', action: 'build' }),
    Object.freeze({ name: 'subwave-analyzer-cuda', action: 'preserve', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' }),
  ]),
});
const sealedRecovery = Object.freeze({
  schemaVersion: 1,
  releaseTag: partialRecovery.releaseTag,
  sourceCommit: partialRecovery.sourceCommit,
  scanner: partialRecovery.scanner,
  images: Object.freeze([
    Object.freeze({ name: 'subwave-caddy', digest: `sha256:${'a'.repeat(64)}` }),
    Object.freeze({ name: 'subwave-broadcast', digest: partialRecovery.images[1].digest }),
    Object.freeze({ name: 'subwave-controller', digest: partialRecovery.images[2].digest }),
    Object.freeze({ name: 'subwave-web', digest }),
    Object.freeze({ name: 'subwave-aio', digest: partialRecovery.images[4].digest }),
    Object.freeze({ name: 'subwave-aio-heavy', digest: `sha256:${'c'.repeat(64)}` }),
    Object.freeze({ name: 'subwave-tts-heavy', digest: `sha256:${'d'.repeat(64)}` }),
    Object.freeze({ name: 'subwave-analyzer', digest: partialRecovery.images[7].digest }),
    Object.freeze({ name: 'subwave-analyzer-heavy', digest: `sha256:${'e'.repeat(64)}` }),
    Object.freeze({ name: 'subwave-analyzer-cuda', digest: partialRecovery.images[9].digest }),
  ]),
});
const sealedImage = Object.freeze({
  image: 'subwave-web',
  tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1',
  pullRef: `ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1@${digest}`,
  digest,
});
const workspace = process.cwd();
const digestFormat = '{{json .Manifest.Digest}}';

function success(stdout = '') {
  return { status: 0, stdout, stderr: '' };
}

function failure(stderr = 'scanner failed') {
  return { status: 1, stdout: '', stderr };
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

function thrown(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('expected callback to throw');
}

async function rejected(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  assert.fail('expected callback to reject');
}

function scanCall(format, output, cacheDirectory, image = recoveryImage) {
  return ['docker', [
    'run', '--rm',
    '--volume', '/var/run/docker.sock:/var/run/docker.sock',
    '--volume', `${workspace}:/workspace`,
    '--volume', `${workspace}${cacheDirectory.slice('/workspace'.length)}:/root/.cache/trivy`,
    scannerConfig.imageRef,
    'image', '--image-src', 'docker', '--scanners', 'vuln', '--severity', 'CRITICAL,HIGH',
    '--format', format, '--output', output, image.tagRef,
  ]];
}

function recoveryCalls(format = 'json', output = '/workspace/subwave-web.json', cacheDirectory = '/workspace/.tmp/trivy-cache') {
  return [
    ['docker', ['buildx', 'imagetools', 'inspect', recoveryImage.tagRef, '--format', digestFormat]],
    ['docker', ['pull', recoveryImage.pullRef]],
    ['docker', ['tag', recoveryImage.pullRef, recoveryImage.tagRef]],
    ['docker', ['image', 'inspect', recoveryImage.tagRef]],
    scanCall(format, output, cacheDirectory),
    ['docker', ['buildx', 'imagetools', 'inspect', recoveryImage.tagRef, '--format', digestFormat]],
  ];
}

function sealedRecoveryCalls(output = '/workspace/subwave-web.json', cacheDirectory = '/workspace/.tmp/trivy-cache') {
  return [
    ['docker', ['buildx', 'imagetools', 'inspect', sealedImage.tagRef, '--format', digestFormat]],
    ['docker', ['pull', sealedImage.pullRef]],
    ['docker', ['tag', sealedImage.pullRef, sealedImage.tagRef]],
    ['docker', ['image', 'inspect', sealedImage.tagRef]],
    scanCall('json', output, cacheDirectory, sealedImage),
    ['docker', ['buildx', 'imagetools', 'inspect', sealedImage.tagRef, '--format', digestFormat]],
  ];
}

function recoveryOptions(run, overrides = {}) {
  return {
    scanner: scannerConfig,
    image: recoveryImage,
    format: 'json',
    output: '/workspace/subwave-web.json',
    cacheDirectory: '/workspace/.tmp/trivy-cache',
    recovery: exactRecovery,
    run,
    ...overrides,
  };
}

function sealedRecoveryOptions(run, overrides = {}) {
  return {
    scanner: scannerConfig,
    image: sealedImage,
    format: 'json',
    output: '/workspace/subwave-web.json',
    cacheDirectory: '/workspace/.tmp/trivy-cache',
    recovery: sealedRecovery,
    partialRecovery,
    run,
    ...overrides,
  };
}

test('pulls the approved digest, creates only a local canonical tag, and scans through Docker', () => {
  const command = runner(
    success(JSON.stringify(digest)), success(), success(), success(), success(), success(JSON.stringify(digest)),
  );

  const result = runTrivyScan(recoveryOptions(command.run));

  assert.deepEqual(result, {
    image: recoveryImage.tagRef,
    format: 'json',
    output: '/workspace/subwave-web.json',
  });
  assert.deepEqual(command.calls, recoveryCalls());
});

test('uses the same pinned scanner command for SARIF output', () => {
  const command = runner(
    success(JSON.stringify(digest)), success(), success(), success(), success(), success(JSON.stringify(digest)),
  );

  const result = runTrivyScan(recoveryOptions(command.run, {
    format: 'sarif', output: '/workspace/trivy-subwave-web.sarif',
  }));

  assert.deepEqual(result, {
    image: recoveryImage.tagRef,
    format: 'sarif',
    output: '/workspace/trivy-subwave-web.sarif',
  });
  assert.deepEqual(command.calls, recoveryCalls('sarif', '/workspace/trivy-subwave-web.sarif'));
});

test('scans a sealed recovery image only after pre- and post-scan digest verification', () => {
  const command = runner(
    success(JSON.stringify(digest)), success(), success(), success(), success(), success(JSON.stringify(digest)),
  );

  const result = runTrivyScan(sealedRecoveryOptions(command.run));

  assert.deepEqual(result, {
    image: sealedImage.tagRef,
    format: 'json',
    output: '/workspace/subwave-web.json',
  });
  assert.deepEqual(command.calls, sealedRecoveryCalls());
});

test('sealed recovery requires both sealed and partial manifest evidence before child processes run', () => {
  for (const overrides of [
    { recovery: sealedRecovery, partialRecovery: undefined },
    { recovery: undefined, partialRecovery },
  ]) {
    const command = runner();
    assert.throws(() => runTrivyScan(sealedRecoveryOptions(command.run, overrides)), /recovery/i);
    assert.deepEqual(command.calls, []);
  }
});

test('sealed recovery rejects changed remote digests and mismatched pull references before scanning', () => {
  const changedDigest = runner(success(JSON.stringify(otherDigest)));
  assert.throws(() => runTrivyScan(sealedRecoveryOptions(changedDigest.run)), /digest verification failed/i);
  assert.deepEqual(changedDigest.calls, sealedRecoveryCalls().slice(0, 1));

  const mismatchedPull = runner();
  assert.throws(() => runTrivyScan(sealedRecoveryOptions(mismatchedPull.run, {
    image: { ...sealedImage, pullRef: `${sealedImage.tagRef}@${otherDigest}`, digest: otherDigest },
  })), /recovery image identity/i);
  assert.deepEqual(mismatchedPull.calls, []);
});

test('scans a normal canonical tag without recovery pull or local retagging', () => {
  const image = Object.freeze({ image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.1-obiwave.1' });
  const command = runner(success(), success());

  const result = runTrivyScan({
    scanner: scannerConfig,
    image,
    format: 'json',
    output: '/workspace/subwave-web.json',
    cacheDirectory: '/workspace/.tmp/trivy-cache',
    run: command.run,
  });

  assert.deepEqual(result, { image: image.tagRef, format: 'json', output: '/workspace/subwave-web.json' });
  assert.deepEqual(command.calls, [
    ['docker', ['pull', image.tagRef]],
    [
    'docker', [
      'run', '--rm',
      '--volume', '/var/run/docker.sock:/var/run/docker.sock',
      '--volume', `${workspace}:/workspace`,
      '--volume', `${workspace}/.tmp/trivy-cache:/root/.cache/trivy`,
      scannerConfig.imageRef,
      'image', '--image-src', 'docker', '--scanners', 'vuln', '--severity', 'CRITICAL,HIGH',
      '--format', 'json', '--output', '/workspace/subwave-web.json', image.tagRef,
    ],
    ],
  ]);
});

test('fails before scanning when recovery digest verification fails', () => {
  const command = runner(failure('digest mismatch'));

  assert.throws(() => runTrivyScan(recoveryOptions(command.run)), /digest verification failed/i);
  assert.deepEqual(command.calls, recoveryCalls().slice(0, 1));
});

test('fails before pulling when a successful recovery pre-verifier reports the wrong digest', () => {
  const command = runner(success(JSON.stringify(otherDigest)));

  assert.throws(() => runTrivyScan(recoveryOptions(command.run)), /digest verification failed/i);
  assert.deepEqual(command.calls, recoveryCalls().slice(0, 1));
});

test('fails closed without scanning when a normal image pull fails', () => {
  const image = Object.freeze({ image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.1-obiwave.1' });
  const command = runner(failure('private pull secret'));

  const error = thrown(() => runTrivyScan({
    scanner: scannerConfig,
    image,
    format: 'json',
    output: '/workspace/subwave-web.json',
    cacheDirectory: '/workspace/.tmp/trivy-cache',
    run: command.run,
  }));

  assert.match(error.message, /pull command failed/i);
  assert.doesNotMatch(error.message, /secret/i);
  assert.deepEqual(command.calls, [['docker', ['pull', image.tagRef]]]);
});

test('fails closed on pull, local tag, local inspection, scanner, and post-scan digest failures', () => {
  const cases = [
    { name: 'pull', results: [success(JSON.stringify(digest)), failure('secret pull failure')], calls: 2, message: /pull command failed/i },
    { name: 'tag', results: [success(JSON.stringify(digest)), success(), failure('secret tag failure')], calls: 3, message: /tag command failed/i },
    { name: 'inspect', results: [success(JSON.stringify(digest)), success(), success(), failure('secret inspect failure')], calls: 4, message: /local image inspection command failed/i },
    { name: 'scanner', results: [success(JSON.stringify(digest)), success(), success(), success(), failure('secret scanner failure')], calls: 5, message: /scanner command failed/i },
    { name: 'post-scan verification', results: [success(JSON.stringify(digest)), success(), success(), success(), success(), failure('secret remote failure')], calls: 6, message: /digest verification failed/i },
    { name: 'post-scan mismatch', results: [success(JSON.stringify(digest)), success(), success(), success(), success(), success(JSON.stringify(otherDigest))], calls: 6, message: /digest verification failed/i },
  ];

  for (const scenario of cases) {
    const command = runner(...scenario.results);
    const error = thrown(() => runTrivyScan(recoveryOptions(command.run)));
    assert.match(error.message, scenario.message, scenario.name);
    assert.doesNotMatch(error.message, /secret/i, scenario.name);
    assert.deepEqual(command.calls, recoveryCalls().slice(0, scenario.calls), scenario.name);
  }
});

test('rejects invalid scanner, image, format, output, and cache inputs before child processes run', () => {
  const invalid = [
    { scanner: { ...scannerConfig, imageRef: 'aquasec/trivy:0.67.2' }, message: /scanner/i },
    { image: { image: 'subwave-web', tagRef: 'not an image reference' }, message: /image/i },
    { format: 'table', message: /format/i },
    { output: 'subwave-web.json', message: /output/i },
    { output: '/workspace/../subwave-web.json', message: /output/i },
    { cacheDirectory: '/tmp/trivy-cache', message: /cache/i },
    { cacheDirectory: '/workspace/.tmp/../trivy-cache', message: /cache/i },
  ];

  for (const scenario of invalid) {
    const command = runner();
    assert.throws(() => runTrivyScan(recoveryOptions(command.run, scenario)), scenario.message);
    assert.deepEqual(command.calls, []);
  }
});

test('rejects a normal scan image outside the canonical registry namespace', () => {
  const command = runner();
  assert.throws(() => runTrivyScan({
    scanner: scannerConfig,
    image: { image: 'subwave-web', tagRef: 'ghcr.io/other/subwave-web:v1.3.1-obiwave.1' },
    format: 'json',
    output: '/workspace/subwave-web.json',
    cacheDirectory: '/workspace/.tmp/trivy-cache',
    run: command.run,
  }), /image/i);
  assert.deepEqual(command.calls, []);
});

test('rejects cache and output paths that resolve through a workspace symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-trivy-runner-'));
  const originalDirectory = process.cwd();
  try {
    await symlink(tmpdir(), join(directory, 'cache-link'));
    await symlink(tmpdir(), join(directory, 'output-link'));
    process.chdir(directory);

    for (const [label, overrides] of [
      ['cache', { cacheDirectory: '/workspace/cache-link' }],
      ['output', { output: '/workspace/output-link/report.json' }],
    ]) {
      const command = runner();
      assert.throws(() => runTrivyScan({
        scanner: scannerConfig,
        image: { image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.1-obiwave.1' },
        format: 'json',
        output: '/workspace/report.json',
        cacheDirectory: '/workspace/cache',
        run: command.run,
        ...overrides,
      }), new RegExp(`${label}.*workspace`, 'i'));
      assert.deepEqual(command.calls, []);
    }
  } finally {
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a dangling output-file symlink before Docker can pull or scan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-trivy-dangling-output-'));
  const originalDirectory = process.cwd();
  try {
    await symlink(join(tmpdir(), 'subwave-trivy-outside-target-does-not-exist'), join(directory, 'report.json'));
    process.chdir(directory);
    const command = runner();

    assert.throws(() => runTrivyScan({
      scanner: scannerConfig,
      image: { image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.1-obiwave.1' },
      format: 'json',
      output: '/workspace/report.json',
      cacheDirectory: '/workspace/cache',
      run: command.run,
    }), /output.*workspace/i);
    assert.deepEqual(command.calls, []);
  } finally {
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});

test('runCli translates real recovery arguments and loads the checked-in scanner and manifest', async () => {
  const imageDigest = 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f';
  const command = runner(
    success(JSON.stringify(imageDigest)), success(), success(), success(), success(), success(JSON.stringify(imageDigest)),
  );

  const result = await runCli([
    '--scanner', 'security/trivy-scanner.json',
    '--image-name', 'subwave-web',
    '--tag-ref', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    '--pull-ref', `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@${imageDigest}`,
    '--format', 'json',
    '--output', 'trivy-runner-cli.json',
    '--cache-directory', '.tmp/trivy-runner-cli-cache',
    '--recovery-manifest', 'security/releases/v1.3.0-obiwave.2.json',
  ], { run: command.run });

  assert.deepEqual(result, {
    image: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    format: 'json',
    output: '/workspace/trivy-runner-cli.json',
  });
  assert.deepEqual(command.calls.map(([name, args]) => [name, args.slice(0, 3)]), [
    ['docker', ['buildx', 'imagetools', 'inspect']],
    ['docker', ['pull', `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@${imageDigest}`]],
    ['docker', ['tag', `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@${imageDigest}`, 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2']],
    ['docker', ['image', 'inspect', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2']],
    ['docker', ['run', '--rm', '--volume']],
    ['docker', ['buildx', 'imagetools', 'inspect']],
  ]);
});

test('runCli loads sealed recovery evidence only when both approved manifest paths are supplied', async () => {
  const sealedPath = `security/releases/runtime-v1.6.0-obiwave.1-${process.pid}.json`;
  const common = [
    '--scanner', 'security/trivy-scanner.json',
    '--image-name', 'subwave-web',
    '--tag-ref', sealedImage.tagRef,
    '--pull-ref', sealedImage.pullRef,
    '--format', 'json',
    '--output', 'sealed-runner-cli.json',
    '--cache-directory', '.tmp/sealed-runner-cli-cache',
  ];
  await writeFile(sealedPath, `${JSON.stringify(sealedRecovery)}\n`);
  try {
    const command = runner(
      success(JSON.stringify(digest)), success(), success(), success(), success(), success(JSON.stringify(digest)),
    );
    const result = await runCli([
      ...common,
      '--recovery-manifest', sealedPath,
      '--partial-recovery-manifest', 'security/releases/v1.6.0-obiwave.1.partial.json',
    ], { run: command.run });
    assert.deepEqual(result, {
      image: sealedImage.tagRef,
      format: 'json',
      output: '/workspace/sealed-runner-cli.json',
    });
    assert.deepEqual(command.calls, sealedRecoveryCalls('/workspace/sealed-runner-cli.json', '/workspace/.tmp/sealed-runner-cli-cache'));

    const sealedOnly = await rejected(() => runCli([
      ...common,
      '--recovery-manifest', sealedPath,
    ]));
    assert.match(sealedOnly.message, /recovery manifest|partial recovery/i);

    const partialOnly = await rejected(() => runCli([
      ...common,
      '--partial-recovery-manifest', 'security/releases/v1.6.0-obiwave.1.partial.json',
    ]));
    assert.match(partialOnly.message, /partial recovery|arguments/i);
  } finally {
    await rm(sealedPath, { force: true });
  }
});

test('runCli sanitizes missing and malformed scanner and recovery files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-trivy-config-secret-'));
  const malformedScanner = join(directory, 'scanner-content-secret.json');
  const malformedRecovery = 'security/releases/v1.3.0-obiwave.2-malformed-secret.json';
  await writeFile(malformedScanner, '{scanner-content-secret');
  await writeFile(malformedRecovery, '{recovery-content-secret');
  const base = [
    '--image-name', 'subwave-web',
    '--tag-ref', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    '--format', 'json', '--output', 'report.json', '--cache-directory', '.tmp/cache',
  ];
  try {
    for (const args of [
      ['--scanner', join(directory, 'missing-config-secret.json'), ...base],
      ['--scanner', malformedScanner, ...base],
      ['--scanner', 'security/trivy-scanner.json', ...base,
        '--pull-ref', `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@${digest}`,
        '--recovery-manifest', 'security/releases/missing-recovery-secret.json'],
      ['--scanner', 'security/trivy-scanner.json', ...base,
        '--pull-ref', `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@${digest}`,
        '--recovery-manifest', malformedRecovery],
    ]) {
      const error = await rejected(() => runCli(args));
      assert.doesNotMatch(error.message, /secret/i);
      assert.match(error.message, /configuration|recovery manifest/i);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(malformedRecovery, { force: true });
  }
});

test('rejects recovery references that differ from the immutable manifest identity', () => {
  const command = runner();
  assert.throws(() => runTrivyScan(recoveryOptions(command.run, {
    image: {
      ...recoveryImage,
      tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.3',
      pullRef: `ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.3@${digest}`,
    },
  })), /recovery image identity/i);
  assert.deepEqual(command.calls, []);
});
