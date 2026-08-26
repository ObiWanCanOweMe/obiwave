// Persisted multi-station config. Public station metadata stays in AsyncStorage;
// HTTP Basic Auth credentials live separately in the platform keychain/keystore.
// Shape:
//   { activeStation, recents[], }
// The featured/default station is seeded from app.json `extra.featuredStation`
// (read via expo-constants), not stored here, so an operator can rebrand the
// build by editing one config line.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createCredentialVault } from './credential-vault';
import {
  credentialsFromAuthorization,
  migrateLegacyStationStore,
  splitStationAddress,
  type StationCredentials,
} from './station-credentials';
import { forgetStoredStation } from './station-store';
import { safeStationLabel, secureKeyForOrigin } from './stationSecurity';

const KEY = 'subwave.stations.v1';
const RECENTS_CAP = 8;
const SECURE_OPTIONS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const credentialVault = createCredentialVault({
  getItemAsync: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
});

export interface StationRef {
  url: string;
  name: string;
  lastUsed?: number;
}

export interface StationStore {
  activeStation: string | null;
  recents: StationRef[];
}

const EMPTY: StationStore = { activeStation: null, recents: [] };

export function featuredStation(): StationRef {
  const f = (Constants.expoConfig?.extra as { featuredStation?: StationRef } | undefined)
    ?.featuredStation;
  const rawUrl = f?.url || 'https://www.getsubwave.com';
  return {
    url: splitStationAddress(rawUrl).base,
    name: safeStationLabel(f?.name || 'SUB/WAVE', rawUrl),
  };
}

async function persist(store: StationStore): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* non-fatal */
  }
}

export async function loadStations(): Promise<StationStore> {
  let loaded: StationStore;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<StationStore>;
    loaded = {
      activeStation: typeof parsed.activeStation === 'string' ? parsed.activeStation : null,
      recents: Array.isArray(parsed.recents) ? parsed.recents : [],
    };
  } catch {
    return { ...EMPTY };
  }

  const migrated = migrateLegacyStationStore(loaded);
  if (!migrated.changed) return loaded;
  try {
    await credentialVault.merge(migrated.credentials);
  } catch {
    // Public preferences must never retain listener credentials. If secure
    // storage is unavailable, keep the clean station identities and let the
    // listener re-enter the login after unlocking the device.
  }
  await persist(migrated.store);
  return migrated.store;
}

async function legacyCredentialsFor(base: string): Promise<StationCredentials | null> {
  const legacyKey = secureKeyForOrigin(base);
  const authorization = await SecureStore.getItemAsync(legacyKey, SECURE_OPTIONS);
  const credentials = credentialsFromAuthorization(authorization);
  if (!credentials) return null;
  // ObiWave builds before v1.11 stored one Basic header per origin. Promote it
  // into the upstream credential vault before deleting the old slot, so an
  // interrupted migration never loses the only saved login.
  await credentialVault.set(base, credentials);
  await SecureStore.deleteItemAsync(legacyKey);
  return credentials;
}

export async function loadStationCredentials(
  rawUrl: string,
): Promise<StationCredentials | null> {
  const split = splitStationAddress(rawUrl);
  if (split.credentials) return split.credentials;
  const stored = await credentialVault.get(split.base);
  return stored ?? legacyCredentialsFor(split.base);
}

/** Mark a station active and push it to the front of the MRU recents list. */
export async function setActiveStation(
  ref: StationRef,
  credentials?: StationCredentials | null,
): Promise<StationStore> {
  const split = splitStationAddress(ref.url);
  const url = split.base;
  if (!url) throw new Error('Enter a valid HTTP(S) station address');
  const nextCredentials = credentials === undefined ? split.credentials : credentials;
  // Do not commit a clean station record when its secret could not be saved:
  // that would present a broken recent after the current process exits.
  if (nextCredentials) await credentialVault.set(url, nextCredentials);
  else if (credentials === null) await credentialVault.remove(url);
  const store = await loadStations();
  const recents = [
    { url, name: safeStationLabel(ref.name, ref.url), lastUsed: Date.now() },
    ...store.recents.filter((r) => splitStationAddress(r.url).base !== url),
  ].slice(0, RECENTS_CAP);
  const next: StationStore = { activeStation: url, recents };
  await persist(next);
  return next;
}

export async function removeRecent(url: string): Promise<StationStore> {
  return forgetStoredStation(url, {
    load: loadStations,
    removeCredential: async (base) => {
      await credentialVault.remove(base);
      await SecureStore.deleteItemAsync(secureKeyForOrigin(base));
    },
    persist,
  });
}

export async function clearActiveStation(): Promise<StationStore> {
  const store = await loadStations();
  const next: StationStore = { activeStation: null, recents: store.recents };
  await persist(next);
  return next;
}
