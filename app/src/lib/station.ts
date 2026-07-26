// Persisted multi-station config. AsyncStorage contains public origins only;
// station Authorization values live exclusively in SecureStore. Shape:
//   { activeStation, recents[], }
// The featured/default station is seeded from app.json `extra.featuredStation`
// (read via expo-constants), not stored here, so an operator can rebrand the
// build by editing one config line.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normalizeStationOrigin } from './stationSecurity';
import { createStationRepository, type KeyValueStore } from './stationStorageCore';

const secureAdapter: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
const repository = createStationRepository(AsyncStorage, secureAdapter);

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
  return {
    url: normalizeStationOrigin(f?.url || 'https://www.getsubwave.com'),
    name: f?.name || 'SUB/WAVE',
  };
}

export async function loadStations(): Promise<StationStore> {
  try {
    return await repository.load();
  } catch {
    return { ...EMPTY };
  }
}

export async function loadStationAuthorization(base: string | null): Promise<string | null> {
  return base ? repository.authorizationFor(base) : null;
}

/** Mark a station active and push it to the front of the MRU recents list. */
export async function setActiveStation(ref: StationRef): Promise<StationStore> {
  return repository.select(ref);
}

export async function removeRecent(url: string): Promise<StationStore> {
  return repository.remove(url);
}

export async function clearActiveStation(): Promise<StationStore> {
  return repository.clearActive();
}
