// Hourly archive index over the MP3s radio.liq writes to
// `${STATE_DIR}/archive/%Y-%m-%d/%H-00.mp3`. Read-only; each GET re-scans (a
// two-level walk, one entry per hour).

import { readdir, stat, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';

const ARCHIVE_ROOT = join(config.stateDir, 'archive');

// Date directories: "YYYY-MM-DD". Hour files: "HH-00.mp3".
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_RE = /^(\d{2})-00\.mp3$/;

type RemoveDir = (path: string, options: { recursive: true; force: true }) => Promise<void>;
type ReadDir = (path: string) => Promise<string[]>;
type RemovalOptions = { readDir?: ReadDir; removeDir?: RemoveDir };

export class ArchiveRootError extends Error {
  constructor(
    readonly operation: 'prune' | 'clear',
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`Archive ${operation} could not enumerate the archive root`, options);
    this.name = 'ArchiveRootError';
  }
}

function rootErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string') return error.code;
  return 'UNKNOWN';
}

async function archiveDayDirs(
  operation: 'prune' | 'clear',
  readDir: ReadDir,
): Promise<string[]> {
  try {
    return await readDir(ARCHIVE_ROOT);
  } catch (error) {
    const code = rootErrorCode(error);
    if (code === 'ENOENT') return [];
    throw new ArchiveRootError(operation, code, { cause: error });
  }
}

export interface ArchiveRemovalResult {
  removed: number;
  bytes: number;
  failedDirs: string[];
}

export interface ArchiveEntry {
  // YYYY-MM-DD/HH-00.mp3 — the safe relative path used by the download route.
  path: string;
  date: string;   // YYYY-MM-DD
  hour: number;   // 0-23
  bytes: number;
  mtime: string;  // ISO
}

// Scan the archive tree, newest first. `limit` bounds the response size.
export async function list({ limit = 500 }: { limit?: number } = {}): Promise<ArchiveEntry[]> {
  if (!existsSync(ARCHIVE_ROOT)) return [];
  let dayDirs: string[] = [];
  try {
    dayDirs = (await readdir(ARCHIVE_ROOT)).filter(d => DATE_RE.test(d)).sort().reverse();
  } catch {
    return [];
  }

  const out: ArchiveEntry[] = [];
  for (const date of dayDirs) {
    let files: string[] = [];
    try {
      files = await readdir(join(ARCHIVE_ROOT, date));
    } catch {
      continue;
    }
    // Hours descending so each day's newest hour appears first.
    files.sort().reverse();
    for (const f of files) {
      const m = f.match(HOUR_RE);
      if (!m) continue;
      const abs = join(ARCHIVE_ROOT, date, f);
      try {
        const st = await stat(abs);
        if (!st.isFile()) continue;
        out.push({
          path: `${date}/${f}`,
          date,
          hour: parseInt(m[1], 10),
          bytes: st.size,
          mtime: st.mtime.toISOString(),
        });
        if (out.length >= limit) return out;
      } catch {}
    }
  }
  return out;
}

// Resolve a client-supplied relative path against the archive root, rejecting
// anything that escapes the tree or doesn't match the canonical naming scheme.
// Returns the absolute path on success, or null if the input is unsafe / missing.
export function resolveEntry(rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 64) return null;
  const m = rel.match(/^(\d{4}-\d{2}-\d{2})\/(\d{2}-00\.mp3)$/);
  if (!m) return null;
  const abs = resolve(ARCHIVE_ROOT, rel);
  if (!abs.startsWith(ARCHIVE_ROOT + '/')) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

export function openStream(abs: string) {
  return createReadStream(abs);
}

// Retention sweep — delete whole day directories older than `days`. 0 means
// keep forever (the pre-30-day-default legacy value, preserved on upgrade by
// normalizeArchiveRetentionDays), and callers gate on that before calling.
// Day-granular on purpose: comparing the YYYY-MM-DD directory name against a
// cutoff date can never touch the file Liquidsoap currently holds open (today's
// dir is always inside any positive retention window). `.ndignore` and anything
// else at the root is untouched, same as clearAll below.
export async function pruneOlderThan(
  days: number,
  { readDir = readdir, removeDir = rm }: RemovalOptions = {},
): Promise<ArchiveRemovalResult> {
  if (!Number.isFinite(days) || days <= 0) return { removed: 0, bytes: 0, failedDirs: [] };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const dayDirs = (await archiveDayDirs('prune', readDir))
    .filter(d => DATE_RE.test(d) && d < cutoff);

  let removed = 0;
  let bytes = 0;
  const failedDirs: string[] = [];
  for (const date of dayDirs) {
    const dir = join(ARCHIVE_ROOT, date);
    let dayRemoved = 0;
    let dayBytes = 0;
    try {
      for (const f of await readdir(dir)) {
        if (!HOUR_RE.test(f)) continue;
        try {
          const st = await stat(join(dir, f));
          if (st.isFile()) { dayRemoved += 1; dayBytes += st.size; }
        } catch {}
      }
    } catch {}
    try {
      await removeDir(dir, { recursive: true, force: true });
      removed += dayRemoved;
      bytes += dayBytes;
    } catch {
      failedDirs.push(date);
    }
  }
  return { removed, bytes, failedDirs };
}

// Delete every hourly recording under the archive root. Only YYYY-MM-DD day
// directories are removed — anything else in the tree (notably the `.ndignore`
// the broadcast entrypoint drops here to keep these mixdowns out of a
// co-located Navidrome scan) is left untouched. Returns how many hour files
// were removed and the bytes freed, for the operator's confirmation toast.
//
// Safe to run while on air: if Liquidsoap currently holds this hour's file
// open, the unlink just detaches the name — it keeps writing to the now-orphan
// inode and reopens a fresh file at the next HH:00 (output.file reopen_when).
export async function clearAll(
  { readDir = readdir, removeDir = rm }: RemovalOptions = {},
): Promise<ArchiveRemovalResult> {
  const dayDirs = (await archiveDayDirs('clear', readDir)).filter(d => DATE_RE.test(d));

  let removed = 0;
  let bytes = 0;
  const failedDirs: string[] = [];
  for (const date of dayDirs) {
    const dir = join(ARCHIVE_ROOT, date);
    // Tally the hour files before the directory goes, for the report.
    let dayRemoved = 0;
    let dayBytes = 0;
    try {
      for (const f of await readdir(dir)) {
        if (!HOUR_RE.test(f)) continue;
        try {
          const st = await stat(join(dir, f));
          if (st.isFile()) { dayRemoved += 1; dayBytes += st.size; }
        } catch {}
      }
    } catch {}
    try {
      await removeDir(dir, { recursive: true, force: true });
      removed += dayRemoved;
      bytes += dayBytes;
    } catch {
      failedDirs.push(date);
    }
  }
  return { removed, bytes, failedDirs };
}
