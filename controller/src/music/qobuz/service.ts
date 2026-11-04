import { createQobuzClient, type QobuzClient } from './client.js';
import { downloadQobuzAudio } from './download.js';
import { selectExactRecording } from '../request-recording.js';
import { requestName, type RequestMatch } from '../request-match.js';
import { QobuzError, type CacheLease, type QobuzAuthority, type QobuzCredentials, type QobuzRef, type QobuzTrack } from './types.js';
import type { QobuzCache } from './cache.js';
import { unlink } from 'node:fs/promises';
export function createQobuzService(deps: {
  cache: QobuzCache; enabled: () => boolean; credentials: () => QobuzCredentials | null; authority: () => QobuzAuthority | null;
  verify: (credentials: QobuzCredentials) => QobuzAuthority | null; allowed: (track: QobuzTrack) => boolean;
  client?: (credentials: QobuzCredentials) => QobuzClient; download?: typeof downloadQobuzAudio;
}) {
  const queries = new Map<string, Promise<QobuzRef | null>>();
  const tracks = new Map<string, Promise<QobuzRef | null>>();
  let active = 0; let lastError: { code: string; at: number } | null = null;
  let verification: { key: string; promise: Promise<QobuzAuthority> } | null = null;
  async function authorityFor(credentials: QobuzCredentials) {
    const authority = deps.authority(); if (authority) return authority;
    // Fingerprint stays in memory only; it is never a log/status field.
    const key = JSON.stringify(credentials);
    if (!verification || verification.key !== key) verification = { key, promise: (async () => {
      const result = await (deps.client ?? createQobuzClient)(credentials).testConnection();
      if (!result.fullTrackAccess) throw new QobuzError('account has no full-track access');
      const verified = deps.verify(credentials);
      if (!verified || verified.accountKey !== result.accountKey) throw new QobuzError('credentials changed');
      return verified;
    })() };
    try { return await verification.promise; } finally { if (verification?.key === key) verification = null; }
  }
  function stillValid(authority: QobuzAuthority | null) {
    const current = deps.authority();
    return !!authority && deps.enabled() && current?.accountKey === authority.accountKey && current.revision === authority.revision;
  }
  async function acquire(match: RequestMatch, caller?: AbortSignal, admit?: (track: QobuzTrack) => void): Promise<CacheLease | null> {
    if (!deps.enabled() || !match.title?.trim() || match.kind === 'chat') return null;
    const credentials = deps.credentials(); if (!credentials) throw new QobuzError('credentials missing');
    const authority = await authorityFor(credentials);
    if (!stillValid(authority)) throw new QobuzError('credentials changed');
    const cached = await deps.cache.lookup(match, authority);
    if (cached) {
      if (!stillValid(authority) || !deps.allowed({ ...cached.track, id: cached.track.providerRef.trackId } as QobuzTrack)) { cached.release(); throw new QobuzError('request unavailable'); }
      try { admit?.(cached.track); } catch (error) { cached.release(); throw error; }
      return cached;
    }
    const key = JSON.stringify([authority.accountKey, authority.revision, requestName(match.title), requestName(match.artist), requestName(match.album)]);
    let work = queries.get(key);
    if (!work) {
      if (queries.size >= 32) throw new QobuzError('acquisition busy');
      work = (async () => {
        const client = (deps.client ?? createQobuzClient)(credentials);
        const results = await client.search([match.title, match.artist].filter(Boolean).join(' '), caller);
        const pick = selectExactRecording(match, results);
        if (!pick) return null;
        const metadata = pick as unknown as QobuzTrack;
        admit?.(metadata);
        if (!stillValid(authority) || !deps.allowed(metadata)) throw new QobuzError('request unavailable');
        const trackKey = `${authority.accountKey}:${authority.revision}:${metadata.id}`;
        let download = tracks.get(trackKey);
        if (!download) {
          if (active >= 2) throw new QobuzError('acquisition busy');
          active++;
          download = (async () => {
            const reservation = await deps.cache.reserve();
            try {
              const resource = await client.fileUrl(metadata.id, caller);
              if (resource.sample || Math.abs(resource.duration - metadata.duration) > Math.max(3, metadata.duration * 0.02)) throw new QobuzError('preview or unavailable recording');
              const audio = await (deps.download ?? downloadQobuzAudio)(resource.url, reservation.path, metadata.duration, caller);
              if (!stillValid(authority) || !deps.allowed(metadata)) throw new QobuzError('credentials or policy changed');
              const lease = await deps.cache.publish(metadata, { path: reservation.path, audio }, authority);
              const ref = lease.track.providerRef; lease.release(); return ref;
            } finally { reservation.release(); await unlink(reservation.path).catch(() => {}); }
          })().finally(() => { active--; tracks.delete(trackKey); });
          tracks.set(trackKey, download);
        }
        return download;
      })().finally(() => queries.delete(key));
      queries.set(key, work);
    }
    try {
      const ref = await work;
      if (!stillValid(authority)) throw new QobuzError('credentials changed');
      if (!ref) return null;
      const lease = await deps.cache.lease(ref);
      if (lease) { try { admit?.(lease.track); } catch (error) { lease.release(); throw error; } }
      return lease;
    } catch (error) {
      lastError = { code: error instanceof QobuzError ? error.code : 'acquisition failed', at: Date.now() };
      throw new QobuzError(lastError.code);
    }
  }
  return { acquire, cleanup: () => deps.cache.cleanup(), status: () => ({ cache: deps.cache.status(), lastError }), stillValid };
}
export type QobuzService = ReturnType<typeof createQobuzService>;
