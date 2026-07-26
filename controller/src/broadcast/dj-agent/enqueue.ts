// Turning an agent's chosen song into a queued track: the field projection the
// model sees, trimming a link back to an intro, and the enqueue itself.
//
// Part of the dj-agent/ split - see ../dj-agent.ts for the pick/request runs.

import * as settings from '../../settings.js';
import * as session from '../session.js';
import * as subsonic from '../../music/subsonic.js';
import * as dj from '../../llm/dj.js';
import { stripThinking } from '../../llm/sdk.js';
import { recordPick } from '../../llm/log.js';
import { speechPaceScale } from '../../audio/tts.js';
import { normalizeForSpeech } from '../../audio/speech-text.js';
import { introMsOf } from './runs.js';

export function trackFields(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    year: song.year,
    // All genre tags, comma-joined — the slim projection already carries the
    // joined string in `genre` (songGenres passes it through unchanged), raw
    // Subsonic children get their multi-value array flattened here.
    genre: subsonic.songGenres(song).join(', ') || null,
    // Seconds. The queue needs it to spot picks that will hit the
    // max-track-length cap (its liq_cue_out) so it can auto-arm a washout on
    // the forced mid-song exit — see applyMixTransition. Field name varies by
    // source: Subsonic `duration`, the picker tools' slim projection (what the
    // agent's `seen` map stores) `duration_sec`, library rows `durationSec`.
    duration: song.duration ?? song.duration_sec ?? song.durationSec ?? null,
    // ReplayGain rides raw Subsonic songs (pool picks) but not the slim
    // projection agent picks resolve from — stays undefined there, which
    // tells queue.applyLoudnessGain to recover it with a getSong lookup.
    replayGain: song.replayGain,
  };
}

// Talk-within-the-intro budget (#962), applied to a between-track link in DJ
// mode: trim to the pick's measured intro runway so the DJ lands before the
// vocals — sentence/clause-complete or dropped (null), never a fragment.
// Enforced on the SPOKEN form of the line: tts.speak() later runs
// normalizeForSpeech(stripThinking(...)), which can EXPAND display symbols
// into extra words ("$5 million" → "5 million dollars"), so counting the raw
// text under-budgets the line that actually airs. The normalized text is what
// gets aired/queued — speak()'s own normalize pass is a no-op on it.
// speechPaceScale('link') maps the word ceiling to the rate the line will be
// spoken at (engine × persona × daypart). Returns the text unchanged when not
// in DJ mode; enforceIntroBudget itself no-ops on an un-analysed pick.
export function trimLinkToIntro(text: string | null | undefined, song: any): string | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  if (!settings.getEffectivePersona()?.djMode) return raw;
  // Same corrections as speak() so the word count matches the aired text.
  // firstVocalMsFor arms the never-talk-over-a-singer drop: a MEASURED vocal
  // entry under 2.5s drops the line outright (the <2500 leniency only exists
  // because the energy heuristic is noise down there).
  const spoken = normalizeForSpeech(stripThinking(raw), settings.get().tts?.corrections);
  return dj.enforceIntroBudget(spoken, introMsOf(song), speechPaceScale('link'), dj.firstVocalMsFor(song)) || null;
}

// `link`, when present, is the between-track line to speak as this pick starts
// playing. It's attached to the queued item so the queue airs it at the
// transition INTO this track (queue.airIntro), not over whatever is currently
// on-air when the pick is made — which is one track earlier (issue #189).
// Returns the queue position, or -1 when push()'s dedup guard dropped the pick
// because that track is already queued/on-air. On a drop we skip the ai-pick log
// AND the durable picks-log record so neither reports a phantom pick that never
// aired (push() has already logged the dedup-skip). Callers fall back on -1
// (agent → pool → auto.m3u) instead of recording a session turn for a no-op.
// `linkPrev` is the track the link back-announces (the one on-air when the pick
// was made); the queue uses it to drop the link if a request jumps ahead and it
// would otherwise air a stale "that was X" over the wrong transition.
export async function enqueuePick(
  queue, song, reason, source,
  link: string | null = null,
  linkPrev: any = null,
  { sweep = false, washout = false, blend = false, dissolve = false, chop = false, loop = false }: { sweep?: boolean; washout?: boolean; blend?: boolean; dissolve?: boolean; chop?: boolean; loop?: boolean } = {},
): Promise<number> {
  // Single chokepoint for the intro budget: every pick path (agent, pool, any
  // future producer) funnels its link through here, so enforcement can't be
  // skipped by a new caller. Idempotent — callers that already trimmed (the
  // agent path does, to record the aired text in its session turn) pass
  // through unchanged.
  const introLink = trimLinkToIntro(link, song);
  const track: any = trackFields(song);
  // Flag the transition effects on this pick (DJ mode only). getAnnotatedUri
  // stamps liq_sweep / liq_washout / liq_dissolve / liq_chop; radio.liq ramps
  // them. sweep muffles the crossfade INTO this pick; dissolve melts the
  // PREVIOUS track into ambience under this pick; chop cuts the PREVIOUS
  // track out on the beat under this pick; washout rings this track out into
  // an echo tail as it ENDS.
  if (sweep) track.sweep = true;
  if (washout) track.washout = true;
  if (blend) track.blend = true;
  if (dissolve) track.dissolve = true;
  if (chop) track.chop = true;
  if (loop) track.loop = true;
  const pos = await queue.push({
    track,
    requestedBy: null,
    intent: reason || 'ai pick',
    introScript: introLink,
    introKind: 'link',
    // Pin the voice to whoever wrote the line — the render (drainToLiquidsoap)
    // and the air (airIntro) both happen later and used to re-resolve it.
    introPersona: session.onAirPersona(),
    aiPicked: true,
    linkPrev,
  });
  if (pos === -2) {
    // Never-play blocklist refused the pick — library-db-sourced candidates
    // can slip past the subsonic filter. Same "didn't queue" signal as dedup;
    // the caller's normal no-pick handling covers it.
    queue.log('ai-pick', `${song.title} — ${song.artist} refused (never-play blocklist)`, { reason, source });
    return -1;
  }
  if (pos === -1) return -1;
  queue.log('ai-pick', `${song.title} — ${song.artist}`, { reason, source });
  recordPick({ song, reason, source });
  return pos;
}
