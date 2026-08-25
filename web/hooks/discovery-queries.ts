'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  useQueryClient,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
} from '@tanstack/react-query';
import { useDebounceValue } from 'usehooks-ts';
import { adminJson, useAdminQuery, type AdminFetch } from '@/lib/admin-query';
import {
  buildModelDiscoveryRequest,
  type ModelDiscoveryOwner,
} from '@/lib/modelDiscoveryRequest';
import { buildVoiceDiscoveryRequest } from '@/lib/voiceDiscoveryRequest';

export interface ModelDiscoveryInput {
  owner: ModelDiscoveryOwner;
  provider: string;
  leg?: 'primary' | 'fallback' | 'onboarding';
  apiKey?: string;
  baseUrl?: string;
  ollamaUrl?: string;
}

export interface VoiceDiscoveryInput { provider: string; baseUrl?: string; apiKey?: string; }
export interface DiscoveredVoice { id: string; label: string; hint?: string; }
export type ModelDiscoveryResponse = { ok: boolean; models: string[]; error?: string };
export type VoiceDiscoveryResponse = { ok: boolean; voices: DiscoveredVoice[]; error?: string };

// Query keys must separate two unsaved credentials so a fresh response for one
// is never reused for another, but AdminQueryProvider deliberately exposes the
// keys in its development snapshot. Hash to a fixed-width identity instead of
// retaining the raw secret in TanStack's cache (or in a module-level lookup).
// FNV-1a is identity, not authentication: the credential itself still travels
// only in the POST body and provider APIs already require high-entropy keys.
function credentialFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${value.length}:${hash.toString(16).padStart(16, '0')}`;
}

function discoveryCacheInput<T extends { apiKey?: string }>(input: T): Omit<T, 'apiKey'> & {
  credential?: string;
} {
  const { apiKey, ...publicInput } = input;
  if (!apiKey) return publicInput;
  return { ...publicInput, credential: credentialFingerprint(apiKey) };
}

export const discoveryKeys = {
  all: ['discovery'] as const,
  models: (input: ModelDiscoveryInput) => [
    'discovery', 'models', discoveryCacheInput(input),
  ] as const,
  voices: (input: VoiceDiscoveryInput) => [
    'discovery', 'voices', discoveryCacheInput(input),
  ] as const,
};

const compact = (value: string | undefined): string | undefined => value?.trim() || undefined;

export function normalizeModelDiscoveryInput(input: ModelDiscoveryInput): ModelDiscoveryInput {
  const apiKey = compact(input.apiKey);
  const baseUrl = compact(input.baseUrl);
  const ollamaUrl = compact(input.ollamaUrl);
  return {
    owner: input.owner,
    provider: input.provider.trim(),
    ...(input.owner === 'chat' && input.leg ? { leg: input.leg } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(ollamaUrl ? { ollamaUrl } : {}),
  };
}

export function normalizeVoiceDiscoveryInput(input: VoiceDiscoveryInput): VoiceDiscoveryInput {
  const apiKey = compact(input.apiKey);
  const baseUrl = compact(input.baseUrl);
  return {
    provider: input.provider.trim(),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function sameInput<T>(left: T, right: T): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function fetchModels(adminFetch: AdminFetch, input: ModelDiscoveryInput, signal: AbortSignal): Promise<ModelDiscoveryResponse> {
  const request = buildModelDiscoveryRequest(input);
  return adminJson(adminFetch, request.url, request.init, signal);
}

export function fetchVoices(adminFetch: AdminFetch, input: VoiceDiscoveryInput, signal: AbortSignal): Promise<VoiceDiscoveryResponse> {
  const request = buildVoiceDiscoveryRequest(input);
  return adminJson(adminFetch, request.url, request.init, signal);
}

export async function refreshDiscoveryQuery<T>(
  client: QueryClient,
  queryKey: QueryKey,
  queryFn: QueryFunction<T>,
): Promise<T> {
  await client.cancelQueries({ queryKey, exact: true }, { silent: true });
  return client.fetchQuery({ queryKey, queryFn, staleTime: 0 });
}

function useDiscoveryInput<T>(raw: T) {
  const [debounced] = useDebounceValue(raw, 400);
  const [refreshed, setRefreshed] = useState<T | null>(null);
  const usesRefreshed = refreshed !== null && sameInput(refreshed, raw) && !sameInput(debounced, raw);
  const refreshInput = useCallback(() => { setRefreshed(raw); return raw; }, [raw]);
  return { input: usesRefreshed ? refreshed : debounced, refreshInput, isRawTransition: !usesRefreshed && !sameInput(raw, debounced) };
}

function discoveryError(data: { ok: boolean; error?: string } | undefined, error: unknown, enabled: boolean): string | null {
  if (!enabled) return null;
  if (data && !data.ok) return data.error || 'Discovery failed';
  return error instanceof Error ? error.message : error ? 'Discovery failed' : null;
}

export function useModelDiscoveryQuery(rawInput: ModelDiscoveryInput, enabled: boolean, adminFetch: AdminFetch) {
  const { owner, provider, leg, apiKey, baseUrl, ollamaUrl } = rawInput;
  const raw = useMemo(
    () => normalizeModelDiscoveryInput({ owner, provider, leg, apiKey, baseUrl, ollamaUrl }),
    [owner, provider, leg, apiKey, baseUrl, ollamaUrl],
  );
  const { input, refreshInput } = useDiscoveryInput(raw);
  const client = useQueryClient();
  const query = useAdminQuery<ModelDiscoveryResponse>({
    key: discoveryKeys.models(input), adminFetch,
    request: (fetcher, signal) => fetchModels(fetcher, input, signal),
    enabled: enabled && !!input.provider,
    staleTime: 30_000,
    placeholderData: previous => previous,
  });
  const refresh = useCallback(() => {
    if (!enabled || !raw.provider) return;
    const next = refreshInput();
    const queryKey = discoveryKeys.models(next);
    void refreshDiscoveryQuery(
      client,
      queryKey,
      ({ signal }) => fetchModels(adminFetch, next, signal),
    ).catch(() => {});
  }, [adminFetch, client, enabled, raw.provider, refreshInput]);
  return {
    models: enabled && query.data?.ok ? (Array.isArray(query.data.models) ? query.data.models : []) : [],
    loading: enabled && query.isFetching,
    error: discoveryError(query.data, query.error, enabled),
    refresh,
  };
}

export function useVoiceDiscoveryQuery(rawInput: VoiceDiscoveryInput, enabled: boolean, adminFetch: AdminFetch) {
  const { provider, baseUrl, apiKey } = rawInput;
  const raw = useMemo(
    () => normalizeVoiceDiscoveryInput({ provider, baseUrl, apiKey }),
    [provider, baseUrl, apiKey],
  );
  const { input, refreshInput, isRawTransition } = useDiscoveryInput(raw);
  const client = useQueryClient();
  const query = useAdminQuery<VoiceDiscoveryResponse>({
    key: discoveryKeys.voices(input), adminFetch,
    request: (fetcher, signal) => fetchVoices(fetcher, input, signal),
    enabled: enabled && !!input.provider,
    staleTime: 30_000,
  });
  const refresh = useCallback(() => {
    if (!enabled || !raw.provider) return;
    const next = refreshInput();
    const queryKey = discoveryKeys.voices(next);
    void refreshDiscoveryQuery(
      client,
      queryKey,
      ({ signal }) => fetchVoices(adminFetch, next, signal),
    ).catch(() => {});
  }, [adminFetch, client, enabled, raw.provider, refreshInput]);
  return {
    voices: enabled && !isRawTransition && query.data?.ok && Array.isArray(query.data.voices) ? query.data.voices : [],
    loading: enabled && query.isFetching,
    error: discoveryError(query.data, query.error, enabled),
    refresh,
  };
}
