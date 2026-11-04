import { randomBytes } from 'node:crypto';
import * as subsonic from './subsonic.js';
import * as libraryMount from './library-mount.js';
import { pathReadable, onMixerRestart, type PathReadable } from '../broadcast/liquidsoap-control.js';
import { qobuzCache } from './qobuz/runtime.js';
import { QobuzError, type QobuzRef } from './qobuz/types.js';
import type { Track } from '../broadcast/queue/types.js';
import { isExternalTrackId } from './track-source-id.js';
export { isExternalTrackId };
export function isQobuzTrack(track: unknown): track is Track & { providerRef: QobuzRef } {
  const value = track as Track | null;
  const ref = value?.providerRef;
  return isExternalTrackId(value?.id) && ref?.provider === 'qobuz' && value?.id === `qobuz:${ref.trackId}`;
}
let mixerGeneration = 0;
export function invalidateQobuzPlaybackProof() { mixerGeneration++; }
onMixerRestart(invalidateQobuzPlaybackProof);
export interface PlaybackSource { localPath: string | null; resolveProbeId?: string; mixerGeneration?: number; libraryPath?: string | null }
export function qobuzPlaybackProofStands(proof: PlaybackSource) { return proof.mixerGeneration === mixerGeneration; }
export async function resolveTrackPlayback(track: Track, opts: { timeoutMs: number }, deps: { cachePath?: (ref: QobuzRef) => Promise<string | null>; readable?: (path: string, timeoutMs: number) => Promise<PathReadable> } = {}): Promise<PlaybackSource> {
  if (isExternalTrackId(track.id)) {
    if (!isQobuzTrack(track)) throw new QobuzError('cached recording unavailable');
    const generation = mixerGeneration;
    const path = await (deps.cachePath ?? qobuzCache.resolve)(track.providerRef);
    if (!path || await (deps.readable ?? pathReadable)(path, opts.timeoutMs) !== 'yes' || generation !== mixerGeneration) throw new QobuzError('cached recording unavailable');
    return { localPath: path, mixerGeneration: generation };
  }
  const onMount = subsonic.getLocalPath(track);
  const localPath = await libraryMount.mixerReadablePath(onMount, opts.timeoutMs);
  return { localPath, libraryPath: onMount, ...(localPath ? {} : { resolveProbeId: randomBytes(8).toString('hex') }) };
}
