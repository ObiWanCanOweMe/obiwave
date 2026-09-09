'use client';

// Runtime station origin for the player tree. Everything talking to a controller
// or Icecast mount reads its base URLs from this context rather than module-level
// env constants, so one PlayerApp tree can point at any SUB/WAVE station. Default
// is same-origin `/api` + `/stream.mp3`; NEXT_PUBLIC_* overrides in dev.
import { createContext, useContext } from 'react';
import { deriveSiblingMounts, type AudioStreamUrls } from '@/lib/audioFormat';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// `NEXT_PUBLIC_STREAM_URL` is the build-time host override (dev points the
// player at `http://localhost:7702/stream.mp3` because Icecast isn't on the
// web origin there). A standard `/stream.mp3` URL lets us derive the Opus,
// AAC, and FLAC sibling mounts for explicit listener selection. Operators who
// use a non-standard URL still get it verbatim, with optional siblings absent.
const STREAM_URL_OVERRIDE = process.env.NEXT_PUBLIC_STREAM_URL || '';
export type StationStreams = AudioStreamUrls;

export interface StationOrigin {
  /** e.g. `/api`, or `https://radio.example.com/api`. */
  apiUrl: string;
  streams: StationStreams;
}

function defaultStreams(): StationStreams {
  return deriveSiblingMounts(STREAM_URL_OVERRIDE || '/stream.mp3');
}

export const DEFAULT_STATION_ORIGIN: StationOrigin = {
  apiUrl: API_URL,
  streams: defaultStreams(),
};

// Every deployment serves the same route table on one hostname (`/api/*` →
// controller, `/stream.mp3` → Icecast), so the site origin is enough.
// Cross-origin works: both send permissive CORS, which the player's
// crossOrigin="anonymous" <audio> and the cover-colour canvas require.
export function originForStation(siteUrl: string): StationOrigin {
  const base = siteUrl.replace(/\/+$/, '');
  return {
    apiUrl: `${base}/api`,
    streams: deriveSiblingMounts(`${base}/stream.mp3`),
  };
}

const StationOriginContext = createContext<StationOrigin>(DEFAULT_STATION_ORIGIN);

export const StationOriginProvider = StationOriginContext.Provider;

export function useStationOrigin(): StationOrigin {
  return useContext(StationOriginContext);
}
