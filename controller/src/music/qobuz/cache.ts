import { ensureMainStationFileMode } from '../../util/main-station-file-mode.js';
import { mkdir, lstat, realpath, rename, chmod, readdir, unlink, open, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rasterArtwork, type QobuzArtwork } from './artwork.js';
import { writeFileAtomic } from '../../util/atomic-file.js';
import { selectExactRecording } from '../request-recording.js';
import type { RequestMatch } from '../request-match.js';
import { QobuzError, type QobuzAuthority, type QobuzRef, type QobuzTrack, type CachedTrack, type CacheLease, type ValidatedAudio } from './types.js';
export const QOBUZ_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const GRACE_MS = 120_000;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const owned = new RegExp(`^${UUID}\\.(flac|part|cover)$`);
const entrySchema = z.object({
  generation: z.string().uuid(), accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: z.object({ id: z.string().regex(/^\d{1,20}$/), title: z.string().min(1).max(512), artist: z.string().min(1).max(512), album: z.string().max(512), duration: z.number().positive().finite(), explicit: z.boolean(), isrc: z.string().max(64).optional() }),
  audio: z.object({ bytes: z.number().int().positive().max(MAX_AUDIO_BYTES), duration: z.number().positive().finite(), suffix: z.literal('flac'), samplingRate: z.literal(44100), bitDepth: z.literal(16), channelCount: z.number().int().min(1).max(8) }),
  coverBytes: z.number().int().min(0).max(2 * 1024 * 1024).optional(),
  completedAt: z.number().finite(), lastHitAt: z.number().finite().nullable(), expiresAt: z.number().finite(),
});
type Entry = z.infer<typeof entrySchema>;
export function createQobuzCache(deps: { root: string; now?: () => number; references: () => QobuzRef[]; capacityBytes: () => number; freeBytes?: () => Promise<number> }) {
  const root = resolve(deps.root); const now = deps.now ?? Date.now;
  let entries: Entry[] = []; let loaded = false; let parent = ''; let cleanupFailures = 0; let diskBytes = 0; let chain: Promise<unknown> = Promise.resolve();
  const leases = new Map<string, number>(); const grace = new Map<string, number>(); const activeParts = new Map<string, number>(); let reserved = 0;
  function serial<T>(run: () => Promise<T>): Promise<T> { const result = chain.then(run); chain = result.catch(() => {}); return result; }
  async function safeRoot() {
    if (!loaded || (await realpath(dirname(root))) !== parent || !(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new QobuzError('cache unavailable');
  }
  function pathFor(generation: string, suffix = 'flac') { return join(root, `${generation}.${suffix}`); }
  async function validFile(entry: Entry) {
    await safeRoot();
    try {
      const file = await open(pathFor(entry.generation), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const stat = await file.stat(); return stat.isFile() && stat.size === entry.audio.bytes; } finally { await file.close(); }
    } catch { return false; }
  }
  async function persist(beforeCommit?: () => void) {
    await safeRoot(); const body = JSON.stringify({ version: 1, entries });
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new QobuzError('cache index capacity unavailable');
    await writeFileAtomic(join(root, 'index.json'), body, { mode: 0o600, beforeCommit });
    await ensureMainStationFileMode(join(root, 'index.json'));
  }
  async function ownedDiskUsage(): Promise<number> {
    await safeRoot(); let bytes = 0;
    for (const name of await readdir(root)) {
      if (!owned.test(name) || activeParts.has(name)) continue;
      const stat = await lstat(join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (stat?.isFile()) bytes += stat.size;
    }
    return bytes;
  }
  function reference(entry: Entry): QobuzRef { return { provider: 'qobuz', trackId: entry.metadata.id, accountKey: entry.accountKey, generation: entry.generation }; }
  function trackOf(entry: Entry): CachedTrack {
    return { ...entry.metadata, ...entry.audio, id: `qobuz:${entry.metadata.id}`, replayGain: null, explicitStatus: entry.metadata.explicit ? 'explicit' : 'clean', coverArt: `qobuz-${entry.metadata.id}`, providerRef: reference(entry) };
  }
  function same(entry: Entry, ref: QobuzRef) { return ref.provider === 'qobuz' && entry.generation === ref.generation && entry.accountKey === ref.accountKey && entry.metadata.id === ref.trackId; }
  function leaseFor(entry: Entry, renew: boolean): CacheLease {
    const gen = entry.generation; leases.set(gen, (leases.get(gen) || 0) + 1); let released = false;
    return { track: trackOf(entry), release() { if (released) return; released = true; const count = (leases.get(gen) || 1) - 1; if (count) leases.set(gen, count); else { leases.delete(gen); grace.set(gen, now() + GRACE_MS); } }, async accepted(hitAt) {
      if (released || !renew) return;
      await serial(async () => {
        if (!entries.includes(entry) || !(await validFile(entry))) throw new QobuzError('cache unavailable');
        const previous = { expiresAt: entry.expiresAt, lastHitAt: entry.lastHitAt };
        entry.lastHitAt = Math.max(hitAt, entry.lastHitAt ?? 0); entry.expiresAt = Math.max(entry.expiresAt, hitAt + QOBUZ_RETENTION_MS);
        try { await persist(); } catch (error) { Object.assign(entry, previous); throw error; }
      });
    } };
  }
  function protectedGenerations() {
    const protectedSet = new Set(leases.keys());
    for (const ref of deps.references()) {
      // Recovery can know what is on air without knowing which immutable file
      // the mixer owns. A wildcard pin is internal-only, never a playable ref.
      const generations = ref.generation === '*' ? entries.filter(e => e.metadata.id === ref.trackId).map(e => e.generation) : [ref.generation];
      for (const generation of generations) { protectedSet.add(generation); grace.set(generation, now() + GRACE_MS); }
    }
    for (const [gen, until] of grace) { if (until > now()) protectedSet.add(gen); else grace.delete(gen); }
    return protectedSet;
  }
  async function cleanupInner() {
    await safeRoot(); const protectedSet = protectedGenerations(); let changed = false; cleanupFailures = 0;
    for (const entry of [...entries]) {
      if (entry.expiresAt > now() || protectedSet.has(entry.generation)) continue;
      try { await unlink(pathFor(entry.generation)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { cleanupFailures++; continue; } }
      entries = entries.filter(e => e !== entry); changed = true;
      await unlink(pathFor(entry.generation, 'cover')).catch(() => {});
    }
    if (changed) await persist();
    const known = new Set(entries.map(e => e.generation));
    for (const name of await readdir(root)) {
      if (!owned.test(name) || activeParts.has(name) || known.has(name.slice(0, 36)) || protectedSet.has(name.slice(0, 36))) continue;
      const stat = await lstat(join(root, name)).catch(() => null);
      if (stat && now() - stat.mtimeMs > 24 * 60 * 60 * 1000) await unlink(join(root, name)).catch(() => { cleanupFailures++; });
    }
    diskBytes = await ownedDiskUsage();
  }
  return {
    root,
    async load() {
      await mkdir(dirname(root), { recursive: true }); parent = await realpath(dirname(root));
      await mkdir(root, { mode: 0o755 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      loaded = true; await safeRoot(); await chmod(root, 0o755);
      try {
        const file = await open(join(root, 'index.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
        let text: string;
        try { if ((await file.stat()).size > 8 * 1024 * 1024) throw new QobuzError('invalid cache index'); text = await file.readFile('utf8'); } finally { await file.close(); }
        const parsed = JSON.parse(text);
        if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > 10000) throw new QobuzError('invalid cache index');
        const decoded = z.array(entrySchema).parse(parsed.entries);
        if (new Set(decoded.map(e => e.generation)).size !== decoded.length) throw new QobuzError('invalid cache index');
        entries = decoded;
        await ensureMainStationFileMode(join(root, 'index.json'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // An invalid index cannot establish ownership. Keep its files and
          // stop admission rather than deleting a possibly live generation.
          loaded = false; throw new QobuzError('invalid cache index');
        }
        entries = []; await persist();
      }
      protectedGenerations(); diskBytes = await ownedDiskUsage();
    },
    // Implemented below to keep all writes behind the same serializer.
    lookup(match: RequestMatch, authority: QobuzAuthority): Promise<CacheLease | null> { return serial(async () => {
      await safeRoot();
      const candidates = entries.filter(e => e.accountKey === authority.accountKey && e.expiresAt > now());
      const found = selectExactRecording(match, candidates.map(e => ({ ...e.metadata, id: `qobuz:${e.metadata.id}` })));
      if (!found) return null;
      for (const entry of [...candidates].reverse()) {
        if (`qobuz:${entry.metadata.id}` === found.id && await validFile(entry)) return leaseFor(entry, true);
      }
      return null;
    }); },
    lease(ref: QobuzRef, renew = false): Promise<CacheLease | null> { return serial(async () => { const entry = entries.find(e => same(e, ref)); return entry && entry.expiresAt > now() && await validFile(entry) ? leaseFor(entry, renew) : null; }); },
    reserve(bytes = MAX_AUDIO_BYTES + 2 * 1024 * 1024): Promise<{ path: string; release(): void }> { return serial(async () => {
      await cleanupInner();
      const used = await ownedDiskUsage(); diskBytes = used;
      const free = await (deps.freeBytes ? deps.freeBytes() : statfs(root).then(s => s.bavail * s.bsize));
      if (entries.length + activeParts.size >= 10000 || !Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_AUDIO_BYTES + 2 * 1024 * 1024 || used + reserved + bytes > deps.capacityBytes() || !Number.isFinite(free) || free - reserved - bytes < 512 * 1024 * 1024) throw new QobuzError('cache capacity unavailable');
      reserved += bytes; const name = `${randomUUID()}.part`; activeParts.set(name, bytes); let released = false;
      return { path: join(root, name), release() { if (released) return; released = true; reserved -= bytes; activeParts.delete(name); } };
    }); },
    publish(metadata: QobuzTrack, partial: { path: string; audio: ValidatedAudio; artwork?: QobuzArtwork | null }, authority: QobuzAuthority, authorized: () => boolean = () => true): Promise<CacheLease> { return serial(async () => {
      const guard = () => { if (!authorized()) throw new QobuzError('credentials changed'); };
      guard();
      if (entries.length >= 10000) throw new QobuzError('cache capacity unavailable');
      await safeRoot(); const name = partial.path.slice(root.length + 1);
      if (dirname(partial.path) !== root || !activeParts.has(name) || !owned.test(name)) throw new QobuzError('invalid cache publication');
      const stat = await lstat(partial.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== partial.audio.bytes) throw new QobuzError('incomplete audio');
      const entry = entrySchema.parse({ generation: randomUUID(), accountKey: authority.accountKey, metadata, audio: partial.audio, completedAt: now(), lastHitAt: null, expiresAt: now() + QOBUZ_RETENTION_MS });
      try { await rename(partial.path, pathFor(entry.generation)); await chmod(pathFor(entry.generation), 0o644); }
      catch (error) { await unlink(pathFor(entry.generation)).catch(() => {}); throw error; }
      if (partial.artwork) {
        const artwork = rasterArtwork(partial.artwork.bytes);
        const used = await ownedDiskUsage();
        if (artwork && used + artwork.bytes.length + reserved - (activeParts.get(name) || 0) <= deps.capacityBytes()) {
          try {
            await writeFileAtomic(pathFor(entry.generation, 'cover'), artwork.bytes, { mode: 0o644 });
            entry.coverBytes = artwork.bytes.length;
          } catch { /* optional artwork must not prevent validated music publication */ }
        }
      }
      entries.push(entry);
      try { await persist(guard); }
      catch (error) {
        entries = entries.filter(e => e !== entry);
        await unlink(pathFor(entry.generation)).catch(() => {});
        await unlink(pathFor(entry.generation, 'cover')).catch(() => {});
        diskBytes = await ownedDiskUsage().catch(() => diskBytes);
        throw error;
      }
      diskBytes = await ownedDiskUsage().catch(() => diskBytes + entry.audio.bytes + (entry.coverBytes || 0));
      return leaseFor(entry, false);
    }); },
    cleanup(): Promise<void> { return serial(cleanupInner); },
    async resolve(ref: QobuzRef): Promise<string | null> { const entry = entries.find(e => same(e, ref)); return entry && await validFile(entry) ? pathFor(entry.generation) : null; },
    async cover(id: string, accountKey: string | undefined, generation?: string): Promise<QobuzArtwork | null> {
      if (!accountKey) return null;
      await safeRoot();
      const protectedSet = protectedGenerations();
      const entry = [...entries].reverse().find(e => `qobuz:${e.metadata.id}` === id && e.accountKey === accountKey && (!generation || e.generation === generation) && (e.expiresAt > now() || protectedSet.has(e.generation)));
      if (!entry?.coverBytes) return null;
      try {
        const file = await open(pathFor(entry.generation, 'cover'), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat(); if (!stat.isFile() || stat.size !== entry.coverBytes || stat.size > 2 * 1024 * 1024) return null;
          return rasterArtwork(await file.readFile());
        } finally { await file.close(); }
      } catch { return null; }
    },
    metadata(id: string, accountKey?: string) { const entry = [...entries].reverse().find(e => `qobuz:${e.metadata.id}` === id && (!accountKey || e.accountKey === accountKey)); return entry ? trackOf(entry) : null; },
    status() { return { bytes: diskBytes, items: entries.length, cleanupFailures }; },
  };
}
export type QobuzCache = ReturnType<typeof createQobuzCache>;
