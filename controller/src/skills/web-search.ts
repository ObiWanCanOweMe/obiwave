// Web search helper — backs the `searchArtistNews` segment tool (llm/
// segment-tools.js). There is no standalone "web-search skill" object — the
// segment-director agent (skills/_agent.js) decides when artist news airs.
//
// Five backends, chosen via settings.search.provider:
//   - duckduckgo (default) — DuckDuckGo's Instant Answer API. Free, no key,
//     officially documented. Returns useful results only for entity / definition
//     queries; for most artist queries it returns nothing, which the segment
//     director already treats as a valid (silent) outcome.
//   - tavily — paid API for richer web results. Its provider-owned saved key
//     falls back to SEARCH_API_KEY.
//   - brave — Brave Search API. Real web results for artist-name queries
//     (issue #623). Its provider-owned saved key also falls back to
//     SEARCH_API_KEY; metered billing makes the 30-min memo matter here too.
//   - searxng — self-hosted meta-search, keyless, needs settings.search.baseUrl.
//   - kagi — paid privacy-oriented web search, with a dedicated saved key or
//     KAGI_API_KEY fallback.
//
// All backends return the same shape — { answer, results: [{ title, content }] }
// — so callers don't have to branch. searchWeb() wraps every call in a 30-min
// memo to keep the homelab polite under DDG's unofficial fair-use limits and
// to avoid burning metered-provider credits on duplicate ticks.

import * as settings from '../settings.js';
import { fetchWithTimeout } from '../util/fetch-timeout.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DDG_ENDPOINT = 'https://api.duckduckgo.com/';
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const KAGI_ENDPOINT = 'https://kagi.com/api/v1/search';

type SearchResult = { title: string; content: string };
type SearchResponse = { answer: string; results: SearchResult[] };
type Recency = 'day' | 'week' | 'month';

// 30-min TTL cache keyed by provider, recency, and query. Same shape as music/picker.js
// — Map + { val, at }, no LRU eviction (search queries are bounded by the
// artists actually on rotation, so the Map stays small).
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { val: SearchResponse; at: number }>();

async function memo(
  key: string,
  ttl: number,
  fn: () => Promise<SearchResponse>,
): Promise<SearchResponse> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.val;
  const val = await fn();
  cache.set(key, { val, at: Date.now() });
  return val;
}

export async function tavilySearch(query: string): Promise<SearchResponse> {
  const apiKey = settings.searchKeyFor('tavily');
  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      topic: 'general',
      include_answer: true,
      max_results: 5,
    }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data: any = await res.json();
  return {
    answer: String(data.answer || '').trim(),
    results: Array.isArray(data.results)
      ? data.results.map((r: any) => ({
          title: String(r.title || ''),
          content: String(r.content || ''),
        }))
      : [],
  };
}

// DuckDuckGo Instant Answer API. Returns sparse results — useful for well-known
// entities (artists with a Wikipedia infobox, common nouns) and silent for most
// other queries. We map `AbstractText` to the answer slot, and prefer
// `RelatedTopics[*].Text` for sources.
//
// Setting `no_html=1` strips HTML from AbstractText/RelatedTopics; `skip_disambig=1`
// avoids the "did you mean…" disambiguation pages, which never contain useful
// detail. We send a real User-Agent — DDG silently 200s with an empty body
// otherwise.
export async function duckduckgoSearch(query: string): Promise<SearchResponse> {
  const url = new URL(DDG_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');
  url.searchParams.set('no_redirect', '1');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'SUB-WAVE radio controller (https://github.com/perminder-klair/subwave)',
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const data: any = await res.json();
  const answer = String(data.AbstractText || data.Abstract || '').trim();
  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  const results: SearchResult[] = [];
  for (const t of topics) {
    if (!t) continue;
    if (Array.isArray(t.Topics)) {
      // Grouped category — flatten one level deep.
      for (const sub of t.Topics) {
        if (sub && typeof sub.Text === 'string' && sub.Text.trim()) {
          results.push({
            title: String(sub.Name || data.Heading || ''),
            content: sub.Text.trim(),
          });
        }
        if (results.length >= 5) break;
      }
    } else if (typeof t.Text === 'string' && t.Text.trim()) {
      results.push({
        title: String(t.Name || data.Heading || ''),
        content: t.Text.trim(),
      });
    }
    if (results.length >= 5) break;
  }
  return { answer, results: results.slice(0, 5) };
}

// SearXNG meta-search backend. Self-hosted, no API key — needs only a
// reachable base URL stored in settings.search.baseUrl. Threads optional
// recency through to SearXNG's time_range param (artist-news callsite
// passes 'week' to bias toward fresh content).
export async function searxngSearch(
  query: string,
  recency?: Recency,
): Promise<SearchResponse> {
  const baseUrl = (settings.get().search?.baseUrl || '').trim();
  if (!baseUrl) throw new Error('SearXNG baseUrl not configured');

  const url = new URL('/search', baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (recency) url.searchParams.set('time_range', recency);

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'SUB-WAVE radio controller (https://github.com/perminder-klair/subwave)',
    },
    timeoutMs: 30_000,
  });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const data = await res.json();
  return parseSearxngResponse(data);
}

// Pure parser for SearXNG's JSON response. Maps the SearXNG shape
// (results[], answers[], infoboxes[]) onto SubWave's SearchResponse contract.
// Exported separately from searxngSearch() so fixture-based tests can pin
// the mapping without mocking fetch. Tolerant of malformed input — any
// shape mismatch yields { answer: '', results: [] }.
export function parseSearxngResponse(data: unknown): SearchResponse {
  if (!data || typeof data !== 'object') return { answer: '', results: [] };
  const d = data as Record<string, unknown>;

  // answer slot: prefer first infobox content, else empty.
  let answer = '';
  const infoboxes = Array.isArray(d.infoboxes) ? d.infoboxes : [];
  if (infoboxes.length > 0 && infoboxes[0] && typeof infoboxes[0] === 'object') {
    const ib = infoboxes[0] as Record<string, unknown>;
    if (typeof ib.content === 'string') answer = ib.content.trim();
  }

  const rawResults = Array.isArray(d.results) ? d.results : [];
  const results: SearchResult[] = [];
  for (const r of rawResults) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const content = typeof rec.content === 'string' ? rec.content.trim().slice(0, 300) : '';
    if (!title || !content) continue;
    results.push({ title, content });
    if (results.length >= 10) break;
  }

  return { answer, results };
}

// Brave Search API backend (issue #623). Its provider-owned key falls back to
// SEARCH_API_KEY. Threads
// optional recency through Brave's `freshness` param (pd/pw/pm), and asks for
// undecorated snippets (text_decorations=0) so descriptions arrive as plain
// text instead of <strong>-highlighted HTML.
export async function braveSearch(
  query: string,
  recency?: Recency,
): Promise<SearchResponse> {
  const apiKey = settings.searchKeyFor('brave');
  if (!apiKey) throw new Error('Brave Search API key not configured');

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('text_decorations', '0');
  if (recency) {
    url.searchParams.set('freshness', { day: 'pd', week: 'pw', month: 'pm' }[recency]);
  }

  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    timeoutMs: 30_000,
  });
  if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);
  const data = await res.json();
  return parseBraveResponse(data);
}

// Strips residual markup from Brave snippets. text_decorations=0 removes the
// highlighting, but descriptions can still carry entities (&#x27; etc.) and
// the occasional stray tag depending on the source page.
function braveText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x?)([0-9a-fA-F]+);/g, (whole, x: string, digits: string) => {
      const code = parseInt(digits, x ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

// Kagi may include source markup and named HTML entities even when its JSON
// search response is otherwise plain text. Decode before stripping tags so
// encoded tags cannot leak into the segment tool's prompt.
function kagiText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/&#(x?)([0-9a-fA-F]+);/g, (whole, x: string, digits: string) => {
      const code = parseInt(digits, x ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&hellip;/gi, '…')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pure parser for Brave's web-search JSON. Maps the Brave shape (web.results[],
// news.results[], infobox) onto SubWave's SearchResponse contract. News results
// lead — the artist-news callsite is the whole point of this provider — then
// web results fill the remainder. Exported separately from braveSearch() so
// fixture-based tests can pin the mapping without mocking fetch. Tolerant of
// malformed input — any shape mismatch yields { answer: '', results: [] }.
export function parseBraveResponse(data: unknown): SearchResponse {
  if (!data || typeof data !== 'object') return { answer: '', results: [] };
  const d = data as Record<string, unknown>;
  const sub = (v: unknown, key: string): unknown =>
    v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;

  // answer slot: the infobox's long description when Brave recognises the
  // entity. `infobox.results` has been observed as both an object and a
  // one-element array — accept either.
  const ibRaw = sub(d.infobox, 'results');
  const ib = Array.isArray(ibRaw) ? ibRaw[0] : ibRaw;
  const answer = braveText(sub(ib, 'long_desc') || sub(ib, 'description'));

  const results: SearchResult[] = [];
  const push = (r: unknown) => {
    if (!r || typeof r !== 'object' || results.length >= 10) return;
    const rec = r as Record<string, unknown>;
    const title = braveText(rec.title);
    const content = braveText(rec.description).slice(0, 300);
    if (!title || !content) return;
    results.push({ title, content });
  };
  const newsResults = sub(d.news, 'results');
  const webResults = sub(d.web, 'results');
  for (const r of Array.isArray(newsResults) ? newsResults : []) push(r);
  for (const r of Array.isArray(webResults) ? webResults : []) push(r);

  return { answer, results };
}

export function kagiAfterDate(
  recency: Recency | undefined,
  now = new Date(),
): string | undefined {
  if (!recency) return undefined;
  const days = { day: 1, week: 7, month: 30 }[recency];
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

// Pure parser for Kagi's Search API JSON. Ordinary searches favor web
// results, while freshness-oriented searches favor news. Direct-answer,
// infobox, and interesting-find blocks are intentionally excluded because
// they are not source results for the segment tool.
export function parseKagiResponse(data: unknown, recency?: Recency): SearchResponse {
  if (!data || typeof data !== 'object') return { answer: '', results: [] };
  const root = data as Record<string, unknown>;
  if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data)) {
    return { answer: '', results: [] };
  }

  const buckets = root.data as Record<string, unknown>;
  const order = recency
    ? ['news', 'interesting_news', 'search']
    : ['search', 'news', 'interesting_news'];
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const bucket of order) {
    const rawResults = buckets[bucket];
    if (!Array.isArray(rawResults)) continue;
    for (const raw of rawResults) {
      if (!raw || typeof raw !== 'object' || results.length >= 10) continue;
      const result = raw as Record<string, unknown>;
      const title = kagiText(result.title);
      const content = kagiText(result.snippet).slice(0, 300);
      if (!title || !content) continue;

      const url = typeof result.url === 'string' ? result.url.trim().toLowerCase() : '';
      const dedupKey = url || `${title.toLowerCase()}\n${content.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      results.push({ title, content });
    }
  }

  return { answer: '', results };
}

export async function kagiSearch(
  query: string,
  recency?: Recency,
  options: { apiKey?: string; now?: Date } = {},
): Promise<SearchResponse> {
  const apiKey = options.apiKey || settings.searchKeyFor('kagi');
  if (!apiKey) throw new Error('Kagi Search API key not configured');
  const after = kagiAfterDate(recency, options.now);
  const response = await fetchWithTimeout(KAGI_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      workflow: 'search',
      format: 'json',
      limit: 10,
      safe_search: true,
      ...(after ? { filters: { after } } : {}),
    }),
    timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`Kagi Search HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== 'object'
      || !(data as Record<string, unknown>).data
      || typeof (data as Record<string, unknown>).data !== 'object'
      || Array.isArray((data as Record<string, unknown>).data)) {
    throw new Error('Kagi Search returned an unsupported response');
  }
  return parseKagiResponse(data, recency);
}

export const searchCacheKey = (
  provider: string,
  query: string,
  recency?: Recency,
): string => `${provider}:${recency || ''}:${query.toLowerCase()}`;

// Provider dispatcher — reads the active provider from live settings on every
// call so admin-UI changes take effect immediately. Wraps the backend in a
// 30-min memo. Cache key includes recency so two callsites with different
// recency hints don't share results.
export async function searchWeb(
  query: string,
  opts?: { recency?: Recency },
): Promise<SearchResponse> {
  const provider = settings.get().search?.provider || 'duckduckgo';
  const recency = opts?.recency;
  const key = searchCacheKey(provider, query, recency);
  return memo(key, CACHE_TTL_MS, () => {
    if (provider === 'searxng') return searxngSearch(query, recency);
    if (provider === 'tavily') return tavilySearch(query);
    if (provider === 'brave') return braveSearch(query, recency);
    if (provider === 'kagi') return kagiSearch(query, recency);
    return duckduckgoSearch(query);
  });
}

// True when the active search provider is usable right now.
//   duckduckgo:   always ready (no key, no URL)
//   tavily/brave: needs a provider-owned saved key, or SEARCH_API_KEY env
//   kagi:        needs a provider-owned saved key, or KAGI_API_KEY env
//   searxng:      needs settings.search.baseUrl (no env fallback by design)
export function searchReady(): boolean {
  const s = settings.get().search;
  const provider = s?.provider || 'duckduckgo';
  if (provider === 'duckduckgo') return true;
  if (provider === 'searxng') return !!(s?.baseUrl && s.baseUrl.trim());
  if (provider === 'tavily' || provider === 'brave' || provider === 'kagi') {
    return !!settings.searchKeyFor(provider);
  }
  return false;
}
