# Blocklist rules — seasonal windows, tag/genre blocklists, arbitrary tag matching

**Date:** 2026-08-05
**Issue:** #1300 FR 1 (the most-repeated ask in the support dataset); closes #752.
**Status:** Implemented (same branch). Decision taken with the operator: rules are part of the **existing blocklist** — one module, one file, one route family, one admin tab — not a parallel system.

## Problem

The station can *promote* seasonal music in season (festivals → dominantMood) but has no way to *exclude* anything by attribute. Four separate reporters asked for "stop Christmas music playing in July"; others asked for genre blocklists ("can I block certain genres outright, or at least on certain shows?") and arbitrary tag matching (a show built around `artist_country`-style tags that the show config can't express). The blocklist today is id-based only — one specific track/album/artist per entry — so "block a genre" means hunting down every album by hand, and a new rip in that genre slips straight through. `excludedPlaylistIds` is per-show and id-based too.

All three sub-asks reduce to the same shape — **a predicate evaluated against track attributes + the clock** — which is why they ship as one feature.

## Goal

Extend the never-play blocklist with **rule entries**: attribute/tag-based "never air" and "only in season" constraints, station-wide or scoped to shows. Because rules live inside `blocklist.matchOf()`, they are enforced at every chokepoint the id blocklist already covers — the subsonic reject chokepoint, the library-db song sources, the final `queue.push()` gate, the request declines, and the `annotate()` visibility pipeline — with **zero new enforcement sites**. Both pick paths and the coast consume pre-filtered sources, so they cannot drift on what "excluded" means.

## Non-goals

- **In-season promotion** (#752's "ideal" second half). Festivals + `dominantMood` already boost seasonal moods; a seasonal *playlist* rule plus a festival entry covers the full ask.
- **Inverse windows** ("exclude X *during* a window"). No reporter asked; a `mode` field can be added later without schema breakage.
- **Multi-condition (AND) rules.** Id entries already cover precise single targets; single-condition rules keep the matcher and editor trivial.
- **Raw file tags the pipeline doesn't ingest.** A custom ID3 frame like `artist_country` never reaches the Subsonic API. Rules match every tag namespace we *do* carry (genres ∪ moods ∪ audio moods ∪ Last.fm tags); the manual documents the workaround — put custom tags in the multi-value genre or mood field.
- **Operator force-override at queue time.** The blocklist is absolute; rules inherit that. Editing the rule is the override.

## Data model

`state/blocklist.json` gains a `rules` array beside the existing `entries` (absent key → `[]`, so existing files load unchanged):

```ts
type RuleField = 'genre' | 'tag' | 'mood' | 'artist' | 'album' | 'title' | 'playlist';

interface BlockRule {
  id: string;                 // unique, generated server-side — logs and DELETE key
  label: string;              // operator display name, e.g. "Christmas songs"
  field: RuleField;
  values: string[];           // any-of, 1–12 entries, each 1–64 chars; playlist → Navidrome playlist ids
  // Seasonal allow-window. null/absent = the rule always blocks.
  // Present = matching tracks are blocked EXCEPT while "in season":
  // inclusive month/day bounds, wraps the year end (Dec 1 → Jan 6 works),
  // evaluated in the station timezone (zonedParts, same math as festivals).
  season?: { from: { month: number; day: number }; to: { month: number; day: number } } | null;
  // Scope: empty/absent = station-wide. Non-empty = active only while one of
  // these shows is on air (settings.resolveActiveShow()). Stale ids are inert.
  showIds?: string[];
  addedAt: string;
}
```

Composable semantics:

| Rule | Meaning |
|---|---|
| `field: tag, values: [christmas], season: Dec 1 – Dec 26` | Christmas tracks only air Dec 1–26 — the headline ask |
| `field: genre, values: [Death Metal]` | genre blocked station-wide, always |
| `field: genre, values: [Death Metal], showIds: [morning-show]` | blocked only during that show |
| `field: playlist, values: [<xmas playlist id>], season: …` | #752's exact setup: the seasonal playlist is invisible out of season |

Staying in `blocklist.json` (not `settings.json`) is deliberate: it keeps the one "never air" store that deliberately survives Library → Reset/Reconcile, and it skips the settings three-edit/cold-load dance entirely — rules ride the blocklist's own load/persist.

### Matching semantics (per field)

- **`genre`** — reuses `genreMatches` from `show-filter.ts`: exact-normalised, or the track's tag *refines* the target on word boundaries. Blocking "Punk" also drops "Punk Rock"; blocking "Pop Punk" does **not** drop plain "Pop"; blocking "Rap" does not drop "Trap".
- **`tag`** — normalised **exact** match across every tag namespace the track carries: genres ∪ moods ∪ audioMoods ∪ Last.fm tags (new `trackAllTags` reader beside `trackGenres`/`trackMoods`, `library.get` fallback included). This is the "arbitrary tag matching" answer. Exact rather than substring because Last.fm tags are noisy free text.
- **`mood`** — case-insensitive exact over `trackMoods` (editorial + audio union, matching the retrieval blend).
- **`artist` / `album` / `title`** — the blocklist's existing normalised match (`norm`: trim/lowercase/collapse-whitespace). Complements id entries when the same artist appears under several Navidrome ids.
- **`playlist`** — track id ∈ the playlist's member set. Member sets are the one async-sourced input, cached in module state: refreshed on boot, on rule mutation, and on a 30-min TTL (same memo horizon as show-playlist's fetches), via the existing cached `getPlaylist` path. A stale/deleted playlist id resolves to the empty set with a one-shot warning. Membership staleness ≤ TTL is accepted.

## Architecture

### `music/blocklist.ts` stays the one module

`matchOf(song)` — already the single matcher whose answer is the contract — additionally walks the **active** rule entries after the id/name maps miss. It stays synchronous:

- **season** — evaluated per call against `Date.now()` via `zonedParts` (adjacent-years compare, the `getFestivalContext` pattern), so a rule flips itself on and off with no scheduler involvement;
- **show scope** — `settings.resolveActiveShow()` (synchronous);
- **tags** — the `show-filter.ts` readers (synchronous, `library.get` sqlite fallback, exactly what the strict-lock filters already do in the same hot paths);
- **playlist members** — the pre-resolved cached sets above.

Pure rule evaluation (`ruleMatches(rule, track, ctx)` + the season/window math + value normalisation) lives in a sibling **`music/blocklist-rules.ts`** imported by `blocklist.ts` — internal layout only; the module surface stays `blocklist.matchOf/isBlocked/rejectBlocked/annotate`. This also dodges the import cycle (`library.ts` imports `blocklist`; the tag readers import `library`): the readers are injected/lazily bound the way the file's own comment style prefers, and only `blocklist-rules.ts` touches them.

`matchOf`'s return gains the rule case: `BlockRef` becomes `{ kind: 'entry' | 'rule', type/field, id, name/label }` so every consumer — admin badges, queue log lines, request declines — can name exactly what blocked the track and offer to remove/edit exactly that. `isEmpty()` accounts for rules (a rule out of season is still "not empty" — cheapness is preserved by the compiled-per-mutation normalised rule list, not by pretending the list is empty).

Compilation happens **once per mutation** (`rebuildIndex` extends to normalise rule values, pre-resolve genre targets, build per-field lookup structures), so the per-track cost at the chokepoints stays O(rules-active) with cheap comparisons — same order as the strict-lock filters already running in those paths.

### Enforcement: inherited, not added

Because every song source already flows through `rejectBlocked` (subsonic.ts reject chokepoint, all `library.ts` sources) and the queue has its final `isBlocked` gate, rules are enforced everywhere the moment `matchOf` knows about them:

- **both pick paths + the coast** — candidates arrive pre-filtered from the sources; no picker/picker-tools/scheduler changes;
- **`queue.push()`** — refuses with a booth-log line naming the rule (`… — blocked by rule "Christmas songs" (out of season until Dec 1)`), covering MCP `queue_track`, the admin studio queue, and requests;
- **listener requests** — the two existing decline sites in `routes/request.ts` (328/708) already speak blocklist; the `BlockRef.kind === 'rule'` case reuses them, with the season end date in the operator-side log. Requests do **not** override rules;
- **purge on change** — rule CRUD calls the existing `queue.purgeBlocked()` (as the entry routes do at `routes/library.ts:1021`), dropping unsent upcoming items a now-active rule blocks.

Two accepted edges, both time-of-evaluation artifacts:

- **Absoluteness over never-starve.** The blocklist has no never-starve anywhere, and rules inherit that — a rule set that excludes the whole library empties the coast and lands on the emergency loop. That is operator error made loud, not a leak: `refreshAutoPlaylist` logs when the pool comes back empty while rules exist, and the admin tab shows match counts (below). This diverges from the per-show excluded-playlist coast behaviour (which never-starves) deliberately: blocklist semantics are "never air", full stop.
- **Boundary races.** A track picked while show A is live but airing after the boundary, or queued in-season and airing just out of it, is evaluated at pick/push time. The `queue.push()` gate is the last look; sent items are exempt from purge (Liquidsoap owns them). Minutes-wide, self-correcting, not worth a look-ahead scheduler.

### Routes

The blocklist route family in `routes/library.ts` grows rule CRUD, same auth, same shape conventions:

- `GET /blocklist` → `{ entries, rules }` — each rule annotated with `active` (is it blocking *right now*) and `matchCount` (library-db count of currently-matching tracks, so an operator sees "Christmas songs — 214 tracks, out of season" and a typo'd value shows `0`);
- `POST /blocklist/rules` (validated: caps above, id generated server-side), `PUT /blocklist/rules/:id`, `DELETE /blocklist/rules/:id` — each followed by `purgeBlocked()`.

### Visibility

- **`annotate()`** — unchanged pipeline; rows blocked by a currently-active rule carry the `kind: 'rule'` ref. The library UI renders it like `blockedBy` today but amber, tooltip naming the rule and — for seasonal rules — when it lifts. Show-scoped rules badge only while their show is active (that *is* the truthful answer to "will this air right now").
- **Booth log** — queue-gate refusals and purges name the rule.

### Admin UI

**Library → Blocked tab**, one surface, two sections: the id-entry table as today, and a **Rules** section — one row per rule (label; field + values chips; season chip "Dec 1 – Dec 26"; scope chip; live `active`/`matchCount` badge; edit/delete), plus an add/edit dialog: field select → values chip input (genre reuses the show editor's genre-suggestion source; playlist reuses the playlist picker), optional season (two month/day selects), optional show-scope multi-select. A "Seasonal preset" shortcut pre-fills the Christmas case (tag `christmas`, Dec 1 – Dec 26).

The show editor (schedule page) shows a read-only "N blocklist rules apply to this show" hint linking to the Blocked tab — discoverability without a second editor.

## Testing

- **`controller/scripts/blocklist-rules.test.ts`** (pure, auto-discovered):
  - season windows: inclusive bounds, year-end wrap (Dec 1 → Jan 6 active on Jan 3), in-season = not blocked, no-season = always blocked, station-zone evaluation;
  - genre direction (block "Punk" drops "Punk Rock"; block "Pop Punk" keeps "Pop"; block "Rap" keeps "Trap");
  - `tag` namespace union (a value matching only a Last.fm tag; only an audio mood);
  - show scoping incl. inert stale ids; playlist membership incl. stale playlist id → empty set;
  - rule-payload validation (caps, duplicate values, malformed season).
- **Blocklist integration** (extend the existing `matchOf`/persistence pins): id entry still wins the naming contract; `{entries:[]}` legacy file loads; rules round-trip persist; `isEmpty` semantics; `BlockRef.kind` shape.
- **Queue gate**: rule refusal log line + purge-on-rule-change case.

## Rollout

1. `blocklist-rules.ts` (pure matcher + validation) + tests.
2. `blocklist.ts` integration (storage, compiled index, `matchOf` walk, `BlockRef.kind`) + route CRUD + purge.
3. Admin UI (Rules section, badges, show-editor hint).
4. Manual/docs (seasonal-rules section incl. the custom-tag workaround), CLAUDE.md bullet, close #752, comment on #1300.

One PR against `develop`; phases are commit boundaries.
