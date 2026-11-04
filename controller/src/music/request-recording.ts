// Shared recording identity: no provider-specific fuzzy matching.
import { requestArtistMatches, requestTitleMatches, requestName, resolveDirectRequest, requestedTitle, explicitRequestAttribute, type RequestCatalog, type RequestMatch, type RequestSong } from './request-match.js';
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

export type RecordingProbe = { kind: 'not-specific' | 'absent' | 'indeterminate' | 'refused'; errors: string[] } | { kind: 'found'; track: RequestSong; outcome: 'matched' | 'cooldown' | 'already-queued'; errors: string[] };
export interface RecordingProbeDeps {
  catalog: RequestCatalog; text: string; recentIds: Set<string>; queuedIds: Set<string>; currentId?: string | null;
  blocked(song: RequestSong): boolean; heldBack(song: RequestSong): boolean;
}
export async function probeRequestedRecording(match: RequestMatch, deps: RecordingProbeDeps): Promise<RecordingProbe> {
  const title = requestedTitle(match, deps.text);
  if (!title || match.kind === 'chat') return { kind: 'not-specific', errors: [] };
  // Provider metadata cannot prove a listener's hard language/genre condition.
  if ([match.genre, match.language].some(value => value && explicitRequestAttribute(deps.text, match, value))) return { kind: 'indeterminate', errors: [] };
  const result = await resolveDirectRequest({ ...match, title }, {
    ...deps, identityOnly: true, heldBack: song => deps.blocked(song) || deps.heldBack(song), moodSongs: async () => [], fallbackSongs: async () => [],
  });
  if (result.track) {
    if (deps.blocked(result.track) || deps.heldBack(result.track)) return { kind: 'refused', errors: result.errors };
    return { kind: 'found', track: result.track, outcome: result.outcome === 'cooldown' || result.outcome === 'already-queued' ? result.outcome : 'matched', errors: result.errors };
  }
  return { kind: result.errors.length || result.incomplete || result.outcome === 'unsupported' ? 'indeterminate' : 'absent', errors: result.errors };
}
