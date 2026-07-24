# Integrate upstream SUB/WAVE v0.47.0

**Date:** 2026-07-24
**Status:** Approved design
**Fork base:** `origin/develop` at `dde3f45de28c7ae75c216981c7359c534c259d7c`
**Upstream tag:** `v0.47.0` at `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`

## Goal

Integrate the exact upstream SUB/WAVE v0.47.0 tag into ObiWave with a non-fast-forward merge. Prefer upstream behavior wherever it fully replaces fork behavior, remove the obsolete remote analyzer URL-handoff feature, and preserve fork-only security, playback, deployment, and provider boundaries.

The result is a verified local integration branch. Pushing, opening a pull request, releasing, deploying, publishing images, and mutating Odin remain outside this design and require a later instruction.

## Merge architecture

Work on `integrate/upstream-v0.47.0`, created from current `origin/develop`. The stale local `develop` checkout remains untouched.

Merge the exact `v0.47.0` tag with `--no-ff --no-commit`. The final merge commit must have `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed` as its second parent. Resolve and review the complete merge before creating that commit. Recreate generated files from their resolved sources rather than editing them by hand.

Adopt upstream v0.47.0 behavior, including:

- multi-station profiles with independent state directories and admin switching;
- vocal-aware transition policy and optional pre-rendered stem blends;
- Navidrome configuration in Settings;
- accessibility and UI-fundamentals improvements;
- list views for Skills, Shows, and DJs;
- track-change transitions for the five CSS-only skins;
- admin loading, scrollbar, navigation, and sidebar refinements;
- correct provider-billing guidance in the tagging UI.

## Upstream profile ownership

Upstream multi-station resolution becomes authoritative. A single-station install continues to use the root state directory. Once converted, each station receives its own settings, library database, analysis cache, stem cache, personas, schedule, jingles, and broadcast state under `state/stations/<id>/`.

Retain upstream safeguards:

- a maximum of eight station profiles;
- transactional conversion with best-effort rollback;
- safe fallback when the active pointer is missing, corrupt, or dangling;
- stale IPC cleanup before activation;
- a controller and mixer restart after switching;
- install-level infrastructure secrets and model caches;
- per-station admin configuration when credentials must differ.

ObiWave listener authentication remains effective after every switch. All four Icecast mounts must be re-rendered from the newly active station settings, while the web station gate remains a separate fail-closed boundary.

## Analyzer simplification and stem transitions

Remove the complete ObiWave remote URL-handoff feature. The integration deletes:

- the `ANALYZE_HANDOFF` environment and Compose wiring;
- the corresponding config field and normalization;
- `controller/src/music/analyzer-handoff.ts`;
- URL-mode branches in the analysis pipeline;
- focused URL-handoff tests;
- URL-handoff references in active operator and architecture documentation;
- the historical remote-handoff design and plan documents, which are the only exception to retaining fork planning history.

Older release-integration plans may still describe the behavior they previously preserved; they remain immutable audit history, not active operator guidance.

Analysis returns to upstream's shared-volume flow:

1. The controller waits for the quiet gate before beginning the current track download.
2. It prefetches through the normal local-path pipeline.
3. It passes the shared local path to the analyzer.
4. The analyzer writes metadata and optional stem artifacts into the active station's state directory.
5. Upstream stem-cache retention and transition rendering consume those local artifacts.

Vocal-aware transition metadata works whenever the backend can provide it. Stem blends remain opportunistic: disabled settings, lean analyzers, absent artifacts, cache misses, or render failures fall back to upstream's ordinary transition path without interrupting broadcast.

Odin continues to use the upstream-owned CUDA analyzer image:

`ghcr.io/perminder-klair/subwave-analyzer-cuda`

ObiWave does not build or publish a CUDA analyzer image. The fork publication workflow remains limited to its existing image matrix and continues to reject CUDA analyzer publication. Operators applying the upstream GPU overlay must use an upstream-compatible analyzer tag such as `v0.47.0` or `latest`, not a fork-qualified release tag.

## Fork behavior retained

Preserve fork-only behavior not replaced by upstream:

- authenticated MP3, Opus, AAC, and FLAC playback;
- measured active-web listener lag with active-format advertised fallback for native and non-playing clients;
- station-scoped player credentials, MP3 failure fallback, and detach/remount cleanup;
- one shared Icecast renderer used by split and AIO deployments;
- conditional listener authentication on every rendered mount;
- LiteLLM support and distinct primary, fallback, embedding, and TTS provider URL/key ownership;
- `publicUpdateResult()` as the response boundary for settings updates;
- request strictness, provider discovery, and bounded stream-buffer persistence;
- fork CI, Portainer, exact-tag release, scan, rollback, and image-publication controls;
- upstream-owned CUDA policy with no fork CUDA publication.

Upstream's deletion of its old `docs/superpowers` files must not delete ObiWave's retained design and implementation history, except for the explicitly obsolete remote URL-handoff documents.

## Conflict and overlap strategy

The three-way forecast identifies 22 paths changed on both sides since v0.46.0 and five textual conflicts:

- `CLAUDE.md`;
- `controller/src/config.ts`;
- `controller/src/routes/onboarding.ts`;
- `docker/aio/supervisor.sh`;
- `docker/broadcast-entrypoint.sh`.

Resolve them upstream-first:

- `controller/src/config.ts` and onboarding adopt upstream station resolution and remove all analyzer-handoff configuration.
- Split and AIO scripts retain the fork's shared Icecast renderer and listener-auth composition while adopting upstream's active-station path and restart lifecycle.
- `CLAUDE.md` documents multi-station and stem-transition behavior, retains fork operational invariants, and removes URL-handoff guidance.

Audit all 22 overlap paths even when Git resolves them automatically. Each audit entry must state how upstream and fork behavior compose or why one side fully replaces the other.

## Generated assets and deployment shapes

After resolving environment, Compose, runtime, and documentation sources:

- discard and regenerate `cli/src/assets.generated.ts`;
- regenerate theme tokens;
- run both generators twice and require no second-run diff;
- render default, BYO, development, Portainer, and CUDA-overlay Compose shapes without starting containers;
- verify `ANALYZE_HANDOFF` is absent from source and generated assets;
- verify the upstream CUDA image is absent from fork publication;
- verify all four private mounts receive authentication and public mounts do not;
- verify split and AIO deployments still call the same renderer.

## Error handling and compatibility

- Single-station installations remain valid without migration.
- Failed multi-station conversion restores the root state when possible and leaves a recoverable location when rollback is incomplete.
- Switching stations drains stale IPC before restarting the mixer and controller.
- Missing vocal or stem capability never blocks analysis or broadcast.
- Stem-cache or blend-render failure falls back to an ordinary upstream transition.
- Listener credentials remain station-scoped in browser storage and are never treated as global.
- Provider switches cannot reuse URLs or keys owned by another provider.
- Settings update responses never return stored credentials.
- Existing consumers continue to receive the legacy MP3 buffer field alongside the per-format map.

## Verification strategy

Establish a fresh baseline from `origin/develop`, then use focused red-green tests for hand-composed or removed behavior. Required verification includes:

- a removal contract proving no `ANALYZE_HANDOFF`, URL-mode branch, helper module, focused test, generated asset, or active operator-documentation reference remains, and proving the dedicated remote-handoff design and plan are deleted;
- multi-station pure, manager, resolution, route, activation, rollback, stale-IPC, and state-isolation tests;
- provider ownership and settings-response secrecy across station profiles;
- vocal-aware drain policy, lyric-vocal analysis, stem-cache, stem-blend rendering, and ordinary-transition fallback;
- quiet-gate ordering proving downloads start only after the gate opens;
- split/AIO shared-renderer and four-mount listener-auth tests;
- web/native four-format, station-auth, measured-lag, and active-format fallback contracts;
- upstream admin, Navidrome, accessibility, roster-view, skin-transition, and theme behavior;
- fork workflow, image-publication, release, Portainer, and CUDA-exclusion contracts;
- deterministic CLI asset and theme-token generation;
- default, BYO, development, Portainer, and GPU-overlay Compose rendering;
- controller, Python, repository, web/native, lint/typecheck, Next.js production-build, shell/Python syntax, conflict-marker, whitespace, ancestry, and clean-worktree gates.

Task-level reviews inspect each composed seam, followed by an independent whole-branch review. Any Critical or Important finding is fixed with a regression and followed by fresh affected and full verification.

## Completion criteria

The integration is complete only when:

- all intended upstream v0.47.0 features are present;
- the entire remote analyzer URL-handoff feature is absent;
- upstream multi-station and stem-transition behavior works with the shared-volume analyzer path;
- every retained fork behavior listed above remains intact;
- all five conflicts and all 22 overlap paths are semantically audited;
- generated files are deterministic;
- the complete verification matrix passes;
- the final local merge commit's second parent is the exact v0.47.0 tag commit;
- the worktree is clean;
- no push, pull request, deployment, publication, tag, release, or Odin mutation has occurred.
