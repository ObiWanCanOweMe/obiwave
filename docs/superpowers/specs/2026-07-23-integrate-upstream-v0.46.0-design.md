# Integrate upstream SUB/WAVE v0.46.0

**Date:** 2026-07-23
**Status:** Approved design
**Fork base:** `origin/develop` at `d378ca84a50b463503bafb7235e8971c6f44db0d`
**Upstream tag:** `v0.46.0` at `8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392`

## Goal

Integrate the exact upstream SUB/WAVE v0.46.0 tag into ObiWave with a non-fast-forward merge. Prefer upstream implementations whenever they fully replace fork behavior, while preserving fork-only capabilities and security boundaries.

The result must be a verified local integration branch. Pushing, opening a pull request, releasing, deploying, publishing images, and mutating Odin are outside this design and require a later instruction.

## Merge architecture

Work on `integrate/upstream-v0.46.0`, created from current `origin/develop`. The stale local `develop` checkout is not a valid base and remains untouched.

Merge the exact `v0.46.0` tag with `--no-ff`. The final merge commit must have `8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392` as its second parent. Generated files are recreated from resolved sources rather than edited by hand.

Adopt clean upstream changes directly, including:

- instrumental DJ beds and ElevenLabs bed generation;
- editable moods and the dedicated Moods and Imaging admin pages;
- the shadcn admin sidebar and shared loading, empty, and error states;
- Next.js 16 and its associated web configuration changes;
- Chatterbox input chunking;
- vocal-tag false-positive prevention;
- back-to-back artist variety on the agent picker path;
- stale-theme tolerance for show saves and restores.

## Overlap inventory

Twenty-five paths changed on both sides since v0.45.0. Every one is audited even if Git resolves it automatically. The expected textual conflicts are concentrated in:

- `CLAUDE.md`;
- `controller/src/settings.ts`;
- `docker/aio/supervisor.sh`;
- `docker/broadcast-entrypoint.sh`;
- `docker/icecast.xml.template`;
- `web/components/player/PlayerCore.tsx`;
- `web/hooks/usePlayer.ts`;
- `web/hooks/useStationFeed.ts`.

The generated `cli/src/assets.generated.ts` is discarded and regenerated after its source assets are resolved.

## Stream rendering and listener timing

Upstream v0.46.0 adds per-mount burst sizing and live web-player lag measurement. It improves active web playback but does not fully replace ObiWave's native and non-playing-client timing path.

The merged design is:

1. Keep one shared Icecast renderer used by split and AIO deployments. This preserves a single implementation for mount rendering and listener authentication.
2. Adopt upstream per-mount buffering. MP3 and AAC derive burst bytes from their configured bitrates. Opus derives them from its configured target bitrate. FLAC uses upstream's documented bitrate estimate.
3. Publish a per-format fallback map. Its values describe the intended per-mount delay used by the renderer, including the Opus target and FLAC estimate. Keep the legacy MP3 `bufferSeconds` field for compatibility.
4. For an actively playing web tab, upstream's stable `getListenerLagMs()` measurement wins. It derives actual connection lag from `buffered.end - currentTime` and avoids relying on bitrate estimates.
5. Native and non-playing clients use the per-format fallback selected by their active format.
6. Preserve the four-format selector, MP3 fallback, authenticated stream URLs, private-player audio remount lifecycle, and station-scoped credential storage.

The tests must demonstrate both priority and fallback: measured web lag overrides metadata, while native and non-playing paths continue to resolve the active format's advertised value.

## Settings and provider composition

Compose upstream moods, mood schedules, weather moods, bed settings, and stale-theme validation with fork behavior already present in v0.45.0:

- private-player and listener-auth settings;
- bounded `stream.bufferSeconds` persistence;
- LiteLLM and per-provider base URL state;
- provider-owned inline keys that cannot leak when switching providers;
- the public-only settings update response, which never returns stored credentials.

Upstream mood accessors and the fork's `publicUpdateResult()` occupy the same conflict region; both remain as separate, tested interfaces.

## Analyzer and CUDA ownership

Adopt upstream's v0.46.0 analyzer changes, especially vocal-range gating that prevents mass false-positive vocal tags. Preserve ObiWave's URL/Odin handoff, quiet-times gate, CPU fallback, CUDA device handling, serialized unload behavior, and idle release.

Odin continues to use the upstream CUDA image:

`ghcr.io/perminder-klair/subwave-analyzer-cuda`

ObiWave does not build or publish a CUDA analyzer image. Fork publication remains limited to its existing nine images, and the workflow contract continues to reject `subwave-analyzer-cuda` in the fork publication workflow.

## Admin UI and web toolchain

Take upstream's admin shell, navigation, Imaging/Moods pages, shared state components, Suspense boundaries, and Next.js 16 upgrade as authoritative. Preserve only fork-specific behavior that upstream does not replace, including provider controls, privacy controls, theme extensions, player auth/format behavior, and fork CI scripts.

Package and TypeScript configuration conflicts are resolved toward upstream Next.js 16 defaults, then fork scripts and contracts are reintroduced deliberately. Existing fork styling is retained only where it does not undermine the new upstream shell and component system.

## Generated assets and deployment shapes

After resolving `.env.example`, Compose files, the analyzer GPU overlay, and runtime scripts:

- regenerate CLI embedded assets twice and require no second-run diff;
- regenerate theme tokens twice and require no second-run diff;
- render default, BYO, development, AIO-relevant, and CUDA-overlay Compose shapes without starting containers;
- verify listener authentication is present in every generated mount block only when enabled;
- verify split and AIO rendering remain behaviorally identical.

## Error handling and compatibility

- A missing or invalid listener buffer setting falls back to the validated default.
- Web lag measurement returns `null` when playback is absent, paused, invalid, or stale; callers then use the per-format fallback.
- Existing station-scoped auth tokens are never treated as global credentials.
- Provider switches clear or ignore credentials owned by another provider.
- Analyzer URL mode continues to disable path prefetch, while path and automatic modes retain it.
- The upstream CUDA overlay remains optional and must not change default CPU deployment behavior.
- Existing API consumers continue to receive legacy `bufferSeconds` alongside the per-format extension.

## Verification strategy

Establish a fresh baseline from `origin/develop`, then use focused red-green tests for every hand-composed behavior change. Required verification includes:

- controller unit and repository contract suites;
- web audio-format, stream-auth, provider, onboarding, async-state, and provider-URL contracts;
- native stream-buffer and source-integrity regression;
- split/AIO Icecast rendering and listener-auth behavior;
- settings load/save, mood, beds, stale-theme, and provider-key contracts;
- analyzer quiet gate, Odin handoff, vocal gating, CUDA fallback, and idle-release behavior;
- fork workflow, image-publication, generated-asset, release, and Portainer contracts;
- controller, web, MCP, CLI, and native lint/typecheck gates;
- the Next.js production build;
- deterministic CLI asset and theme-token generation;
- conflict-marker, whitespace, ancestry, and clean-worktree checks.

Task-level reviews inspect each composed seam, followed by an independent whole-branch review. Any material finding is fixed with a regression and followed by fresh affected and full verification.

## Completion criteria

The integration is complete only when:

- all upstream v0.46.0 features are present;
- fork-only behavior listed above remains intact;
- upstream-owned behavior replaces redundant fork code where it fully covers the same clients and guarantees;
- all conflicts and both-sides overlap paths are semantically audited;
- generated files are deterministic;
- the complete verification matrix passes;
- the final local merge commit's second parent is the exact v0.46.0 tag commit;
- the worktree is clean;
- no external publication or deployment action has occurred.
