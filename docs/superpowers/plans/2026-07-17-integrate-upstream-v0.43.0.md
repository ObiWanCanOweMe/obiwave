# SUB/WAVE v0.43.0 Upstream Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge canonical SUB/WAVE v0.43.0 into the ObiWave fork while preserving all fork-specific audio-format, LiteLLM, deployment, and CI behavior.

**Architecture:** Merge the signed upstream release tag into an isolated fork branch, resolve the sole textual conflict by composing both public player APIs, and audit every automatically merged fork/upstream overlap for semantic loss. Verify the combined controller, web, MCP, CLI, and fork-specific contract suites before committing the integration.

**Tech Stack:** Git, Node.js 20+, TypeScript, Next.js, Express, Docker Compose, Liquidsoap

## Global Constraints

- Integrate exact upstream tag `v0.43.0` (`fe0654d8ad0d355876d2ed05177ca7c9c4b85c4d`).
- Preserve fork-only audio format selection, LiteLLM, embedding gateway, Portainer/Caddy, and CI/release behavior.
- Preserve upstream v0.43.0 listener likes, playlist builder, idle-pause, show override, history, TTS preview, and metadata fixes.
- Do not deploy, push, or publish a fork release as part of this integration.

---

### Task 1: Merge the upstream release and compose the player APIs

**Files:**
- Modify: `web/components/player/PlayerCore.tsx`
- Merge: all files changed by `v0.43.0`

**Interfaces:**
- Consumes: fork `AudioFormat`, `FormatAvailability`, `streamEnablementFor()`, and `usePlayer({ streamEnablement })` APIs; upstream `LikeResult`, `LikeStatus`, `StationClient.likeCurrent()`, and `StationClient.likeStatus()` APIs.
- Produces: one `PlayerActions` context exposing `selectFormat`, `likeCurrent`, and `likeStatus`, and one `PlayerAudio` context exposing format state.

- [x] **Step 1: Merge without committing**

Run: `git merge --no-ff --no-commit v0.43.0`
Expected: one content conflict in `web/components/player/PlayerCore.tsx`.

- [x] **Step 2: Resolve the player-core conflict additively**

Keep the fork's `streamEnablementFor(feed.stream)`, `format`, `availability`, `formatFailure`, `selectFormat`, and stable `selectFormatRef`. Add upstream's `LikeResult`/`LikeStatus` imports and these action members:

```ts
likeCurrent: (songId: string) => Promise<LikeResult | null>;
likeStatus: () => Promise<LikeStatus | null>;
```

The actions object must delegate to `client.likeCurrent(songId)` and `client.likeStatus()` while retaining format selection.

- [x] **Step 3: Confirm the conflict is fully resolved**

Run: `git diff --check && test -z "$(git diff --name-only --diff-filter=U)"`
Expected: exit 0 and no unmerged paths.

### Task 2: Audit semantic overlaps and fork contracts

**Files:**
- Review: `cli/src/assets.generated.ts`
- Review: `controller/src/llm/internal/provider/{embedding,registry}.ts`
- Review: `controller/src/music/{embeddings,tag-library}.ts`
- Review: `controller/src/routes/{onboarding,settings}.ts`
- Review: `controller/src/settings.ts`
- Review: `docker-compose.yml`
- Review: `web/app/globals.css`
- Review: `web/components/admin/{SettingsPanel.tsx,settings/shared.tsx}`
- Review: `web/lib/stationClient.ts`
- Review: `web/package.json`

**Interfaces:**
- Consumes: the merged index plus fork contract tests.
- Produces: a semantically reviewed merge that retains fork provider/config/deployment behavior alongside v0.43.0.

- [x] **Step 1: Inspect every file changed on both sides**

Run: `base=$(git merge-base HEAD^1 HEAD^2); comm -12 <(git diff --name-only "$base"..HEAD^1 | sort) <(git diff --name-only "$base"..HEAD^2 | sort)` after the merge commit, or use the pre-merge overlap list recorded during integration.
Expected: each overlap is reviewed for silently dropped branches, settings fields, dependencies, and compose keys.

- [x] **Step 2: Run fork-specific controller and repository contracts**

Run: `npm --prefix controller test`
Expected: all controller script tests pass, including LiteLLM, embedding, settings security, request strictness, and upstream v0.43.0 tests.

Run: `node --test scripts/**/*.test.mjs`
Expected: all fork deployment, CI, release, and compose contract tests pass.

- [x] **Step 3: Run web pure tests**

Run: `npx --prefix web tsx --test web/scripts/*.test.ts`
Expected: all audio-format, provider-meta, onboarding, and async-result tests pass.

### Task 3: Verify and commit the integration

**Files:**
- Verify: repository-wide merged tree
- Commit: merge result and this plan

**Interfaces:**
- Consumes: resolved, audited merge index.
- Produces: one merge commit on `integrate/upstream-v0.43.0` ready for review or integration into `develop`.

- [x] **Step 1: Refresh dependencies from merged lockfiles**

Run: `npm ci && npm --prefix controller ci && npm --prefix web ci && npm --prefix mcp-subwave ci`
Expected: all installs exit 0 without lockfile drift.

- [x] **Step 2: Run merge-gate lint/typechecks**

Run: `npm --prefix controller run lint && npm --prefix web run lint && npm --prefix mcp-subwave run lint && npm run cli:typecheck`
Expected: all commands exit 0; known controller warnings may remain non-blocking.

- [x] **Step 3: Build the web application**

Run: `npm --prefix web run build`
Expected: Next.js production build exits 0.

- [x] **Step 4: Validate and commit**

Run: `git diff --check && git status --short && git diff --cached --stat`
Expected: no whitespace errors, no unmerged files, and only intended integration changes.

Run: `git commit`
Expected: merge commit records integration of `v0.43.0` while retaining fork changes.
