# CUDA Chatterbox Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `subwave-tts-heavy-cuda` as a first-class immutable release image and deploy it on ark with Chatterbox on CUDA and PocketTTS on CPU.

**Architecture:** Reuse `docker/Dockerfile.tts-heavy`, changing only the Chatterbox PyTorch index for the new image matrix entry. Keep portable Compose CPU-first; make ark's Portainer manifest select the CUDA sibling, gate startup on CUDA, reserve the NVIDIA device, and start both engines. Extend the existing release, scan, rollback, and verification paths instead of creating a parallel deployer.

**Tech Stack:** Docker Buildx/Compose, GitHub Actions, GHCR, Trivy, Node.js 22 contract tests, Python/FastAPI, PyTorch CUDA 12.4, Portainer, NVIDIA Container Toolkit.

## Global Constraints

- Keep the CPU `subwave-tts-heavy` image and portable Compose defaults unchanged.
- Publish `subwave-tts-heavy-cuda` for `linux/amd64` using the cu124 PyTorch index.
- Ark loads `chatterbox,pocket-tts`; only Chatterbox uses CUDA.
- Ark needs no new Portainer variable; `HF_TOKEN` remains optional.
- CUDA unavailability must fail closed on ark, never silently run Chatterbox on CPU.
- Do not mutate any `.1` tag or image. Target `v1.7.0-obiwave.2`.
- Stop on any policy, review, identity, or deployment failure.

---

### Task 1: Runtime CUDA Attestation

**Files:**
- Modify: `controller/scripts/chatterbox_worker.py`
- Modify: `controller/scripts/test_chatterbox_chunk.py`
- Modify: `docker/tts-heavy/server.py`

**Interfaces:**
- Produces ready metadata `{ "ready": true, "device": "cpu" | "cuda" }`.
- Adds `/health.chatterbox_device`, `null` until ready.
- Preserves every existing health field and portable CPU fallback.

- [ ] **Step 1: Write the failing test**

Extend `test_chatterbox_chunk.py` to import `resolve_device` and assert:

```python
check("cpu stays cpu", resolve_device("cpu", False) == "cpu")
check("available cuda stays cuda", resolve_device("cuda", True) == "cuda")
check("unavailable cuda falls back", resolve_device("cuda", False) == "cpu")
```

- [ ] **Step 2: Preserve RED**

Run `python3 controller/scripts/test_chatterbox_chunk.py`.

Expected: import failure because `resolve_device` does not exist.

- [ ] **Step 3: Implement device resolution and ready metadata**

Add this pure helper and use it after importing torch:

```python
def resolve_device(requested, cuda_available):
    if requested == "cuda" and not cuda_available:
        return "cpu"
    return requested
```

Emit `{"id": None, "ready": True, "device": device}`. In the sidecar health response add:

```python
"chatterbox_device": (
    chatterbox_worker.ready_meta.get("device") if chatterbox_worker.ready else None
),
```

- [ ] **Step 4: Verify and commit**

```bash
python3 controller/scripts/test_chatterbox_chunk.py
npm --prefix controller test
npm --prefix controller run lint
git add controller/scripts/chatterbox_worker.py controller/scripts/test_chatterbox_chunk.py docker/tts-heavy/server.py
git commit -m "feat: attest chatterbox runtime device"
```

Expected: tests pass; lint has no errors.

---

### Task 2: Immutable CUDA Image Publication

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/scan-images.yml`
- Modify: `scripts/ci/workflow-contract.test.mjs`
- Modify: `scripts/security/trivy-policy.mjs`
- Modify: `scripts/security/trivy-policy.test.mjs`
- Modify: `security/trivy-acceptance.json` only for findings proven by the exact CUDA image scan.

**Interfaces:**
- Produces `ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda:${{ github.ref_name }}`.
- Uses the existing Dockerfile with one CUDA-specific build argument.
- Expands release preflight and scanning from ten to eleven images.

- [ ] **Step 1: Write failing workflow expectations**

Update exact workflow and Trivy-policy image arrays to place `subwave-tts-heavy-cuda` immediately after `subwave-tts-heavy`. Require this build block:

```yaml
- image: subwave-tts-heavy-cuda
  dockerfile: docker/Dockerfile.tts-heavy
  platforms: linux/amd64
  build_args: |
    CHATTERBOX_TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124
```

Assert that tag-preflight, build, scan, and aggregate-policy image sets contain the CUDA image exactly once. Preserve the special pinned-digest rule for `subwave-analyzer-cuda` only.

- [ ] **Step 2: Preserve RED**

Run `node --test scripts/ci/workflow-contract.test.mjs`.

Expected: failures identify the missing preflight, build, scan, and policy entries.

- [ ] **Step 3: Add the release and scanner entries**

Add `subwave-tts-heavy-cuda` to the documented image list, tag-preflight matrix, build matrix with the exact cu124 argument, scan matrix, and `trivy-policy.mjs` expected-image list. Do not change the existing CPU image entry, Dockerfile defaults, or analyzer mirror pinning.

- [ ] **Step 4: Verify workflow contracts and image contents**

```bash
node --test scripts/ci/workflow-contract.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/release/fork-tag.test.mjs scripts/release/recovery-manifest.test.mjs scripts/security/trivy-policy.test.mjs
docker buildx build --load --platform linux/amd64 -f docker/Dockerfile.tts-heavy -t subwave-tts-heavy-cpu:test .
docker buildx build --load --platform linux/amd64 -f docker/Dockerfile.tts-heavy --build-arg CHATTERBOX_TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124 -t subwave-tts-heavy-cuda:test .
docker run --rm --entrypoint /opt/chatterbox/venv/bin/python subwave-tts-heavy-cpu:test -c 'import torch; assert torch.version.cuda is None'
docker run --rm --entrypoint /opt/chatterbox/venv/bin/python subwave-tts-heavy-cuda:test -c 'import torch; assert torch.version.cuda is not None; print(torch.version.cuda)'
```

Expected: contracts pass; both disposable images build; only the CUDA image reports a compiled CUDA runtime. Do not require a physical GPU on the development host.

- [ ] **Step 5: Scan the exact local CUDA image and reconcile policy narrowly**

Run the repository-pinned Trivy image against `subwave-tts-heavy-cuda:test` through the Docker socket and save JSON in an ignored evidence directory:

```bash
mkdir -p .tmp/tts-cuda-policy
SCANNER_IMAGE="$(node -e "const fs=require('node:fs'); process.stdout.write(JSON.parse(fs.readFileSync('security/trivy-scanner.json','utf8')).imageRef)")"
docker run --rm --volume /var/run/docker.sock:/var/run/docker.sock --volume "$PWD/.tmp/tts-cuda-policy:/evidence" "$SCANNER_IMAGE" image --scanners vuln --severity HIGH,CRITICAL --format json --output /evidence/subwave-tts-heavy-cuda.json subwave-tts-heavy-cuda:test
```

Compare every HIGH/CRITICAL tuple `(vulnerabilityId, package, installedVersion)` with the current CPU `subwave-tts-heavy` report/acceptance. Extend an existing acceptance's `images` only when the CUDA finding has the exact same tuple and justification; create no acceptance for a CUDA-only finding without its own disposition, owner, approval date, expiry, and tracking evidence. Run the focused policy tests after updating fixtures and expectations from ten to eleven images.

```bash
node --test scripts/security/trivy-policy.test.mjs
node --test scripts/ci/workflow-contract.test.mjs
```

Expected: the eleven-image policy contract passes with no broadened package/version scope and no orphaned acceptance in the exact replay fixture.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/publish-images.yml .github/workflows/scan-images.yml scripts/ci/workflow-contract.test.mjs scripts/security/trivy-policy.mjs scripts/security/trivy-policy.test.mjs security/trivy-acceptance.json
git commit -m "feat: publish CUDA chatterbox image"
```

---

### Task 3: Ark Default-On, Fail-Closed Topology

**Files:**
- Modify: `deploy/portainer/docker-compose.yml`
- Modify: `scripts/ci/validate-portainer-compose.mjs`
- Modify: `scripts/ci/validate-portainer-compose.test.mjs`
- Modify: `docs/gpu-tts.md`

**Interfaces:**
- Selects `subwave-tts-heavy-cuda:${SUBWAVE_VERSION}` only in ark's manifest.
- Starts both engines and refuses to bind HTTP without visible CUDA.
- Preserves state/cache volumes, memory limit, logging, and no-host-port policy.

- [ ] **Step 1: Write failing Portainer contracts**

Require the CUDA image, absence of the old profile gate, and these exact markers:

```yaml
command:
  - /bin/sh
  - -c
  - >-
    /opt/chatterbox/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" &&
    exec uvicorn server:app --host 0.0.0.0 --port 8080
environment:
  TTS_HEAVY_DEVICE: cuda
  TTS_HEAVY_ENGINES: chatterbox,pocket-tts
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

Add rejection cases for CPU image, missing startup gate, CPU device, missing engine, GPU reservation removal, and reintroduced profile gating.

- [ ] **Step 2: Preserve RED**

Run `node --test scripts/ci/validate-portainer-compose.test.mjs`.

Expected: current CPU/profiled manifest violates the new requirements.

- [ ] **Step 3: Update validator and ark manifest**

Change the expected image and source requirements in the validator. In the manifest remove `profiles`, use the CUDA image, add the startup gate and NVIDIA reservation, and use mapping-form environment values:

```yaml
environment:
  TTS_HEAVY_DEVICE: cuda
  TTS_HEAVY_ENGINES: chatterbox,pocket-tts
  POCKET_TTS_VOICE: ${POCKET_TTS_VOICE:-alba}
  HF_TOKEN: ${HF_TOKEN:-}
```

- [ ] **Step 4: Render and verify production Compose**

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
trap 'rm -f deploy/portainer/stack.env' EXIT
: > deploy/portainer/stack.env
SUBWAVE_VERSION=v1.7.0-obiwave.2 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
SUBWAVE_VERSION=v1.7.0-obiwave.2 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
```

Expected: all commands pass; rendered sidecar has no ports and retains all cache/state mounts.

- [ ] **Step 5: Document and commit**

Document that ark uses the published CUDA image automatically, both engines load, and only `HF_TOKEN` is optional. Preserve the existing local GPU-overlay instructions.

```bash
git add deploy/portainer/docker-compose.yml scripts/ci/validate-portainer-compose.mjs scripts/ci/validate-portainer-compose.test.mjs docs/gpu-tts.md
git commit -m "feat: run CUDA chatterbox on ark"
```

---

### Task 4: Full Gates, Review, and Merge

**Files:**
- Verify all changed files; modify only defects found by tests or review.

**Interfaces:**
- Produces an exact reviewed PR head eligible for release.

- [ ] **Step 1: Run locked installs, generation, package, and contract gates**

```bash
npm ci
npm --prefix controller ci && npm --prefix web ci && npm --prefix mcp-subwave ci && npm --prefix cli ci && npm --prefix app ci
npm --prefix controller run gen:themes && npm --prefix controller run gen:schemas
git diff --exit-code -- controller/src/themes.generated.ts web/lib/themes.generated.ts web/lib/schemas.generated.ts
npm --prefix controller run lint && npm --prefix controller test
npm --prefix web run lint
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:mounted-state
npm --prefix web run test:async-generation
npm --prefix web run test:managed-key-probe
npm --prefix web run test:model-discovery-request
npm --prefix web run test:admin-navigation-schedule
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run test:search-provider
npm --prefix web run build
npm --prefix mcp-subwave run lint && npm --prefix cli run typecheck
npm --prefix app run lint && npm --prefix app run typecheck
npm --prefix app run test:stream-buffer-format && npm --prefix app run test:station-credentials
node --test scripts/ci/*.test.mjs scripts/release/*.test.mjs scripts/security/*.test.mjs scripts/deploy/*.test.mjs
```

Expected: every command exits 0; warnings are distinguished from failures.

- [ ] **Step 2: Review exact branch scope**

```bash
git diff --check origin/develop...HEAD
git log --oneline origin/develop..HEAD
git diff --stat origin/develop...HEAD
git status --short
```

Check for CPU-default drift, mutable tags, missing scan entries, secrets, host ports, destructive volume changes, and rollback regressions. Fix any defect with a focused RED/GREEN test and separate commit.

- [ ] **Step 3: Push, open ready PR, and wait for all gates**

```bash
git push -u origin feat/tts-heavy-cuda
gh pr create --base develop --head feat/tts-heavy-cuda --title "feat: ship CUDA chatterbox sidecar" --body-file docs/superpowers/specs/2026-08-11-tts-heavy-cuda-image-design.md
```

Require exact head identity, zero requested changes/unresolved threads, and every required check green.

- [ ] **Step 4: Merge by exact reviewed SHA**

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
PR_HEAD="$(git rev-parse HEAD)"
gh pr merge "$PR_NUMBER" --merge --match-head-commit "$PR_HEAD" --delete-branch
```

Verify the merge commit parents are the prior develop SHA and exact PR head.

---

### Task 5: Release, Deploy, and Production Proof

**Files:**
- No source edits during normal release progression.
- If policy fails, use a separately reviewed immutable recovery; never overwrite `.2`.

**Interfaces:**
- Produces `v1.7.0-obiwave.2` and a verified CUDA Chatterbox runtime on ark.

- [ ] **Step 1: Prove eligibility and dispatch the release**

```bash
git fetch origin develop --tags
MERGED_SHA="$(git rev-parse origin/develop)"
git merge-base --is-ancestor v1.7.0 "$MERGED_SHA"
test "$(git ls-remote --tags origin refs/tags/v1.7.0-obiwave.2)" = ""
gh workflow run cut-fork-release.yml --repo ObiWanCanOweMe/obiwave -f version=1.7.0 -f revision=2 -f target="$MERGED_SHA"
```

Verify the created tag and release target `MERGED_SHA` exactly.

- [ ] **Step 2: Monitor publication and policy continuously**

Require release validation, all eleven tag-preflights, every build/mirror, eleven digest-qualified scans, zero unaccepted policy findings, and no deploy start before policy success. Stop on any failure. Preserve exact reports for a reviewed recovery rather than rerunning or altering tags.

- [ ] **Step 3: Verify Portainer deployment and CUDA identity**

After protected deploy success, run read-only checks:

```bash
ssh ark 'docker inspect sub-wave-tts-heavy --format "{{.Config.Image}}"'
ssh ark 'docker exec sub-wave-tts-heavy /opt/chatterbox/venv/bin/python -c '\''import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))'\'''
ssh ark 'docker exec sub-wave-tts-heavy python -c '\''import json,urllib.request; d=json.load(urllib.request.urlopen("http://127.0.0.1:8080/health")); assert d["chatterbox_loaded"] and d["pocket_loaded"] and d["chatterbox_device"] == "cuda"; print(json.dumps(d, sort_keys=True))'\'''
ssh ark 'docker logs sub-wave-tts-heavy 2>&1 | tail -200'
```

Expected: exact `.2` CUDA image, RTX 2000 Ada visible, both engines ready, CUDA attested, no fallback warning.

- [ ] **Step 4: Prove both synthesis paths**

Exercise the internal sidecar API from its own container, using two exact disposable state paths:

```bash
ssh ark 'docker exec sub-wave-tts-heavy python -c '\''import json,urllib.request; requests=[{"engine":"chatterbox","text":"SUB/WAVE CUDA acceptance check.","voice":"","reference_wav":"","out":"/var/sub-wave/voice/v1.7.0-obiwave.2-chatterbox-check.wav"},{"engine":"pocket-tts","text":"SUB/WAVE Pocket TTS acceptance check.","voice":"alba","reference_wav":"","out":"/var/sub-wave/voice/v1.7.0-obiwave.2-pocket-check.wav"}]; [print(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8080/speak",data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})).read().decode()) for body in requests]'\'''
ssh ark 'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /mnt/NVMe/container-data/subwave/state/voice/v1.7.0-obiwave.2-chatterbox-check.wav && ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /mnt/NVMe/container-data/subwave/state/voice/v1.7.0-obiwave.2-pocket-check.wav'
```

Require two successful JSON responses and two positive durations. Recheck the health/log device attestation after synthesis. Then delete only those two exact disposable WAVs after evidence is captured.

- [ ] **Step 5: Verify the live station and record immutable evidence**

Require fresh public health/now-playing success plus a bounded HTTP 200 `audio/mpeg` sample that `ffmpeg` decodes with non-silent levels. Record merge/tag SHA, eleven digests, workflow URLs, Trivy totals, deployment result, GPU identity, both synthesis results, and audio evidence. Leave no temporary credentials and finish with a clean worktree.
