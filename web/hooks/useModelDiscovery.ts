import { useModelDiscoveryQuery } from './discovery-queries';
import type { ModelDiscoveryOwner } from '@/lib/modelDiscoveryRequest';

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

export function useModelDiscovery(opts: UseModelDiscoveryOpts): UseModelDiscoveryResult {
  return useModelDiscoveryQuery(opts, opts.enabled, opts.adminFetch);
}
