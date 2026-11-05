import assert from 'node:assert/strict';
import { chmod, mkdir, stat, symlink, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { createTempDir, removeTempDir } from './test-utils/temp-dir.js';
import { createQobuzCache } from '../src/music/qobuz/cache.js';
import { ensureMainStationFileMode } from '../src/util/main-station-file-mode.js';

const root = createTempDir(join(tmpdir(), 'main-runtime-mode-'));
const station = join(root, 'stations', 'main');
await mkdir(station, { recursive: true });
process.env.STATE_DIR = station;
after(() => removeTempDir(root));
const { saveSecrets, loadSecretsIntoEnv } = await import('../src/setup/secrets.js');
const mode = async (file: string) => (await stat(file)).mode & 0o777;

test('main secrets are 0644 on creation, rewrite and boot with restrictive umask', async () => {
  const file = join(station, 'secrets.env');
  const mask = process.umask(0o077);
  try {
    await saveSecrets({ QOBUZ_APP_ID: 'fixture-app' });
    assert.equal(await mode(file), 0o644);
    await chmod(file, 0o600);
    await saveSecrets({ QOBUZ_USER_ID: '42' });
    assert.equal(await mode(file), 0o644);
    await chmod(file, 0o600);
    await loadSecretsIntoEnv();
    assert.equal(await mode(file), 0o644);
  } finally { process.umask(mask); }
});

test('main cache index is 0644 on creation, recovery and publication', async () => {
  const cacheRoot = join(station, 'qobuz-cache');
  const file = join(cacheRoot, 'index.json');
  const makeCache = () => createQobuzCache({ root: cacheRoot, references: () => [], capacityBytes: () => 1024 ** 3, freeBytes: async () => 2 * 1024 ** 3 });
  const mask = process.umask(0o077);
  try {
    const cache = makeCache();
    await cache.load();
    assert.equal(await mode(file), 0o644);
    await chmod(file, 0o600);
    await makeCache().load();
    assert.equal(await mode(file), 0o644);
    await chmod(file, 0o600);
    const partial = await cache.reserve(4);
    await writeFile(partial.path, 'data');
    const lease = await cache.publish(
      { id: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 200, explicit: false },
      { path: partial.path, audio: { bytes: 4, duration: 200, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2 } },
      { accountKey: 'a'.repeat(64), revision: 1 },
    );
    partial.release(); lease.release();
    assert.equal(await mode(file), 0o644);
  } finally { process.umask(mask); }
});

test('mode exception excludes other stations and symlink targets', async () => {
  const otherRoot = join(root, 'stations', 'other', 'qobuz-cache');
  const cache = createQobuzCache({ root: otherRoot, references: () => [], capacityBytes: () => 1024 ** 3 });
  await cache.load();
  assert.equal(await mode(join(otherRoot, 'index.json')), 0o600);
  const otherSecrets = join(root, 'stations', 'other', 'secrets.env');
  await writeFile(otherSecrets, '', { mode: 0o600 });
  await ensureMainStationFileMode(otherSecrets);
  assert.equal(await mode(otherSecrets), 0o600);
  const link = join(station, 'secrets.env');
  await unlink(link);
  await symlink(otherSecrets, link);
  await ensureMainStationFileMode(link);
  assert.equal(await mode(otherSecrets), 0o600);
});
