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
  assert.match(publish, /quality-gate:\s*\n\s+uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(publish, /build:\s*\n\s+needs: \[validate, quality-gate\]/);
  assert.match(publish, /scan-images:\s*\n\s+needs: \[validate, quality-gate, build\]/);
  assert.match(publish, /deploy-production:\s*\n\s+needs: \[validate, quality-gate, build, scan-images\]/);
});

test('each matrix build refuses an existing exact image tag after login', () => {
  const login = publish.indexOf('uses: docker/login-action@v3');
  const immutableCheck = publish.indexOf('node scripts/ci/assert-image-tag-absent.mjs');
  const build = publish.indexOf('uses: docker/build-push-action@v6');
  assert.ok(login >= 0 && immutableCheck > login && build > immutableCheck);
  assert.match(publish, /IMAGE_REF: ghcr\.io\/obiwancanoweme\/\$\{\{ matrix\.image \}\}:\$\{\{ github\.ref_name \}\}/);
});

test('private image scans authenticate with package read permission', () => {
  assert.match(publish, /scan-images:[\s\S]*?permissions:[\s\S]*?packages: read/);
  assert.match(scan, /permissions:[\s\S]*?packages: read/);
  assert.match(scan, /scan:[\s\S]*?uses: docker\/login-action@v3[\s\S]*?uses: aquasecurity\/trivy-action/);
});

test('production timeout covers bounded target and rollback operations', () => {
  assert.match(publish, /deploy-production:[\s\S]*?timeout-minutes: 30/);
});
