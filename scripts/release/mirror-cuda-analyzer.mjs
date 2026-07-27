#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseForkTag } from './fork-tag.mjs';

const SOURCE_REPOSITORY = 'ghcr.io/perminder-klair/subwave-analyzer-cuda';
const DESTINATION_REPOSITORY = 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda';
const DIGEST_FORMAT = '{{json .Manifest.Digest}}';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function cudaMirrorRefs(releaseTag) {
  const { version } = parseForkTag(releaseTag);
  return {
    source: `${SOURCE_REPOSITORY}:${version}`,
    destination: `${DESTINATION_REPOSITORY}:${releaseTag}`,
  };
}

function commandRunner(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function inspectedDigest(result) {
  if (result.status !== 0) return null;
  try {
    const value = JSON.parse(result.stdout);
    return typeof value === 'string' && DIGEST_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function destinationIsExplicitlyAbsent(result, destination) {
  if (result.status === 0) return false;
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const escapedDestination = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /manifest unknown/i.test(diagnostic)
    || new RegExp(`(?:^|\\n)${escapedDestination}: not found(?:\\r?$|\\n)`, 'i').test(diagnostic);
}

export function mirrorCudaAnalyzer(releaseTag, { run = commandRunner } = {}) {
  const { source, destination } = cudaMirrorRefs(releaseTag);
  const sourceResult = run('docker', ['buildx', 'imagetools', 'inspect', source, '--format', DIGEST_FORMAT]);
  const sourceDigest = inspectedDigest(sourceResult);
  if (!sourceDigest) throw new Error(`Could not inspect source image: ${source}`);

  const destinationResult = run('docker', ['buildx', 'imagetools', 'inspect', destination]);
  if (destinationResult.status === 0) {
    throw new Error(`Immutable-release destination already exists; never overwrite: ${destination}`);
  }
  if (!destinationIsExplicitlyAbsent(destinationResult, destination)) {
    throw new Error(`Could not prove destination image is absent: ${destination}`);
  }

  const copyResult = run('docker', ['buildx', 'imagetools', 'create', '--tag', destination, source]);
  if (copyResult.status !== 0) throw new Error(`Could not mirror CUDA analyzer: ${source} -> ${destination}`);

  const destinationDigestResult = run(
    'docker',
    ['buildx', 'imagetools', 'inspect', destination, '--format', DIGEST_FORMAT],
  );
  const destinationDigest = inspectedDigest(destinationDigestResult);
  if (!destinationDigest) throw new Error(`Could not inspect mirrored destination image: ${destination}`);
  if (destinationDigest !== sourceDigest) {
    throw new Error(`CUDA analyzer digest mismatch: ${source} -> ${destination}`);
  }

  return { source, destination, digest: sourceDigest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { source, destination, digest } = mirrorCudaAnalyzer(process.env.RELEASE_TAG ?? '');
    console.log(`source: ${source}`);
    console.log(`destination: ${destination}`);
    console.log(`digest: ${digest}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
