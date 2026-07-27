import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const activeFiles = [
  '.env.example',
  'CLAUDE.md',
  'README.md',
  'cli/src/assets.generated.ts',
  'controller/src/config.ts',
  'controller/src/music/analyze.ts',
  'docker-compose.yml',
  'docker-compose.byo.yml',
  'docker-compose.dev.yml',
  'deploy/portainer/docker-compose.yml',
];
const forbidden = /\bANALYZE_HANDOFF\b|analyzer-handoff|remote analyzer mode|Odin fetches stream URLs|Use\s+`?url`?\s+when\s+ANALYZE_URL\b|ANALYZE_URL[^\n]*remote host[^\n]*fetch/i;

test('remote analyzer handoff is absent from active runtime and operator surfaces', () => {
  const offenders = [];
  for (const path of activeFiles) {
    const text = readFileSync(resolve(root, path), 'utf8');
    if (forbidden.test(text)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], offenders.join(', '));
});

test('remote analyzer handoff implementation and dedicated docs are deleted', () => {
  for (const path of [
    'controller/src/music/analyzer-handoff.ts',
    'controller/scripts/analyzer-handoff.test.ts',
    'docs/superpowers/specs/2026-07-07-remote-analyzer-url-handoff-design.md',
    'docs/superpowers/plans/2026-07-07-remote-analyzer-url-handoff.md',
  ]) {
    assert.equal(existsSync(resolve(root, path)), false, path);
  }
});
