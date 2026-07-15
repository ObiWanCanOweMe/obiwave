import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const publish = await readFile(new URL('../../.github/workflows/publish-images.yml', import.meta.url), 'utf8');
const scan = await readFile(new URL('../../.github/workflows/scan-images.yml', import.meta.url), 'utf8');

test('CI remains unfiltered and reusable while sparing tag runs from cancellation', () => {
  assert.match(ci, /on:\s*\n\s+pull_request:\s*\n\s+push:\s*\n\s+workflow_call:/);
  assert.match(ci, /cancel-in-progress:.*pull_request.*refs\/tags/);
});

test('release publication waits for the reusable CI gate', () => {
  assert.match(publish, /release-gate:\s*\n\s+uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(publish, /build:\s*\n\s+needs: \[validate, release-gate, tag-preflight\]/);
  assert.match(publish, /scan-images:\s*\n\s+needs: \[validate, release-gate, tag-preflight, build\]/);
  assert.match(publish, /deploy-production:\s*\n\s+needs: \[validate, release-gate, tag-preflight, build, scan-images\]/);
});

test('release tag concurrency never cancels an in-flight publication', () => {
  assert.match(publish, /concurrency:\s*\n\s+group: publish-images-\$\{\{ github\.ref_name \}\}\s*\n\s+cancel-in-progress: false/);
});

test('all nine exact tags pass a complete preflight before any build starts', () => {
  const preflightStart = publish.indexOf('  tag-preflight:');
  const buildStart = publish.indexOf('  build:');
  const scanStart = publish.indexOf('  scan-images:');
  assert.ok(preflightStart >= 0 && buildStart > preflightStart && scanStart > buildStart);

  const preflight = publish.slice(preflightStart, buildStart);
  const build = publish.slice(buildStart, scanStart);
  for (const image of [
    'subwave-caddy',
    'subwave-broadcast',
    'subwave-controller',
    'subwave-web',
    'subwave-aio',
    'subwave-aio-heavy',
    'subwave-tts-heavy',
    'subwave-analyzer',
    'subwave-analyzer-heavy',
  ]) {
    assert.match(preflight, new RegExp(`- ${image.replaceAll('-', '\\-')}(?:\\n|$)`));
  }
  assert.match(preflight, /uses: docker\/login-action@v3[\s\S]*node scripts\/ci\/assert-image-tag-absent\.mjs/);
  assert.doesNotMatch(build, /assert-image-tag-absent/);
});

test('private image scans authenticate with package read permission', () => {
  assert.match(publish, /scan-images:[\s\S]*?permissions:[\s\S]*?packages: read/);
  assert.match(scan, /permissions:[\s\S]*?packages: read/);
  assert.match(scan, /scan:[\s\S]*?uses: docker\/login-action@v3[\s\S]*?uses: aquasecurity\/trivy-action/);
});

test('production timeout covers bounded target and rollback operations', () => {
  assert.match(publish, /deploy-production:[\s\S]*?timeout-minutes: 30/);
});
