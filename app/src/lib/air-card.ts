// What the now-playing strip says on surfaces outside the app's own UI. The
// lock screen (useNowPlayingInfo) and the Live Activity (useLiveActivity) must
// agree, so both resolve here. The one non-obvious rule: while the DJ is
// talking the ARTIST slot and the artwork swap to the persona, but the TITLE
// keeps the track, since the song has not changed.

import type { StationApi } from './api';
import { normalizeStationOrigin } from './stationSecurity';
import type { ActiveShow, NowPlayingTrack } from './types';

export interface AirCard {
  title: string;
  artist: string;
  album: string;
  /** Absolute URL of the cover, or of the persona avatar while talking. */
  artworkUrl: string | undefined;
  /** Station-scoped headers for that exact URL. External artwork has none. */
  artworkHeaders: Record<string, string> | undefined;
  /** Station-scoped cache key for that artwork. Only surfaces that cache
   *  artwork to disk (the Live Activity) need it. */
  artworkKey: string | null;
  /** Scheduled show name, when one is on. */
  show: string | null;
  /** The artwork above is the persona's, not the track's. */
  showingPersona: boolean;
}

/**
 * The logical artwork id alone is not globally unique: two private stations
 * can both call a track `123`, and persona avatar paths are likewise local to
 * a station. Keep the complete logical id and bind it to the credential-free
 * station origin before it crosses into the native cache. The native side
 * hashes this structured value before using it as a filename, so neither ids
 * nor station details are exposed on disk.
 */
function stationArtworkKey(stationBase: string, artworkIdentity: string | null): string | null {
  if (!artworkIdentity) return null;
  const stationOrigin = normalizeStationOrigin(stationBase);
  if (!stationOrigin) return null;
  return JSON.stringify([stationOrigin, artworkIdentity]);
}

export function resolveAirCard(params: {
  api: StationApi;
  nowPlaying: NowPlayingTrack | null | undefined;
  activeShow: ActiveShow | null | undefined;
  talking: boolean;
}): AirCard {
  const { api, nowPlaying, activeShow, talking } = params;
  const personaName = activeShow?.persona?.name ?? null;
  const personaAvatar = activeShow?.persona?.avatar ?? null;

  const cover = nowPlaying?.subsonic_id ? api.cover(nowPlaying.subsonic_id) : undefined;
  const avatar = personaAvatar ? api.avatar(personaAvatar) : undefined;
  const showingPersona = talking && !!avatar?.uri;
  const artwork = showingPersona ? avatar : cover;
  const artworkIdentity = showingPersona ? personaAvatar : nowPlaying?.subsonic_id ?? null;

  return {
    title: nowPlaying?.title || 'SUB/WAVE',
    artist: showingPersona
      ? personaName || nowPlaying?.artist || 'Live broadcast'
      : nowPlaying?.artist || 'Live broadcast',
    album: nowPlaying?.album || 'SUB/WAVE',
    artworkUrl: artwork?.uri,
    artworkHeaders: artwork?.headers,
    artworkKey: artwork?.uri ? stationArtworkKey(api.base, artworkIdentity) : null,
    show: activeShow?.name ?? null,
    showingPersona,
  };
}
