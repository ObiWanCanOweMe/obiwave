# ObiWave v1.0.0 Semantic Rebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the durable behavior from `v0.48.0-obiwave.1` as ten dependency-ordered, independently reviewable commits on the exact upstream SUB/WAVE `v1.0.0` tree.

**Architecture:** Treat upstream `v1.0.0` as authoritative and port behavior rather than replaying the fork's 133 historical commits. The 239 retained fork paths are assigned exactly once in the adjacent TSV manifest; tests enter each bundle before implementation, and every bundle must pass its focused gate before the next bundle begins.

**Tech Stack:** TypeScript, Node.js 22, Next.js, Expo, Python 3, Docker Compose, GitHub Actions, Portainer, Caddy, Liquidsoap.

## Global Constraints

- Do not create the execution branch until this plan and its path manifest have been reviewed.
- Execution must start from exact upstream tag `v1.0.0`, commit `248ad298d636f532a5a743ab9e249ba0d77f2ff5`.
- Fork behavior must be sourced from exact tag `v0.48.0-obiwave.1`, commit `a1a5b3a37370524c3eb5e0b3a0ea6a72e2b1c498`.
- Upstream behavior wins wherever `v1.0.0` fully supplies the same behavior. Do not restore superseded v0.48 implementations, types, naming, or lifecycle assumptions.
- In particular, retain upstream v1's Unit replacement for Spool and its analyzer stem cache/budget, terminal LLM collapse, artist-guard rescue, catalog clamp, debug-log, and speech-correction behavior.
- Ark is the only production host. Its split stack uses the local `analyzer` service at `http://analyzer:8080`.
- Do not restore URL handoff configuration, code, tests, or documentation.
- Do not publish `subwave-analyzer-cuda` or `subwave-aio-cuda`.
- Upstream AIO CUDA-compatible runtime fixes may remain in shared AIO files, but they are not an ObiWave deployment or publication target.
- Preserve provider-owned credentials, exact-origin discovery, secret redaction, private-station authentication, and four-format playback.
- `controller/src/settings.ts` must import the upstream split settings modules and contain no more than 2,100 lines.
- The 53 historical `.superpowers/sdd/**` and `docs/superpowers/**` evidence paths remain available from the old tag and are not ported.
- `.github/workflows/lint.yml` remains absent because `.github/workflows/ci.yml` owns the consolidated gate.
- Port the native dependency lock with B07 so its test-script dependency stays atomic; regenerate `cli/src/assets.generated.ts` during finalization.

---

## Bundle graph and ownership

The machine-readable ownership manifest is
`docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv`.

| Order | Bundle | Paths | Depends on | Independently testable result |
|---:|---|---:|---|---|
| 1 | `B01-provider-core` | 33 | upstream v1 | Provider-owned settings, credentials, discovery, LiteLLM backend, and settings structure guard |
| 2 | `B02-analyzer-library` | 25 | B01 | Ark-local analysis, embeddings, and library database behavior |
| 3 | `B03-controller-runtime` | 36 | B01, B02 | Strict requests, autonomous DJ, station lifecycle, queue, voice, and doctor behavior |
| 4 | `B04-provider-web` | 22 | B01 | Admin/onboarding provider controls using backend ownership and secrecy rules |
| 5 | `B05-web-player-auth` | 17 | B03 | Authenticated private-station playback in all retained formats |
| 6 | `B06-web-admin-ui` | 45 | B03, B04, B05 | Remaining admin, library, shows, schedule, debug, and navigation UI |
| 7 | `B07-native-app` | 26 | B03 | Native secure station storage and active-format playback |
| 8 | `B08-container-audio` | 10 | B03, B05 | Caddy, broadcast, Icecast, Liquidsoap, and shared AIO runtime composition |
| 9 | `B09-ark-release` | 20 | B01-B08 | Immutable Ark build, scan, Portainer deployment, and rollback contract |
| 10 | `B10-docs-guardrails` | 5 | B01-B09 | User/operator documentation and structural guardrails reflecting the final tree |

The `merge_mode` column is an implementation instruction:

- `clean-port`: use the fork tag as the behavioral reference, but rewrite against v1 interfaces.
- `auto-compose`: inspect all three versions before editing; retain both non-overlapping behaviors and prefer upstream on overlap.
- `manual-compose`: resolve the policy boundary explicitly according to this plan.

## Pre-execution gate

- [ ] **Step 1: Verify the exact objects**

Run:

```bash
test "$(git rev-parse 'v1.0.0^{commit}')" = 248ad298d636f532a5a743ab9e249ba0d77f2ff5
test "$(git rev-parse 'v0.48.0-obiwave.1^{commit}')" = a1a5b3a37370524c3eb5e0b3a0ea6a72e2b1c498
```

Expected: both commands exit 0.

- [ ] **Step 2: Verify manifest coverage and uniqueness**

Run:

```bash
node - <<'NODE'
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const manifest = 'docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv';
const rows = readFileSync(manifest, 'utf8').trimEnd().split('\n').slice(1);
const paths = rows.map((row) => row.split('\t')[2]);
const changed = execFileSync(
  'git',
  ['diff', '--name-only', 'v0.48.0', 'v0.48.0-obiwave.1'],
  { encoding: 'utf8' },
).trim().split('\n');
const excluded = changed.filter((path) =>
  path.startsWith('.superpowers/sdd/') ||
  path.startsWith('docs/superpowers/') ||
  path === '.github/workflows/lint.yml' ||
  path === 'cli/src/assets.generated.ts'
);
const retained = changed.filter((path) => !excluded.includes(path));

if (changed.length !== 294) throw new Error(`fork delta: ${changed.length}, expected 294`);
if (excluded.length !== 55) throw new Error(`excluded: ${excluded.length}, expected 55`);
if (paths.length !== 239) throw new Error(`manifest: ${paths.length}, expected 239`);
if (new Set(paths).size !== paths.length) throw new Error('duplicate manifest path');
if (retained.some((path) => !paths.includes(path))) throw new Error('retained path missing');
if (paths.some((path) => !retained.includes(path))) throw new Error('unexpected manifest path');
console.log('294 delta = 239 retained + 55 excluded; ownership is exact');
NODE
```

Expected: `294 delta = 239 retained + 55 excluded; ownership is exact`.

- [ ] **Step 3: Create isolation only after approval**

At execution time, use `superpowers:using-git-worktrees`, create a worktree whose branch starts at `v1.0.0`, and confirm:

```bash
test "$(git rev-parse HEAD)" = 248ad298d636f532a5a743ab9e249ba0d77f2ff5
git status --short
```

Expected: the commit matches and status is empty.

Copy this plan and its TSV manifest from the planning worktree into the new worktree before Task 1. They are execution-control documents, are added with B10 after their instructions have been exercised, and are not part of the 239-path count.

## Task 1: B01 — Provider and settings core

**Files:** Every manifest row whose bundle is `B01-provider-core`. Rename the retained source path `scripts/ci/upstream-v048-structure.test.mjs` to `scripts/ci/upstream-v100-structure.test.mjs`.

**Interfaces:**

- Consumes: upstream v1 settings module boundaries and LLM SDK/provider contracts.
- Produces: normalized provider-owned URL/key settings, exact-origin model discovery, embedding credential isolation, cloud TTS key ownership, secret-safe settings responses, and LiteLLM routing/cache behavior.

- [ ] **Step 1: Port the B01 contract tests before implementation**

Bring over the B01 `controller/scripts/*.test.ts` paths first. Rename and port the structural guard at the same time. Adjust imports only where upstream v1 moved a module; do not weaken assertions. The renamed guard must read the v1 entry modules, verify their actual split-module imports, and enforce:

```js
assert.ok(
  settings.split('\n').length <= 2100,
  'settings entry must not exceed 2,100 lines',
);
```

- [ ] **Step 2: Confirm the tests fail against unported v1 behavior**

Run:

```bash
for filter in \
  cloud-tts-provider-key \
  embedding-provider-config \
  litellm-cache \
  litellm-config \
  litellm-routes \
  model-discovery-ownership \
  settings-route-security
do
  npm --prefix controller test -- "$filter"
done
node scripts/ci/upstream-v100-structure.test.mjs
```

Expected: at least one focused contract fails because the fork behavior is not yet present.

- [ ] **Step 3: Port the remaining B01 paths**

Use `git show v0.48.0-obiwave.1:<path>` as a behavioral reference and implement against upstream v1 modules. For `.env.example`, document provider-specific variables without reintroducing global credential fallbacks or URL handoff.

- [ ] **Step 4: Run the B01 acceptance gate**

Run:

```bash
for filter in \
  cloud-tts-provider-key \
  embedding-provider-config \
  litellm-cache \
  litellm-config \
  litellm-routes \
  model-discovery-ownership \
  settings-route-security
do
  npm --prefix controller test -- "$filter"
done
npm --prefix controller run typecheck
node scripts/ci/upstream-v100-structure.test.mjs
```

Expected: all tests pass; the settings entry imports split modules and remains at or below the line cap.

- [ ] **Step 5: Commit B01**

```bash
awk -F '\t' '$1=="B01-provider-core" {
  if ($3=="scripts/ci/upstream-v048-structure.test.mjs")
    print "scripts/ci/upstream-v100-structure.test.mjs";
  else
    print $3
}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port provider-owned settings to upstream v1"
```

## Task 2: B02 — Ark-local analyzer and library

**Files:** Every manifest row whose bundle is `B02-analyzer-library`.

**Interfaces:**

- Consumes: B01 embedding provider configuration and upstream v1 analyzer cache/budget semantics.
- Produces: local analyzer execution, quiet and rate-aware embedding work, and library database modules compatible with upstream v1.

- [ ] **Step 1: Port B02 tests first**

Port `analyze-quiet.test.ts`, `analyze-worker-audio.test.py`, and `embedding-bulk.test.ts`. Preserve upstream v1 stem-cache and analysis-budget assertions from the target tree.

- [ ] **Step 2: Confirm a behavioral failure**

Run:

```bash
npm --prefix controller test -- analyze-quiet
npm --prefix controller test -- embedding-bulk
python3 controller/scripts/analyze-worker-audio.test.py
```

Expected: at least one fork-specific contract fails before implementation.

- [ ] **Step 3: Port analyzer and library implementation**

Keep `ANALYZE_URL` local-service behavior and upstream v1 cache/budget logic. Do not restore Odin, analyzer handoff, or fork CUDA-image assumptions. On the four `auto-compose` paths, retain upstream schema and catalog changes before applying fork behavior.

- [ ] **Step 4: Run the B02 acceptance gate**

```bash
npm --prefix controller test -- analyze
npm --prefix controller test -- embedding
npm --prefix controller test -- audio-moods
python3 controller/scripts/analyze-worker-audio.test.py
npm --prefix controller run typecheck
```

Expected: all analyzer, embedding, and audio-mood contracts pass.

- [ ] **Step 5: Commit B02**

```bash
awk -F '\t' '$1=="B02-analyzer-library" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port Ark-local analyzer and library behavior"
```

## Task 3: B03 — Controller runtime and broadcast policy

**Files:** Every manifest row whose bundle is `B03-controller-runtime`.

**Interfaces:**

- Consumes: B01 provider behavior, B02 analysis/library behavior, and upstream v1 Unit lifecycle.
- Produces: strict requests, autonomous enablement checks, station switching, queue/voice safety, stream buffering, playlist jobs, onboarding/public routes, and doctor output.

- [ ] **Step 1: Port the ten focused B03 tests first**

Port all B03 `controller/scripts/*.test.ts` files. When adapting fixtures, use upstream v1 Unit terminology and runtime types; do not recreate Spool compatibility.

- [ ] **Step 2: Confirm a behavioral failure**

```bash
for filter in \
  llm-pure \
  playlist-jobs \
  programme \
  request-strict \
  stations-switch-guard \
  stream-buffer \
  voice-policy
do
  npm --prefix controller test -- "$filter"
done
```

Expected: at least one fork-specific test fails before implementation.

- [ ] **Step 3: Port B03 implementation**

Apply fork policy at upstream v1 extension points. Preserve v1 terminal-call collapsing, artist rescue, and Unit semantics in `llm-pure`, DJ enqueue, programme, queue, and lifecycle paths.

- [ ] **Step 4: Run the B03 acceptance gate**

```bash
for filter in \
  llm-pure \
  playlist-jobs \
  programme \
  request-strict \
  stations-switch-guard \
  stream-buffer \
  voice-policy
do
  npm --prefix controller test -- "$filter"
done
npm --prefix controller test
npm --prefix controller run lint
```

Expected: the focused contracts and the complete controller suite pass.

- [ ] **Step 5: Commit B03**

```bash
awk -F '\t' '$1=="B03-controller-runtime" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port strict controller and broadcast behavior"
```

## Task 4: B04 — Provider web surfaces

**Files:** Every manifest row whose bundle is `B04-provider-web`.

**Interfaces:**

- Consumes: B01 settings routes and response shapes.
- Produces: provider-owned onboarding/settings state, safe key probes, and exact-origin model and voice discovery requests.

- [ ] **Step 1: Port the six web contract tests first**

Port every B04 `web/scripts/*.test.ts` file and restore its corresponding `package.json` script in B06 only if the target script is not already callable directly.

- [ ] **Step 2: Confirm a behavioral failure**

```bash
for test_file in \
  async-result-generation \
  llm-provider-meta \
  llm-section-provider-url-contract \
  managed-key-probe \
  model-discovery-request \
  onboarding-provider-state
do
  node --experimental-strip-types "web/scripts/${test_file}.test.ts"
done
```

Expected: at least one fork-specific contract fails before implementation.

- [ ] **Step 3: Port B04 implementation**

Use B01 routes without placing provider secrets in query strings, browser persistence, logs, or returned settings objects. Model and voice discovery must use the configured provider's exact origin.

- [ ] **Step 4: Run the B04 acceptance gate**

```bash
for test_file in \
  async-result-generation \
  llm-provider-meta \
  llm-section-provider-url-contract \
  managed-key-probe \
  model-discovery-request \
  onboarding-provider-state
do
  node --experimental-strip-types "web/scripts/${test_file}.test.ts"
done
npm --prefix web run typecheck
```

Expected: every provider UI contract and web typecheck passes.

- [ ] **Step 5: Commit B04**

```bash
awk -F '\t' '$1=="B04-provider-web" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port provider-owned web configuration"
```

## Task 5: B05 — Authenticated web player

**Files:** Every manifest row whose bundle is `B05-web-player-auth`.

**Interfaces:**

- Consumes: B03 station/public endpoints and upstream v1 player lifecycle.
- Produces: station-scoped authentication, origin normalization, audio binding, and MP3/AAC/Opus/FLAC selection.

- [ ] **Step 1: Port the two B05 contract tests first**

Port `audio-format.test.ts` and `stream-auth-format.test.ts` without reducing their format or credential-boundary matrices.

- [ ] **Step 2: Confirm a behavioral failure**

```bash
node --experimental-strip-types web/scripts/audio-format.test.ts
node --experimental-strip-types web/scripts/stream-auth-format.test.ts
```

Expected: at least one fork-specific contract fails before implementation.

- [ ] **Step 3: Port B05 implementation**

Build on upstream v1 player state and cleanup behavior. Keep the fork only where it adds authenticated station access or a format upstream does not already handle.

- [ ] **Step 4: Run the B05 acceptance gate**

```bash
node --experimental-strip-types web/scripts/audio-format.test.ts
node --experimental-strip-types web/scripts/stream-auth-format.test.ts
npm --prefix web run typecheck
```

Expected: both format/auth contracts and typecheck pass.

- [ ] **Step 5: Commit B05**

```bash
awk -F '\t' '$1=="B05-web-player-auth" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port authenticated multi-format web playback"
```

## Task 6: B06 — Web administration and UI

**Files:** Every manifest row whose bundle is `B06-web-admin-ui`.

**Interfaces:**

- Consumes: B03 controller routes, B04 provider UI primitives, and B05 player behavior.
- Produces: admin navigation, settings shell, shows, schedule, dashboard, debug, library, and playlist-builder experiences.

- [ ] **Step 1: Port the admin navigation contract first**

Port `admin-navigation-schedule-contract.test.ts`, then run it before implementation.

```bash
node --experimental-strip-types web/scripts/admin-navigation-schedule-contract.test.ts
```

Expected: it fails on missing fork navigation/schedule behavior.

- [ ] **Step 2: Port B06 implementation**

Preserve upstream v1 component behavior when composing `globals.css`, `SettingsPanel.tsx`, and `package.json`. Restore only the fork's retained navigation, guard, schedule, library, debug, and provider presentation behavior.

- [ ] **Step 3: Run the B06 acceptance gate**

```bash
node --experimental-strip-types web/scripts/admin-navigation-schedule-contract.test.ts
npm --prefix web run lint
npm --prefix web run build
```

Expected: navigation contract, lint/typecheck, and production build pass.

- [ ] **Step 4: Commit B06**

```bash
awk -F '\t' '$1=="B06-web-admin-ui" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port ObiWave web administration"
```

## Task 7: B07 — Native app

**Files:** Every manifest row whose bundle is `B07-native-app`.

**Interfaces:**

- Consumes: B03 station/public endpoints and their authentication contract.
- Produces: secure station credential persistence and authenticated active-format playback in Expo.

- [ ] **Step 1: Port native tests first**

Port `station-credentials.test.mjs` and `stream-buffer-format.test.mjs`, including their script entries and locked dependencies in `app/package.json` and `app/package-lock.json`.

- [ ] **Step 2: Confirm a behavioral failure**

```bash
npm --prefix app run test:station-credentials
npm --prefix app run test:stream-buffer-format
```

Expected: at least one contract fails before implementation.

- [ ] **Step 3: Port B07 implementation**

Use secure storage for station credentials, keep credentials scoped to the selected station, and derive buffering/mount behavior from the active stream format.

- [ ] **Step 4: Run the B07 acceptance gate**

```bash
npm --prefix app run test:station-credentials
npm --prefix app run test:stream-buffer-format
npm --prefix app run lint
npm --prefix app run typecheck
```

Expected: native contracts, lint, and typecheck pass.

- [ ] **Step 5: Commit B07**

```bash
awk -F '\t' '$1=="B07-native-app" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "feat: port secure native station playback"
```

## Task 8: B08 — Container and audio runtime

**Files:** Every manifest row whose bundle is `B08-container-audio`.

**Interfaces:**

- Consumes: B03 controller/broadcast behavior and B05 authenticated stream endpoints.
- Produces: rendered Icecast configuration, broadcast entrypoint, Caddy routing, and compatible shared AIO startup.

- [ ] **Step 1: Port and run the renderer tests before runtime edits**

```bash
npm --prefix controller test -- aio-icecast-render
npm --prefix controller test -- icecast-render
```

Expected: at least one fails against the unported container runtime, establishing the renderer contract before implementation.

- [ ] **Step 2: Port B08 runtime files**

Compose upstream v1 AIO supervisor/Dockerfile changes with the fork renderer and authentication contract. Do not add an Ark AIO service and do not add CUDA publication.

- [ ] **Step 3: Run the B08 acceptance gate**

```bash
npm --prefix controller test -- aio-icecast-render
npm --prefix controller test -- icecast-render
docker build --file docker/Dockerfile.broadcast --tag obiwave-rebase-broadcast:test .
docker build --file docker/Dockerfile.aio --tag obiwave-rebase-aio:test .
```

Expected: renderer tests pass and both shared runtime images build locally.

- [ ] **Step 4: Commit B08**

```bash
awk -F '\t' '$1=="B08-container-audio" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "build: port container and audio runtime contracts"
```

## Task 9: B09 — Ark release and deployment

**Files:** Every manifest row whose bundle is `B09-ark-release`.

**Interfaces:**

- Consumes: buildable artifacts from B01-B08.
- Produces: consolidated CI, immutable fork tags, authenticated scans, Ark split-stack deployment, and rollback.

- [ ] **Step 1: Port deployment contract tests first**

Port every B09 `*.test.mjs` file and the handoff-absence guard. Use B01's renamed v1 structural guard as an already-passing prerequisite.

- [ ] **Step 2: Confirm policy failures before workflow implementation**

```bash
node --test \
  scripts/release/fork-tag.test.mjs \
  scripts/ci/validate-portainer-compose.test.mjs \
  scripts/ci/assert-image-tag-absent.test.mjs \
  scripts/ci/workflow-contract.test.mjs \
  scripts/deploy/portainer-client.test.mjs
node scripts/ci/analyzer-handoff-absent.test.mjs
node scripts/ci/upstream-v100-structure.test.mjs
```

Expected: at least one workflow or deployment assertion fails before implementation.

- [ ] **Step 3: Port release and Ark implementation**

Manually compose `.github/workflows/publish-images.yml`. Keep immutable preflight, reusable CI, authenticated scanning, deploy/rollback ordering, and Ark's local analyzer; accept upstream-compatible action/runtime improvements; exclude `subwave-analyzer-cuda` and `subwave-aio-cuda`.

- [ ] **Step 4: Run the B09 acceptance gate**

```bash
node --test \
  scripts/release/fork-tag.test.mjs \
  scripts/ci/validate-portainer-compose.test.mjs \
  scripts/ci/assert-image-tag-absent.test.mjs \
  scripts/ci/workflow-contract.test.mjs \
  scripts/deploy/portainer-client.test.mjs
node scripts/ci/analyzer-handoff-absent.test.mjs
node scripts/ci/upstream-v100-structure.test.mjs
test -z "$(rg -l 'subwave-(analyzer|aio)-cuda|ANALYZE_HANDOFF|ODIN' \
  .github deploy docker-compose*.yml docs .env.example || true)"
```

Then validate Ark rendering:

```bash
trap 'rm -f deploy/portainer/stack.env' EXIT
: > deploy/portainer/stack.env
SUBWAVE_VERSION=v1.0.0-obiwave.1 \
ADMIN_USER=ci \
ADMIN_PASS=ci \
SITE_URL=https://radio.kener.org \
node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
SUBWAVE_VERSION=v1.0.0-obiwave.1 \
ADMIN_USER=ci \
ADMIN_PASS=ci \
SITE_URL=https://radio.kener.org \
docker compose -f deploy/portainer/docker-compose.yml config --quiet
```

Expected: all tests and rendering pass; forbidden deployment/publication strings are absent.

- [ ] **Step 5: Commit B09**

```bash
awk -F '\t' '$1=="B09-ark-release" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git commit -m "ci: port immutable Ark release pipeline"
```

## Task 10: B10 — Documentation and guardrails

**Files:** Every manifest row whose bundle is `B10-docs-guardrails`, plus this plan and its TSV ownership manifest as current execution records.

**Interfaces:**

- Consumes: the completed B01-B09 behavior.
- Produces: accurate user, contributor, controller, and private-station guidance.

- [ ] **Step 1: Manually compose documentation**

Update root and controller guidance to describe upstream v1 concepts and the retained fork boundaries. In `controller/CLAUDE.md`, combine upstream analyzer/stem/Unit guidance with provider ownership, secrecy, embedding, and strict-request rules. Remove every Odin, URL-handoff, and fork CUDA-publication claim.

- [ ] **Step 2: Run the B10 acceptance gate**

```bash
test -z "$(rg -l 'ANALYZE_HANDOFF|Odin|ODIN|subwave-(analyzer|aio)-cuda' \
  README.md CLAUDE.md controller/CLAUDE.md docs/private-station.md .env.example || true)"
rg -n 'http://analyzer:8080|local analyzer' README.md CLAUDE.md controller/CLAUDE.md docs/private-station.md .env.example
node scripts/ci/upstream-v100-structure.test.mjs
```

Expected: forbidden legacy concepts are absent, local analyzer guidance is present, and structural guardrails pass.

- [ ] **Step 3: Commit B10**

```bash
awk -F '\t' '$1=="B10-docs-guardrails" {print $3}' docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv |
  git add --pathspec-from-file=-
git add \
  docs/superpowers/plans/2026-07-27-v1-semantic-rebase.md \
  docs/superpowers/plans/2026-07-27-v1-semantic-rebase-paths.tsv
git commit -m "docs: align ObiWave guidance with upstream v1"
```

## Finalization: excluded and generated paths

- [ ] **Step 1: Regenerate embedded CLI assets**

```bash
npm --prefix cli ci --no-audit --no-fund
npm --prefix cli run embed-assets
git add cli/src/assets.generated.ts
git commit -m "build: regenerate CLI assets for upstream v1"
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
```

Expected: the second generation produces no diff.

- [ ] **Step 2: Verify excluded history and obsolete lint workflow stay absent**

```bash
test ! -e .github/workflows/lint.yml
test -z "$(git diff --name-only v1.0.0...HEAD -- .superpowers/sdd docs/superpowers | rg -v '^docs/superpowers/plans/2026-07-27-v1-semantic-rebase' || true)"
```

Expected: the obsolete workflow is absent and no archived evidence was replayed.

## Final acceptance gate

- [ ] **Step 1: Install exact package dependencies**

```bash
for package in controller web mcp-subwave cli app; do
  npm --prefix "$package" ci --no-audit --no-fund
done
```

Expected: every package installs from its lockfile.

- [ ] **Step 2: Run all code-quality and behavior suites**

```bash
npm --prefix controller run lint
npm --prefix controller test
npm --prefix web run lint
for script in \
  test:audio-format \
  test:stream-auth-format \
  test:llm-provider \
  test:onboarding-provider-state \
  test:async-generation \
  test:managed-key-probe \
  test:model-discovery-request \
  test:admin-navigation-schedule \
  test:llm-section-provider-url-contract
do
  npm --prefix web run "$script"
done
npm --prefix web run build
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run test:station-credentials
npm --prefix app run test:stream-buffer-format
npm --prefix app run lint
npm --prefix app run typecheck
python3 controller/scripts/analyze-worker-audio.test.py
```

Expected: all commands exit 0.

- [ ] **Step 3: Run deployment and structural suites**

```bash
node --test \
  scripts/release/fork-tag.test.mjs \
  scripts/ci/validate-portainer-compose.test.mjs \
  scripts/ci/assert-image-tag-absent.test.mjs \
  scripts/ci/workflow-contract.test.mjs \
  scripts/deploy/portainer-client.test.mjs
node scripts/ci/analyzer-handoff-absent.test.mjs
node scripts/ci/upstream-v100-structure.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 4: Prove ancestry and commit shape**

```bash
git merge-base --is-ancestor v1.0.0 HEAD
git log --first-parent --reverse --format='%h %s' v1.0.0..HEAD
git status --short
```

Expected: upstream v1 is an ancestor, the history shows the ten ordered behavior bundles followed only by generated-artifact commits, and the worktree is clean.

- [ ] **Step 5: Compare the final semantic delta**

```bash
git diff --stat v1.0.0...HEAD
git diff --check v1.0.0...HEAD
```

Expected: the diff contains only retained behavior, current documentation, and regenerated artifacts; `git diff --check` exits 0.

## Self-review record

- Spec coverage: all 239 retained paths are assigned exactly once; 53 archive paths, one drop path, and one regenerated path have explicit finalization rules.
- Dependency consistency: backend/provider contracts precede analyzer and runtime; client surfaces precede containers and release automation; documentation is last.
- Manual conflicts: `.github/workflows/publish-images.yml` is resolved in B09 and `controller/CLAUDE.md` in B10.
- Upstream authority: every overlapping path requires three-version inspection, and the global constraints enumerate the v1 behavior that must not regress.
- Runtime policy: Ark local analyzer is required; Odin, URL handoff, and CUDA image publication are forbidden.
- Placeholder scan: no deferred implementation or unspecified acceptance step remains.
