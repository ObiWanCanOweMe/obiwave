# SUB/WAVE v0.44.0 Upstream Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge canonical SUB/WAVE v0.44.0 into ObiWave, adopt upstream's native stream selector, retain the fork's web selector, and compose upstream per-provider URLs with fork LiteLLM behavior.

**Architecture:** Merge the exact upstream release tag into the integration branch and resolve the two predicted conflicts additively. Upstream owns native format selection and the provider-URL data model; fork-only web playback, LiteLLM transport, security, embedding, deployment, and release contracts remain composed around those upstream implementations.

**Tech Stack:** Git, Node.js, TypeScript, React, Next.js, Expo/React Native, Express, Python, Docker Compose, Liquidsoap

## Global Constraints

- Integrate exact upstream tag `v0.44.0` at `de91b458ef28cde99a7586459fe4f5b378b9c559`.
- Preserve the fork's web stream-format selector; use upstream's native stream-format selector without restoring the reverted fork-native implementation.
- Extend upstream `providerBaseUrls` to LiteLLM; do not retain a competing form-level flat `baseUrl` model.
- Preserve fork LiteLLM primary/fallback/onboarding routing, inline-key redaction, stale-result suppression, strict requests, and embedding safeguards.
- Preserve fork Portainer/Caddy topology, CI, and release-tag contracts.
- Do not push, deploy, publish images, or cut a fork release.

---

### Task 1: Merge the exact upstream release and record the conflict baseline

**Files:**
- Merge: all files changed by `v0.44.0`
- Verify: `web/components/admin/settings/LlmSection.tsx`
- Verify: `web/lib/types.ts`

**Interfaces:**
- Consumes: integration branch head based on `develop`; upstream tag `v0.44.0`.
- Produces: an uncommitted two-parent merge with exactly the predicted textual conflicts.

- [ ] **Step 1: Verify the branch and release identity**

Run:

```bash
test "$(git branch --show-current)" = "integrate/upstream-v0.44.0"
test "$(git rev-parse v0.44.0^{commit})" = "de91b458ef28cde99a7586459fe4f5b378b9c559"
git status --short
```

Expected: both `test` commands exit 0 and the working tree is clean.

- [ ] **Step 2: Merge without committing**

Run:

```bash
git merge --no-ff --no-commit v0.44.0
```

Expected: Git stops with content conflicts in only:

```text
web/components/admin/settings/LlmSection.tsx
web/lib/types.ts
```

- [ ] **Step 3: Pin the failing merge state**

Run:

```bash
git diff --name-only --diff-filter=U
rg -n '^<<<<<<< |^=======|^>>>>>>> ' web/components/admin/settings/LlmSection.tsx web/lib/types.ts
npm --prefix web run typecheck
```

Expected: the first command lists exactly the two files above, conflict markers are present, and web typecheck fails because the merge is intentionally unresolved.

### Task 2: Resolve stream typing while keeping upstream native playback authoritative

**Files:**
- Modify: `web/lib/types.ts`
- Review: `app/src/lib/streamFormat.ts`
- Review: `app/src/hooks/useStreamFormat.ts`
- Review: `app/src/hooks/usePlayer.ts`
- Review: `app/src/hooks/useStationFeed.ts`
- Review: `app/src/lib/api.ts`
- Review: `app/src/player/PlayerScreen.tsx`
- Review: `app/src/player/drawers/FormatDrawer.tsx`
- Review: `web/hooks/usePlayer.ts`
- Review: `web/lib/audioFormat.ts`

**Interfaces:**
- Consumes: upstream `StreamInfo`, native `StreamFormat`, and fork `PublicStreamInfo` imports.
- Produces: one web response type and unchanged upstream native format-selection files.

- [ ] **Step 1: Resolve the web stream descriptor to one structural type**

Replace the conflicted stream declarations and duplicate `stream` response properties with:

```ts
/** Structured description of the live broadcast mounts (`stream` on
 * `/now-playing`). MP3 is the required floor; the enabled flags advertise
 * optional sibling mounts. */
export interface StreamInfo {
  mount: string;
  format: 'mp3';
  bitrate?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  opusEnabled: boolean;
  flacEnabled: boolean;
  aacEnabled: boolean;
}

// Compatibility name retained for the fork web selector.
export type PublicStreamInfo = StreamInfo;
```

Keep exactly one property in `NowPlayingResponse`:

```ts
/** Broadcast mount descriptor — drives listener stream-format pickers. */
stream?: StreamInfo;
```

- [ ] **Step 2: Verify the fork web selector still consumes the alias**

Run:

```bash
rg -n 'PublicStreamInfo|StreamInfo|stream\?:' web/lib/types.ts web/hooks/useStationFeed.ts web/hooks/usePlayer.ts web/lib/audioFormat.ts
```

Expected: `useStationFeed` may continue importing `PublicStreamInfo`; `NowPlayingResponse` has only one `stream?` field; no fork web playback file imports native app modules.

- [ ] **Step 3: Verify upstream owns every native selector file**

Run:

```bash
git diff --exit-code v0.44.0 -- \
  app/src/lib/streamFormat.ts \
  app/src/hooks/useStreamFormat.ts \
  app/src/player/drawers/FormatDrawer.tsx
git diff --check -- web/lib/types.ts
```

Expected: the three new native selector files are byte-for-byte upstream and the merged worktree has no whitespace errors outside unresolved conflict markers.

- [ ] **Step 4: Stage the resolved stream type**

Run:

```bash
git add web/lib/types.ts
git diff --name-only --diff-filter=U
```

Expected: only `web/components/admin/settings/LlmSection.tsx` remains unmerged.

### Task 3: Compose upstream provider URLs with fork LiteLLM behavior

**Files:**
- Modify: `web/components/admin/settings/LlmSection.tsx`
- Test: `controller/scripts/litellm-config.test.ts`
- Test: `controller/scripts/litellm-routes.test.ts`
- Test: `controller/scripts/settings-route-security.test.ts`
- Test: `web/scripts/async-result-generation.test.ts`
- Test: `web/scripts/llm-provider-meta.test.ts`

**Interfaces:**
- Consumes: upstream `providerBaseUrls`, Locca defaults, inline-key UI, and fork `useModelDiscovery({ leg, apiKey })`.
- Produces: primary/fallback LiteLLM URLs keyed as `providerBaseUrls.litellm`, with environment fallback and generation-safe probes.

- [ ] **Step 1: Define the composed provider policy before URL-dependent effects**

Use this provider policy near the top of `LlmSection.tsx`:

```ts
const INLINE_KEY_PROVIDERS = ['openai-compatible', 'locca', 'litellm'];
const CUSTOM_URL_PROVIDERS = ['openai-compatible', 'litellm'];
const LOCCA_DEFAULT_BASE_URL = 'http://host.docker.internal:8080/v1';
```

Inside `LlmSection`, derive provider-specific values before effects that reference them:

```ts
const primaryProvider = form.llm.provider;
const fallbackProvider = form.llm.fallback.provider;
const primaryBaseUrl = form.llm.providerBaseUrls[primaryProvider] ?? '';
const fallbackBaseUrl = form.llm.fallback.providerBaseUrls[fallbackProvider] ?? '';
const liteLlmEnvBaseUrlSet = !!(data.env?.LITELLM_API_BASE || data.env?.OPENAI_API_BASE);
const primaryTestBaseUrl =
  primaryBaseUrl || (primaryProvider === 'locca' ? LOCCA_DEFAULT_BASE_URL : '');
const fallbackTestBaseUrl =
  fallbackBaseUrl || (fallbackProvider === 'locca' ? LOCCA_DEFAULT_BASE_URL : '');
const primaryUrlAvailable =
  !!primaryTestBaseUrl.trim() || (primaryProvider === 'litellm' && liteLlmEnvBaseUrlSet);
const fallbackUrlAvailable =
  !!fallbackTestBaseUrl.trim() || (fallbackProvider === 'litellm' && liteLlmEnvBaseUrlSet);
```

Update probe invalidation dependencies to use `primaryBaseUrl` and `fallbackBaseUrl`, never removed `form.llm.baseUrl` fields.

- [ ] **Step 2: Resolve discovery and save conflicts additively**

Primary discovery must keep the fork transport arguments while reading upstream URL state:

```ts
const primaryDiscoveryEnabled =
  primaryProvider === 'ollama'
  || primaryProvider === 'locca'
  || (CUSTOM_URL_PROVIDERS.includes(primaryProvider) && primaryUrlAvailable)
  || primaryProvider === 'openrouter'
  || (!!primaryKeyVar && primaryKeySet);

const primaryDiscovery = useModelDiscovery({
  provider: primaryProvider,
  leg: 'primary',
  apiKey: compatKeyInput,
  baseUrl: primaryBaseUrl,
  ollamaUrl: form.llm.ollamaUrl,
  enabled: primaryDiscoveryEnabled,
  adminFetch,
});
```

Mirror this for fallback with `fallbackProvider`, `leg: 'fallback'`, `compatFallbackKeyInput`, `fallbackBaseUrl`, and `fallbackUrlAvailable`.

Keep upstream `providerBaseUrls` in both save payloads and preserve the fork field:

```ts
strictRequests: form.llm.strictRequests,
```

Use `INLINE_KEY_PROVIDERS.includes(activeProvider)` and its fallback equivalent for inline key save and input clearing. This makes upstream's inline-key route authoritative while extending it to LiteLLM.

- [ ] **Step 3: Resolve primary and fallback URL controls without shared-key leakage**

For primary and fallback custom URL inputs, index by the active provider:

```ts
value={form.llm.providerBaseUrls[primaryProvider] ?? ''}
```

```ts
providerBaseUrls: {
  ...f.llm.providerBaseUrls,
  [primaryProvider]: e.target.value,
}
```

and:

```ts
value={form.llm.fallback.providerBaseUrls[fallbackProvider] ?? ''}
```

```ts
providerBaseUrls: {
  ...f.llm.fallback.providerBaseUrls,
  [fallbackProvider]: e.target.value,
}
```

Retain upstream's separate Locca URL blocks and one generic inline bearer-token block per leg. The token test calls must keep the fork signature:

```ts
testCompatKey(
  'primary',
  primaryProvider,
  compatKeyInput,
  primaryTestBaseUrl,
  form.llm.model,
  primaryUrlAvailable,
  setCompatKeyTesting,
  setCompatKeyTest,
  primaryProbeGeneration.current,
)
```

Mirror it for fallback. Disable the button with `!primaryUrlAvailable` or `!fallbackUrlAvailable`, allowing environment-backed LiteLLM tests even when the form URL is blank.

- [ ] **Step 4: Remove every conflict marker and obsolete flat form reference**

Run:

```bash
rg -n '^<<<<<<< |^=======|^>>>>>>> |form\.llm(\.fallback)?\.baseUrl' web/components/admin/settings/LlmSection.tsx
git add web/components/admin/settings/LlmSection.tsx
test -z "$(git diff --name-only --diff-filter=U)"
```

Expected: `rg` returns no matches and there are no unmerged paths.

- [ ] **Step 5: Run the focused contracts**

Run:

```bash
npm --prefix controller exec -- tsx scripts/litellm-config.test.ts
npm --prefix controller exec -- tsx scripts/litellm-routes.test.ts
npm --prefix controller exec -- tsx scripts/settings-route-security.test.ts
npm --prefix web run test:llm-provider
npm --prefix web run test:async-generation
npm --prefix web run typecheck
```

Expected: every command passes. A failure involving `providerBaseUrls`, a missing `leg`, a leaked key, or duplicate stream typing blocks further work.

### Task 4: Audit every automatic overlap and upstream-owned feature

**Files:**
- Review: `cli/src/assets.generated.ts`
- Review: `controller/scripts/analyze_worker.py`
- Review: `controller/src/config.ts`
- Review: `controller/src/routes/request.ts`
- Review: `controller/src/routes/settings.ts`
- Review: `controller/src/settings.ts`
- Review: `web/components/admin/SettingsPanel.tsx`
- Review: `web/components/admin/settings/shared.tsx`
- Review: `web/package.json`
- Review: all files changed by `v0.43.0..v0.44.0`

**Interfaces:**
- Consumes: the conflict-free merged index.
- Produces: an evidence-backed semantic audit with all upstream release capabilities and fork contracts present.

- [ ] **Step 1: Recreate and inspect the overlap inventory**

Run:

```bash
base=$(git merge-base HEAD v0.44.0)
comm -12 \
  <(git diff --name-only "$base"..HEAD | sort) \
  <(git diff --name-only "$base"..v0.44.0 | sort)
```

Expected: review all 11 overlapping paths recorded in the design. Because `HEAD` remains the pre-merge first parent during an uncommitted merge, the inventory represents fork-versus-upstream changes from v0.43.0.

- [ ] **Step 2: Check the critical composed contracts structurally**

Run:

```bash
rg -n 'litellm|providerBaseUrls|strictRequests|publicUpdateResult' \
  controller/src/settings.ts controller/src/routes/settings.ts \
  web/components/admin/SettingsPanel.tsx \
  web/components/admin/settings/LlmSection.tsx \
  web/components/admin/settings/shared.tsx
rg -n 'introPersona|request-strict' controller/src/routes/request.ts
rg -n 'ensure_fast_decode|decoded_tmp|handoff' controller/scripts/analyze_worker.py
rg -n 'onAirLocation|stationDescription|oggIcyMetadata' \
  controller/src/config.ts controller/src/settings.ts \
  web/components/admin/SettingsPanel.tsx \
  web/components/admin/settings/shared.tsx
```

Expected: each combined contract is represented on both its storage/runtime side and its admin/client side.

- [ ] **Step 3: Confirm all upstream native and release features landed**

Run:

```bash
for commit in 495e99b2 6adaa677 9e82a074 130b0fef 1bc7265 48c9d62f \
  6465b93a fa3e15de a63ec997 53f87809 021db50d 03204c00 94669272; do
  git merge-base --is-ancestor "$commit" MERGE_HEAD
done
```

Expected: every upstream feature/fix commit is an ancestor of the merge's second parent.

- [ ] **Step 4: Run fork-specific and upstream controller contracts**

Run:

```bash
npm --prefix controller test
node --test scripts/**/*.test.mjs
for test_file in web/scripts/*.test.ts; do
  node --experimental-strip-types "$test_file"
done
```

Expected: all controller, deployment/release, and web pure tests pass.

### Task 5: Run release-grade verification and commit the integration

**Files:**
- Verify: repository-wide merged tree
- Commit: merge result

**Interfaces:**
- Consumes: resolved, audited merge index.
- Produces: one local merge commit whose second parent is exact tag `v0.44.0`.

- [ ] **Step 1: Refresh every dependency tree from lockfiles**

Run:

```bash
npm ci
npm --prefix cli ci
npm --prefix controller ci
npm --prefix web ci
npm --prefix app ci
npm --prefix mcp-subwave ci
git status --short
```

Expected: installs exit 0 and do not modify tracked lockfiles or source files.

- [ ] **Step 2: Run all lint and typecheck gates**

Run:

```bash
npm --prefix controller run lint
npm --prefix web run lint
npm --prefix mcp-subwave run lint
npm run cli:typecheck
npm --prefix app run lint
npm --prefix app run typecheck
```

Expected: every command exits 0. Non-fatal pre-existing warnings may be recorded, but errors block the merge commit.

- [ ] **Step 3: Build the production web application**

Run:

```bash
npm --prefix web run build
```

Expected: Next.js production compilation and static generation complete successfully.

- [ ] **Step 4: Inspect merge integrity before committing**

Run:

```bash
git diff --check
test -z "$(git diff --name-only --diff-filter=U)"
git diff --cached --stat
git status --short --branch
test "$(git rev-parse MERGE_HEAD)" = "$(git rev-parse v0.44.0^{commit})"
```

Expected: no whitespace errors or conflicts, the staged diff contains the upstream release plus only intended resolutions, and `MERGE_HEAD` is exact v0.44.0.

- [ ] **Step 5: Commit and verify the two-parent graph**

Run:

```bash
git commit -m "merge: integrate subwave v0.44.0"
test "$(git rev-parse HEAD^2)" = "$(git rev-parse v0.44.0^{commit})"
git status --short --branch
git show --stat --summary --oneline HEAD
```

Expected: one merge commit is created, its second parent is v0.44.0, and the worktree is clean. Do not push, deploy, publish, or tag.
