# Portainer Release Tag Rendering Design

**Date:** 2026-07-15

## Problem

The checked-in Portainer Compose manifest requires `SUBWAVE_VERSION` during
Compose interpolation. The release client currently adds that variable to the
same Portainer update request that introduces the manifest. On an unseeded
placeholder stack, Portainer 2.39.3 can validate the new manifest without the
new variable being available, reject the deployment, and retain the previous
environment. This makes the first release depend on a manual environment seed.

## Decision

Keep `deploy/portainer/docker-compose.yml` variable-based so CI continues to
validate that every fork-owned image is pinned through
`${SUBWAVE_VERSION:?required}`. Before the release client sends the manifest to
Portainer, replace every exact placeholder with the already validated
fork-qualified release tag.

The update payload will still upsert one `SUBWAVE_VERSION` environment entry.
That entry remains useful operator metadata and preserves the existing version
reporting contract, but Compose interpolation will no longer depend on it.

## Data Flow

1. `portainer-release.mjs` validates `SUBWAVE_RELEASE_TAG` with `parseForkTag`.
2. The release client reads the checked-in manifest.
3. A pure renderer replaces every exact `SUBWAVE_VERSION` placeholder with the
   validated tag and rejects a manifest that contains no placeholder or leaves
   one unresolved.
4. `deployWithRollback` sends the rendered manifest and the environment upsert
   in one Portainer update.
5. Rollback continues to restore the exact preceding stack file and environment
   snapshot.

## Failure Handling

Rendering occurs before the first Portainer update. A malformed tag is already
rejected by release validation. A manifest contract error fails locally without
changing production. Existing sanitized Portainer errors, health checks, stream
checks, timeout handling, and rollback behavior remain unchanged.

## Testing

Add a regression test whose starting stack environment does not contain
`SUBWAVE_VERSION`. It must prove that the single target update contains:

- exactly one environment entry with the target tag;
- image references rendered with the target tag; and
- no unresolved `SUBWAVE_VERSION` placeholder.

Add focused renderer tests for a missing placeholder and unresolved placeholder
syntax. Run the complete deployment-client and Portainer Compose contract test
suites after implementation.

## Out of Scope

- Portainer server configuration or upgrades.
- Changes to ark, bender, registry credentials, or persistent state.
- Rebuilding release images solely for this client-side deployment fix.
