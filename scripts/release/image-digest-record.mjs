#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMAGE = /^subwave-[a-z0-9-]+$/;
const CANONICAL_NAMESPACE = 'ghcr.io/obiwancanoweme';
const KEYS = ['schemaVersion', 'image', 'tagRef', 'digest', 'pullRef'];

function invalid() {
  return new Error('Image digest evidence is invalid');
}

function exactKeys(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === KEYS.length
    && KEYS.every((key) => Object.hasOwn(value, key));
}

function validateRecord(record, { expectedImage, expectedTagRef }) {
  if (!exactKeys(record)
    || record.schemaVersion !== 1
    || typeof record.image !== 'string'
    || !IMAGE.test(record.image)
    || record.image !== expectedImage
    || record.tagRef !== expectedTagRef
    || record.tagRef !== `${CANONICAL_NAMESPACE}/${record.image}:${expectedTagRef.split(':').at(-1)}`
    || typeof record.digest !== 'string'
    || !DIGEST.test(record.digest)
    || record.pullRef !== `${record.tagRef}@${record.digest}`) {
    throw invalid();
  }
  return Object.freeze({ ...record });
}

async function collectFiles(directory) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      throw invalid();
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw invalid();
    }
  }
  await visit(directory);
  return files;
}

export async function loadImageDigestRecord({ directory, expectedImage, expectedTagRef }) {
  if (typeof directory !== 'string' || directory.length === 0
    || typeof expectedImage !== 'string' || !IMAGE.test(expectedImage)
    || typeof expectedTagRef !== 'string') {
    throw invalid();
  }
  const files = await collectFiles(directory);
  if (files.length !== 1) {
    throw new Error('Expected exactly one digest evidence record');
  }
  if (!files[0].endsWith(`/${expectedImage}.json`)) throw invalid();
  try {
    const record = JSON.parse(await readFile(files[0], 'utf8'));
    return validateRecord(record, { expectedImage, expectedTagRef });
  } catch (error) {
    if (error?.message === 'Expected exactly one digest evidence record') throw error;
    throw invalid();
  }
}

export async function createImageDigestRecord({ directory, image, tagRef, digest }) {
  const record = validateRecord({
    schemaVersion: 1,
    image,
    tagRef,
    digest,
    pullRef: `${tagRef}@${digest}`,
  }, { expectedImage: image, expectedTagRef: tagRef });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${image}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return record;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['create', 'resolve'].includes(command) || rest.length % 2 !== 0) throw invalid();
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag.startsWith('--') || !value || Object.hasOwn(values, flag.slice(2))) throw invalid();
    values[flag.slice(2)] = value;
  }
  return { command, values };
}

export async function runCli(argv = process.argv.slice(2), output = process.stdout) {
  const { command, values } = parseArgs(argv);
  if (command === 'create') {
    if (Object.keys(values).sort().join(',') !== 'digest,directory,image,tag-ref') throw invalid();
    return createImageDigestRecord({
      directory: values.directory,
      image: values.image,
      tagRef: values['tag-ref'],
      digest: values.digest,
    });
  }
  if (Object.keys(values).sort().join(',') !== 'directory,image,tag-ref') throw invalid();
  const record = await loadImageDigestRecord({
    directory: values.directory,
    expectedImage: values.image,
    expectedTagRef: values['tag-ref'],
  });
  output.write(`tag_ref=${record.tagRef}\n`);
  output.write(`pull_ref=${record.pullRef}\n`);
  output.write(`digest=${record.digest}\n`);
  return record;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
