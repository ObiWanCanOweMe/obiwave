export type ModelDiscoveryOwner = 'chat' | 'embedding' | 'tts';

export interface ModelDiscoveryRequestInput {
  owner: ModelDiscoveryOwner;
  provider: string;
  leg?: 'primary' | 'fallback' | 'onboarding';
  apiKey?: string;
  baseUrl?: string;
  ollamaUrl?: string;
}

export interface ModelDiscoveryRequest {
  url: '/settings/llm/models';
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  };
}

/** Browser/controller discovery contract. All mutable URLs and credentials are
 *  body-only so browser history and reverse-proxy access logs stay clean. */
export function buildModelDiscoveryRequest(
  input: ModelDiscoveryRequestInput,
): ModelDiscoveryRequest {
  const body: Record<string, string> = {
    owner: input.owner,
    provider: input.provider,
  };
  for (const key of ['leg', 'baseUrl', 'ollamaUrl', 'apiKey'] as const) {
    const value = input[key];
    if (value) body[key] = value;
  }
  return {
    url: '/settings/llm/models',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}
