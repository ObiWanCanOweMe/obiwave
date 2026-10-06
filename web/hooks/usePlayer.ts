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

import { bindPlayerAudioEvents, playerAudioIsAdvancing, playerStatusAfterAudioEvent } from '@/lib/playerAudioBinding';
import { isIOSDevice } from '@/lib/platform';
import { useStationOrigin } from '@/lib/stationOrigin';
import { withStreamAuth } from '@/lib/stationAuth';
import { loadVolumePref, saveVolumePref } from '@/lib/volume';
import { createPausedMediaUrl } from '@/lib/pausedMedia';

// Reconnect backoff for the watchdog's error path: quick first retry, doubling to a minute.
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 60_000;

// Idle cutoff (#343). A forgotten tab counts as a listener and holds the DJ's
// pause-when-empty gate open, so tune out after this long with no pointer/key/focus activity.
const IDLE_TUNE_OUT_MS = 8 * 60 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60_000;

// HTMLMediaElement.HAVE_FUTURE_DATA, read as a constant so the checks below work on a detached element.
const HAVE_FUTURE_DATA = 3;

function freshStreamUrl(apiUrl: string, streamUrl: string, generation: number): string {
  const url = new URL(streamUrl, document.baseURI);
  url.searchParams.set('t', `${Date.now()}-${generation}`);
  return withStreamAuth(apiUrl, url.href);
}

export type PlayerStatus = 'idle' | 'connecting' | 'playing';

export interface Player {
  audioRef: RefObject<HTMLAudioElement | null>;
  /** Ref callback the consumer MUST put on its <audio> element instead of audioRef:
   *  it keeps audioRef on the live node AND tells the hook when that node is replaced
   *  so the media listeners re-attach (#1232). Stable identity. */
  audioElementRef: RefCallback<HTMLAudioElement>;
  tunedIn: boolean;
  playbackState: MediaSessionPlaybackState;
  status: PlayerStatus;
  volume: number;
  setVolume: Dispatch<SetStateAction<number>>;
  tune: () => void;
  play: () => void;
  pause: () => void;
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
  const gen = useRef(0);
  const tunedInRef = useRef(false);
  const pausedMediaUrl = useRef<string | null>(null);
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playbackState, setPlaybackState] = useState<MediaSessionPlaybackState>('none');
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const tunedIn = playbackState === 'playing';

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current !== null) clearTimeout(watchdogTimer.current);
    watchdogTimer.current = null;
  }, []);
  const releasePausedMedia = useCallback(() => {
    if (pausedMediaUrl.current) URL.revokeObjectURL(pausedMediaUrl.current);
    pausedMediaUrl.current = null;
  }, []);
  const unloadAudio = useCallback((el: HTMLAudioElement) => {
    el.pause();
    el.removeAttribute('src');
    el.load();
    releasePausedMedia();
  }, [releasePausedMedia]);
  // audioRef.current mirrored into state so the listener effect can depend on it:
  // refs don't notify on attach, so a swapped element has to announce itself.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const audioElementRef = useCallback((el: HTMLAudioElement | null) => {
    if (audioRef.current === el) return;
    // Ref detachment covers unmount and the private-player gate. Disconnect the
    // old node immediately; no pending play promise may keep it on the mount.
    if (audioRef.current) {
      ++gen.current;
      tunedInRef.current = false;
      clearWatchdog();
      unloadAudio(audioRef.current);
      setPlaybackState('none');
      setStatus('idle');
    }
    audioRef.current = el;
    setAudioEl(el);
  }, [clearWatchdog, unloadAudio]);
  // SSR and first render use MP3; hydration restores the station-scoped preference.
  const [streamUrl, setStreamUrl] = useState<string>(streams.mp3);
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [formatFailure, setFormatFailure] = useState<AudioFormat | null>(null);
  const [browserSupport, setBrowserSupport] = useState<BrowserSupport>(INITIAL_BROWSER_SUPPORT);
  const [volume, setVolume] = useState(initialVolume);
  const [idleStopped, setIdleStopped] = useState(false);
  const preMuteVolume = useRef(initialVolume || 1);

  // Refs mirror the latest state the stall watchdog reads, so its listeners register once.
  const streamUrlRef = useRef(streamUrl);
  const streamsRef = useRef(streams);
  const activeFormatRef = useRef<AudioFormat>('mp3');
  const volumeRef = useRef(volume);
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
  useEffect(() => { streamUrlRef.current = streamUrl; }, [streamUrl]);
  useEffect(() => { streamsRef.current = streams; }, [streams]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const switchLiveStream = useCallback((nextUrl: string, errorLabel: string) => {
    clearWatchdog();
    if (!tunedInRef.current || !audioRef.current) return;
    const audio = audioRef.current;
    const myGen = ++gen.current;
    audio.src = freshStreamUrl(apiUrl, nextUrl, myGen);
    audio.volume = volumeRef.current;
    setStatus('connecting');
    const p = audio.play();
    Promise.resolve(p).catch((err: unknown) => {
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
      if (gen.current === myGen && name !== 'AbortError') {
        if (name === 'NotAllowedError') stopRef.current();
        console.error(`${errorLabel}:`, err);
      }
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
      volumeRef.current = stored;
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

  // Drive `status` from the <audio> element's own events and reconnect when it
  // wedges. 'playing' clears the watchdog; 'waiting'/'stalled' arm a 5s timer
  // that re-sets src if the media clock hasn't moved; 'error' reconnects with
  // backoff. Re-runs when the element is replaced (attachAudio).
  useEffect(() => {
    const el = audioEl;
    if (!el) return;

    const isLive = () => tunedInRef.current && audioRef.current === el;

    const reconnect = () => {
      clearWatchdog();
      if (!isLive()) return;
      const audio = el;
      // The media clock moved while the watchdog was pending, so the listener is hearing
      // audio. Re-setting src would cut sound for nothing; reconcile the UI instead (#1232).
      if (playerAudioIsAdvancing(audio, watchdogArmedAt.current)) {
        retryCount.current = 0;
        setStatus('playing');
        return;
      }
      const myGen = ++gen.current;
      audio.src = freshStreamUrl(apiUrl, streamUrlRef.current, myGen);
      audio.volume = volumeRef.current;
      setStatus('connecting');
      const p = audio.play();
      Promise.resolve(p).catch((err: unknown) => {
        const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
        if (gen.current === myGen && name !== 'AbortError') {
          if (name === 'NotAllowedError') stopRef.current();
          console.error('Reconnect failed:', err);
        }
      });
    };

    const armWatchdog = (delay: number) => {
      if (!isLive()) return;
      clearWatchdog();
      // Sample the media clock so the fire can tell a dead stream from late bytes.
      watchdogArmedAt.current = audioRef.current?.currentTime ?? 0;
      watchdogTimer.current = setTimeout(reconnect, delay);
    };

    const onPlaying = () => {
      if (!isLive() || el.paused) return;
      clearWatchdog();
      retryCount.current = 0;
      setStatus(s => playerStatusAfterAudioEvent(s, 'playing', el));
    };
    // 'waiting' is a PLAYBACK event: the element ran out of decoded audio and has gone silent.
    const onWaiting = () => {
      if (!isLive()) return;
      setStatus(s => playerStatusAfterAudioEvent(s, 'waiting', el));
      armWatchdog(5000);
    };
    // 'stalled' is a NETWORK event (no bytes for ~3s) and fires routinely on a
    // live mount while playback continues from buffer, so no second 'playing' is
    // coming. Arm the watchdog only (#1232).
    const onStalled = () => {
      armWatchdog(5000);
    };
    // timeupdate fires only while the clock actually moves, so it reconciles a status left
    // on 'connecting' by event sequences the handlers above don't model.
    const onTimeUpdate = () => {
      if (!isLive() || el.paused || el.readyState < HAVE_FUTURE_DATA) return;
      setStatus(s => playerStatusAfterAudioEvent(s, 'timeupdate', el));
    };
    const onError = () => {
      if (!el.error || audioRef.current !== el) return;
      if (!isLive()) {
        // If local decoding fails, release the workaround and stay disconnected.
        if (pausedMediaUrl.current) unloadAudio(el);
        return;
      }
      setStatus('idle');
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
    const unbind = bindPlayerAudioEvents(el, {
      playing: onPlaying, waiting: onWaiting, stalled: onStalled, timeupdate: onTimeUpdate, error: onError,
    });
    return () => { clearWatchdog(); unbind(); };
  }, [apiUrl, audioEl, clearWatchdog, unloadAudio]);

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

  // Full teardown for OS Stop, the idle cutoff and element removal.
  const stop = () => {
    ++gen.current;
    tunedInRef.current = false;
    clearWatchdog();
    setPlaybackState('none');
    setStatus('idle');
    if (audioRef.current) unloadAudio(audioRef.current);
    else releasePausedMedia();
  };
  stopRef.current = stop;

  const pause = () => {
    if (!tunedInRef.current) return;
    ++gen.current;
    tunedInRef.current = false;
    clearWatchdog();
    setPlaybackState('paused');
    setStatus('idle');
    const el = audioRef.current;
    if (!el) return;
    // Never wait for play(): a connecting stream may leave that promise pending.
    // Swapping source cancels it and closes the live connection, even mid-tune.
    el.pause();
    const localUrl = createPausedMediaUrl(el);
    if (localUrl) {
      pausedMediaUrl.current = localUrl;
      el.src = localUrl;
      el.load();
      // Deliberately no play(), autoplay or loop on the silent clip.
    } else {
      unloadAudio(el);
    }
  };

  const play = () => {
    if (!audioRef.current) return;
    const el = audioRef.current;
    // A system interruption can pause the native element without delivering our
    // OS pause command. Play must rejoin live in that case too.
    if (tunedInRef.current && !el.paused) return;
    const myGen = ++gen.current;
    // A fresh tune-in is listener activity: restart the idle window, clear the idle prompt, reset backoff.
    lastActivityAt.current = Date.now();
    setIdleStopped(false);
    retryCount.current = 0;
    clearWatchdog();
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
    el.src = freshStreamUrl(apiUrl, target.streamUrl, myGen);
    el.load();
    releasePausedMedia();
    el.volume = target.volume;
    // Commands and event handlers read this synchronously, including repeated
    // media-session presses before React has committed the next render.
    tunedInRef.current = true;
    setPlaybackState('playing');
    setStatus('connecting');
    const p = el.play();
    Promise.resolve(p).catch((err: unknown) => {
      // AbortError just means a later stop() interrupted this play — benign.
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
      if (gen.current === myGen && name !== 'AbortError') {
        // Decoder/network errors belong to onError's retry/Opus fallback path.
        // A gesture refusal cannot recover unattended, so release the stream.
        if (name === 'NotAllowedError') stop();
        console.error('Play failed:', err);
      }
    });
  };

  // Skin buttons and keyboard shortcuts toggle; OS commands never toggle.
  const tune = () => {
    if (tunedInRef.current) pause();
    else play();
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

  return { audioRef, audioElementRef, tunedIn, playbackState, status, volume, setVolume, tune, play, pause, stop, toggleMute, muted: volume === 0, idleStopped, format, availability, selectFormat, formatFailure };
}
