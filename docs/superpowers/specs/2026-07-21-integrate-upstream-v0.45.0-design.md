# SUB/WAVE v0.45.0 Upstream Integration Design

## Goal

Integrate canonical SUB/WAVE `v0.45.0` into ObiWave while making upstream implementations authoritative wherever they overlap with fork behavior. Preserve only fork-specific capabilities that upstream does not replace, especially LiteLLM configuration, web stream-format selection, remote analyzer URL handoff, and immutable Portainer release automation.

## Release boundary

The integration merges the exact upstream tag `v0.45.0` at commit `0b4b017a73188a8b9c56ed55a6329b34a5f73d8a` into a branch created from ObiWave `develop` at `92d416d99abbf0c8e3fbb8df479bdce7b34ba20d`.

The release contributes:

- private-player gating and listener authentication for every stream mount;
- live-edge buffer metadata and listener-time now-playing synchronization;
- a CUDA analyzer flavor and GPU Compose overlay;
- quiet-time analysis gating;
- a richer theme token system, live theme previews, a modal theme editor, new built-in themes, and distinct built-in fonts;
- strict-show genre matching fixes;
- a working persona-editor discard action and a 2,000-character DJ soul limit;
- an API-key field for OpenAI-compatible cloud TTS;
- admin accessibility and presentation improvements.

The integration does not deploy, push, publish images, change Odin, cut a tag, or create a release.

## Integration strategy

Use a non-fast-forward merge of exact upstream tag `v0.45.0`. The integration merge must retain `v0.45.0` as its second parent so canonical release ancestry remains explicit and future upstream merges remain tractable.

Resolve overlaps upstream-first. Upstream owns every v0.45.0 feature and fix unless retaining fork behavior is necessary for a capability that upstream does not provide or for a documented ObiWave deployment contract.

The merge forecast has six textual conflicts:

- `.env.example`
- `.github/workflows/lint.yml`
- `cli/src/assets.generated.ts`
- `web/components/admin/settings/LlmSection.tsx`
- `web/hooks/usePlayer.ts`
- `web/lib/types.ts`

Files changed on both sides but merged automatically require semantic review. In particular, audit controller settings and routes, analyzer code, Compose files, the fork image workflow, web settings, station feeds, and package metadata for silently lost fields or branches.

## Feature ownership

### Upstream-owned behavior

Adopt upstream implementations for:

- private-player and listener authentication;
- stream buffer sizing and listener-time metadata synchronization;
- CUDA analyzer runtime, device selection, idle model unloading, and GPU overlay;
- quiet-time analysis gating;
- theme tokens, built-ins, editor, preview, fonts, and admin styling;
- strict-show genre matching;
- persona discard and soul-length behavior;
- OpenAI-compatible TTS API-key handling.

Do not recreate or parallel these features in fork-only code.

### Fork-owned behavior

Retain:

- LiteLLM as a chat provider and its provider-specific connection state;
- independent embedding provider URLs and keys;
- embedding rate policy, provider isolation, redaction, and vector-index safeguards;
- the web stream-format selector, including station-scoped persistence, capability gating, runtime failure fallback, and format retuning;
- remote analyzer URL handoff through `ANALYZE_HANDOFF=url` for hosts such as Odin;
- Portainer topology validation, immutable fork release tags, image preflight and scanning, and production deployment gates.

## CUDA analyzer and Odin

ObiWave will not publish a duplicate `subwave-analyzer-cuda` image. The fork image matrix, immutable tag preflight, scan boundary, and release contract remain limited to the existing nine fork images.

Odin will use upstream's maintained `ghcr.io/perminder-klair/subwave-analyzer-cuda` image. The upstream `docker-compose.analyzer-gpu.yml` overlay remains upstream-owned and continues to reference that image. The fork retains `ANALYZE_HANDOFF=url`, allowing the ObiWave controller to send Navidrome stream URLs to the remote analyzer.

This repository integration only makes the code and generated CLI assets aware of the upstream overlay. Changing Odin's running container or deployment configuration is explicitly out of scope.

## Conflict resolution

### Environment example

Resolve `.env.example` additively:

- preserve the fork's `ANALYZE_HANDOFF=url` documentation;
- add upstream `ANALYZE_DEVICE`, `ANALYZE_IDLE_UNLOAD_S`, and `ANALYZE_QUIET_ONLY` guidance;
- retain all LiteLLM and fork deployment variables;
- accept upstream private-station documentation and other new release variables.

### Consolidated CI

Keep `.github/workflows/lint.yml` deleted. ObiWave intentionally consolidated package validation in `.github/workflows/ci.yml`.

Port upstream's theme-token drift check into the controller leg of the consolidated `quality` matrix. It must run the controller theme generator and fail when `web/lib/theme-tokens.generated.ts` differs from the committed mirror.

### Generated CLI assets

Do not hand-merge `cli/src/assets.generated.ts`. Resolve source Compose files and CLI asset declarations first, then regenerate the file with the repository's existing asset generator. The generated output must include `docker-compose.analyzer-gpu.yml`, all upstream Compose changes, and retained fork handoff settings.

### LLM and cloud TTS settings

Resolve `web/components/admin/settings/LlmSection.tsx` by composing upstream's OpenAI-compatible cloud TTS key and current admin presentation with the fork's LiteLLM and per-provider URL architecture.

The result must preserve:

- LiteLLM as a selectable primary and fallback chat provider;
- independent URL state for primary, fallback, and embedding providers;
- distinct Locca and OpenAI-compatible embedding endpoints;
- inline-key handling for LiteLLM and OpenAI-compatible providers;
- provider-specific environment fallbacks;
- primary-versus-fallback probe identity;
- stale async probe cancellation;
- strict-request form hydration and persistence;
- embedding-provider pinning when chat changes could invalidate a vector index;
- the rule that LiteLLM is chat-only;
- secret redaction in settings responses.

### Web player and listener authentication

Resolve `web/hooks/usePlayer.ts` by retaining the fork's explicit format-selection state machine and applying upstream listener credentials to every playback URL.

Authentication must survive:

- initial tune-in;
- MP3, Opus, AAC, and FLAC selection;
- live format switching;
- watchdog reconnects and cache-busting;
- automatic fallback to MP3 after an optional mount fails.

The upstream station-password gate remains authoritative. Private-player mode replaces the player before an audio element is mounted; listener-auth-only mode unlocks the player and supplies the stream token.

### Web response types

Keep one `StreamInfo` interface and one `NowPlayingResponse.stream` property in `web/lib/types.ts`. Preserve the fork selector's known fields and `PublicStreamInfo` compatibility alias, then add upstream `bufferSeconds` and privacy/state fields. Avoid duplicate structural sources of truth.

## Runtime data flow

### Private listener

1. `/state` advertises upstream privacy settings.
2. The upstream station gate prompts once and verifies the shared password through the upstream station-auth route.
3. The gate supplies the listener token to the player.
4. The fork format selector resolves the chosen available encoding.
5. The player appends authentication to the resolved mount URL on tune, switch, reconnect, and fallback.

### Listener-time metadata

1. Icecast burst sizing is derived from the configured stream buffer duration.
2. `/now-playing` publishes `stream.bufferSeconds` at the live edge.
3. Web and native station feeds shift track timing into listener time.
4. Metadata promotion waits until the corresponding buffered audio is audible.
5. Format choice does not alter the upstream timing model.

### Remote analyzer

1. The ObiWave controller resolves `ANALYZE_HANDOFF=url`.
2. It submits a Navidrome stream URL to Odin rather than a controller-local path.
3. Odin's upstream CUDA analyzer fetches and analyzes that URL.
4. Upstream quiet-time policy decides whether an analysis pass may proceed.
5. Results return through the existing analyzer response contract.

## Error handling

- Private-station settings remain disabled by default.
- Protected listener connections fail closed when credentials are absent or incorrect.
- Disabling listener authentication retains upstream's intentional fail-open decision during the mixer-restart transition.
- Optional stream errors fall back to MP3 without deleting the stored listener preference.
- Missing, non-finite, or invalid `bufferSeconds` degrades to the prior timing behavior rather than inventing an offset.
- Remote analyzer fetch or decode failures remain isolated to the current track and do not interrupt broadcasting.
- A CUDA image without usable CUDA logs the condition and falls back to CPU according to upstream behavior.
- Theme-token drift fails CI before merge.
- LiteLLM and embedding secrets remain redacted, and stale connection probes cannot overwrite newer state.

## Verification

Before committing the merge:

1. Confirm no unmerged paths or whitespace errors remain.
2. Audit every file changed on both sides for silently lost settings, branches, dependencies, workflow gates, and generated assets.
3. Confirm the merge commit's second parent is exact tag `v0.45.0`.
4. Install dependencies from merged lockfiles without unintended lockfile drift.
5. Run the full controller test suite, including listener-auth, analyzer quiet-time, analyzer handoff, LiteLLM, embedding, settings-security, strict-show, and theme-token contracts.
6. Add or extend focused web tests proving authentication is applied to every format-selection playback path and MP3 fallback.
7. Run repository-level CI, release, image-preflight, Portainer, and Compose contract tests.
8. Regenerate CLI assets and verify a clean second generation.
9. Run all web pure-function and provider-state tests.
10. Run controller, web, MCP, CLI, and native app lint/typecheck gates.
11. Build the production web application.
12. Validate the base Compose files and upstream analyzer GPU overlay structurally without deploying them.
13. Inspect the final diff and graph to confirm no deployment, push, tag, image publication, Odin mutation, or release occurred.

## Success criteria

- Exact upstream `v0.45.0` is present as the integration merge's second parent.
- All upstream v0.45.0 behavior is present unless a documented fork-only contract composes with it.
- Private listener credentials work across every fork-selectable web stream format and reconnect path.
- Upstream listener-time synchronization works in both web and native clients without weakening stream selection.
- Odin URL handoff remains functional with the upstream analyzer contract.
- ObiWave does not build or publish a fork CUDA analyzer image.
- Theme-token generation is enforced by the consolidated CI workflow.
- LiteLLM, embedding isolation, Portainer deployment, and immutable release contracts remain intact.
- All required verification gates pass and the branch is review-ready without being pushed or deployed.
