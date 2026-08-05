import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli, runTrivyScan } from './trivy-runner.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
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
    Object.freeze({ name: 'subwave-caddy', digest }),
    Object.freeze({ name: 'subwave-broadcast', digest }),
    Object.freeze({ name: 'subwave-controller', digest }),
    Object.freeze({ name: 'subwave-web', digest }),
    Object.freeze({ name: 'subwave-aio', digest }),
    Object.freeze({ name: 'subwave-aio-heavy', digest }),
    Object.freeze({ name: 'subwave-tts-heavy', digest }),
    Object.freeze({ name: 'subwave-analyzer', digest }),
    Object.freeze({ name: 'subwave-analyzer-heavy', digest }),
    Object.freeze({ name: 'subwave-analyzer-cuda', digest }),
  ]),
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

function scanCall(format, output, cacheDirectory) {
  return ['docker', [
    'run', '--rm',
    '--volume', '/var/run/docker.sock:/var/run/docker.sock',
    '--volume', `${workspace}:/workspace`,
    '--volume', `${workspace}${cacheDirectory.slice('/workspace'.length)}:/root/.cache/trivy`,
    scannerConfig.imageRef,
    'image', '--image-src', 'docker', '--scanners', 'vuln', '--severity', 'CRITICAL,HIGH',
    '--format', format, '--output', output, recoveryImage.tagRef,
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

test('scans a normal canonical tag without recovery pull or local retagging', () => {
  const image = Object.freeze({ image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.4.0-obiwave.1' });
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
  const image = Object.freeze({ image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.4.0-obiwave.1' });
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
    image: { image: 'subwave-web', tagRef: 'ghcr.io/other/subwave-web:v1.4.0-obiwave.1' },
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
        image: { image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.4.0-obiwave.1' },
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
      image: { image: 'subwave-web', tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.4.0-obiwave.1' },
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
