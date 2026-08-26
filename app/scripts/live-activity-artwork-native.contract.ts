import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createApi } from '../src/lib/api';
import { resolveAirCard } from '../src/lib/air-card';

if (process.platform !== 'darwin') {
  throw new Error('the source-level Swift contract requires the macOS Swift toolchain');
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const swiftSource = join(
  appDir,
  'modules/live-activity/ios/LiveActivityArtworkIdentity.swift',
);
const swiftHarness = join(scriptDir, 'live-activity-artwork-native-harness.swift');

const track = {
  title: 'Private cut',
  artist: 'Resident',
  album: 'Archive',
  duration: 241,
  subsonic_id: 'shared-track-id',
};
const activeShow = {
  name: 'Night Shift',
  persona: {
    id: 'resident',
    name: 'Resident',
    avatar: '/api/persona-avatar/shared',
  },
};
const stationA = createApi('https://alice:station-a-secret@alpha.example.test/private');
const stationB = createApi('https://bob:station-b-secret@beta.example.test/private');
const trackA = resolveAirCard({ api: stationA, nowPlaying: track, activeShow: null, talking: false });
const trackB = resolveAirCard({ api: stationB, nowPlaying: track, activeShow: null, talking: false });
const avatarA = resolveAirCard({ api: stationA, nowPlaying: track, activeShow, talking: true });
const avatarB = resolveAirCard({ api: stationB, nowPlaying: track, activeShow, talking: true });

// These are the literal logical keys emitted by production TypeScript. Keeping
// them explicit proves origin normalization is credential-free and stable.
assert.equal(trackA.artworkKey, '["https://alpha.example.test","shared-track-id"]');
assert.equal(trackB.artworkKey, '["https://beta.example.test","shared-track-id"]');
assert.equal(avatarA.artworkKey, '["https://alpha.example.test","/api/persona-avatar/shared"]');
assert.equal(avatarB.artworkKey, '["https://beta.example.test","/api/persona-avatar/shared"]');

const expected = {
  // Derived independently with `printf %s <literal-key> | shasum -a 256`.
  trackA: 'dc97fa03d593cd6ecce124f3b7c492ecc41ec02ed8d1f201829ebd74947835a4.img',
  trackB: 'a3c41e49063051587f636203d27168a074051044b1ff279832649c3927f32ef9.img',
  avatarA: '1a1fc2d936768260d69e87a73e93514aee20b10345f8826aedb076203b3582b6.img',
  avatarB: '294e9a9c8810e923fd758729176e4d5fc3095a6c9f5ccaea3731aa1819b55bff.img',
};

const tempDir = mkdtempSync(join(tmpdir(), 'subwave-live-activity-contract-'));
const executable = join(tempDir, 'live-activity-artwork-contract');
try {
  const compile = spawnSync(
    'xcrun',
    ['swiftc', swiftSource, swiftHarness, '-o', executable],
    { encoding: 'utf8' },
  );
  assert.equal(
    compile.status,
    0,
    `Swift contract compile failed:\n${compile.stdout}${compile.stderr}`,
  );

  const run = spawnSync(executable, [
    trackA.artworkKey,
    expected.trackA,
    trackB.artworkKey,
    expected.trackB,
    avatarA.artworkKey,
    expected.avatarA,
    avatarB.artworkKey,
    expected.avatarB,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, `Swift contract failed:\n${run.stdout}${run.stderr}`);
  process.stdout.write(run.stdout);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
