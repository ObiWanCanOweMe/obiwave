# Task 5 report — vocal/stem transitions and shared authenticated renderer

## Status

Task 5 is reconciled in the active v0.47.0 merge. Upstream transition,
pair-drain, queue, and Liquidsoap behavior was adopted unchanged. The split
and AIO conflicts retain ObiWave's one shared Icecast renderer while supplying
the active station directory and preserving each deployment's listener-auth
callback default.

No commit, merge completion, abort, reset, push, PR, deployment, publication,
tag, release, or Odin mutation was performed.

- `HEAD`: `e4fe19f67bfe9698afa5b78f6fc98a46a45cb01e`
- `MERGE_HEAD`: `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`
- Remaining unresolved paths: none

## Transition adoption and fallback audit

The following Task 5 transition paths are byte-for-byte equal to
`MERGE_HEAD`:

- `controller/src/broadcast/drain-policy.ts`
- `controller/src/broadcast/stem-blend.ts`
- `controller/src/broadcast/queue.ts`
- `controller/src/broadcast/liquidsoap-control.ts`
- `controller/src/broadcast/scheduler.ts`
- `controller/src/music/mix.ts`
- `controller/src/music/library-db.ts`
- `controller/src/music/library.ts`
- `controller/src/music/subsonic.ts`
- `liquidsoap/radio.liq`

The adopted behavior retains:

- pair-aware drains when a successor is known;
- deadline picking between 120 and 45 seconds remaining;
- intrinsic/eager drain fallback when pair drain is disabled, timing is
  unknowable, or the hard deadline has passed;
- vocal-tail shaping of fade canvases and a vocal-tail veto for `chop`;
- stem cache lookup and cache-hit-only transition rendering;
- active-station transition storage through `config.stateDir`;
- clip annotations and queue controls for rendered blend seams;
- cancellation/reconciliation of both sides of a rendered seam;
- the upstream Liquidsoap queue, cue, and cross behavior.

Ordinary transition fallback remains intact. `maybeRenderBlend()` returns
`null` when stem blends or pair drains are disabled, DJ mode is off, ids or DB
records are absent, the outgoing track is capped, a bulk analysis pass is
running, grid/tempo data is unsuitable, either stem window is absent, timing is
unknown or too late, the analyzer returns no result, or returned cue points are
invalid. The queue applies the ordinary pair stamps before attempting the stem
upgrade. A `null` result leaves those stamps unchanged; a thrown render error
is caught and logged as a fallback to plain crossfade. The 45-second intrinsic
drain path prevents an unavailable pick or render from waiting indefinitely or
starving Liquidsoap.

## Shared-renderer composition

Both conflict resolutions removed the upstream duplicated inline rendering
bodies and call only:

```text
/usr/local/bin/icecast-render
```

Both pass:

```bash
ICECAST_STATE_DIR="$STATE_DIR"
```

Therefore stream buffer files and `icecast_listener_auth.txt` are read from
the active profile selected by upstream's station resolver. Install-level
Icecast secrets remain under `STATE_ROOT`.

The split entrypoint retains:

```text
http://controller:7701/listener-auth
```

The AIO supervisor retains:

```text
http://localhost:7701/listener-auth
```

The AIO `run_broadcast()` function re-resolves `STATE_DIR`, bootstraps the
selected profile, re-renders Icecast, and launches the Icecast/Liquidsoap pair
on every pair restart. The split container resolves the active station on boot;
its `wait -n` lifecycle exits if either Icecast or Liquidsoap dies so Docker
restarts the pair and re-runs the resolver and renderer.

The unchanged shared renderer continues to emit per-format MP3, Opus, AAC, and
FLAC mount blocks, including URL authentication only when the active profile's
listener-auth flag is literally `true`.

## TDD evidence

Before resolving production scripts,
`controller/scripts/aio-icecast-render.test.ts` was extended to require:

- `ICECAST_STATE_DIR="$STATE_DIR"` in split and AIO;
- the split controller-service callback default;
- the AIO loopback callback default.

RED:

```text
(cd controller && npx tsx scripts/aio-icecast-render.test.ts)
```

Exit 1:

```text
AssertionError [ERR_ASSERTION]: AIO renders Icecast from the active station directory
```

After composing the shared-renderer calls with the active state directory and
deployment-specific callback defaults, the same command exited 0:

```text
aio-icecast-render.test.ts: split and AIO use the shared renderer
```

### Review hardening

The follow-up review correctly noted that the first wiring contract proved
only that each script contained a shared-renderer call. The test was
strengthened before any further script change to require:

- exactly one `/usr/local/bin/icecast-render` occurrence in each deployment
  script;
- no local `emit_mount()` function;
- no local `MOUNTS_XML` implementation;
- no `<!--@STREAM_MOUNTS@-->` splice marker in either deployment script.

The scripts already had the intended narrow resolution, so the strengthened
test passed on its first run. No production change was necessary:

```text
(cd controller && npx tsx scripts/aio-icecast-render.test.ts)
```

Exit 0:
`aio-icecast-render.test.ts: split and AIO use the shared renderer`.

## Commands and exact results

```text
(cd controller && npx tsx scripts/drain-policy.test.ts)
```

Exit 0: `drain-policy: all assertions passed`.

```text
(cd controller && npx tsx scripts/outro-mix.test.ts)
```

Exit 0: `outro-mix: all assertions passed`.

```text
bash -n docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh
```

Exit 0 with no output.

```text
(cd controller && npx tsx scripts/icecast-render.test.ts)
```

Exit 0:
`icecast-render.test.ts: per-mount bursts render in private and public modes`.

```text
(cd controller && npx tsx scripts/aio-icecast-render.test.ts)
```

Exit 0:
`aio-icecast-render.test.ts: split and AIO use the shared renderer`.

```text
(cd controller && npx tsx scripts/listener-auth.test.ts)
```

Exit 0: `listener-auth.test.ts: all assertions passed`.

```text
npm --prefix controller run typecheck
```

Exit 0: `tsc --noEmit`.

## Review package and staging

`.superpowers/sdd/task-5-review.diff` contains the complete Task 5 scoped
staged patch against `HEAD`, generated directly with `git diff --cached -U0`.
It contains no hand-edited preamble or whitespace normalization. The scoped
patch has 15 changed paths, 1,374 insertions, and 203 deletions. The retained
`docker/icecast-render.sh`,
`controller/scripts/icecast-render.test.ts`, and
`controller/scripts/listener-auth.test.ts` were reviewed and staged by path
but have no diff from `HEAD`.

Exactness and applicability were verified:

```text
git diff --cached -U0 HEAD -- <Task 5 pathset> > <temporary patch>
cmp -s <temporary patch> .superpowers/sdd/task-5-review.diff
```

Exit 0: `review diff byte-match: PASS`.

```text
git apply --cached --check --reverse --unidiff-zero \
  .superpowers/sdd/task-5-review.diff
```

Exit 0:
`reverse apply against current staged Task5 state: PASS`.

```text
GIT_INDEX_FILE=<temporary-index> git read-tree HEAD
GIT_INDEX_FILE=<temporary-index> git apply --cached --check --unidiff-zero \
  .superpowers/sdd/task-5-review.diff
```

Exit 0:
`forward apply against temporary HEAD index: PASS`.

Task 5's exact code/test paths plus this report, the review package, and
`.superpowers/sdd/progress.md` are staged. No Task 5 path has an unstaged diff.
`git diff --cached --check` exits 0, both shell conflicts are resolved, and no
conflict markers remain in the Task 5 scripts.

## Concerns

No Critical or Important concern was found in the Task 5 scope.
