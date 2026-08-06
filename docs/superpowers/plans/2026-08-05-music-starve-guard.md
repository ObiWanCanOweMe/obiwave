# Music Starve Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the station looping jingles forever when the music source starves, and show the operator that it happened.

**Architecture:** `radio.liq` samples the pre-rotate music chain (`music_meta`) once a second; after a sustained starve it makes the jingles source unavailable, so the rotate empties and the *existing* `emergency` fallback fires as designed. The same tick writes `music-starved.json`, which the controller reads and publishes on `/state`, and an admin banner renders from that.

**Tech Stack:** Liquidsoap 2.4.5, Node.js ESM (Express, tsx), Next.js 15 App Router + Tailwind.

## Global Constraints

- Liquidsoap version is pinned at `savonet/liquidsoap:v2.4.5` (`docker/Dockerfile.broadcast:11`). Verify every `radio.liq` edit against that exact image.
- `STARVE_GRACE_SEC = 30.0`, `STARVE_SAMPLE_SEC = 1.0`, `STARVE_MARKER_STALE_MS = 60_000`. Exact values, from the spec.
- Every `file.write(atomic=true)` in `radio.liq` MUST pass a `temp_dir=` on the state fs, one dir **per writer** (#1240). This change adds `starve_tmp_dir`; it must not reuse `np_tmp_dir` / `jingle_tmp_dir` / `bed_tmp_dir`.
- `radio.liq`'s `time()` returns unix **seconds**. The controller works in **milliseconds**. Convert once, at the parse boundary in `starveState`, and nowhere else.
- Controller tests are auto-discovered: dropping `controller/scripts/*.test.ts` in is the whole registration step. No `package.json` edit.
- Lint is the merge gate: `npm run lint` in `controller/` and `web/` must pass (`eslint . && tsc --noEmit`).
- Inline styles are eslint-forbidden in `web/` — use Tailwind classes.
- Do NOT add booth-log lines, a webhook event, or a doctor check. Explicitly out of scope (spec § Out of scope).

---

### Task 1: Pure starve-state helper

The decision logic, with no IO, so it can be pinned exactly. Every failure mode resolves toward **not starved**: a missed banner costs less than a permanent false alarm, and `NavidromeBanner` already covers the most common cause independently.

**Files:**
- Create: `controller/src/broadcast/music-starve-pure.ts`
- Test: `controller/scripts/music-starve.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `starveState(marker: unknown, now: number): StarveState` where `StarveState = { starved: boolean; since: number | null }` (`now` and `since` are epoch **ms**); `STARVE_MARKER_STALE_MS: number`.

**Why a separate `-pure.ts`:** the same split as `stream-idle-pure.ts` and `programme-pure.ts`, and for the same stated reason — the test pins this without dragging in the reader's `config.js` / `node:fs` imports. Task 2 adds the IO sibling.

- [ ] **Step 1: Write the failing test**

Create `controller/scripts/music-starve.test.ts`:

```ts
// Pins the music-starve marker contract (broadcast/music-starve-pure.ts) — how the
// controller reads radio.liq's music-starved.json (#1300 bug 7).
//
// Every ambiguous case resolves toward NOT starved. A false "your station is
// broken" banner that never clears is worse than a missed one, and the
// Navidrome banner already covers the most common cause on its own.
// node:assert-via-tsx style, matching scripts/skip-policy.test.ts.

import assert from 'node:assert/strict';
import { starveState, STARVE_MARKER_STALE_MS } from '../src/broadcast/music-starve-pure.js';

const NOW = 1_785_000_000_000;         // epoch ms
const SEC = (ms: number) => ms / 1000; // marker timestamps are unix SECONDS

// ── absent / malformed ───────────────────────────────────────────────────────

// No marker at all: an older broadcast image doesn't write this file. Upgrade
// skew must not read as a permanent outage.
assert.deepEqual(starveState(null, NOW), { starved: false, since: null }, 'null → not starved');
assert.deepEqual(starveState(undefined, NOW), { starved: false, since: null }, 'undefined → not starved');
assert.deepEqual(starveState('nonsense', NOW), { starved: false, since: null }, 'string → not starved');
assert.deepEqual(starveState(42, NOW), { starved: false, since: null }, 'number → not starved');
assert.deepEqual(starveState({}, NOW), { starved: false, since: null }, 'empty object → not starved');

// ── the healthy steady state ─────────────────────────────────────────────────

// radio.liq writes starved:false at startup, so this is what a working station
// looks like on disk.
assert.deepEqual(
  starveState({ starved: false, since: 0, at: SEC(NOW) }, NOW),
  { starved: false, since: null },
  'starved:false → not starved',
);

// Only a literal `true` counts — never a truthy value.
assert.deepEqual(
  starveState({ starved: 'true', at: SEC(NOW) }, NOW),
  { starved: false, since: null },
  'truthy string is not true',
);
assert.deepEqual(
  starveState({ starved: 1, at: SEC(NOW) }, NOW),
  { starved: false, since: null },
  'truthy number is not true',
);

// ── a live starve ────────────────────────────────────────────────────────────

const since = SEC(NOW - 90_000);
assert.deepEqual(
  starveState({ starved: true, since, at: SEC(NOW - 1000) }, NOW),
  { starved: true, since: NOW - 90_000 },
  'fresh heartbeat → starved, since converted to ms',
);

// ── staleness: the heartbeat is the liveness proof ───────────────────────────

// The marker is never deleted, so a mixer that died mid-outage would otherwise
// report a starve forever. `at` is refreshed every tick while starved.
assert.deepEqual(
  starveState({ starved: true, since, at: SEC(NOW - 5 * 60_000) }, NOW),
  { starved: false, since: null },
  'stale heartbeat → not starved',
);

// Exact boundary: at the threshold the marker is still LIVE; strictly past it
// is stale.
assert.equal(
  starveState({ starved: true, since, at: SEC(NOW - STARVE_MARKER_STALE_MS) }, NOW).starved,
  true,
  'exactly at the threshold is still live',
);
assert.equal(
  starveState({ starved: true, since, at: SEC(NOW - STARVE_MARKER_STALE_MS - 1) }, NOW).starved,
  false,
  'one ms past the threshold is stale',
);

// A missing or unusable `at` is not a heartbeat — it cannot prove liveness.
assert.equal(starveState({ starved: true, since }, NOW).starved, false, 'no at → not starved');
assert.equal(
  starveState({ starved: true, since, at: 'soon' }, NOW).starved, false, 'non-numeric at → not starved',
);
assert.equal(
  starveState({ starved: true, since, at: 0 }, NOW).starved, false, 'zero at → not starved',
);

// Container/host clock skew can put `at` slightly ahead. That's still a live
// heartbeat — don't discard it.
assert.equal(
  starveState({ starved: true, since, at: SEC(NOW + 2000) }, NOW).starved,
  true,
  'future at is still live',
);

// ── since is best-effort ─────────────────────────────────────────────────────

// A starve is a starve even if we can't say when it began — report it with a
// null start rather than suppressing the whole signal.
assert.deepEqual(
  starveState({ starved: true, at: SEC(NOW) }, NOW),
  { starved: true, since: null },
  'missing since → starved with null since',
);
assert.deepEqual(
  starveState({ starved: true, since: 'ages', at: SEC(NOW) }, NOW),
  { starved: true, since: null },
  'garbage since → starved with null since',
);

console.log('music-starve: all assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd controller && npm test -- music-starve`

Expected: FAIL — cannot resolve `../src/broadcast/music-starve-pure.js`.

- [ ] **Step 3: Write the implementation**

Create `controller/src/broadcast/music-starve-pure.ts`:

```ts
// The music-chain starve signal (#1300 bug 7) — pure decision logic.
//
// Split from the reader (music-starve.ts) so scripts/music-starve.test.ts can
// pin it without dragging in config.js / node:fs, the same split as
// stream-idle-pure.ts and programme-pure.ts.
//
// radio.liq's jingle rotate skips unavailable sources, so with the music chain
// starved (Navidrome unreachable, auto.m3u empty or exhausted) it serves
// stingers back to back forever — and the emergency fallback below it can't
// see that, because `radio` IS available: it is producing jingles. radio.liq
// now samples the pre-rotate chain itself and reports the verdict here, in
// music-starved.json.
//
// Every ambiguous input resolves toward NOT starved — a false "your station is
// broken" banner that never clears is worse than a missed one, and
// NavidromeBanner already covers the most common cause on its own.

/** How stale the heartbeat may get before the marker stops counting as live. */
export const STARVE_MARKER_STALE_MS = 60_000;

export interface StarveState {
  starved: boolean;
  /** Epoch ms the starve began, null when unknown or not starved. */
  since: number | null;
}

const NOT_STARVED: StarveState = { starved: false, since: null };

/** Marker timestamps are liquidsoap `time()` — unix SECONDS. This is the one
 *  place that conversion happens. Returns null for anything unusable. */
function toMs(raw: unknown): number | null {
  const ms = Number(raw) * 1000;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Decide whether the mixer is currently reporting a starved music chain.
 * `now` is epoch ms; `marker` is the parsed music-starved.json (or null).
 */
export function starveState(marker: unknown, now: number): StarveState {
  if (!marker || typeof marker !== 'object') return NOT_STARVED;
  const m = marker as { starved?: unknown; since?: unknown; at?: unknown };

  // Only a literal true. A truthy value is a malformed marker, not a starve.
  if (m.starved !== true) return NOT_STARVED;

  // The heartbeat is the liveness proof. The marker is never deleted, so
  // without this a mixer that died mid-outage reports a starve forever.
  const atMs = toMs(m.at);
  if (atMs === null) return NOT_STARVED;
  if (now - atMs > STARVE_MARKER_STALE_MS) return NOT_STARVED;

  // `since` is best-effort: a starve we can't date is still a starve.
  return { starved: true, since: toMs(m.since) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd controller && npm test -- music-starve`

Expected: PASS, ending `music-starve: all assertions passed`.

- [ ] **Step 5: Lint**

Run: `cd controller && npm run lint`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add controller/src/broadcast/music-starve-pure.ts controller/scripts/music-starve.test.ts
git commit -m "feat(broadcast): pure music-starve marker decision logic (#1300 bug 7)"
```

---

### Task 2: Wire the marker into `/state`

The IO shell around Task 1's helper, the config path, and the two public fields the banner renders from.

**Files:**
- Create: `controller/src/broadcast/music-starve.ts` (the IO sibling of Task 1's pure module)
- Modify: `controller/src/config.ts:215` (after `bedPlayingFile`)
- Modify: `controller/src/routes/public.ts:504-543` (the `/state` handler)
- Modify: `controller/src/stations/manager.ts:312-315` (`STALE_IPC_FILES`)

**Interfaces:**
- Consumes: `starveState`, `StarveState` from `./music-starve-pure.js` (Task 1).
- Produces: `currentStarve(now?: number): StarveState`; `config.liquidsoap.musicStarvedFile: string`; `/state` gains `musicStarved: boolean` and `musicStarvedSince: number | null`.

- [ ] **Step 1: Add the config path**

In `controller/src/config.ts`, immediately after the `bedPlayingFile` entry (line 215), inside the same `liquidsoap:` block:

```ts
    // Written by radio.liq's starve guard (#1300 bug 7): {starved, since, at},
    // unix SECONDS. `at` is a heartbeat refreshed every tick WHILE starved, so
    // the controller can tell a live outage from a marker left behind by a
    // mixer that died mid-outage. Read via broadcast/music-starve.ts.
    musicStarvedFile: `${STATE_DIR}/music-starved.json`,
```

- [ ] **Step 2: Add the reader**

Create `controller/src/broadcast/music-starve.ts`:

```ts
// Reads radio.liq's music-starved.json (#1300 bug 7). The IO shell around
// music-starve-pure.ts, which owns every decision and is separately pinned.

import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { starveState, type StarveState } from './music-starve-pure.js';

export type { StarveState };

// A 2s memo, not util/ttl-cache.ts: that wraps an ASYNC producer, and this is a
// synchronous readFileSync behind a synchronous /state handler. Same purpose —
// bound the cost by the clock rather than by how many clients are polling.
const MEMO_MS = 2_000;
let memo: { at: number; value: StarveState } | null = null;

/** The mixer's current starve verdict. Absent/unreadable/malformed → not
 *  starved; see starveState for why every failure resolves that way. */
export function currentStarve(now: number = Date.now()): StarveState {
  if (memo && now - memo.at < MEMO_MS) return memo.value;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readFileSync(config.liquidsoap.musicStarvedFile, 'utf8'));
  } catch {
    parsed = null; // absent is the normal case on a station that never starved
  }
  const value = starveState(parsed, now);
  memo = { at: now, value };
  return value;
}
```

- [ ] **Step 3: Publish on `/state`**

In `controller/src/routes/public.ts`, add the import alongside the other broadcast imports (near line 13):

```ts
import { currentStarve } from '../broadcast/music-starve.js';
```

Inside the `/state` handler, add before `res.json({`:

```ts
  const starve = currentStarve();
```

Then add these fields to the `res.json({...})` object, directly after the `streamIdle` field (which exists for the neighbouring purpose — telling "quiet because the room is empty" from "broken"):

```ts
    // True while the mixer reports its music chain starved (#1300 bug 7):
    // nothing to play, so the emergency loop is on air. Distinct from
    // streamIdle, which is a deliberate pause for an empty room.
    musicStarved: starve.starved,
    musicStarvedSince: starve.since,
```

- [ ] **Step 4: Drain the marker on a station switch**

In `controller/src/stations/manager.ts`, add to `STALE_IPC_FILES` (line 312-315):

```ts
const STALE_IPC_FILES = [
  'next.txt', 'say.txt', 'intro.txt', 'sfx.txt',
  'now-playing.json', 'jingle-playing.json', 'bed-playing.json',
  'music-starved.json',
];
```

No change is needed in `stations/pure.ts`: `conversionAction` moves anything not install-level, and `duplicateAction` skips anything not explicitly copied — both already correct for a runtime marker.

- [ ] **Step 5: Verify the endpoint end to end**

With no marker file present (the normal case), confirm the fields are published and default safely:

```bash
cd controller && npx tsx -e "
import { currentStarve } from './src/broadcast/music-starve.js';
console.log('absent marker →', currentStarve());
"
```

Expected: `absent marker → { starved: false, since: null }`.

- [ ] **Step 6: Lint**

Run: `cd controller && npm run lint`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add controller/src/broadcast/music-starve.ts controller/src/config.ts \
        controller/src/routes/public.ts controller/src/stations/manager.ts
git commit -m "feat(controller): publish the music-starve state on /state (#1300 bug 7)"
```

---

### Task 3: The starve guard in `radio.liq`

The actual fix. Three edits at three points in the file, and the ordering between them is load-bearing.

**Files:**
- Modify: `liquidsoap/radio.liq:52` (temp dir), `:53` (the ref), `:962` (the gate), after `:1214` (the tick)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `${state_dir}/music-starved.json` in the shape Task 1 parses — `{starved: bool, since: float, at: float}`, unix seconds.

- [ ] **Step 1: Add the temp dir**

In `liquidsoap/radio.liq`, after `bed_tmp_dir = ensure_tmp_dir("#{state_dir}/tmp/bed")` (line 52):

```liquidsoap
starve_tmp_dir = ensure_tmp_dir("#{state_dir}/tmp/starve")
```

One dir per writer — never share with the other three (#1240).

- [ ] **Step 2: Declare the latch early**

Immediately after the temp dirs:

```liquidsoap
# MUSIC STARVE GUARD (#1300 bug 7) — the latch only. Declared up here because
# the jingles gate reads it from a thunk at line ~962, long before the tick
# that drives it can be registered (the tick needs idle_mode, defined ~1214).
# Same lazy-thunk pattern bed_on_air already uses.
music_starved = ref(false)
```

- [ ] **Step 3: Gate the jingles source**

At line 962, change:

```liquidsoap
    jingles = source.available(jingles, {not bed_on_air()})
```

to:

```liquidsoap
    jingles = source.available(jingles, {not bed_on_air() and not music_starved()})
```

This is the whole on-air fix: once latched, the rotate has nothing, `radio` goes unavailable, and the existing `fallback(track_sensitive=false, [radio, emergency])` fires.

- [ ] **Step 4: Add the detection tick**

After the idle-gate `switch` block (after line ~1214, following the `blank.skip` NOTE comment), add:

```liquidsoap
# ---------------------------------------------------------------------------
# MUSIC STARVE GUARD (#1300 bug 7)
# ---------------------------------------------------------------------------
# `rotate` skips unavailable sources, so with the music chain starved
# (Navidrome unreachable, auto.m3u empty or exhausted) the jingle rotate above
# serves stingers back to back forever — and the `emergency` fallback CANNOT
# see it, because `radio` is still available: it is producing jingles. Measured
# on 2.4.5 with an empty auto.m3u: music_ready=false, jingles_ready=true,
# radio_ready=true. That is the bug in one line.
#
# So sample the PRE-rotate chain (music_meta — the same handle on_metadata
# uses) and, once it has been starved for a sustained window, make jingles
# unavailable. The rotate empties, `radio` goes unavailable, and the emergency
# single fires exactly as it was always meant to.
#
# The window is not just a false-positive guard, it IS the "a jingle may cover
# a brief hiccup" behaviour: the chain is legitimately not-ready at a track
# boundary while a request resolves (the controller bounds that at
# SKIP_COMMIT_WAIT_MS = 20s), so a blip is still papered over by a stinger and
# only a sustained outage escalates. Recovery is unconditional: any tick that
# sees the source ready clears the latch, no restart.
#
# Suppressed while the idle gate holds the programme frozen for an empty room —
# "the music source is starved" is not a meaningful claim about a station
# nobody is listening to. Entering idle clears the latch outright, so the first
# listener back gets a full fresh window rather than a stale verdict.
STARVE_GRACE_SEC = 30.0
STARVE_SAMPLE_SEC = 1.0

starved_for = ref(0.0)
starved_since = ref(0.0)

# NEVER let this raise. An uncaught exception inside a thread.run callback kills
# that thread PERMANENTLY — the guard would freeze at whatever it last latched,
# worst case the emergency loop forever with no path back. Observed directly
# while developing this (an EACCES on the write killed the tick outright), and
# the realistic trigger is the same unwritable state mount ensure_tmp_dir
# already defends against. Reporting must not share a failure domain with the
# guard itself.
def write_starve_marker(starved, since) =
  try
    file.write(
      data=json.stringify(compact=true, {
        starved = starved,
        since = since,
        at = time()
      }),
      atomic=true,
      temp_dir=starve_tmp_dir,
      "#{state_dir}/music-starved.json"
    )
  catch err do
    log(label="subwave", "music-starved.json write failed (#{err})")
  end
end

# Publish the healthy state at startup so a working station has the file.
write_starve_marker(false, 0.0)

thread.run(every=STARVE_SAMPLE_SEC, fun () -> begin
  if idle_mode() then
    starved_for := 0.0
    if music_starved() then
      music_starved := false
      write_starve_marker(false, 0.0)
    end
  elsif source.is_ready(music_meta) then
    starved_for := 0.0
    if music_starved() then
      music_starved := false
      log(label="subwave", "music source recovered - jingle rotate re-armed")
      write_starve_marker(false, 0.0)
    end
  else
    starved_for := starved_for() + STARVE_SAMPLE_SEC
    if music_starved() then
      # Heartbeat: refreshes `at` so the controller can tell a live outage from
      # a marker left behind by a mixer that died mid-outage.
      write_starve_marker(true, starved_since())
    elsif starved_for() >= STARVE_GRACE_SEC then
      music_starved := true
      starved_since := time()
      log(
        label="subwave",
        "MUSIC SOURCE STARVED for #{starved_for()}s - jingles gated off, emergency loop takes over"
      )
      write_starve_marker(true, starved_since())
    end
  end
end)
```

- [ ] **Step 5: Typecheck against the pinned image**

Run from the repo root:

```bash
docker run --rm -v "$PWD/liquidsoap:/liq:ro" savonet/liquidsoap:v2.4.5 \
  liquidsoap --check /liq/radio.liq; echo "EXIT=$?"
```

Expected: `EXIT=0` and no output. Nothing in CI validates `radio.liq`, so this is the gate — and it is what catches the ordering constraint in Steps 2/3/4. A non-zero exit here means a station that will not boot.

- [ ] **Step 6: Verify the behaviour, not just the types**

`--check` proves it compiles, not that it guards. Run the isolated harness — a minimal mirror of the chain, which reproduced the bug and validated this design:

```bash
mkdir -p /tmp/starve-harness && cd /tmp/starve-harness
ffmpeg -v error -f lavfi -i "sine=frequency=440:duration=3" jingle1.wav -y
ffmpeg -v error -f lavfi -i "sine=frequency=220:duration=5" emergency.wav -y
ffmpeg -v error -f lavfi -i "sine=frequency=330:duration=8" song1.wav -y
printf '/w/jingle1.wav\n' > jingles.m3u
: > auto.m3u
```

Write `/tmp/starve-harness/probe.liq` with the same guard logic but `STARVE_GRACE_SEC = 5.0` (so the test runs in seconds), mirroring the chain:

```liquidsoap
settings.log.level := 3
STARVE_GRACE_SEC = 5.0
SAMPLE_SEC = 1.0

q = request.queue(id="dj_queue")
auto = playlist(id="auto", reload_mode="watch", mode="randomize", "/w/auto.m3u")
music = fallback(id="music", track_sensitive=true, [q, auto])

music_starved = ref(false)
starved_for = ref(0.0)
thread.run(every=SAMPLE_SEC, fun () -> begin
  if source.is_ready(music) then
    starved_for := 0.0
    if music_starved() then
      music_starved := false
      log(label="probe", "RECOVERED")
    end
  else
    starved_for := starved_for() + SAMPLE_SEC
    if not music_starved() and starved_for() >= STARVE_GRACE_SEC then
      music_starved := true
      log(label="probe", "STARVED latched")
    end
  end
end)

jingles = playlist(id="jingles", mode="randomize", reload_mode="watch", "/w/jingles.m3u")
jingles = source.available(jingles, {not music_starved()})
programme = rotate(weights=[1, 30], [jingles, music])
radio = fallback(track_sensitive=false, [programme, single("/w/emergency.wav")])

n = ref(0)
thread.run(every=1.0, fun () -> begin
  n := n() + 1
  log(label="probe",
    "t=#{n()} music=#{source.is_ready(music)} starved=#{music_starved()} jingles=#{source.is_ready(jingles)} programme=#{source.is_ready(programme)}")
  if n() >= 20 then shutdown() end
end)

output.dummy(fallible=true, radio)
```

Run it, refilling the playlist from the HOST partway through (writing `auto.m3u` from inside liquidsoap hits EACCES and kills the tick — that is how the "must not raise" rule was found):

```bash
cd /tmp/starve-harness
: > auto.m3u
(sleep 13 && printf '/w/song1.wav\n' > auto.m3u) &
timeout 40 docker run --rm -v /tmp/starve-harness:/w savonet/liquidsoap:v2.4.5 \
  liquidsoap /w/probe.liq 2>&1 | grep "probe:"
```

Expected, and all four phases must appear:

```
t=2..5   music=false starved=false jingles=true  programme=true    <- grace: jingle covers
STARVED latched
t=6..13  music=false starved=true  jingles=false programme=false   <- emergency fires
RECOVERED
t=14..20 music=true  starved=false jingles=true  programme=true    <- back, no restart
```

- [ ] **Step 7: Commit**

```bash
git add liquidsoap/radio.liq
git commit -m "fix(broadcast): stop the jingle rotate masking a starved music source (#1300 bug 7)"
```

---

### Task 4: Admin banner

Tell the operator, without stacking two red bars when a Navidrome outage raises both.

**Files:**
- Create: `web/components/admin/MusicStarvedBanner.tsx`
- Modify: `web/components/admin/NavidromeBanner.tsx` (add an `onStatus` callback)
- Modify: `web/components/admin/AdminShell.tsx:47` (import), `:253-323` (state + render)

**Interfaces:**
- Consumes: `/state`'s `musicStarved` from Task 2.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Report status out of `NavidromeBanner`**

In `web/components/admin/NavidromeBanner.tsx`, extend the props and notify on each poll. Change the signature to:

```tsx
export default function NavidromeBanner({
  adminFetch,
  onStatus,
}: {
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  // Lets the shell suppress the broader starve banner while this more specific
  // one is up — a Navidrome outage raises both, and two stacked red bars
  // saying overlapping things is worse than one.
  onStatus?: (ok: boolean) => void;
}) {
```

Hold it in a ref so the poll effect still mounts once, next to the existing `fetchRef`:

```tsx
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
```

And inside `check()`, immediately after `setStatus(j)`:

```tsx
        if (!cancelled) {
          setStatus(j);
          onStatusRef.current?.(j.ok);
        }
```

(replacing the bare `if (!cancelled) setStatus(j);`).

- [ ] **Step 2: Write the banner**

Create `web/components/admin/MusicStarvedBanner.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

// The mixer reports its music chain starved (#1300 bug 7): nothing to play, so
// the emergency loop is on air. Broader than NavidromeBanner on purpose — a
// starve also happens with Navidrome perfectly healthy (an empty auto.m3u, an
// over-strict show whose pool resolved to nothing), and it reports what is
// actually happening ON AIR rather than which dependency is down.
//
// Renders nothing until a starved reading arrives, and stands down entirely
// while the Navidrome banner is up, which is the more specific message.
export default function MusicStarvedBanner({
  adminFetch,
  suppressed = false,
}: {
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  suppressed?: boolean;
}) {
  const [starved, setStarved] = useState(false);
  // adminFetch's identity changes as auth state ticks; hold the latest in a ref
  // so the poll interval mounts once instead of tearing down every render.
  const fetchRef = useRef(adminFetch);
  fetchRef.current = adminFetch;

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetchRef.current('/state');
        if (!r.ok) return; // 401 / 5xx — don't flip the banner on an auth blip
        const j = (await r.json()) as { musicStarved?: boolean };
        if (!cancelled) setStarved(j.musicStarved === true);
      } catch {
        // Controller unreachable — leave the last known state rather than
        // flapping; a dead controller has its own, louder failure modes.
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!starved || suppressed) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] px-5 py-2 text-[11px] text-ink sm:px-7"
    >
      <AlertTriangle size={14} className="shrink-0 text-[var(--danger)]" aria-hidden="true" />
      <span>
        <b>No music to play.</b> The station has run out of tracks and is airing the emergency
        loop. Check that your music source is reachable and that the current show isn&rsquo;t
        filtered down to nothing.
      </span>
      <Link
        href="/admin/doctor"
        className="ml-auto inline-flex min-h-9 items-center font-bold text-[var(--danger)] underline-offset-2 hover:underline sm:min-h-0"
      >
        Run the Doctor &rarr;
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the shell**

In `web/components/admin/AdminShell.tsx`, add the import after the `NavidromeBanner` import (line 47):

```tsx
import MusicStarvedBanner from './MusicStarvedBanner';
```

Inside the `AdminShell` component (starting line 253), alongside its other state:

```tsx
  // Navidrome down raises the starve banner too; show only the specific one.
  const [navidromeOk, setNavidromeOk] = useState(true);
```

Then replace the single banner line (line 323):

```tsx
          <NavidromeBanner adminFetch={adminFetch} />
```

with:

```tsx
          <NavidromeBanner adminFetch={adminFetch} onStatus={setNavidromeOk} />
          <MusicStarvedBanner adminFetch={adminFetch} suppressed={!navidromeOk} />
```

Confirm `useState` is already imported in `AdminShell.tsx`; add it to the existing `react` import if not.

- [ ] **Step 4: Lint**

Run: `cd web && npm run lint`

Expected: clean. (No inline styles — the banner is Tailwind only, matching `NavidromeBanner`.)

- [ ] **Step 5: Commit**

```bash
git add web/components/admin/MusicStarvedBanner.tsx \
        web/components/admin/NavidromeBanner.tsx \
        web/components/admin/AdminShell.tsx
git commit -m "feat(admin): banner when the station has no music to play (#1300 bug 7)"
```

---

### Task 5: On-air smoke test

`--check` and the isolated harness prove the logic; this proves it in the real stack, as #1322 did before being marked ready.

**Files:** none — verification only.

- [ ] **Step 1: Bring up the worktree dev stack**

Use the `subwave-worktree-dev` skill (a worktree needs `controller/.env`, `web/.env.local`, `docker/.env`, `web/node_modules` and a `state/` dir staged from the main tree). Copy `state/schedule.json` and `state/library.db` across too, or the stack boots with zero shows and an un-analysed library.

- [ ] **Step 2: Starve the station**

With the stack on air, empty the auto playlist and stop the music backend:

```bash
: > state/auto.m3u
```

Then stop the Navidrome/router backend the station is pointed at, so no pick can resolve.

- [ ] **Step 3: Confirm the guard fires**

Watch the mixer log (`docker logs` only shows the supervisor — the real log is inside the container):

```bash
docker compose -f docker-compose.dev.yml exec broadcast \
  grep -E "STARVED|recovered" /var/log/liquidsoap/radio.log
```

Expected within ~30s of the last track ending: `MUSIC SOURCE STARVED for 30.0s - jingles gated off, emergency loop takes over`, and the stream audibly switches from looping jingles to the emergency loop.

- [ ] **Step 4: Confirm the operator surfaces**

```bash
curl -s http://localhost:7700/api/state | jq '{musicStarved, musicStarvedSince}'
cat state/music-starved.json
```

Expected: `musicStarved: true` with a non-null `musicStarvedSince`, and the marker's `at` advancing on each read (the heartbeat). Load `/admin` and confirm the banner renders — and that with Navidrome also down you see only the Navidrome banner, not both.

- [ ] **Step 5: Confirm recovery**

Restart the music backend and refill the playlist. Expected: `music source recovered - jingle rotate re-armed` within one tick, music resumes with no restart, `/api/state` flips back to `musicStarved: false`, and the banner disappears within its 30s poll.

- [ ] **Step 6: Run the full controller suite**

Run: `cd controller && npm test`

Expected: all pass. CI does not run tests, so this is on us.

---

## Notes for the reviewer

- **Deviation from the spec, deliberate:** the spec called for `util/ttl-cache.ts` around the reader. That module wraps an *async* producer; the read here is a synchronous `readFileSync` behind a synchronous `/state` handler, so Task 2 uses a 2s sync memo instead. Same purpose — bound the cost by the clock, not by client count — without making `/state` async.
- **Second deviation, same spirit:** the spec described one `broadcast/music-starve.ts`. It ships as two — `music-starve-pure.ts` (decisions, tested) and `music-starve.ts` (fs + config) — because that is the codebase's stated convention for exactly this case (`stream-idle-pure.ts`, `programme-pure.ts`), and it keeps the test from importing `config.js` transitively.
- **Not done, and intentionally so** (spec § Out of scope): booth-log lines on the starve edges, a `station.starved` webhook event, a doctor check, and an operator-configurable grace window.
