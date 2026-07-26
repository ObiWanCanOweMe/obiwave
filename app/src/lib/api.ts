// Runtime API client.
//
// The web player bakes its base URL in at build time
// (process.env.NEXT_PUBLIC_API_URL). The native app is multi-station, so the
// base is resolved at RUNTIME from StationContext and threaded through here.
// This factory is the single place that knows the controller's URL shape; every
// hook/screen calls these typed methods instead of building URLs itself.
//
// Base is the station's public site origin (e.g. https://radio.example.com);
// optional private-station auth is carried only in request headers. The API is
// mounted under `/api`, and the Icecast stream at `/stream.mp3` on the same
// origin (matches docker/Caddyfile routing).

import { parseStationAddress, sanitizeDiagnostic } from './stationSecurity';
import { mountFor, type StreamFormat } from './streamMount';
import type {
  DjPublic,
  LikeResult,
  LikeStatus,
  NowPlayingResponse,
  RequestResult,
  SchedulePayload,
  SessionPayload,
  StationState,
  ThemesPayload,
} from './types';

export interface RequestBody {
  text: string;
  name?: string;
}

/** POST /beacon payload — audience-source analytics (see the web PlayerApp's
 *  one-shot beacon). An app has no document.referrer or UTM query; callers
 *  report the platform via `utmSource` instead so native listeners show up in
 *  the admin Stats rollup. */
export interface BeaconBody {
  referrer?: string;
  path?: string;
  utmSource?: string;
}

/** Why a controller health probe failed. `network` is the catch-all for DNS,
 *  refused connections, and TLS/certificate errors — RN's fetch collapses all
 *  of these into a single rejected promise with no detail, so we can't tell
 *  them apart from JS. The common "works in the browser, fails in the app" case
 *  is a TLS chain the browser tolerates (it fetches missing intermediates via
 *  AIA) but Android's OkHttp does not, and it lands here. The app trusts
 *  user-installed CAs (plugins/withAndroidUserCaTrust.js), so a private-CA
 *  station works once its root is installed on the device, like the browser.
 *  `http` means we got a response but a non-2xx status (usually /api not routed
 *  to the controller). `timeout` is our own abort firing. */
export type HealthResult =
  | { ok: true }
  | { ok: false; kind: 'timeout' | 'http' | 'network'; status?: number; message?: string };

export interface StationImageSource {
  uri: string;
  headers?: Record<string, string>;
}

export interface StationApi {
  base: string;
  nowPlaying(signal?: AbortSignal): Promise<NowPlayingResponse>;
  state(signal?: AbortSignal): Promise<StationState>;
  session(signal?: AbortSignal): Promise<SessionPayload>;
  schedule(signal?: AbortSignal): Promise<SchedulePayload>;
  dj(signal?: AbortSignal): Promise<DjPublic>;
  themes(signal?: AbortSignal): Promise<ThemesPayload>;
  health(signal?: AbortSignal): Promise<boolean>;
  /** Like health(), but returns *why* it failed so callers can show a real
   *  diagnostic instead of a bare "failed". */
  probeHealth(signal?: AbortSignal): Promise<HealthResult>;
  postRequest(body: RequestBody): Promise<RequestResult>;
  pollRequest(id: string): Promise<RequestResult>;
  /** Like the currently playing track (#991). `songId` is what the client
   *  believes is on air — the controller rejects a stale tap. Error statuses
   *  come back as a LikeResult with `error`; null on network error. */
  likeCurrent(songId: string): Promise<LikeResult | null>;
  /** Liked-state + count for the current airing. null on network error. */
  likeStatus(): Promise<LikeStatus | null>;
  /** Fire-and-forget audience beacon. Analytics must never break a listener —
   *  all failures are swallowed. */
  postBeacon(body: BeaconBody): Promise<void>;
  /** Credential-free URL plus optional headers for an album cover. */
  cover(subsonicId: string): StationImageSource;
  /** Absolute URL for a persona avatar. `path` is the value from
   *  activeShow.persona.avatar (e.g. `/persona-avatar/<id>`) — the controller
   *  emits it WITHOUT the `/api` prefix; this client adds it like every other
   *  endpoint. */
  avatar(path: string): StationImageSource;
  /** The live Icecast mount for `format`, defaulting to the universal MP3
   *  floor. Callers pass a non-MP3 format only after gating it on platform +
   *  station support (lib/streamFormat.ts) — this just builds the URL. Carries
   *  NO embedded credentials — see streamHeaders(). */
  streamUrl(format?: StreamFormat): string;
  /** Headers to attach to the audio stream request. When the station URL
   *  embedded HTTP basic-auth credentials (`https://user:pass@host`), this
   *  returns `{ Authorization: 'Basic …' }`; otherwise `undefined`. iOS AVPlayer
   *  (via react-native-track-player) ignores userinfo in the URL, so the
   *  credential MUST travel as a header or the stream 401s and never starts —
   *  the same header is also attached explicitly to same-origin API and image
   *  requests. */
  streamHeaders(): Record<string, string> | undefined;
}

/** Canonical public station origin. Userinfo/path/query never survive. */
export function normalizeBase(raw: string): string {
  return parseStationAddress(raw).origin;
}

/** Split a normalized base into a credential-free base URL and, if the URL
 *  carried `user:pass@` userinfo, an `Authorization: Basic` header value.
 *  Percent-encoded userinfo is decoded per-component before encoding, matching
 *  how a browser forms the credential from a URL. */
export function splitCredentials(rawBase: string): {
  base: string;
  authorization: string | null;
} {
  const parsed = parseStationAddress(rawBase);
  return { base: parsed.origin, authorization: parsed.authorization };
}

// Every call carries a hard timeout: a hung origin must not stall the 5s
// feed poll (or leave a request spinner up forever) — fail fast, retry on
// the next tick. Composed by hand with any caller-supplied signal because
// RN's fetch polyfill doesn't ship AbortSignal.timeout/any.
const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const outer = init?.signal;
  const onAbort = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', onAbort);
  }
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  });
}

export function createApi(rawBase: string, storedAuthorization: string | null = null): StationApi {
  const parsed = parseStationAddress(rawBase);
  const base = parsed.origin;
  if (!base) throw new Error('Enter a valid HTTP(S) station address');
  const authorization = storedAuthorization || parsed.authorization;
  const authHeaders: Record<string, string> | undefined = authorization
    ? { Authorization: authorization }
    : undefined;
  const api = (p: string) => `${base}/api${p}`;
  const withAuth = (init: RequestInit = {}): RequestInit => ({
    ...init,
    ...(authHeaders
      ? { headers: { ...authHeaders, ...(init.headers as Record<string, string> | undefined) } }
      : {}),
  });
  const stationFetch = (url: string, init: RequestInit = {}) =>
    fetchWithTimeout(url, withAuth(init));
  const getJson = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
    const res = await stationFetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  const stationImage = (uri: string): StationImageSource => ({
    uri,
    ...(authHeaders ? { headers: { ...authHeaders } } : {}),
  });
  // Single source of the health logic; health() below is just its boolean.
  const probeHealth = async (signal?: AbortSignal): Promise<HealthResult> => {
    try {
      const res = await stationFetch(api('/health'), { cache: 'no-store', signal });
      return res.ok ? { ok: true } : { ok: false, kind: 'http', status: res.status };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const aborted = signal?.aborted || err?.name === 'AbortError';
      return {
        ok: false,
        kind: aborted ? 'timeout' : 'network',
        message: sanitizeDiagnostic(err?.message),
      };
    }
  };
  return {
    base,
    nowPlaying: (signal) => getJson<NowPlayingResponse>(api('/now-playing'), signal),
    state: (signal) => getJson<StationState>(api('/state'), signal),
    session: (signal) => getJson<SessionPayload>(api('/session'), signal),
    schedule: (signal) => getJson<SchedulePayload>(api('/schedule'), signal),
    dj: (signal) => getJson<DjPublic>(api('/dj'), signal),
    themes: (signal) => getJson<ThemesPayload>(api('/themes'), signal),
    // Preserves the original contract: a non-2xx response resolves to false, but
    // a network/TLS error or timeout *throws* — callers like useSignal rely on
    // the throw to detect a dead link. probeHealth (below) never throws; it's for
    // callers that want the reason instead of a boolean.
    health: async (signal) => {
      const r = await probeHealth(signal);
      if (r.ok) return true;
      if (r.kind === 'http') return false;
      throw new Error(r.message || r.kind);
    },
    probeHealth,
    postRequest: (body) =>
      stationFetch(api('/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json() as Promise<RequestResult>),
    postBeacon: async (body) => {
      try {
        await stationFetch(api('/beacon'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        /* best-effort analytics */
      }
    },
    pollRequest: async (id) => {
      const res = await stationFetch(api(`/request/${encodeURIComponent(id)}`));
      if (res.status === 404) return { success: false, status: 'unknown' };
      return (await res.json()) as RequestResult;
    },
    likeCurrent: async (songId) => {
      try {
        const res = await stationFetch(api('/like'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songId }),
        });
        // Error statuses carry a JSON body too — surface it, don't throw.
        return (await res.json()) as LikeResult;
      } catch {
        return null;
      }
    },
    likeStatus: async () => {
      try {
        const res = await stationFetch(api('/like'));
        return (await res.json()) as LikeStatus;
      } catch {
        return null;
      }
    },
    cover: (subsonicId) => stationImage(api(`/cover/${encodeURIComponent(subsonicId)}`)),
    avatar: (path) => {
      if (!path) return { uri: '' };
      // Persona data may deliberately point at third-party artwork. Station
      // credentials are origin-bound and must never cross that boundary.
      if (/^https?:\/\//i.test(path)) return { uri: path };
      return stationImage(api(path.startsWith('/') ? path : `/${path}`));
    },
    streamUrl: (format = 'mp3') => `${base}${mountFor(format)}`,
    streamHeaders: () => authHeaders && { ...authHeaders },
  };
}
