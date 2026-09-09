// Pushes track metadata to the OS lock screen / CarPlay via
// TrackPlayer.updateNowPlayingMetadata; while the DJ is talking the persona
// avatar and name are swapped in. Remote-control handlers live in service.ts.
//
// The talking decision and shared card strings live in useTalking and
// lib/air-card so the OS media card and Live Activity cannot drift.

import { useEffect } from 'react';
import TrackPlayer from 'react-native-track-player';
import { useTalking } from '@/hooks/useTalking';
import { resolveAirCard } from '@/lib/air-card';
import type { StationApi } from '@/lib/api';
import type { ActiveShow, NowPlayingTrack, SessionTurn } from '@/lib/types';

export interface UseNowPlayingInfoParams {
  api: StationApi | null;
  tunedIn: boolean;
  nowPlaying: NowPlayingTrack | null;
  boothFeed?: SessionTurn[];
  activeShow?: ActiveShow | null;
}

export function useNowPlayingInfo({
  api,
  tunedIn,
  nowPlaying,
  boothFeed,
  activeShow,
}: UseNowPlayingInfoParams): void {
  const talking = useTalking(boothFeed);
  const card = api ? resolveAirCard({ api, nowPlaying, activeShow, talking }) : null;

  const title = card?.title;
  const artist = card?.artist;
  const album = card?.album;
  // RNTP metadata accepts only a URL string, not request headers. Never
  // recreate a credential URL or make an unauthenticated private request.
  const artwork = card?.artworkHeaders ? undefined : card?.artworkUrl;

  useEffect(() => {
    if (!api || !tunedIn || !title) return;
    TrackPlayer.updateNowPlayingMetadata({ title, artist, album, artwork }).catch(() => {
      /* no active track yet */
    });
  }, [api, tunedIn, title, artist, album, artwork]);
}
