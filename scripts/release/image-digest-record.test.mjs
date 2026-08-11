import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMAGE = 'subwave-tts-heavy-cuda';
const TAG = 'v1.7.0-obiwave.2';
const TAG_REF = `ghcr.io/obiwancanoweme/${IMAGE}:${TAG}`;
const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;

async function loadModule() {
  return import('./image-digest-record.mjs').catch(() => null);
}

async function withDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-image-digest-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function record(overrides = {}) {
  return {
    schemaVersion: 1,
    image: IMAGE,
    tagRef: TAG_REF,
    digest: DIGEST,
    pullRef: `${TAG_REF}@${DIGEST}`,
    ...overrides,
  };
}

test('build digest evidence resolves one exact immutable release artifact', async () => {
  const subject = await loadModule();
  assert.ok(subject, 'image digest record module must exist');

  await withDirectory(async (directory) => {
    await writeFile(join(directory, `${IMAGE}.json`), `${JSON.stringify(record())}\n`);
    assert.deepEqual(
      await subject.loadImageDigestRecord({ directory, expectedImage: IMAGE, expectedTagRef: TAG_REF }),
      record(),
    );
  });
});

test('build digest evidence fails closed on malformed, wrong-repository, stale, mismatched, or duplicated records', async () => {
  const subject = await loadModule();
  assert.ok(subject, 'image digest record module must exist');

  const cases = [
    ['malformed', '{'],
    ['wrong repository', JSON.stringify(record({
      tagRef: `ghcr.io/other/${IMAGE}:${TAG}`,
      pullRef: `ghcr.io/other/${IMAGE}:${TAG}@${DIGEST}`,
    }))],
    ['stale tag', JSON.stringify(record({
      tagRef: `ghcr.io/obiwancanoweme/${IMAGE}:v1.7.0-obiwave.1`,
      pullRef: `ghcr.io/obiwancanoweme/${IMAGE}:v1.7.0-obiwave.1@${DIGEST}`,
    }))],
    ['mismatched pull digest', JSON.stringify(record({ pullRef: `${TAG_REF}@${OTHER_DIGEST}` }))],
  ];

  for (const [name, contents] of cases) {
    await withDirectory(async (directory) => {
      await writeFile(join(directory, `${IMAGE}.json`), `${contents}\n`);
      await assert.rejects(
        subject.loadImageDigestRecord({ directory, expectedImage: IMAGE, expectedTagRef: TAG_REF }),
        /digest evidence/i,
        name,
      );
    });
  }

  await withDirectory(async (directory) => {
    await writeFile(join(directory, `${IMAGE}.json`), `${JSON.stringify(record())}\n`);
    await mkdir(join(directory, 'duplicate'));
    await writeFile(join(directory, 'duplicate', `${IMAGE}.json`), `${JSON.stringify(record())}\n`);
    await assert.rejects(
      subject.loadImageDigestRecord({ directory, expectedImage: IMAGE, expectedTagRef: TAG_REF }),
      /exactly one digest evidence record/i,
    );
  });
});
