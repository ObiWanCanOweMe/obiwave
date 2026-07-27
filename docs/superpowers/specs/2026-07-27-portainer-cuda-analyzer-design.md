# Portainer CUDA Analyzer Design

## Goal

Run Ark's split-stack analyzer on its NVIDIA GPU using the CUDA analyzer image
published by upstream SUB/WAVE. ObiWave will not build or publish a duplicate
CUDA analyzer image.

## Image and version ownership

The Portainer analyzer service will use:

```text
ghcr.io/perminder-klair/subwave-analyzer-cuda:${UPSTREAM_ANALYZER_VERSION:?required}
```

`UPSTREAM_ANALYZER_VERSION` is deliberately separate from `SUBWAVE_VERSION`.
The former pins the independently published upstream CUDA image; the latter
continues to identify and release ObiWave-owned images. Ark's initial Portainer
value will be `1.0.0`, matching the verified upstream tag (which does not have
a `v` prefix). A floating `latest` tag is not permitted.

Automated ObiWave releases replace only exact
`${SUBWAVE_VERSION:?required}` placeholders. They preserve
`UPSTREAM_ANALYZER_VERSION` as operator-managed Portainer environment metadata,
so an ObiWave deployment cannot accidentally request a nonexistent upstream
fork-qualified tag.

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

- the exact upstream CUDA analyzer repository with the dedicated required
  version placeholder;
- `ANALYZE_DEVICE=cuda`;
- an NVIDIA device reservation with `count: all` and GPU capability;
- no upstream namespace on any other service;
- no floating image tags.

The resolved-compose validator will also assert the analyzer's resolved image,
CUDA environment setting, and device reservation. Existing isolation, mount,
memory-limit, and log-rotation requirements remain in force.

The environment example and deployment guide will describe the ownership
boundary, the exact initial Portainer value `UPSTREAM_ANALYZER_VERSION=1.0.0`,
the fail-closed behavior, and Ark's NVIDIA runtime prerequisites. The release
documentation will make clear that fork releases do not advance the upstream
analyzer pin.

## Acceptance

The change is accepted when the focused Portainer validator tests pass, the
real manifest passes source and resolved Compose validation with the required
environment supplied, deployment/release client tests confirm the upstream pin
is preserved, and the repository's relevant CI contract tests remain green.
