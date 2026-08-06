// AI SDK tool library — music-discovery tools the picker agent calls to
// explore the library before choosing the next track.
//
// Each tool returns a slim song list ({ id, title, artist, album, year,
// genre } plus editorial tags — moods, energy, duration_sec, instrumental —
// and measured acoustics when analysed) so the model has stable ids to
// reference and enough signal to reason about flow. `buildPickerTools`
// returns a `seen` Map that accumulates every song any tool surfaced, so the
// picker can resolve the agent's chosen id back to a full track object.

import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../music/subsonic.js';
import * as library from '../../../music/library.js';
import * as embeddings from '../../../music/embeddings.js';
import * as analyzer from '../../../music/analyzer.js';
import { filterPickerCandidates, durationSeconds } from '../../../music/recency.js';
import { applyStrictLocks, type VocalMode } from '../../../music/show-filter.js';
import { shuffle } from '../../../util/shuffle.js';
import { SEED_NOT_A_PICK_CLAUSE } from '../../../util/pick-seed.js';
import { searchWeb, searchReady } from '../../../skills/web-search.js';
import { identifyTrackFromText } from '../prompts/request.js';

function slim(s: any) {
  const base = {
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album || null,
    year: s.year || null,
    // Every genre tag, comma-joined ("Hip-Hop, Rap") — one compact field the
    // model reads as-is, whether the source is a raw Subsonic child (genres
    // [{name}] + scalar) or a library slimTrack row (genres string[]).
    genre: subsonic.songGenres(s).join(', ') || null,
  };
  // Surface the editorial tags + measured acoustic facts when known — merged
  // per field from the song itself (library sources, via slimTrack) and a
  // library lookup (Subsonic sources). The lookup always runs: Subsonic songs
  // are raw Navidrome children that never carry moods/energy/pace, and their
  // ID3-derived `bpm: 0` used to pass an all-or-nothing "carries analysis?"
  // guard here and skip the lookup entirely, blanking every field for that
  // song (#862). Measured acoustics prefer the analyzer's number (library
  // record) over the file's ID3 tag. Each field is omitted when absent so the
  // agent only ever sees real values. `moods`/`energy` are the station's
  // tagging vocabulary; `instrumental` is derived from vocalRanges; `pace`
  // (0..1 perceptual energy) and `sections` (structural-part count over the
  // opening) feed FLOW reasoning per PICKER_CRITERIA in llm/dj.ts.
  const rec = s.id ? library.get(s.id) : null;
  const moods = Array.isArray(s.moods) && s.moods.length ? s.moods : (rec?.moods ?? []);
  const energy = s.energy ?? rec?.energy ?? null;
  // Length reads from whichever field the raw candidate carries (Subsonic
  // `duration`, library `durationSec`), so it's present even for an un-tagged
  // Subsonic track whose library lookup came back empty.
  const durationSec = durationSeconds(s) ?? durationSeconds(rec);
  // vocalRanges: [] = no vocal regions (instrumental), null/undefined = not
  // computed (unknown — omit rather than guess "has vocals").
  const vocalRanges = Array.isArray(s.vocalRanges) ? s.vocalRanges : rec?.vocalRanges;
  const instrumental = Array.isArray(vocalRanges) ? vocalRanges.length === 0 : null;
  // realBpm: a non-positive bpm means unknown — never emitted, never allowed
  // to mask the analyzed value.
  const bpm = library.realBpm(rec?.bpm) ?? library.realBpm(s.bpm);
  const key = rec?.musicalKey ?? s.musicalKey ?? null;
  const introMs = rec?.introMs ?? s.introMs ?? null;
  const pace = rec?.paceMean ?? s.paceMean ?? null;
  const sections = library.sectionCount(rec) ?? library.sectionCount(s);
  return {
    ...base,
    ...(moods.length ? { moods } : {}),
    ...(energy != null ? { energy } : {}),
    ...(durationSec != null ? { duration_sec: durationSec } : {}),
    ...(instrumental != null ? { instrumental } : {}),
    ...(bpm != null ? { bpm } : {}),
    ...(key != null ? { key } : {}),
    ...(introMs != null ? { intro_ms: introMs } : {}),
    ...(pace != null ? { pace } : {}),
    ...(sections != null ? { sections } : {}),
  };
}

// Navidrome (and library.songsByMood) return results in deterministic order:
// `tracksByMood("night")` always returns the same first N of 89 night-tagged
// songs; `topSongsByArtist("Karan Aujla")` always returns the same top-N by
// play count. With `cap=8` the agent sees the same handful no matter how many
// times it asks. Shuffling here turns each call into a fresh sample — the same
// fix `music/picker.js` already applies at pool-build time.

// Builds a fresh tool set scoped to one pick. `recentIds`/`recentKeys`
// (recently-played track ids + "title|artist" keys) are filtered out inside
// every tool so the agent never has to be told "avoid these" — it simply can't
// see them. We deliberately do NOT filter by recent *artist*: the similarity
// tools (similarSongs, tracksTowardJourney, tracks*LikeThis) return tracks
// clustered around what's currently playing — i.e. the just-played artist's
// neighbours — so an artist-recency strip gutted them to ~1 result while the
// 12h track guard already prevents literal repeats (issue: thin picker pools on
// niche catalogues). Track-recency alone is enough here; back-to-back artist
// variety is enforced downstream at the point of choice, in
// dj-agent.pickViaAgent (re-pick off the on-air artist when possible, #1124),
// so the tools can keep surfacing same-artist neighbours for the model to weigh.
export function buildPickerTools({
  recentIds = new Set<string>(),
  recentKeys = new Set<string>(),
  hardRecentIds = new Set<string>(),
  hardRecentKeys = new Set<string>(),
  audioWaypoint = null,
  resolveReferences = false,
  genreLock = null,
  eraLock = null,
  moodLock = null,
  energyLock = null,
  vocalLock = null,
  playlistLock = null,
  playlistTracks = null,
  excludedIds = null,
}: {
  recentIds?: Set<string>;
  recentKeys?: Set<string>;        // lowercased "title|artist" — backfilled entries lack ids
  // Count-based HARD no-repeat set (last N distinct plays). Non-relaxable — a
  // track in here is filtered out of every tool's results and survives the
  // starvation cascade, so the agent literally cannot re-pick a just-played
  // song even when a thin similarity cluster is all it can see. Populated from
  // queue.recentlyPlayedByCount(N); empty on the request path (requests exempt).
  hardRecentIds?: Set<string>;
  hardRecentKeys?: Set<string>;    // lowercased "title|artist" — blocks id-less backfilled plays
  // Hard genre constraint for a strict show (show.filtersStrict) — a list of
  // genres, any-of (#929). When set, every tool's candidates are genre-filtered
  // (onlyGenre — HARD, no per-tool never-starve; see the collect() note) before
  // recency + cap, so the agent path enforces the lock in code, not just the
  // prompt. null/empty = no lock. Deliberately NOT set on the request path: an
  // explicit listener ask wins.
  genreLock?: string[] | null;
  // Hard era constraint — a list of decade/year windows, any-of (#929) —
  // applied only for a strict show (same filtersStrict flag — one toggle
  // governs every filter). When set, candidates are year-filtered (inYearRange
  // — HARD, unknown-year tracks drop) before recency + cap. null/empty = no lock.
  eraLock?: { fromYear?: number | null; toYear?: number | null }[] | null;
  // Hard mood constraint for a strict show — any-of list: candidates are
  // filtered to tracks tagged with any of the show's moods (onlyMood — HARD).
  // null/empty = no lock.
  moodLock?: string[] | null;
  // Hard energy-band constraint for a strict show — any-of list: candidates
  // are filtered to the analysed bands (onlyEnergy — HARD, unknowns dropped).
  energyLock?: string[] | null;
  vocalLock?: VocalMode | null;
  // The active sonic journey's current waypoint vector (broadcast/dj-agent.ts).
  // When present, the tracksTowardJourney tool below is registered, closing
  // over it — the agent never sees the raw vector, only the tracks near it.
  audioWaypoint?: number[] | null;
  // Request path only (djAgentRequest): registers identifyRequestedTrack, which
  // resolves a DESCRIBED track via web search and matches it to the LOCAL
  // library. No-op unless a web-search provider is ready (searchReady()). Never
  // set on the per-track picker — see the gating note on the tool below.
  resolveReferences?: boolean;
  // Hard playlist constraint for a strict playlist-anchored show. The id set is
  // the union of the show's pinned Navidrome playlists; when set, every tool's
  // candidates are intersected with it (HARD — no never-starve to off-playlist,
  // unlike genreLock, because a playlist is an exact set and the showPlaylistTracks
  // tool below is the guaranteed in-set source). So the agent's `seen` map only
  // ever holds playlist tracks — it cannot return an off-playlist id. null = no lock.
  // Deliberately NOT set on the request path: an explicit listener ask wins.
  playlistLock?: Set<string> | null;
  // The show's playlist union tracks. Registers the showPlaylistTracks tool —
  // the agent's window into the operator's curation. Set in BOTH strict (with
  // playlistLock) and soft (no lock, just a strong prompt preference) modes.
  playlistTracks?: any[] | null;
  // Track ids from the show's excluded playlists (blocklist). Any track whose
  // id is in this set is dropped from every tool's results so the agent never
  // sees — and can never pick — a blocklisted track. null = no exclusions.
  excludedIds?: Set<string> | null;
} = {}) {
  const seen = new Map<string, any>(); // id → slim song, accumulated across all tool calls

  // Filter recents, slim, and record into `seen` so the picker can resolve
  // the agent's final id choice to a full track. Drops only recently-played
  // tracks (by id/key) and tracks already surfaced this pick; artists are NOT
  // filtered (see buildPickerTools note). cap=8 keeps per-tool input tokens
  // lower for the picker agent — see picker-latency notes in dj-agent.js. The
  // seen map still accumulates across the whole loop, so the agent's id space
  // grows with each tool call regardless.
  const collect = (list: any, cap = 8) => {
    // Strict show: filter candidates BEFORE recency + cap, so the 8 the agent
    // sees are genre-/era-/mood-/energy-pure. Each lock is HARD (starve:true) —
    // a tool whose results contain no match contributes nothing (emptyResult
    // steers the model to another tool), mirroring playlistLock below. The old
    // per-tool never-starve passed a tool's ENTIRE unfiltered result through on
    // zero matches; the similarity tools cluster on the (possibly off-filter)
    // current track, so strict shows leaked off-filter picks constantly.
    // Dead-air is still guarded at wider scopes: a run with zero candidates
    // fails into the pool picker (which never-starves on its final pool), and
    // behind that the auto.m3u coast. The locks are pre-resolved + coverage-
    // gated in pickViaAgent (genres → library tags, mood/energy dropped when the
    // library has no such tags) so an un-analysed library can't starve every
    // tool for the whole show.
    let pool = applyStrictLocks(shuffle((list || []) as any[]), {
      genres: genreLock, eras: eraLock, moods: moodLock, energies: energyLock, vocals: vocalLock,
    }, { starve: true });
    // Strict playlist: HARD-intersect with the lock set, with NO never-starve to
    // off-playlist (a playlist is an exact set, so a tool with no overlap simply
    // contributes nothing). The guaranteed in-set source is showPlaylistTracks
    // below, so `seen` is normally non-empty and the agent's pick is in-playlist
    // — unless the blocklist below drops it too (see next).
    if (playlistLock) pool = pool.filter((s: any) => s?.id && playlistLock.has(s.id));
    // Excluded playlists (blocklist): hard-drop tracks from any blocklisted
    // playlist, AFTER the playlist lock so it overrides the anchor (this runs on
    // every source, showPlaylistTracks included). No never-starve: if a show
    // excludes its whole pool `seen` can end up empty and the LLM pick is
    // skipped — the auto.m3u coast (scheduler.ts) is the dead-air backstop.
    if (excludedIds) pool = pool.filter((s: any) => s?.id && !excludedIds.has(s.id));
    const accepted = filterPickerCandidates(pool, {
      recentIds,
      recentKeys,
      hardRecentIds,
      hardRecentKeys,
      seenIds: new Set(seen.keys()),
      cap,
    });
    const out: any[] = [];
    for (const s of accepted) {
      const slimmed = slim(s);
      seen.set(s.id, slimmed);
      out.push(slimmed);
    }
    return out;
  };

  // When a tool comes up empty, say WHY and what to try next instead of a bare
  // [] — the observed fabrication pattern is "tool returned nothing → model
  // invents a plausible-looking id anyway" (7 of gpt-5-mini's 32 picks in one
  // day). `matched` is the pre-recency-filter count, so the note distinguishes
  // "nothing matches" from "matches exist but were all played recently or
  // already shown this pick" — opposite next moves for the model.
  // A strict lock is anything that can drop a candidate the source DID return:
  // the music filters, the playlist intersection, and the blocklist. Any of
  // them makes "matches exist but were filtered" a real cause the note should
  // name, not just recency (steering the model to its other results this round
  // — there is no second discovery step to retry in; see COMMIT_AFTER_STEPS).
  const hasStrictLock = !!(genreLock?.length || eraLock?.length || moodLock?.length || energyLock?.length || vocalLock || playlistLock || excludedIds);
  // The seed clause rides HERE as well as on the schema field (#1247): this is
  // the message sitting in the model's context at the exact moment it fails, and
  // "never invent a song id" is literally satisfied by echoing the on-air id
  // from the event message — a real id, just not one a tool returned. Shared
  // wording from util/pick-seed.ts.
  const emptyResult = (matched: number, hint: string) => ({
    tracks: [],
    note: matched > 0
      ? `${matched} matching track(s) exist but were all played recently, already shown this pick${hasStrictLock ? ', or outside this show\'s strict filters' : ''} — ${hint}`
      : hint,
    rule: `Never invent a song id — only ids returned by a tool are valid picks. ${SEED_NOT_A_PICK_CLAUSE}`,
  });

  // Snapshot the embedding index counts once at tool-build time (synchronous
  // after library.load() — pickViaAgent awaits library.load() before reaching
  // buildPickerTools, so stats() never returns its empty-sentinel zeros here).
  // Tools whose backing index is empty are conditionally registered below:
  // offering a dead tool steers the model into a ~75 s timeout before the
  // pool-fallback rescues it (the "DJ Latency 75s" spike, 18% pick failure).
  const _stats = library.stats();
  const hasTextEmbeddings  = (_stats.withEmbedding      ?? 0) > 0;
  const hasAudioEmbeddings = (_stats.withAudioEmbedding ?? 0) > 0;
  const hasEmbeddingProvider = embeddings.isAvailable();

  // Seed-similarity with a cross-index rescue (#1247).
  //
  // A seed tool that comes back empty is far more expensive than a slow one: the
  // agent harness allows exactly ONE discovery call (COMMIT_AFTER_STEPS = 1,
  // llm/internal/strategy/agent.ts) and then pins activeTools to `done`, so an
  // empty result leaves the model cornered with nothing to commit — and the only
  // real, well-formed track id anywhere in its context is the on-air seed it was
  // handed to pass in here. Both salvage stages in pickViaAgent then no-op on an
  // empty `seen` (nearestId has no keys to match, repickFromSeen returns null on
  // its first line), so the whole run is discarded to the pool picker.
  //
  // Both indexes answer the same question ("tracks like this seed"), and each is
  // registered on whether it holds ANY vectors — never on whether it covers THIS
  // seed. Coverage is routinely partial and uneven (CLAP analysis backfills over
  // days; the text index needs the tagger to have reached the track), so the
  // seed falling in the other index's gap is ordinary, not exceptional. When the
  // index the model reached for doesn't cover the seed, answer from the other one
  // and SAY so, rather than handing back a result that can only end the run.
  //
  // Deliberately gated on the primary index returning NOTHING AT ALL (matched
  // === 0 — the seed has no vector there). A primary that DID match but whose
  // hits were all filtered by recency keeps today's emptyResult: that note
  // ("N exist but were all played recently") steers the model correctly and is a
  // different situation from a dead index.
  const seedSimilarity = (songId: string, primary: 'audio' | 'text') => {
    const K = 60;
    const audioFirst = primary === 'audio';
    const lookup = (which: 'audio' | 'text') =>
      which === 'audio' ? library.tracksLikeThisAudio(songId, K) : library.tracksLikeThis(songId, K);
    const list = lookup(primary);
    if (list.length) return { tracks: collect(list), matched: list.length, fellBack: false };
    const other = audioFirst ? 'text' : 'audio';
    const otherIndexed = audioFirst ? hasTextEmbeddings : hasAudioEmbeddings;
    if (otherIndexed) {
      const alt = lookup(other);
      if (alt.length) {
        const rescued = collect(alt);
        // Only report the rescue if something SURVIVED the recency/lock
        // filters. Reporting the raw alt count with empty tracks would render
        // emptyResult's matched>0 message — "N exist but were all played
        // recently" — about hits from an index the model never asked, glued to
        // a "no embedding yet" hint about the one it did: two contradictory
        // clauses. Falling through to matched 0 keeps the coherent hint, whose
        // "try similarSongs / tracksByMood" steer is right here anyway.
        if (rescued.length) return { tracks: rescued, matched: alt.length, fellBack: true };
      }
    }
    return { tracks: [] as any[], matched: 0, fellBack: false };
  };

  const tools = {
    searchLibrary: tool({
      description: 'Search the music library. Matches a literal artist name, song title, or real genre (e.g. "jazz", "punjabi") first; if nothing matches it falls back to semantic / vibe search, so descriptive multi-word queries like "punjabi r&b romantic" also work. Returns matching songs.',
      inputSchema: z.object({
        query: z.string().describe('an artist name, song title, genre, or vibe'),
      }),
      execute: async ({ query }) => {
        try {
          let songs = await subsonic.search(query, { songCount: 25 });
          // A lexical miss is often just a spelling/transliteration variance —
          // resolve the query as an artist and retry with the library's actual
          // spelling ("Sikandar Kahlon" → the tagged "Sikander Kahlon").
          if (songs.length === 0) {
            const artist = await subsonic.resolveArtist(query);
            if (artist) songs = await subsonic.search(artist.name, { songCount: 25 });
          }
          const out = collect(songs);
          if (out.length > 0) return out;
          // Lexical search3 found nothing — fall back to semantic embedding
          // search over the library (same path as searchByLyrics) so vibe
          // queries still return tracks. No-op when embeddings aren't set up.
          if (embeddings.isAvailable()) {
            await library.load();
            const vec = await embeddings.embedQueryText(query.trim(), library.embeddingIndexTextMode());
            if (vec) {
              const sem = collect(library.tracksByVector(vec, 20));
              if (sem.length > 0) return sem;
            }
          }
          return emptyResult(songs.length, 'this search matches literal titles/artists/genres first and the vibe index found nothing — choose from your other tool results this round');
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    similarSongs: tool({
      description: 'Find songs similar to a given song id. Pass the currently-playing song id to keep the flow going.',
      inputSchema: z.object({ songId: z.string() }),
      execute: async ({ songId }) => {
        try {
          const list = await subsonic.getSimilarSongs(songId, { count: 20 });
          const out = collect(list);
          return out.length ? out : emptyResult(list.length, 'no similarity data for that track — choose from your other tool results this round');
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    topSongsByArtist: tool({
      description: 'Top songs for a named artist — good for staying in an artist\'s orbit without repeating a track.',
      inputSchema: z.object({ artist: z.string() }),
      execute: async ({ artist }) => {
        try {
          const list = await subsonic.getTopSongs(artist, { count: 15 });
          const out = collect(list);
          return out.length ? out : emptyResult(list.length, 'no top-songs data for that artist — choose from your other tool results this round');
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    recentByArtist: tool({
      description: 'A named artist\'s NEWEST releases in the library, latest first. Use this (not topSongsByArtist, which ranks by popularity) for "latest"/"newest"/"most recent" asks. Returns [] when the artist isn\'t in the library. Note: "latest in the library" — bounded by what has been added, not the artist\'s globally-newest release, so never present a result on air as their newest song outright.',
      inputSchema: z.object({ artist: z.string() }),
      execute: async ({ artist }) => {
        // Keep the source list tight (newest ~6 tracks): collect() shuffles, so
        // a wide pool would let the shuffle drop the actual-newest tracks,
        // defeating "latest".
        try {
          const list = await subsonic.getRecentSongsByArtist(artist, { albums: 2, count: 6 });
          const out = collect(list);
          return out.length ? out : emptyResult(list.length, 'that artist has no releases in the library — choose from your other tool results this round');
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    songsByGenre: tool({
      description: 'Songs from a library genre tag, fuzzy-matched ("turkish" finds "Turkish Pop"). Use for language/country/style asks — "play something Turkish" — that searchLibrary cannot reach: genre lives in tags, not titles.',
      inputSchema: z.object({ genre: z.string().describe('a genre, language, or country word, e.g. "jazz", "turkish", "punjabi"') }),
      execute: async ({ genre }) => {
        try {
          const name = await subsonic.resolveGenreName(genre);
          if (!name) return { error: `no library genre matching "${genre}"` };
          const list = await subsonic.getSongsByGenre(name, { count: 50 });
          const out = collect(list);
          return out.length ? out : emptyResult(list.length, `the "${name}" genre has nothing fresh right now — choose from your other tool results this round`);
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    tracksByMood: tool({
      description: 'Songs tagged with a mood: energetic, calm, reflective, celebratory, romantic, spiritual, focus, workout, driving, cooking, rainy, sunny, night, morning, evening, festival, cultural. Optionally constrain by energy level (low|medium|high).',
      inputSchema: z.object({
        mood: z.string(),
        // nullable (not optional): under AI SDK v7's `tool()` an optional field
        // makes the Zod object's input/output types diverge, collapsing the
        // schema generic to `never`. nullable keeps the key required-but-`| null`
        // (symmetric), which the model fills with null to skip the filter — the
        // `if (energy)` guard below already treats null as "no filter".
        energy: z.enum(['low', 'medium', 'high']).nullable()
          .describe('Optional energy filter — narrows the result to that tempo/intensity band. Pass null for no filter.'),
      }),
      execute: async ({ mood, energy }) => {
        try {
          await library.load();
          const moodRows = library.songsByMood(mood);
          const rows = energy ? moodRows.filter((r: any) => r.energy === energy) : moodRows;
          const out = collect(rows);
          if (out.length) return out;
          // Empty for three distinct reasons — tell the model which, so a
          // tag-coverage gap never reads as an empty library (observed:
          // {mood:"night", energy:"low"} → bare [] → fabricated id).
          if (energy && moodRows.length > 0 && rows.length === 0) {
            return emptyResult(0, `${moodRows.length} "${mood}" track(s) exist but none tagged ${energy} energy — the energy filter is what emptied this; choose from your other tool results this round`);
          }
          if (moodRows.length === 0) {
            const covered = Object.keys(library.stats().byMood || {}).join(', ');
            return emptyResult(0, covered
              ? `no tracks tagged "${mood}" — moods with coverage in this library: ${covered}`
              : `no tracks tagged "${mood}"`);
          }
          return emptyResult(rows.length, 'choose from your other tool results this round');
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    tracksByEnergy: tool({
      description: 'Songs tagged with an energy level: low (slow/mellow), medium (mid-tempo), high (uptempo/driving). For time-of-day or activity picks — high for a workout, low for a wind-down.',
      inputSchema: z.object({ energy: z.enum(['low', 'medium', 'high']) }),
      execute: async ({ energy }) => {
        try {
          await library.load();
          const list = library.songsByEnergy(energy);
          const out = collect(list);
          return out.length ? out : emptyResult(list.length, `no ${energy}-energy tracks available — choose from your other tool results this round`);
        }
        catch (err) { return { error: err.message }; }
      },
    }),

    // Only registered when the controller's own text/mood embedding index has
    // been built (withEmbedding > 0). This tool does KNN over the seed track's
    // STORED vector (library.tracksLikeThis -> db.knnById) and never calls the
    // embedding provider at query time, so it works whenever the index exists —
    // mirroring how tracksThatSoundLikeThis gates on hasAudioEmbeddings. Without
    // an index every call returns [], and the old description said "Prefer this
    // to similarSongs", actively steering the model into a dead tool — so gate it
    // off entirely rather than offer an unusable option.
    ...(hasTextEmbeddings ? {
      tracksLikeThis: tool({
        description: 'Tracks whose mood + lyrics + metadata embed closest to a seed track — the library\'s own semantic similarity. Pass the currently-playing song id (best) OR a track title.',
        // No k input: the agent reliably picked a small k (10–20), and the
        // nearest neighbours cluster tightly + many are recently-played, so that
        // left ~1 survivor after recency filtering. Pull a wide fixed KNN (60)
        // internally — collect() still caps to 8 fresh ones. Mirrors the journey
        // tool, which also takes no args.
        inputSchema: z.object({
          songId: z.string().describe('a song id (preferred) or a track title'),
        }),
        execute: async ({ songId }) => {
          try {
            await library.load();
            const { tracks, matched, fellBack } = seedSimilarity(songId, 'text');
            if (tracks.length) {
              // Say which index answered. Without this the model reads audio
              // neighbours as mood/lyric matches and reasons about them on the
              // wrong axis — the same mislabelling #1246 reports in the other
              // direction.
              return fellBack
                ? { tracks, note: 'that track has no mood/lyric embedding yet, so these come from the SOUND index instead — they match the seed\'s timbre and production, not its tags or words' }
                : tracks;
            }
            return emptyResult(matched,
              `that track has no embedding yet (${_stats.withEmbedding ?? 0} of ${_stats.total} tracks indexed so far) — choose from your other tool results this round`);
          }
          catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),

    // Only registered when the CLAP audio embedding index has been built
    // (withAudioEmbedding > 0). Without audio vectors every call returns [] —
    // gate it off so the model is never offered an option it cannot use.
    ...(hasAudioEmbeddings ? {
      tracksThatSoundLikeThis: tool({
        description: 'Tracks whose ACTUAL SOUND (timbre, instrumentation, production, energy) is closest to a seed track — blind to tags and metadata, so it shines for instrumentals and non-English tracks. Pass the currently-playing song id (best) OR a track title.',
        // No k input: the agent reliably picked a small k (10–20), and audio
        // neighbours cluster tightly + many are recently-played, so that left ~1
        // survivor after recency filtering. Pull a wide fixed KNN (60) internally
        // — collect() still caps to 8 fresh ones. Mirrors the journey tool, which
        // also takes no args.
        inputSchema: z.object({
          songId: z.string().describe('a song id (preferred) or a track title'),
        }),
        execute: async ({ songId }) => {
          try {
            await library.load();
            const { tracks, matched, fellBack } = seedSimilarity(songId, 'audio');
            if (tracks.length) {
              return fellBack
                ? { tracks, note: `the seed has no audio fingerprint yet (audio analysis covers ${_stats.withAudioEmbedding ?? 0} of ${_stats.total} tracks so far), so these come from the mood/lyric index instead — they match the seed's tags and words, not its sound` }
                : tracks;
            }
            return emptyResult(matched,
              `the seed track likely has no audio vector yet (audio analysis covers ${_stats.withAudioEmbedding ?? 0} of ${_stats.total} tracks so far) — choose from your other tool results this round`);
          }
          catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),

    // Only registered when both the text embedding index (withEmbedding > 0)
    // AND a text-embedding provider are available. Every code path inside
    // requires both: embed the query, then KNN over stored track vectors.
    // Without them the tool errors or returns nothing — hide it so the model
    // uses searchLibrary (lexical) or similarSongs instead.
    ...(hasTextEmbeddings && hasEmbeddingProvider ? {
      searchByLyrics: tool({
        description: 'Semantic lyric / theme search over the library — for thematic picks the mood vocab can\'t express, e.g. "songs about hometown", "tracks with hopeful lyrics", "feeling stuck".',
        // No k input: the agent reliably picked a small k, and recency filtering
        // then thins it further. Pull a wide fixed KNN (60) internally —
        // collect() still caps to 8 fresh ones. Mirrors the seed-similarity tools.
        inputSchema: z.object({
          query: z.string().min(3),
        }),
        execute: async ({ query }) => {
          try {
            if (!embeddings.isAvailable()) return { error: 'embeddings not configured — set settings.embedding.enabled / provider' };
            await library.load();
            const vec = await embeddings.embedQueryText(query.trim(), library.embeddingIndexTextMode());
            if (!vec) return { error: 'embedding query failed' };
            const list = library.tracksByVector(vec, 60);
            const out = collect(list);
            return out.length ? out : emptyResult(list.length, 'no thematic match in the lyric index — choose from your other tool results this round');
          }
          catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),

    // Only registered when the audio index exists AND the analysis backend can
    // embed text through the CLAP text tower (heavy analyzer; lean builds and
    // pre-text-tower sidecars report false). CLAP text and audio vectors share
    // one space, so a described SOUND maps straight onto the stored track
    // vectors — no per-track metadata involved. null capability (not yet
    // probed / local venv) keeps the tool on; execute degrades cleanly.
    ...(hasAudioEmbeddings && analyzer.textEmbeddingAvailable() !== false ? {
      searchBySound: tool({
        description: 'Describe a SOUND in words and get tracks whose actual audio matches — e.g. "dusty late-night jazz with brushed drums", "warm acoustic fingerpicking". For timbre/instrumentation/energy asks the mood vocab can\'t express; searchByLyrics matches THEMES instead.',
        // No k input, same rationale as the other similarity tools: wide fixed
        // KNN (60), collect() caps to 8 fresh ones.
        inputSchema: z.object({
          query: z.string().min(3).describe('a description of how the music should sound'),
        }),
        execute: async ({ query }) => {
          try {
            await library.load();
            // Short deadline: this runs mid-pick, and a bulk analysis pass may
            // hold the backend's single-threaded worker — better to come back
            // empty (the agent falls through to other tools) than stall the DJ.
            const vecs = await analyzer.embedTexts([query.trim()], { timeoutMs: 20_000 });
            if (!vecs || !vecs[0]) {
              return { error: 'sound search unavailable right now — use tracksByMood, searchByLyrics or similarSongs' };
            }
            const list = library.tracksByAudioVector(vecs[0], 60);
            const out = collect(list);
            return out.length ? out : emptyResult(list.length, 'nothing in the library sounds like that — choose from your other tool results this round');
          }
          catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),

    recentlyAdded: tool({
      description: 'A sample of tracks from recently-added albums — "new in the crates".',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const albums = await subsonic.getRecentlyAddedAlbums({ size: 8 });
          const out: any[] = [];
          for (const a of albums.slice(0, 5)) {
            try { out.push(...(await subsonic.getAlbum(a.id)).slice(0, 3)); } catch {}
          }
          return collect(out);
        } catch (err) { return { error: err.message }; }
      },
    }),

    starredSongs: tool({
      description: "The operator's starred / favourite songs — always a safe, on-brand pick.",
      inputSchema: z.object({}),
      execute: async () => {
        try { return collect(await subsonic.getStarred()); }
        catch (err) { return { error: err.message }; }
      },
    }),

    randomSongs: tool({
      description: 'A random sample of songs from the library — use to break a predictable run.',
      inputSchema: z.object({}),
      execute: async () => {
        try { return collect(await subsonic.getRandomSongs({ size: 18 })); }
        catch (err) { return { error: err.message }; }
      },
    }),

    // Only registered when the active show is anchored to Navidrome playlist(s).
    // Returns a sample of the operator's hand-picked tracks for this show. In a
    // STRICT playlist show this is the only source that's guaranteed to return
    // in-set tracks (every other tool is hard-intersected with the lock), so the
    // agent should lead with it; in a SOFT show it's the strongly-preferred source.
    ...(playlistTracks && playlistTracks.length ? {
      showPlaylistTracks: tool({
        description: "Tracks from the show's pinned playlist(s) — the operator's hand-picked selection for this show. Prefer these: call this first and choose from what it returns. Takes no input.",
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const out = collect(playlistTracks, 12);
            // The show's mandated source must never return a bare [] — with the
            // strict music locks also applied here, an un-tagged playlist can
            // filter to empty, and pickSystem simultaneously tells the model
            // "every pick MUST come from it". A note-less [] is the documented
            // fabrication trigger; emptyResult carries the "never invent an id"
            // rule and explains WHY (recency vs strict filters).
            if (out.length) return out;
            return emptyResult(playlistTracks.length, 'the pinned playlist tracks were all filtered out by recency or this show\'s strict music filters — choose from your other tool results this round');
          }
          catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),

    // Only registered while a sonic journey is active (the event message tells
    // the agent when that is). Closes over the journey's current waypoint, so
    // calling it returns the tracks that carry the sound one step along the
    // arc toward the destination vibe.
    ...(audioWaypoint && audioWaypoint.length && hasAudioEmbeddings ? {
      tracksTowardJourney: tool({
        description: 'Tracks nearest the active sonic journey\'s CURRENT waypoint — the station is mid-arc, drifting its sound toward a destination vibe over the next few picks. When the event says a journey is active, call this and strongly prefer one of its tracks: each one moves the sound a step along the arc. Takes no input.',
        inputSchema: z.object({}),
        execute: async () => {
          // Pull a wide KNN (60) around the waypoint: the nearest neighbours
          // cluster tightly and many will be recently-played, so a small k left
          // the agent with ~1 candidate. collect() still caps to 8 fresh ones.
          try {
            await library.load();
            const list = library.tracksByAudioVector(audioWaypoint, 60);
            const out = collect(list);
            return out.length ? out : emptyResult(list.length, 'the journey has no fresh tracks near this waypoint — pick via the library mood/genre/audio tools and keep the energy heading the same way');
          }
          catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),

    // Request path only, and only when a web-search provider is ready. Resolves a
    // listener's DESCRIPTION of a track (not a name) to songs in the LOCAL
    // library: it looks the description up on the web, identifies the most likely
    // single song, then searches Navidrome for it. Every returned candidate goes
    // through collect() like any other tool, so the chosen id is always real —
    // web text only steers which library tracks surface, never the id space.
    ...(resolveReferences && searchReady() ? {
      identifyRequestedTrack: tool({
        description: 'Use when a listener DESCRIBES a track instead of naming it, OR pastes SONG LYRICS — e.g. "the song from the new Dune movie", "the one all over TikTok", or a block of lyrics in any language. Looks the text up on the web, identifies the song, and returns matching tracks FROM THIS LIBRARY. Use this (not searchLibrary) when the request looks like lyrics — repeated phrases, verse structure, non-English text that is not an artist/title; when they name an artist or title outright, use searchLibrary. (searchByLyrics finds songs ABOUT a theme — this identifies the one specific song.) Returns { identified, candidates }: even when candidates is empty, `identified` tells you what the reference meant, so you can own the miss in your ack or choose a fitting stand-in from your other results.',
        inputSchema: z.object({
          reference: z.string().min(3).describe("the listener's description of the track, verbatim"),
        }),
        execute: async ({ reference }) => {
          try {
            const web = await searchWeb(reference); // cached 30 min
            const blob = [web.answer, ...web.results.map((r) => `${r.title}: ${r.content}`)]
              .filter(Boolean).join('\n').slice(0, 2000);
            if (!blob) return { error: 'no web result for that reference' };

            const guess = await identifyTrackFromText(reference, blob);
            if (!guess) return { error: 'could not identify a specific song from that description' };

            // Resolve LOCALLY via the same path searchLibrary uses, so every id
            // lands in `seen`. Try "artist title", then a resolved-artist retry
            // (spelling/transliteration), then title-only.
            const q = [guess.artist, guess.title].filter(Boolean).join(' ');
            let songs = await subsonic.search(q, { songCount: 25 });
            if (songs.length === 0 && guess.artist) {
              const a = await subsonic.resolveArtist(guess.artist);
              if (a) songs = await subsonic.search(`${a.name} ${guess.title}`, { songCount: 25 });
            }
            if (songs.length === 0) songs = await subsonic.search(guess.title, { songCount: 25 });
            if (songs.length === 0 && guess.keyword && guess.keyword !== guess.title) {
              songs = await subsonic.search(guess.keyword, { songCount: 25 });
            }
            return { identified: guess, candidates: collect(songs) };
          } catch (err) { return { error: err.message }; }
        },
      }),
    } : {}),
  };

  return { tools, seen };
}
