#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadPartialRecoveryManifest,
  loadRecoveryManifest,
  loadSealedRecoveryManifest,
  recoveryImage,
  validateRecoveryManifest,
  validateSealedRecoveryManifest,
  verifyRecoveryImage,
} from '../release/recovery-manifest.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REF = /^[a-z0-9][a-z0-9./_-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PINNED_IMAGE_REF = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/;

function commandRunner(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validWorkspacePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/workspace/')) return false;
  const segments = value.slice('/workspace/'.length).split('/');
  return segments.length > 0 && segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

function checkedRun(run, command, args, label) {
  let result;
  try {
    result = run(command, args);
  } catch {
    throw new Error(`Trivy ${label} command failed`);
  }
  if (!isObject(result) || result.status !== 0) throw new Error(`Trivy ${label} command failed`);
  return result;
}

function recoveryRun(run) {
  return (command, args) => checkedRun(run, command, args, 'recovery verification').stdout;
}

function validateScanner(scanner) {
  if (!exactKeys(scanner, ['schemaVersion', 'version', 'imageRef'])
    || scanner.schemaVersion !== 1
    || typeof scanner.version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(scanner.version)
    || typeof scanner.imageRef !== 'string'
    || !PINNED_IMAGE_REF.test(scanner.imageRef)) {
    throw new Error('Trivy scanner configuration is invalid');
  }
}

function validateImage(image) {
  if (!exactKeys(image, ['image', 'tagRef'])
    && !exactKeys(image, ['image', 'tagRef', 'pullRef', 'digest'])) {
    throw new Error('Trivy image configuration is invalid');
  }
  if (typeof image.image !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(image.image)
    || typeof image.tagRef !== 'string' || !IMAGE_REF.test(image.tagRef)
    || !image.tagRef.startsWith(`ghcr.io/obiwancanoweme/${image.image}:`)) {
    throw new Error('Trivy image configuration is invalid');
  }
  if (Object.hasOwn(image, 'pullRef')
    && (typeof image.pullRef !== 'string' || !image.pullRef.startsWith(`${image.tagRef}@`) || !new RegExp(`^${image.tagRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@sha256:[a-f0-9]{64}$`).test(image.pullRef)
      || typeof image.digest !== 'string' || !DIGEST.test(image.digest) || !image.pullRef.endsWith(`@${image.digest}`))) {
    throw new Error('Trivy image configuration is invalid');
  }
}

function validateOptions({ scanner, image, format, output, cacheDirectory, run }) {
  validateScanner(scanner);
  validateImage(image);
  if (format !== 'json' && format !== 'sarif') throw new Error('Trivy format must be json or sarif');
  if (!validWorkspacePath(output)) throw new Error('Trivy output must be an explicit repository-relative workspace path');
  if (!validWorkspacePath(cacheDirectory)) throw new Error('Trivy cache directory must be an explicit repository-relative workspace path');
  if (typeof run !== 'function') throw new Error('Trivy command runner is required');
}

function insideWorkspace(workspace, candidate) {
  const path = relative(workspace, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function resolveApprovedDirectory(workspace, directory, label) {
  let existing = directory;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error(`Trivy ${label} must resolve inside the workspace`);
    existing = parent;
  }
  if (!insideWorkspace(workspace, realpathSync(existing))) {
    throw new Error(`Trivy ${label} must resolve inside the workspace`);
  }
  mkdirSync(directory, { recursive: true });
  const resolved = realpathSync(directory);
  if (!insideWorkspace(workspace, resolved)) throw new Error(`Trivy ${label} must resolve inside the workspace`);
  return resolved;
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveWorkspaceBindings(output, cacheDirectory) {
  const workspace = realpathSync(process.cwd());
  const outputHost = resolve(workspace, `.${output.slice('/workspace'.length)}`);
  const cacheHost = resolve(workspace, `.${cacheDirectory.slice('/workspace'.length)}`);
  if (!insideWorkspace(workspace, outputHost) || !insideWorkspace(workspace, cacheHost)) {
    throw new Error('Trivy workspace path is invalid');
  }
  resolveApprovedDirectory(workspace, dirname(outputHost), 'output directory');
  const outputEntry = lstatIfPresent(outputHost);
  if (outputEntry?.isSymbolicLink() || (outputEntry && !insideWorkspace(workspace, realpathSync(outputHost)))) {
    throw new Error('Trivy output must resolve inside the workspace');
  }
  return {
    workspace,
    cacheHost: resolveApprovedDirectory(workspace, cacheHost, 'cache directory'),
  };
}

function verifyRecovery({ recovery, partialRecovery, scanner, image, run }) {
  try {
    if (partialRecovery === undefined) {
      validateRecoveryManifest({ manifest: recovery, scannerConfig: scanner });
    } else {
      validateSealedRecoveryManifest({ manifest: recovery, partialManifest: partialRecovery, scannerConfig: scanner });
    }
    const expected = recoveryImage(recovery, image.image);
    if (expected.tagRef !== image.tagRef || expected.pullRef !== image.pullRef || expected.digest !== image.digest) {
      throw new Error('Recovery image identity does not match the manifest');
    }
    verifyRecoveryImage({ manifest: recovery, imageName: image.image, run: recoveryRun(run) });
    return expected;
  } catch (error) {
    if (error.message === 'Recovery image identity does not match the manifest') throw error;
    throw new Error('Recovery digest verification failed');
  }
}

export function runTrivyScan({ scanner, image, format, output, cacheDirectory, recovery, partialRecovery, run = commandRunner }) {
  validateOptions({ scanner, image, format, output, cacheDirectory, run });
  if (partialRecovery !== undefined && recovery === undefined) {
    throw new Error('Trivy partial recovery manifest requires a sealed recovery manifest');
  }
  const bindings = resolveWorkspaceBindings(output, cacheDirectory);
  let target = image;
  if (recovery !== undefined) {
    target = verifyRecovery({ recovery, partialRecovery, scanner, image, run });
    checkedRun(run, 'docker', ['pull', target.pullRef], 'pull');
    checkedRun(run, 'docker', ['tag', target.pullRef, target.tagRef], 'tag');
    checkedRun(run, 'docker', ['image', 'inspect', target.tagRef], 'local image inspection');
  } else {
    checkedRun(run, 'docker', ['pull', target.tagRef], 'pull');
  }

  checkedRun(run, 'docker', [
    'run', '--rm',
    '--volume', '/var/run/docker.sock:/var/run/docker.sock',
    '--volume', `${bindings.workspace}:/workspace`,
    '--volume', `${bindings.cacheHost}:/root/.cache/trivy`,
    scanner.imageRef,
    'image', '--image-src', 'docker', '--scanners', 'vuln', '--severity', 'CRITICAL,HIGH',
    '--format', format, '--output', output, target.tagRef,
  ], 'scanner');

  if (recovery !== undefined) verifyRecovery({ recovery, partialRecovery, scanner, image: target, run });
  return Object.freeze({ image: target.tagRef, format, output });
}

function parseCli(argv) {
  const allowed = new Set(['scanner', 'image-name', 'tag-ref', 'pull-ref', 'format', 'output', 'cache-directory', 'recovery-manifest', 'partial-recovery-manifest']);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const name = flag?.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.has(name) || value === undefined || Object.hasOwn(values, name)) throw new Error('Trivy command arguments are invalid');
    values[name] = value;
  }
  for (const name of ['scanner', 'image-name', 'tag-ref', 'format', 'output', 'cache-directory']) {
    if (!values[name]) throw new Error(`Trivy command requires --${name}`);
  }
  for (const name of ['recovery-manifest', 'partial-recovery-manifest']) {
    if (values[name] && !/^security\/releases\/[A-Za-z0-9._-]+\.json$/.test(values[name])) {
      throw new Error('Recovery manifest must be a repository-relative path below security/releases');
    }
  }
  if (values['partial-recovery-manifest'] && !values['recovery-manifest']) {
    throw new Error('Trivy partial recovery manifest requires --recovery-manifest');
  }
  if (!values['recovery-manifest'] && values['pull-ref']) throw new Error('Trivy command accepts --pull-ref only with --recovery-manifest');
  if (values['recovery-manifest'] && !values['pull-ref']) throw new Error('Trivy recovery command requires --pull-ref');
  if (values.output.startsWith('/') || values['cache-directory'].startsWith('/')
    || values.output.split('/').includes('..') || values['cache-directory'].split('/').includes('..')) {
    throw new Error('Trivy output and cache directory must be repository-relative paths');
  }
  return values;
}

async function loadScannerConfig(scannerPath) {
  try {
    return JSON.parse(await readFile(scannerPath, 'utf8'));
  } catch {
    throw new Error('Trivy scanner configuration could not be loaded');
  }
}

async function loadCliRecoveryManifest(manifestPath, scannerPath) {
  try {
    return await loadRecoveryManifest({ manifestPath, scannerPath });
  } catch {
    throw new Error('Recovery manifest could not be loaded');
  }
}

async function loadCliSealedRecoveryManifest(manifestPath, partialManifestPath, scannerPath) {
  try {
    return await loadSealedRecoveryManifest({ manifestPath, partialManifestPath, scannerPath });
  } catch {
    throw new Error('Recovery manifest could not be loaded');
  }
}

async function loadCliPartialRecoveryManifest(manifestPath, scannerPath) {
  try {
    return await loadPartialRecoveryManifest({ manifestPath, scannerPath });
  } catch {
    throw new Error('Recovery manifest could not be loaded');
  }
}

export async function runCli(argv = process.argv.slice(2), { run = commandRunner } = {}) {
  const values = parseCli(argv);
  const scanner = await loadScannerConfig(values.scanner);
  const image = {
    image: values['image-name'],
    tagRef: values['tag-ref'],
    ...(values['pull-ref'] ? { pullRef: values['pull-ref'], digest: values['pull-ref'].slice(values['pull-ref'].lastIndexOf('@') + 1) } : {}),
  };
  const recovery = values['recovery-manifest']
    ? values['partial-recovery-manifest']
      ? await loadCliSealedRecoveryManifest(
        values['recovery-manifest'], values['partial-recovery-manifest'], values.scanner,
      )
      : await loadCliRecoveryManifest(values['recovery-manifest'], values.scanner)
    : undefined;
  const partialRecovery = values['partial-recovery-manifest']
    ? await loadCliPartialRecoveryManifest(values['partial-recovery-manifest'], values.scanner)
    : undefined;
  const result = runTrivyScan({
    scanner,
    image,
    format: values.format,
    output: `/workspace/${values.output}`,
    cacheDirectory: `/workspace/${values['cache-directory']}`,
    recovery,
    partialRecovery,
    run,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
