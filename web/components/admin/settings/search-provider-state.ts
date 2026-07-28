export const SEARCH_PROVIDER_META = {
  duckduckgo: { label: 'DuckDuckGo (free, no key)' },
  tavily: {
    label: 'Tavily (paid web search)',
    name: 'Tavily',
    placeholder: 'tvly-…',
    keyUrl: 'https://app.tavily.com/home',
    envVar: 'SEARCH_API_KEY',
  },
  brave: {
    label: 'Brave Search (API key, free monthly credits)',
    name: 'Brave Search',
    placeholder: 'BSA…',
    keyUrl: 'https://api-dashboard.search.brave.com/app/keys',
    envVar: 'SEARCH_API_KEY',
  },
  searxng: { label: 'SearXNG (self-hosted)' },
  kagi: {
    label: 'Kagi (paid Search API)',
    name: 'Kagi',
    placeholder: 'Kagi API key',
    keyUrl: 'https://kagi.com/settings?p=api',
    envVar: 'KAGI_API_KEY',
  },
} as const;

export type SearchKeyDraft = string | null;

export const searchKeyInputValue = (
  value: SearchKeyDraft | undefined,
): string => (value === 'set' || value == null ? '' : value);

export function searchKeyPatch(
  value: SearchKeyDraft | undefined,
): string | null | undefined {
  if (value === null) return null;
  const trimmed = (value || '').trim();
  return trimmed && trimmed !== 'set' ? trimmed : undefined;
}

export function searchKeyDirty(
  draft: SearchKeyDraft | undefined,
  saved: SearchKeyDraft | undefined,
): boolean {
  if (draft === null) return saved === 'set';
  return searchKeyPatch(draft) !== undefined;
}

export function searchKeySource(
  saved: SearchKeyDraft | undefined,
  environmentPresent: boolean,
): 'saved' | 'environment' | 'missing' {
  if (saved === 'set') return 'saved';
  return environmentPresent ? 'environment' : 'missing';
}

export function reconcileSearchKeyDraftsAfterSave(
  drafts: Record<string, SearchKeyDraft>,
  savedPatch: Record<string, SearchKeyDraft>,
): Record<string, SearchKeyDraft> {
  const next = { ...drafts };
  for (const [provider, value] of Object.entries(savedPatch)) {
    if (value === null) next[provider] = null;
    else if (typeof searchKeyPatch(value) === 'string') next[provider] = 'set';
  }
  return next;
}
