# SUB/WAVE v0.44.0 Upstream Integration Design

## Goal

Integrate the canonical SUB/WAVE `v0.44.0` release into ObiWave while preferring upstream implementations wherever they overlap with fork work. Preserve fork-only behavior that has no upstream equivalent, especially the web stream-format selector, LiteLLM support, embedding safeguards, deployment topology, and fork release automation.

## Release boundary

The integration merges the exact upstream tag `v0.44.0` at commit `de91b458ef28cde99a7586459fe4f5b378b9c559` into a branch created from ObiWave `develop`.

The release contributes:

- native listener-selectable MP3, AAC, Opus, and FLAC streams;
- native on-air track likes and saved-station removal;
- a separate public on-air location and precise weather location;
- cloud TTS voice discovery;
- a station-level social and embed description;
- track-boundary show handoffs and air-time request intros;
- configured-engine TTS fallback before Piper;
- operator-controlled ICY metadata on Ogg mounts;
- per-provider base URLs for Locca and OpenAI-compatible providers;
- analyzer pre-decoding, fallback loudness gain, and release metadata updates.

The integration does not deploy, push, publish images, or cut an ObiWave release.

## Integration strategy

Use a non-fast-forward merge of the exact upstream release tag. This preserves canonical release ancestry and keeps future upstream merges straightforward.

Resolve conflicts upstream-first: when upstream now supplies the same user-facing capability, its implementation becomes authoritative. Fork code remains only when it provides a capability or operational contract absent from upstream, or when it is required to compose an upstream change with a fork-specific provider.

The merge forecast has two textual conflicts:

- `web/components/admin/settings/LlmSection.tsx`
- `web/lib/types.ts`

Nine additional files changed on both sides and require semantic review even when Git merges them automatically:

- `cli/src/assets.generated.ts`
- `controller/scripts/analyze_worker.py`
- `controller/src/config.ts`
- `controller/src/routes/request.ts`
- `controller/src/routes/settings.ts`
- `controller/src/settings.ts`
- `web/components/admin/SettingsPanel.tsx`
- `web/components/admin/settings/shared.tsx`
- `web/package.json`

## Stream-format ownership

### Native app

Adopt upstream's native stream-format feature as shipped. Upstream owns the native format model, per-station preference storage, platform and station capability gating, player retuning, format drawer, and MP3 fallback floor through:

- `app/src/lib/streamFormat.ts`
- `app/src/hooks/useStreamFormat.ts`
- `app/src/hooks/usePlayer.ts`
- `app/src/hooks/useStationFeed.ts`
- `app/src/player/drawers/FormatDrawer.tsx`
- the upstream wiring in the native player and station API

ObiWave's earlier native selector was reverted before this integration, so no fork-native selector should be restored or layered over upstream.

### Web app

Retain ObiWave's web format selector because v0.44.0 does not provide one. The existing web implementation continues to own browser capability detection, station-scoped persistence, runtime failure fallback, format switching, accessible drawer presentation, and the no-silent-Opus-upgrade policy.

Resolve the `web/lib/types.ts` conflict with one `StreamInfo` interface compatible with the public `/now-playing` response. Preserve the fork's stricter known fields where accurate, while allowing the upstream native copy and server response to evolve without defining two `stream` properties on `NowPlayingResponse`. `PublicStreamInfo` may remain as an alias for compatibility with existing fork imports, but there must be a single response field and a single structural source of truth in the web client.

## LiteLLM and per-provider URLs

Upstream's `providerBaseUrls` storage model replaces the legacy single `baseUrl` form state for primary, fallback, and embedding providers. ObiWave extends that upstream model to include LiteLLM rather than retaining a parallel fork-only URL mechanism.

The composed admin behavior must preserve:

- LiteLLM as a selectable primary and fallback chat provider;
- per-provider primary and fallback URLs, including independent OpenAI-compatible and LiteLLM values;
- environment-provided LiteLLM base URLs when the form value is blank;
- inline API keys for LiteLLM and OpenAI-compatible providers;
- primary versus fallback probe identity;
- stale async probe invalidation when provider, URL, model, or typed key changes;
- the fork's strict-request setting in load and save paths;
- embedding-provider pinning when a chat-provider switch would invalidate an existing vector index;
- the rule that LiteLLM is chat-only and cannot become an inherited embedding provider;
- redaction of inline keys from settings responses.

Use upstream's Locca default URL and upstream's per-provider migration behavior. Do not duplicate URL state between `baseUrl` and `providerBaseUrls`; the controller may continue deriving a legacy flat value internally where upstream runtime compatibility requires it.

## Other overlapping settings

Compose automatically merged settings changes additively:

- retain fork LiteLLM, embedding rate policy, strict requests, and response redaction;
- accept upstream station description, on-air location, Ogg metadata, cloud voice discovery, and provider URL migration;
- keep every new setting represented consistently in defaults, normalization, validation, persistence, public/admin responses, form hydration, form save payloads, and runtime config mirroring;
- invalidate cached weather immediately when either precise weather coordinates or public attribution changes;
- never expose the precise weather location where upstream intends the broader on-air location.

Request-route composition must retain the fork's strict matching and upstream's delayed intro persona attribution. Analyzer composition must retain the fork's remote handoff behavior and upstream's one-time ffmpeg pre-decode cleanup.

## History and documentation

The merge retains upstream release metadata and changelog entries. Fork documentation and CI/deployment files remain unless upstream explicitly changes the same operational contract.

The committed implementation should be one merge commit with parents consisting of the integration-branch head (based on `develop`, including its design and plan commits) and `v0.44.0`.

## Error handling

- A native optional stream that is unavailable for the current platform or no longer advertised resolves to MP3 through upstream's effective-format policy.
- Web optional-stream runtime failures keep the fork's session fallback to MP3 and do not erase the stored preference.
- Provider URL migration preserves existing saved URLs under their active provider key.
- LiteLLM connection tests accept either a saved per-provider URL or the supported environment fallback and retain generation-based stale-result suppression.
- Cloud voice discovery failures remain non-fatal and fall back to manual voice entry.
- Analyzer pre-decode failures retain the original decoding path and clean temporary files best-effort.

## Verification

Before committing the merge:

1. Confirm there are no unmerged paths or whitespace errors.
2. Audit all files changed on both sides for silently lost fields, branches, settings, dependencies, and generated assets.
3. Install dependencies from the merged lockfiles without lockfile drift.
4. Run the complete controller test suite, including upstream v0.44.0 tests and fork LiteLLM, embedding, request, and settings-security contracts.
5. Run repository-level deployment, CI, release, Portainer, and compose contract tests.
6. Run web pure-function tests, including audio-format and provider-state contracts.
7. Run controller, web, MCP, and CLI lint or typecheck gates.
8. Run the native app lint/typecheck gate.
9. Build the production web application.
10. Inspect the final merge diff and commit graph to confirm the exact upstream tag is a parent and no deployment or release action occurred.

## Success criteria

- `v0.44.0` is present in ObiWave history as a merge parent.
- Upstream's native stream selector is used without resurrecting the reverted fork-native implementation.
- ObiWave's web stream selector remains functional.
- LiteLLM works with upstream's per-provider URL architecture without losing fork security, probing, or embedding safeguards.
- Every upstream v0.44.0 feature and fix is present unless explicitly superseded by a documented fork-only contract.
- All required verification gates pass, and the branch is ready for review without being pushed or deployed.
