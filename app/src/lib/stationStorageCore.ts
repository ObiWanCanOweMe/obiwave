import {
  normalizeStationOrigin,
  parseStationAddress,
  safeStationLabel,
  secureKeyForOrigin,
} from './stationSecurity';

export const STATIONS_KEY = 'subwave.stations.v1';
export const STREAM_FORMAT_KEY = 'subwave.streamFormat.v1';
const RECENTS_CAP = 8;

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StoredStationRef {
  url: string;
  name: string;
  lastUsed?: number;
}

export interface StoredStations {
  activeStation: string | null;
  recents: StoredStationRef[];
}

const EMPTY: StoredStations = { activeStation: null, recents: [] };

function parseStore(raw: string | null): StoredStations {
  if (!raw) return { ...EMPTY };
  try {
    const value = JSON.parse(raw) as Partial<StoredStations>;
    return {
      activeStation: typeof value.activeStation === 'string' ? value.activeStation : null,
      recents: Array.isArray(value.recents) ? value.recents : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function migrateFormatMap(publicStore: KeyValueStore): Promise<void> {
  const raw = await publicStore.getItem(STREAM_FORMAT_KEY);
  if (!raw) return;
  try {
    const current = JSON.parse(raw) as Record<string, unknown>;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return;
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(current)) {
      const origin = normalizeStationOrigin(key);
      if (origin && typeof value === 'string') clean[origin] = value;
    }
    const next = JSON.stringify(clean);
    if (next !== raw) await publicStore.setItem(STREAM_FORMAT_KEY, next);
  } catch {
    // A corrupt preference is unrelated to station selection.
  }
}

export function createStationRepository(
  publicStore: KeyValueStore,
  secureStore: KeyValueStore,
  now: () => number = Date.now,
) {
  const persist = (store: StoredStations) =>
    publicStore.setItem(STATIONS_KEY, JSON.stringify(store));

  const migrateAddress = async (
    rawUrl: string,
    credentialOwners: Set<string>,
  ): Promise<string> => {
    const parsed = parseStationAddress(rawUrl);
    if (parsed.origin && !credentialOwners.has(parsed.origin)) {
      // Public recents use first-occurrence wins. Claim the origin even when
      // that winner is clean so a stale credentialed duplicate stays ignored.
      credentialOwners.add(parsed.origin);
      if (parsed.authorization) {
        try {
          const key = secureKeyForOrigin(parsed.origin);
          // SecureStore is canonical. Migration fills an absent slot; only an
          // explicit select is allowed to replace an existing credential.
          if (!await secureStore.getItem(key)) {
            await secureStore.setItem(key, parsed.authorization);
          }
        } catch {
          // Legacy plaintext must still be removed even if the encrypted store
          // is temporarily unavailable. The listener can re-enter it later.
        }
      }
    }
    return parsed.origin;
  };

  const load = async (
    protectedCredentialOrigins: Set<string> = new Set(),
  ): Promise<StoredStations> => {
    const source = parseStore(await publicStore.getItem(STATIONS_KEY));
    const credentialOwners = new Set(protectedCredentialOrigins);
    const activeStation = source.activeStation
      ? await migrateAddress(source.activeStation, credentialOwners)
      : '';
    const recents: StoredStationRef[] = [];
    const seen = new Set<string>();
    for (const ref of source.recents) {
      if (!ref || typeof ref.url !== 'string') continue;
      const origin = await migrateAddress(ref.url, credentialOwners);
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      recents.push({
        url: origin,
        name: safeStationLabel(ref.name, ref.url),
        ...(typeof ref.lastUsed === 'number' ? { lastUsed: ref.lastUsed } : {}),
      });
    }
    const clean: StoredStations = {
      activeStation: activeStation || null,
      recents: recents.slice(0, RECENTS_CAP),
    };
    await persist(clean);
    await migrateFormatMap(publicStore);
    return clean;
  };

  const authorizationFor = async (rawOrigin: string): Promise<string | null> => {
    const origin = normalizeStationOrigin(rawOrigin);
    if (!origin) return null;
    try {
      return await secureStore.getItem(secureKeyForOrigin(origin));
    } catch {
      return null;
    }
  };

  const select = async (ref: StoredStationRef): Promise<StoredStations> => {
    const parsed = parseStationAddress(ref.url);
    if (!parsed.origin) throw new Error('Enter a valid HTTP(S) station address');
    // Fail closed for a newly supplied secret: encrypted storage must succeed
    // before the public record can change. There is no plaintext fallback.
    if (parsed.authorization) {
      await secureStore.setItem(secureKeyForOrigin(parsed.origin), parsed.authorization);
    }
    const current = await load(
      parsed.authorization ? new Set([parsed.origin]) : undefined,
    );
    const recents = [
      {
        url: parsed.origin,
        name: safeStationLabel(ref.name, ref.url),
        lastUsed: now(),
      },
      ...current.recents.filter((item) => item.url !== parsed.origin),
    ].slice(0, RECENTS_CAP);
    const next = { activeStation: parsed.origin, recents };
    await persist(next);
    return next;
  };

  const remove = async (rawUrl: string): Promise<StoredStations> => {
    const origin = normalizeStationOrigin(rawUrl);
    const current = await load();
    const next = {
      activeStation: current.activeStation,
      recents: current.recents.filter((item) => item.url !== origin),
    };
    await persist(next);
    if (origin && next.activeStation !== origin && !next.recents.some((item) => item.url === origin)) {
      try {
        await secureStore.removeItem(secureKeyForOrigin(origin));
      } catch {
        // Forgetting the public reference remains useful if the keychain is
        // temporarily unavailable; no plaintext is reintroduced.
      }
    }
    return next;
  };

  const clearActive = async (): Promise<StoredStations> => {
    const current = await load();
    const next = { activeStation: null, recents: current.recents };
    await persist(next);
    return next;
  };

  return { load, select, remove, clearActive, authorizationFor };
}
