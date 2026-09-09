'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefCallback,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  AUDIO_MIME_TYPES,
  availabilityFor,
  browserSupportFor,
  currentPlaybackTarget,
  loadFormatPreference,
  resolveFormatPreference,
  saveFormatPreference,
  type AudioFormat,
  type BrowserSupport,
  type FormatAvailability,
  type StreamEnablement,
} from '@/lib/audioFormat';
import { isIOSDevice } from '@/lib/platform';
import {
  bindPlayerAudioEvents,
  playerAudioIsAdvancing,
  playerStatusAfterAudioEvent,
  replacePlayerAudioElement,
  teardownDetachedPlayerAudio,
} from '@/lib/playerAudioBinding';
import { useStationOrigin } from '@/lib/stationOrigin';
import { withStreamAuth } from '@/lib/stationAuth';
import { loadVolumePref, saveVolumePref } from '@/lib/volume';

// The listener explicitly chooses among MP3, Opus, AAC, and FLAC. Browser
// canPlayType results and station mount flags determine which choices are
// available; MP3 remains the default until a valid preference is restored.
//
// The mount URLs come from StationOriginContext (env defaults when no
// provider; a remote station's host when the landing showcase tabs over).
// Consumers that retarget the player remount it (key) — the hook still
// mirrors the URLs into a ref so the long-lived watchdog listeners read
// fresh values either way.

// Reconnect backoff for the watchdog's error path: quick first retry, doubling
// to a minute so an abandoned tab on a downed station can't hammer reconnects.
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 60_000;

// Idle cutoff (#343). A forgotten tab counts as a listener and holds the DJ's
// pause-when-empty gate open, so tune out after this long with no pointer/key/focus activity.
const IDLE_TUNE_OUT_MS = 8 * 60 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60_000;

export type PlayerStatus = 'idle' | 'connecting' | 'playing';

export interface Player {
  audioRef: RefObject<HTMLAudioElement | null>;
  /** Ref callback the consumer MUST put on its <audio> element. It keeps
   *  audioRef on the live node and re-attaches media listeners whenever the
   *  private-station gate replaces that node (issue #1232). Stable identity. */
  audioElementRef: RefCallback<HTMLAudioElement>;
  tunedIn: boolean;
  status: PlayerStatus;
  volume: number;
  setVolume: Dispatch<SetStateAction<number>>;
  tune: () => void;
  stop: () => void;
  toggleMute: () => void;
  muted: boolean;
  // True when the idle cutoff, not the listener, tore playback down. Cleared on the next tune().
  idleStopped: boolean;
  format: AudioFormat;
  availability: FormatAvailability;
  selectFormat: (format: AudioFormat) => void;
  formatFailure: AudioFormat | null;
}

export interface UsePlayerOptions {
  initialVolume?: number;
  streamEnablement?: StreamEnablement;
}

const MP3_ONLY: StreamEnablement = { mp3: true, opus: false, aac: false, flac: false };
const INITIAL_BROWSER_SUPPORT: BrowserSupport = { mp3: true, opus: false, aac: false, flac: false };

function detectBrowserSupport(): BrowserSupport {
  const tester = document.createElement('audio');
  const ua = navigator.userAgent;
  const safari = /safari/i.test(ua) && !/(?:chrome|chromium|crios|edg|opr|firefox|fxios)/i.test(ua);
  return browserSupportFor({
    mp3: tester.canPlayType(AUDIO_MIME_TYPES.mp3),
    opus: tester.canPlayType(AUDIO_MIME_TYPES.opus),
    aac: tester.canPlayType(AUDIO_MIME_TYPES.aac),
    flac: tester.canPlayType(AUDIO_MIME_TYPES.flac),
  }, { ios: isIOSDevice(), firefox: /firefox/i.test(ua), safari });
}

// Owns the <audio> element + tune-in state. The audioRef must be attached to
// an <audio> tag rendered by the consumer (so the Waveform's Web Audio API
// can also reach it).
export function usePlayer({ initialVolume = 1, streamEnablement = MP3_ONLY }: UsePlayerOptions = {}): Player {
  const { apiUrl, streams } = useStationOrigin();
  // Callers may derive enablement inline from a feed snapshot. Normalize it on
  // scalar flags so an equivalent fresh object cannot retrigger preference
  // hydration after that hydration's own state updates.
  const stableStreamEnablement = useMemo<StreamEnablement>(() => ({
    mp3: streamEnablement.mp3,
    opus: streamEnablement.opus,
    aac: streamEnablement.aac,
    flac: streamEnablement.flac,
  }), [
    streamEnablement.mp3,
    streamEnablement.opus,
    streamEnablement.aac,
    streamEnablement.flac,
  ]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioListenerCleanupRef = useRef<(() => void) | null>(null);
  // SSR + first render use the MP3 URL so server and client markup agree; the
  // effect below applies a valid explicit preference after capability checks.
  const [streamUrl, setStreamUrl] = useState<string>(streams.mp3);
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [formatFailure, setFormatFailure] = useState<AudioFormat | null>(null);
  const [browserSupport, setBrowserSupport] = useState<BrowserSupport>(INITIAL_BROWSER_SUPPORT);
  const [tunedIn, setTunedIn] = useState(false);
  // 'connecting' covers the gap between the tune-in gesture and the first audible frames.
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [volume, setVolume] = useState(initialVolume);
  const [idleStopped, setIdleStopped] = useState(false);
  const preMuteVolume = useRef(initialVolume || 1);

  // play() resolves async and pausing before it settles rejects with AbortError. The latest
  // promise plus a generation counter let rapid tune/stop toggles settle on the last action.
  const playPromise = useRef<Promise<void> | null>(null);
  const gen = useRef(0);

  // Refs mirror the latest state the stall watchdog reads, so its listeners register once.
  const tunedInRef = useRef(tunedIn);
  const streamUrlRef = useRef(streamUrl);
  const streamsRef = useRef(streams);
  const activeFormatRef = useRef<AudioFormat>('mp3');
  const volumeRef = useRef(volume);
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Media clock at arm time — the baseline the fire compares against.
  const watchdogArmedAt = useRef(0);
  // Consecutive failed reconnects since the last 'playing'; drives the backoff.
  const retryCount = useRef(0);
  // Last listener activity, read by the idle sweep. Seeded by the sweep effect at mount
  // (render must stay pure) so a fresh tab gets the full idle window.
  const lastActivityAt = useRef(0);
  // The idle sweep mounts once but must call the latest stop() — bridge with a ref.
  const stopRef = useRef<() => void>(() => {});
  const failedFormatsRef = useRef(new Set<AudioFormat>());
  const formatHydrationKeyRef = useRef<string | null>(null);
  useEffect(() => { tunedInRef.current = tunedIn; }, [tunedIn]);
  useEffect(() => { streamUrlRef.current = streamUrl; }, [streamUrl]);
  useEffect(() => { streamsRef.current = streams; }, [streams]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current !== null) {
      clearTimeout(watchdogTimer.current);
      watchdogTimer.current = null;
    }
  }, []);

  const switchLiveStream = useCallback((nextUrl: string, errorLabel: string) => {
    clearWatchdog();
    if (!tunedInRef.current || !audioRef.current) return;
    const audio = audioRef.current;
    const myGen = ++gen.current;
    audio.src = withStreamAuth(apiUrl, `${nextUrl}?t=${Date.now()}`);
    audio.volume = volumeRef.current;
    setStatus('connecting');
    const p = audio.play();
    playPromise.current = p;
    Promise.resolve(p).catch((err: unknown) => {
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
      if (gen.current === myGen && name !== 'AbortError') console.error(`${errorLabel}:`, err);
    });
  }, [apiUrl, clearWatchdog]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Restore the listener's last-used volume (#783). Effect-only, so SSR and first paint
  // stay on the default; `hydrated` keeps it from racing the persist effect below.
  const hydratedRef = useRef(false);
  useEffect(() => {
    const stored = loadVolumePref();
    if (stored !== null) {
      setVolume(stored);
      preMuteVolume.current = stored > 0 ? stored : preMuteVolume.current;
    }
    hydratedRef.current = true;
  }, []);

  // Debounced so a knob drag collapses to one write. The cleanup also keeps the mount
  // pass's default from reaching localStorage before the restore effect's setVolume lands.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const id = setTimeout(() => saveVolumePref(volume), 300);
    return () => clearTimeout(id);
  }, [volume]);

  const formatHydrationKey = JSON.stringify([apiUrl, stableStreamEnablement, streams, [...failedFormatsRef.current].sort()]);
  const hydrateFormatPreference = useCallback(() => {
    const support = detectBrowserSupport();
    const resolved = resolveFormatPreference(
      loadFormatPreference(localStorage, apiUrl),
      stableStreamEnablement,
      support,
      streams,
      failedFormatsRef.current,
    );
    setBrowserSupport(support);
    activeFormatRef.current = resolved.format;
    streamUrlRef.current = resolved.streamUrl;
    setFormat(resolved.format);
    setStreamUrl(resolved.streamUrl);
    formatHydrationKeyRef.current = formatHydrationKey;
    return resolved;
  }, [apiUrl, formatHydrationKey, stableStreamEnablement, streams]);
  useEffect(() => {
    const previousFormat = activeFormatRef.current;
    const previousUrl = streamUrlRef.current;
    const restored = hydrateFormatPreference();
    if (previousFormat !== restored.format || previousUrl !== restored.streamUrl) {
      switchLiveStream(restored.streamUrl, 'Restored format switch failed');
    }
  }, [hydrateFormatPreference, switchLiveStream]);

  const effectiveEnablement = useMemo<StreamEnablement>(() => ({
    mp3: stableStreamEnablement.mp3,
    opus: stableStreamEnablement.opus && streams.opus !== null,
    aac: stableStreamEnablement.aac && streams.aac !== null,
    flac: stableStreamEnablement.flac && streams.flac !== null,
  }), [stableStreamEnablement, streams]);
  const availability = availabilityFor(effectiveEnablement, browserSupport, failedFormatsRef.current);

  const selectFormat = (next: AudioFormat) => {
    if (!availability[next].available) return;
    const nextUrl = streams[next];
    if (!nextUrl) return;
    saveFormatPreference(localStorage, apiUrl, next);
    activeFormatRef.current = next;
    streamUrlRef.current = nextUrl;
    setFormat(next);
    setStreamUrl(nextUrl);
    setFormatFailure(null);
    switchLiveStream(nextUrl, 'Format switch failed');
  };

  // Drive `status` from the <audio> element's own events, and reconnect the
  // stream when the element gets stuck mid-broadcast (the symptom: a few
  // seconds of silence around a track transition that only a page refresh
  // recovers from, because nothing in here was forcing the dead element back
  // onto the live mount). 'playing' clears the watchdog; 'waiting'/'stalled'
  // arm a 5s timer that re-sets src only if the media clock has not moved;
  // 'error' reconnects with exponential backoff (500 ms doubling to a 60 s
  // ceiling, reset on the next successful 'playing').
  const audioElementRef = useCallback<RefCallback<HTMLAudioElement>>((el) => {
    replacePlayerAudioElement(audioRef, audioListenerCleanupRef, el, boundEl => {
      const reconnect = () => {
        clearWatchdog();
        if (!tunedInRef.current || !audioRef.current) return;
        const audio = audioRef.current;
        if (playerAudioIsAdvancing(audio, watchdogArmedAt.current)) {
          retryCount.current = 0;
          setStatus('playing');
          return;
        }
        const myGen = ++gen.current;
        audio.src = withStreamAuth(apiUrl, `${streamUrlRef.current}?t=${Date.now()}`);
        audio.volume = volumeRef.current;
        setStatus('connecting');
        const p = audio.play();
        playPromise.current = p;
        Promise.resolve(p).catch((err: unknown) => {
          const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
          if (gen.current === myGen && name !== 'AbortError') {
            console.error('Reconnect failed:', err);
          }
        });
      };

      const armWatchdog = (delay: number) => {
        if (!tunedInRef.current) return;
        clearWatchdog();
        watchdogArmedAt.current = boundEl.currentTime;
        watchdogTimer.current = setTimeout(reconnect, delay);
      };

      const onPlaying = () => {
        clearWatchdog();
        retryCount.current = 0;
        setStatus(current => playerStatusAfterAudioEvent(current, 'playing', boundEl));
      };
      const onWaiting = () => {
        setStatus(current => playerStatusAfterAudioEvent(current, 'waiting', boundEl));
        armWatchdog(5000);
      };
      const onStalled = () => {
        setStatus(current => playerStatusAfterAudioEvent(current, 'stalled', boundEl));
        armWatchdog(5000);
      };
      const onTimeUpdate = () => {
        setStatus(current => playerStatusAfterAudioEvent(current, 'timeupdate', boundEl));
      };
      const onError = () => {
        setStatus(current => playerStatusAfterAudioEvent(current, 'error', boundEl));
        const { mp3 } = streamsRef.current;
        const failedFormat = activeFormatRef.current;
        if (failedFormat !== 'mp3') {
          failedFormatsRef.current.add(failedFormat);
          setFormatFailure(failedFormat);
          activeFormatRef.current = 'mp3';
          streamUrlRef.current = mp3;
          setFormat('mp3');
          setStreamUrl(mp3);
        }
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** retryCount.current, RECONNECT_MAX_MS);
        retryCount.current += 1;
        armWatchdog(delay);
      };
      const unbind = bindPlayerAudioEvents(boundEl, {
        playing: onPlaying,
        waiting: onWaiting,
        stalled: onStalled,
        timeupdate: onTimeUpdate,
        error: onError,
      });
      return () => {
        unbind();
        clearWatchdog();
        teardownDetachedPlayerAudio(boundEl, () => {
          gen.current += 1;
          tunedInRef.current = false;
          playPromise.current = null;
          retryCount.current = 0;
          setTunedIn(false);
          setStatus('idle');
          setIdleStopped(false);
        });
      };
    });
  }, [apiUrl, clearWatchdog]);

  // Idle cutoff (#343): a tab with no activity for IDLE_TUNE_OUT_MS is tuned out
  // so it doesn't sit on the mount as a phantom listener. Sweeps once a minute.
  useEffect(() => {
    const markActivity = () => { lastActivityAt.current = Date.now(); };
    markActivity(); // seed: mount counts as the start of the idle window
    const onVisibility = () => {
      if (document.visibilityState === 'visible') markActivity();
    };
    window.addEventListener('pointerdown', markActivity);
    window.addEventListener('keydown', markActivity);
    document.addEventListener('visibilitychange', onVisibility);
    const sweep = setInterval(() => {
      if (!tunedInRef.current) return;
      if (Date.now() - lastActivityAt.current < IDLE_TUNE_OUT_MS) return;
      setIdleStopped(true);
      stopRef.current();
    }, IDLE_CHECK_INTERVAL_MS);
    return () => {
      clearInterval(sweep);
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Tear down playback. Also called by PlayerApp when the station goes off air.
  const stop = () => {
    if (!audioRef.current) return;
    const el = audioRef.current;
    const myGen = ++gen.current;
    clearWatchdog();
    setTunedIn(false);
    setStatus('idle');
    // Let any in-flight play() settle before pausing, then bail if a later tune() superseded this.
    Promise.resolve(playPromise.current)
      .catch(() => {})
      .then(() => {
        if (gen.current !== myGen) return;
        el.pause();
        el.src = '';
      });
  };
  stopRef.current = stop;

  const tune = () => {
    if (!audioRef.current) return;
    if (tunedIn) {
      stop();
      return;
    }
    const el = audioRef.current;
    const myGen = ++gen.current;
    // A fresh tune-in is listener activity: restart the idle window, clear the idle prompt, reset backoff.
    lastActivityAt.current = Date.now();
    setIdleStopped(false);
    retryCount.current = 0;
    // Preference and volume restoration update these refs synchronously before
    // React rerenders. Read them here so a first-click tune cannot use stale
    // render-captured defaults during that window.
    const resolved = formatHydrationKeyRef.current === formatHydrationKey
      ? null
      : hydrateFormatPreference();
    const target = currentPlaybackTarget(
      resolved ? { current: resolved.streamUrl } : streamUrlRef,
      volumeRef,
    );
    el.src = withStreamAuth(apiUrl, `${target.streamUrl}?t=${Date.now()}`);
    el.volume = target.volume;
    setTunedIn(true);
    setStatus('connecting');
    const p = el.play();
    playPromise.current = p;
    Promise.resolve(p).catch((err: unknown) => {
      // AbortError just means a later stop() interrupted this play — benign.
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
      if (gen.current === myGen && name !== 'AbortError') {
        console.error('Play failed:', err);
      }
    });
  };

  // Mute is volume 0; toggling restores the last non-zero level.
  const toggleMute = () => {
    if (volume > 0) {
      preMuteVolume.current = volume;
      setVolume(0);
    } else {
      setVolume(preMuteVolume.current || 1);
    }
  };

  return {
    audioRef, audioElementRef, tunedIn, status, volume, setVolume, tune, stop, toggleMute,
    muted: volume === 0, idleStopped, format, availability, selectFormat, formatFailure,
  };
}
