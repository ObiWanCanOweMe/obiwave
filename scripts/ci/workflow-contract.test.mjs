import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const publish = await readFile(new URL('../../.github/workflows/publish-images.yml', import.meta.url), 'utf8');
const scan = await readFile(new URL('../../.github/workflows/scan-images.yml', import.meta.url), 'utf8');
const cutRelease = await readFile(
  new URL('../../.github/workflows/cut-fork-release.yml', import.meta.url),
  'utf8',
);
const verifyCliAssets = await readFile(
  new URL('../../.github/workflows/verify-cli-assets.yml', import.meta.url),
  'utf8',
);
const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);

test('official JavaScript actions use the Node 24 runtime', async () => {
  const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
    .map((entry) => entry.name)
    .sort();

  for (const workflowFile of workflowFiles) {
    const workflow = await readFile(new URL(workflowFile, workflowDirectory), 'utf8');
    assert.doesNotMatch(workflow, /actions\/checkout@v4/, workflowFile);
    assert.doesNotMatch(workflow, /actions\/setup-node@v4/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/setup-buildx-action@v3/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/build-push-action@v6/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/login-action@v3/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/setup-qemu-action@v3/, workflowFile);
  }
});

test('CI remains unfiltered and reusable while sparing tag runs from cancellation', () => {
  assert.match(ci, /on:\s*\n\s+pull_request:\s*\n\s+push:\s*\n\s+workflow_call:/);
  assert.match(ci, /cancel-in-progress:.*pull_request.*refs\/tags/);
});

test('consolidated CI verifies the generated theme-token mirror', () => {
  assert.match(ci, /if: matrix\.package == 'controller'[\s\S]*npm run gen:themes/);
  assert.match(ci, /git diff --exit-code \.\.\/web\/lib\/theme-tokens\.generated\.ts/);
});

test('app quality matrix runs the native stream-buffer contract', () => {
  const appCommand = ci.match(/- package: app\s*\n\s+command: ([^\n]+)/)?.[1];
  assert.ok(appCommand, 'missing app quality-matrix command');
  assert.match(appCommand, /(?:^|&& )npm run test:stream-buffer-format(?: &&|$)/);
});

test('CUDA analyzer is mirrored, never rebuilt', () => {
  assert.match(publish, /mirror-cuda-analyzer:/);
  assert.match(
    publish,
    /RELEASE_TAG: \$\{\{ github\.ref_name \}\}[\s\S]*node scripts\/release\/mirror-cuda-analyzer\.mjs/,
  );
  const buildMatrix = publish.slice(
    publish.indexOf('  build:'),
    publish.indexOf('    steps:', publish.indexOf('  build:')),
  );
  assert.doesNotMatch(buildMatrix, /subwave-analyzer-cuda/);
});

test('CUDA mirror is preflighted, scanned, and gates deployment', () => {
  assert.match(publish, /tag-preflight:[\s\S]*- subwave-analyzer-cuda/);
  assert.match(publish, /scan-images:[\s\S]*needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer\]/);
  assert.match(publish, /deploy-production:[\s\S]*needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer, scan-images\]/);
  assert.match(scan, /matrix:\s*\n\s+image: \[[^\]]*analyzer-cuda/);
});

test('CLI asset drift watches the analyzer GPU overlay', () => {
  assert.match(verifyCliAssets, /docker-compose\.analyzer-gpu\.yml/);
});

test('release publication waits for the reusable CI gate', () => {
  assert.match(publish, /release-gate:\s*\n\s+uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(publish, /build:\s*\n\s+needs: \[validate, release-gate, tag-preflight\]/);
  assert.match(publish, /scan-images:\s*\n\s+needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer\]/);
  assert.match(publish, /deploy-production:\s*\n\s+needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer, scan-images\]/);
});

test('publication grants package access only to jobs that need it', () => {
  const workflowPermissions = publish.slice(
    publish.indexOf('\npermissions:'),
    publish.indexOf('\nconcurrency:'),
  );
  const preflight = publish.slice(
    publish.indexOf('  tag-preflight:'),
    publish.indexOf('  mirror-cuda-analyzer:'),
  );
  const mirror = publish.slice(
    publish.indexOf('  mirror-cuda-analyzer:'),
    publish.indexOf('  build:'),
  );
  const build = publish.slice(
    publish.indexOf('  build:'),
    publish.indexOf('  scan-images:'),
  );

  assert.match(workflowPermissions, /^\npermissions:\n  contents: read\n$/);
  assert.match(preflight, /permissions:\n      contents: read\n      packages: read/);
  assert.match(mirror, /permissions:\n      contents: read\n      packages: write/);
  assert.match(build, /permissions:\n      contents: read\n      packages: write/);
});

test('release tag concurrency never cancels an in-flight publication', () => {
  assert.match(publish, /concurrency:\s*\n\s+group: publish-images-\$\{\{ github\.ref_name \}\}\s*\n\s+cancel-in-progress: false/);
});

test('all ten exact tags pass a complete preflight before any build starts', () => {
  const preflightStart = publish.indexOf('  tag-preflight:');
  const buildStart = publish.indexOf('  build:');
  const scanStart = publish.indexOf('  scan-images:');
  assert.ok(preflightStart >= 0 && buildStart > preflightStart && scanStart > buildStart);

  const preflight = publish.slice(preflightStart, buildStart);
  const build = publish.slice(buildStart, scanStart);
  const matrix = preflight.match(/matrix:\n\s+image:\n((?:\s+- [^\n]+\n)+)/)?.[1];
  assert.ok(matrix, 'missing tag-preflight image matrix');
  const images = [...matrix.matchAll(/^\s+- ([^\n]+)$/gm)].map(([, image]) => image);
  assert.deepEqual(images, [
    'subwave-caddy',
    'subwave-broadcast',
    'subwave-controller',
    'subwave-web',
    'subwave-aio',
    'subwave-aio-heavy',
    'subwave-tts-heavy',
    'subwave-analyzer',
    'subwave-analyzer-heavy',
    'subwave-analyzer-cuda',
  ]);
  assert.match(preflight, /uses: docker\/login-action@v4[\s\S]*node scripts\/ci\/assert-image-tag-absent\.mjs/);
  assert.doesNotMatch(build, /assert-image-tag-absent/);
});

test('private image scans authenticate with package read permission', () => {
  assert.match(publish, /scan-images:[\s\S]*?permissions:[\s\S]*?packages: read/);
  assert.match(scan, /permissions:[\s\S]*?packages: read/);
  assert.match(scan, /scan:[\s\S]*?uses: docker\/login-action@v4[\s\S]*?uses: aquasecurity\/trivy-action/);
});

test('image scans pin Trivy to the reviewed immutable release commit', () => {
  assert.doesNotMatch(scan, /aquasecurity\/trivy-action@0\.28\.0/);
  assert.match(
    scan,
    /uses: aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0\.36\.0/,
  );
});

test('production timeout covers bounded target and rollback operations', () => {
  assert.match(publish, /deploy-production:[\s\S]*?timeout-minutes: 30/);
});

test('fork release defaults to the fork release branch', () => {
  assert.match(
    cutRelease,
    /target:\s*[\s\S]*?description: Branch, tag, or commit to release[\s\S]*?default: develop/,
  );
});

test('fork release fetches only the requested canonical upstream tag before validation', () => {
  const fetchTag =
    'git fetch --no-tags https://github.com/perminder-klair/subwave.git "refs/tags/${BASE_TAG}:refs/tags/${BASE_TAG}"';
  const fetchIndex = cutRelease.indexOf(fetchTag);
  const validationIndex = cutRelease.indexOf(
    'git rev-parse --verify "refs/tags/${BASE_TAG}^{commit}"',
  );

  assert.ok(fetchIndex >= 0, 'missing exact canonical upstream tag fetch');
  assert.ok(validationIndex > fetchIndex, 'base tag must be fetched before it is validated');
});
