// Pulls the voice list from a cloud TTS provider so the voice fields can offer a
// dropdown. The TTS twin of useModelDiscovery, backed by the shared Query
// debounce / stale-response / abort contract.
//
// Only `openai-compatible` and `elevenlabs` are discoverable (see
// controller/src/llm/internal/speech/voice-catalog.ts); `openai` has a fixed
// published voice set in lib/cloudVoices.ts. Discovery failing is a normal
// outcome — the caller falls back to a free-text input.
import { type DiscoveredVoice, useVoiceDiscoveryQuery } from './discovery-queries';

export type { DiscoveredVoice };

interface UseVoiceDiscoveryOpts {
  provider: string;
  baseUrl?: string;
  // Unsaved provider credential. The request builder keeps it body-only.
  apiKey?: string;
  enabled: boolean;
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

interface UseVoiceDiscoveryResult {
  voices: DiscoveredVoice[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useVoiceDiscovery(opts: UseVoiceDiscoveryOpts): UseVoiceDiscoveryResult {
  return useVoiceDiscoveryQuery(opts, opts.enabled, opts.adminFetch);
}
