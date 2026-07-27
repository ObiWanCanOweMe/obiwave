# Portainer CUDA Analyzer Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror upstream's exact CUDA analyzer into ObiWave's GHCR namespace under every immutable fork release tag and deploy it on Ark with mandatory NVIDIA access.

**Architecture:** A release helper derives the unprefixed upstream version from the validated fork tag, verifies both registry endpoints, performs a registry-to-registry OCI copy with Docker Buildx, and requires source/destination digest equality. The publish workflow runs this mirror beside—not inside—the local image build matrix, then scans it before Portainer deploys every service with the same `SUBWAVE_VERSION`.

**Tech Stack:** GitHub Actions, GHCR, Docker Buildx `imagetools`, Docker Compose, Portainer, NVIDIA Container Toolkit, Node.js built-in test runner.

**Supersedes:** `docs/superpowers/plans/2026-07-27-portainer-cuda-analyzer.md`

## Global Constraints

- Mirror source `ghcr.io/perminder-klair/subwave-analyzer-cuda:<upstream-version>` to `ghcr.io/obiwancanoweme/subwave-analyzer-cuda:<fork-qualified-release-tag>`.
- Derive `<upstream-version>` from `parseForkTag(releaseTag).version`; upstream tags do not have a `v` prefix.
- Require source and destination top-level OCI digests to match.
- Never rebuild the mirrored CUDA analyzer or add it to the Docker build matrix.
- Never publish or consume a floating `latest` CUDA analyzer tag.
- Use `ghcr.io/obiwancanoweme/subwave-analyzer-cuda:${SUBWAVE_VERSION:?required}` in Portainer.
- Remove `UPSTREAM_ANALYZER_VERSION`; all deployed images use the same exact fork release tag.
- Set `ANALYZE_DEVICE=cuda`; CPU fallback is forbidden.
- Reserve all NVIDIA GPUs with `driver: nvidia`, `count: all`, and `capabilities: [gpu]`.
- A missing source, pre-existing destination, copy failure, digest mismatch, or scan failure must block deployment.
- Leave the upstream-owned non-Portainer `docker-compose.analyzer-gpu.yml` behavior unchanged.

---

### Task 1: Build and test the immutable registry mirror helper

**Files:**
- Create: `scripts/release/mirror-cuda-analyzer.mjs`
- Create: `scripts/release/mirror-cuda-analyzer.test.mjs`

**Interfaces:**
- Consumes: `parseForkTag(value: string): { tag: string, version: string, revision: number }` from `scripts/release/fork-tag.mjs`.
- Produces: `cudaMirrorRefs(releaseTag: string): { source: string, destination: string }`.
- Produces: `mirrorCudaAnalyzer(releaseTag: string, options?: { run?: Function }): { source: string, destination: string, digest: string }`.

- [ ] **Step 1: Write failing reference-derivation tests**

Create `scripts/release/mirror-cuda-analyzer.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cudaMirrorRefs, mirrorCudaAnalyzer } from './mirror-cuda-analyzer.mjs';

test('derives exact upstream and mirror references from a fork release', () => {
  assert.deepEqual(cudaMirrorRefs('v1.0.0-obiwave.2'), {
    source: 'ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0',
    destination: 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.0.0-obiwave.2',
  });
});

test('rejects non-fork and floating release tags', () => {
  for (const tag of ['1.0.0', 'v1.0.0', 'latest']) {
    assert.throws(() => cudaMirrorRefs(tag), /fork-qualified release tag/);
  }
});
```

- [ ] **Step 2: Write failing copy and digest-integrity tests**

Use an injected command runner returning `{ status, stdout, stderr }`. Assert
this sequence:

```js
[
  ['docker', ['buildx', 'imagetools', 'inspect', source, '--format', '{{json .Manifest.Digest}}']],
  ['docker', ['buildx', 'imagetools', 'inspect', destination]],
  ['docker', ['buildx', 'imagetools', 'create', '--tag', destination, source]],
  ['docker', ['buildx', 'imagetools', 'inspect', destination, '--format', '{{json .Manifest.Digest}}']],
]
```

Cover these outcomes:

```js
test('copies an absent destination and requires equal digests', () => {
  // source digest succeeds, destination emits explicit not-found, create
  // succeeds, destination digest equals source; result returns the digest.
});

test('fails closed when the source cannot be inspected', () => {
  // unauthorized, not-found, and transport errors all throw before copy.
});

test('refuses to overwrite an existing destination', () => {
  // a successful destination inspect throws an immutable-release error.
});

test('fails closed when destination absence is ambiguous', () => {
  // authentication and 5xx errors do not count as absence.
});

test('rejects copy failure and source/destination digest mismatch', () => {
  // both cases throw and never report success.
});
```

- [ ] **Step 3: Run the new test and verify RED**

Run:

```bash
node --test scripts/release/mirror-cuda-analyzer.test.mjs
```

Expected: fail because `mirror-cuda-analyzer.mjs` does not exist.

- [ ] **Step 4: Implement the minimal mirror helper**

Create `scripts/release/mirror-cuda-analyzer.mjs` with:

```js
#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseForkTag } from './fork-tag.mjs';

const SOURCE_REPOSITORY = 'ghcr.io/perminder-klair/subwave-analyzer-cuda';
const DESTINATION_REPOSITORY = 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda';
const DIGEST_FORMAT = '{{json .Manifest.Digest}}';

export function cudaMirrorRefs(releaseTag) {
  const { version } = parseForkTag(releaseTag);
  return {
    source: `${SOURCE_REPOSITORY}:${version}`,
    destination: `${DESTINATION_REPOSITORY}:${releaseTag}`,
  };
}

function commandRunner(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
```

Add small internal helpers that:

- accept only a successful inspect containing a JSON string matching
  `sha256:[0-9a-f]{64}`;
- accept destination absence only for `manifest unknown` or an exact
  `<destination>: not found` diagnostic;
- include image references but never command output bodies in thrown errors.

Implement `mirrorCudaAnalyzer` with the exact test sequence, and add a CLI
entry point that reads `RELEASE_TAG`, prints only source, destination, and the
verified digest, and exits nonzero with a sanitized message on failure.

- [ ] **Step 5: Run helper and existing release tests**

Run:

```bash
node --test scripts/release/mirror-cuda-analyzer.test.mjs scripts/release/fork-tag.test.mjs scripts/ci/assert-image-tag-absent.test.mjs
```

Expected: all tests pass with no warning output.

- [ ] **Step 6: Commit**

```bash
git add scripts/release/mirror-cuda-analyzer.mjs scripts/release/mirror-cuda-analyzer.test.mjs
git commit -m "release: mirror upstream CUDA analyzer immutably"
```

---

### Task 2: Integrate mirroring, preflight, and scanning into releases

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/scan-images.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci/workflow-contract.test.mjs`

**Interfaces:**
- Consumes: CLI `RELEASE_TAG=<fork tag> node scripts/release/mirror-cuda-analyzer.mjs`.
- Produces: a `mirror-cuda-analyzer` workflow job required by image scanning and production deployment.

- [ ] **Step 1: Replace old workflow assertions with failing mirror assertions**

In `scripts/ci/workflow-contract.test.mjs`, replace tests that require CUDA
publication exclusion with assertions that:

```js
test('CUDA analyzer is mirrored, never rebuilt', () => {
  assert.match(publish, /mirror-cuda-analyzer:/);
  assert.match(
    publish,
    /RELEASE_TAG: \$\{\{ github\.ref_name \}\}[\s\S]*node scripts\/release\/mirror-cuda-analyzer\.mjs/,
  );
  const buildMatrix = publish.slice(
    publish.indexOf('  build:'),
    publish.indexOf('    steps:', publish.indexOf('  build:')),
  );
  assert.doesNotMatch(buildMatrix, /subwave-analyzer-cuda/);
});

test('CUDA mirror is preflighted, scanned, and gates deployment', () => {
  assert.match(publish, /tag-preflight:[\s\S]*- subwave-analyzer-cuda/);
  assert.match(publish, /scan-images:[\s\S]*needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer\]/);
  assert.match(publish, /deploy-production:[\s\S]*needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer, scan-images\]/);
  assert.match(scan, /matrix:\s*\n\s+image: \[[^\]]*analyzer-cuda/);
});
```

Change the preflight count/name test from nine images to ten and include
`subwave-analyzer-cuda`. Remove the old CI assertion for
`UPSTREAM_ANALYZER_VERSION=1.0.0`.

- [ ] **Step 2: Run workflow tests and verify RED**

Run:

```bash
node --test scripts/ci/workflow-contract.test.mjs
```

Expected: mirror job, tenth preflight image, scan entry, and dependency
assertions fail.

- [ ] **Step 3: Add the mirror job and release dependencies**

In `.github/workflows/publish-images.yml`:

- document `subwave-analyzer-cuda` as a mirrored upstream image;
- add it to `tag-preflight.strategy.matrix.image`;
- add `mirror-cuda-analyzer` after preflight, with
  `needs: [validate, release-gate, tag-preflight]`;
- check out, set up Node 22, set up Buildx, log into GHCR with
  `${{ secrets.GITHUB_TOKEN }}`, and run:

```yaml
- name: Mirror exact upstream CUDA analyzer
  env:
    RELEASE_TAG: ${{ github.ref_name }}
  run: node scripts/release/mirror-cuda-analyzer.mjs
```

Keep it out of `build.strategy.matrix.include`. Change dependencies to:

```yaml
scan-images:
  needs: [validate, release-gate, tag-preflight, build, mirror-cuda-analyzer]

deploy-production:
  needs: [validate, release-gate, tag-preflight, build, mirror-cuda-analyzer, scan-images]
```

In `.github/workflows/scan-images.yml`, include `analyzer-cuda` in the scan
matrix and update comments to identify it as deployed on Ark.

Remove `UPSTREAM_ANALYZER_VERSION=1.0.0` from both real-manifest validation
commands in `.github/workflows/ci.yml`.

- [ ] **Step 4: Run workflow and helper contracts**

Run:

```bash
node --test scripts/release/mirror-cuda-analyzer.test.mjs scripts/ci/workflow-contract.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish-images.yml .github/workflows/scan-images.yml .github/workflows/ci.yml scripts/ci/workflow-contract.test.mjs
git commit -m "ci: mirror and scan the CUDA analyzer"
```

---

### Task 3: Rewire Portainer to the immutable mirror

**Files:**
- Modify: `deploy/portainer/docker-compose.yml`
- Modify: `scripts/ci/validate-portainer-compose.mjs`
- Modify: `scripts/ci/validate-portainer-compose.test.mjs`
- Modify: `scripts/deploy/portainer-client.test.mjs`

**Interfaces:**
- Consumes: mirrored image
  `ghcr.io/obiwancanoweme/subwave-analyzer-cuda:<fork release tag>`.
- Produces: a manifest whose release renderer resolves the CUDA analyzer with
  the same `SUBWAVE_VERSION` as every other fork image.

- [ ] **Step 1: Write failing mirror-image validation tests**

Change the valid source fixture and resolved fixture to:

```yaml
image: ghcr.io/obiwancanoweme/subwave-analyzer-cuda:${SUBWAVE_VERSION:?required}
```

```js
image: 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.0.0-obiwave.1'
```

Reject direct upstream, `latest`, and `${UPSTREAM_ANALYZER_VERSION:?required}`
variants. Keep all CUDA-device and NVIDIA-reservation mutation tests.

In release-client fixtures, give both controller and analyzer exact
`${SUBWAVE_VERSION:?required}` references. Assert both render to
`v0.42.0-obiwave.1` and no `UPSTREAM_ANALYZER_VERSION` entry or placeholder
exists.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: source/resolved image validation fails until the manifest and
validator use the mirror.

- [ ] **Step 3: Change manifest and validators**

Set the manifest and `serviceImages` analyzer entry to:

```text
ghcr.io/obiwancanoweme/subwave-analyzer-cuda:${SUBWAVE_VERSION:?required}
```

Change resolved validation to accept only:

```js
/^ghcr\.io\/obiwancanoweme\/subwave-analyzer-cuda:v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-obiwave\.[1-9][0-9]*$/
```

Keep `ANALYZE_DEVICE=cuda`, the exact NVIDIA reservation, memory limit, state
mount, cache, and logging requirements unchanged. Remove all
`UPSTREAM_ANALYZER_VERSION` handling.

- [ ] **Step 4: Run focused and real-manifest validation**

Run:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
SUBWAVE_VERSION=v1.0.0-obiwave.1 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
```

Expected: tests pass and the validator prints
`validated deploy/portainer/docker-compose.yml`.

- [ ] **Step 5: Commit**

```bash
git add deploy/portainer/docker-compose.yml scripts/ci/validate-portainer-compose.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
git commit -m "deploy: use the release-tagged CUDA mirror"
```

---

### Task 4: Align operator documentation with mirroring

**Files:**
- Modify: `.env.example`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: release and Portainer contracts from Tasks 1 through 3.
- Produces: one operator version variable and explicit mirror provenance.

- [ ] **Step 1: Remove the superseded independent-pin guidance**

Delete every `UPSTREAM_ANALYZER_VERSION` reference. Document that Ark uses:

```text
ghcr.io/obiwancanoweme/subwave-analyzer-cuda:${SUBWAVE_VERSION}
```

and that the release workflow copies it byte-for-byte from:

```text
ghcr.io/perminder-klair/subwave-analyzer-cuda:<upstream base version>
```

State that top-level digest equality is required before scanning and
deployment, no CUDA image is rebuilt, and no `latest` mirror is published.

- [ ] **Step 2: Preserve runtime and preflight guidance**

Keep the Ark checks:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

Keep `ANALYZE_DEVICE=cuda`, all-GPU reservation, fail-closed behavior, and
NVIDIA Container Toolkit requirements. Leave non-Portainer overlay guidance
unchanged and label it outside Ark's Portainer mirror contract.

- [ ] **Step 3: Verify documentation scope**

Run:

```bash
rg -n "UPSTREAM_ANALYZER_VERSION|subwave-analyzer-cuda|ANALYZE_DEVICE|latest" deploy/portainer/docker-compose.yml .env.example docs/deployment.md
git diff --check
```

Expected: no `UPSTREAM_ANALYZER_VERSION`; no Portainer CUDA `latest`; upstream
overlay guidance remains explicitly separate.

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/deployment.md
git commit -m "docs: explain release-tagged CUDA mirroring"
```

---

### Task 5: Run the final acceptance gate

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: fresh whole-feature test, registry-source, manifest-resolution,
  and history evidence.

- [ ] **Step 1: Verify the exact upstream source**

Run:

```bash
docker buildx imagetools inspect ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0
```

Expected: a valid OCI index containing `linux/amd64`.

- [ ] **Step 2: Run all deployment and release contracts**

Run:

```bash
node --test scripts/release/fork-tag.test.mjs scripts/release/mirror-cuda-analyzer.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Validate and inspect the real Portainer manifest**

Run:

```bash
SUBWAVE_VERSION=v1.0.0-obiwave.1 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
SUBWAVE_VERSION=v1.0.0-obiwave.1 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose --profile '*' -f deploy/portainer/docker-compose.yml config --format json
```

Expected: analyzer image is
`ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.0.0-obiwave.1`, device is
`cuda`, and the sole reservation resolves to NVIDIA/all-GPUs/GPU capability.

- [ ] **Step 4: Confirm the mirror stays out of local builds**

Run:

```bash
rg -n "subwave-analyzer-cuda" .github/workflows/publish-images.yml .github/workflows/scan-images.yml
```

Expected: CUDA appears in preflight, mirror, scan, and dependency contracts,
but not in `build.strategy.matrix.include`.

- [ ] **Step 5: Confirm clean scope and history**

Run:

```bash
git diff --check
git status -sb
git log --oneline -10
```

Expected: clean worktree and discrete helper, workflow, manifest, and
documentation commits after the revised design and plan commits.
