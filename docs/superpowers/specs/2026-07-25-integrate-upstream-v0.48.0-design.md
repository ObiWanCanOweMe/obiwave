# Integrate upstream SUB/WAVE v0.48.0

**Date:** 2026-07-25
**Status:** Approved design
**Fork base:** `origin/develop` at `7c56cd1220f917326fd983116809247e36cf093a`
**Upstream tag:** `v0.48.0` at `d0a4254386519511329625b5fb65f23d08b2f70c`

## Goal

Integrate the exact upstream SUB/WAVE v0.48.0 tag into ObiWave with a
non-fast-forward merge. Adopt upstream's split controller and admin architecture
as authoritative, prefer upstream behavior wherever it fully replaces fork
behavior, and preserve fork-only provider, security, playback, deployment, and
release guarantees.

The result is a verified local integration branch. The completed
`feature/kagi-web-search` branch remains separate. Pushing, opening a pull
request, releasing, deploying, publishing images, tagging, and mutating Odin
remain outside this design and require a later instruction.

## Merge architecture

Work on `integrate/upstream-v0.48.0`, created from current `origin/develop`. The
stale local `develop` checkout remains untouched.

Merge exact tag `v0.48.0` with `--no-ff --no-commit`. Resolve and review the
complete merge before creating the merge commit. The final merge commit must
have `d0a4254386519511329625b5fb65f23d08b2f70c` as its second parent.
Generated files are recreated from resolved sources rather than hand-merged.

Adopt upstream v0.48.0 behavior, including:

- the dedicated Rundown page and mobile-safe admin layouts;
- playlist generation as a polled job that survives proxy request limits;
- the station-wide `settings.tts.enabled` voice switch;
- station house rules supplied to both DJ prompt paths;
- station-disabled skill filtering and persona-card description clamping;
- admin imaging, Dash, station creation, and editor-footer polish;
- the refreshed public documentation;
- the controller and web split-file refactor.

## Upstream structural ownership

Upstream's new module boundaries become authoritative. Do not restore the old
monolithic implementations merely to avoid porting fork behavior.

The following upstream splits are retained:

- `controller/src/settings/**` owns defaults, vocabulary, normalization,
  validation, persistence, personas, and Liquidsoap rendering support;
- `controller/src/routes/settings/**` owns core, LLM, station, and TTS settings
  routes;
- `controller/src/music/tag-library/**` owns flag parsing, tagging, enrichment,
  embedding, and logging;
- `controller/src/broadcast/dj-agent/**` and
  `controller/src/broadcast/queue/**` own their respective agent and queue
  responsibilities;
- `controller/src/doctor/**` and `controller/src/music/library-db/**` retain
  their upstream decompositions;
- split admin Dash, Debug, Library, Playlist Builder, Rundown, and Shows
  components remain in their new directories.

Fork-only behavior is moved into the appropriate focused module. Thin upstream
entry modules may re-export composed interfaces, but they must not regain the
discarded implementation bodies. New compatibility shims are allowed only when
they preserve an existing public import surface without duplicating ownership.

## Documentation ownership

Upstream's per-directory `CLAUDE.md` and `AGENTS.md` hierarchy becomes
authoritative. The root `CLAUDE.md` remains concise and describes only
repository-wide responsibilities. Fork invariants move to the narrowest
applicable directory guidance:

- controller provider, settings-secrecy, embedding, request, and analyzer
  invariants live under controller guidance;
- web player, authentication, timing, and provider-form invariants live under
  web guidance;
- native playback invariants live under app guidance;
- Liquidsoap and shared-renderer invariants live under their runtime guidance.

The integration retains ObiWave's design and plan history despite upstream
documentation cleanup.

## Fork behavior retained

Preserve fork-only behavior not replaced by upstream:

- authenticated MP3, Opus, AAC, and FLAC playback;
- measured active-web listener lag with active-format advertised fallback for
  native and non-playing clients;
- station-scoped player credentials, MP3 failure fallback, and
  detach/remount cleanup;
- one shared Icecast renderer used by split and AIO deployments;
- conditional listener authentication on every rendered mount;
- LiteLLM support and distinct primary, fallback, embedding, and TTS provider
  URL/key ownership;
- provider-specific discovery state and protection against cross-provider
  credential or URL reuse;
- `publicUpdateResult()` as the settings-update response secrecy boundary;
- bulk embedding batch selection, bounded rate-limit retries, progress
  accounting, and sanitized operator errors;
- strict listener-request matching and request deduplication;
- bounded per-format stream-buffer persistence;
- fork CI, Portainer, exact-tag release, scan, rollback, and image-publication
  controls;
- upstream-owned CUDA analyzer policy with no fork CUDA publication.

The Kagi search-provider branch is not merged, copied, or anticipated in this
integration.

## Conflict and overlap strategy

The three-way forecast from the v0.47.0 merge base identifies 12 paths changed
on both sides and four textual conflicts.

Textual conflicts:

- `CLAUDE.md`;
- `controller/src/music/tag-library.ts`;
- `controller/src/routes/settings.ts`;
- `controller/src/settings.ts`.

Auto-merged paths requiring semantic audit:

- `README.md`;
- `cli/src/assets.generated.ts`;
- `controller/src/routes/request.ts`;
- `web/components/admin/AdminShell.tsx`;
- `web/components/admin/SettingsPanel.tsx`;
- `web/components/admin/settings/LlmSection.tsx`;
- `web/components/admin/settings/shared.tsx`;
- `web/package.json`.

Resolve all conflicts upstream-first:

- retain upstream thin entry modules and place fork settings ownership,
  normalization, validation, and migration in `controller/src/settings/**`;
- place fork settings route secrecy and provider behavior in
  `controller/src/routes/settings/**`;
- place fork bulk embedding and tag-run behavior in
  `controller/src/music/tag-library/**`;
- distribute fork operating guidance through upstream's directory hierarchy.

Audit all 12 overlap paths even when Git resolves them automatically. Every
audit entry records how upstream and fork behavior compose or why one side
fully replaces the other.

## Upstream feature behavior

### Station-wide voice switch

`settings.tts.enabled` is the authoritative station-level voice policy. When
disabled, the controller suppresses generated DJ speech without interrupting
music playback, queue progression, manual non-speech operations, or station
state. Existing stations without the field retain upstream's compatible
default.

The policy applies consistently to scheduled links, manual generation paths,
and queued voice work. A state change must not leak provider credentials,
collapse provider-specific configuration, or invalidate unrelated station
settings.

### Station house rules

Station house rules are normalized, stored, and supplied to both DJ prompt
paths. They compose with persona, show, and safety instructions rather than
replacing them. Empty rules are inert, and validation bounds from upstream are
retained.

### Playlist jobs and Rundown

Playlist generation uses upstream's job lifecycle and polling API so a reverse
proxy cannot terminate the operation with the initiating request. Jobs expose
pending, running, success, and terminal failure states. A failed job must not
block later jobs or strand the UI in a saving state.

The weekly schedule lives on the dedicated Rundown page. Upstream's mobile
layout, reachable save controls, unsaved-change handling, and editor behavior
remain authoritative.

## Generated assets and deployment shapes

After resolving source environment and Compose files:

- regenerate `cli/src/assets.generated.ts`;
- run the generator twice and require no second-run diff;
- regenerate theme tokens if upstream or the merge changes their inputs;
- render default, BYO, development, Portainer, and CUDA-overlay Compose shapes
  without starting containers;
- verify split and AIO deployments still call the shared Icecast renderer;
- verify all four private mounts receive authentication and public mounts do
  not;
- verify the upstream CUDA image remains absent from fork publication.

## Error handling and compatibility

- Existing settings files load and normalize without destructive migration
  after the upstream module split.
- Missing new voice or house-rule fields use upstream-compatible defaults.
- Disabling station voice never blocks music playback or queue progress.
- House rules reach both prompt paths without displacing persona, show, or
  safety instructions.
- Playlist-job failure is terminal and visible, and later jobs remain
  runnable.
- Provider switches cannot reuse URLs or keys owned by another provider.
- Settings update responses never return stored credentials.
- Bulk embedding retries remain bounded and never log raw gateway errors.
- Existing listener clients retain authenticated four-format playback and the
  legacy MP3 buffer field alongside the per-format map.
- Structural compatibility exports may preserve callers, but fork logic cannot
  be duplicated between old and new module bodies.

## Verification strategy

The pre-merge baseline from exact `origin/develop` must pass before beginning
the merge. The recorded baseline is 64 controller test files, 62 repository
contracts, six web behavior commands, and the native stream-buffer contract.

Focused integration verification includes:

- upstream `house-rules`, `voice-policy`, and `playlist-jobs` tests;
- settings load/normalize/validate/store behavior across the module split;
- LiteLLM and provider URL/key ownership;
- settings route response secrecy and probe isolation;
- embedding batch size, retry, progress, and sanitized-error behavior after
  moving into `tag-library/embed.ts`;
- strict request matching and request deduplication;
- station-wide voice-off behavior across prompt and queue paths;
- house-rule delivery to both prompt paths;
- playlist-job success, failure, polling, and subsequent-job behavior;
- authenticated split/AIO Icecast rendering;
- web/native four-format, station-auth, measured-lag, and active-format
  fallback contracts;
- upstream Rundown, mobile admin, unsaved-state, and split component behavior;
- fork workflow, Portainer, exact-tag release, rollback, scan, and CUDA
  publication-exclusion contracts;
- deterministic CLI asset generation and, when applicable, theme generation;
- default, BYO, development, Portainer, and GPU-overlay Compose rendering.

Full verification includes controller and repository suites, Python worker
checks, web and native behavior contracts, every lint/typecheck gate, the
Next.js production build, shell and Python syntax checks, conflict-marker and
whitespace scans, merge ancestry checks, and a clean-worktree check.

Task-level reviews inspect each composed seam. A final independent whole-branch
review compares the completed merge to this design and its implementation
plan. Every Critical or Important finding is fixed with a regression, followed
by affected and full verification plus focused re-review.

## Completion criteria

The integration is complete only when:

- the final branch begins at exact current `origin/develop`;
- the final merge commit's second parent is exact `v0.48.0`;
- upstream's split controller/admin architecture remains authoritative;
- all intended v0.48.0 features and fixes are present;
- every retained fork behavior listed above remains intact;
- all four conflicts and all 12 overlap paths are semantically audited;
- existing settings remain compatible and secret-safe;
- generated files are deterministic;
- the complete verification matrix passes;
- the worktree is clean;
- no Kagi code is included;
- no push, pull request, deployment, publication, tag, release, or Odin
  mutation has occurred.
