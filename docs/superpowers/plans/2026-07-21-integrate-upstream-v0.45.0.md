# SUB/WAVE v0.45.0 Upstream Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge exact upstream SUB/WAVE `v0.45.0` into ObiWave, adopt overlapping upstream behavior, and preserve only documented fork-specific provider, player, analyzer-handoff, and deployment contracts.

**Architecture:** Perform one non-fast-forward merge whose second parent is exact upstream tag `v0.45.0`. Resolve the six textual conflicts upstream-first, compose fork-only behavior at explicit seams, and keep all integration code in the final merge commit. Odin uses upstream's CUDA analyzer image; ObiWave continues publishing exactly nine fork images.

**Tech Stack:** Git, Node.js 22, TypeScript, React/Next.js, Expo/React Native, Express, Docker Compose, GitHub Actions, Python analyzer worker, Node test runner, ESLint, and TypeScript.

## Global Constraints

- Merge exact tag `v0.45.0` at `0b4b017a73188a8b9c56ed55a6329b34a5f73d8a`; do not merge a moving upstream branch.
- The final merge commit's second parent must be `0b4b017a73188a8b9c56ed55a6329b34a5f73d8a`.
- Prefer upstream v0.45.0 implementations whenever they overlap fork behavior.
- Retain LiteLLM, embedding-provider isolation, web format selection, `ANALYZE_HANDOFF=url`, Portainer deployment, and immutable fork-release controls.
- Use upstream `ghcr.io/perminder-klair/subwave-analyzer-cuda`; do not build or publish `subwave-analyzer-cuda` in ObiWave.
- Keep private-station behavior disabled by default and preserve upstream authentication failure modes.
- Preserve MP3 as the web player's universal runtime fallback without erasing stored format preference.
- Do not deploy, push, publish images, mutate Odin, tag, or cut a release during integration.
- Do not commit while merge conflicts remain. Tasks 2–7 operate inside one uncommitted merge; Task 8 creates the merge commit.

## File responsibility map

- `.github/workflows/ci.yml`: consolidated package validation and generated theme-token drift gate.
- `.github/workflows/publish-images.yml`: exactly nine immutable fork images; no fork CUDA analyzer.
- `.github/workflows/verify-cli-assets.yml`: regenerate embedded assets when any embedded Compose source changes.
- `scripts/ci/workflow-contract.test.mjs`: pins consolidated CI and nine-image publication policy.
- `web/lib/stationAuth.ts`: upstream station password storage, validation, and stream URL authentication.
- `web/hooks/usePlayer.ts`: fork format state machine composed with upstream authenticated playback URLs.
- `web/lib/types.ts`: one stream response model containing optional-mount, buffer, and privacy metadata.
- `web/scripts/stream-auth-format.test.ts`: focused regression coverage for authenticated format URLs and player source assignments.
- `web/components/admin/settings/LlmSection.tsx`: upstream admin/TTS improvements composed with fork LiteLLM and per-provider URLs.
- `controller/src/settings.ts` and provider files: upstream v0.45.0 settings plus fork provider isolation and secret handling.
- `controller/src/music/analyze.ts` and `controller/scripts/analyze_worker.py`: upstream quiet/CUDA behavior composed with fork URL handoff.
- `docker-compose*.yml`: upstream analyzer device settings plus retained fork controller handoff.
- `docker-compose.analyzer-gpu.yml`: upstream-owned GPU overlay pointing to upstream's CUDA analyzer image.
- `cli/scripts/embed-assets.ts`, `cli/src/assets.ts`, and CLI commands: distribute the upstream analyzer GPU overlay.
- `cli/src/assets.generated.ts`: generated output only; never hand-edit.

---

### Task 1: Prepare the isolated integration workspace and baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-21-integrate-upstream-v0.45.0-design.md`
- Read: `docs/superpowers/plans/2026-07-21-integrate-upstream-v0.45.0.md`

**Interfaces:**
- Consumes: branch `integrate/upstream-v0.45.0` containing the approved design and plan commits.
- Produces: clean isolated worktree with installed dependencies and a passing pre-merge baseline.

- [ ] **Step 1: Move the branch out of the main checkout and create its worktree**

From the main repository checkout:

```bash
git switch develop
git worktree add .worktrees/integrate-upstream-v0.45.0 integrate/upstream-v0.45.0
cd .worktrees/integrate-upstream-v0.45.0
```

Expected: the main checkout is on `develop`; the isolated worktree is on `integrate/upstream-v0.45.0`.

- [ ] **Step 2: Install all package dependencies reproducibly**

```bash
npm ci --no-audit --no-fund
npm --prefix controller ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm --prefix mcp-subwave ci --no-audit --no-fund
npm --prefix cli ci --no-audit --no-fund
npm --prefix app ci --no-audit --no-fund
```

Expected: every command exits 0 and does not change a committed lockfile.

- [ ] **Step 3: Run the baseline suites**

```bash
npm --prefix controller test
node --test scripts/**/*.test.mjs
npm --prefix web run test:audio-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
```

Expected: all baseline tests pass. Stop and report any pre-existing failure before merging.

- [ ] **Step 4: Confirm the worktree remains clean**

```bash
git status --short
```

Expected: no output.

### Task 2: Start the exact upstream merge and inventory conflicts

**Files:**
- Merge: all paths changed by `v0.44.0..v0.45.0`
- Conflict: `.env.example`
- Conflict: `.github/workflows/lint.yml`
- Conflict: `cli/src/assets.generated.ts`
- Conflict: `web/components/admin/settings/LlmSection.tsx`
- Conflict: `web/hooks/usePlayer.ts`
- Conflict: `web/lib/types.ts`

**Interfaces:**
- Consumes: clean Task 1 worktree and exact tag `v0.45.0`.
- Produces: one in-progress non-fast-forward merge with the expected six unresolved paths.

- [ ] **Step 1: Verify the exact tag object**

```bash
test "$(git rev-parse 'v0.45.0^{}')" = 0b4b017a73188a8b9c56ed55a6329b34a5f73d8a
```

Expected: exit 0.

- [ ] **Step 2: Begin the merge without committing**

```bash
git merge --no-ff --no-commit v0.45.0
```

Expected: Git stops with conflicts and does not create a commit.

- [ ] **Step 3: Verify the forecasted conflict set**

```bash
git diff --name-only --diff-filter=U | sort
```

Expected exactly:

```text
.env.example
.github/workflows/lint.yml
cli/src/assets.generated.ts
web/components/admin/settings/LlmSection.tsx
web/hooks/usePlayer.ts
web/lib/types.ts
```

- [ ] **Step 4: Confirm the merge parent recorded by Git**

```bash
test "$(git rev-parse MERGE_HEAD)" = 0b4b017a73188a8b9c56ed55a6329b34a5f73d8a
```

Expected: exit 0.

### Task 3: Pin consolidated CI and the nine-image release boundary

**Files:**
- Modify: `scripts/ci/workflow-contract.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Delete: `.github/workflows/lint.yml`
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/verify-cli-assets.yml`

**Interfaces:**
- Consumes: upstream `npm run gen:themes` and upstream automatic CUDA matrix addition.
- Produces: generated-theme drift detection in consolidated CI and an explicit prohibition on fork CUDA publication.

- [ ] **Step 1: Add failing workflow contract assertions**

Add these reads and assertions to `scripts/ci/workflow-contract.test.mjs`:

```js
const verifyCliAssets = await readFile(
  new URL('../../.github/workflows/verify-cli-assets.yml', import.meta.url),
  'utf8',
);

test('consolidated CI verifies the generated theme-token mirror', () => {
  assert.match(ci, /if: matrix\.package == 'controller'[\s\S]*npm run gen:themes/);
  assert.match(ci, /git diff --exit-code \.\.\/web\/lib\/theme-tokens\.generated\.ts/);
});

test('fork releases deliberately exclude the upstream CUDA analyzer image', () => {
  assert.doesNotMatch(publish, /subwave-analyzer-cuda/);
});

test('CLI asset drift watches the analyzer GPU overlay', () => {
  assert.match(verifyCliAssets, /docker-compose\.analyzer-gpu\.yml/);
});
```

- [ ] **Step 2: Run the workflow contract to verify it fails**

```bash
node --test scripts/ci/workflow-contract.test.mjs
```

Expected: failures for missing consolidated theme generation, the CUDA build entry, and the missing GPU-overlay path filter.

- [ ] **Step 3: Resolve the workflow files**

Apply these exact policies:

```yaml
# .github/workflows/ci.yml, in the quality job after dependency installation
- name: Verify theme-token mirror is up to date
  if: matrix.package == 'controller'
  run: |
    npm run gen:themes
    git diff --exit-code ../web/lib/theme-tokens.generated.ts
```

Delete `.github/workflows/lint.yml`, remove the upstream `subwave-analyzer-cuda` entry from `.github/workflows/publish-images.yml`, and add this path to both `pull_request.paths` and `push.paths` in `.github/workflows/verify-cli-assets.yml`:

```yaml
- "docker-compose.analyzer-gpu.yml"
```

Keep all existing nine-image preflight, build, scan, and deploy gates unchanged.

- [ ] **Step 4: Run the workflow contracts again**

```bash
node --test scripts/ci/workflow-contract.test.mjs
```

Expected: all workflow contract tests pass.

- [ ] **Step 5: Stage the resolved modify/delete conflict**

```bash
git add .github/workflows/ci.yml .github/workflows/lint.yml .github/workflows/publish-images.yml .github/workflows/verify-cli-assets.yml scripts/ci/workflow-contract.test.mjs
```

Expected: `.github/workflows/lint.yml` no longer appears as unmerged.

### Task 4: Compose authenticated playback with fork format selection

**Files:**
- Create: `web/scripts/stream-auth-format.test.ts`
- Modify: `web/package.json`
- Modify: `.github/workflows/ci.yml`
- Resolve: `web/hooks/usePlayer.ts`
- Resolve: `web/lib/types.ts`
- Adopt: `web/lib/stationAuth.ts`
- Adopt: `web/components/player/StationGate.tsx`
- Adopt: `web/components/player/PlayerShell.tsx`

**Interfaces:**
- Consumes: upstream `withStreamAuth(url: string): string`, `StationPasswordGate`, `useStationAuth`, `stream.bufferSeconds`, and fork `AudioFormat` selection APIs.
- Produces: every non-empty playback `src` assignment carries the station token while format selection and MP3 fallback remain intact.

- [ ] **Step 1: Add the failing authenticated-format regression test**

Create `web/scripts/stream-auth-format.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearStationAuthToken, setStationAuthToken, withStreamAuth } from '../lib/stationAuth.ts';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  },
});

const token = 'shared password/&';
setStationAuthToken(token);
for (const format of ['mp3', 'opus', 'aac', 'flac']) {
  assert.equal(
    withStreamAuth(`/stream.${format}?t=123`),
    `/stream.${format}?t=123&auth=${encodeURIComponent(token)}`,
  );
}
clearStationAuthToken();
assert.equal(withStreamAuth('/stream.mp3?t=123'), '/stream.mp3?t=123');

const source = readFileSync(new URL('../hooks/usePlayer.ts', import.meta.url), 'utf8');
const assignments = [...source.matchAll(/(?:audio|el)\.src\s*=\s*([^;]+);/g)]
  .map((match) => match[1])
  .filter((expression) => expression.trim() !== "''");
assert.ok(assignments.length >= 2, 'expected tune/switch/reconnect playback assignments');
for (const expression of assignments) {
  assert.match(expression, /withStreamAuth/, `unauthenticated playback assignment: ${expression}`);
}

console.log('stream-auth-format: all assertions passed');
```

Add the package script:

```json
"test:stream-auth-format": "node --experimental-strip-types scripts/stream-auth-format.test.ts"
```

Append `npm run test:stream-auth-format` to the web command in `.github/workflows/ci.yml`.

- [ ] **Step 2: Run the new test and verify it fails against the unresolved player**

```bash
npm --prefix web run test:stream-auth-format
```

Expected: failure because `usePlayer.ts` is unresolved or at least one active playback assignment does not call `withStreamAuth`.

- [ ] **Step 3: Resolve `web/lib/types.ts` as one response model**

Keep one interface shaped as follows:

```ts
export interface StreamInfo {
  mount: string;
  format: 'mp3';
  bitrate?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  opusEnabled: boolean;
  flacEnabled: boolean;
  aacEnabled: boolean;
  bufferSeconds?: number | null;
}

export type PublicStreamInfo = StreamInfo;
```

Keep upstream privacy fields on `StationState`, upstream `current.startedAt`, and exactly one optional `stream?: StreamInfo` property on `NowPlayingResponse`.

- [ ] **Step 4: Resolve `web/hooks/usePlayer.ts` upstream-first at the authentication seam**

Retain the fork's `format`, `availability`, `selectFormat`, `formatFailure`, `hydrateFormatPreference`, and MP3 failure fallback. Import upstream authentication:

```ts
import { withStreamAuth } from '@/lib/stationAuth';
```

Every active playback assignment must follow this form:

```ts
audio.src = withStreamAuth(`${nextUrl}?t=${Date.now()}`);
```

Use the same wrapper for initial tune-in, live format switching, watchdog reconnect, and MP3 reconnect after an optional format error. Do not wrap `el.src = ''` during stop.

- [ ] **Step 5: Run focused web behavior tests**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Stage the resolved web player conflicts**

```bash
git add web/hooks/usePlayer.ts web/lib/types.ts web/lib/stationAuth.ts web/components/player/StationGate.tsx web/components/player/PlayerShell.tsx web/scripts/stream-auth-format.test.ts web/package.json .github/workflows/ci.yml
```

Expected: `web/hooks/usePlayer.ts` and `web/lib/types.ts` no longer appear as unmerged.

### Task 5: Compose upstream admin changes with LiteLLM and embedding isolation

**Files:**
- Resolve: `web/components/admin/settings/LlmSection.tsx`
- Review: `web/components/admin/settings/shared.tsx`
- Review: `web/components/admin/SettingsPanel.tsx`
- Review: `controller/src/settings.ts`
- Review: `controller/src/routes/settings.ts`
- Review: `controller/src/llm/internal/speech/cloud-speech.ts`
- Test: `web/scripts/llm-section-provider-url-contract.test.ts`
- Test: `controller/scripts/embedding-provider-config.test.ts`

**Interfaces:**
- Consumes: upstream OpenAI-compatible cloud TTS key field and admin presentation; fork `providerBaseUrls`, `embedding.providerBaseUrls`, LiteLLM metadata, and provider isolation.
- Produces: one settings form that supports both feature sets without shared or leaked connection state.

- [ ] **Step 1: Run the provider contracts before resolving the UI conflict**

```bash
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
(cd controller && npx tsx scripts/embedding-provider-config.test.ts)
```

Expected: the web source contract fails while `LlmSection.tsx` contains conflict markers; controller tests may already pass if Git composed settings cleanly.

- [ ] **Step 2: Resolve `LlmSection.tsx` with one provider URL architecture**

Preserve these fork state shapes and update paths:

```ts
providerBaseUrls: Record<string, string>
fallbackProviderBaseUrls: Record<string, string>
embeddingProviderBaseUrls: Record<string, string>
```

Retain `litellm` in the primary and fallback chat provider options, never in embedding options. Keep distinct provider keys for `locca` and `openai-compatible`; a blank Locca embedding URL must continue resolving through `DEFAULT_LOCCA_EMBED_BASE_URL`, never through a Locca chat URL.

Adopt upstream's OpenAI-compatible cloud TTS API-key field and current card/help presentation. Preserve generation-based stale result suppression for provider, URL, model, and typed-key changes.

- [ ] **Step 3: Audit controller settings composition**

Verify the merged controller still satisfies these concrete invariants:

```ts
settings.llm.providerBaseUrls.litellm
settings.embedding.providerBaseUrls.locca
settings.embedding.providerBaseUrls['openai-compatible']
settings.llm.strictRequests
settings.audio.analyzeQuietOnly
settings.audio.analyzeQuietMinutes
settings.privacy.privatePlayer
settings.privacy.listenerAuth
```

Keep the fork's response redaction for inline LLM and embedding keys and upstream's cloud TTS secret behavior.

- [ ] **Step 4: Run all provider and settings contracts**

```bash
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
(cd controller && npx tsx scripts/embedding-provider-config.test.ts)
npm --prefix controller test
```

Expected: all tests pass, including upstream listener-auth, quiet-analysis, strict-show, and theme-token tests discovered by the controller runner.

- [ ] **Step 5: Stage the resolved provider UI conflict**

```bash
git add web/components/admin/settings/LlmSection.tsx web/components/admin/settings/shared.tsx web/components/admin/SettingsPanel.tsx controller/src/settings.ts controller/src/routes/settings.ts controller/src/llm/internal/speech/cloud-speech.ts
```

Expected: `web/components/admin/settings/LlmSection.tsx` no longer appears as unmerged.

### Task 6: Compose analyzer, privacy, stream timing, themes, and Compose sources

**Files:**
- Resolve: `.env.example`
- Review: `controller/src/music/analyze.ts`
- Review: `controller/scripts/analyze_worker.py`
- Review: `controller/src/broadcast/listeners.ts`
- Review: `controller/src/routes/public.ts`
- Review: `controller/src/settings.ts`
- Review: `docker-compose.yml`
- Review: `docker-compose.byo.yml`
- Review: `docker-compose.dev.yml`
- Adopt: `docker-compose.analyzer-gpu.yml`
- Review: `docker/Dockerfile.analyzer`
- Review: `docker/Dockerfile.aio`
- Review: `docker/aio/supervisor.sh`
- Review: `docker/broadcast-entrypoint.sh`
- Review: `docker/icecast.xml.template`
- Review: upstream theme files under `controller/src/themes/`, `web/lib/theme.ts`, and `web/app/globals.css`

**Interfaces:**
- Consumes: fork `normalizeAnalyzerHandoff`/`shouldPrefetchAnalyzerAudio`; upstream `quietGateDecision`, CUDA device selection, privacy routes, `bufferSeconds`, and generated theme tokens.
- Produces: additive runtime configuration with upstream behavior and retained remote URL handoff.

- [ ] **Step 1: Resolve `.env.example` additively**

Keep the fork entry:

```dotenv
# ANALYZE_HANDOFF=url        # remote analyzer mode: Odin fetches stream URLs itself
```

Keep upstream entries and descriptions for:

```dotenv
# ANALYZE_DEVICE=
# ANALYZE_IDLE_UNLOAD_S=
# ANALYZE_QUIET_ONLY=
```

Retain all LiteLLM variables. Remove all conflict markers and stage `.env.example`.

- [ ] **Step 2: Run analyzer and authentication focused tests**

```bash
(cd controller && npx tsx scripts/analyzer-handoff.test.ts)
(cd controller && npx tsx scripts/analyze-quiet.test.ts)
(cd controller && npx tsx scripts/listener-auth.test.ts)
(cd controller && npx tsx scripts/show-filter.test.ts)
```

Expected: all focused suites pass. A failure in handoff composition must be fixed without replacing upstream quiet/CUDA logic.

- [ ] **Step 3: Audit analyzer request construction**

Confirm `controller/src/music/analyze.ts` keeps this decision boundary:

```ts
const shouldPrefetch = shouldPrefetchAnalyzerAudio(config.analyzer.handoff);
```

URL mode must submit `{ url }`; path/auto modes must retain upstream prefetch and decode behavior. Upstream quiet gating must execute before starting the next expensive track analysis, not inside URL/path transport selection.

- [ ] **Step 4: Audit the Compose environment composition**

Each controller service in the three base Compose files must contain:

```yaml
- ANALYZE_URL=${ANALYZE_URL:-http://analyzer:8080}
- ANALYZE_HANDOFF=${ANALYZE_HANDOFF:-}
```

Each analyzer service must contain:

```yaml
- ANALYZE_DEVICE=${ANALYZE_DEVICE:-}
- ANALYZE_IDLE_UNLOAD_S=${ANALYZE_IDLE_UNLOAD_S:-}
```

`docker-compose.analyzer-gpu.yml` must retain:

```yaml
image: ghcr.io/perminder-klair/subwave-analyzer-cuda:${SUBWAVE_VERSION:-latest}
```

Do not rewrite that image to `obiwancanoweme` and do not add it to `deploy/portainer/docker-compose.yml`.

- [ ] **Step 5: Validate theme generation**

```bash
npm --prefix controller run gen:themes
git diff --exit-code -- web/lib/theme-tokens.generated.ts
```

Expected: generator exits 0 and the committed upstream mirror is current.

- [ ] **Step 6: Render all Compose shapes without deployment**

```bash
ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.example.test docker compose -f docker-compose.yml config --quiet
ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.example.test docker compose -f docker-compose.byo.yml config --quiet
ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.example.test docker compose -f docker-compose.dev.yml config --quiet
ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.example.test docker compose -f docker-compose.yml -f docker-compose.analyzer-gpu.yml config --quiet
```

Expected: all four commands exit 0; no container is created.

- [ ] **Step 7: Stage reviewed runtime sources**

```bash
git add .env.example controller docker-compose.yml docker-compose.byo.yml docker-compose.dev.yml docker-compose.analyzer-gpu.yml docker docker/icecast.xml.template web/app web/components web/hooks/useStationFeed.ts web/lib/theme.ts web/lib/theme-tokens.generated.ts
```

Expected: `.env.example` no longer appears as unmerged.

### Task 7: Regenerate CLI assets and complete semantic merge audit

**Files:**
- Modify: `cli/scripts/embed-assets.ts`
- Modify: `cli/src/assets.ts`
- Modify: `cli/src/commands/init.ts`
- Modify: `cli/src/commands/setup.ts`
- Modify: `cli/src/commands/uninstall.ts`
- Modify: `cli/src/compose-sync.ts`
- Regenerate: `cli/src/assets.generated.ts`
- Review: every path changed on both sides

**Interfaces:**
- Consumes: resolved Compose files, `.env.example`, and upstream `COMPOSE_ANALYZER_GPU_YML` declaration.
- Produces: deterministic CLI assets and zero unresolved merge paths.

- [ ] **Step 1: Resolve the generated file by discarding it before regeneration**

```bash
git rm -f cli/src/assets.generated.ts
```

Expected: the generated conflict is removed from the index and working tree; it will be recreated by the generator.

- [ ] **Step 2: Adopt upstream analyzer-overlay asset plumbing**

Ensure `cli/scripts/embed-assets.ts` contains:

```ts
{ name: 'COMPOSE_ANALYZER_GPU_YML', source: 'docker-compose.analyzer-gpu.yml' },
```

Ensure `cli/src/assets.ts` exports `COMPOSE_ANALYZER_GPU_YML`, and the init/uninstall/sync commands materialize or manage `docker-compose.analyzer-gpu.yml` alongside the existing TTS GPU overlay.

- [ ] **Step 3: Regenerate twice to prove determinism**

```bash
npm --prefix cli run embed-assets
git add cli/src/assets.generated.ts cli/scripts/embed-assets.ts cli/src/assets.ts cli/src/commands/init.ts cli/src/commands/setup.ts cli/src/commands/uninstall.ts cli/src/compose-sync.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
```

Expected: the first generation recreates the file; the second produces no diff.

- [ ] **Step 4: Verify there are no unresolved paths or conflict markers**

```bash
test -z "$(git diff --name-only --diff-filter=U)"
! rg -n '^(<<<<<<<|=======|>>>>>>>)' . --hidden -g '!node_modules' -g '!.git'
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Audit every path changed on both sides**

```bash
while IFS= read -r path; do
  printf '\n===== %s: staged merge =====\n' "$path"
  git diff --cached -- "$path"
  printf '\n===== %s: upstream delta =====\n' "$path"
  git diff v0.44.0..v0.45.0 -- "$path"
  printf '\n===== %s: fork delta =====\n' "$path"
  git diff v0.44.0..HEAD -- "$path"
done < <(
  comm -12 \
    <(git diff --name-only v0.44.0..HEAD | sort) \
    <(git diff --name-only v0.44.0..v0.45.0 | sort)
)
```

Expected: no fork field, workflow gate, provider branch, analyzer handoff, or stream-selection path is silently lost.

- [ ] **Step 6: Stage all remaining upstream additions and modifications**

```bash
git add -A
git status --short
```

Expected: no `UU`, `UD`, `DU`, `AA`, or other unmerged status remains.

### Task 8: Run full verification and create the merge commit

**Files:**
- Verify: entire repository
- Commit: all staged merge changes

**Interfaces:**
- Consumes: fully resolved and staged v0.45.0 merge.
- Produces: one verified merge commit with exact upstream v0.45.0 as second parent.

- [ ] **Step 1: Run the controller and repository suites**

```bash
npm --prefix controller test
node --test scripts/**/*.test.mjs
```

Expected: every test passes, including upstream and fork contracts.

- [ ] **Step 2: Run every web behavior suite**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
```

Expected: every script exits 0.

- [ ] **Step 3: Run lint and typecheck gates**

```bash
npm --prefix controller run lint
npm --prefix web run lint
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
```

Expected: every command exits 0. Existing warnings are acceptable only if the command reports zero errors.

- [ ] **Step 4: Build the production web application**

```bash
npm --prefix web run build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 5: Re-run generated and deployment gates**

```bash
npm --prefix controller run gen:themes
git diff --exit-code -- web/lib/theme-tokens.generated.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
node --test scripts/ci/workflow-contract.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/release/fork-tag.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: every command passes and neither generator changes the worktree.

- [ ] **Step 6: Inspect the staged result before committing**

```bash
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached -- .github/workflows/publish-images.yml web/hooks/usePlayer.ts web/lib/types.ts web/components/admin/settings/LlmSection.tsx controller/src/settings.ts controller/src/music/analyze.ts docker-compose.analyzer-gpu.yml
```

Expected: all changes are intentional, there are no unstaged files, and `subwave-analyzer-cuda` appears only in upstream overlay/docs/CLI assets—not in the fork publication workflow.

- [ ] **Step 7: Create the merge commit**

```bash
git commit -m "merge: integrate subwave v0.45.0"
```

Expected: Git creates a merge commit.

- [ ] **Step 8: Verify ancestry, cleanliness, and scope**

```bash
test "$(git rev-parse HEAD^2)" = 0b4b017a73188a8b9c56ed55a6329b34a5f73d8a
git merge-base --is-ancestor v0.45.0 HEAD
git status --short
git log --oneline --decorate --graph -8
```

Expected: both ancestry commands exit 0, status prints nothing, and the graph shows `v0.45.0` as the second parent of the integration merge.

- [ ] **Step 9: Record the handoff without publishing**

Report the merge SHA, exact upstream parent, test counts, warning-only lint results, retained fork behavior, and upstream-owned CUDA decision. Do not push, deploy, tag, publish images, mutate Odin, or create a release.
