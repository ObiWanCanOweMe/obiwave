// Native port of web/web/hooks/useStationFeed.ts.
//
// 5s polling of /now-playing + /state + /session, plus a 1s elapsed tick that
// resets on track-change. The base URL comes from the StationApi passed in
// (runtime), not a build-time env. Two native-specific deviations:
//   * polling winds down while the app is backgrounded: nothing at all when
//     idle, and a 30s /now-playing-only poll while tuned in (just enough to
//     keep the lock-screen metadata pushed by useNowPlayingInfo current —
//     /state + /session feed UI nobody can see). The UI catches up with an
//     immediate full tick on foreground.
//   * unchanged payloads keep their previous object identity, so consumers'
//     useMemo/React.memo actually hold between polls.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppActive } from '@/hooks/useAppActive';
import type { StationApi } from '@/lib/api';
import { DEFAULT_STATION_LOCALE, type StationLocale } from '@/lib/format';
import { bufferSecondsForFormat } from '@/lib/streamBuffer';
import type { StreamFormat } from '@/lib/streamFormat';
import type {
  ActiveShow,
  DjState,
  ListenerCount,
  NowPlayingResponse,
  NowPlayingTrack,
  SessionPayload,
  StationContext,
  StationState,
  StreamInfo,
} from '@/lib/types';

export interface StationFeed {
  nowPlaying: NowPlayingTrack | null;
  context: StationContext | null;
  dj: DjState | null;
  activeShow: ActiveShow | null;
  listeners: ListenerCount | number | null;
  streamOnline: boolean | null;
  /** Broadcast mount descriptor (which optional formats are live), or null
   *  before the first poll. Drives the stream-format picker. */
  streamInfo: StreamInfo | null;
  /** Cumulative since-boot LLM token total, or null before the first poll. */
  llmTokens: number | null;
  state: StationState;
  session: SessionPayload;
  elapsed: number;
  progress: number;
  /** Epoch ms when the on-display track became audible to this listener. The
   *  Live Activity uses this absolute stamp so its native clock stays correct
   *  while the JS elapsed ticker is suspended in the background. */
  trackStartedAt: number | null;
  /** Station IANA timezone, or null before first poll. Render on-air
   *  timestamps in this zone so they match what the DJ speaks (issue #418). */
  timezone: string | null;
  locale: StationLocale;
}

const EMPTY_STATE: StationState = { upcoming: [], history: [], djLog: [] };
const EMPTY_SESSION: SessionPayload = { session: null, messages: [] };
// A single "offline" poll can be a transient controller blip; flipping to
// offline on it would tear playback down mid-song (PlayerScreen stops on
// offline). Require this many consecutive offline polls before believing it —
// same debounce as the web player (#463/#466). At the foreground 5s cadence
// that's ~20s; on the 30s background poll it's slower, which errs toward
// keeping the music playing.
const OFFLINE_CONFIRM_POLLS = 4;

export function useStationFeed(
  api: StationApi | null,
  opts?: { backgroundPoll?: boolean; activeFormat?: { readonly current: StreamFormat } },
): StationFeed {
  const backgroundPoll = opts?.backgroundPoll ?? false;
  const activeFormat = opts?.activeFormat;
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  const [context, setContext] = useState<StationContext | null>(null);
  const [dj, setDj] = useState<DjState | null>(null);
  const [activeShow, setActiveShow] = useState<ActiveShow | null>(null);
  const [listeners, setListeners] = useState<ListenerCount | number | null>(null);
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [llmTokens, setLlmTokens] = useState<number | null>(null);
  const [state, setState] = useState<StationState>(EMPTY_STATE);
  const [session, setSession] = useState<SessionPayload>(EMPTY_SESSION);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [locale, setLocale] = useState<StationLocale>(DEFAULT_STATION_LOCALE);
  const [elapsed, setElapsed] = useState(0);
  const trackStartRef = useRef<number | null>(null);
  const [trackStartedAt, setTrackStartedAt] = useState<number | null>(null);
  const offlinePollsRef = useRef(0);
  const appActive = useAppActive();
  // Identity of the track currently ON DISPLAY. Distinct from "latest track the
  // controller reported": between them sits the listener's buffer, and this
  // holds the older of the two until the audio catches up.
  const lastTrackKeyRef = useRef<string | null>(null);
  // Listener buffer depth in ms (stream.bufferSeconds). 0 until the first
  // payload lands, which degrades to the old live-edge behaviour.
  const leadMsRef = useRef(0);
  const promoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-field payload signatures: skip the setState (keeping the previous
  // object identity) when a poll returns byte-identical data.
  const sigRef = useRef<Record<string, string>>({});
  const setIfChanged = useCallback(<T,>(key: string, value: T, set: (v: T) => void) => {
    const sig = JSON.stringify(value) ?? 'null';
    if (sigRef.current[key] === sig) return;
    sigRef.current[key] = sig;
    set(value);
  }, []);

  // On station switch, drop the previous station's data immediately — without
  // this the new station briefly shows the old one's track/cover/booth, and
  // stale payload signatures could suppress the first updates. Declared before
  // the poll effect so the reset lands before the new station's first tick.
  const prevApiRef = useRef(api);
  useEffect(() => {
    if (prevApiRef.current === api) return;
    prevApiRef.current = api;
    sigRef.current = {};
    trackStartRef.current = null;
    setTrackStartedAt(null);
    offlinePollsRef.current = 0;
    // Drop any held track switch from the station we just left, or it would
    // land on the new station and stamp its clock with a foreign start time.
    lastTrackKeyRef.current = null;
    leadMsRef.current = 0;
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    setNowPlaying(null);
    setContext(null);
    setDj(null);
    setActiveShow(null);
    setListeners(null);
    setStreamOnline(null);
    setStreamInfo(null);
    setLlmTokens(null);
    setState(EMPTY_STATE);
    setSession(EMPTY_SESSION);
    setTimezone(null);
    setLocale(DEFAULT_STATION_LOCALE);
    setElapsed(0);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const background = !appActive;
    if (background && !backgroundPoll) return;
    let cancelled = false;

    // `current` is /state's live-edge view, absent on the background poll (which
    // fetches /now-playing only) and on a failed /state leg.
    const applyNowPlaying = (npRes: NowPlayingResponse, current?: StationState['current']) => {
      const np = npRes.nowPlaying;
      // Buffer depth first — everything below is measured against it. Clamped:
      // a bad value would park the clock in the far future or wind it back past
      // the track start.
      const bufSec = bufferSecondsForFormat(npRes.stream, activeFormat?.current ?? 'mp3');
      if (bufSec !== null) leadMsRef.current = bufSec * 1000;
      const trackKey = np ? `${np.title}\0${np.artist}` : null;

      // Prefer the controller's live-edge stamp over "first seen by this
      // client". The old behaviour stamped Date.now() on first sight, so a
      // backgrounded app (30s poll) or a missed transition started the clock
      // late by however long it took to notice.
      let serverStart = NaN;
      if (np?.title && current && current.title === np.title && current.startedAt) {
        const t = Date.parse(current.startedAt);
        if (Number.isFinite(t) && t <= Date.now()) serverStart = t;
      }
      // Shift into listener-time: the audio reaches this listener leadMs after
      // the live edge, so that's when the track genuinely starts for them.
      // Without a server stamp fall back to first-seen (no offset) — the next
      // foreground tick carries /state and repairs it via the converge branch.
      const audibleAt = Number.isFinite(serverStart) ? serverStart + leadMsRef.current : Date.now();

      if (trackKey !== lastTrackKeyRef.current) {
        const commit = () => {
          promoteTimerRef.current = null;
          lastTrackKeyRef.current = trackKey;
          trackStartRef.current = audibleAt;
          setTrackStartedAt(audibleAt);
          setIfChanged('nowPlaying', np, setNowPlaying);
        };
        const wait = audibleAt - Date.now();
        if (promoteTimerRef.current) clearTimeout(promoteTimerRef.current);
        // Show immediately when the audio is already out, when the stream drops
        // (nothing to stay in sync with), or on the first payload — a cold start
        // has no earlier track to keep showing. The clock stays honest there
        // because trackStartRef carries the offset and the tick clamps at 0.
        if (wait <= 0 || trackKey == null || lastTrackKeyRef.current == null) commit();
        else promoteTimerRef.current = setTimeout(commit, wait);
      } else {
        // Same track, better information — converge on the server stamp (and
        // repair a background-poll estimate) without churn inside ±2.5s.
        if (Number.isFinite(serverStart)) {
          const prev = trackStartRef.current;
          if (prev == null || Math.abs(audibleAt - prev) > 2500) {
            trackStartRef.current = audibleAt;
            setTrackStartedAt(audibleAt);
          }
        }
        // Metadata enrichment (genres, bpm, cover) lands on later polls.
        setIfChanged('nowPlaying', np, setNowPlaying);
      }
      setIfChanged('context', npRes.context, setContext);
      if (npRes.dj) setIfChanged('dj', npRes.dj, setDj);
      setIfChanged('activeShow', npRes.activeShow ?? npRes.context?.activeShow ?? null, setActiveShow);
      if (npRes.listeners != null) setIfChanged('listeners', npRes.listeners, setListeners);
      if (typeof npRes.streamOnline === 'boolean') {
        if (npRes.streamOnline) {
          offlinePollsRef.current = 0;
          setStreamOnline(true);
        } else {
          offlinePollsRef.current += 1;
          if (offlinePollsRef.current >= OFFLINE_CONFIRM_POLLS) setStreamOnline(false);
        }
      }
      if (npRes.stream) setIfChanged('streamInfo', npRes.stream, setStreamInfo);
      if (typeof npRes.llmTokens === 'number') setIfChanged('llmTokens', npRes.llmTokens, setLlmTokens);
      if (typeof npRes.timezone === 'string' && npRes.timezone) setTimezone(npRes.timezone);
      if (npRes.locale === 'en-US' || npRes.locale === 'en-GB') setLocale(npRes.locale);
    };

    const tick = async () => {
      if (background) {
        // Lock-screen metadata only — no point feeding UI nobody can see.
        try {
          const npRes = await api.nowPlaying();
          if (!cancelled) applyNowPlaying(npRes);
        } catch {
          /* transient — next tick retries */
        }
        return;
      }
      // allSettled: one slow/failed endpoint shouldn't stall the others;
      // failures are transient — the next tick retries.
      const [np, st, se] = await Promise.allSettled([
        api.nowPlaying(),
        api.state(),
        api.session(),
      ]);
      if (cancelled) return;
      // /state before /now-playing: its `current` carries the live-edge stamp
      // applyNowPlaying needs to place the track in listener-time.
      if (np.status === 'fulfilled') {
        applyNowPlaying(np.value, st.status === 'fulfilled' ? st.value?.current : undefined);
      }
      if (st.status === 'fulfilled') setIfChanged('state', st.value, setState);
      if (se.status === 'fulfilled' && se.value && Array.isArray(se.value.messages)) {
        setIfChanged('session', se.value, setSession);
      }
    };
    tick();
    const id = setInterval(tick, background ? 30000 : 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
      // A held switch must not land after teardown. Deliberately does NOT reset
      // lastTrackKeyRef: this effect re-runs on every foreground/background
      // flip, and forgetting the on-display track there would make the next
      // tick treat a mid-track resume as a cold start and re-stamp the clock.
      if (promoteTimerRef.current) {
        clearTimeout(promoteTimerRef.current);
        promoteTimerRef.current = null;
      }
    };
  }, [activeFormat, api, appActive, backgroundPoll, setIfChanged]);

  useEffect(() => {
    if (!appActive) return;
    const update = () => {
      if (trackStartRef.current) {
        // Clamped at 0: trackStartRef is listener-time and sits in the future
        // while the track is still inside the buffer, so the clock holds 0:00
        // until the audio actually starts rather than reading negative.
        setElapsed(Math.max(0, Math.floor((Date.now() - trackStartRef.current) / 1000)));
      }
    };
    update(); // catch up immediately on foreground
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [appActive]);

  const duration = nowPlaying?.duration ?? 0;
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return {
    nowPlaying,
    context,
    dj,
    activeShow,
    listeners,
    streamOnline,
    streamInfo,
    llmTokens,
    state,
    session,
    elapsed,
    progress,
    trackStartedAt,
    timezone,
    locale,
  };
}
