# Ark Bundled Caddy Design

**Date:** 2026-07-15

## Goal

Make the Portainer-managed SUB/WAVE stack on ark compatible with the existing
bender reverse proxy without changing bender. The public origin must serve the
web application, controller API, and Icecast streams through the single ark
upstream that bender already uses.

This design supersedes the BYO-proxy runtime topology in
`2026-07-14-portainer-release-cicd-design.md`. The release, persistence,
verification, and rollback decisions in that design remain unchanged.

## Evidence

The `v0.42.0-obiwave.2` retry proved that Portainer could pull the public GHCR
images and deploy the target stack. Public verification then returned the
Next.js 404 page for both `/api/health` and `/stream.mp3`. The checked-in
Portainer manifest sends web, controller, and broadcast to separate ark ports,
while bender sends the whole `radio.kener.org` origin to ark port 7700.

The target deployment was therefore healthy enough to start, but its edge
topology did not match the existing public route. The deployment workflow
correctly rejected it and restored the placeholder stack.

## Runtime Architecture

The Portainer stack will include the fork-owned `subwave-caddy` image at the
same immutable `SUBWAVE_VERSION` as the other first-party images. Caddy will be
the only service with host port bindings:

```text
10.20.0.9:7700 -> caddy:80
[2600:1700:3210:5314:10:20:0:9]:7700 -> caddy:80
```

Web, controller, broadcast, analyzer, and the Docker socket proxy remain on the
internal Compose network with no host port publications. Caddy uses the
project's existing route contract:

- `/stream.mp3`, `/stream.opus`, `/stream.flac`, and `/stream.aac` proxy to
  `broadcast:7702` with response buffering disabled;
- `/api/*` proxies to `controller:7701` with the `/api` prefix stripped;
- `/listen.pls` and `/listen.m3u` proxy to the controller without stripping;
- all other requests proxy to `web:7700`.

Bender continues terminating public TLS and forwarding the complete origin to
ark port 7700. No bender configuration, reload, or connection is part of this
change.

The generic Caddyfile keeps deployment-specific proxy addresses out of the
image by expanding optional `TRUSTED_PROXY_RANGES` alongside its static trusted
proxy list. The ark manifest sets that variable to bender's exact source CIDRs,
`10.20.0.14/32` and `2600:1700:3210:5314:10:20:0:14/128`, and enables strict
forwarded-IP parsing so client addresses are accepted only through the trusted
proxy chain.

## Startup and Failure Behavior

Caddy waits for web to start and for controller and broadcast to pass their
container health checks. Web does not expose a container health check, so a
brief startup window can remain after Caddy starts; the release workflow's
retrying public probes tolerate that window. Caddy uses its existing named data
and config volumes; durable station state remains exclusively under
`/mnt/NVMe/container-data/subwave/state`.

The release workflow continues probing the public bender path. A failed target
still restores the exact previous stack snapshot. The placeholder is not an
on-air application, so rollback verification can remain unverified during this
first migration; once the first real release succeeds, later rollbacks will
have a healthy preceding version to verify.

## CI Contract

Deployment-contract tests render `docker compose --profile '*' config --format json` and
apply runtime topology policy to that resolved model, so YAML tags, quoted keys,
and merges cannot bypass publication checks. Source-text checks remain only for
template-form requirements such as exact immutable image expressions. The
resolved contract will require:

- the Portainer manifest to contain the immutable fork-owned Caddy image;
- only Caddy to publish host ports;
- Caddy to bind port 7700 to ark's required IPv4 and IPv6 addresses;
- the Caddy environment to trust bender's exact IPv4 and IPv6 source CIDRs;
- the generic Caddyfile to expand optional trusted proxy ranges and use strict
  forwarded-IP parsing;
- web, controller, and broadcast to have no host port bindings;
- the checked-in manifest to render successfully with representative values.

Existing tests that encode the superseded three-port BYO topology will be
updated rather than weakened.

## Release Plan

The change lands on `develop` through a pull request. After merge, a new
fork-qualified tag is required because the immutable `.2` tag contains the old
Portainer manifest. The next release is `v0.42.0-obiwave.3`; it publishes the
same service set from the corrected tagged commit and deploys through the
existing protected production environment.

## Success Criteria

- Portainer deploys the complete image-only stack without a checkout on ark.
- Only `10.20.0.9:7700` and
  `[2600:1700:3210:5314:10:20:0:9]:7700` are published by SUB/WAVE.
- Bender is unchanged.
- `https://radio.kener.org/api/health` reports `on-air`.
- `https://radio.kener.org/stream.mp3` returns `audio/mpeg` and delivers bytes.
- A subsequent Portainer redeploy retains state in
  `/mnt/NVMe/container-data/subwave/state`.

## Non-goals

- Moving TLS termination from bender to ark.
- Publishing controller or Icecast directly on ark host ports.
- Changing application behavior, backup contents, or onboarding.
- Reusing or moving the immutable `.2` tag.
