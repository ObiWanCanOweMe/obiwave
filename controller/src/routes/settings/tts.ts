// Voice preview and the voice catalogue for the on-air engines.
// Part of the settings/ route split - see ../settings.ts.

import express from 'express';
import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import * as settings from '../../settings.js';
import * as tts from '../../audio/tts.js';
import * as speech from '../../llm/speech.js';
import { requireAdmin } from '../../middleware/auth.js';

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
      speed: typeof body.speed === 'number' ? body.speed : undefined,
      lang: typeof body.lang === 'string' ? body.lang : undefined,
      language: typeof body.language === 'string' ? body.language : undefined,
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
