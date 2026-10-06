// Voice preview and the voice catalogue for the on-air engines.
// Part of the settings/ route split - see ../settings.ts.

import express from 'express';
import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import * as settings from '../../settings.js';
import * as tts from '../../audio/tts.js';
import * as speech from '../../llm/speech.js';
import { requireAdmin } from '../../middleware/auth.js';
import { ensureFacets, listLibraryVoices } from '../../audio/gemini-library.js';

// Mounted onto the parent settings router in ../settings.ts.
export const router = express.Router();

// Auditions an EXPLICIT engine + voice, not the on-air persona. `corrections`,
// `voiceSettings` and `fishSettings` are UNSAVED overrides for this call only
// (#696); synthesizeSample sanitizes and clamps them like settings.update() does.
// A synth failure returns 422 rather than falling back to Piper, so the operator
// sees why. The temp file is unlinked once sent.
router.post('/settings/tts/preview', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const engine = typeof body.engine === 'string' ? body.engine : '';
  if (!engine || !tts.ENGINES.includes(engine)) {
    return res.status(400).json({ ok: false, message: `Unknown engine: ${engine || '(none)'}` });
  }
  // Carry a client disconnect into the provider call so a discarded preview does
  // not continue as invisible metered synthesis. `close` also fires after a
  // normal send, where writableEnded makes the abort a no-op.
  const previewAbort = new AbortController();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) previewAbort.abort();
  };
  res.once('close', abortOnDisconnect);
  let filePath: string | null = null;
  try {
    filePath = await tts.synthesizeSample({
      engine,
      voice: typeof body.voice === 'string' ? body.voice : '',
      cloudProvider: typeof body.cloudProvider === 'string' ? body.cloudProvider : 'openai',
      cloudModel: typeof body.cloudModel === 'string' ? body.cloudModel : undefined,
      // The UNSAVED Gemini model, so "Play sample" auditions the dropdown choice
      // rather than the saved station model.
      geminiModel: typeof body.geminiModel === 'string' ? body.geminiModel : undefined,
      speed: typeof body.speed === 'number' ? body.speed : undefined,
      lang: typeof body.lang === 'string' ? body.lang : undefined,
      language: typeof body.language === 'string' ? body.language : undefined,
      voiceStyle: typeof body.voiceStyle === 'string' ? body.voiceStyle : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      corrections: Array.isArray(body.corrections) ? body.corrections : undefined,
      voiceSettings: (body.voiceSettings && typeof body.voiceSettings === 'object')
        ? body.voiceSettings
        : undefined,
      fishSettings: (body.fishSettings && typeof body.fishSettings === 'object')
        ? body.fishSettings
        : undefined,
      signal: previewAbort.signal,
    });
    const buf = await readFile(filePath);
    // Local engines render WAV, cloud renders MP3; take the MIME from the file.
    res.type(extname(filePath) || '.wav').send(buf);
  } catch (err: unknown) {
    if (!previewAbort.signal.aborted && !res.destroyed) {
      res.status(422).json({ ok: false, message: (err as { message?: string })?.message || 'Preview synthesis failed' });
    }
  } finally {
    res.off('close', abortOnDisconnect);
    if (filePath) unlink(filePath).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /settings/tts/voices — discover the voices a cloud TTS provider offers,
// so persona + station-default voice fields can be a dropdown instead of a
// free-text box the operator fills from memory. The TTS twin of
// /settings/llm/models.
//
// Discoverable providers: `openai-compatible` probes conventional endpoints,
// while `elevenlabs` and `fish-audio` query their managed account catalogues.
// This matters for cloned/custom voices that can never be hardcoded.
// `openai` publishes no list endpoint; its curated UI list is already complete.
//
// Unsaved `baseUrl` and `apiKey` values ride only in the POST body. A stored
// compatible bearer is usable only with its exact saved origin; an explicit
// body key wins for a changed/unsaved origin.
//
// Always 200s with { ok, voices, provider, error? } — an unreachable server is
// a normal answer, and the UI falls back to the free-text input.
// ---------------------------------------------------------------------------
router.post('/settings/tts/voices', requireAdmin, async (req, res) => {
  const provider = String(req.body?.provider || '').trim();
  if (!provider) {
    return res.json({ ok: false, voices: [], provider: '', error: 'provider is required' });
  }
  const suppliedBaseUrl = String(req.body?.baseUrl || '').trim().replace(/\/+$/, '');
  const explicitApiKey = String(req.body?.apiKey || '').trim();

  // The Gemini Extended Voice Library is a DIFFERENT catalogue from the four
  // cloud providers above: ~2,000 prebuilt voices with their own ids
  // (`en-us-varo`), their own metadata (accent, gender, pitch, persona) and
  // their own pagination. It is branched here rather than pushed into
  // voice-catalog.ts because it is not a Subclass-style provider API — the
  // Google key is never on the query, and the filters are its own vocabulary.
  if (provider === 'gemini') {
    await settings.load();
    // The station's saved browser default, read here rather than in the client
    // so the setting is honoured by every caller (persona card and station
    // panel alike) instead of each surface re-implementing the precedence.
    const gemini = (settings.get().tts as any)?.gemini || {};
    const q = (k: string) => String(req.body?.[k] ?? '').trim();
    // Three-way: an explicit tag wins, the literal `any` means "override the
    // saved default with no filter", and an absent body field falls back to
    // the setting. Written as branches rather than `||` because 'any' is
    // TRUTHY — a `||` chain would send it to Google as a language tag and get
    // an empty page back, which looks like "this station has no voices".
    const langParam = q('language');
    const language = langParam
      ? (langParam === 'any' ? '' : langParam)
      : (gemini.libraryLanguage || '');
    const page = await listLibraryVoices({
      language,
      gender: q('gender') || undefined,
      pitch: q('pitch') || undefined,
      accent: q('accent') || undefined,
      context: q('context') || undefined,
      search: q('search') || undefined,
      pageSize: Number(req.body?.pageSize) || undefined,
      pageToken: q('pageToken') || undefined,
    });
    // The filter MENU is a vocabulary, so it comes from the whole catalogue and
    // not from the page being paged through. Served from the boot prewarm's
    // walk; `ensureFacets` fills it if boot ran without a key or before this
    // feature existed. `ready: false` tells the UI to fall back to deriving
    // options from the rows it does have rather than showing empty menus.
    const facets = await ensureFacets();
    return res.json({
      ok: page.ok,
      // The library's richer rows, so the picker can show accent/gender/pitch
      // instead of a bare id. `id` is the value that goes on the wire.
      voices: page.voices.map(v => ({
        id: v.id,
        label: v.name,
        language: v.language,
        accent: v.accent,
        gender: v.gender,
        pitch: v.pitch,
        persona: v.persona,
        description: v.description,
      })),
      facets: {
        languages: facets.languages,
        accents: facets.accents,
        genders: facets.genders,
        pitches: facets.pitches,
        contexts: facets.contexts,
        ready: facets.ready,
      },
      nextPageToken: page.nextPageToken,
      applied: page.applied,
      error: page.ok ? undefined : page.message,
      provider,
    });
  }

  await settings.load();
  const cloud = settings.get().tts?.cloud || {};
  const savedBaseUrl = provider === cloud.provider
    ? String(cloud.baseUrl || '').trim().replace(/\/+$/, '')
    : '';
  const storedCredentialIsBound =
    provider === cloud.provider
    && (!suppliedBaseUrl || (!!savedBaseUrl && suppliedBaseUrl === savedBaseUrl));
  const storedCompatKey = cloud.compatApiKey
    || (cloud.provider === 'openai-compatible' ? cloud.apiKey : '');
  const apiKey = explicitApiKey || (
    provider === 'openai-compatible'
      ? storedCredentialIsBound
        ? speech.resolveCloudApiKey({ provider, apiKey: storedCompatKey })
        : ''
      : speech.resolveCloudApiKey({ provider })
  );

  // Backstop only: listVoices' own 10s/8s budgets should fire first so the caller
  // gets a real reason instead of a bare abort.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const result = await speech.listVoices({
      provider,
      // Persona cards omit the URL and safely reuse the saved provider origin.
      baseUrl: suppliedBaseUrl || savedBaseUrl,
      apiKey,
      signal: ctrl.signal,
    });
    res.json({ ...result, provider });
  } finally {
    clearTimeout(timer);
  }
});

router.get('/settings/tts/voices', requireAdmin, (_req, res) => {
  res.status(405).json({
    ok: false,
    voices: [],
    provider: '',
    error: 'Voice discovery requires POST',
  });
});
