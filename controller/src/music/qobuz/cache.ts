import { mkdir, lstat, realpath, rename, chmod, readdir, unlink, open, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
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
  completedAt: z.number().finite(), lastHitAt: z.number().finite().nullable(), expiresAt: z.number().finite(),
});
type Entry = z.infer<typeof entrySchema>;
export function createQobuzCache(deps: { root: string; now?: () => number; references: () => QobuzRef[]; capacityBytes: () => number; freeBytes?: () => Promise<number> }) {
  const root = resolve(deps.root); const now = deps.now ?? Date.now;
  let entries: Entry[] = []; let loaded = false; let parent = ''; let chain: Promise<unknown> = Promise.resolve();
  const leases = new Map<string, number>(); const grace = new Map<string, number>(); const activeParts = new Set<string>(); let reserved = 0;
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
  async function persist() { await safeRoot(); await writeFileAtomic(join(root, 'index.json'), JSON.stringify({ version: 1, entries }), { mode: 0o600 }); }
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
    for (const ref of deps.references()) { protectedSet.add(ref.generation); grace.set(ref.generation, now() + GRACE_MS); }
    for (const [gen, until] of grace) { if (until > now()) protectedSet.add(gen); else grace.delete(gen); }
    return protectedSet;
  }
  async function cleanupInner() {
    await safeRoot(); const protectedSet = protectedGenerations(); let changed = false;
    for (const entry of [...entries]) {
      if (entry.expiresAt > now() || protectedSet.has(entry.generation)) continue;
      try { await unlink(pathFor(entry.generation)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue; }
      entries = entries.filter(e => e !== entry); changed = true;
      await unlink(pathFor(entry.generation, 'cover')).catch(() => {});
    }
    if (changed) await persist();
    const known = new Set(entries.map(e => e.generation));
    for (const name of await readdir(root)) {
      if (!owned.test(name) || activeParts.has(name) || known.has(name.slice(0, 36)) || protectedSet.has(name.slice(0, 36))) continue;
      const stat = await lstat(join(root, name)).catch(() => null);
      if (stat && now() - stat.mtimeMs > 24 * 60 * 60 * 1000) await unlink(join(root, name)).catch(() => {});
    }
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
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // An invalid index cannot establish ownership. Keep its files and
          // stop admission rather than deleting a possibly live generation.
          loaded = false; throw new QobuzError('invalid cache index');
        }
        entries = []; await persist();
      }
      protectedGenerations();
    },
    // Implemented below to keep all writes behind the same serializer.
    lookup(match: RequestMatch, authority: QobuzAuthority): Promise<CacheLease | null> { return serial(async () => {
      await safeRoot();
      const candidates = entries.filter(e => e.accountKey === authority.accountKey && e.expiresAt > now());
      const found = selectExactRecording(match, candidates.map(e => ({ ...e.metadata, id: `qobuz:${e.metadata.id}` })));
      if (!found) return null;
      const entry = candidates.find(e => `qobuz:${e.metadata.id}` === found.id);
      return entry && await validFile(entry) ? leaseFor(entry, true) : null;
    }); },
    lease(ref: QobuzRef, renew = false): Promise<CacheLease | null> { return serial(async () => { const entry = entries.find(e => same(e, ref)); return entry && entry.expiresAt > now() && await validFile(entry) ? leaseFor(entry, renew) : null; }); },
    reserve(bytes = MAX_AUDIO_BYTES): Promise<{ path: string; release(): void }> { return serial(async () => {
      await cleanupInner();
      const used = entries.reduce((n, e) => n + e.audio.bytes, 0);
      const free = await (deps.freeBytes ? deps.freeBytes() : statfs(root).then(s => s.bavail * s.bsize));
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_AUDIO_BYTES || used + reserved + bytes > deps.capacityBytes() || !Number.isFinite(free) || free - reserved - bytes < 512 * 1024 * 1024) throw new QobuzError('cache capacity unavailable');
      reserved += bytes; const name = `${randomUUID()}.part`; activeParts.add(name); let released = false;
      return { path: join(root, name), release() { if (released) return; released = true; reserved -= bytes; activeParts.delete(name); } };
    }); },
    publish(metadata: QobuzTrack, partial: { path: string; audio: ValidatedAudio }, authority: QobuzAuthority): Promise<CacheLease> { return serial(async () => {
      await safeRoot(); const name = partial.path.slice(root.length + 1);
      if (dirname(partial.path) !== root || !activeParts.has(name) || !owned.test(name)) throw new QobuzError('invalid cache publication');
      const stat = await lstat(partial.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== partial.audio.bytes) throw new QobuzError('incomplete audio');
      const entry = entrySchema.parse({ generation: randomUUID(), accountKey: authority.accountKey, metadata, audio: partial.audio, completedAt: now(), lastHitAt: null, expiresAt: now() + QOBUZ_RETENTION_MS });
      await rename(partial.path, pathFor(entry.generation)); await chmod(pathFor(entry.generation), 0o644);
      entries.push(entry);
      try { await persist(); } catch (error) { entries = entries.filter(e => e !== entry); throw error; }
      return leaseFor(entry, false);
    }); },
    cleanup(): Promise<void> { return serial(cleanupInner); },
    async resolve(ref: QobuzRef): Promise<string | null> { const entry = entries.find(e => same(e, ref)); return entry && await validFile(entry) ? pathFor(entry.generation) : null; },
    metadata(id: string, accountKey?: string) { const entry = [...entries].reverse().find(e => `qobuz:${e.metadata.id}` === id && (!accountKey || e.accountKey === accountKey)); return entry ? trackOf(entry) : null; },
    status() { return { bytes: entries.reduce((sum, e) => sum + e.audio.bytes, 0), items: entries.length }; },
  };
}
export type QobuzCache = ReturnType<typeof createQobuzCache>;
