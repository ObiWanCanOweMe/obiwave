// Provider probing and model discovery: does this key work, does this server
// speak the OpenAI-compatible dialect we need, and what models can it offer.
// All read-only against the provider - nothing here writes settings.
//
// Part of the settings/ route split - see ../settings.ts.

import express from 'express';
import * as settings from '../../settings.js';
import * as llmProvider from '../../llm/provider.js';
import { probeEmbeddingConfig } from '../../music/embeddings.js';
import { requireAdmin } from '../../middleware/auth.js';
import { SECRET_ENV_KEYS } from '../../setup/secrets.js';
import { listenbrainzApiBase } from '../../broadcast/scrobble.js';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { fetchWithTimeout } from '../../util/fetch-timeout.js';
import { effectiveLiteLlmApiKey, effectiveLiteLlmBaseUrl } from '../../litellm-config.js';
import {
  discoverModels,
  type ChatLeg,
  type ModelOwner,
} from './model-discovery.js';

// Mounted onto the parent settings router in ../settings.ts.
export const router = express.Router();

// ---------------------------------------------------------------------------
// probeKey — non-mutating live probe for a single secret key.
// Builds a one-off provider client using the supplied value; never writes to
// process.env or secrets.env. Always resolves (never rejects).
// ---------------------------------------------------------------------------
// Distill a raw provider/SDK error into a one-line actionable message.
function briefLlmError(err: unknown): string {
  const e = err as { message?: string; toString(): string } | null | undefined;
  const msg: string = (e?.message || e?.toString() || '').toLowerCase();
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid') && msg.includes('key') || msg.includes('incorrect api key')) {
    return 'Key rejected — check it\'s correct and hasn\'t expired';
  }
  if (msg.includes('403') || msg.includes('forbidden')) {
    return 'Access denied — your key may not have permission for this model';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    return 'Rate limited or quota exceeded — try again shortly';
  }
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist'))) {
    return 'Model not found — switch to a supported model in LLM settings';
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
    return 'Timed out — provider may be slow or unreachable';
  }
  // Fallback: first sentence or first 80 chars of the original message
  const raw: string = (e?.message || '').trim();
  const sentence = raw.split(/[.\n]/)[0].trim();
  return sentence.slice(0, 80) || 'Request failed';
}

// `hint` disambiguates keys shared by several providers — SEARCH_API_KEY holds
// a Tavily OR a Brave key depending on the selected search provider, and the
// admin UI tests the key before saving, so the saved setting can't be trusted
// mid-edit. The UI passes the provider it's editing; absent a hint we fall
// back to the saved provider, then Tavily (the original sole owner of the key).
//
// Probe budget: OpenAI's Responses API (the default path for
// createOpenAI()(model)) rejects max_output_tokens below 16 — a smaller test
// budget fails key validation with "integer below minimum value" and blocks
// saving the key entirely. 32 clears the floor on every provider.
async function probeKey(
  key: (typeof SECRET_ENV_KEYS)[number],
  value: string,
  hint?: string,
): Promise<{ ok: boolean; message: string }> {
  const cfg = settings.get().llm || {};
  const activeModel = (provider: string) =>
    cfg.provider === provider ? (cfg.model || '') : '';

  switch (key) {
    case 'ANTHROPIC_API_KEY': {
      try {
        const model = activeModel('anthropic') || 'claude-haiku-4-5-20251001';
        const m = createAnthropic({ apiKey: value })(model);
        await generateText({ model: m, prompt: 'Reply with the single word OK.', maxOutputTokens: 32, abortSignal: AbortSignal.timeout(15000) });
        return { ok: true, message: `✓ Anthropic key valid · model responded` };
      } catch (err) { return { ok: false, message: briefLlmError(err) }; }
    }
    case 'OPENAI_API_KEY': {
      try {
        const model = activeModel('openai') || 'gpt-4o-mini';
        const m = createOpenAI({ apiKey: value })(model);
        await generateText({ model: m, prompt: 'Reply with the single word OK.', maxOutputTokens: 32, abortSignal: AbortSignal.timeout(15000) });
        return { ok: true, message: `✓ OpenAI key valid · model responded` };
      } catch (err) { return { ok: false, message: briefLlmError(err) }; }
    }
    case 'GOOGLE_GENERATIVE_AI_API_KEY': {
      try {
        const model = activeModel('google') || 'gemini-1.5-flash';
        const m = createGoogleGenerativeAI({ apiKey: value })(model);
        await generateText({ model: m, prompt: 'Reply with the single word OK.', maxOutputTokens: 32, abortSignal: AbortSignal.timeout(15000) });
        return { ok: true, message: `✓ Google key valid · model responded` };
      } catch (err) { return { ok: false, message: briefLlmError(err) }; }
    }
    case 'DEEPSEEK_API_KEY': {
      try {
        const model = activeModel('deepseek') || 'deepseek-chat';
        const m = createDeepSeek({ apiKey: value })(model);
        await generateText({ model: m, prompt: 'Reply with the single word OK.', maxOutputTokens: 32, abortSignal: AbortSignal.timeout(15000) });
        return { ok: true, message: `✓ DeepSeek key valid · model responded` };
      } catch (err) { return { ok: false, message: briefLlmError(err) }; }
    }
    case 'OPENROUTER_API_KEY': {
      try {
        const model = activeModel('openrouter') || 'openai/gpt-4o-mini';
        const m = createOpenRouter({ apiKey: value, headers: llmProvider.OPENROUTER_APP_HEADERS })(model);
        await generateText({ model: m, prompt: 'Reply with the single word OK.', maxOutputTokens: 32, abortSignal: AbortSignal.timeout(15000) });
        return { ok: true, message: `✓ OpenRouter key valid · model responded` };
      } catch (err) { return { ok: false, message: briefLlmError(err) }; }
    }
    case 'AI_GATEWAY_API_KEY': {
      return { ok: true, message: 'Key format looks valid — confirm via a live LLM call' };
    }
    case 'ELEVENLABS_API_KEY': {
      const r = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': value },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { detail?: { message?: string } | string };
        const msg = typeof j?.detail === 'string' ? j.detail : j?.detail?.message || '';
        return { ok: false, message: r.status === 401 ? 'Key rejected — check it\'s correct and active' : (msg || `Request failed (${r.status})`) };
      }
      const u = await r.json() as { first_name?: string };
      return { ok: true, message: `✓ ElevenLabs key valid${u.first_name ? ` · account: ${u.first_name}` : ''}` };
    }
    case 'SEARCH_API_KEY': {
      const provider = hint || settings.get().search?.provider || 'tavily';
      if (provider === 'brave') {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', 'test');
        url.searchParams.set('count', '1');
        const r = await fetch(url, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': value },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) {
          // Brave signals a bad token as 422 SUBSCRIPTION_TOKEN_INVALID
          // (verified live), not 401/403 — check the error code too.
          const j = await r.json().catch(() => ({})) as { error?: { code?: string } };
          const rejected = r.status === 401 || r.status === 403
            || j?.error?.code === 'SUBSCRIPTION_TOKEN_INVALID';
          return { ok: false, message: rejected ? 'Key rejected — check it\'s correct and active' : `Request failed (${r.status})` };
        }
        return { ok: true, message: '✓ Brave Search key valid' };
      }
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value}` },
        body: JSON.stringify({ query: 'test', max_results: 1 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        return { ok: false, message: r.status === 401 || r.status === 403 ? 'Key rejected — check it\'s correct and active' : `Request failed (${r.status})` };
      }
      return { ok: true, message: '✓ Tavily key valid' };
    }
    case 'EMBEDDING_API_KEY': {
      const embCfg = settings.get().embedding || {};
      const r = await probeEmbeddingConfig({
        provider: embCfg.provider || undefined,
        model: embCfg.model || undefined,
        baseUrl: embCfg.baseUrl || undefined,
        ollamaUrl: embCfg.ollamaUrl || undefined,
        apiKey: value,
      });
      return {
        ok: r.code === 'ok',
        message: r.code === 'ok'
          ? `✓ Embeddings working${r.dim ? ` (${r.dim}-dim)` : ''}`
          : r.message,
      };
    }
    case 'LASTFM_API_KEY': {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Radiohead&api_key=${encodeURIComponent(value)}&format=json`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const j = await r.json().catch(() => null) as { error?: number; message?: string } | null;
      if (!r.ok || j?.error) {
        return { ok: false, message: j?.error === 10 ? 'Invalid API key — check your Last.fm developer credentials' : (j?.message || `Request failed (${r.status})`) };
      }
      return { ok: true, message: '✓ Last.fm API key valid' };
    }
    case 'LISTENBRAINZ_USER_TOKEN': {
      const r = await fetch(`${listenbrainzApiBase()}/validate-token`, {
        headers: { Authorization: `Token ${value}` },
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json().catch(() => ({})) as { valid?: boolean; user_name?: string; message?: string };
      if (!j.valid) {
        return { ok: false, message: 'Token not valid — check your ListenBrainz user token' };
      }
      return { ok: true, message: `✓ ListenBrainz token valid${j.user_name ? ` · user: ${j.user_name}` : ''}` };
    }
    default:
      return { ok: false, message: `No probe defined for ${key}` };
  }
}

// ---------------------------------------------------------------------------
// POST /settings/secrets/test — probe a key against its provider WITHOUT
// saving. Body: { key: string, value: string, provider?: string } — provider
// disambiguates shared keys (SEARCH_API_KEY → tavily | brave). Always 200s with
// { ok, message, latencyMs } — a bad key is a normal, actionable answer.
// ---------------------------------------------------------------------------
router.post('/settings/secrets/test', requireAdmin, async (req, res) => {
  const { key, value, provider } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ ok: false, message: 'key is required', latencyMs: 0 });
  }
  if (!(SECRET_ENV_KEYS as readonly string[]).includes(key)) {
    return res.status(400).json({ ok: false, message: `Unknown key: ${key}`, latencyMs: 0 });
  }
  let targetValue = typeof value === 'string' ? value.trim() : '';
  if (!targetValue) {
    // If no value provided, check if key is already set in the environment
    const envValue = (process.env[key] || '').trim();
    if (!envValue) {
      return res.status(400).json({ ok: false, message: 'value is required when key is not set in environment', latencyMs: 0 });
    }
    targetValue = envValue;
  }
  const t0 = Date.now();
  try {
    const result = await probeKey(
      key as (typeof SECRET_ENV_KEYS)[number],
      targetValue,
      typeof provider === 'string' ? provider : undefined,
    );
    res.json({ ok: result.ok, message: result.message, latencyMs: Date.now() - t0 });
  } catch (err: unknown) {
    res.json({ ok: false, message: (err as { message?: string })?.message || 'probe failed', latencyMs: Date.now() - t0 });
  }
});

// ---------------------------------------------------------------------------
// POST /settings/llm/discover — probe a locca / openai-compatible server for
// liveness + its loaded model list, so the onboarding wizard and admin
// Settings UI can auto-fill the model field with no hand-typing. Non-mutating.
// `?baseUrl=` overrides; default is the locca host URL (host.docker.internal:8080).
// Always 200s with { reachable, models, baseUrl } — an unreachable server is a
// normal answer, not an error.
// ---------------------------------------------------------------------------
router.post('/settings/llm/discover', requireAdmin, async (req, res) => {
  const baseUrl =
    String(req.body?.baseUrl || '').trim().replace(/\/+$/, '') ||
    llmProvider.DEFAULT_LOCCA_BASE_URL;
  try {
    const r = await fetchWithTimeout(`${baseUrl}/models`, { timeoutMs: 3000, bodyDeadline: true });
    if (!r.ok) {
      return res.json({ reachable: false, models: [], baseUrl, error: `HTTP ${r.status}` });
    }
    const data = (await r.json()) as { data?: unknown };
    const models = Array.isArray(data?.data)
      ? (data.data as { id?: unknown }[]).map((m) => m?.id).filter((id): id is string => typeof id === 'string')
      : [];
    res.json({ reachable: true, models, baseUrl });
  } catch (err: unknown) {
    res.json({ reachable: false, models: [], baseUrl, error: (err as { message?: string })?.message || 'unreachable' });
  }
});

router.get('/settings/llm/discover', requireAdmin, (_req, res) => {
  res.status(405).json({
    reachable: false,
    models: [],
    baseUrl: '',
    error: 'Direct model discovery requires POST',
  });
});

type LlmLegIdentity = 'primary' | 'fallback' | 'onboarding';

function normalizedProviderEndpoint(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function savedProviderEndpoints(provider: string): Set<string> {
  const state = settings.get();
  const endpoints = new Set<string>();
  for (const leg of [state.llm, state.llm?.fallback]) {
    const mapped = normalizedProviderEndpoint(leg?.providerBaseUrls?.[provider]);
    if (mapped) endpoints.add(mapped);
    if (leg?.provider === provider) {
      const active = normalizedProviderEndpoint(leg.baseUrl);
      if (active) endpoints.add(active);
    }
  }
  // Locca's blank saved URL resolves to this fixed built-in endpoint.
  if (provider === 'locca') endpoints.add(llmProvider.DEFAULT_LOCCA_BASE_URL);
  return endpoints;
}

function llmLegIdentity(value: unknown): LlmLegIdentity {
  const leg = String(value || 'primary');
  if (leg === 'primary' || leg === 'fallback' || leg === 'onboarding') return leg;
  throw new Error('leg must be primary, fallback, or onboarding');
}

async function resolveLiteLlmRouteConfig(input: {
  leg: LlmLegIdentity;
  baseUrl?: unknown;
  apiKey?: unknown;
}) {
  await settings.load();
  const s = settings.get();
  const savedLeg = input.leg === 'primary'
    ? s.llm
    : input.leg === 'fallback'
      ? s.llm?.fallback
      : undefined;
  const savedIsLiteLlm = savedLeg?.provider === 'litellm';
  const suppliedBaseUrl = normalizedProviderEndpoint(input.baseUrl);
  const suppliedApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const savedBaseUrl = normalizedProviderEndpoint(
    savedLeg?.providerBaseUrls?.litellm || (savedIsLiteLlm ? savedLeg?.baseUrl : ''),
  );
  const environmentBaseUrl = effectiveLiteLlmBaseUrl({});
  const baseUrl = suppliedBaseUrl || savedBaseUrl || environmentBaseUrl;
  let apiKey = suppliedApiKey;
  if (!apiKey && savedProviderEndpoints('litellm').has(baseUrl)) {
    apiKey = settings.llmKeyFor('litellm');
  }
  if (!apiKey && baseUrl === environmentBaseUrl) {
    apiKey = effectiveLiteLlmApiKey({});
  }
  return {
    baseUrl,
    apiKey,
  };
}

// Owner-aware model discovery. POST keeps unsaved URLs/tokens out of browser,
// proxy, and server query logs. The owner selects runtime credential precedence
// and the chat leg selects the primary/fallback credential boundary.
router.post('/settings/llm/models', requireAdmin, async (req, res) => {
  const owner = String(req.body?.owner || '').trim() as ModelOwner;
  const provider = String(req.body?.provider || '').trim();
  if (!['chat', 'embedding', 'tts'].includes(owner)) {
    return res.status(400).json({ ok: false, models: [], provider, error: 'owner must be chat, embedding, or tts' });
  }
  if (!provider) {
    return res.status(400).json({ ok: false, models: [], provider, error: 'provider is required' });
  }
  let leg: ChatLeg | undefined;
  if (owner === 'chat') {
    try {
      leg = llmLegIdentity(req.body?.leg);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        models: [],
        provider,
        error: (error as Error).message,
      });
    }
  }
  try {
    const result = await discoverModels({
      owner,
      provider,
      leg,
      baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : '',
      ollamaUrl: typeof req.body?.ollamaUrl === 'string' ? req.body.ollamaUrl : '',
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : '',
    });
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    res.json({
      ok: false,
      models: [],
      provider,
      error: (err as { message?: string })?.message || 'discovery failed',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /settings/llm/probe-compat — live probe for an openai-compatible key.
// Body: { apiKey: string, baseUrl: string, model: string }
// Always 200s with { ok, message, latencyMs }. The key is NOT saved.
// ---------------------------------------------------------------------------
router.post('/settings/llm/probe-compat', requireAdmin, async (req, res) => {
  const { apiKey, baseUrl, model, provider } = req.body || {};
  const submittedProvider = typeof provider === 'string' ? provider.trim() : '';
  const hasSubmittedLeg = Object.prototype.hasOwnProperty.call(req.body || {}, 'leg');
  const compatibleProviders = new Set(['openai-compatible', 'locca', 'litellm']);
  if (submittedProvider && !compatibleProviders.has(submittedProvider)) {
    return res.status(400).json({ ok: false, message: 'provider must be openai-compatible, locca, or litellm', latencyMs: 0 });
  }
  if (!submittedProvider && hasSubmittedLeg) {
    return res.status(400).json({ ok: false, message: 'provider is required when leg is supplied', latencyMs: 0 });
  }
  const isLiteLlm = submittedProvider === 'litellm';
  if (!isLiteLlm && (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.trim())) {
    return res.status(400).json({ ok: false, message: 'baseUrl is required', latencyMs: 0 });
  }
  if (!model || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ ok: false, message: 'model is required', latencyMs: 0 });
  }
  const t0 = Date.now();
  try {
    let resolvedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
    let resolvedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (isLiteLlm) {
      const cfg = await resolveLiteLlmRouteConfig({
        leg: llmLegIdentity(req.body?.leg),
        baseUrl,
        apiKey,
      });
      resolvedBaseUrl = cfg.baseUrl;
      resolvedApiKey = cfg.apiKey;
      if (!resolvedBaseUrl) {
        return res.status(400).json({ ok: false, message: 'baseUrl is required', latencyMs: 0 });
      }
    } else if (!resolvedApiKey) {
      await settings.load();
      if (submittedProvider) {
        // Provider-scoped keys may be reused across legs, but only at an exact
        // saved endpoint (or Locca's fixed built-in endpoint).
        resolvedApiKey = savedProviderEndpoints(submittedProvider).has(resolvedBaseUrl)
          ? settings.llmKeyFor(submittedProvider)
          : '';
      } else {
        // Backward compatibility for pre-provider/pre-leg clients only:
        // identify an exact saved leg by URL, then use that leg's provider key.
        const s = settings.get();
        const savedLeg = [s.llm, s.llm?.fallback].find((leg) =>
          !!resolvedBaseUrl
          && resolvedBaseUrl === normalizedProviderEndpoint(leg?.baseUrl));
        resolvedApiKey = savedLeg
          ? settings.llmKeyFor(savedLeg.provider || 'openai-compatible')
          : '';
      }
    }

    const m = createOpenAI({
      apiKey: resolvedApiKey || 'no-key',
      baseURL: resolvedBaseUrl,
    }).chat(model.trim());
    await generateText({
      model: m,
      prompt: 'Reply with the single word OK.',
      maxOutputTokens: 32,
      abortSignal: AbortSignal.timeout(15000),
    });
    res.json({ ok: true, message: '✓ Bearer token accepted · model responded', latencyMs: Date.now() - t0 });
  } catch (err: unknown) {
    res.json({ ok: false, message: briefLlmError(err), latencyMs: Date.now() - t0 });
  }
});

// Discovery is POST-only: URL/key form values must never enter access logs.
router.get('/settings/llm/models', requireAdmin, (_req, res) => {
  res.status(405).json({
    ok: false,
    models: [],
    provider: '',
    error: 'Model discovery requires POST with an explicit credential owner',
  });
});

// ---------------------------------------------------------------------------
// POST /settings/embedding/probe — test whether the configured (or supplied)
// embedding endpoint can actually produce embeddings, surfacing the result
// in the admin UI BEFORE a long tagging run instead of failing mid-job.
// Optional body overrides (provider/model/baseUrl/ollamaUrl/apiKey) test the
// unsaved form values; omitted fields fall back to saved settings.embedding →
// llm. POST body rather than query params so the bearer token never rides a
// URL that reverse-proxy access logs capture — same shape as
// /settings/llm/probe-compat.
// Always 200s with { ok, dim, code, message } — a chat-model / unreachable
// server is a normal, actionable answer, not an error.
// ---------------------------------------------------------------------------
router.post('/settings/embedding/probe', requireAdmin, async (req, res) => {
  const overrides: Record<string, string> = {};
  for (const k of ['provider', 'model', 'baseUrl', 'ollamaUrl', 'apiKey']) {
    const v = (req.body || {})[k];
    if (typeof v === 'string' && v.trim()) overrides[k] = v.trim();
  }
  try {
    const r = await probeEmbeddingConfig(overrides);
    let message = r.message;
    // Test-only reassurance: a not-yet-pulled Ollama model isn't a real failure —
    // the tagger auto-pulls it on the next run (ensureReady → tryOllamaPull). We
    // add this only here, NOT in the shared actionableMessage, because the tagger
    // reuses that same message only AFTER an auto-pull has already failed.
    if (r.code === 'not_found' && r.provider === 'ollama') {
      message += '\n  You can ignore this — the tagger pulls this model automatically when you start a run.';
    }
    res.json({ ok: r.code === 'ok', dim: r.dim ?? null, code: r.code, message });
  } catch (err: unknown) {
    res.json({ ok: false, dim: null, code: 'unknown', message: (err as { message?: string })?.message || 'probe failed' });
  }
});
