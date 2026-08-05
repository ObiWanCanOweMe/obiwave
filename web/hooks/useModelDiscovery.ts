import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildModelDiscoveryRequest,
  type ModelDiscoveryOwner,
} from '@/lib/modelDiscoveryRequest';

interface UseModelDiscoveryOpts {
  owner: ModelDiscoveryOwner;
  provider: string;
  leg?: 'primary' | 'fallback' | 'onboarding';
  apiKey?: string;
  baseUrl?: string;
  ollamaUrl?: string;
  enabled: boolean;
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

interface UseModelDiscoveryResult {
  models: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// One request per multi-character edit of a base-URL field, not per keystroke.
const DEBOUNCE_MS = 400;

export function useModelDiscovery({
  owner,
  provider,
  leg = 'primary',
  apiKey,
  baseUrl,
  ollamaUrl,
  enabled,
  adminFetch,
}: UseModelDiscoveryOpts): UseModelDiscoveryResult {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id: only the newest in-flight request may write state, so
  // a slow response for a stale (provider, baseUrl, scope) can't clobber it.
  const reqIdRef = useRef(0);

  const runFetch = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !provider) {
      setModels([]);
      setError(null);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const request = buildModelDiscoveryRequest({
        owner,
        provider,
        ...(owner === 'chat' ? { leg } : {}),
        apiKey,
        baseUrl,
        ollamaUrl,
      });
      const r = await adminFetch(request.url, {
        ...request.init,
        ...(signal ? { signal } : {}),
      });
      const data = await r.json() as { ok: boolean; models: string[]; error?: string };
      if (reqId !== reqIdRef.current) return;
      if (data.ok) {
        setModels(data.models);
        setError(null);
      } else {
        setModels([]);
        setError(data.error || 'Discovery failed');
      }
    } catch (e: unknown) {
      if (signal?.aborted || reqId !== reqIdRef.current) return;
      setModels([]);
      setError(e instanceof Error ? e.message : 'Discovery failed');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [owner, provider, leg, apiKey, baseUrl, ollamaUrl, enabled, adminFetch]);

  // Auto-discover on input change, debounced. The AbortController cancels an
  // in-flight request when the inputs change again before it resolves.
  useEffect(() => {
    if (!enabled || !provider) {
      setModels([]);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => { runFetch(ctrl.signal); }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
      reqIdRef.current += 1;
    };
  }, [runFetch, enabled, provider]);

  // Manual refresh fires immediately and bumps the request id, superseding any
  // debounced or in-flight auto-discovery.
  const refresh = useCallback(() => { runFetch(); }, [runFetch]);

  return { models, loading, error, refresh };
}
