'use client';

import type { ChangeEvent } from 'react';
import { useState } from 'react';
import { errorMessage } from '../../../lib/notify';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup,
} from '../../ui/select';
import { Card, Btn, Pill } from '../ui';
import {
  SectionHeader, SaveBar, KeyStatus, KeyTestResult,
  type SectionProps,
} from './shared';
import {
  SEARCH_PROVIDER_META,
  createSearchKeyTestOwnership,
  searchKeyDirty,
  searchKeyInputValue,
  searchKeyPatch,
  searchKeySource,
  type SearchKeyDraft,
} from './search-provider-state';

const searchProviderLabel = (id: string | undefined): string =>
  (id && SEARCH_PROVIDER_META[id as keyof typeof SEARCH_PROVIDER_META]?.label) || id || '—';

interface SearchSectionProps extends SectionProps {
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
}
export function SearchSection({ data, form, setForm, busy, saveSettings, adminFetch }: SearchSectionProps) {
  const [keyTest, setKeyTest] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null);
  const [keyTesting, setKeyTesting] = useState(false);
  const [testingSearxng, setTestingSearxng] = useState(false);
  const [searxngTestResult, setSearxngTestResult] = useState<{ ok: boolean; results?: number; error?: string } | null>(null);
  const [keyTestOwnership] = useState(() => createSearchKeyTestOwnership());

  const savedSearch = data.values?.search || {};
  const providers = data.search?.providers || ['duckduckgo', 'tavily', 'brave', 'searxng', 'kagi'];
  const provider = form.search.provider;
  const meta = SEARCH_PROVIDER_META[provider as keyof typeof SEARCH_PROVIDER_META];
  const keyed = meta && 'envVar' in meta ? meta : null;
  const draft = keyed ? form.search.apiKeys[provider] : undefined;
  const savedKey = keyed ? savedSearch.apiKeys?.[provider] ?? undefined : undefined;
  const envPresent = keyed ? !!data.env?.[keyed.envVar] : false;
  const keySource = searchKeySource(savedKey, envPresent);
  const apiKeyPatch = keyed ? searchKeyPatch(draft) : undefined;
  const searchPatch = {
    provider,
    ...(apiKeyPatch !== undefined ? { apiKeys: { [provider]: apiKeyPatch } } : {}),
    ...(provider === 'searxng' ? { baseUrl: form.search.baseUrl ?? '' } : {}),
  };
  const searchDirty = provider !== savedSearch.provider
    || (!!keyed && searchKeyDirty(draft, savedKey))
    || (provider === 'searxng'
        && (form.search.baseUrl ?? '') !== (savedSearch.baseUrl || ''));

  const invalidateKeyTest = () => {
    keyTestOwnership.invalidate();
    setKeyTest(null);
    setKeyTesting(false);
  };

  const setActiveKeyDraft = (value: SearchKeyDraft) => {
    invalidateKeyTest();
    setForm(f => ({
      ...f,
      search: {
        ...f.search,
        apiKeys: { ...f.search.apiKeys, [provider]: value },
      },
    }));
  };

  const handleTestSearxng = async () => {
    setTestingSearxng(true);
    setSearxngTestResult(null);
    try {
      const res = await adminFetch('/settings/search/test-searxng', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: form.search.baseUrl }),
      });
      const j = await res.json();
      setSearxngTestResult(j);
    } catch (err: unknown) {
      setSearxngTestResult({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
    } finally {
      setTestingSearxng(false);
    }
  };

  const testApiKey = async () => {
    if (!keyed || (!searchKeyInputValue(draft).trim() && keySource === 'missing')) return;
    const request = keyTestOwnership.begin();
    setKeyTesting(true);
    setKeyTest(null);
    try {
      const r = await adminFetch('/settings/secrets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: keyed.envVar,
          value: searchKeyInputValue(draft).trim(),
          provider,
        }),
      });
      const j = await r.json() as { ok: boolean; message: string; latencyMs: number };
      keyTestOwnership.publishIfCurrent(request, () => setKeyTest(j));
    } catch (e) {
      keyTestOwnership.publishIfCurrent(request, () => {
        setKeyTest({ ok: false, message: errorMessage(e), latencyMs: 0 });
      });
    } finally {
      keyTestOwnership.publishIfCurrent(request, () => setKeyTesting(false));
    }
  };

  return (
    <>
      <SectionHeader
        eyebrow="web search"
        title="Where the DJ gets live facts about the artist on air."
        sub={<>
          The segment director can air a single line of recent artist context between
          tracks, when the active backend returns something worth saying. DuckDuckGo
          is free and keyless; Tavily, Brave, and Kagi return web results; SearXNG is
          keyless if you self-host it. Switching here reroutes the next call, no restart.
        </>}
        metrics={[{ n: String(providers.length), l: 'providers' }]}
      />

      <Card title="Provider" sub="active backend">
        <div className="grid gap-[18px]">
          <div className="flex items-start gap-2.5 border border-[var(--accent)] bg-[var(--ink-softer)] p-3">
            <span className="mt-1 size-1.5 flex-none rounded-full bg-vermilion" />
            <div className="grid min-w-0 gap-0.5">
              <span className="text-[11px] font-bold tracking-[0.12em] text-vermilion uppercase">
                Routing now · {searchProviderLabel(savedSearch.provider || 'duckduckgo')}
              </span>
              <span className="text-[14px] leading-[1.5] text-muted">
                {searchDirty
                  ? <>Your edits below aren&apos;t live until you Save.</>
                  : <>This is the saved, running config.</>}
              </span>
            </div>
          </div>

          <div className="field">
            <div className="flex items-center gap-2">
              <Label>Provider</Label>
              {searchDirty && <Pill tone="accent" dot>unsaved</Pill>}
            </div>
            <Select
              value={provider}
              onValueChange={v => {
                invalidateKeyTest();
                setSearxngTestResult(null);
                setForm(f => ({ ...f, search: { ...f.search, provider: v } }));
              }}
            >
              <SelectTrigger className="max-w-[360px]" aria-label="Provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providers.map(p => (
                    <SelectItem key={p} value={p}>{searchProviderLabel(p)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="field-hint">
              {provider === 'duckduckgo'
                ? 'DuckDuckGo Instant Answer, free and keyless. Useful for definitions and well-known entities; silent otherwise. The segment director treats silence as a valid outcome.'
                : provider === 'tavily'
                ? 'Tavily, paid web search with full results and an answer summary. Needs an API key.'
                : provider === 'brave'
                ? 'Brave Search API: real web + news results for artist queries. Metered billing with $5/month in free credits (~1,000 queries; a card on file is required). SUB/WAVE caches every search for 30 minutes.'
                : provider === 'kagi'
                ? 'Kagi is a paid, privacy-oriented straight Search API with a dedicated key. SUB/WAVE caches every search for 30 minutes.'
                : 'SearXNG, self-hosted meta-search aggregating Google, Brave, DDG and more. No API key needed, just a running SearXNG instance.'}
            </div>
          </div>

          {keyed && (
            <>
              <div className="field">
                <Label>{keyed.name} API key</Label>
                <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={searchKeyInputValue(draft)}
                    placeholder={savedKey === 'set' ? '•••••• (key on file)' : keyed.placeholder}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setActiveKeyDraft(e.target.value)}
                    className="max-w-[360px]"
                  />
                  <Btn
                    onClick={testApiKey}
                    disabled={keyTesting || (!searchKeyInputValue(draft).trim() && keySource === 'missing')}
                  >
                    {keyTesting ? 'Testing…' : 'Test key'}
                  </Btn>
                  {savedKey === 'set' && draft !== null && (
                    <Btn
                      tone="danger"
                      onClick={() => setActiveKeyDraft(null)}
                    >
                      Clear saved key
                    </Btn>
                  )}
                </div>
                <div className="field-hint">
                  Get one at <a href={keyed.keyUrl} target="_blank" rel="noreferrer" className="underline">{keyed.keyUrl.replace(/^https:\/\//, '')}</a>.
                  Stored alongside the other admin settings. Falls back to
                  <code> {keyed.envVar}</code> in <code>.env</code> when blank. Set
                  one or the other, not both.
                </div>
              </div>
              <KeyStatus envVar={keyed.envVar} present={keySource !== 'missing'} source={keySource} />
              {keyTest && <KeyTestResult result={keyTest} />}
            </>
          )}

          {provider === 'searxng' && (
            <>
              <div className="field">
                <Label>SearXNG URL</Label>
                <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
                  <Input
                    type="url"
                    placeholder="http://192.168.0.112:8888"
                    value={form.search.baseUrl ?? ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setForm(f => ({ ...f, search: { ...f.search, baseUrl: e.target.value } }))
                    }
                    className="max-w-[360px]"
                  />
                  <Btn onClick={handleTestSearxng} disabled={!form.search?.baseUrl || testingSearxng}>
                    {testingSearxng ? 'Testing…' : 'Test'}
                  </Btn>
                </div>
                {searxngTestResult && (
                  <p role="status" className={`text-sm ${searxngTestResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                    {searxngTestResult.ok
                      ? `Connected · ${searxngTestResult.results} results`
                      : `Failed: ${searxngTestResult.error}`}
                  </p>
                )}
                <div className="field-hint">
                  Self-hosted SearXNG instance. No API key required. Ensure JSON format is
                  enabled in your SearXNG <code>settings.yml</code>.
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      <SaveBar
        note="Applies to the next web-search call, no restart needed."
        busy={busy}
        onSave={() => saveSettings({ search: searchPatch })}
        saveLabel="Save web search"
      />
    </>
  );
}
