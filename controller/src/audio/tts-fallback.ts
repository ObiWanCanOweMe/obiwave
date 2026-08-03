// Expressive engines render square-bracket directions; fallback engines speak
// them literally. Keep the primary text untouched and sanitize only its rescue.
export function fallbackTextFor(requested: string, cloudCueFamily: string | null, text: string): string {
  const expressiveRequest = requested === 'chatterbox'
    || cloudCueFamily === 'fish-s21'
    || cloudCueFamily === 'elevenlabs-v3';
  if (!expressiveRequest || !text) return text;
  return text.replace(/\s*\[[^\]\r\n]{1,80}\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// Pure ordering logic for speak()'s runtime rescue chain — extracted from
// tts.ts so scripts/tts-fallback.test.ts can pin it without dragging in the
// engine modules (settings reads, venv existsSyncs, live /health probes).
//
// Order: the operator's configured default engine first (their explicit second
// choice), then Piper (the universal local floor), then Kokoro (for the case
// where Piper itself was the failed primary). The primary, duplicates, and
// anything the caller's `usable` gate rejects are dropped — so the chain never
// re-attempts the engine that just threw, and never attempts one the
// pre-flight gate already knows can't speak.
export function orderedFallbacks(
  primary: string,
  defaultEngine: string | null | undefined,
  usable: (engine: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const engine of [defaultEngine, 'piper', 'kokoro']) {
    if (!engine || engine === primary || out.includes(engine)) continue;
    if (!usable(engine)) continue;
    out.push(engine);
  }
  return out;
}
