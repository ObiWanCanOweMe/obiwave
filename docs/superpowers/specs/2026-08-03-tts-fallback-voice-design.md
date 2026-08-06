# Operator-configurable TTS fallback voice

Date: 2026-08-03

## Problem

TTS already rescues itself when an engine fails, but the rescue is hardcoded and
voiceless. `audio/tts.ts` resolves an engine two ways:

- **Pre-flight** (`resolveEngine`): a persona's engine that fails the
  availability/key gate is rerouted to `settings.tts.defaultEngine`, else `piper`.
- **Mid-render** (`fallbackChain` → `tts-fallback.orderedFallbacks`): a primary
  that throws walks `defaultEngine` → `piper` → `kokoro`.

Both paths choose an **engine only**. The rescue deliberately passes
`personaTts: null` into `speakWith()`, so whichever engine catches the segment
speaks with its global (or baked-in) default voice. The operator has no way to
say "if my ElevenLabs persona dies, speak with *this* Kokoro voice."

`settings.llm.fallback` already gives exactly this control on the LLM side — an
enable toggle plus a fully configured second leg. This brings TTS to parity.

## Scope

- **Station-level**, one fallback: engine + voice (+ cloud provider), with an
  enable toggle. Not per-persona.
- Applies to **both** triggers — the pre-flight reroute and the mid-render rescue
  — so there is one answer to "what speaks instead", not two.
- The existing `piper` → `kokoro` local floor stays **behind** the configured
  fallback. A misconfigured fallback must never produce a silent segment.

Out of scope (deliberate, revisit only on request): per-kind fallbacks (a
different rescue for jingles vs links); any `remote`-engine voice handling beyond
today's free-text passthrough, since the sidecar owns its own defaults.

## Settings

New block `settings.tts.fallback`, a sibling of `defaultEngine`:

```jsonc
{
  "enabled": false,          // default off
  "engine": "piper",         // one of TTS_ENGINES
  "voice": "",               // engine-interpreted, same rules as a persona voice
  "cloudProvider": "openai"  // only meaningful when engine === 'cloud'
}
```

This is the **same `{engine, voice, cloudProvider}` triple a persona's `tts`
block already uses**. `validateTtsBlock()` (`settings/validate.ts`) and
`normalizeTts()` (`settings/normalize.ts`) are currently module-private; both get
exported and reused verbatim so the per-engine voice rules (`KOKORO_VOICE_RE`,
`PIPER_VOICE_RE`, `POCKET_TTS_VOICE_RE`, `CHATTERBOX_VOICE_RE`, cloud length
bounds) live in exactly one place. No fourth copy.

`fallback` absent, or `enabled: false`, must leave behaviour **byte-for-byte
identical** to today — the same upgrade-safety rule `tts.enabled` follows.

Validation on `update()`: the block is validated by `validateTtsBlock` under the
path label `tts.fallback`, so error messages read
`tts.fallback.voice must match ...`. There is no cross-field requirement
equivalent to the LLM's "openai-compatible needs baseUrl": a cloud fallback whose
provider has no key simply fails `engineUsable()` and is skipped at rescue time,
which is the correct degradation.

## Resolution

`audio/tts-fallback.ts` stops trafficking in engine strings and returns slots:

```ts
export interface RescueSlot {
  engine: string;
  // Synthetic persona-shaped override handed to speakWith(); null for the
  // hardcoded rungs.
  personaTts: { engine: string; voice: string; cloudProvider: string } | null;
}

export function orderedFallbacks(
  primary: string,
  fallback: RescueSlot | null,       // the configured slot, or null when disabled
  defaultEngine: string | null | undefined,
  usable: (engine: string, cloudProvider?: string | null) => boolean,
): RescueSlot[]
```

Order: **configured fallback → defaultEngine → piper → kokoro**. Unchanged
filtering rules: drop the primary, drop duplicates, drop anything `usable()`
rejects. Dedup is **by engine, first-wins**, so when the configured fallback and
`defaultEngine` name the same engine the configured slot survives and its voice
is what speaks.

Only the configured rung carries a `personaTts`. The hardcoded rungs keep
`personaTts: null`, preserving the existing invariant documented in `tts.ts`: a
`cloud` rescue must use the **station default's** credentials, not the persona
provider that just failed. The configured rung supersedes that only because it is
the operator's explicit instruction.

`usable()` is called with the slot's **own** cloudProvider for the configured
rung and `null` for the hardcoded rungs, keeping probe and call in agreement —
the same rule `fallbackChain()` follows today.

`speakWith()` needs no change: a slot's `personaTts` is exactly the synthetic
persona shape `synthesizeSample()` already feeds it, and `speakWith`'s per-engine
branches only read it when `personaTts.engine === engine`, which the slot
guarantees.

### Pre-flight

`resolveEngine()` returns a `RescueSlot` instead of a string. When the chosen
engine fails `engineUsable()`, it returns the configured fallback slot (when
enabled and usable, probed with the fallback's own cloudProvider), else today's
`defaultEngine || piper` as a `personaTts: null` slot.

Callers read `.engine` off the slot:

- `voiceGainDb` — engine gain from the resolved engine; the persona's own trim
  still composes, matching today's behaviour for any resolved engine.
- `speechPaceScale` — same.
- `speak` — passes `slot.personaTts ?? personaTts` to `speakWith()`, so a
  fallback reroute speaks with the fallback voice while an ordinary resolve keeps
  the persona's.
- `describeRouting` — reports the resolved engine and voice.

## Surfaces

- **Admin UI**: a "Fallback voice" block in Settings → TTS, directly under the
  default-engine picker, gated by an on/off `Seg` mirroring the LLM fallback's.
  Contents: the shared `EngineSelector` radio grid, the engine-appropriate
  `VoicePicker`, and a `VoicePreviewButton` so the operator can audition the
  rescue before saving.
- **Component extraction**: the engine + voice pair — the per-engine voice-list
  construction and the engine-change voice normalization — is extracted from
  `PersonaVoiceCard.tsx` into a shared `web/components/admin/tts/EngineVoiceFields.tsx`
  and consumed by both `PersonaVoiceCard` and the new fallback block. That logic
  is already duplicated between `PersonaVoiceCard` and `TtsSection`; this change
  would otherwise make a third copy. `TtsSection`'s existing per-engine **station
  config** panels (kokoro lang, cloud model/keys, gain sliders) are *not* touched
  — they carry more than voice and are out of scope.
- **`/debug`**: `describeRouting()` gains
  `fallback: { enabled, engine, voice, provider, usable }` so the operator can see
  the configured rescue without waiting for a segment to fail.
- **Stats**: no change. `recordTts()` already records `requested` vs `engine` plus
  `fellBack`, which is the whole story.

## Testing

`controller/scripts/tts-fallback.test.ts` extends to pin the new ordering. The
module stays pure, so no engine modules are dragged in.

1. Configured fallback is ordered first, ahead of `defaultEngine`.
2. Its voice survives dedup when `defaultEngine` names the same engine
   (first-wins by engine).
3. `enabled: false` (slot `null`) reproduces today's exact order, with every rung
   carrying `personaTts: null`.
4. A configured fallback rejected by `usable()` is dropped, and the chain falls
   through to `defaultEngine` → `piper` → `kokoro`.
5. A configured fallback equal to the primary is dropped — the failed engine is
   never re-attempted.
6. Hardcoded rungs always carry `personaTts: null`.
7. `usable()` receives the configured slot's own cloudProvider and `null` for the
   hardcoded rungs.

Existing `fallbackTextFor` assertions are unaffected and stay as-is.

`npm run lint` in `controller/` and `web/` is the merge gate; `npm test` in
`controller/` is run locally before pushing.
