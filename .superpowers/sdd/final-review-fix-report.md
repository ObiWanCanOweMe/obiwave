# Final Whole-Branch Review Fix Report

Date: 2026-07-15

## Status

All requested final-review findings were addressed in the
`agent/ark-bundled-caddy` worktree. No connection, reload, deployment, tag,
release, push, or other mutation was made against bender, Portainer, ark, or the
live station.

## Commit

- `808d09c6ff71de68402fe7f878d433c911afd11e` — `fix: harden ark Caddy proxy contract`

## Changes

- `scripts/ci/validate-portainer-compose.test.mjs`
  - Added regression coverage for a quoted service-level `"ports"` key.
  - Added regression coverage for a service-level YAML merge that can inherit
    an anchored `ports` declaration.
  - Added exact bender trusted-proxy environment regressions.
  - Added the generic Caddyfile contract for optional proxy-range expansion and
    strict forwarded-IP parsing.
- `scripts/ci/validate-portainer-compose.mjs`
  - Rejects quoted and unquoted active `ports` keys on every non-Caddy service.
  - Rejects quoted and unquoted service-level merge keys on every non-Caddy
    service as potential hidden publication paths.
  - Requires the exact ark Caddy `TRUSTED_PROXY_RANGES` value while preserving
    the existing exact Caddy binding/cardinality policy.
- `deploy/portainer/docker-compose.yml`
  - Sets `TRUSTED_PROXY_RANGES` to
    `10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128` on Caddy.
- `docker/Caddyfile`
  - Adds optional parse-time `{$TRUSTED_PROXY_RANGES}` expansion to the generic
    static trusted-proxy list.
  - Enables `trusted_proxies_strict` in the same `servers` block.
- `docs/deployment.md`
  - Corrects the ark topology: bender forwards the complete origin to Caddy on
    ark port 7700; only Caddy publishes exact ark IPv4/IPv6 host bindings; Caddy
    owns API, streams, tune-in, and web routing.
  - Documents bender's exact trusted source CIDRs and strict forwarded-IP
    parsing.
- `docs/superpowers/specs/2026-07-15-ark-bundled-caddy-design.md`
  - Records the trusted-proxy decision.
  - Corrects readiness wording: Caddy waits for web to start and for
    controller/broadcast health; public retry probes tolerate the brief web
    startup window.

## TDD Evidence

RED command:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Result before production changes: exit 1, 12 tests total, 8 passed and the 4
new regressions failed for the intended missing behavior:

- quoted non-Caddy `ports` key was not rejected;
- service-level merge injection was not rejected;
- exact bender trusted-proxy ranges were not required;
- generic Caddyfile lacked env expansion and strict parsing.

GREEN command:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Result after the minimal policy/config changes: exit 0, 12/12 passed. The final
fresh rerun also passed 12/12 with no failures.

## Verification

Full deployment contract suite, run once after implementation:

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs
```

Result: exit 0, 52/52 passed, 0 failed.

Manifest policy:

```bash
node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
```

Result: exit 0; `validated deploy/portainer/docker-compose.yml`.

Representative `.3` Compose render:

```bash
trap 'rm -f deploy/portainer/stack.env' EXIT
: > deploy/portainer/stack.env
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
```

Result: exit 0. An initial direct render without the intentionally ignored
Portainer-generated `stack.env` stub failed with the expected missing-file
message; rerunning with the same temporary empty stub used by CI passed.

Caddy adaptation with the optional variable unset:

```bash
docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy adapt --config /etc/caddy/Caddyfile >/dev/null
```

Result: exit 0.

Caddy adaptation with the exact ark value set:

```bash
docker run --rm -e 'TRUSTED_PROXY_RANGES=10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128' -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy adapt --config /etc/caddy/Caddyfile >/dev/null
```

Result: exit 0.

Whitespace validation:

```bash
git diff --check
```

Result: exit 0, no output.

## Self-Review

- Re-read the complete diff against every review requirement.
- Confirmed Caddy remains the only service allowed active host publications and
  that its two approved bindings and exact cardinality checks are unchanged.
- Confirmed existing extension anchors remain valid; only non-Caddy
  service-level merge keys are rejected.
- Confirmed deployment-specific bender addresses exist only in the Portainer
  manifest/docs/tests, not as hardcoded generic Caddyfile addresses.
- Confirmed no web health check was added and readiness wording matches Compose
  behavior.
- Confirmed the worktree contained only the committed requested changes before
  adding this report.

## Concerns

None. The policy intentionally rejects all non-Caddy service-level YAML merges,
which is stricter than inspecting the merged anchor contents and closes the
hidden-publication escape without disturbing the existing top-level anchors.
