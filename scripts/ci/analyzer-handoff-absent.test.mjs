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

test('unrelated fork design history survives upstream documentation cleanup', () => {
  for (const path of [
    'docs/superpowers/specs/2026-07-16-dj-beds-design.md',
    'docs/superpowers/specs/2026-07-16-private-station-design.md',
    'docs/superpowers/specs/2026-07-16-say-suggestions-generate-design.md',
    'docs/superpowers/specs/2026-07-16-schedule-override-pin-show-design.md',
    'docs/superpowers/specs/2026-07-18-cloud-tts-voice-discovery-design.md',
    'docs/superpowers/specs/2026-07-18-handoff-track-boundary-design.md',
    'docs/superpowers/specs/2026-07-18-on-air-location-design.md',
    'docs/superpowers/specs/2026-07-19-issue-1099-analyzer-cuda-quiet-design.md',
    'docs/superpowers/specs/2026-07-20-theme-foundation-design.md',
    'docs/superpowers/specs/2026-07-21-private-station-shared-password-design.md',
    'docs/superpowers/specs/2026-07-23-admin-imaging-page-design.md',
    'docs/superpowers/specs/2026-07-23-admin-shadcn-sidebar-design.md',
    'docs/superpowers/specs/2026-07-23-editable-moods-design.md',
    'docs/superpowers/specs/2026-07-23-imaging-beds-protect-and-generate-design.md',
  ]) {
    assert.equal(existsSync(resolve(root, path)), true, path);
  }
});
