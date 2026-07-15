# Ark Caddy Structural Validation Fix Report

Date: 2026-07-15

## Status

Implemented the human-approved structural policy change in the
`ark-fresh-restore` worktree. No push, deployment, release, tag, Portainer
operation, bender connection, or live-system mutation was performed.

## Implementation Commit

- `95bda58d2233cd4726c07ae3ec36d9c0c36aba4e` — `fix: validate resolved Portainer topology`

## Changes

- Exported pure `validateResolvedPortainerCompose(model)` validation.
- Caddy must resolve to exactly two publications:
  - `10.20.0.9:7700 -> 80`
  - `2600:1700:3210:5314:10:20:0:9:7700 -> 80`
- Every resolved non-Caddy service must have zero publications.
- Caddy's resolved `TRUSTED_PROXY_RANGES` must exactly equal
  `10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128`.
- Numeric and string Compose port fields normalize safely before comparison.
- Removed source-regex port, quoted-key, merge-key, wildcard-binding, and source
  trusted-proxy checks superseded by the resolved model.
- Validator CLI now runs
  `docker compose --profile '*' config --format json`, fails closed on command
  failure or invalid JSON, and validates all profiles including `tts-heavy`.
- CI creates and removes the Portainer `stack.env` stub and supplies
  representative required values for structural validation. Its existing
  independent quiet Compose render remains in place.
- Updated the approved design and implementation plan to describe resolved
  structural validation rather than YAML spelling enumeration.
- Restored `.superpowers/sdd/final-review-fix-report.md` byte-for-byte from
  base `9b5bd0f41230906fc97863117b83d4740ab82f4e`, preserving the unrelated
  LiteLLM audit report.

## TDD Evidence

Initial RED command:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Result: exit 1, 16 tests, 12 passed and four intended resolved-policy tests
failed because `validateResolvedPortainerCompose` did not yet exist:

- pure non-Caddy resolved port rejection;
- Docker-rendered `!!str ports:` bypass rejection;
- exact Caddy publication ownership/cardinality;
- exact resolved trusted-proxy value.

During self-review, enabling all profiles exposed that default Compose rendering
omits `tts-heavy`. A second regression was added before the correction.

Profile RED result: exit 1, 11 tests, 10 passed; the profiled service publication
was absent from the default resolved model.

GREEN command:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Result after adding `--profile '*'` to both integration rendering and the CLI:
exit 0, 11/11 passed. Docker-backed fixtures cover tagged, quoted, merged, and
profiled service definitions without reimplementing YAML parsing.

## Verification Evidence

Full deployment contract suite:

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs
```

Result: exit 0, 51/51 passed, 0 failed.

Validator CLI with representative `.3` values:

```bash
trap 'rm -f deploy/portainer/stack.env' EXIT
: > deploy/portainer/stack.env
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
```

Result: exit 0; `validated deploy/portainer/docker-compose.yml`.

Compose quiet and JSON rendering:

```bash
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose --profile '*' -f deploy/portainer/docker-compose.yml config --format json >/dev/null
```

Result: both exit 0.

Caddy adaptation with proxy ranges unset and set:

```bash
docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy adapt --config /etc/caddy/Caddyfile >/dev/null
docker run --rm -e 'TRUSTED_PROXY_RANGES=10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128' -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy adapt --config /etc/caddy/Caddyfile >/dev/null
```

Result: both exit 0.

Workflow YAML parse:

```bash
ruby -e 'require "yaml"; YAML.load_file(ARGV.fetch(0), aliases: true)' .github/workflows/ci.yml
```

Result: exit 0.

Diff and audit restoration:

```bash
git diff --check
test "$(git show 9b5bd0f41230906fc97863117b83d4740ab82f4e:.superpowers/sdd/final-review-fix-report.md | shasum -a 256 | cut -d' ' -f1)" = "$(shasum -a 256 .superpowers/sdd/final-review-fix-report.md | cut -d' ' -f1)"
```

Result: both exit 0.

## Self-Review

- Confirmed publication policy reads only Docker's canonical resolved objects;
  no service-level port or merge-key YAML regex remains.
- Confirmed all profiles are enabled during policy rendering so optional
  services cannot escape inspection.
- Confirmed source checks remain for exact template/source invariants such as
  immutable image expressions and required anchor-based deployment form.
- Confirmed exact Caddy cardinality rejects missing, duplicate, wrong-IP,
  wrong-published-port, wrong-target, and wrong-owner cases.
- Confirmed CLI command failure and JSON parse failure are explicit fatal paths.
- Confirmed the original LiteLLM report matches the requested base exactly.

## Concerns

None.

## TCP Publication Follow-up

Commit:

- `3df9ebdf7a3177080220f7a12fa284870cc46180` — `fix: require TCP Caddy publications`

The normalized resolved-port tuple now includes `protocol`, and both approved
Caddy publications require the exact resolved value `tcp`. A missing protocol
is not defaulted in policy because Docker Compose's resolved JSON emits the
default `tcp`; an absent field is therefore off-contract and rejected.

RED command:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Result before implementation: exit 1, 12 tests, 11 passed and the new
`resolved model requires TCP for both Caddy publications` regression failed.
Both UDP-only and mixed TCP/UDP models were incorrectly accepted because
`protocol` was not part of the normalized tuple.

GREEN command:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Result after the minimal tuple change: exit 0, 12/12 passed.

Full deployment contract command:

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs
```

Result: exit 0, 52/52 passed, 0 failed. `git diff --check` also exited 0 with
no output.
