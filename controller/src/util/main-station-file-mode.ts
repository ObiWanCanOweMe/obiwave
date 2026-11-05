// Exact runtime-file modes requested for the main station only.
import { chmod, lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export async function ensureMainStationFileMode(file: string): Promise<void> {
  const path = resolve(file);
  const parent = dirname(path);
  const station = basename(path) === 'secrets.env' ? parent
    : basename(path) === 'index.json' && basename(parent) === 'qobuz-cache' ? dirname(parent) : null;
  if (!station || basename(station) !== 'main' || basename(dirname(station)) !== 'stations') return;
  // Never widen a symlink's target; an atomic save replaces the link itself.
  if ((await lstat(path)).isFile()) await chmod(path, 0o644);
}
