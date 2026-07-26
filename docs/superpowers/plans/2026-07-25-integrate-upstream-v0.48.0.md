# SUB/WAVE v0.48.0 Upstream Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge exact upstream SUB/WAVE `v0.48.0` into ObiWave, make upstream's split controller/admin architecture authoritative, adopt all v0.48.0 behavior, and preserve fork-specific provider, security, player, renderer, embedding, request, and release contracts.

**Architecture:** Perform one non-fast-forward merge whose second parent is the exact upstream tag commit. Keep upstream's thin entry modules and focused submodules, port fork behavior into those focused ownership boundaries, and audit every both-sides path. All merge work stays staged and uncommitted until the final verification task creates the merge commit.

**Tech Stack:** Git, Node.js 22, TypeScript, React 19, Next.js 16, Expo/React Native, Express, Docker Compose, Icecast, Liquidsoap, Bash, Python, GitHub Actions, Node test runner, ESLint, and TypeScript.

## Global Constraints

- Start from `origin/develop` at `7c56cd1220f917326fd983116809247e36cf093a`, plus only the approved design and plan commits.
- Merge exact tag `v0.48.0` at `d0a4254386519511329625b5fb65f23d08b2f70c`; never merge a moving upstream branch.
- The final merge commit's second parent must be `d0a4254386519511329625b5fb65f23d08b2f70c`.
- Prefer upstream v0.48.0 behavior whenever it fully replaces fork behavior for the same clients and guarantees.
- Upstream split modules and per-directory `CLAUDE.md`/`AGENTS.md` files are authoritative; do not restore old monolithic bodies.
- Adopt the Rundown page, mobile admin behavior, polled playlist jobs, station-wide voice switch, station house rules, skill filtering, admin polish, and refreshed documentation.
- Preserve four-format authenticated playback, measured-web/per-format-fallback timing, station-scoped credentials, provider-owned URLs and keys, settings response secrecy, rate-aware bulk embeddings, strict requests, the shared Icecast renderer, and fork release/Portainer controls.
- Use upstream `ghcr.io/perminder-klair/subwave-analyzer-cuda`; never build or publish `subwave-analyzer-cuda` in ObiWave.
- Retain fork design/plan history despite upstream documentation restructuring.
- Keep `feature/kagi-web-search` entirely outside this integration.
- Generated CLI assets and theme tokens are never hand-edited.
- Do not deploy, push, publish, mutate Odin, tag, cut a release, create a pull request, or update external infrastructure during integration.
- Atomic merge exception: do not commit while the merge is in progress. Tasks 2–7 operate inside one staged, uncommitted merge; Task 8 creates the merge commit.

## File Responsibility Map

- `controller/src/settings.ts`: upstream thin compatibility/public entry point; no restored monolithic implementation.
- `controller/src/settings/{defaults,vocab,normalize,validate,store,persona,liquidsoap}.ts`: settings defaults, provider maps, migrations, validation, persistence, persona prompts, and generated Liquidsoap state.
- `controller/src/routes/settings.ts`: upstream mount table only.
- `controller/src/routes/settings/{core,llm,tts,station}.ts`: settings response boundary, credential writes, provider probes, model discovery, TTS, and station controls.
- `controller/src/music/tag-library.ts`: upstream thin tagger orchestrator.
- `controller/src/music/tag-library/{embed,enrich,flags,log,tag}.ts`: tagger phases and CLI behavior.
- `controller/src/music/embedding-bulk.ts`: fork bulk batch/retry/progress policy consumed by `tag-library/embed.ts`.
- `controller/src/routes/request.ts` and `controller/src/routes/request-strict.ts`: upstream request flow composed with fork strict matching.
- `controller/src/broadcast/voice-policy.ts`: upstream station-wide voice policy.
- `controller/src/settings/persona.ts`: house-rules composition for scripted and agent prompt paths.
- `controller/src/music/playlist-jobs.ts` and `controller/src/routes/playlists.ts`: upstream async playlist job lifecycle and routes.
- `web/components/admin/schedule/**`: upstream dedicated Rundown UI.
- `web/components/admin/**`: upstream split/mobile admin architecture composed with fork provider state.
- `web/components/player/**`, `web/hooks/usePlayer.ts`, and `web/hooks/useStationFeed.ts`: retained authenticated four-format player and timing.
- `controller/CLAUDE.md`, `web/CLAUDE.md`, `app/CLAUDE.md`, and `liquidsoap/CLAUDE.md`: narrow fork invariants under upstream's guidance hierarchy.
- `cli/src/assets.generated.ts` and `web/lib/theme-tokens.generated.ts`: regenerated outputs only.

---

### Task 1: Reconfirm the exact fork baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-25-integrate-upstream-v0.48.0-design.md`
- Read: `docs/superpowers/plans/2026-07-25-integrate-upstream-v0.48.0.md`

**Interfaces:**
- Consumes: branch `integrate/upstream-v0.48.0` based on exact current `origin/develop`.
- Produces: a clean isolated worktree, reproducible dependencies, and recorded passing pre-merge behavior.

- [ ] **Step 1: Verify branch provenance and worktree isolation**

```bash
test "$(git branch --show-current)" = integrate/upstream-v0.48.0
test "$(git merge-base HEAD origin/develop)" = 7c56cd1220f917326fd983116809247e36cf093a
git merge-base --is-ancestor 7c56cd1220f917326fd983116809247e36cf093a HEAD
git status --short
```

Expected: all checks exit 0 and status is empty. `HEAD` contains only the approved design/plan documentation above the fork base.

- [ ] **Step 2: Install every package reproducibly**

```bash
npm ci --no-audit --no-fund
npm --prefix controller ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm --prefix mcp-subwave ci --no-audit --no-fund
npm --prefix cli ci --no-audit --no-fund
npm --prefix app ci --no-audit --no-fund
```

Expected: every command exits 0 and no lockfile changes.

- [ ] **Step 3: Run the pre-merge controller and repository suites**

```bash
npm --prefix controller test
node --test scripts/**/*.test.mjs
```

Expected: all 64 controller test files and all 62 repository contracts pass.

- [ ] **Step 4: Run every fork web/native behavior contract**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix app run test:stream-buffer-format
```

Expected: every command exits 0. Module-type performance warnings are acceptable; assertion failures are not.

- [ ] **Step 5: Confirm the baseline remains clean**

```bash
git status --short
```

Expected: no output. Stop and report any baseline failure before beginning the merge.

### Task 2: Begin the exact non-fast-forward merge

**Files:**
- Merge: every path changed by `v0.47.0..v0.48.0`
- Conflict: `CLAUDE.md`
- Conflict: `controller/src/music/tag-library.ts`
- Conflict: `controller/src/routes/settings.ts`
- Conflict: `controller/src/settings.ts`

**Interfaces:**
- Consumes: the clean Task 1 worktree and immutable upstream tag.
- Produces: one in-progress merge with the exact tag in `MERGE_HEAD` and the forecast four-conflict set.

- [ ] **Step 1: Verify the local and remote tag commit**

```bash
test "$(git rev-parse 'v0.48.0^{}')" = d0a4254386519511329625b5fb65f23d08b2f70c
test "$(git ls-remote --tags upstream refs/tags/v0.48.0 | cut -f1)" = d0a4254386519511329625b5fb65f23d08b2f70c
```

Expected: both checks exit 0.

- [ ] **Step 2: Start the merge without committing**

```bash
git merge --no-ff --no-commit v0.48.0
```

Expected: Git stops for conflict resolution and creates no commit.

- [ ] **Step 3: Verify the exact conflict inventory**

```bash
git diff --name-only --diff-filter=U | sort
```

Expected exactly:

```text
CLAUDE.md
controller/src/music/tag-library.ts
controller/src/routes/settings.ts
controller/src/settings.ts
```

- [ ] **Step 4: Verify immutable merge provenance**

```bash
test "$(git rev-parse MERGE_HEAD)" = d0a4254386519511329625b5fb65f23d08b2f70c
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/heads/integrate/upstream-v0.48.0)"
```

Expected: both checks exit 0.

- [ ] **Step 5: Record the ignored merge ledger**

Create `.superpowers/sdd/2026-07-25-integrate-upstream-v0.48.0/progress.md` with:

```markdown
# SUB/WAVE v0.48.0 integration progress

Fork base: 7c56cd1220f917326fd983116809247e36cf093a
Plan head: record `git rev-parse HEAD` immediately before the merge
Upstream second parent: d0a4254386519511329625b5fb65f23d08b2f70c
Execution rule: Tasks 2–7 remain one staged, uncommitted merge; Task 8 creates the merge commit.

Task 1: complete
Task 2: complete
```

Expected: the ledger records checkpoints without entering the merge commit.

### Task 3: Adopt the split settings architecture and preserve provider/security boundaries

**Files:**
- Resolve: `controller/src/settings.ts`
- Resolve: `controller/src/routes/settings.ts`
- Modify: `controller/src/settings/defaults.ts`
- Modify: `controller/src/settings/vocab.ts`
- Modify: `controller/src/settings/store.ts`
- Modify: `controller/src/settings/normalize.ts`
- Modify: `controller/src/settings/validate.ts`
- Modify: `controller/src/routes/settings/core.ts`
- Modify: `controller/src/routes/settings/llm.ts`
- Test: `controller/scripts/litellm-config.test.ts`
- Test: `controller/scripts/litellm-routes.test.ts`
- Test: `controller/scripts/settings-route-security.test.ts`
- Test: `controller/scripts/cloud-tts-provider-key.test.ts`
- Test: `controller/scripts/embedding-provider-config.test.ts`

**Interfaces:**
- Consumes: upstream focused settings modules and route mount table.
- Produces:
  - thin compatibility exports from `settings.ts`;
  - provider-owned primary/fallback/embedding/TTS URL and key maps;
  - `llmKeyFor(provider: string): string`;
  - `publicUpdateResult(result): { requiresRestart: boolean }`;
  - settings updates that never return stored credentials.

- [ ] **Step 1: Pin thin-entry structural ownership before resolving**

Create `scripts/ci/upstream-v048-structure.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const settings = read('controller/src/settings.ts');
const routes = read('controller/src/routes/settings.ts');
const tagger = read('controller/src/music/tag-library.ts');

assert.match(settings, /from ['"]\.\/settings\/store\.js['"]/);
assert.match(settings, /from ['"]\.\/settings\/validate\.js['"]/);
assert.ok(settings.split('\n').length < 2100, 'settings entry must remain split');
assert.match(routes, /from ['"]\.\/settings\/core\.js['"]/);
assert.ok(routes.split('\n').length < 80, 'settings route entry must remain a mount table');
assert.match(tagger, /from ['"]\.\/tag-library\/embed\.js['"]/);
assert.ok(tagger.split('\n').length < 900, 'tag-library entry must remain an orchestrator');
```

Run:

```bash
node --test scripts/ci/upstream-v048-structure.test.mjs
```

Expected: FAIL while conflict markers/old fork monolith bodies remain.

- [ ] **Step 2: Resolve `controller/src/settings.ts` as the upstream thin entry**

Keep upstream imports and re-exports. Port fork behavior into the focused owner modules instead of pasting the old body. Preserve this compatibility surface:

```ts
export {
  get,
  getDefaults,
  getRedacted,
  llmKeyFor,
  minTrackSeconds,
  resolveMaxOutputTokens,
} from './settings/store.js';
```

Add `publicUpdateResult` to `settings/store.ts` and re-export it:

```ts
export function publicUpdateResult(result: { requiresRestart?: unknown }) {
  return { requiresRestart: !!result?.requiresRestart };
}
```

Expected: existing imports continue to compile without restoring the monolith.

- [ ] **Step 3: Compose provider defaults, normalization, and validation**

Retain upstream v0.48 fields, voice/house-rule defaults, and validation. Port only missing fork guarantees:

```ts
// Every configurable LLM leg owns URLs by provider.
providerBaseUrls: {} as Record<string, string>

// Inline keys remain provider scoped.
keys: {} as Record<string, string>
```

Keep the compatibility rule that legacy `baseUrl` migrates only into the active provider's map, after which flat `baseUrl` is derived. Preserve the dedicated Locca embedding default and prevent chat-only LiteLLM from donating its URL/key to a different explicit embedding provider.

Expected: `normalizeLlmProviderBaseUrls`, `normalizeLlmKeys`, `applyInlineKey`, strict URL validation, and existing-settings load compatibility remain in focused modules.

- [ ] **Step 4: Resolve settings routes around secrecy and provider identity**

Keep `controller/src/routes/settings.ts` as only the upstream mount table:

```ts
router.use(coreRoutes);
router.use(llmRoutes);
router.use(ttsRoutes);
router.use(stationRoutes);
```

In `core.ts`, serialize the POST result only through:

```ts
res.json(settings.publicUpdateResult(result));
```

In `llm.ts`, resolve every saved key by the same validated provider identity that selects the probe/model adapter:

```ts
const resolvedApiKey = submittedApiKey || settings.llmKeyFor(provider);
```

Expected: no response includes `saved`, inline keys, environment keys, or secret values; no probe can pair one provider's stored key with another provider's endpoint.

- [ ] **Step 5: Run the focused settings regressions**

```bash
npm --prefix controller test -- litellm-config
npm --prefix controller test -- litellm-routes
npm --prefix controller test -- settings-route-security
npm --prefix controller test -- cloud-tts-provider-key
npm --prefix controller test -- embedding-provider-config
npm --prefix controller test -- voice-policy
npm --prefix controller test -- house-rules
node --test scripts/ci/upstream-v048-structure.test.mjs
```

Expected: all pass. `voice-policy` proves missing/non-boolean persisted `tts.enabled` defaults on; `house-rules` proves both prompt paths receive bounded rules. Defer the controller typecheck to Task 4 immediately after resolving `controller/src/music/tag-library.ts`, because its untouched merge markers make a Task 3 typecheck impossible.

- [ ] **Step 6: Stage and review Task 3 without committing**

```bash
git add controller/src/settings.ts controller/src/settings \
  controller/src/routes/settings.ts controller/src/routes/settings \
  controller/scripts/litellm-config.test.ts \
  controller/scripts/litellm-routes.test.ts \
  controller/scripts/settings-route-security.test.ts \
  controller/scripts/cloud-tts-provider-key.test.ts \
  controller/scripts/embedding-provider-config.test.ts \
  controller/scripts/voice-policy.test.ts \
  controller/scripts/house-rules.test.ts \
  scripts/ci/upstream-v048-structure.test.mjs
git diff --cached --check
```

Expected: a fresh reviewer approves module ownership, migration, provider isolation, and response secrecy. Do not commit.

### Task 4: Port bulk embedding and strict-request behavior into upstream modules

**Files:**
- Resolve: `controller/src/music/tag-library.ts`
- Modify: `controller/src/music/tag-library/embed.ts`
- Review: `controller/src/music/tag-library/{enrich,flags,log,tag}.ts`
- Preserve: `controller/src/music/embedding-bulk.ts`
- Review: `controller/src/routes/request.ts`
- Preserve: `controller/src/routes/request-strict.ts`
- Test: `controller/scripts/embedding-bulk.test.ts`
- Test: `controller/scripts/tagger-perf.test.ts`
- Test: `controller/scripts/lastfm-enrich.test.ts`
- Test: `controller/scripts/rescan-scope.test.ts`
- Test: `controller/scripts/request-strict.test.ts`
- Test: `controller/scripts/request-dedup.test.ts`

**Interfaces:**
- Consumes: upstream `phaseEmbed()` module and request flow.
- Produces: cloud/local batch policy, bounded rate-limit waits, atomic progress commits, sanitized errors, and exact strict request selection.

- [ ] **Step 1: Move the bulk-wiring assertion to the new owner and verify RED**

In `controller/scripts/embedding-bulk.test.ts`, change only the source inspected
by the existing `tagger wires bulk retry only around document embeddings` test:

```ts
const tagger = readFileSync(
  new URL('../src/music/tag-library/embed.ts', import.meta.url),
  'utf8',
);
```

```bash
npm --prefix controller test -- embedding-bulk
npm --prefix controller test -- request-strict
```

Expected: `embedding-bulk` FAILS because the upstream `embed.ts` does not yet
wire `bulkEmbeddingBatchSize`, `commitBulkEmbeddingBatch`, or
`withBulkEmbeddingRateLimit`. The pure retry assertions and `request-strict`
remain green.

- [ ] **Step 2: Resolve `tag-library.ts` as the upstream orchestrator**

Keep upstream imports:

```ts
import { phaseEmbed } from './tag-library/embed.js';
import { phaseEnrich } from './tag-library/enrich.js';
import { parseFlags } from './tag-library/flags.js';
import { llmTagInBatches } from './tag-library/tag.js';
```

Do not reintroduce phase implementations into this file. Keep only orchestration, shared vote plumbing, run sequencing, progress lifecycle, and process cleanup.

- [ ] **Step 3: Compose fork bulk policy in `tag-library/embed.ts`**

Import and use the existing fork policy:

```ts
import {
  bulkEmbeddingBatchSize,
  bulkEmbeddingFailureMessage,
  commitBulkEmbeddingBatch,
  withBulkEmbeddingRateLimit,
} from '../embedding-bulk.js';
```

For each batch:

```ts
const local = embeddings.embeddingPerfAdvisory().local;
const embedBatchSize = bulkEmbeddingBatchSize(batchSize, local);
const vecs = await withBulkEmbeddingRateLimit(
  () => embeddings.embedDocTexts(texts, textMode, { maxRetries: 0 }),
  { onWait: ({ seconds, attempt }) =>
      logEvent('info', `Embedding rate limit — waiting ${seconds}s (attempt ${attempt})`) },
);
commitBulkEmbeddingBatch({
  result: vecs,
  commit: values => {
    for (let j = 0; j < songs.length; j++) db.upsertTrackVector(songs[j].id, values[j]);
  },
  onCommitted: () => reportProgress({
    phase: 'embed',
    label: 'Embedding tracks',
    done: Math.min(i + batch.length, unique.length),
    total: unique.length,
  }),
});
```

On terminal failure, log only `bulkEmbeddingFailureMessage(err)`, then rethrow
for the existing run failure path. The explicit `maxRetries: 0` prevents nested
SDK retry delays inside the outer `Retry-After` policy.

Expected: progress advances only after every vector in a batch is committed; retry sleeps are bounded to three usable `Retry-After` hints.

- [ ] **Step 4: Preserve strict request composition**

Review Git's auto-merge in `routes/request.ts`. Keep upstream request changes while retaining:

```ts
const target = strictRequestTarget(matched);
const selected = pickStrictCandidate(target, candidates);
if (settings.get().llm.strictRequests && target && !selected) {
  return strictFailureMessage(target);
}
```

Use the repository's actual surrounding return types and acknowledgement flow; do not duplicate helpers from `request-strict.ts`.

Expected: title+artist and artist-only requests remain exact, while vibe requests and dedup behavior remain unchanged.

- [ ] **Step 5: Run tagger and request regressions**

```bash
npm --prefix controller test -- embedding-bulk
npm --prefix controller test -- tagger-perf
npm --prefix controller test -- lastfm-enrich
npm --prefix controller test -- rescan-scope
npm --prefix controller test -- request-strict
npm --prefix controller test -- request-dedup
node --test scripts/ci/upstream-v048-structure.test.mjs
npm --prefix controller run typecheck
```

Expected: all pass and the tag-library entry remains an orchestrator. This is the first controller typecheck after the settings work because Task 4 resolves the final controller conflict.

- [ ] **Step 6: Stage and review Task 4 without committing**

```bash
git add controller/src/music/tag-library.ts controller/src/music/tag-library \
  controller/src/music/embedding-bulk.ts controller/src/routes/request.ts \
  controller/src/routes/request-strict.ts controller/scripts/embedding-bulk.test.ts \
  controller/scripts/tagger-perf.test.ts controller/scripts/lastfm-enrich.test.ts \
  controller/scripts/rescan-scope.test.ts controller/scripts/request-strict.test.ts \
  controller/scripts/request-dedup.test.ts
git diff --cached --check
```

Expected: a fresh reviewer approves upstream structural ownership, retry correctness, progress accounting, sanitized errors, and request strictness. Do not commit.

### Task 5: Adopt v0.48 controller features and all remaining controller splits

**Files:**
- Adopt/review: `controller/src/broadcast/dj-agent/**`
- Adopt/review: `controller/src/broadcast/queue/**`
- Adopt/review: `controller/src/broadcast/voice-policy.ts`
- Adopt/review: `controller/src/broadcast/dj-gate.ts`
- Adopt/review: `controller/src/broadcast/programme.ts`
- Adopt/review: `controller/src/broadcast/scheduler.ts`
- Adopt/review: `controller/src/doctor/**`
- Adopt/review: `controller/src/music/library-db/**`
- Adopt/review: `controller/src/music/playlist-jobs.ts`
- Adopt/review: `controller/src/routes/playlists.ts`
- Test: `controller/scripts/voice-policy.test.ts`
- Test: `controller/scripts/house-rules.test.ts`
- Test: `controller/scripts/playlist-jobs.test.ts`

**Interfaces:**
- Consumes: resolved Task 3 settings and upstream split modules.
- Produces: voice gating, house rules on both prompt paths, resilient async playlist jobs, and upstream module decompositions without fork regressions.

- [ ] **Step 1: Verify station-wide voice behavior**

Run:

```bash
npm --prefix controller test -- voice-policy
```

Expected: PASS with these exact policies:

```ts
voiceEnabled(): boolean
autoVoiceAllowed(): boolean
voiceStatus(): { enabled: boolean }
```

Absent or invalid persisted values read as enabled. Voice off suppresses autonomous speech before generation, but track picks, listener requests, jingles, and manual `/dj/segment` operations continue.

- [ ] **Step 2: Verify house rules reach both prompt paths**

```bash
npm --prefix controller test -- house-rules
```

Expected: PASS. `djHouseRules` is trimmed, capped at 2000 characters, inert when empty, appended to custom templates, and scoped to spoken fields in the agent prompt.

- [ ] **Step 3: Verify async playlist job lifecycle**

```bash
npm --prefix controller test -- playlist-jobs
```

Expected: PASS for:

```ts
create(now?): GenerateJob | null
get(id, now?): GenerateJob | undefined
complete(id, result, now?): void
fail(id, message, now?): void
```

The concurrent cap is three; completed results remain claimable for ten minutes; wedged running jobs expire after thirty minutes; first terminal landing wins.

- [ ] **Step 4: Audit split controller entry points**

```bash
test "$(wc -l < controller/src/broadcast/dj-agent.ts)" -lt 700
test "$(wc -l < controller/src/broadcast/queue.ts)" -lt 800
test "$(wc -l < controller/src/doctor.ts)" -lt 500
test "$(wc -l < controller/src/music/library-db.ts)" -lt 500
rg -n "from './(dj-agent|queue|doctor|library-db)/" controller/src
```

Expected: upstream entry files remain thin and import their focused modules. Any threshold miss is reviewed rather than bypassed.

- [ ] **Step 5: Run the complete controller suite and static gate**

```bash
npm --prefix controller test
npm --prefix controller run lint
```

Expected: every discovered v0.48 controller test passes with zero lint/type errors. Record warning-only totals.

- [ ] **Step 6: Stage and review Task 5 without committing**

```bash
git add controller/src/broadcast controller/src/doctor.ts controller/src/doctor \
  controller/src/music/library-db.ts controller/src/music/library-db \
  controller/src/music/playlist-jobs.ts controller/src/routes/playlists.ts \
  controller/scripts/voice-policy.test.ts controller/scripts/house-rules.test.ts \
  controller/scripts/playlist-jobs.test.ts
git diff --cached --check
```

Expected: a fresh reviewer approves voice policy, prompt composition, playlist-job failure/recovery, and split module ownership. Do not commit.

### Task 6: Adopt upstream admin/documentation structure while preserving fork web/player behavior

**Files:**
- Resolve: `CLAUDE.md`
- Adopt/review: `controller/CLAUDE.md`
- Adopt/review: `web/CLAUDE.md`
- Adopt/review: `app/CLAUDE.md`
- Adopt/review: `liquidsoap/CLAUDE.md`
- Adopt/review: `controller/AGENTS.md`
- Adopt/review: `web/AGENTS.md`
- Adopt/review: `app/AGENTS.md`
- Adopt/review: `liquidsoap/AGENTS.md`
- Review: `README.md`
- Adopt/review: `web/app/admin/shows/schedule/page.tsx`
- Adopt/review: `web/components/admin/schedule/**`
- Adopt/review: `web/components/admin/{dash,debug,library,playlist-builder,shows}/**`
- Review: `web/components/admin/AdminShell.tsx`
- Review: `web/components/admin/SettingsPanel.tsx`
- Review: `web/components/admin/settings/LlmSection.tsx`
- Review: `web/components/admin/settings/shared.tsx`
- Review: `web/package.json`
- Preserve/review: `web/components/player/**`
- Preserve/review: `web/hooks/usePlayer.ts`
- Preserve/review: `web/hooks/useStationFeed.ts`

**Interfaces:**
- Consumes: upstream v0.48 admin APIs and resolved provider settings.
- Produces: upstream Rundown/mobile/split admin behavior plus retained authenticated four-format playback and provider-specific form state.

- [ ] **Step 1: Resolve the documentation hierarchy**

Keep root `CLAUDE.md` concise. Move fork rules into the narrowest upstream file:

```text
controller/CLAUDE.md  provider ownership, response secrecy, bulk embeddings, strict requests
web/CLAUDE.md         authenticated four-format player, station-scoped auth, timing, provider forms
app/CLAUDE.md         active-format native fallback and station-scoped format preference
liquidsoap/CLAUDE.md  four mounts and shared rendered listener-auth contract
```

Retain the root links to those files and all fork design/plan history.

Expected: no conflict markers and no duplicated contradictory guidance.

- [ ] **Step 2: Adopt upstream Rundown and mobile admin components**

Keep the dedicated `/admin/shows/schedule` page, schedule component directory, mobile editor footers, reachable save bar, `useUnsavedGuard`, async playlist generation polling, and split Dash/Debug/Library/Shows modules.

Expected: the old weekly schedule placement is not restored, synchronous playlist generation is not restored, and no split component bodies are pasted back into parent monoliths.

- [ ] **Step 3: Preserve fork provider form and player seams**

In all four auto-merged settings paths, retain upstream layout changes while preserving provider-scoped URLs/keys and stale-result suppression. Ensure `web/package.json` includes every fork contract:

```json
"test:audio-format": "node --experimental-strip-types scripts/audio-format.test.ts",
"test:stream-auth-format": "node --experimental-strip-types scripts/stream-auth-format.test.ts",
"test:llm-provider": "node --experimental-strip-types scripts/llm-provider-meta.test.ts",
"test:onboarding-provider-state": "node --experimental-strip-types scripts/onboarding-provider-state.test.ts",
"test:async-generation": "node --experimental-strip-types scripts/async-result-generation.test.ts",
"test:llm-section-provider-url-contract": "node --experimental-strip-types scripts/llm-section-provider-url-contract.test.ts"
```

Verify the composed player still exposes:

```ts
type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac';
getListenerLagMs(): number | null;
```

Measured web lag wins while playing; active-format advertised delay remains the native/non-playing fallback. Every stream assignment uses station-scoped auth, optional-format failure falls back to MP3, and detach/remount tears down private audio.

- [ ] **Step 4: Run web/native behavior contracts**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix app run test:stream-buffer-format
```

Expected: all seven commands pass.

- [ ] **Step 5: Run web and app static/build gates**

```bash
npm --prefix web run lint
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix web run build
```

Expected: zero errors and a successful production build. If Next rewrites `web/tsconfig.json` or `web/next-env.d.ts`, restore the intended upstream committed forms with a targeted patch and rerun `npm --prefix web run lint`.

- [ ] **Step 6: Stage and review Task 6 without committing**

```bash
git add CLAUDE.md README.md controller/CLAUDE.md controller/AGENTS.md \
  web/CLAUDE.md web/AGENTS.md app/CLAUDE.md app/AGENTS.md \
  liquidsoap/CLAUDE.md liquidsoap/AGENTS.md web/app web/components web/hooks \
  web/lib web/package.json web/package-lock.json app
git diff --cached --check
```

Expected: a fresh reviewer approves upstream documentation/admin ownership and retained player/provider/auth behavior. Do not commit.

### Task 7: Regenerate assets, render deployments, and audit all overlaps

**Files:**
- Regenerate: `cli/src/assets.generated.ts`
- Regenerate if inputs changed: `web/lib/theme-tokens.generated.ts`
- Review: all 12 both-sides overlap paths
- Review: `.github/workflows/**`
- Review: `scripts/ci/**`
- Review: `deploy/portainer/**`
- Review: `docker/icecast-render.sh`
- Review: `docker/broadcast-entrypoint.sh`
- Review: `docker/aio/supervisor.sh`

**Interfaces:**
- Consumes: fully resolved Tasks 3–6.
- Produces: deterministic generated files, valid deployment shapes, zero unmerged paths, and a complete semantic overlap audit.

- [ ] **Step 1: Regenerate CLI assets twice**

Remove only the generated file with `apply_patch`, then run:

```bash
npm --prefix cli run embed-assets
git add cli/src/assets.generated.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
```

Expected: the first run recreates the asset at v0.48.0; the second leaves no diff.

- [ ] **Step 2: Regenerate theme tokens when their inputs changed**

```bash
if ! git diff --cached --quiet -- controller/src/themes.ts; then
  npm --prefix controller run gen:themes
  git add web/lib/theme-tokens.generated.ts
  npm --prefix controller run gen:themes
  git diff --exit-code -- web/lib/theme-tokens.generated.ts
fi
```

Expected: either no relevant input changed or the second generation leaves no diff.

- [ ] **Step 3: Render all required Compose shapes without starting containers**

Use `apply_patch` to create ignored temporary `.env`:

```dotenv
ADMIN_USER=ci
ADMIN_PASS=ci
SITE_URL=https://radio.example.test
```

Run:

```bash
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.byo.yml config --quiet
docker compose -f docker-compose.dev.yml config --quiet
SUBWAVE_VERSION=v0.48.0-obiwave.1 docker compose -f deploy/portainer/docker-compose.yml config --quiet
SUBWAVE_VERSION=v0.48.0 docker compose -f docker-compose.yml -f docker-compose.analyzer-gpu.yml config --quiet
```

Then delete `.env` with `apply_patch` even if a render fails.

Expected: every render exits 0, no container starts, fork Portainer uses fork images, and the GPU overlay uses upstream CUDA with an upstream-compatible tag.

- [ ] **Step 4: Audit exactly 12 both-sides paths**

```bash
BASE=6dea8f751b9e9b5d783c9de831d234aad1e5c2ed
while IFS= read -r path; do
  printf '\nPATH %s — staged merge\n' "$path"
  git diff --cached -- "$path"
  printf '\nPATH %s — upstream delta\n' "$path"
  git diff "$BASE"..v0.48.0 -- "$path"
  printf '\nPATH %s — fork delta\n' "$path"
  git diff "$BASE"..7c56cd1220f917326fd983116809247e36cf093a -- "$path"
done < <(
  comm -12 \
    <(git diff --name-only "$BASE"..7c56cd1220f917326fd983116809247e36cf093a | sort) \
    <(git diff --name-only "$BASE"..v0.48.0 | sort)
)
```

Expected: exactly 12 path sections. Record one concrete composition sentence per path in `.superpowers/sdd/2026-07-25-integrate-upstream-v0.48.0/task-7-report.md`.

- [ ] **Step 5: Verify renderer, publication, and workflow contracts**

```bash
bash -n docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh
npm --prefix controller test -- icecast-render
npm --prefix controller test -- aio-icecast-render
npm --prefix controller test -- listener-auth
node --test scripts/ci/workflow-contract.test.mjs
node --test scripts/ci/validate-portainer-compose.test.mjs
node --test scripts/ci/assert-image-tag-absent.test.mjs
node --test scripts/release/fork-tag.test.mjs
node --test scripts/deploy/portainer-client.test.mjs
```

Expected: split/AIO use one renderer, all private mounts are authenticated, fork release contracts pass, and CUDA analyzer publication remains excluded.

- [ ] **Step 6: Verify conflicts, markers, whitespace, and scope**

```bash
test -z "$(git diff --name-only --diff-filter=U)"
test -z "$(git ls-files -u)"
! rg -n '^(<<<<<<<|=======|>>>>>>>)' . --hidden -g '!node_modules' -g '!.git'
git diff --check
git diff --cached --check
test ! -e .env
! rg -ni '\bkagi\b|KAGI_API_KEY' \
  controller web app cli .env.example docker-compose*.yml
```

Expected: every check exits 0.

- [ ] **Step 7: Stage the complete merge and request semantic review**

```bash
git add -A
git status --short
```

Expected: every source change is staged; there are no unmerged, unstaged, or untracked entries. A fresh reviewer receives the design, this plan, Task 3–6 reports, the exact 12-path report, and the live staged diff. Do not commit.

### Task 8: Run full verification, create the merge commit, and request final review

**Files:**
- Verify: entire repository
- Commit: all staged merge changes

**Interfaces:**
- Consumes: the fully resolved and reviewed staged merge.
- Produces: one verified merge commit with exact v0.48.0 second-parent ancestry and a clean local handoff.

- [ ] **Step 1: Run full controller and Python suites**

```bash
npm --prefix controller test
python3 controller/scripts/vocal_gate_test.py
python3 controller/scripts/test_chatterbox_chunk.py
python3 controller/scripts/analyze-worker-audio.test.py
```

Expected: every discovered controller test and all Python suites pass.

- [ ] **Step 2: Run the complete repository contract suite**

```bash
node --test scripts/**/*.test.mjs
```

Expected: all repository, workflow, release, Portainer, generated-asset, and publication contracts pass.

- [ ] **Step 3: Run every web/native behavior contract**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix app run test:stream-buffer-format
```

Expected: every command exits 0.

- [ ] **Step 4: Run every lint/typecheck gate**

```bash
npm --prefix controller run lint
npm --prefix web run lint
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
```

Expected: zero errors. Warning-only output is recorded with exact counts.

- [ ] **Step 5: Build Next.js production output**

```bash
npm --prefix web run build
```

Expected: compilation, type validation, page generation, and optimization complete. Restore any build-generated TypeScript config edits with a targeted patch, then rerun web lint.

- [ ] **Step 6: Re-run generator and runtime gates**

```bash
npm --prefix controller run gen:themes
git diff --exit-code -- web/lib/theme-tokens.generated.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
bash -n docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh
python3 -m py_compile controller/scripts/analyze_worker.py controller/scripts/chatterbox_worker.py docker/analyzer/server.py
node --test scripts/ci/upstream-v048-structure.test.mjs
```

Expected: all checks exit 0 and leave no unstaged diff.

- [ ] **Step 7: Inspect the staged result**

```bash
git status --short
git diff --cached --stat
git diff --cached --check
git diff --exit-code
git diff --name-only --diff-filter=U
git ls-files -u
test ! -e .env
git diff --cached -- \
  CLAUDE.md controller/CLAUDE.md web/CLAUDE.md app/CLAUDE.md liquidsoap/CLAUDE.md \
  controller/src/settings.ts controller/src/settings \
  controller/src/routes/settings.ts controller/src/routes/settings \
  controller/src/music/tag-library.ts controller/src/music/tag-library \
  controller/src/routes/request.ts controller/src/broadcast/voice-policy.ts \
  controller/src/music/playlist-jobs.ts controller/src/routes/playlists.ts \
  web/components/admin web/components/player web/hooks web/package.json \
  cli/src/assets.generated.ts .github/workflows deploy/portainer
```

Expected: no unstaged/unmerged file, upstream split ownership, retained fork seams, intentional generated outputs, and no Kagi change.

- [ ] **Step 8: Create the merge commit**

```bash
git commit -m "merge: integrate subwave v0.48.0"
```

Expected: Git creates one merge commit.

- [ ] **Step 9: Verify exact ancestry and cleanliness**

```bash
test "$(git rev-parse HEAD^2)" = d0a4254386519511329625b5fb65f23d08b2f70c
git merge-base --is-ancestor 7c56cd1220f917326fd983116809247e36cf093a HEAD^1
git merge-base --is-ancestor v0.48.0 HEAD
git status --short
git log --oneline --decorate --graph -10
```

Expected: all ancestry checks exit 0, status is empty, and exact `v0.48.0` is the second parent.

- [ ] **Step 10: Request final whole-branch review**

Provide a fresh read-only reviewer:

- fork base and actual first parent;
- exact upstream second parent;
- approved design and this plan;
- Task 7's exact 12-path report;
- full Task 8 verification evidence;
- complete `fork-base..HEAD` and both-parent diffs.

Expected: no Critical or Important finding. Fix every material finding with a regression in one focused fix round, preserve both merge parents, rerun affected checks and the full matrix, and request one scoped re-review.

- [ ] **Step 11: Record the local handoff**

Report final merge SHA and parents, test counts, warning-only lint totals, upstream features adopted, fork behavior retained, structural ownership, overlap audit, reviewer verdict, and clean worktree.

Do not push, deploy, publish, tag, release, create a pull request, merge Kagi, or mutate Odin.
