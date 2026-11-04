// Shared recording identity: no provider-specific fuzzy matching.
import { requestArtistMatches, requestTitleMatches, requestName, type RequestMatch, type RequestSong } from './request-match.js';
export function selectExactRecording(match: RequestMatch, candidates: RequestSong[]): RequestSong | null {
  if (!match.title?.trim() || match.kind === 'chat') return null;
  const exact = candidates.filter(song => requestTitleMatches(match.title, song.title) && requestArtistMatches(match.artist, song) && (!match.album || requestName(match.album) === requestName(song.album)));
  const recordings = new Map<string, RequestSong>();
  for (const song of exact) {
    // ISRC alone cannot merge unrelated credits returned by a broken provider.
    const key = typeof song.isrc === 'string' && song.isrc ? `${requestName(song.artist)}:${song.isrc}` : song.id;
    if (!recordings.has(key)) recordings.set(key, song);
  }
  return recordings.size === 1 ? [...recordings.values()][0] : null;
}
