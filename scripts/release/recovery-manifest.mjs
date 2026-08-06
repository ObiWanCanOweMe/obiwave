#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';

import { CANONICAL_IMAGE_NAMESPACE, EXPECTED_IMAGES } from '../security/trivy-policy.mjs';

const SCANNER_VERSION = '0.67.2';
const SCANNER_IMAGE = 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const APPROVED_RECOVERIES = Object.freeze({
  'v1.3.0-obiwave.2': Object.freeze({
    sourceCommit: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' }),
    ]),
  }),
  'v1.5.0-obiwave.1': Object.freeze({
    sourceCommit: 'fe269a1e632fe6f886ac987f641f41326e1392e0',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:cdf89341b5a0c5c31493f6b2653b45631aac6e184148af8a46db02ff3072f235' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:32eb3d4c2a4146e31f37a389bc4d3b8309d3f13bf31edf5e7bf3a687f96ad5d0' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:5aa26e9be46fdb2d733e7da2c74af63bbfeb7630575cae6bcbf0bf7c9b29ee55' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:f2f635a3b9d581db1478a74e5dfddbdae6faa31bb4b7694c7e03095915130008' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:f745b4ae1133af9e77f1006ccf2ca219a6df0243451b4e633c143f0b6cc1ab8a' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:2d37d9c15e88b90523c437e8330c7245050f92a2eefc513ac6a556ca7c68a90b' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:41a6be4327f9f321b0993da4bac93a6359e440c1c26f7af52b663bcb083a3784' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:ec22ae65a95f60d070414b2fa73a7ec481190d66355426ce1cdbfdb142ef9f2c' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:290e2cd443bcee737fc4806f77384f172858e133f4fc0c0292195be9d53c9c5c' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:a69d2f866eb9d991a69212b5605c15a3631d4d21cec8c4608a6cb29f9d7c9cc2' }),
    ]),
  }),
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(reason) {
  throw new Error(`Recovery manifest invalid: ${reason}`);
}

function freezeManifest(manifest) {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    releaseTag: manifest.releaseTag,
    sourceCommit: manifest.sourceCommit,
    scanner: Object.freeze({ ...manifest.scanner }),
    images: Object.freeze(manifest.images.map((image) => Object.freeze({ ...image }))),
  });
}

export function validateRecoveryManifest({ manifest, scannerConfig }) {
  if (!hasExactKeys(manifest, ['schemaVersion', 'releaseTag', 'sourceCommit', 'scanner', 'images'])) {
    fail('manifest keys must be schemaVersion, releaseTag, sourceCommit, scanner, and images');
  }
  if (manifest.schemaVersion !== 1) fail('schemaVersion must equal 1');
  const approvedRecovery = APPROVED_RECOVERIES[manifest.releaseTag];
  if (!approvedRecovery) fail('releaseTag is not approved');
  if (manifest.sourceCommit !== approvedRecovery.sourceCommit || !SHA.test(manifest.sourceCommit)) {
    fail(`sourceCommit must equal ${approvedRecovery.sourceCommit}`);
  }
  if (!hasExactKeys(manifest.scanner, ['version', 'imageRef'])) {
    fail('scanner keys must be version and imageRef');
  }
  if (manifest.scanner.version !== SCANNER_VERSION || manifest.scanner.imageRef !== SCANNER_IMAGE) {
    fail('scanner must match the pinned recovery scanner');
  }
  if (!hasExactKeys(scannerConfig, ['schemaVersion', 'version', 'imageRef'])) {
    fail('scanner config keys must be schemaVersion, version, and imageRef');
  }
  if (
    scannerConfig.schemaVersion !== 1 ||
    scannerConfig.version !== manifest.scanner.version ||
    scannerConfig.imageRef !== manifest.scanner.imageRef
  ) {
    fail('scanner config must equal the recovery scanner');
  }
  if (!Array.isArray(manifest.images) || manifest.images.length !== approvedRecovery.images.length) {
    fail(`images must contain exactly ${approvedRecovery.images.length} entries`);
  }
  for (const [index, entry] of manifest.images.entries()) {
    const approved = approvedRecovery.images[index];
    if (!hasExactKeys(entry, ['name', 'digest'])) fail(`image ${index} keys must be name and digest`);
    if (entry.name !== approved.name || entry.name !== EXPECTED_IMAGES[index]) {
      fail(`image ${index} must equal ${approved.name}`);
    }
    if (!DIGEST.test(entry.digest)) fail(`image ${entry.name} must have a lowercase sha256 digest`);
    if (entry.digest !== approved.digest) fail(`image ${entry.name} digest is not approved`);
  }
  return freezeManifest(manifest);
}

export async function loadRecoveryManifest({ manifestPath, scannerPath }) {
  let manifest;
  let scannerConfig;
  try {
    [manifest, scannerConfig] = await Promise.all([
      readFile(manifestPath, 'utf8').then(JSON.parse),
      readFile(scannerPath, 'utf8').then(JSON.parse),
    ]);
  } catch {
    throw new Error('Recovery manifest files could not be read as JSON');
  }
  return validateRecoveryManifest({ manifest, scannerConfig });
}

export function recoveryImage(manifest, imageName) {
  const entry = manifest.images.find(({ name }) => name === imageName);
  if (!entry) throw new Error(`Recovery manifest has no image: ${imageName}`);
  const tagRef = `${CANONICAL_IMAGE_NAMESPACE}/${entry.name}:${manifest.releaseTag}`;
  return { image: entry.name, tagRef, pullRef: `${tagRef}@${entry.digest}`, digest: entry.digest };
}

function commandRunner(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runCommand(run, command, args, label) {
  try {
    return run(command, args);
  } catch {
    throw new Error(`Recovery ${label} command failed`);
  }
}

function requireOutput(output, label) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error(`Recovery ${label} command returned no output`);
  }
  return output.trim();
}

function parseDigest(output) {
  let value;
  try {
    value = JSON.parse(requireOutput(output, 'image inspection'));
  } catch (error) {
    if (error.message.startsWith('Recovery ')) throw error;
    throw new Error('Recovery image inspection returned an invalid digest');
  }
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new Error('Recovery image inspection returned an invalid digest');
  }
  return value;
}

function parseRelease(output) {
  let value;
  try {
    value = JSON.parse(requireOutput(output, 'GitHub release'));
  } catch (error) {
    if (error.message.startsWith('Recovery ')) throw error;
    throw new Error('Recovery GitHub release returned invalid JSON');
  }
  if (!hasExactKeys(value, ['tagName', 'targetCommitish']) || typeof value.tagName !== 'string' || typeof value.targetCommitish !== 'string') {
    throw new Error('Recovery GitHub release returned invalid metadata');
  }
  return value;
}

function parseScannerVersion(output) {
  const match = /^Version:\s+(\d+\.\d+\.\d+)\s*$/.exec(requireOutput(output, 'scanner version'));
  if (!match) throw new Error('Recovery scanner returned an invalid version');
  return match[1];
}

export function verifyRecoveryImage({ manifest, imageName, run = commandRunner }) {
  const expected = recoveryImage(manifest, imageName);
  const actual = parseDigest(runCommand(run, 'docker', [
    'buildx', 'imagetools', 'inspect', expected.tagRef,
    '--format', '{{json .Manifest.Digest}}',
  ], 'image inspection'));
  if (actual !== expected.digest) throw new Error(`Recovery image digest mismatch: ${imageName}`);
  return Object.freeze({ image: imageName, digest: actual, tagRef: expected.tagRef });
}

export function verifyRecoveryPreflight({ manifest, repository, run = commandRunner }) {
  if (typeof repository !== 'string' || repository.trim() === '') {
    throw new Error('Recovery repository is required');
  }
  const tagCommit = requireOutput(
    runCommand(run, 'git', ['rev-parse', `${manifest.releaseTag}^{commit}`], 'release tag'),
    'release tag',
  );
  if (tagCommit !== manifest.sourceCommit) throw new Error('Recovery release tag source mismatch');

  const release = parseRelease(runCommand(run, 'gh', [
    'release', 'view', manifest.releaseTag, '--repo', repository,
    '--json', 'tagName,targetCommitish',
  ], 'GitHub release'));
  if (release.tagName !== manifest.releaseTag || release.targetCommitish !== manifest.sourceCommit) {
    throw new Error('Recovery GitHub release source mismatch');
  }

  const images = manifest.images.map((entry) => {
    const { tagRef } = recoveryImage(manifest, entry.name);
    const digest = parseDigest(runCommand(run, 'docker', [
      'buildx', 'imagetools', 'inspect', tagRef,
      '--format', '{{json .Manifest.Digest}}',
    ], 'image inspection'));
    if (digest !== entry.digest) throw new Error(`Recovery image digest mismatch: ${entry.name}`);
    return Object.freeze({ image: entry.name, digest });
  });

  const scannerVersion = parseScannerVersion(runCommand(
    run,
    'docker',
    ['run', '--rm', manifest.scanner.imageRef, '--version'],
    'scanner version',
  ));
  if (scannerVersion !== manifest.scanner.version) throw new Error('Recovery scanner version mismatch');
  return Object.freeze({ tag: manifest.releaseTag, source: tagCommit, scannerVersion, images: Object.freeze(images) });
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!['validate', 'verify-all', 'verify-image', 'image'].includes(command)) {
    throw new Error('Recovery command must be validate, verify-all, verify-image, or image');
  }
  const allowed = new Set(['manifest', 'scanner', 'repository', 'image']);
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || !allowed.has(flag.slice(2)) || Object.hasOwn(values, flag.slice(2))) {
      throw new Error('Recovery command arguments are invalid');
    }
    values[flag.slice(2)] = value;
  }
  if (!values.manifest || !values.scanner) throw new Error('Recovery command requires --manifest and --scanner');
  if (command === 'validate' && (values.repository || values.image)) {
    throw new Error('validate does not accept --repository or --image');
  }
  if (command === 'verify-all' && (!values.repository || values.image)) {
    throw new Error('verify-all requires --repository and does not accept --image');
  }
  if (!['validate', 'verify-all'].includes(command) && (!values.image || values.repository)) {
    throw new Error(`${command} requires --image and does not accept --repository`);
  }
  return { command, values };
}

async function writeImageOutput(image) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `tag_ref=${image.tagRef}\npull_ref=${image.pullRef}\ndigest=${image.digest}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(image)}\n`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, values } = parseCli(argv);
  const manifest = await loadRecoveryManifest({ manifestPath: values.manifest, scannerPath: values.scanner });
  if (command === 'validate') return;
  if (command === 'verify-all') {
    process.stdout.write(`${JSON.stringify(verifyRecoveryPreflight({ manifest, repository: values.repository }))}\n`);
    return;
  }
  if (command === 'verify-image') {
    process.stdout.write(`${JSON.stringify(verifyRecoveryImage({ manifest, imageName: values.image }))}\n`);
    return;
  }
  await writeImageOutput(recoveryImage(manifest, values.image));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
