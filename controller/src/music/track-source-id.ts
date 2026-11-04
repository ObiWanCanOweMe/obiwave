// Leaf identity policy, safe for Subsonic and source resolution to share.
export function isExternalTrackId(id: unknown): boolean { return typeof id === 'string' && id.startsWith('qobuz:'); }
