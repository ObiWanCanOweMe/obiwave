# SUB/WAVE v0.47.0 Upstream Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge exact upstream SUB/WAVE `v0.47.0` into ObiWave, adopt upstream implementations wherever they fully replace fork behavior, remove the complete remote analyzer URL-handoff abstraction, and preserve fork-specific security, provider, player, renderer, and release contracts.

**Architecture:** Perform one non-fast-forward merge whose second parent is the exact upstream tag commit. Use upstream multi-station state resolution and shared-volume analyzer/stem flow as authoritative, compose upstream broadcast/admin changes with fork-only behavior, and audit every both-sides path. All merge work stays staged and uncommitted until the final verification task creates the merge commit.

**Tech Stack:** Git, Node.js 22, TypeScript, React 19, Next.js 16, Expo/React Native, Express, Docker Compose, Icecast, Liquidsoap, Bash, Python/Demucs analyzer workers, GitHub Actions, Node test runner, ESLint, and TypeScript.

## Global Constraints

- Start from `origin/develop` at `dde3f45de28c7ae75c216981c7359c534c259d7c`.
- Merge exact tag `v0.47.0` at `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`; never merge a moving upstream branch.
- The final merge commit's second parent must be `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`.
- Prefer upstream v0.47.0 behavior whenever it fully replaces fork behavior for the same clients and guarantees.
- Remove `ANALYZE_HANDOFF`, its helper, URL-mode branching, focused test, Compose/environment wiring, active documentation, and dedicated design/plan documents.
- Retain upstream shared-volume prefetch/path analysis, but preserve the fork fix that the first download starts only after the quiet gate opens.
- Adopt upstream multi-station profiles, vocal-aware transition policy, stem cache/blends, Navidrome settings, accessibility/admin improvements, roster views, and skin transitions.
- Preserve four-format authenticated playback, measured-web/per-format-fallback timing, station-scoped credentials, provider-owned URLs and keys, settings response secrecy, the shared Icecast renderer, and fork release/Portainer controls.
- Use upstream `ghcr.io/perminder-klair/subwave-analyzer-cuda`; never build or publish `subwave-analyzer-cuda` in ObiWave.
- Retain fork design/plan history despite upstream cleanup, except the dedicated obsolete remote-handoff design and plan.
- Generated CLI assets and theme tokens are never hand-edited.
- Do not deploy, push, publish, mutate Odin, tag, cut a release, create a pull request, or update external infrastructure during integration.
- Atomic merge exception: do not commit while the merge is in progress. Tasks 2–7 operate inside one staged, uncommitted merge; Task 8 creates the merge commit.

## File Responsibility Map

- `controller/src/stations/{pure,resolve,manager}.ts`: upstream station identity, boot-time active-state resolution, conversion, duplication, activation, and rollback.
- `controller/src/config.ts`: active station state paths plus fork environment configuration, with no analyzer-handoff field.
- `controller/src/routes/stations.ts` and `controller/src/routes/onboarding.ts`: profile management and per-profile onboarding.
- `controller/src/settings.ts` and `controller/src/routes/settings.ts`: per-profile upstream settings composed with fork provider/privacy/public-response contracts.
- `controller/src/music/analyze.ts`: upstream vocal/tail/stem behavior with post-quiet shared-volume prefetch.
- `controller/src/music/{analyzer,stem-cache,lyric-vocal,mix}.ts`: upstream analyzer protocol, local stem artifacts, and transition inputs.
- `controller/src/broadcast/{drain-policy,stem-blend,queue}.ts`: upstream vocal-aware drain and optional pre-rendered blends.
- `docker/icecast-render.sh`: fork's single split/AIO mount renderer and listener-auth boundary.
- `docker/broadcast-entrypoint.sh` and `docker/aio/supervisor.sh`: shared renderer callers plus upstream active-station mixer lifecycle.
- `liquidsoap/radio.liq`: upstream transition playback and station-switch behavior.
- `web/components/admin/**`, `web/app/admin/**`, and `web/lib/adminView.ts`: upstream station/admin/accessibility/roster architecture.
- `web/components/player/**`, `web/hooks/usePlayer.ts`, and `web/hooks/useStationFeed.ts`: retained authenticated four-format player and listener timing.
- `scripts/ci/analyzer-handoff-absent.test.mjs`: active-surface regression proving URL-handoff removal.
- `cli/src/assets.generated.ts` and `web/lib/theme-tokens.generated.ts`: regenerated outputs only.
- `CLAUDE.md`, `.env.example`, `README.md`, and `docs/multi-station.md`: active operator documentation.

---

### Task 1: Establish the current fork baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-24-integrate-upstream-v0.47.0-design.md`
- Read: `docs/superpowers/plans/2026-07-24-integrate-upstream-v0.47.0.md`

**Interfaces:**
- Consumes: branch `integrate/upstream-v0.47.0` based on exact current `origin/develop`.
- Produces: a clean isolated worktree, reproducible dependencies, and a recorded passing pre-merge baseline.

- [ ] **Step 1: Verify branch provenance and worktree isolation**

```bash
test "$(git branch --show-current)" = integrate/upstream-v0.47.0
test "$(git merge-base HEAD origin/develop)" = dde3f45de28c7ae75c216981c7359c534c259d7c
git merge-base --is-ancestor dde3f45de28c7ae75c216981c7359c534c259d7c HEAD
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

Expected: all 60 controller test files and all 59 repository contracts pass.

- [ ] **Step 4: Run every current web and native behavior contract**

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
- Merge: every path changed by `v0.46.0..v0.47.0`
- Conflict: `CLAUDE.md`
- Conflict: `controller/src/config.ts`
- Conflict: `controller/src/routes/onboarding.ts`
- Conflict: `docker/aio/supervisor.sh`
- Conflict: `docker/broadcast-entrypoint.sh`

**Interfaces:**
- Consumes: the clean Task 1 worktree and immutable upstream tag.
- Produces: one in-progress merge with the exact tag in `MERGE_HEAD` and the forecast five-conflict set.

- [ ] **Step 1: Verify the local and remote tag commit**

```bash
test "$(git rev-parse 'v0.47.0^{}')" = 6dea8f751b9e9b5d783c9de831d234aad1e5c2ed
test "$(git ls-remote --tags upstream refs/tags/v0.47.0 | cut -f1)" = 6dea8f751b9e9b5d783c9de831d234aad1e5c2ed
```

Expected: both checks exit 0.

- [ ] **Step 2: Start the merge without committing**

```bash
git merge --no-ff --no-commit v0.47.0
```

Expected: Git stops for conflict resolution and creates no commit.

- [ ] **Step 3: Verify the exact conflict inventory**

```bash
git diff --name-only --diff-filter=U | sort
```

Expected exactly:

```text
CLAUDE.md
controller/src/config.ts
controller/src/routes/onboarding.ts
docker/aio/supervisor.sh
docker/broadcast-entrypoint.sh
```

- [ ] **Step 4: Verify immutable merge provenance**

```bash
test "$(git rev-parse MERGE_HEAD)" = 6dea8f751b9e9b5d783c9de831d234aad1e5c2ed
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/heads/integrate/upstream-v0.47.0)"
```

Expected: both checks exit 0.

- [ ] **Step 5: Record the merge ledger**

Create ignored `.superpowers/sdd/progress.md` with:

```markdown
# SUB/WAVE v0.47.0 integration progress

Fork base: dde3f45de28c7ae75c216981c7359c534c259d7c
Plan head: record `git rev-parse HEAD` immediately before the merge
Upstream second parent: 6dea8f751b9e9b5d783c9de831d234aad1e5c2ed
Execution rule: Tasks 2–7 remain one staged, uncommitted merge; Task 8 creates the merge commit.

Task 1: complete
Task 2: complete
```

Expected: the ledger records checkpoints without entering the merge commit.

### Task 3: Remove URL handoff and compose upstream analysis/stem behavior

**Files:**
- Create: `scripts/ci/analyzer-handoff-absent.test.mjs`
- Delete: `controller/src/music/analyzer-handoff.ts`
- Delete: `controller/scripts/analyzer-handoff.test.ts`
- Delete: `docs/superpowers/specs/2026-07-07-remote-analyzer-url-handoff-design.md`
- Delete: `docs/superpowers/plans/2026-07-07-remote-analyzer-url-handoff.md`
- Resolve: `controller/src/config.ts`
- Resolve: `controller/src/routes/onboarding.ts`
- Modify: `controller/src/music/analyze.ts`
- Adopt/review: `controller/src/music/analyzer.ts`
- Adopt/review: `controller/src/music/stem-cache.ts`
- Adopt/review: `controller/src/music/lyric-vocal.ts`
- Adopt/review: `controller/scripts/analyze_worker.py`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.byo.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `deploy/portainer/docker-compose.yml`
- Resolve: `CLAUDE.md`
- Modify/review: `README.md`

**Interfaces:**
- Consumes: upstream `analyzer.downloadCapped(id)`, `analyzer.analyzePath(path, options)`, quiet-gate state, and `stemCacheStore.dirFor(id)`.
- Produces:
  - no `config.analyzer.handoff`;
  - no `ANALYZE_HANDOFF` active surface;
  - first/current download begins only after `waitForQuiet(...)`;
  - upstream `stems_dir` and `stemsCached` shared-volume behavior.

- [ ] **Step 1: Write the failing removal contract**

Create `scripts/ci/analyzer-handoff-absent.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const activeFiles = [
  '.env.example',
  'CLAUDE.md',
  'README.md',
  'controller/src/config.ts',
  'controller/src/music/analyze.ts',
  'docker-compose.yml',
  'docker-compose.byo.yml',
  'docker-compose.dev.yml',
  'deploy/portainer/docker-compose.yml',
];
const forbidden = /\bANALYZE_HANDOFF\b|analyzer-handoff|remote analyzer mode|Odin fetches stream URLs/i;

test('remote analyzer handoff is absent from active runtime and operator surfaces', () => {
  for (const path of activeFiles) {
    const text = readFileSync(resolve(root, path), 'utf8');
    assert.doesNotMatch(text, forbidden, path);
  }
});

test('remote analyzer handoff implementation and dedicated docs are deleted', () => {
  for (const path of [
    'controller/src/music/analyzer-handoff.ts',
    'controller/scripts/analyzer-handoff.test.ts',
    'docs/superpowers/specs/2026-07-07-remote-analyzer-url-handoff-design.md',
    'docs/superpowers/plans/2026-07-07-remote-analyzer-url-handoff.md',
  ]) {
    assert.equal(existsSync(resolve(root, path)), false, path);
  }
});
```

- [ ] **Step 2: Run the removal contract and verify RED**

```bash
node --test scripts/ci/analyzer-handoff-absent.test.mjs
```

Expected: FAIL against the existing configuration/helper/docs, proving the contract detects the feature.

- [ ] **Step 3: Remove the handoff abstraction and resolve configuration upstream-first**

Delete the helper, focused test, and dedicated docs. Remove `ANALYZE_HANDOFF` from `.env.example`, all four Compose controller environments, `config.analyzer`, onboarding's env-preservation list, `README.md`, and `CLAUDE.md`. Resolve `CLAUDE.md` upstream-first now so the removal contract can pass; Task 7 performs its final semantic documentation audit. Resolve `controller/src/config.ts` to retain upstream active-station roots:

```ts
const stateRoot = process.env.STATE_DIR || '/var/sub-wave';
const stateDir = resolveActiveStationDir(stateRoot);

// analyzer contains urls/python/workerScript/seconds only.
// No handoff field or normalization remains.
```

Expected: `config.stateRoot` remains the install root where upstream requires it, while state-scoped paths derive from the resolved active `stateDir`.

- [ ] **Step 4: Preserve post-quiet first prefetch while adopting upstream stems**

In `controller/src/music/analyze.ts`, keep upstream analysis/stem logic but use this orchestration:

```ts
type Prefetch = Promise<{ path: string; complete: boolean } | { err: any }>;
const prefetch = (songId: string): Prefetch =>
  analyzer.downloadCapped(songId).then((r) => r, (err) => ({ err }));
let inflight: Prefetch | null = null;

for (let i = 0; i < ids.length; i++) {
  await waitForQuiet(quietGate, { done: i, total: ids.length });
  const id = ids[i];
  const downloadPromise = inflight ?? prefetch(id);
  inflight = i + 1 < ids.length ? prefetch(ids[i + 1]) : null;
  // Await downloadPromise, call analyzePath, and retain upstream stems_dir,
  // lyric-vocal, tail-vocal, DB persistence, and stem-cache sweep behavior.
}
```

Expected: there is no URL/path mode switch; the first download occurs after quiet opens, and later one-ahead downloads overlap compute.

- [ ] **Step 5: Run focused analyzer tests GREEN**

```bash
node --test scripts/ci/analyzer-handoff-absent.test.mjs
(cd controller && npx tsx scripts/analyze-quiet.test.ts)
(cd controller && npx tsx scripts/lyric-vocal.test.ts)
(cd controller && npx tsx scripts/outro-mix.test.ts)
python3 controller/scripts/vocal_gate_test.py
python3 controller/scripts/analyze-worker-audio.test.py
python3 -m py_compile controller/scripts/analyze_worker.py docker/analyzer/server.py
```

Expected: every check passes. The quiet test must reject eager first prefetch, and upstream stem/tail fields remain intact.

- [ ] **Step 6: Stage and review Task 3 without committing**

```bash
git add -A -- \
  .env.example CLAUDE.md README.md \
  controller/src/config.ts controller/src/routes/onboarding.ts \
  controller/src/music/analyze.ts controller/src/music/analyzer.ts \
  controller/src/music/analyzer-handoff.ts controller/src/music/stem-cache.ts \
  controller/src/music/lyric-vocal.ts controller/scripts/analyzer-handoff.test.ts \
  controller/scripts/analyze_worker.py docker/analyzer/server.py \
  docker-compose.yml docker-compose.byo.yml docker-compose.dev.yml \
  deploy/portainer/docker-compose.yml \
  docs/superpowers/specs/2026-07-07-remote-analyzer-url-handoff-design.md \
  docs/superpowers/plans/2026-07-07-remote-analyzer-url-handoff.md \
  scripts/ci/analyzer-handoff-absent.test.mjs
git diff --cached --check
```

Expected: a fresh reviewer approves URL-handoff removal, post-quiet prefetch ordering, and upstream stem behavior. Do not commit.

### Task 4: Adopt multi-station profiles and compose settings/provider security

**Files:**
- Adopt: `controller/src/stations/pure.ts`
- Adopt: `controller/src/stations/resolve.ts`
- Adopt: `controller/src/stations/manager.ts`
- Adopt: `controller/src/routes/stations.ts`
- Adopt/review: `controller/src/server.ts`
- Adopt/review: `controller/src/setup/config.ts`
- Adopt/review: `controller/src/setup/firstRun.ts`
- Review: `controller/src/config.ts`
- Modify/review: `controller/src/settings.ts`
- Modify/review: `controller/src/routes/settings.ts`
- Modify/review: `controller/src/routes/public.ts`
- Modify/review: `controller/src/music/embeddings.ts`
- Modify/review: `controller/src/music/tag-library.ts`
- Test: `controller/scripts/stations-pure.test.ts`
- Test: `controller/scripts/stations-resolve.test.ts`
- Test: `controller/scripts/stations-manager.test.ts`
- Test: `controller/scripts/settings-route-security.test.ts`
- Test: `controller/scripts/cloud-tts-provider-key.test.ts`
- Test: `controller/scripts/embedding-provider-config.test.ts`

**Interfaces:**
- Consumes: upstream `resolveActiveStationDir(root)`, `activeStationId(root)`, station manager operations, and fork provider/privacy settings.
- Produces:
  - boot-frozen active state directory;
  - station CRUD/activation routes;
  - per-profile settings and provider maps;
  - `publicUpdateResult(): { requiresRestart: boolean }` secrecy boundary.

- [ ] **Step 1: Adopt upstream station modules and route registration**

Keep upstream implementations and verify these interfaces remain exact:

```ts
resolveActiveStationDir(root: string): string
activeStationId(root: string): string | null
createStation(root: string, opts): Promise<{ id: string; converted: boolean }>
activateStation(root: string, id: string): void
listStations(root: string, fallbackName: string, envConfigured?: boolean): StationInfo[]
```

Expected: single-station root compatibility, eight-profile cap, rollback, duplicate rules, stale-IPC drain, and active-pointer validation are present.

- [ ] **Step 2: Compose settings without weakening fork boundaries**

In `controller/src/settings.ts` and `controller/src/routes/settings.ts`, retain:

```ts
export function publicUpdateResult(): { requiresRestart: boolean } {
  return { requiresRestart };
}
```

Also retain distinct `providerBaseUrls`, `llmKeyFor(provider)`, provider-owned TTS/embedding keys, privacy locks, request strictness, bounded stream buffers, editable moods/beds/themes, and upstream station/stem settings.

Expected: active profile settings are isolated through `config.stateDir`; environment credentials remain install-level and intentionally override every profile.

- [ ] **Step 3: Run upstream multi-station tests**

```bash
(cd controller && npx tsx scripts/stations-pure.test.ts)
(cd controller && npx tsx scripts/stations-resolve.test.ts)
(cd controller && npx tsx scripts/stations-manager.test.ts)
```

Expected: all profile parsing, conversion, rollback, duplication, cap, rename, deletion, activation, and stale-IPC checks pass.

- [ ] **Step 4: Run fork security/provider regressions**

```bash
(cd controller && npx tsx scripts/settings-route-security.test.ts)
(cd controller && npx tsx scripts/cloud-tts-provider-key.test.ts)
(cd controller && npx tsx scripts/embedding-provider-config.test.ts)
(cd controller && npx tsx scripts/litellm-config.test.ts)
(cd controller && npx tsx scripts/litellm-routes.test.ts)
(cd controller && npx tsx scripts/request-strict.test.ts)
```

Expected: all checks pass with no stored credential in settings update responses and no cross-provider URL/key reuse.

- [ ] **Step 5: Typecheck the composed controller**

```bash
npm --prefix controller run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Stage and review Task 4 without committing**

```bash
git add controller/src/stations controller/src/routes/stations.ts \
  controller/src/server.ts controller/src/setup controller/src/config.ts \
  controller/src/settings.ts controller/src/routes/settings.ts \
  controller/src/routes/public.ts controller/src/music/embeddings.ts \
  controller/src/music/tag-library.ts controller/scripts/stations-*.test.ts
git diff --cached --check
```

Expected: a fresh reviewer approves station state isolation, restart behavior, and provider/privacy composition. Do not commit.

### Task 5: Adopt vocal/stem transitions while retaining the shared authenticated renderer

**Files:**
- Adopt/review: `controller/src/broadcast/drain-policy.ts`
- Adopt/review: `controller/src/broadcast/stem-blend.ts`
- Adopt/review: `controller/src/broadcast/queue.ts`
- Adopt/review: `controller/src/broadcast/liquidsoap-control.ts`
- Adopt/review: `controller/src/broadcast/scheduler.ts`
- Adopt/review: `controller/src/music/mix.ts`
- Adopt/review: `controller/src/music/library-db.ts`
- Adopt/review: `controller/src/music/library.ts`
- Adopt/review: `controller/src/music/subsonic.ts`
- Adopt/review: `liquidsoap/radio.liq`
- Resolve: `docker/aio/supervisor.sh`
- Resolve: `docker/broadcast-entrypoint.sh`
- Review: `docker/icecast-render.sh`
- Test: `controller/scripts/drain-policy.test.ts`
- Test: `controller/scripts/outro-mix.test.ts`
- Test: `controller/scripts/icecast-render.test.ts`
- Test: `controller/scripts/aio-icecast-render.test.ts`
- Test: `controller/scripts/listener-auth.test.ts`

**Interfaces:**
- Consumes: active station `config.stateDir`, upstream outro/vocal/stem metadata, and fork `icecast-render`.
- Produces: vocal-safe drain decisions, optional stem-blend seams with ordinary fallback, and identical authenticated split/AIO mount rendering after station restarts.

- [ ] **Step 1: Adopt upstream transition and queue behavior**

Keep upstream drain policy, pair-aware queue scheduling, stem cache lookup/render, transition metadata, and Liquidsoap blend playback. Verify the fallback remains:

```ts
// Missing/invalid stem inputs or render failure returns no blend artifact.
// Queue then emits the normal annotated track transition.
```

Expected: broadcast never waits indefinitely or stops because stems are unavailable.

- [ ] **Step 2: Resolve split/AIO conflicts around the shared renderer**

Both scripts must invoke:

```bash
/usr/local/bin/icecast-render
```

Retain upstream active-station path resolution and pair restart behavior around that call. Do not restore either upstream duplicated inline renderer body.

Expected: station switching relaunches the active pair and re-renders all mounts from current settings without split/AIO drift.

- [ ] **Step 3: Run upstream transition tests**

```bash
(cd controller && npx tsx scripts/drain-policy.test.ts)
(cd controller && npx tsx scripts/outro-mix.test.ts)
```

Expected: vocal-tail vetoes, pair drain scheduling, blend selection, and ordinary fallback pass.

- [ ] **Step 4: Run shared-renderer/auth tests**

```bash
bash -n docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh
(cd controller && npx tsx scripts/icecast-render.test.ts)
(cd controller && npx tsx scripts/aio-icecast-render.test.ts)
(cd controller && npx tsx scripts/listener-auth.test.ts)
```

Expected: private MP3/Opus/AAC/FLAC mounts contain listener auth, public mounts do not, and split/AIO share one renderer.

- [ ] **Step 5: Run controller typecheck**

```bash
npm --prefix controller run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Stage and review Task 5 without committing**

```bash
git add controller/src/broadcast controller/src/music/mix.ts \
  controller/src/music/library-db.ts controller/src/music/library.ts \
  controller/src/music/subsonic.ts liquidsoap/radio.liq \
  docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh \
  controller/scripts/drain-policy.test.ts controller/scripts/outro-mix.test.ts \
  controller/scripts/icecast-render.test.ts controller/scripts/aio-icecast-render.test.ts \
  controller/scripts/listener-auth.test.ts
git diff --cached --check
```

Expected: a fresh reviewer approves transition fallback, active-station paths, and authenticated renderer composition. Do not commit.

### Task 6: Adopt upstream web/admin architecture while retaining player/provider behavior

**Files:**
- Adopt/review: `web/app/admin/**`
- Adopt/review: `web/components/admin/**`
- Adopt/review: `web/components/ui/**`
- Adopt/review: `web/components/ThemeProvider.tsx`
- Delete: `web/components/ThemeBootstrap.tsx`
- Adopt/review: `web/lib/adminView.ts`
- Adopt/review: `web/hooks/useStationSwitch.ts`
- Modify/review: `web/components/player/PlayerShell.tsx`
- Modify/review: `web/components/player/StationGate.tsx`
- Review: `web/components/player/PlayerCore.tsx`
- Review: `web/hooks/usePlayer.ts`
- Review: `web/hooks/useStationFeed.ts`
- Modify/review: `web/components/admin/settings/LlmSection.tsx`
- Modify/review: `web/components/admin/settings/shared.tsx`
- Review: `web/package.json`
- Review: `web/package-lock.json`

**Interfaces:**
- Consumes: upstream station/admin APIs and fork authenticated four-format/player/provider state.
- Produces: upstream v0.47 admin/accessibility experience without regressions in listener auth, timing, format selection, or provider isolation.

- [ ] **Step 1: Adopt upstream station/admin/accessibility surfaces**

Keep upstream station switcher/panel, Navidrome settings, roster list/table toggles, theme provider, loading/error states, sidebar behavior, accessible labels/alerts, and skin transitions.

Expected: `/admin/stations` exists, multi-station switch polling reloads after controller restart, and new controls follow upstream ownership.

- [ ] **Step 2: Preserve the fork player and provider seams**

Verify the composed player still exposes:

```ts
type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac';
getListenerLagMs(): number | null;
```

Measured web lag must win while playing; the active-format advertised delay remains the native/non-playing fallback. Every stream assignment uses station-scoped auth, optional-format failure falls back to MP3, and detach/remount tears down private audio.

Keep provider-specific URL/key state and all six fork web contract scripts in `web/package.json`.

- [ ] **Step 3: Run web behavior contracts**

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

- [ ] **Step 4: Run web and app static gates**

```bash
npm --prefix web run lint
npm --prefix app run lint
npm --prefix app run typecheck
```

Expected: zero errors. Existing warning-only app output is acceptable.

- [ ] **Step 5: Build the production web application**

```bash
npm --prefix web run build
```

Expected: Next.js production compilation, type validation, and all page generation succeed. If Next rewrites `web/tsconfig.json` or `web/next-env.d.ts`, restore the intended upstream committed forms with a targeted patch and rerun `npm --prefix web run lint`.

- [ ] **Step 6: Stage and review Task 6 without committing**

```bash
git add web/app web/components web/hooks web/lib web/package.json \
  web/package-lock.json web/tsconfig.json web/eslint.config.mjs app
git diff --cached --check
```

Expected: a fresh reviewer approves upstream UI adoption and retained player/provider/auth behavior. Do not commit.

### Task 7: Finalize documentation, regenerate assets, render deployments, and audit all overlaps

**Files:**
- Review/finalize: `CLAUDE.md`
- Modify/review: `.env.example`
- Review: `.gitignore`
- Review: `README.md`
- Adopt/review: `docs/multi-station.md`
- Regenerate: `cli/src/assets.generated.ts`
- Regenerate: `web/lib/theme-tokens.generated.ts`
- Review: all 22 both-sides overlap paths
- Review: `.github/workflows/**`
- Review: `scripts/ci/**`
- Review: `deploy/portainer/**`

**Interfaces:**
- Consumes: fully resolved Tasks 3–6.
- Produces: deterministic generated files, valid deployment shapes, zero unmerged paths, and a complete semantic overlap audit.

- [ ] **Step 1: Finalize active documentation**

Resolve `CLAUDE.md` upstream-first. Document multi-station state, stem/vocal transitions, Navidrome settings, and upstream admin changes. Retain fork auth/player/provider/renderer/release invariants. Remove active URL-handoff guidance and the two dedicated obsolete handoff documents.

Expected: older v0.45/v0.46 integration records may mention their historical decision, but no active operator surface instructs users to set `ANALYZE_HANDOFF`.

- [ ] **Step 2: Regenerate CLI assets twice**

```bash
git rm -f cli/src/assets.generated.ts
npm --prefix cli run embed-assets
git add cli/src/assets.generated.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
```

Expected: the first run recreates the asset; the second leaves no diff and embeds v0.47.0-resolved sources without `ANALYZE_HANDOFF`.

- [ ] **Step 3: Regenerate theme tokens twice**

```bash
npm --prefix controller run gen:themes
git add web/lib/theme-tokens.generated.ts
npm --prefix controller run gen:themes
git diff --exit-code -- web/lib/theme-tokens.generated.ts
```

Expected: the second run leaves no diff.

- [ ] **Step 4: Render all required Compose shapes without starting containers**

Use `apply_patch` to create an ignored temporary `.env` containing:

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
SUBWAVE_VERSION=v0.47.0-obiwave.1 docker compose -f deploy/portainer/docker-compose.yml config --quiet
SUBWAVE_VERSION=v0.47.0 docker compose -f docker-compose.yml -f docker-compose.analyzer-gpu.yml config --quiet
```

Then delete `.env` with `apply_patch` even if a render fails.

Expected: every render exits 0, no container starts, the fork Portainer shape uses fork images, the GPU overlay uses the upstream CUDA image with an upstream-compatible tag, and `.env` is absent afterward.

- [ ] **Step 5: Audit exactly 22 both-sides paths**

```bash
while IFS= read -r path; do
  printf '\n===== %s: staged merge =====\n' "$path"
  git diff --cached -- "$path"
  printf '\n===== %s: upstream delta =====\n' "$path"
  git diff v0.46.0..v0.47.0 -- "$path"
  printf '\n===== %s: fork delta =====\n' "$path"
  git diff v0.46.0..dde3f45de28c7ae75c216981c7359c534c259d7c -- "$path"
done < <(
  comm -12 \
    <(git diff --name-only v0.46.0..dde3f45de28c7ae75c216981c7359c534c259d7c | sort) \
    <(git diff --name-only v0.46.0..v0.47.0 | sort)
)
```

Expected: exactly 22 staged/upstream/fork sections. Record one concrete composition sentence per path in `.superpowers/sdd/task-7-report.md`.

- [ ] **Step 6: Verify removals, conflicts, markers, and whitespace**

```bash
node --test scripts/ci/analyzer-handoff-absent.test.mjs
test -z "$(git diff --name-only --diff-filter=U)"
test -z "$(git ls-files -u)"
! rg -n '^(<<<<<<<|=======|>>>>>>>)' . --hidden -g '!node_modules' -g '!.git'
git diff --check
git diff --cached --check
test ! -e .env
```

Expected: every command exits 0.

- [ ] **Step 7: Stage the complete merge**

```bash
git add -A
git status --short
```

Expected: every source change is staged; there are no unmerged, unstaged, or untracked entries.

- [ ] **Step 8: Request the completed semantic-merge review**

Provide a fresh reviewer the approved design, this plan, Task 3–6 reports, Task 7's 22-path report, and the live staged diff.

Expected: reviewer confirms no provider/auth/player/analyzer/transition/station/release behavior was silently lost, generated assets match resolved sources, URL handoff is absent, and only intended upstream CUDA references exist. Do not commit.

### Task 8: Run full verification, create the merge commit, and request final review

**Files:**
- Verify: entire repository
- Commit: all staged merge changes

**Interfaces:**
- Consumes: the fully resolved and reviewed staged merge.
- Produces: one verified merge commit with exact v0.47.0 second-parent ancestry and a clean local handoff.

- [ ] **Step 1: Run full controller and Python suites**

```bash
npm --prefix controller test
python3 controller/scripts/vocal_gate_test.py
python3 controller/scripts/test_chatterbox_chunk.py
python3 controller/scripts/analyze-worker-audio.test.py
```

Expected: all discovered controller files and Python suites pass.

- [ ] **Step 2: Run repository and deployment contracts**

```bash
node --test scripts/**/*.test.mjs
node --test \
  scripts/ci/workflow-contract.test.mjs \
  scripts/ci/validate-portainer-compose.test.mjs \
  scripts/ci/assert-image-tag-absent.test.mjs \
  scripts/release/fork-tag.test.mjs \
  scripts/deploy/portainer-client.test.mjs
```

Expected: all contracts pass, including URL-handoff absence, native CI coverage, exact-tag release behavior, and CUDA publication exclusion.

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
(cd controller && npx tsx scripts/icecast-render.test.ts)
(cd controller && npx tsx scripts/aio-icecast-render.test.ts)
python3 -m py_compile controller/scripts/analyze_worker.py controller/scripts/chatterbox_worker.py docker/analyzer/server.py
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
  .env.example CLAUDE.md \
  controller/src/config.ts controller/src/settings.ts \
  controller/src/music/analyze.ts controller/src/broadcast/queue.ts \
  docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh \
  docker-compose.analyzer-gpu.yml \
  web/hooks/usePlayer.ts web/hooks/useStationFeed.ts \
  web/components/player/PlayerCore.tsx web/package.json \
  .github/workflows/ci.yml .github/workflows/publish-images.yml
```

Expected: no unstaged/unmerged file, no handoff residue in active surfaces, intentional fork/upstream composition, and no CUDA analyzer in fork publication.

- [ ] **Step 8: Create the merge commit**

```bash
git commit -m "merge: integrate subwave v0.47.0"
```

Expected: Git creates one merge commit.

- [ ] **Step 9: Verify exact ancestry and cleanliness**

```bash
test "$(git rev-parse HEAD^2)" = 6dea8f751b9e9b5d783c9de831d234aad1e5c2ed
git merge-base --is-ancestor dde3f45de28c7ae75c216981c7359c534c259d7c HEAD^1
git merge-base --is-ancestor v0.47.0 HEAD
git status --short
git log --oneline --decorate --graph -10
```

Expected: all ancestry checks exit 0, status is empty, and the graph shows exact `v0.47.0` as the second parent.

- [ ] **Step 10: Request final whole-branch review**

Provide a fresh read-only reviewer:

- fork base and actual first parent;
- exact upstream second parent;
- approved design and plan;
- Task 7's exact 22-path report;
- full Task 8 verification evidence;
- the complete `fork-base..HEAD` and both-parent diffs.

Expected: no Critical or Important finding. Fix any material finding with a regression, amend while preserving both parents, rerun the affected checks and full matrix, and request focused re-review.

- [ ] **Step 11: Record the local handoff**

Report final merge SHA and parents, test counts, warning-only lint totals, upstream features adopted, fork behavior retained, URL-handoff deletion, multi-station/stem behavior, upstream CUDA ownership, reviewer verdict, and clean worktree.

Do not push, deploy, publish, tag, release, create a pull request, or mutate Odin.
