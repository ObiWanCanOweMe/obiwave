// Which credential each web-search backend may send. Saved credentials belong
// to separate provider slots; Tavily, Brave and Firecrawl also share the
// SEARCH_API_KEY environment fallback. Recognized foreign prefixes are refused
// before requests, including direct probes, readiness checks and diagnostics.
//
// Firecrawl and Keenable publish a prefix and take only a key that carries it:
// Firecrawl refuses anything else, Keenable runs keyless instead. Tavily's and
// Brave's key formats aren't confirmed, so an allowlist could lock out a working
// key. They refuse only a key carrying another provider's known prefix, and any
// other key still goes through.
//
// Pure: no settings or env. settings.searchKeyFor() resolves each provider-owned slot.

import { SEARCH_PROVIDER_CATALOG } from '../schemas/settings.js';

// Each provider's own key prefix, where one is known. Tavily's is listed so
// Brave and Firecrawl can refuse a Tavily key; Tavily itself doesn't require it.
const KEY_PREFIX: Readonly<Record<string, string>> = {
  firecrawl: 'fc-',
  keenable: 'keen_',
  tavily: 'tvly-',
};

// Providers that take only a key carrying their own prefix.
const PREFIX_REQUIRED: ReadonlySet<string> = new Set(['firecrawl', 'keenable']);

function keyName(provider: string): string {
  const entry = SEARCH_PROVIDER_CATALOG.find((p) => p.id === provider);
  return (entry && 'keyName' in entry && entry.keyName) || provider;
}

// The provider whose known prefix this key carries, or null.
function prefixOwner(key: string): string | null {
  for (const [provider, prefix] of Object.entries(KEY_PREFIX)) {
    if (key.startsWith(prefix)) return provider;
  }
  return null;
}

// True when `provider` may send `key`. An empty key fits nobody.
export function searchKeyFits(provider: string, key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (PREFIX_REQUIRED.has(provider)) return k.startsWith(KEY_PREFIX[provider]);
  const owner = prefixOwner(k);
  return owner === null || owner === provider;
}

// Why `provider` refuses `key`, as the end of a sentence ("The key on file is
// …", or capitalised for the probe), or null when it doesn't. An empty key is
// null: that is a missing key, which keeps its own "set a key" wording.
export function searchKeyMismatch(provider: string, key: string): string | null {
  const k = key.trim();
  if (!k || searchKeyFits(provider, k)) return null;
  if (PREFIX_REQUIRED.has(provider)) {
    return `not a ${keyName(provider)} key (they start with ${KEY_PREFIX[provider]})`;
  }
  return `a ${keyName(prefixOwner(k) ?? '')} key, not a ${keyName(provider)} key`;
}

// True when the provider can't search without a key (the catalogue's
// `key: 'required'`), so a refused key leaves it unable to search.
export function searchKeyRequired(provider: string): boolean {
  return SEARCH_PROVIDER_CATALOG.some((p) => p.id === provider && p.key === 'required');
}

// The keyed providers that would refuse this key, in catalogue order. Empty for
// an empty key. GET /settings serves it for the slot's key, so the Settings page
// can warn as soon as the operator picks a provider, before saving.
export function searchProvidersRefusing(key: string): string[] {
  if (!key.trim()) return [];
  return SEARCH_PROVIDER_CATALOG
    .filter((p) => p.key === 'required' && !searchKeyFits(p.id, key))
    .map((p) => p.id);
}
