# Portainer Release CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate every pull request and push, publish immutable fork-owned images only for fork-qualified release tags, and update the ark Portainer stack with verified automatic rollback.

**Architecture:** GitHub Actions runs repository checks and amd64 image smoke builds. A release-tag workflow publishes the complete image matrix to `ghcr.io/obiwancanoweme`, then a dependency-free Node client snapshots and updates the Portainer Web Editor stack, verifies the public path through bender, and restores the snapshot on failure.

**Tech Stack:** GitHub Actions, Node.js 22 built-in test runner and Fetch API, Docker Buildx, Docker Compose, GHCR, Portainer CE HTTP API.

## Global Constraints

- Canonical repository: `ObiWanCanOweMe/obiwave`.
- Production tags must match `^v[0-9]+\.[0-9]+\.[0-9]+-obiwave\.[1-9][0-9]*$`.
- Initial downstream release tag: `v0.42.0-obiwave.1`.
- Production images use `ghcr.io/obiwancanoweme` and the exact release tag; production never uses `latest`.
- Production state binds from `/mnt/NVMe/container-data/subwave/state`.
- Published ports bind only to `10.20.0.9` and `[2600:1700:3210:5314:10:20:0:9]`, never wildcard addresses.
- Portainer manages the stack as a Web Editor/file-based stack, not a Git-backed stack.
- Public verification uses `https://radio.kener.org/api/health` and `https://radio.kener.org/stream.mp3` through bender.
- Plain tags such as `v0.42.0` cannot publish fork images or deploy production.
- Preserve the existing untracked `controller/scripts/__pycache__/` directory.

---

## File Map

- `scripts/release/fork-tag.mjs`: fork tag parser and constructor.
- `scripts/release/fork-tag.test.mjs`: tag policy tests.
- `deploy/portainer/docker-compose.yml`: image-only BYO-proxy Portainer stack.
- `scripts/ci/validate-portainer-compose.mjs`: deployment manifest policy validator.
- `scripts/ci/validate-portainer-compose.test.mjs`: validator unit tests.
- `scripts/deploy/portainer-client.mjs`: API, snapshot, update, probes, and rollback.
- `scripts/deploy/portainer-client.test.mjs`: fake-fetch deployment tests.
- `scripts/deploy/portainer-release.mjs`: GitHub Actions entry point.
- `.github/workflows/ci.yml`: every-push/every-PR checks.
- `.github/workflows/lint.yml`: removed after consolidation.
- `.github/workflows/publish-images.yml`: strict release publication and deployment.
- `.github/workflows/publish-cli.yml`: strict fork tag trigger.
- `.github/workflows/scan-images.yml`: scan fork images by exact qualified tag.
- `.github/workflows/cut-fork-release.yml`: validated manual fork release creation.
- `docs/deployment.md` and `README.md`: operator documentation.

### Task 1: Encode the Fork Release Tag Contract

**Files:**
- Create: `scripts/release/fork-tag.mjs`
- Create: `scripts/release/fork-tag.test.mjs`

**Interfaces:**
- Produces: `parseForkTag(value: string): { tag: string, version: string, revision: number }`.
- Produces: `makeForkTag(version: string, revision: string | number): string`.

- [ ] **Step 1: Write failing tag-policy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeForkTag, parseForkTag } from './fork-tag.mjs';

test('parses the initial fork release', () => {
  assert.deepEqual(parseForkTag('v0.42.0-obiwave.1'), {
    tag: 'v0.42.0-obiwave.1', version: '0.42.0', revision: 1,
  });
});

test('constructs a fork release', () => {
  assert.equal(makeForkTag('0.42.0', 2), 'v0.42.0-obiwave.2');
});

for (const value of ['v0.42.0', '0.42.0-obiwave.1', 'v0.42-obiwave.1',
  'v0.42.0-obiwave.0', 'v0.42.0-obiwave.01', 'v00.42.0-obiwave.1']) {
  test(`rejects ${value}`, () => {
    assert.throws(() => parseForkTag(value), /fork-qualified release tag/);
  });
}
```

- [ ] **Step 2: Confirm the missing module fails**

Run: `node --test scripts/release/fork-tag.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the module**

```js
const VERSION = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';
const TAG_RE = new RegExp(`^v(${VERSION})-obiwave\\.([1-9][0-9]*)$`);
const VERSION_RE = new RegExp(`^${VERSION}$`);

export function parseForkTag(value) {
  const match = TAG_RE.exec(value);
  if (!match) throw new Error(`Expected a fork-qualified release tag, received: ${value}`);
  return { tag: value, version: match[1], revision: Number(match[5]) };
}

export function makeForkTag(version, revision) {
  const normalized = String(revision);
  if (!VERSION_RE.test(version) || !/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error(`Cannot construct fork-qualified release tag from ${version} revision ${revision}`);
  }
  return `v${version}-obiwave.${normalized}`;
}
```

- [ ] **Step 4: Run tests and commit**

```bash
node --test scripts/release/fork-tag.test.mjs
git add scripts/release/fork-tag.mjs scripts/release/fork-tag.test.mjs
git commit -m "ci: define fork release tag policy"
```

Expected: eight tests pass before the commit.

### Task 2: Add the Image-Only Portainer Manifest

**Files:**
- Create: `deploy/portainer/docker-compose.yml`
- Create: `scripts/ci/validate-portainer-compose.mjs`
- Create: `scripts/ci/validate-portainer-compose.test.mjs`

**Interfaces:**
- Produces services: `broadcast`, `controller`, `docker-socket-proxy`, `web`, `tts-heavy`, and `analyzer`.
- Produces: `validatePortainerCompose(source: string): string[]`.

- [ ] **Step 1: Write validator tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePortainerCompose } from './validate-portainer-compose.mjs';

const valid = `
x-state: &state /mnt/NVMe/container-data/subwave/state:/var/sub-wave
services:
  broadcast:
    image: ghcr.io/obiwancanoweme/subwave-broadcast:\${SUBWAVE_VERSION:?required}
    ports:
      - "10.20.0.9:\${ICECAST_PORT:-7702}:7702"
      - "[2600:1700:3210:5314:10:20:0:9]:\${ICECAST_PORT:-7702}:7702"
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:\${SUBWAVE_VERSION:?required}
    ports:
      - "10.20.0.9:\${CONTROLLER_PORT:-7701}:7701"
      - "[2600:1700:3210:5314:10:20:0:9]:\${CONTROLLER_PORT:-7701}:7701"
  web:
    image: ghcr.io/obiwancanoweme/subwave-web:\${SUBWAVE_VERSION:?required}
    ports:
      - "10.20.0.9:\${WEB_PORT:-7700}:7700"
      - "[2600:1700:3210:5314:10:20:0:9]:\${WEB_PORT:-7700}:7700"
  analyzer:
    image: ghcr.io/obiwancanoweme/subwave-analyzer:\${SUBWAVE_VERSION:?required}
`;

test('accepts the production contract', () => {
  assert.deepEqual(validatePortainerCompose(valid), []);
});

test('rejects mutable or checkout-coupled deployment', () => {
  const invalid = `${valid}\nbuild: .\nimage: example:latest\n` +
    `ghcr.io/perminder-klair/subwave-web\n./state:/var/sub-wave\n` +
    `env_file: ./.env\n0.0.0.0:7700:7700\n[::]:7700:7700\n`;
  assert.deepEqual(validatePortainerCompose(invalid), [
    'manifest contains a build directive', 'manifest references latest',
    'manifest references the upstream image namespace',
    'manifest contains a repository-relative state mount',
    'manifest depends on a repository .env file',
    'manifest binds a published port to a wildcard address',
  ]);
});
```

- [ ] **Step 2: Confirm the missing validator fails**

Run: `node --test scripts/ci/validate-portainer-compose.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the validator**

```js
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const rules = [
  [/^\s*build\s*:/m, 'manifest contains a build directive'],
  [/(?:^|:)latest(?:$|\s)/m, 'manifest references latest'],
  [/ghcr\.io\/perminder-klair\//, 'manifest references the upstream image namespace'],
  [/(?:\$\{STATE_DIR[^}]*\}|\.\/state):\/var\/sub-wave/, 'manifest contains a repository-relative state mount'],
  [/env_file:\s*(?:\n\s*-\s*)?\.\/\.env/, 'manifest depends on a repository .env file'],
  [/(?:0\.0\.0\.0|\[::\]):(?:\$\{[^}]+\}|[0-9]+):[0-9]+/, 'manifest binds a published port to a wildcard address'],
];

const required = [
  '/mnt/NVMe/container-data/subwave/state:/var/sub-wave',
  '10.20.0.9:${WEB_PORT:-7700}:7700',
  '[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:7700',
  '10.20.0.9:${CONTROLLER_PORT:-7701}:7701',
  '[2600:1700:3210:5314:10:20:0:9]:${CONTROLLER_PORT:-7701}:7701',
  '10.20.0.9:${ICECAST_PORT:-7702}:7702',
  '[2600:1700:3210:5314:10:20:0:9]:${ICECAST_PORT:-7702}:7702',
  'ghcr.io/obiwancanoweme/subwave-broadcast:${SUBWAVE_VERSION:?required}',
  'ghcr.io/obiwancanoweme/subwave-controller:${SUBWAVE_VERSION:?required}',
  'ghcr.io/obiwancanoweme/subwave-web:${SUBWAVE_VERSION:?required}',
];

export function validatePortainerCompose(source) {
  const errors = rules.filter(([pattern]) => pattern.test(source)).map(([, message]) => message);
  for (const value of required) if (!source.includes(value)) errors.push(`manifest is missing ${value}`);
  return errors;
}

async function main() {
  const file = process.argv[2] ?? 'deploy/portainer/docker-compose.yml';
  const errors = validatePortainerCompose(await readFile(file, 'utf8'));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`validated ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 4: Create the production manifest from `docker-compose.byo.yml`**

Copy the BYO file, then apply these exact changes:

- state anchor: `/mnt/NVMe/container-data/subwave/state:/var/sub-wave`;
- broadcast logs: `/mnt/NVMe/container-data/subwave/state/logs:/var/log/liquidsoap`;
- remove all `build:` blocks and replace `controller.env_file: ./.env` with `controller.env_file: stack.env`, which Portainer generates from the stack's Environment variables;
- change first-party image prefixes to `ghcr.io/obiwancanoweme/`;
- require `:${SUBWAVE_VERSION:?required}` for every first-party image;
- publish web/controller/broadcast twice using the six required IPv4/IPv6 strings in the validator;
- retain health checks, dependencies, profiles, memory limits, named caches, socket proxy, and log rotation;
- state in the header that bender owns TLS and Portainer must use Web Editor mode.

- [ ] **Step 5: Validate and commit the manifest**

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
SUBWAVE_VERSION=v0.42.0-obiwave.1 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
git add deploy/portainer/docker-compose.yml scripts/ci/validate-portainer-compose.mjs scripts/ci/validate-portainer-compose.test.mjs
git commit -m "deploy: add image-only Portainer stack"
```

Expected: unit, Compose, and policy checks exit 0.

### Task 3: Build the Portainer Deployment Client

**Files:**
- Create: `scripts/deploy/portainer-client.mjs`
- Create: `scripts/deploy/portainer-client.test.mjs`
- Create: `scripts/deploy/portainer-release.mjs`

**Interfaces:**
- Consumes: `PORTAINER_URL`, `PORTAINER_API_KEY`, `PORTAINER_STACK_ID`, `PORTAINER_ENDPOINT_ID`, `SUBWAVE_RELEASE_TAG`, `SUBWAVE_HEALTH_URL`, `SUBWAVE_STREAM_URL`.
- Produces: `upsertEnv`, `PortainerClient`, `probeHealth`, `probeStream`, and `deployWithRollback`.

- [ ] **Step 1: Write fake-fetch tests**

Use Node's test runner to assert:

```js
assert.deepEqual(upsertEnv([
  { name: 'ADMIN_USER', value: 'operator' },
  { name: 'SUBWAVE_VERSION', value: 'v0.41.0-obiwave.3' },
], 'SUBWAVE_VERSION', 'v0.42.0-obiwave.1'), [
  { name: 'ADMIN_USER', value: 'operator' },
  { name: 'SUBWAVE_VERSION', value: 'v0.42.0-obiwave.1' },
]);
assert.equal(JSON.parse(updateCall.body).Prune, true);
assert.equal(JSON.parse(updateCall.body).PullImage, true);
assert.match(updateCall.url, /\/api\/stacks\/7\?endpointId=2$/);
assert.equal(successfulUpdateCalls.length, 1);
assert.equal(rolledBackUpdateCalls.length, 2);
assert.equal(JSON.parse(rolledBackUpdateCalls[1].body).StackFileContent, oldFile);
```

The fixtures must return `{"status":"on-air"}` for health and an `audio/mpeg` response with a non-empty stream chunk. A second test returns HTTP 503 for the target probe and success after the rollback update.

- [ ] **Step 2: Confirm the missing client fails**

Run: `node --test scripts/deploy/portainer-client.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the API primitives**

```js
export function upsertEnv(env, name, value) {
  const next = env.map((entry) => ({ ...entry }));
  const found = next.find((entry) => entry.name === name);
  if (found) found.value = value;
  else next.push({ name, value });
  return next;
}

export class PortainerClient {
  constructor({ baseUrl, apiKey, stackId, endpointId, fetchImpl = fetch }) {
    Object.assign(this, { apiKey, stackId, endpointId, fetch: fetchImpl });
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }
  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey, ...options.headers },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Portainer request failed with HTTP ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  async snapshotStack() {
    const [stack, file] = await Promise.all([
      this.request(`/stacks/${this.stackId}`),
      this.request(`/stacks/${this.stackId}/file`),
    ]);
    return { Env: stack.Env ?? [], StackFileContent: file.StackFileContent };
  }
  updateStack(snapshot) {
    return this.request(`/stacks/${this.stackId}?endpointId=${this.endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...snapshot, Prune: true, PullImage: true }),
    });
  }
}
```

Add a 24-attempt, 5-second retry helper. `probeHealth` requires HTTP 200 and JSON status `on-air`. `probeStream` requires HTTP 200, `audio/mpeg`, and one non-empty body chunk before cancelling the reader. `deployWithRollback` snapshots first, changes only `SUBWAVE_VERSION`, updates with the checked-in manifest, probes both URLs, and restores and re-probes the snapshot after any failure.

- [ ] **Step 4: Add the CLI**

`portainer-release.mjs` must validate the tag before its first API request, require all seven environment variables, read `deploy/portainer/docker-compose.yml`, invoke `deployWithRollback`, and append target/previous versions to `GITHUB_STEP_SUMMARY`. It may print versions and probe progress but never the token, headers, full env array, or stack file.

- [ ] **Step 5: Test and commit**

```bash
node --test scripts/release/fork-tag.test.mjs scripts/deploy/portainer-client.test.mjs
node --check scripts/deploy/portainer-release.mjs
git add scripts/deploy/portainer-client.mjs scripts/deploy/portainer-client.test.mjs scripts/deploy/portainer-release.mjs
git commit -m "deploy: add verified Portainer release client"
```

Expected: all tests and syntax checks pass.

### Task 4: Replace Partial Linting with All-Push CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Delete: `.github/workflows/lint.yml`

**Interfaces:**
- Produces quality checks for controller, web, mcp-subwave, cli, and app.
- Produces deployment-contract and amd64 smoke-build checks.

- [ ] **Step 1: Create `ci.yml`**

Set `on.pull_request` and an unfiltered `on.push`, `permissions.contents: read`, and concurrency group `ci-${{ github.workflow }}-${{ github.ref }}`. Add this package matrix:

```yaml
include:
  - package: controller
    command: npm run lint && npm test
  - package: web
    command: npm run lint && npm run test:audio-format && npm run test:llm-provider && npm run test:onboarding-provider-state && npm run test:async-generation && npm run build
  - package: mcp-subwave
    command: npm run lint
  - package: cli
    command: npm run typecheck
  - package: app
    command: npm run lint && npm run typecheck
```

Each package uses Node 22, `npm ci --no-audit --no-fund`, and npm caching from its package lock. Preserve the controller dependency install for `mcp-subwave` shared imports.

Add `deployment-contract` running:

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
SUBWAVE_VERSION=v0.42.0-obiwave.1 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
```

Add `image-smoke` using `docker/build-push-action@v6`, `platforms: linux/amd64`, `push: false`, and a matrix for broadcast, controller, web, and lean analyzer Dockerfiles. Use per-image GHA cache scopes.

- [ ] **Step 2: Delete the old lint workflow and validate**

```bash
git rm .github/workflows/lint.yml
yq eval '.' .github/workflows/ci.yml >/dev/null
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: workflow validation and tests exit 0.

- [ ] **Step 3: Commit CI**

```bash
git add .github/workflows/ci.yml .github/workflows/lint.yml
git commit -m "ci: validate every pull request and push"
```

### Task 5: Publish and Deploy Exact Fork Releases

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/publish-cli.yml`
- Modify: `.github/workflows/scan-images.yml`
- Create: `.github/workflows/cut-fork-release.yml`

**Interfaces:**
- Consumes repository secret `RELEASE_PLEASE_TOKEN`.
- Consumes production Environment secret `PORTAINER_API_KEY`.
- Consumes production variables `PORTAINER_URL`, `PORTAINER_STACK_ID`, `PORTAINER_ENDPOINT_ID`, `SUBWAVE_HEALTH_URL`, `SUBWAVE_STREAM_URL`.

- [ ] **Step 1: Narrow both publication triggers**

Use this coarse trigger in image and CLI publishing workflows:

```yaml
push:
  tags:
    - 'v*-obiwave.*'
```

Add a `validate` job that calls `parseForkTag(github.ref_name)`. Every publication job requires `validate`; this parser, not the glob, is the release boundary.

- [ ] **Step 2: Publish only exact image tags**

In `publish-images.yml`, remove the manual publication path and metadata tags for `latest`, major/minor, and SHA. Retain the complete existing image matrix and platforms. Give the build step `id: build` and use:

```yaml
tags: ghcr.io/${{ github.repository_owner }}/${{ matrix.image }}:${{ github.ref_name }}
labels: |
  org.opencontainers.image.version=${{ github.ref_name }}
  org.opencontainers.image.revision=${{ github.sha }}
```

Append `${{ matrix.image }}`, `${{ github.ref_name }}`, and `${{ steps.build.outputs.digest }}` to the job summary.

- [ ] **Step 3: Add serialized production deployment**

```yaml
deploy-production:
  needs: [validate, build, scan-images]
  runs-on: ubuntu-latest
  environment: production
  concurrency:
    group: subwave-production
    cancel-in-progress: false
  timeout-minutes: 15
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
    - run: node scripts/deploy/portainer-release.mjs
      env:
        PORTAINER_URL: ${{ vars.PORTAINER_URL }}
        PORTAINER_API_KEY: ${{ secrets.PORTAINER_API_KEY }}
        PORTAINER_STACK_ID: ${{ vars.PORTAINER_STACK_ID }}
        PORTAINER_ENDPOINT_ID: ${{ vars.PORTAINER_ENDPOINT_ID }}
        SUBWAVE_RELEASE_TAG: ${{ github.ref_name }}
        SUBWAVE_HEALTH_URL: ${{ vars.SUBWAVE_HEALTH_URL }}
        SUBWAVE_STREAM_URL: ${{ vars.SUBWAVE_STREAM_URL }}
```

- [ ] **Step 4: Retarget image scanning to exact fork releases**

Change `scan-images.yml` so `workflow_call` accepts a required `release_tag`, `workflow_dispatch` accepts a `release_tag`, and the Monday schedule checks out full history and resolves the newest tag with:

```bash
git tag --list 'v*-obiwave.*' --sort=-version:refname | head -1
```

Validate the resolved value with `parseForkTag`, then scan `ghcr.io/obiwancanoweme/subwave-${{ matrix.image }}:${{ needs.resolve-tag.outputs.tag }}`. Keep SARIF upload and the existing report-only severity behavior. Call this reusable workflow from `publish-images.yml` after `build`; grant `security-events: write` in the caller and make `deploy-production` depend on `build` and the completed scan job.

- [ ] **Step 5: Add validated fork release creation**

Create `cut-fork-release.yml` with required `version` and `revision` inputs and optional `target` defaulting to `main`. It must construct the tag with `makeForkTag`, verify `v${version}` is an ancestor of the target, fail if the remote fork tag exists, and run:

```bash
gh release create "${TAG}" --target "${GITHUB_SHA}" --generate-notes --title "SUB/WAVE ${TAG}"
```

Use `secrets.RELEASE_PLEASE_TOKEN` as `GH_TOKEN` with no `GITHUB_TOKEN` fallback, because recursive workflow suppression would prevent image publication.

- [ ] **Step 6: Validate and commit workflows**

```bash
yq eval '.' .github/workflows/publish-images.yml >/dev/null
yq eval '.' .github/workflows/publish-cli.yml >/dev/null
yq eval '.' .github/workflows/scan-images.yml >/dev/null
yq eval '.' .github/workflows/cut-fork-release.yml >/dev/null
TAG=v0.42.0-obiwave.1 node -e "import('./scripts/release/fork-tag.mjs').then(m => console.log(m.parseForkTag(process.env.TAG)))"
git add .github/workflows/publish-images.yml .github/workflows/publish-cli.yml .github/workflows/scan-images.yml .github/workflows/cut-fork-release.yml
git commit -m "ci: deploy immutable fork releases through Portainer"
```

Expected: workflow validation exits 0 and the tag parser reports version `0.42.0`, revision `1`.

### Task 6: Document and Verify the Pipeline

**Files:**
- Modify: `docs/deployment.md`
- Modify: `README.md`

**Interfaces:**
- Produces a secret-free operator runbook.

- [ ] **Step 1: Document GitHub and Portainer configuration**

Document the `production` Environment secret `PORTAINER_API_KEY` and variables:

```text
PORTAINER_URL=https://portainer.kener.org
PORTAINER_STACK_ID=numeric ID copied from Portainer
PORTAINER_ENDPOINT_ID=numeric ark environment ID
SUBWAVE_HEALTH_URL=https://radio.kener.org/api/health
SUBWAVE_STREAM_URL=https://radio.kener.org/stream.mp3
```

Include the safe secret prompt:

```bash
gh secret set PORTAINER_API_KEY --env production --repo ObiWanCanOweMe/obiwave
```

Document Web Editor stack mode, the fixed state path, both ark bind addresses, bender's retained routing role, exact-tag releases, and automatic rollback.

- [ ] **Step 2: Document the initial fork release command**

```bash
gh workflow run cut-fork-release.yml --repo ObiWanCanOweMe/obiwave -f version=0.42.0 -f revision=1 -f target=main
```

Explain that upstream `v0.42.0` is already merged/deployed and is not merged again.

- [ ] **Step 3: Run the full local gate**

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
SUBWAVE_VERSION=v0.42.0-obiwave.1 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
npm --prefix controller run lint
npm --prefix controller test
npm --prefix web run lint
npm --prefix web run build
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/deployment.md README.md
git commit -m "docs: add fork release and Portainer runbook"
```

- [ ] **Step 5: Verify event boundaries in a draft pull request**

Push the implementation branch and open a draft PR. Confirm CI runs for both the branch push and PR, while image publication and production deployment do not. Confirm `parseForkTag('v0.42.0')` exits non-zero. Do not create `v0.42.0-obiwave.1` until the ark migration plan reaches its release checkpoint.
