// Settings-file persistence. The operator explicitly requires the main station's
// settings to be readable at 0644; other stations retain the owner-only policy.
import { chmodSync, lstatSync } from 'node:fs';
import { chmod, lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { writeFileAtomic, writeFileAtomicSync } from '../util/atomic-file.js';

function isMainSettings(file: string): boolean {
  const path = resolve(file);
  return basename(path) === 'settings.json'
    && basename(dirname(path)) === 'main'
    && basename(dirname(dirname(path))) === 'stations';
}

export async function ensureMainSettingsMode(file: string): Promise<void> {
  if (!isMainSettings(file)) return;
  // Do not widen a symlink's target. An atomic save replaces the link itself.
  if ((await lstat(file)).isFile()) await chmod(file, 0o644);
}

export function ensureMainSettingsModeSync(file: string): void {
  if (isMainSettings(file) && lstatSync(file).isFile()) chmodSync(file, 0o644);
}

export async function writeSettingsFile(file: string, contents: string): Promise<void> {
  await writeFileAtomic(file, contents, { mode: isMainSettings(file) ? 0o644 : 0o600 });
  // Atomic writes preserve a tighter prior mode and umask. Apply the requested
  // exact mode after publication so old 0600 files and restrictive umasks converge.
  await ensureMainSettingsMode(file);
}

export function writeSettingsFileSync(file: string, contents: string): void {
  writeFileAtomicSync(file, contents, { mode: isMainSettings(file) ? 0o644 : 0o600 });
  ensureMainSettingsModeSync(file);
}
