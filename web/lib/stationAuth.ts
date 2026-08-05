// Station password token for private stations (#478).
//
// One shared password backs both privacy locks (privatePlayer, listenerAuth).
// Whichever gate the listener meets first, the password they type is stored
// here and serves the other too.
//
// Browsers can't attach basic-auth credentials to an <audio> element, so the
// stream side rides the token as an `auth=` query param: Icecast's URL auth
// forwards the mount INCLUDING its query string to the controller, which
// accepts either that or a real basic-auth `pass` field.
//
// Stored in localStorage like the skin/theme overrides; cleared when the
// controller rejects it (i.e. the operator rotated the password). Credentials
// are scoped to the controller API identity: a directory/showcase page can
// host players for multiple stations, and one station's password must never be
// sent to another station's stream. The old unscoped key is intentionally not
// read or migrated.
const KEY_PREFIX = 'subwave-station-auth:';

export type StationAuthPhase = 'checking' | 'prompt' | 'ok';

export interface StationAuthState {
  required: boolean;
  apiBase: string;
  phase: StationAuthPhase;
}

export function stationAuthPhaseForContext(
  required: boolean,
  apiBase: string,
  state: StationAuthState,
): StationAuthPhase {
  if (state.required !== required || state.apiBase !== apiBase) return 'checking';
  return state.phase;
}

export function stationAuthPresentation(
  required: boolean,
  phase: StationAuthPhase,
): { phase: StationAuthPhase; showGate: boolean } {
  if (!required) return { phase: 'ok', showGate: false };
  return { phase, showGate: phase === 'prompt' };
}

function keyForStation(apiBase: string): string {
  const identity = apiBase.trim().replace(/\/+$/, '') || '/';
  return `${KEY_PREFIX}${identity}`;
}

export function getStationAuthToken(apiBase: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(keyForStation(apiBase)) || '';
  } catch {
    return '';
  }
}

export function setStationAuthToken(apiBase: string, token: string): void {
  try {
    window.localStorage.setItem(keyForStation(apiBase), token);
  } catch {
    // Private-mode storage failures just mean re-prompting next visit.
  }
}

export function clearStationAuthToken(apiBase: string): void {
  try {
    window.localStorage.removeItem(keyForStation(apiBase));
  } catch {
    // ignore
  }
}

// Append the stored token to a stream URL (no-op when no token is stored —
// the common public-station case). The player's URLs always carry a ?t=
// cache-buster already, but handle both shapes for safety.
export function withStreamAuth(apiBase: string, url: string): string {
  const token = getStationAuthToken(apiBase);
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`;
}

// Deliberately hits /station-auth, NOT the /listener-auth endpoint Icecast
// calls. They share the password but not the failure mode: /listener-auth fails
// OPEN when stream auth is off, covering the window where icecast.xml still
// carries the auth blocks but the setting is already off. Asking it here would
// mean a private player with stream auth off accepts any password.
// /station-auth fails closed.
export async function checkStationAuth(apiBase: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/station-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
