# Portainer CUDA Analyzer Design

## Goal

Run Ark's split-stack analyzer on its NVIDIA GPU using the CUDA analyzer image
published by upstream SUB/WAVE. ObiWave will mirror that exact upstream image
under each immutable fork release tag without rebuilding it.

## Image and version ownership

The Portainer analyzer service will use:

```text
ghcr.io/obiwancanoweme/subwave-analyzer-cuda:${SUBWAVE_VERSION:?required}
```

The image bytes and build remain upstream-owned. ObiWave owns only the mirrored
registry reference used to make the complete Portainer stack share one release
tag. `UPSTREAM_ANALYZER_VERSION` is removed; the release renderer treats the
analyzer like the other exact `${SUBWAVE_VERSION:?required}` image references.
A floating `latest` tag is not published or consumed.

## Release-time mirror

For a fork release such as `v1.0.0-obiwave.1`, the release workflow derives
the upstream base version `1.0.0` from the already validated fork tag. It then:

1. verifies that
   `ghcr.io/perminder-klair/subwave-analyzer-cuda:1.0.0` exists;
2. verifies that
   `ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.0.0-obiwave.1` does not
   exist;
3. copies the complete OCI image or index directly between registries without
   rebuilding or loading it into the runner's Docker engine;
4. requires the destination's top-level OCI digest to equal the source digest
   and records both; and
5. makes image scanning and production deployment depend on the completed
   mirror.

The destination tag is immutable under the existing release preflight
contract. A missing source, pre-existing destination, copy failure, digest
verification failure, or scan failure blocks deployment. The mirror job uses
the workflow's scoped package-write credential; Portainer continues using its
existing read-only GHCR registry credential.

The mirrored CUDA image joins the exact-tag preflight and vulnerability scan
sets but not the Docker build matrix. ObiWave therefore cannot accidentally
rebuild or modify upstream's CUDA layers while still applying the same release
and security gates as the images Ark deploys.

## CUDA runtime contract

The analyzer environment will set `ANALYZE_DEVICE=cuda`. This is intentionally
fail-closed: loss of NVIDIA runtime access must be visible instead of silently
moving CLAP and Demucs workloads onto Ark's CPU.

The analyzer service will reserve all available NVIDIA GPUs through the
Compose device-reservation form:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

Ark therefore requires a working NVIDIA driver, NVIDIA Container Toolkit, and
Docker runtime integration before Portainer recreates the service.

## Validation and documentation

Portainer manifest acceptance tests will require:

- the exact ObiWave mirror repository with the standard required release
  version placeholder;
- `ANALYZE_DEVICE=cuda`;
- an NVIDIA device reservation with `count: all` and GPU capability;
- no direct upstream image reference in the Portainer manifest;
- no floating image tags.

The resolved-compose validator will also assert the analyzer's resolved image,
CUDA environment setting, and device reservation. Existing isolation, mount,
memory-limit, and log-rotation requirements remain in force.

The environment example and deployment guide will describe the mirror
ownership boundary, fail-closed behavior, and Ark's NVIDIA runtime
prerequisites. Release documentation will explain how the upstream source tag
is derived, copied, verified, scanned, and deployed. Non-Portainer upstream
compose overlays remain outside this Ark-specific contract.

## Acceptance

The change is accepted when the focused Portainer validator tests pass, the
real manifest passes source and resolved Compose validation, release-client
tests confirm the analyzer receives the same fork-qualified tag as the other
services, workflow tests prove the mirror is preflighted and copied rather than
built, the mirrored image participates in scanning, and the complete deployment
contract suite remains green.
