# Upstream SUB/WAVE v1.5.0 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate upstream SUB/WAVE v1.4.0 and v1.5.0 into ObiWave as two verified merge checkpoints, then publish and deploy only `v1.5.0-obiwave.1`.

**Architecture:** Keep the fork on its existing v1.3.0 ancestry and merge the exact v1.4.0 tag first, resolving and verifying that delta before merging exact v1.5.0. Preserve upstream ancestry and compose fork-only security, deployment, authentication, provider, and playback behavior against v1.5 interfaces. One cumulative PR carries both checkpoints; the existing immutable fork-release workflow publishes and deploys the final merge only.

**Tech Stack:** Git, Node.js 22, TypeScript, Next.js 15, Expo/React Native, Python 3, Liquidsoap, Docker Buildx/Compose, GitHub Actions, Trivy, GHCR, Portainer.

## Global Constraints

- Start from ObiWave `origin/develop` commit `0bb2aecc5a6d4fefe65fe67410887d57df700bbe` plus design commit `56d1d9affc599709d7e69d0406abe41204bf4317` and this committed execution plan.
- Upstream `v1.4.0` must resolve to `01663b547feaf0987fd8bad8c1c8c374b8781c76`.
- Upstream `v1.5.0` must resolve to `8c01e979ebeea5c5ed6cac6658b5da14322b9d6d`.
- `v1.4.0` must remain an ancestor of `v1.5.0`.
- Create exactly two upstream merge commits: v1.4.0 checkpoint first, v1.5.0 checkpoint second.
- Do not create any `v1.4.0-obiwave.*` tag, GitHub release, image, or deployment.
- The only downstream release target is `v1.5.0-obiwave.1`.
- Upstream wins when it supersedes the same behavior; fork-only behavior remains; independent overlapping behavior is composed.
- Preserve immutable fork releases, Trivy policy, Portainer rollback, exact analyzer verification, listener-auth edge protection, private-station authentication, provider-owned credentials, multi-format playback, and all `v1.3.0-obiwave.2` recovery safeguards.
- Do not resolve an ambiguous conflict by accepting an entire side wholesale.
- Every bug or missing composed behavior discovered during conflict resolution enters a red-green test cycle before its production fix.
- Do not bypass security policy, overwrite tags, force-push reviewed history, or automatically retry a failed/partial release.
- Do not deploy until the exact reviewed PR head is merged and release preflight proves all ten destination image tags absent.

---

### Task 1: Establish Exact Identities, Isolation, and Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-08-05-integrate-upstream-v1.5.0-design.md`
- Read: `.github/workflows/ci.yml`
- Create ignored evidence: `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/progress.md`

**Interfaces:**
- Consumes: exact fork and upstream Git objects plus current package lockfiles.
- Produces: a clean, reproducible baseline and an evidence ledger used by every later task.

- [ ] **Step 1: Confirm linked-worktree isolation and branch identity**

Run:

```bash
git_dir=$(cd "$(git rev-parse --git-dir)" && pwd -P)
git_common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
test "$git_dir" != "$git_common"
test "$(git branch --show-current)" = integrate/upstream-v1.5.0
test "$(git rev-parse HEAD^)" = 0f281f9d554b57c8bd9da2de57659c4a42f60dba
test "$(git log -1 --format=%s)" = "docs: correct integration plan starting head"
git status --short
```

Expected: all assertions exit 0 and status is empty.

- [ ] **Step 2: Re-fetch and verify immutable upstream identities**

Run:

```bash
git fetch upstream --tags --prune
test "$(git rev-parse 'v1.4.0^{commit}')" = 01663b547feaf0987fd8bad8c1c8c374b8781c76
test "$(git rev-parse 'v1.5.0^{commit}')" = 8c01e979ebeea5c5ed6cac6658b5da14322b9d6d
git merge-base --is-ancestor v1.4.0 v1.5.0
test "$(git rev-list --count v1.3.0..v1.4.0)" = 10
test "$(git rev-list --count v1.4.0..v1.5.0)" = 29
```

Expected: both tags match, ancestry succeeds, and commit counts are 10 then 29.

- [ ] **Step 3: Install the exact locked dependencies**

Run:

```bash
npm ci --no-audit --no-fund
npm --prefix controller ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm --prefix mcp-subwave ci --no-audit --no-fund
npm --prefix cli ci --no-audit --no-fund
npm --prefix app ci --no-audit --no-fund
python3 -m venv controller/.venv-analyzer-tests
controller/.venv-analyzer-tests/bin/python -m pip install --disable-pip-version-check --no-cache-dir numpy==2.2.6
```

Expected: all installs exit 0; `app` applies its checked-in RNTP patch during postinstall.

- [ ] **Step 4: Run the complete current quality baseline**

Run:

```bash
npm --prefix controller run gen:themes
git diff --exit-code web/lib/theme-tokens.generated.ts
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller run lint
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test
npm --prefix web run lint
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:mounted-state
npm --prefix web run test:async-generation
npm --prefix web run test:model-discovery-request
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run build
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run test:stream-buffer-format
npm --prefix app run test:station-credentials
node --test scripts/release/fork-tag.test.mjs scripts/release/mirror-cuda-analyzer.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs scripts/security/trivy-policy.test.mjs
```

Expected: every CI-equivalent command passes. Record warning counts without treating existing warnings as new failures.

- [ ] **Step 5: Record the baseline in the ignored SDD ledger**

Use `apply_patch` to create `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/progress.md` containing the exact identities, command results, test counts, warning counts, and any baseline-only anomaly. Do not stage `.superpowers/`.

Expected: `git status --short` remains empty.

---

### Task 2: Merge and Resolve the v1.4.0 Checkpoint

**Files:**
- Merge all paths in: `git diff --name-status v1.3.0..v1.4.0`
- Resolve settings: `controller/src/settings/normalize.ts`
- Resolve admin/library: `web/components/admin/LibraryPanel.tsx`, `web/components/admin/library/BlockedTab.tsx`, `BrowseFilters.tsx`, `HistoryTab.tsx`, `ManualTagEditor.tsx`, `Tabs.tsx`, `TrackTable.tsx`, `bits.tsx`, `types.ts`
- Resolve admin/settings: `web/components/admin/settings/LlmSection.tsx`, `SearchSection.tsx`, `TtsSection.tsx`
- Resolve admin/other: `web/components/admin/dash/bits.tsx`, `web/components/admin/debug/MountsTable.tsx`, `web/components/admin/schedule/SchedulePanel.tsx`
- Resolve onboarding/player: `web/components/onboarding/steps.tsx`, `useWizard.ts`, `web/components/skins/classic/DotRail.tsx`, `web/hooks/usePlayer.ts`, `useStationFeed.ts`, `useUnsavedGuard.ts`, `web/lib/stationAuth.ts`, `stationOrigin.ts`, `types.ts`
- Resolve documentation: `CLAUDE.md`
- Test: `controller/scripts/tts-fallback.test.ts`, fork provider/auth/player tests listed below

**Interfaces:**
- Consumes: current fork behavior and exact upstream v1.4.0 tree.
- Produces: a merge result containing every v1.4.0 commit plus preserved fork contracts, with no v1.4 fork release artifact.

- [ ] **Step 1: Capture current fork characterization gates before the merge**

Run:

```bash
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- tts-fallback
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- cloud-tts-provider-key
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- settings-route-security
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- voice-library
npm --prefix web run test:stream-auth-format
npm --prefix web run test:mounted-state
npm --prefix web run test:llm-section-provider-url-contract
```

Expected: all current fork contracts pass before upstream files are introduced.

- [ ] **Step 2: Begin the first no-commit upstream merge**

Run:

```bash
git merge --no-ff --no-commit v1.4.0
```

Expected: Git stops with the known conflict set. Capture `git diff --name-only --diff-filter=U` in the SDD ledger. The preview contains 25 paths; any difference is reviewed before editing.

- [ ] **Step 3: Resolve documentation and normalized fallback-TTS state**

For `CLAUDE.md`, retain fork deployment/security topology and incorporate upstream v1.4 operator guidance.

For `controller/src/settings/normalize.ts`, preserve all fork normalization and add upstream fallback-TTS normalization with these externally visible invariants:

```ts
settings.tts.fallback.enabled === false // when the pre-v1.4 key is absent
settings.tts.fallback.engine            // normalized through existing engine rules
settings.tts.fallback.voice             // normalized through existing per-engine voice rules
```

Use the upstream `controller/scripts/tts-fallback.test.ts` assertions plus the fork test's existing fallback-chain assertions. Before composing the final resolution, run the upstream-side resolution against the fork test and record the expected behavioral failure; then apply the composed resolution and rerun until green.

- [ ] **Step 4: Resolve the admin library surface as one interface**

Adopt upstream v1.4 component structure and appearance changes while preserving fork library behavior: liked-state rendering, playlist operations, manual tags, blocked tracks, history, browse filters, and stable shared types.

Run after resolving this group:

```bash
npm --prefix web run test:library-liked-state
npm --prefix web run typecheck
```

Expected: liked-state and all cross-component props/types pass. If either fails for a missing composed behavior, add the smallest assertion to `web/scripts/library-liked-state.test.ts`, observe that assertion fail, then change production code and rerun.

- [ ] **Step 5: Resolve provider settings and onboarding as one interface**

Adopt the clearer upstream Cloud TTS picker and station fallback-voice UI. Preserve fork provider URL/key ownership, secret redaction, model discovery, search-provider state, and onboarding persistence.

Run:

```bash
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:tts-secret-state
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run test:search-provider
npm --prefix web run typecheck
```

Expected: all provider values round-trip without exposing secrets or losing fork URLs.

- [ ] **Step 6: Resolve player, station-origin, auth, skin, schedule, dashboard, and debug paths**

Adopt upstream v1.4 presentation/refactor changes while preserving exact-origin discovery, private-station credentials, format selection, station feed cadence, unsaved-form protection, and listener/debug data.

Run:

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:admin-navigation-schedule
npm --prefix web run typecheck
```

Expected: private auth stays attached to the selected stream format; public origin behavior and schedule navigation remain intact.

- [ ] **Step 7: Verify every conflict and marker is resolved**

Run:

```bash
test -z "$(git diff --name-only --diff-filter=U)"
test -z "$(rg -l '^(<<<<<<<|=======|>>>>>>>)' --glob '!package-lock.json' . || true)"
git diff --check
git status --short
```

Expected: no unmerged paths or conflict markers; status shows only the intended merge result.

- [ ] **Step 8: Run the v1.4 focused gate**

Run:

```bash
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- tts-fallback
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- cloud-tts-provider-key
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- settings-route-security
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- voice-library
npm --prefix web run lint
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:mounted-state
npm --prefix web run test:llm-provider
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run test:search-provider
npm --prefix web run build
```

Expected: all focused v1.4 and fork-composition gates pass.

- [ ] **Step 9: Commit the v1.4 merge checkpoint**

Run:

```bash
git commit -m "merge: integrate upstream v1.4.0 checkpoint"
git show --no-patch --pretty='%P' HEAD
```

Expected: the merge commit has two parents; the second parent is `01663b547feaf0987fd8bad8c1c8c374b8781c76`.

---

### Task 3: Verify the Complete v1.4.0 Checkpoint

**Files:**
- Test only: all package and workflow paths exercised by `.github/workflows/ci.yml`
- Evidence only: `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/progress.md`

**Interfaces:**
- Consumes: committed v1.4 merge checkpoint.
- Produces: a known-green midpoint before any v1.5 file enters the branch.

- [ ] **Step 1: Run the complete CI-equivalent package gate**

Run:

```bash
npm --prefix controller run gen:themes
git diff --exit-code web/lib/theme-tokens.generated.ts
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller run lint
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test
npm --prefix web run lint
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:mounted-state
npm --prefix web run test:async-generation
npm --prefix web run test:model-discovery-request
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run build
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run test:stream-buffer-format
npm --prefix app run test:station-credentials
node --test scripts/release/fork-tag.test.mjs scripts/release/mirror-cuda-analyzer.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs scripts/security/trivy-policy.test.mjs
```

Expected: every command passes with no new warning class.

- [ ] **Step 2: Build the v1.4 affected production images**

Run:

```bash
docker build -f docker/Dockerfile.controller -t subwave-v14-controller:test .
docker build -f web/Dockerfile -t subwave-v14-web:test .
docker run --rm --entrypoint /bin/sh subwave-v14-controller:test -ceu 'test ! -e /usr/local/bin/npm; test ! -e /usr/local/bin/npx; exec /app/node_modules/.bin/tsx scripts/production-command.test.ts'
```

Expected: both images build and the production controller child command passes.

- [ ] **Step 3: Record the v1.4 checkpoint evidence**

Append exact command/test/image results and the merge SHA to the ignored SDD ledger with `apply_patch`.

Expected: tracked status remains clean after evidence is recorded.

---

### Task 4: Merge and Resolve the v1.5.0 Checkpoint

**Files:**
- Merge all paths in: `git diff --name-status v1.4.0..v1.5.0`
- Expected additional conflict domains: `.env.example`, `controller/CLAUDE.md`, `controller/src/llm/internal/provider/registry.ts`, `controller/src/llm/internal/speech/cloud-speech.ts`, `controller/src/settings.ts`, `web/components/player/PlayerCore.tsx`, `cli/src/assets.generated.ts`
- Revisit any v1.4 conflict path that v1.5 changes again
- Test: all new/changed v1.5 tests listed in Step 3

**Interfaces:**
- Consumes: verified v1.4 merge checkpoint and exact upstream v1.5.0 tree.
- Produces: complete upstream v1.5 behavior composed with every retained fork contract.

- [ ] **Step 1: Begin the second no-commit upstream merge**

Run:

```bash
git merge --no-ff --no-commit v1.5.0
git diff --name-only --diff-filter=U
```

Expected: only the post-v1.4 delta is introduced. Record the actual conflict set before editing.

- [ ] **Step 2: Resolve provider, speech, settings, environment, and documentation paths**

Compose these exact behaviors:

- provider registry preserves fork provider-owned URL/key selection and caches while upstream repeat-penalty settings survive restart;
- cloud speech preserves fork engines/credential routing while accepting upstream openai-compatible generation parameters;
- settings retain fallback TTS and fork validation while adding `tts.compatParams`, show `vocals`, blocklist rules, and clamped `llm.repeatPenalty` on primary/fallback legs;
- `.env.example` documents upstream additions without restoring removed global credential fallbacks;
- `controller/CLAUDE.md` describes the composed runtime accurately.

- [ ] **Step 3: Run the upstream v1.5 behavioral tests before fixing any failure they expose**

Run each filter separately so its RED reason is attributable:

```bash
for filter in \
  analysis-failure \
  analyze-capability \
  blocklist-rules \
  blocklist \
  compat-tts-params \
  link-clock \
  llm-repeat-penalty \
  music-starve \
  picker-lock-forwarding \
  playlists-cap \
  programme-grounding \
  resolve-show \
  show-theme-id \
  show-vocals \
  skill-config-fields \
  skill-scaffold-preserve \
  skip-policy \
  state-bootstrap \
  theme-provenance \
  ttl-cache
do
  PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- "$filter"
done
```

Expected during resolution: each failing filter fails on missing or incorrectly composed behavior, not a syntax/import error. Apply the minimum production correction for that filter, rerun it to green, then continue. Tests that are already green require no production change.

- [ ] **Step 4: Resolve player-core and repeated web conflicts**

Adopt upstream's rule that Opus is selected only when the station advertises the mount. Preserve the fork's private credentials, selected-format buffering, same-origin station clients, listener feed, and skin/admin behavior.

Run:

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:mounted-state
npm --prefix app run test:stream-buffer-format
npm --prefix app run test:station-credentials
npm --prefix web run typecheck
npm --prefix app run typecheck
```

Expected: unavailable Opus falls back to MP3, private auth remains attached, and native/web buffer contracts pass.

- [ ] **Step 5: Regenerate CLI assets from the resolved source tree**

Run:

```bash
npm --prefix cli run embed-assets
npm --prefix cli run typecheck
git diff --check cli/src/assets.generated.ts
```

Expected: `cli/src/assets.generated.ts` is generated rather than hand-resolved, and CLI typecheck passes.

- [ ] **Step 6: Verify every conflict and marker is resolved**

Run:

```bash
test -z "$(git diff --name-only --diff-filter=U)"
test -z "$(rg -l '^(<<<<<<<|=======|>>>>>>>)' --glob '!package-lock.json' . || true)"
git diff --check
git status --short
```

Expected: no conflict state remains.

- [ ] **Step 7: Run all focused fork-preservation gates**

Run:

```bash
for filter in \
  cloud-tts-provider-key \
  embedding-provider-config \
  listener-auth \
  search-provider \
  settings-route-security \
  show-filter \
  stream-buffer \
  tts-fallback \
  voice-library
do
  PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test -- "$filter"
done
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:mounted-state
npm --prefix web run test:tts-secret-state
npm --prefix web run test:llm-section-provider-url-contract
node scripts/ci/upstream-v100-structure.test.mjs
```

Expected: upstream v1.5 behavior and fork-only contracts coexist. The structural test must reflect the merged module shape; do not weaken its behavioral assertions to satisfy a line-count-only failure.

- [ ] **Step 8: Commit the v1.5 merge checkpoint**

Run:

```bash
git commit -m "merge: integrate upstream v1.5.0"
git show --no-patch --pretty='%P' HEAD
```

Expected: the merge commit has two parents; the second parent is `8c01e979ebeea5c5ed6cac6658b5da14322b9d6d`.

---

### Task 5: Verify the Cumulative v1.5 Tree End to End

**Files:**
- Modify only when a failing behavioral test first demonstrates a cumulative integration defect
- Test alongside the affected production module
- Evidence: `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/progress.md`

**Interfaces:**
- Consumes: committed v1.5 merge tree.
- Produces: locally verified exact PR candidate with runtime evidence.

- [ ] **Step 1: Run the full package and deployment-contract gate**

Run:

```bash
npm --prefix controller run gen:themes
git diff --exit-code web/lib/theme-tokens.generated.ts
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller run lint
PATH="$PWD/controller/.venv-analyzer-tests/bin:$PATH" npm --prefix controller test
npm --prefix web run lint
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:mounted-state
npm --prefix web run test:async-generation
npm --prefix web run test:model-discovery-request
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run build
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run test:stream-buffer-format
npm --prefix app run test:station-credentials
node --test scripts/release/fork-tag.test.mjs scripts/release/mirror-cuda-analyzer.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs scripts/security/trivy-policy.test.mjs
```

Expected: all local equivalents of the 10 CI jobs pass.

- [ ] **Step 2: Build all four CI smoke images**

Run:

```bash
docker build -f docker/Dockerfile.broadcast -t subwave-v15-broadcast:test .
docker build -f docker/Dockerfile.controller -t subwave-v15-controller:test .
docker build -f web/Dockerfile -t subwave-v15-web:test .
docker build --build-arg WITH_CLAP=0 --build-arg WITH_DEMUCS=0 -f docker/Dockerfile.analyzer -t subwave-v15-analyzer:test .
docker run --rm --entrypoint /bin/sh subwave-v15-controller:test -ceu 'test ! -e /usr/local/bin/npm; test ! -e /usr/local/bin/npx; exec /app/node_modules/.bin/tsx scripts/production-command.test.ts'
```

Expected: all images build and the production controller command passes.

- [ ] **Step 3: Stage the worktree dev environment and verify the admin/runtime path**

Invoke `subwave-worktree-dev` to copy/scaffold ignored runtime inputs and start the dev stack from this worktree. Then invoke `verify` for controller/admin UI checks.

Verify at minimum:

```text
/api/health reports on-air
/admin/settings renders Cloud TTS fallback and compatible parameters
/admin/library renders blocklist rules
/admin/shows renders vocal/instrumental steering
player format selection falls back when Opus is unavailable
```

Expected: all surfaces operate from the integration worktree without touching the live station.

- [ ] **Step 4: Verify Liquidsoap changes**

Run the worktree dev broadcast container and inspect its startup logs after the v1.5 `radio.liq` is loaded.

Expected: Liquidsoap parses successfully, the stream mount comes online, and a starved music source does not loop jingles.

- [ ] **Step 5: Fix only demonstrated cumulative defects with red-green cycles**

For each defect from Steps 1-4:

1. Add one focused behavioral assertion to the nearest existing test file.
2. Run only that test and record its expected failure.
3. Apply the minimum production fix.
4. Run the focused test to green.
5. Rerun the affected package gate.

Commit the demonstrated post-merge fixes as one reviewable correction:

```bash
git diff --name-only --diff-filter=ACMD -z | git add --pathspec-from-file=- --pathspec-file-nul
git commit -m "fix: preserve fork behavior across v1.5 integration"
```

Expected: no untested integration fix enters the PR candidate.

- [ ] **Step 6: Record final local evidence and verify cleanliness**

Append test counts, image results, runtime observations, and exact HEAD to the SDD ledger using `apply_patch`, then run:

```bash
git status --short
git diff --check origin/develop...HEAD
git merge-base --is-ancestor v1.4.0 HEAD
git merge-base --is-ancestor v1.5.0 HEAD
```

Expected: tracked tree is clean and both upstream tags are ancestors.

---

### Task 6: Independent Review, Push, and Cumulative Pull Request

**Files:**
- Read/review: `origin/develop...HEAD`
- Create ignored evidence: `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/pr-body.md`

**Interfaces:**
- Consumes: locally verified cumulative branch.
- Produces: reviewed, CI-green PR targeting `develop` on the exact reviewed head.

- [ ] **Step 1: Request independent whole-branch review**

Invoke `superpowers:requesting-code-review`. Give the reviewer the base SHA `0bb2aecc5a6d4fefe65fe67410887d57df700bbe`, exact head SHA, approved design, two upstream identities, and full verification evidence.

Expected: review reports Critical, Important, and Minor findings plus a merge verdict.

- [ ] **Step 2: Resolve every Critical and Important finding**

For each behavior finding, add one focused assertion to the nearest existing test, run it to record the behavior-specific failure, apply the minimum production correction, rerun the focused test, then rerun the affected package's complete CI command. Request rereview on the new exact head.

Expected: final rereview has zero Critical and zero Important findings.

- [ ] **Step 3: Create the cumulative PR description**

Use `apply_patch` to write a PR body that includes:

```text
v1.4.0 checkpoint SHA and verification
v1.5.0 checkpoint SHA and verification
upstream features integrated
fork-only behaviors preserved
conflict-resolution summary
local test/image/runtime evidence
explicit statement that no v1.4 fork release will be created
planned final tag v1.5.0-obiwave.1
```

- [ ] **Step 4: Push and open a draft PR**

Invoke `github:yeet` to confirm scope, push `integrate/upstream-v1.5.0`, and open a draft PR against `ObiWanCanOweMe/obiwave:develop`.

Expected: PR head equals the reviewed SHA and base equals current `origin/develop`.

- [ ] **Step 5: Wait for every PR check and verify exact state**

Run:

```bash
pr_number=$(gh pr view --repo ObiWanCanOweMe/obiwave --json number --jq .number)
gh pr checks "$pr_number" --repo ObiWanCanOweMe/obiwave --watch --interval 10
gh pr view "$pr_number" --repo ObiWanCanOweMe/obiwave --json headRefOid,baseRefOid,isDraft,mergeable,statusCheckRollup
```

Expected: all checks succeed, none remain pending, and the head SHA is unchanged.

- [ ] **Step 6: Mark ready and merge the exact reviewed head**

Resolve `reviewed_head=$(git rev-parse HEAD)`, use `gh pr ready "$pr_number"`, then merge with `gh pr merge "$pr_number" --repo ObiWanCanOweMe/obiwave --merge --match-head-commit "$reviewed_head"`.

Expected: PR is merged; record the merge SHA and both parents in the SDD ledger.

---

### Task 7: Preflight and Cut Only v1.5.0-obiwave.1

**Files:**
- Read: `.github/workflows/cut-fork-release.yml`
- Read: `.github/workflows/publish-images.yml`
- Read: `.github/workflows/scan-images.yml`
- Read: `security/trivy-scanner.json`
- Read: `security/trivy-acceptance.json`

**Interfaces:**
- Consumes: exact merged integration SHA and existing immutable release workflows.
- Produces: one new GitHub release/tag whose push starts the ten-image pipeline.

- [ ] **Step 1: Verify release identities and absence**

Run:

```bash
git fetch origin develop --prune
git merge-base --is-ancestor v1.5.0 origin/develop
git ls-remote --exit-code --tags origin refs/tags/v1.4.0-obiwave.1 && exit 1 || test "$?" = 2
git ls-remote --exit-code --tags origin refs/tags/v1.5.0-obiwave.1 && exit 1 || test "$?" = 2
gh release view v1.5.0-obiwave.1 --repo ObiWanCanOweMe/obiwave >/dev/null 2>&1 && exit 1 || test "$?" = 1
```

Expected: v1.5 is an ancestor; neither downstream tag/release exists; v1.4 remains absent.

- [ ] **Step 2: Verify all ten destination image tags are absent**

Run the checked-in fail-closed helper for:

```text
subwave-caddy
subwave-broadcast
subwave-controller
subwave-web
subwave-aio
subwave-aio-heavy
subwave-tts-heavy
subwave-analyzer
subwave-analyzer-heavy
subwave-analyzer-cuda
```

with:

```bash
images=(subwave-caddy subwave-broadcast subwave-controller subwave-web subwave-aio subwave-aio-heavy subwave-tts-heavy subwave-analyzer subwave-analyzer-heavy subwave-analyzer-cuda)
for image in "${images[@]}"; do
  IMAGE_REF="ghcr.io/obiwancanoweme/${image}:v1.5.0-obiwave.1" node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${image}:v1.5.0-obiwave.1"
done
```

Expected: all ten helpers prove registry-not-found; auth or registry errors fail closed.

- [ ] **Step 3: Dispatch the cut workflow exactly once**

Run:

```bash
gh workflow run cut-fork-release.yml \
  --repo ObiWanCanOweMe/obiwave \
  --ref develop \
  -f version=1.5.0 \
  -f revision=1 \
  -f target=develop
```

Expected: one workflow run creates GitHub release/tag `v1.5.0-obiwave.1` at the recorded integration merge SHA. Do not redispatch automatically.

- [ ] **Step 4: Verify the created release before publication proceeds**

Run:

```bash
gh release view v1.5.0-obiwave.1 --repo ObiWanCanOweMe/obiwave --json tagName,targetCommitish,isDraft,isPrerelease,url
git ls-remote --tags origin refs/tags/v1.5.0-obiwave.1
```

Expected: public non-prerelease release and tag both point to the exact integration merge SHA.

---

### Task 8: Monitor Publication, Security Policy, Deployment, and Production

**Files:**
- Downloaded evidence only: `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/release-artifacts/`
- Final report: `.superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/final-report.md`

**Interfaces:**
- Consumes: immutable tag `v1.5.0-obiwave.1` and the publish-images run it triggers.
- Produces: ten immutable images, policy evidence, verified Portainer deployment, and live production evidence.

- [ ] **Step 1: Identify and watch the one publication run**

Resolve the `publish-images.yml` run whose `headBranch` is `v1.5.0-obiwave.1`, record its database ID, head SHA, and URL, then watch it with `gh run watch --exit-status`.

Expected order: validate, reusable CI, ten absence preflights, nine builds plus exact CUDA mirror, ten scans, aggregate vulnerability policy, protected production deployment.

- [ ] **Step 2: Stop on any publication or policy failure**

If any job fails, download available artifacts and inspect logs. Do not add an acceptance, mutate the tag, delete a partial image, or rerun without a new explicit reviewed decision.

Expected on the authorized path: every job succeeds and no stop is required.

- [ ] **Step 3: Download and replay fresh vulnerability artifacts**

Download all ten `trivy-json-*` artifacts, flatten the twenty report/status JSON files into a temporary directory, and run:

```bash
flat_report_dir=$(mktemp -d)
find .superpowers/sdd/2026-08-05-upstream-v1.5.0-integration/release-artifacts -type f -name '*.json' -exec cp {} "$flat_report_dir"/ \;
node scripts/security/trivy-policy.mjs \
  --reports "$flat_report_dir" \
  --acceptance security/trivy-acceptance.json \
  --tag v1.5.0-obiwave.1
```

Expected: result `pass`, image count 10, and unaccepted count 0. Record finding and acceptance counts.

- [ ] **Step 4: Inspect deployment evidence**

Inspect the `deploy-production` job log and summary.

Expected: it logs deployment and verification of `v1.5.0-obiwave.1`; Portainer's verifier confirms the exact release-tagged analyzer container is running, healthy, and restart-free; no rollback incident appears.

- [ ] **Step 5: Verify live production HTTP and routing**

Run:

```bash
curl -fsS --max-time 15 https://radio.kener.org/api/health
curl -fsS --max-time 15 https://radio.kener.org/api/now-playing
curl -sS --max-time 15 -o /dev/null -w '%{http_code}\n' https://radio.kener.org/api/listener-auth
curl -sS --max-time 15 -o /dev/null -w '%{http_code}\n' https://radio.kener.org/api/listener-auth/
curl -sS -I --max-time 15 https://radio.kener.org/stream.mp3
```

Expected: health is HTTP 200 with `status=on-air`; now-playing is populated with `streamOnline=true`; listener-auth forms both return 404; stream content type is `audio/mpeg`.

- [ ] **Step 6: Verify an exact non-silent MP3 sample**

Capture exactly 65,536 bytes from the public MP3 stream into a temporary file, then run:

```bash
test "$(wc -c < "$SAMPLE_PATH" | tr -d ' ')" = 65536
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bit_rate -of json "$SAMPLE_PATH"
ffmpeg -hide_banner -nostats -i "$SAMPLE_PATH" -af volumedetect -f null - 2>&1
```

Expected: MP3, 44.1 kHz, stereo, configured bitrate, and mean volume greater than `-50.0 dB`.

- [ ] **Step 7: Verify post-deploy registry immutability**

Inspect all ten `v1.5.0-obiwave.1` manifest digests twice and compare them byte-for-byte. Reinspect the ten `v1.3.0-obiwave.2` baseline digests and confirm none changed.

Expected: all new digests are stable and every prior `.2` digest is unchanged.

- [ ] **Step 8: Write the final report**

Use `apply_patch` to write `final-report.md` with PR URL, reviewed head, merge SHA, tag/release URL, publication run URL, ten image digests, scan totals, deployment result, live HTTP/audio evidence, and explicit confirmation that no v1.4 fork artifact was created.

Expected: `v1.5.0-obiwave.1` is deployed and verified, with an auditable path from both upstream tags to production.
