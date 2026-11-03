import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { createTempDir, removeTempDir } from './test-utils/temp-dir.js';

const root = createTempDir(join(tmpdir(), 'subwave-main-settings-mode-'));
const stationDir = join(root, 'stations', 'main');
mkdirSync(stationDir, { recursive: true });
process.env.STATE_DIR = stationDir;
after(() => removeTempDir(root));
const file = join(stationDir, 'settings.json');
const settings = await import('../src/settings.js');
const { setCache } = await import('../src/settings/store.js');
const mode = () => statSync(file).mode & 0o777;

test('main station settings are 0644 on boot and after atomic saves, even under a restrictive umask', async () => {
  writeFileSync(file, JSON.stringify({ station: 'Main mode test' }), { mode: 0o600 });
  chmodSync(file, 0o600);
  setCache(null);
  await settings.load();
  assert.equal(mode(), 0o644, 'existing main settings are corrected at boot');

  chmodSync(file, 0o600);
  const priorMask = process.umask(0o077);
  try {
    await settings.update({ station: 'Main saved' });
    assert.equal(mode(), 0o644, 'save restores the requested mode');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).station, 'Main saved');
    unlinkSync(file);
    await settings.update({ station: 'Main fresh' });
    assert.equal(mode(), 0o644, 'new file is exact despite umask');
  } finally {
    process.umask(priorMask);
  }
});

test('station-management writes keep main at 0644 and other settings private', async () => {
  const { writeSettingsFileSync } = await import('../src/settings/file.js');
  const other = join(root, 'stations', 'other', 'settings.json');
  mkdirSync(join(root, 'stations', 'other'), { recursive: true });
  writeFileSync(other, '{}', { mode: 0o600 });
  chmodSync(file, 0o600);
  writeSettingsFileSync(file, '{"station":"main"}');
  writeSettingsFileSync(other, '{"station":"other"}');
  assert.equal(mode(), 0o644);
  assert.equal(statSync(other).mode & 0o777, 0o600);
});

test('duplicating main keeps the new station private with a split schedule', async () => {
  const { createStation } = await import('../src/stations/manager.js');
  writeFileSync(join(root, 'stations', 'active.json'), JSON.stringify({ activeId: 'main' }));
  writeFileSync(file, JSON.stringify({ station: 'Main', search: { apiKeys: { kagi: 'fixture-key' } } }));
  chmodSync(file, 0o644);
  const duplicate = await createStation(root, { name: 'Private duplicate', mode: 'duplicate', currentName: 'Main' });
  const copied = join(root, 'stations', duplicate.id, 'settings.json');
  assert.equal(statSync(copied).mode & 0o777, 0o600);
  assert.equal(mode(), 0o644);
});
