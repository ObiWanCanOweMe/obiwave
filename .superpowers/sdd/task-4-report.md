# Task 4 report — multi-station profiles and settings/provider security

## Status

Task 4 is reconciled and staged in the active v0.47.0 merge. An Important
post-review race was corrected with a process-local station mutation lifecycle
guard. The fork settings/security composition remains present, all required
regressions plus the new focused guard regression pass, and the controller
typechecks.

No commit, merge completion, abort, reset, push, PR, deployment, publication,
tag, release, or Odin mutation was performed.

- `HEAD`: `e4fe19f67bfe9698afa5b78f6fc98a46a45cb01e`
- `MERGE_HEAD`: `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`
- Remaining unresolved paths:
  - `docker/aio/supervisor.sh`
  - `docker/broadcast-entrypoint.sh`

## Interfaces inspected

The following station interfaces are present with the required shapes:

```ts
resolveActiveStationDir(root: string): string
activeStationId(root: string): string | null
createStation(root: string, opts): Promise<{ id: string; converted: boolean }>
activateStation(root: string, id: string): void
listStations(
  root: string,
  fallbackName: string,
  envConfigured?: boolean,
): StationInfo[]
```

`controller/src/config.ts` resolves `STATE_DIR` once at module load through
`resolveActiveStationDir(STATE_ROOT)`. `config.stateDir` is therefore frozen to
the active profile for the life of the process, while `config.stateRoot`
remains the install root. `controller/src/routes/public.ts` independently
captures the active station id and multi-station state at module load so
`GET /state` reports the station this process actually booted, not a pointer
that changed during the switch sequence.

`controller/src/server.ts` mounts the upstream station router. The router
provides admin-gated list, create/duplicate, rename, delete, and activate
operations. Conversion or activation schedules the mixer restart/controller
exit sequence; failed mixer restart attempts leave the upstream warning marker.

The corrective interface is:

```ts
type StationMutationState = 'idle' | 'mutating' | 'switching'
createStationMutationGuard(): StationMutationGuard
stationMutationGuard.run(operation, {
  switchOnResult?,
  switchOnError?,
}): Promise<T>
```

Every mutation owns the singleton guard for its complete async lifetime.
Ordinary success/failure returns it to `idle`; activation, successful legacy
conversion, and `StationCreateError` with `converted: true` promote it to
`switching`, which deliberately has no release path before process exit.

## Station manager safeguard review

The adopted upstream implementation and tests retain:

- single-station root compatibility when no valid active pointer exists;
- defensive active-pointer parsing plus target-directory existence validation;
- lowercase slug validation and path containment checks;
- an eight-profile ceiling using `MAX_STATIONS`;
- atomic active-pointer replacement;
- one-time legacy-root conversion with install-level exclusions;
- best-effort conversion rollback and explicit incomplete-rollback messaging;
- duplicate allowlisting, SQLite backup callback use, and runtime/history skips;
- refusal to duplicate when the active source is missing or corrupt;
- cleanup of partially-created station directories;
- propagation of `converted: true` through a post-conversion create failure;
- active-station delete/activate guards and missing-station validation;
- station card and on-air `settings.station` name synchronization;
- stale target IPC drain for queue, voice, now-playing, jingle, and bed files.

The manager, pure/resolve helpers, and three original station regressions remain
byte-for-byte equal to `MERGE_HEAD`. The station route now adds only the
corrective lifecycle integration, backed by
`controller/scripts/stations-switch-guard.test.ts`.

## Important race correction

The reviewed upstream route flipped `stations/active.json` before
`scheduleSwitchExit()` completed its mixer-restart retries. During that window
the old process still accepted every station mutation even though its
`settings.ts` and `library-db.ts` paths were permanently bound to the old boot
`STATE_DIR`. Consequently:

- renaming the new pointer target could call `settings.update()` against the
  old profile;
- duplicate could select the new pointer source while its backup callback read
  the old profile's open library DB;
- another create, delete, or activation could interleave before process exit;
- activation could terminate an in-progress async duplicate/copy.

The lifecycle guard is acquired before every create/duplicate, rename, delete,
and activation operation. A competing ordinary mutation receives:

```json
{ "error": "station mutation in progress", "switching": false }
```

Once a pointer-moving outcome occurs, the guard is retained until process exit
and every mutation receives the deterministic switch-window response:

```json
{ "error": "station switch in progress", "switching": true }
```

The create policy holds on both `{ converted: true }` success and
`StationCreateError(converted: true)`. A failed conversion that rolled back, a
normal validation failure, and any ordinary non-switch success/failure release
the guard.

## Settings and security composition

Profile-owned state is rooted under boot-frozen `config.stateDir`/`STATE_DIR`.
This includes settings, setup configuration, library database, profiles'
wizard-managed secret store, schedules, moods, themes, beds, stems, runtime
files, and Liquidsoap setting files. Install-root data remains under
`config.stateRoot`; active environment variables remain process/install-level
and intentionally override every profile. `envHasNavidrome()` is threaded into
station listing so an environment-configured install marks every profile
configured even when no profile-local `setup-config.json` exists.

The composed settings surface retains all fork boundaries:

- primary, fallback, and embedding `providerBaseUrls` maps;
- provider-indexed LLM inline keys resolved only through
  `llmKeyFor(provider)`;
- provider-owned cloud TTS credentials, with compatible-server inline bearers
  cleared/ignored for managed OpenAI and ElevenLabs;
- an embedding-owned compatible-server bearer, with
  `EMBEDDING_API_KEY` and provider-matched credentials taking precedence and
  no reuse by an unrelated provider;
- LiteLLM chat-only behavior that preserves an already-effective embedding
  provider instead of leaking the LiteLLM chat connection into embeddings;
- redaction of LLM, fallback, TTS, embedding, search, webhook, scrobble, and
  privacy credentials from the admin read response;
- privacy locks requiring a non-whitespace station password, with listener-auth
  restart behavior retained;
- `llm.strictRequests` and the strict title/artist matching behavior;
- `stream.bufferSeconds` validation bounded to 0–60 seconds;
- editable moods and schedules, beds, themes, stem-cache controls, and
  pair-drain/stem-blend transition settings;
- upstream station name/state settings and all existing Liquidsoap restart
  files.

`POST /settings` keeps the secrecy boundary:

```ts
const result = await settings.update(req.body || {});
res.json(settings.publicUpdateResult(result));
```

`publicUpdateResult()` returns only `{ requiresRestart: boolean }`. The internal
`result.saved` object remains available to in-process live-apply code but never
crosses this response boundary. The focused route regression proves the stored
LiteLLM credential remains internal while neither `saved` nor the token is in
the HTTP response.

## TDD RED/GREEN evidence

### RED 1 — unguarded mutation routes

Added `controller/scripts/stations-switch-guard.test.ts` before production
changes. Its first contract slices each mutating route and requires use of the
shared lifecycle guard.

```text
(cd controller && npx tsx scripts/stations-switch-guard.test.ts)
```

Exit 1, as expected:

```text
AssertionError [ERR_ASSERTION]: create/duplicate route must acquire the shared
station lifecycle guard
```

The failure included the current unguarded `manager.createStation(...)` route
body, directly reproducing the missing serialization at the route boundary.

### GREEN 1 — lifecycle and route integration

Added `controller/src/stations/lifecycle.ts`, then wired every mutation handler
through its singleton guard. Expanded the focused test to cover:

- idle → mutating ownership across a pending async operation;
- rejection of a competing mutation;
- release after ordinary success and ordinary failure;
- permanent switching state after conversion success;
- permanent switching state after `StationCreateError(converted: true)`;
- 409 route responses for fresh create, duplicate, rename, delete, and activate.

The focused command exited 0 with
`stations-switch-guard.test: OK`.

### RED/GREEN 2 — truthful blocking-state response

Review then identified that the first helper revision always described a
conflict as switching, including an ordinary pending duplicate. The test was
changed first to require a truthful ordinary-mutation result.

The focused command exited 1 with:

```text
actual:   'station switch in progress'
expected: 'station mutation in progress'
```

The conflict error now captures the actual blocking state. The next focused run
exited 0 while preserving the exact switch-window 409 body.

## Commands and results

### Upstream multi-station regressions

```text
(cd controller && npx tsx scripts/stations-pure.test.ts)
```

Exit 0: `stations-pure.test: OK`.

```text
(cd controller && npx tsx scripts/stations-resolve.test.ts)
```

Exit 0: `stations-resolve.test: OK`.

```text
(cd controller && npx tsx scripts/stations-manager.test.ts)
```

Exit 0: `stations-manager.test: OK`.

All 3 station scripts passed. The files contain 91 static
`node:assert/strict` call sites in total, including looped classification
tables.

### Focused switch lifecycle regression

```text
(cd controller && npx tsx scripts/stations-switch-guard.test.ts)
```

Exit 0: `stations-switch-guard.test: OK`. This covers the pure lifecycle,
conversion success, converted failure, ordinary release, both conflict shapes,
and all five create/duplicate/rename/delete/activate request variants.

### Fork security/provider regressions

```text
(cd controller && npx tsx scripts/settings-route-security.test.ts)
(cd controller && npx tsx scripts/cloud-tts-provider-key.test.ts)
(cd controller && npx tsx scripts/embedding-provider-config.test.ts)
(cd controller && npx tsx scripts/litellm-config.test.ts)
(cd controller && npx tsx scripts/litellm-routes.test.ts)
(cd controller && npx tsx scripts/request-strict.test.ts)
```

All 6 scripts exited 0. Their output reported 20 named passing behaviors:
public-only settings updates; four cloud-TTS key-ownership cases; eight
embedding/provider isolation cases; LiteLLM effective configuration; two
mounted LiteLLM route/transport checks; and four strict-request cases.

### Typecheck

```text
npm --prefix controller run typecheck
```

Exit 0: `tsc --noEmit`.

### Staging and cached diff

The exact Task 4 staging command from the brief was run:

```text
git add controller/src/stations controller/src/routes/stations.ts \
  controller/src/server.ts controller/src/setup controller/src/config.ts \
  controller/src/settings.ts controller/src/routes/settings.ts \
  controller/src/routes/public.ts controller/src/music/embeddings.ts \
  controller/src/music/tag-library.ts controller/scripts/stations-*.test.ts
git diff --cached --check
```

`git diff --cached --check` exited 0 with no output.

The Task 4 scoped cached name-status has 16 controller paths: the original 14
paths plus the corrective lifecycle helper and focused regression.
`controller/src/music/embeddings.ts` and
`controller/src/music/tag-library.ts` were reviewed and staged by path but have
no Task 4 diff because the existing fork behavior already composes correctly.
The fork security/provider regression scripts were reviewed and run unchanged.
No Task 4 path has an unstaged diff.

`.superpowers/sdd/task-4-review.diff` was regenerated from the complete
16-path scoped cached controller diff. Its header records the exact base and
`MERGE_HEAD`, followed by the scoped stat and full patch. Generated trailing
whitespace inherited from embedded deleted/blank patch lines was normalized so
the staged artifact itself passes `git diff --cached --check`. This report and
the review diff are force-staged because `.superpowers/sdd/.gitignore` ignores
all session artifacts by default.

## Files changed/staged in Task 4 scope

Added upstream:

- `controller/src/stations/pure.ts`
- `controller/src/stations/resolve.ts`
- `controller/src/stations/manager.ts`
- `controller/src/routes/stations.ts`
- `controller/scripts/stations-pure.test.ts`
- `controller/scripts/stations-resolve.test.ts`
- `controller/scripts/stations-manager.test.ts`

Added by the corrective review:

- `controller/src/stations/lifecycle.ts`
- `controller/scripts/stations-switch-guard.test.ts`

Modified/composed/corrected:

- `controller/src/config.ts`
- `controller/src/server.ts`
- `controller/src/setup/config.ts`
- `controller/src/setup/firstRun.ts`
- `controller/src/settings.ts`
- `controller/src/routes/settings.ts`
- `controller/src/routes/public.ts`
- `controller/src/routes/stations.ts`

Reviewed with no additional Task 4 edit:

- `controller/src/music/embeddings.ts`
- `controller/src/music/tag-library.ts`
- `controller/scripts/settings-route-security.test.ts`
- `controller/scripts/cloud-tts-provider-key.test.ts`
- `controller/scripts/embedding-provider-config.test.ts`
- `controller/scripts/litellm-config.test.ts`
- `controller/scripts/litellm-routes.test.ts`
- `controller/scripts/request-strict.test.ts`

Task 3's active-station config composition and `ANALYZE_HANDOFF` removal remain
intact.

## Self-review

- Confirmed exact `MERGE_HEAD`; manager/pure/resolve and the three original
  station tests remain exact upstream while the route has only the reviewed
  lifecycle correction.
- Confirmed the active profile is resolved once and public station state is
  boot-frozen.
- Confirmed every station route is admin-gated and mounted once.
- Confirmed all manager guards named by the brief in code and focused tests.
- Confirmed every mutating route acquires one shared lifecycle guard before any
  pointer move or async profile operation.
- Confirmed ordinary success/failure releases, conversion/activation holds, and
  `StationCreateError(converted: true)` holds until process exit.
- Confirmed ordinary contention reports `switching: false` while the retained
  pointer-switch window reports the exact deterministic 409 with
  `switching: true`.
- Confirmed settings/setup/library/runtime paths use the active profile while
  install environment credentials continue to win across profiles.
- Confirmed URL/key maps are provider-owned across primary, fallback,
  embedding, and cloud TTS paths.
- Confirmed the public settings update response contains only a restart boolean.
- Confirmed privacy, strict requests, stream buffer bounds, moods, beds, themes,
  station settings, and stem/transition settings survive the composition.
- Confirmed all required commands passed and the cached diff is clean.
- Confirmed the two Task 5 shell conflicts remain unresolved.
- Confirmed no commit or external mutation was made.

## Concerns

No Task 4 correctness concern remains. The merge is intentionally not
completable yet because the two shell conflicts are reserved for Task 5.
