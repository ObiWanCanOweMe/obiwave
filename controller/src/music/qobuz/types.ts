import type { Track } from '../../broadcast/queue/types.js';
export interface QobuzCredentials { appId: string; appSecret: string; userAuthToken: string; userId: string }
export interface QobuzAuthority { accountKey: string; revision: number }
export interface QobuzTrack { id: string; title: string; artist: string; album: string; duration: number; explicit: boolean; isrc?: string; artworkUrl?: string; [key: string]: unknown }
export interface QobuzRef { provider: 'qobuz'; trackId: string; accountKey: string; generation: string }
export type CachedTrack = Track & QobuzTrack & { id: string; providerRef: QobuzRef };
export interface CacheLease { track: CachedTrack; release(): void; accepted(hitAt: number): Promise<void> }
export interface ValidatedAudio { bytes: number; duration: number; suffix: 'flac'; samplingRate: number; bitDepth: number; channelCount: number }
export class QobuzError extends Error {
  constructor(public readonly code: string) { super(`Qobuz ${code}`); this.name = 'QobuzError'; }
}
