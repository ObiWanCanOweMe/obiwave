import type { WizardData } from './useWizard';

export type LlmProvider =
  | 'ollama'
  | 'locca'
  | 'openai-compatible'
  | 'litellm'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'openrouter'
  | 'requesty'
  | 'gateway';

export type ProviderDraft = Pick<
  WizardData['llm'],
  'model' | 'apiKey' | 'baseUrl' | 'ollamaUrl'
>;

export type ProviderDrafts = Partial<Record<LlmProvider, ProviderDraft>>;

const EMPTY_DRAFT: ProviderDraft = {
  model: '',
  apiKey: '',
  baseUrl: '',
  ollamaUrl: '',
};

function providerDefaultDraft(provider: LlmProvider): ProviderDraft {
  if (provider === 'ollama') {
    return {
      ...EMPTY_DRAFT,
      model: 'glm-5.1:cloud',
      ollamaUrl: 'http://host.docker.internal:11434',
    };
  }
  return { ...EMPTY_DRAFT };
}

function providerDraft(llm: WizardData['llm']): ProviderDraft {
  return {
    model: llm.model,
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    ollamaUrl: llm.ollamaUrl,
  };
}

export interface ProviderChangeResult {
  llm: WizardData['llm'];
  drafts: ProviderDrafts;
}

export function llmDraftForProviderChange(
  current: WizardData['llm'],
  nextProvider: LlmProvider,
  drafts: ProviderDrafts,
): ProviderChangeResult;
// Compatibility overload for the existing provider-picker callback. useWizard
// owns restoration because it is the only layer that can retain every draft.
export function llmDraftForProviderChange<T extends WizardData['llm']>(
  current: T,
  nextProvider: string,
): T;
export function llmDraftForProviderChange(
  current: WizardData['llm'],
  nextProvider: string,
  drafts?: ProviderDrafts,
): ProviderChangeResult | WizardData['llm'] {
  if (nextProvider === current.provider) {
    return drafts ? { llm: current, drafts } : current;
  }

  const targetProvider = nextProvider as LlmProvider;
  if (!drafts) {
    return { provider: targetProvider, ...providerDefaultDraft(targetProvider) };
  }

  const nextDrafts: ProviderDrafts = {
    ...drafts,
    [current.provider as LlmProvider]: providerDraft(current),
  };
  const targetDraft = nextDrafts[targetProvider] ?? providerDefaultDraft(targetProvider);
  return {
    llm: { provider: targetProvider, ...targetDraft },
    drafts: nextDrafts,
  };
}

export function llmForSubmission(llm: WizardData['llm']): Record<string, string> {
  const shared = { provider: llm.provider, model: llm.model };
  if (llm.provider === 'ollama') {
    return { ...shared, ollamaUrl: llm.ollamaUrl };
  }
  if (llm.provider === 'openai-compatible' || llm.provider === 'litellm') {
    return { ...shared, apiKey: llm.apiKey, baseUrl: llm.baseUrl };
  }
  if (llm.provider === 'locca') {
    return { ...shared, baseUrl: llm.baseUrl };
  }
  return shared;
}

export function isCurrentDiscoveryRequest(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration;
}
