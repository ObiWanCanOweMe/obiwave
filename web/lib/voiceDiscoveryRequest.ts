export interface VoiceDiscoveryRequestInput {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface VoiceDiscoveryRequest {
  url: '/settings/tts/voices';
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  };
}

/** Keep unsaved provider URLs and credentials out of browser/proxy query logs. */
export function buildVoiceDiscoveryRequest(
  input: VoiceDiscoveryRequestInput,
): VoiceDiscoveryRequest {
  const body: Record<string, string> = { provider: input.provider };
  for (const key of ['baseUrl', 'apiKey'] as const) {
    const value = input[key];
    if (value) body[key] = value;
  }
  return {
    url: '/settings/tts/voices',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}
