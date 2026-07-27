# Portainer CUDA Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ark's Portainer split-stack use upstream SUB/WAVE's pinned CUDA analyzer image with mandatory NVIDIA access.

**Architecture:** The analyzer is the sole upstream-owned image in the Portainer manifest and has its own required `UPSTREAM_ANALYZER_VERSION` pin, independent of fork-owned `SUBWAVE_VERSION`. Source and Docker-resolved validation enforce the image boundary, fail-closed CUDA selection, and the NVIDIA reservation; release tests prove automated fork releases preserve the operator-managed upstream pin.

**Tech Stack:** Docker Compose, Portainer, NVIDIA Container Toolkit, Node.js built-in test runner, JavaScript deployment validators.

## Global Constraints

- Use `ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}`.
- Set Ark's initial `UPSTREAM_ANALYZER_VERSION` value to `1.0.0`; upstream tags do not have a `v` prefix.
- Keep `SUBWAVE_VERSION` exclusively responsible for ObiWave-owned images.
- Set `ANALYZE_DEVICE=cuda`; CPU fallback is forbidden.
- Reserve all NVIDIA GPUs with `driver: nvidia`, `count: all`, and `capabilities: [gpu]`.
- Do not add the CUDA analyzer to ObiWave's image publication matrix.
- Do not use a floating `latest` tag.

---

### Task 1: Enforce and apply the Portainer CUDA topology

**Files:**
- Modify: `scripts/ci/validate-portainer-compose.test.mjs`
- Modify: `scripts/ci/validate-portainer-compose.mjs`
- Modify: `deploy/portainer/docker-compose.yml`

**Interfaces:**
- Consumes: `validatePortainerCompose(source: string): string[]` and `validateResolvedPortainerCompose(model: object): string[]`.
- Produces: a source manifest whose analyzer image has the dedicated upstream pin, `ANALYZE_DEVICE=cuda`, and an exact NVIDIA device reservation.

- [ ] **Step 1: Replace the valid analyzer fixtures and add failing source-policy tests**

In the `valid` fixture, replace the analyzer image and add the CUDA runtime contract:

```yaml
  analyzer:
    image: ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}
    logging: *default-logging
    mem_limit: ${ANALYZER_MEM_LIMIT:-6g}
    environment:
      ANALYZE_DEVICE: cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    volumes:
      - *state-mount
      - analyzer-cache:/opt/analyzer/hf-cache
```

Change the mutable-deployment test so a non-analyzer upstream image remains
rejected through exact service-image validation. Add mutations to the
topology-removal table:

```js
[
  '      ANALYZE_DEVICE: cuda\n',
  'service analyzer must require CUDA',
],
[
  '    deploy:\n      resources:\n        reservations:\n          devices:\n            - driver: nvidia\n              count: all\n              capabilities: [gpu]\n',
  'service analyzer is missing its NVIDIA GPU reservation',
],
```

Update the analyzer image rejection to replace
`ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}`
with each of the following and expect `service analyzer has an invalid image`:

```text
ghcr.io/obiwancanoweme/subwave-analyzer:${SUBWAVE_VERSION:?required}
ghcr.io/perminder-klair/subwave-analyzer-cuda:latest
ghcr.io/perminder-klair/subwave-analyzer-cuda:${SUBWAVE_VERSION:?required}
```

- [ ] **Step 2: Add failing Docker-resolved analyzer contract tests**

Extend `validResolved.services` with:

```js
analyzer: {
  image: 'ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0',
  environment: { ANALYZE_DEVICE: 'cuda' },
  deploy: {
    resources: {
      reservations: {
        devices: [{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }],
      },
    },
  },
},
```

Add a test that verifies the valid model passes, then independently mutates
the image, device selection, driver, count, and capabilities:

```js
test('resolved analyzer requires the upstream CUDA image and NVIDIA reservation', () => {
  assert.deepEqual(resolvedErrors(validResolved), []);

  const cases = [
    ['image', 'example.invalid/analyzer:1.0.0', 'resolved analyzer has an invalid upstream CUDA image'],
    ['device', 'cpu', 'resolved analyzer must require CUDA'],
    ['driver', 'other', 'resolved analyzer has an invalid NVIDIA GPU reservation'],
    ['count', 1, 'resolved analyzer has an invalid NVIDIA GPU reservation'],
    ['capabilities', ['compute'], 'resolved analyzer has an invalid NVIDIA GPU reservation'],
  ];

  for (const [field, value, expected] of cases) {
    const model = structuredClone(validResolved);
    if (field === 'image') model.services.analyzer.image = value;
    if (field === 'device') model.services.analyzer.environment.ANALYZE_DEVICE = value;
    if (field === 'driver') model.services.analyzer.deploy.resources.reservations.devices[0].driver = value;
    if (field === 'count') model.services.analyzer.deploy.resources.reservations.devices[0].count = value;
    if (field === 'capabilities') {
      model.services.analyzer.deploy.resources.reservations.devices[0].capabilities = value;
    }
    assert.ok(resolvedErrors(model).includes(expected));
  }
});
```

- [ ] **Step 3: Run the focused tests and verify the new contract fails**

Run:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Expected: failures report the old ObiWave analyzer image and missing CUDA/NVIDIA
requirements.

- [ ] **Step 4: Implement source and resolved validation**

In `serviceImages`, set the analyzer entry to:

```js
['analyzer', 'ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}'],
```

Remove the blanket `/ghcr\.io\/perminder-klair\//` rule because the exact
service-image map now permits upstream only for `analyzer` and rejects it for
every other named service. Add source requirements:

```js
['analyzer', 'ANALYZE_DEVICE: cuda', 'service analyzer must require CUDA'],
[
  'analyzer',
  'driver: nvidia\n              count: all\n              capabilities: [gpu]',
  'service analyzer is missing its NVIDIA GPU reservation',
],
```

Add resolved analyzer checks to `validateResolvedPortainerCompose`:

```js
const analyzer = services.analyzer;
if (!/^ghcr\.io\/perminder-klair\/subwave-analyzer-cuda:(?!latest$)[^${}\\s]+$/.test(analyzer?.image ?? '')) {
  errors.push('resolved analyzer has an invalid upstream CUDA image');
}
if (analyzer?.environment?.ANALYZE_DEVICE !== 'cuda') {
  errors.push('resolved analyzer must require CUDA');
}
const devices = analyzer?.deploy?.resources?.reservations?.devices;
if (
  !Array.isArray(devices)
  || devices.length !== 1
  || devices[0]?.driver !== 'nvidia'
  || devices[0]?.count !== 'all'
  || JSON.stringify(devices[0]?.capabilities) !== JSON.stringify(['gpu'])
) {
  errors.push('resolved analyzer has an invalid NVIDIA GPU reservation');
}
```

- [ ] **Step 5: Change the Portainer analyzer service**

Replace the lean/heavy image commentary and image with:

```yaml
    # CUDA analysis is upstream-owned and independently pinned. Portainer must
    # define UPSTREAM_ANALYZER_VERSION (initially 1.0.0); fork releases do not
    # advance this image.
    image: ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}
```

Add this environment entry:

```yaml
      ANALYZE_DEVICE: cuda
```

Add this block before `volumes`:

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

- [ ] **Step 6: Run focused and real-manifest validation**

Run:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
SUBWAVE_VERSION=v1.0.0-obiwave.1 UPSTREAM_ANALYZER_VERSION=1.0.0 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
```

Expected: all tests pass and the validator prints
`validated deploy/portainer/docker-compose.yml`.

- [ ] **Step 7: Commit the topology contract**

```bash
git add scripts/ci/validate-portainer-compose.test.mjs scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
git commit -m "deploy: require upstream CUDA analyzer on Ark"
```

---

### Task 2: Preserve the independent upstream pin through fork releases

**Files:**
- Modify: `scripts/deploy/portainer-client.test.mjs`
- Modify: `scripts/ci/workflow-contract.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `renderReleaseManifest(manifest: string, targetVersion: string): string` and `deployWithRollback(options): Promise<object>`.
- Produces: regression coverage proving `SUBWAVE_VERSION` rendering does not alter `${UPSTREAM_ANALYZER_VERSION:?required}` or its Portainer environment entry.

- [ ] **Step 1: Add failing independent-version rendering coverage**

Extend `releaseManifest`:

```yaml
  analyzer:
    image: ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}
```

Extend `renderedManifest` with the same unresolved upstream placeholder. In
`renders every exact release placeholder with the immutable target tag`,
replace the assertion that no `SUBWAVE_VERSION` text remains with:

```js
assert.doesNotMatch(rendered, /\$\{SUBWAVE_VERSION[^}]*\}/);
assert.match(
  rendered,
  /ghcr\.io\/perminder-klair\/subwave-analyzer-cuda:\$\{UPSTREAM_ANALYZER_VERSION:\?required\}/,
);
```

Add `{ name: 'UPSTREAM_ANALYZER_VERSION', value: '1.0.0', preserved: 'upstream-pin' }`
to `oldEnv`. In the successful update test, seed that entry and assert it is
unchanged in `update.Env`.

- [ ] **Step 2: Run the deployment tests and verify the old assertion fails**

Run:

```bash
node --test scripts/deploy/portainer-client.test.mjs
```

Expected: the old rendered-manifest expectations fail because the fixture now
contains the independent upstream placeholder.

- [ ] **Step 3: Adjust only the test expectations needed by the ownership boundary**

Keep production `renderReleaseManifest` unchanged: it must continue replacing
only `${SUBWAVE_VERSION:?required}`. Update fixture-derived assertions so they
expect the upstream placeholder to survive target rendering and expect the
operator's `UPSTREAM_ANALYZER_VERSION=1.0.0` entry to survive both target
deployment and rollback unchanged.

- [ ] **Step 4: Require the upstream pin in CI's real-manifest validation**

Change the `.github/workflows/ci.yml` validation environment to:

```yaml
env:
  SUBWAVE_VERSION: v0.42.0-obiwave.1
  UPSTREAM_ANALYZER_VERSION: 1.0.0
  ADMIN_USER: ci
  ADMIN_PASS: ci
  SITE_URL: https://radio.kener.org
```

If the workflow currently expresses these values inline, preserve that style
and insert `UPSTREAM_ANALYZER_VERSION=1.0.0` beside `SUBWAVE_VERSION`.

Add this contract assertion:

```js
test('CI resolves the independently pinned upstream CUDA analyzer', () => {
  assert.match(
    ci,
    /UPSTREAM_ANALYZER_VERSION=1\.0\.0[\s\S]*validate-portainer-compose\.mjs/,
  );
  assert.doesNotMatch(publish, /subwave-analyzer-cuda/);
});
```

- [ ] **Step 5: Run release and workflow contract tests**

Run:

```bash
node --test scripts/deploy/portainer-client.test.mjs scripts/ci/workflow-contract.test.mjs
```

Expected: all tests pass without production deployment-client changes, and
the publication matrix still excludes `subwave-analyzer-cuda`.

- [ ] **Step 6: Commit release-boundary coverage**

```bash
git add scripts/deploy/portainer-client.test.mjs scripts/ci/workflow-contract.test.mjs .github/workflows/ci.yml
git commit -m "test: preserve upstream analyzer pin in releases"
```

---

### Task 3: Document Ark's CUDA deployment contract

**Files:**
- Modify: `.env.example`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: the manifest contract completed in Tasks 1 and 2.
- Produces: operator instructions for configuring and diagnosing Ark before Portainer recreates the analyzer.

- [ ] **Step 1: Update the environment example**

Replace the generic GPU-overlay guidance with Portainer-specific ownership and
failure semantics:

```dotenv
# Ark's Portainer split stack uses upstream's CUDA analyzer image directly.
# Set this in the Portainer stack Environment; it is independent of the
# ObiWave SUBWAVE_VERSION and must not be a floating tag.
# UPSTREAM_ANALYZER_VERSION=1.0.0
#
# Portainer forces ANALYZE_DEVICE=cuda and reserves all NVIDIA GPUs. If the
# driver, NVIDIA Container Toolkit, or Docker GPU runtime is unavailable, the
# analyzer fails instead of falling back to CPU.
# ANALYZE_IDLE_UNLOAD_S=  # seconds idle before models leave VRAM (default 300)
```

Retain the upstream overlay instructions only where they describe non-Portainer
deployments, and remove `ANALYZER_HEAVY` guidance that implies it controls the
Portainer analyzer.

- [ ] **Step 2: Update deployment and release documentation**

In the Portainer Environment section, require:

```text
SUBWAVE_VERSION=<exact ObiWave release tag>
UPSTREAM_ANALYZER_VERSION=1.0.0
```

State that:

- Ark must pass `nvidia-smi` and `docker run --rm --gpus all
  nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` before updating the stack.
- Portainer uses upstream
  `ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0`.
- The analyzer is fail-closed with `ANALYZE_DEVICE=cuda`.
- Fork releases update `SUBWAVE_VERSION`, preserve
  `UPSTREAM_ANALYZER_VERSION`, and never publish a fork CUDA analyzer.

- [ ] **Step 3: Check documentation and manifest drift**

Run:

```bash
rg -n "ANALYZER_HEAVY|UPSTREAM_ANALYZER_VERSION|subwave-analyzer-cuda|ANALYZE_DEVICE" deploy/portainer/docker-compose.yml .env.example docs/deployment.md
git diff --check
```

Expected: Portainer references only the upstream CUDA image and dedicated pin;
documentation contains no contradictory Portainer lean/heavy toggle; no
whitespace errors are reported.

- [ ] **Step 4: Commit operator documentation**

```bash
git add .env.example docs/deployment.md
git commit -m "docs: explain Ark CUDA analyzer requirements"
```

---

### Task 4: Run the final acceptance gate

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: all deliverables from Tasks 1 through 3.
- Produces: fresh evidence that the manifest, release boundary, and CI contract pass together.

- [ ] **Step 1: Verify the upstream image still resolves**

Run:

```bash
docker buildx imagetools inspect ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0
```

Expected: the registry returns an OCI image index containing `linux/amd64`.

- [ ] **Step 2: Run the complete deployment-contract test set**

Run:

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Validate the real manifest through Docker Compose**

Run:

```bash
SUBWAVE_VERSION=v1.0.0-obiwave.1 UPSTREAM_ANALYZER_VERSION=1.0.0 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
```

Expected: `validated deploy/portainer/docker-compose.yml`.

- [ ] **Step 4: Inspect the resolved analyzer contract**

Run:

```bash
SUBWAVE_VERSION=v1.0.0-obiwave.1 UPSTREAM_ANALYZER_VERSION=1.0.0 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose --profile '*' -f deploy/portainer/docker-compose.yml config --format json
```

Expected: `services.analyzer.image` is
`ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0`,
`services.analyzer.environment.ANALYZE_DEVICE` is `cuda`, and its sole device
reservation has NVIDIA driver, all-device count, and GPU capability.

- [ ] **Step 5: Confirm scope and clean diffs**

Run:

```bash
git diff --check
git status -sb
git log --oneline -5
```

Expected: no uncommitted implementation changes remain; the three
implementation commits follow the design and plan commits.
