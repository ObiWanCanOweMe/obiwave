// Runtime API client.
//
// The web player bakes its base URL in at build time. The native app is
// multi-station, so the base is resolved at runtime from StationContext.
// Base is always the station's public origin. Proxy credentials travel only
// in scoped request headers; the separate station password rides stream URLs.

import { mountFor, type StreamFormat } from './streamMount';
import { stationAuthResult, withStreamAuth, type StationAuthResult } from './station-password';
import {
  authorizationFor,
  splitStationAddress,
  type StationCredentials,
} from './station-credentials';
import { sanitizeDiagnostic } from './stationSecurity';
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

/** POST /beacon payload — audience-source analytics. */
export interface BeaconBody {
  referrer?: string;
  path?: string;
  utmSource?: string;
}

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
  probeHealth(signal?: AbortSignal): Promise<HealthResult>;
  postRequest(body: RequestBody): Promise<RequestResult>;
  pollRequest(id: string): Promise<RequestResult>;
  likeCurrent(songId: string): Promise<LikeResult | null>;
  likeStatus(): Promise<LikeStatus | null>;
  postBeacon(body: BeaconBody): Promise<void>;
  /** Credential-free URL plus optional station-scoped headers. */
  cover(subsonicId: string): StationImageSource;
  /** External avatars never receive station credentials. */
  avatar(path: string): StationImageSource;
  /** Fail-closed station password check, with any scoped proxy login. */
  checkStationAuth(password: string): Promise<StationAuthResult>;
  /** Read the current station password at tune/reconnect time. */
  streamUrl(format?: StreamFormat): string;
  streamHeaders(): Record<string, string> | undefined;
}

/** Canonical public station origin. Userinfo/path/query never survive. */
export function normalizeBase(raw: string): string {
  return splitStationAddress(raw).base;
}

export function splitCredentials(rawBase: string): {
  base: string;
  authorization: string | null;
} {
  const split = splitStationAddress(rawBase);
  return {
    base: split.base,
    authorization: split.credentials ? authorizationFor(split.credentials) : null,
  };
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => T | Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const outer = init?.signal;
  const onAbort = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', onAbort);
  }
  try {
    // Keep the deadline and outer cancellation alive through body consumption.
    // A headers-only timeout can wedge the serialized poll on stalled JSON.
    return await consume(await fetch(url, { ...init, signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export function createApi(
  rawBase: string,
  suppliedCredentials?: StationCredentials | null,
  stationPassword: () => string | null = () => null,
): StationApi {
  const split = splitStationAddress(rawBase);
  const base = split.base;
  if (!base) throw new Error('Enter a valid HTTP(S) station address');
  const credentials = suppliedCredentials === undefined
    ? split.credentials
    : suppliedCredentials;
  const authorization = credentials ? authorizationFor(credentials) : null;
  const authHeaders: Record<string, string> | undefined = authorization
    ? { Authorization: authorization }
    : undefined;
  const api = (path: string) => `${base}/api${path}`;
  const withAuth = (init: RequestInit = {}): RequestInit => ({
    ...init,
    ...(authHeaders
      ? { headers: { ...authHeaders, ...(init.headers as Record<string, string> | undefined) } }
      : {}),
  });
  const stationFetch = <T>(url: string, init: RequestInit, consume: (res: Response) => T | Promise<T>) =>
    fetchWithTimeout(url, withAuth(init), consume);
  const getJson = <T>(url: string, signal?: AbortSignal): Promise<T> =>
    stationFetch(url, { signal }, async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    });
  const stationImage = (uri: string): StationImageSource => ({
    uri,
    ...(authHeaders ? { headers: { ...authHeaders } } : {}),
  });
  const probeHealth = async (signal?: AbortSignal): Promise<HealthResult> => {
    try {
      return await stationFetch<HealthResult>(api('/health'), { cache: 'no-store', signal },
        res => res.ok ? { ok: true } : { ok: false, kind: 'http', status: res.status });
    } catch (error) {
      const err = error as { name?: string; message?: string };
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
    health: async (signal) => {
      const result = await probeHealth(signal);
      if (result.ok) return true;
      if (result.kind === 'http') return false;
      throw new Error(result.message || result.kind);
    },
    probeHealth,
    postRequest: (body) =>
      stationFetch(api('/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, res => res.json() as Promise<RequestResult>),
    postBeacon: async (body) => {
      try {
        await stationFetch(api('/beacon'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, () => undefined);
      } catch {
        /* best-effort analytics */
      }
    },
    checkStationAuth: async (password) => {
      try {
        return await stationFetch(api('/station-auth'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        }, res => stationAuthResult(res.status));
      } catch {
        return stationAuthResult(null);
      }
    },
    pollRequest: (id) => stationFetch<RequestResult>(api(`/request/${encodeURIComponent(id)}`), {}, async res => {
      if (res.status === 404) return { success: false, status: 'unknown' };
      return (await res.json()) as RequestResult;
    }),
    likeCurrent: async (songId) => {
      try {
        return await stationFetch(api('/like'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songId }),
        }, res => res.json() as Promise<LikeResult>);
      } catch {
        return null;
      }
    },
    likeStatus: async () => {
      try {
        return await stationFetch(api('/like'), {}, res => res.json() as Promise<LikeStatus>);
      } catch {
        return null;
      }
    },
    cover: (subsonicId) => stationImage(api(`/cover/${encodeURIComponent(subsonicId)}`)),
    avatar: (path) => {
      if (!path) return { uri: '' };
      if (/^https?:\/\//i.test(path)) return { uri: path };
      return stationImage(api(path.startsWith('/') ? path : `/${path}`));
    },
    streamUrl: (format = 'mp3') => withStreamAuth(`${base}${mountFor(format)}`, stationPassword()),
    streamHeaders: () => authHeaders && { ...authHeaders },
  };
}
