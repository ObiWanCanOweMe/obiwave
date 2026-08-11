# CUDA Chatterbox Sidecar Design

## Goal

Publish a reproducible, vulnerability-scanned CUDA variant of the SUB/WAVE
`tts-heavy` sidecar and deploy it on ark so Chatterbox synthesizes on ark's
NVIDIA RTX 2000 Ada GPU. PocketTTS remains available in the same sidecar and
continues to run on CPU.

The existing `subwave-tts-heavy` image and portable Compose files remain
CPU-first. GPU operation is an ark-specific production choice, not a new
requirement for other SUB/WAVE installations.

## Fixed Production Inputs

- Host: ark, managed by the existing image-only Portainer stack.
- GPU: NVIDIA RTX 2000 Ada Generation, 16 GB, compute capability 8.9.
- Driver: 570.172.08.
- CUDA PyTorch index: `https://download.pytorch.org/whl/cu124`.
- Engines: `chatterbox,pocket-tts`.
- Chatterbox device: `cuda`.
- PocketTTS device: CPU; `TTS_HEAVY_DEVICE` is not forwarded to its worker.
- First release carrying the image: `v1.7.0-obiwave.2`.

## Image Architecture

The release pipeline publishes a new amd64-only image repository:

`ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda:<release-tag>`

It uses the existing `docker/Dockerfile.tts-heavy` and passes
`CHATTERBOX_TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124`. The
Dockerfile's separate Chatterbox and PocketTTS virtual environments preserve
the intended split: CUDA-enabled PyTorch is installed only for Chatterbox,
while PocketTTS retains its CPU dependency set.

The existing `subwave-tts-heavy:<release-tag>` build remains unchanged and
CPU-only. Root `docker-compose.yml`, `docker-compose.byo.yml`, and
`docker-compose.dev.yml` also retain their optional CPU-compatible service and
profile behavior. The existing local GPU overlay remains the source-build path
for operators who do not use the published fork image.

## Ark Runtime Topology

The ark-specific `deploy/portainer/docker-compose.yml` changes its `tts-heavy`
service to:

- use `subwave-tts-heavy-cuda:${SUBWAVE_VERSION}`;
- reserve all NVIDIA GPU devices with the Compose device reservation contract;
- set `TTS_HEAVY_DEVICE=cuda` directly;
- load `TTS_HEAVY_ENGINES=chatterbox,pocket-tts` by default;
- start as part of ark's normal stack rather than requiring the `tts-heavy`
  profile.

The manifest hardcodes the CUDA device choice instead of reading
`TTS_HEAVY_DEVICE` from Portainer. This prevents an existing or omitted
Portainer variable from silently running a CUDA image on CPU. No new Portainer
environment variable is required. `HF_TOKEN` remains optional and affects only
PocketTTS voice-cloning weights.

The controller already uses `http://tts-heavy:8080` and retains Piper as its
failure fallback. No controller routing or speech-dispatch change is needed.

## Publishing and Security Policy

The fork release workflow treats `subwave-tts-heavy-cuda` as a first-class
immutable artifact:

1. Tag preflight proves its exact release tag is absent before any image is
   pushed.
2. The build matrix publishes the amd64 CUDA image with release/version OCI
   labels and records its digest.
3. The vulnerability scan matrix scans that exact tag and reports a distinct
   SARIF category.
4. The aggregate Trivy policy must accept every finding before production can
   deploy.
5. Workflow and Portainer contract tests require the new image, build args,
   scan entry, GPU reservation, and hardcoded CUDA device.

The existing immutable-tag rule remains unchanged: a failed `.2` publication
is recovered using digest-qualified recovery, never by overwriting an image
tag.

## Deployment and Rollback

After the implementation PR merges to `develop`, the normal fork release
constructor cuts `v1.7.0-obiwave.2`. The tag-triggered workflow builds and
scans all release artifacts, then updates the Portainer stack to `.2` only
after policy success.

The `.2` Portainer manifest starts the CUDA sidecar automatically. The
deployment verifier must prove the service uses its release digest and that
Chatterbox actually loaded CUDA before declaring the rollout successful.

If the Portainer update or any production acceptance check fails, the existing
deployer restores the previous stack snapshot and `SUBWAVE_VERSION`, returning
production to `v1.7.0-obiwave.1`. That release did not run the heavy sidecar, so
rollback also removes the newly introduced runtime dependency. Persistent
Hugging Face cache volumes are retained and are not destructive.

## Verification

Local and CI verification must cover:

- Dockerfile/image smoke tests for both CPU and CUDA image matrix entries;
- workflow contract tests for preflight, build, scan, and deploy dependencies;
- Portainer source and rendered-manifest validation;
- confirmation that portable Compose files still default to the CPU image;
- release/security contract suites and exact Trivy policy replay;
- a CUDA container probe showing `torch.cuda.is_available()` is true and the
  visible device is ark's NVIDIA GPU;
- sidecar health showing both `chatterbox` and `pocket-tts` ready;
- a real Chatterbox request producing a non-empty decodable WAV while logs show
  `loading ChatterboxTurboTTS on device=cuda` and no CPU fallback warning;
- a PocketTTS request producing a non-empty decodable WAV;
- controller-to-sidecar TTS preview through the supported admin/API path;
- post-deploy public health, now-playing, stream transport, and decoded audible
  MP3 checks.

Production acceptance is fail-closed for CUDA identity: a healthy HTTP sidecar
that fell back to CPU is not a successful GPU rollout.

## Operational Behavior

The first start may download multi-gigabyte model weights. The named
Chatterbox and PocketTTS cache volumes remain mounted, so subsequent container
recreates reuse the weights. The existing 10 GB host-memory limit remains an
OOM boundary for CPU memory; GPU allocation failures are contained to the
sidecar, whose worker supervisor retries while the controller falls back to
Piper.

Operators do not need to add or modify Portainer variables for the base
deployment. They may add `HF_TOKEN` later if they want PocketTTS voice cloning.

## Non-Goals

- GPU-enabling PocketTTS.
- Making NVIDIA hardware mandatory for portable SUB/WAVE deployments.
- Replacing the existing CPU `subwave-tts-heavy` image.
- Mutating `v1.7.0-obiwave.1` or any image already published under that tag.
- Changing TTS selection, persona configuration, or controller fallback logic.
- Sharing the GPU concurrently with a new analyzer design; the existing ark
  analyzer topology is preserved.
