// Live composition. Domain modules never import the queue; startup injects refs.
import { join } from 'node:path';
import { STATE_DIR } from '../../config.js';
import * as settings from '../../settings.js';
import * as blocklist from '../blocklist.js';
import { heldBackFromShow } from '../explicit-policy.js';
import { createQobuzCache } from './cache.js';
import { createQobuzService } from './service.js';
import { effectiveQobuzCredentials, qobuzAuthority, verifyQobuzAuthority, qobuzCredentialStatus } from './credentials.js';
import type { QobuzRef, QobuzTrack } from './types.js';
import type { QobuzStatus } from '../../schemas/qobuz.js';
let references: () => QobuzRef[] = () => []; let initialized = false;
export const qobuzCache = createQobuzCache({ root: join(STATE_DIR, 'qobuz-cache'), references: () => references(), capacityBytes: () => (settings.get().qobuz?.cacheMaxGb ?? 5) * 1024**3 });
export function qobuzTrackAllowed(track: QobuzTrack) {
  const song = { ...track, id: `qobuz:${track.id}`, explicitStatus: track.explicit ? 'explicit' : 'clean' };
  return !blocklist.hitOf(song) && !heldBackFromShow(song, settings.resolveActiveShow());
}
export const qobuzService = createQobuzService({ cache: qobuzCache, enabled: () => initialized && settings.get().qobuz?.enabled === true, credentials: effectiveQobuzCredentials, authority: qobuzAuthority, verify: verifyQobuzAuthority, allowed: qobuzTrackAllowed });
export async function initializeQobuz(referenceReader: () => QobuzRef[]) {
  references = referenceReader;
  await qobuzCache.load(); initialized = true;
  await qobuzCache.cleanup();
}
export function qobuzStatus(): QobuzStatus {
  const status = qobuzService.status();
  return { enabled: settings.get().qobuz?.enabled === true, ready: initialized && !!effectiveQobuzCredentials(), credentials: qobuzCredentialStatus(), ...status };
}
