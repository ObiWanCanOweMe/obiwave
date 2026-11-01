import { SEARCH_PROVIDER_CATALOG, type SearchProviderEntry } from '../../../lib/schemas.generated.ts';

export const SEARCH_PROVIDER_META: Record<string, SearchProviderEntry & { name?: string; placeholder?: string }> = Object.fromEntries(
  SEARCH_PROVIDER_CATALOG.map(p => [p.id, { ...p, name: 'keyName' in p ? p.keyName : undefined, placeholder: 'keyPlaceholder' in p ? p.keyPlaceholder : undefined }]),
);

export type SearchKeyDraft = string | null;

export interface SearchKeyTestOwnership {
  begin: () => number;
  invalidate: () => void;
  publishIfCurrent: (request: number, publish: () => void) => boolean;
}

export function createSearchKeyTestOwnership(): SearchKeyTestOwnership {
  let currentRequest = 0;

  return {
    begin: () => {
      currentRequest += 1;
      return currentRequest;
    },
    invalidate: () => {
      currentRequest += 1;
    },
    publishIfCurrent: (request, publish) => {
      if (request !== currentRequest) return false;
      publish();
      return true;
    },
  };
}

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
