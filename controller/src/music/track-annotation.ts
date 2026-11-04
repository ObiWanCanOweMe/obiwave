import * as settings from '../settings.js';
import { trackEraYear } from './show-filter.js';
import { CUE_EARLY_MAX_SEC, CUE_LATE_MAX_SEC } from './cue-landing.js';
import { songGenres, escAnnotate } from './subsonic.js';
import type { Track } from '../broadcast/queue/types.js';

export type AnnotationOptions = { maxDurationSec?: number | null; cueOutSec?: number | null; cueInSec?: number | null; resolveProbeId?: string | null; clipLeadSec?: number | null; clipCueLateSec?: number | null; localPath?: string | null };
export function annotateTrackUri(song: Track, target: string, opts: AnnotationOptions = {}) {
  const fields = [
    `title="${escAnnotate(song.title)}"`,
    `artist="${escAnnotate(song.artist)}"`,
    `album="${escAnnotate(song.album)}"`,
    `subsonic_id="${escAnnotate(song.id)}"`,
  ];
  // Era year, never the raw `year` (#1418) — a reissue anthology carries the
  // reissue's date and every downstream surface inherits it. Unknown emits NO
  // year field rather than a wrong one.
  const eraYear = trackEraYear(song as unknown as Parameters<typeof trackEraYear>[0]);
  if (eraYear) fields.push(`year="${escAnnotate(eraYear)}"`);
  const genres = songGenres({ genre: song.genre, genres: song.genres });
  if (genres.length) fields.push(`genre="${escAnnotate(genres.join(', '))}"`);
  // Per-transition crossfade length (seconds). radio.liq runs cross with
  // persist_override=true, so a stamp LINGERS until the next one arrives —
  // every annotated track must carry an explicit value (falling back to the
  // configured crossfade) or a washout's 12s canvas outlives its transition.
  const crossSec = song.crossSec ?? settings.get()?.crossfadeDuration ?? null;
  if (crossSec != null) fields.push(`liq_cross_duration="${escAnnotate(crossSec)}"`);
  // The outgoing side of a stem-blend clip seam: how far its cue-out sits past
  // the clip's start (broadcast/stem-seam.ts). radio.liq buffers past it and
  // aligns the clip on it; an older mixer ignores the key.
  if (opts.clipLeadSec != null) fields.push(`liq_clip_lead="${escAnnotate(opts.clipLeadSec)}"`);
  // The incoming side of a stem-blend clip seam: how late Y's liq_cue_in will
  // really land, negative when early (music/cue-landing.ts, #2003, #2077).
  // radio.liq shifts Y by it at the clip -> Y seam only. Six decimals, NOT ms:
  // rounding to ms would bring back up to 22 samples of the comb filter this
  // removes. Bounded like the reader.
  if (opts.clipCueLateSec != null && Number.isFinite(opts.clipCueLateSec) && opts.clipCueLateSec !== 0
    && opts.clipCueLateSec > -CUE_EARLY_MAX_SEC && opts.clipCueLateSec < CUE_LATE_MAX_SEC) {
    fields.push(`liq_clip_cue_late="${opts.clipCueLateSec.toFixed(6)}"`);
  }
  // Per-track loudness gain offset, in the "<n> dB" form Liquidsoap's amplify
  // override parses. Applied before the ducking layers. Absent = unity.
  if (song.gainDb != null) fields.push(`liq_amplify="${escAnnotate(song.gainDb)} dB"`);
  // Transition gestures. sweep/dissolve/blend/chop ride the INCOMING pick and
  // act on the outgoing branch across the cross; washout/loop ride the ENDING
  // track and govern its own end. Absent = normal cross.
  if (song.sweep) fields.push('liq_sweep="true"');
  if (song.dissolve) fields.push('liq_dissolve="true"');
  if (song.washout) fields.push('liq_washout="true"');
  if (song.washoutDelay != null) fields.push(`liq_washout_delay="${escAnnotate(song.washoutDelay)}"`);
  // liq_loop_bar is one bar of THIS track's tempo (mix.loopBarFor).
  if (song.loop) fields.push('liq_loop="true"');
  if (song.loopBar != null) fields.push(`liq_loop_bar="${escAnnotate(song.loopBar)}"`);
  // Show-boundary fade (#1574): the track is cued out at a show change, so
  // radio.liq suppresses the exit gestures stamped for an ending that will not
  // happen (washout, loop) and leaves a plain full-buffer fade.
  if (song.showFade) fields.push('liq_show_fade="true"');
  if (song.blend) fields.push('liq_blend="true"');
  // The chop gate period is one beat of the OUTGOING track, stamped here
  // because the predecessor's own annotation has already been sent.
  if (song.chop) fields.push('liq_chop="true"');
  if (song.chopPeriod != null) fields.push(`liq_chop_period="${escAnnotate(song.chopPeriod)}"`);
  // Hard track-length cap (#447): a positive cap stamps `liq_cue_out` and
  // Liquidsoap stops the track there (cues apply at request resolution). Only
  // the capped paths set it (autonomous picks + auto.m3u); listener requests
  // pass null and play in full. Callers pass the cap only for a track that runs past it
  // (track-floor.capCueOutSec): a cue_out past the end is NOT a no-op when the
  // decoder cannot measure the stream, it defeats the crossfade. An explicit cueOutSec (a
  // stem blend's start in the OUTGOING track) competes with the cap and the
  // earlier cut wins, so a blend can't resurrect audio past the cap. cueInSec
  // skips the INCOMING track past the head its rendered clip already played.
  const cueOut = [opts.maxDurationSec, opts.cueOutSec]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (cueOut.length) {
    fields.push(`liq_cue_out="${escAnnotate(Math.min(...cueOut))}"`);
  }
  if (opts.cueInSec != null && opts.cueInSec > 0) {
    fields.push(`liq_cue_in="${escAnnotate(opts.cueInSec)}"`);
  }
  return `annotate:${fields.join(',')}:${target}`;
}
