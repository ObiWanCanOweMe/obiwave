export interface LlmProviderDraft {
  provider: string;
  apiKey: string;
}

// Pure provider-switch seam used by the onboarding wizard.
export function llmDraftForProviderChange<T extends LlmProviderDraft>(
  draft: T,
  provider: string,
): T {
  if (provider === draft.provider) return draft;
  return { ...draft, provider, apiKey: '' };
}

export function isCurrentDiscoveryRequest(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration;
}
