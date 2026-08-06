# Integrate Upstream SUB/WAVE v1.5.0 Design

## Objective

Integrate the complete upstream SUB/WAVE `v1.4.0` and `v1.5.0` release line into ObiWave, preserving fork-specific behavior and shipping only one downstream release: `v1.5.0-obiwave.1`.

The work starts from ObiWave `origin/develop` commit `0bb2aecc5a6d4fefe65fe67410887d57df700bbe`. The approved upstream identities are:

- `v1.4.0`: `01663b547feaf0987fd8bad8c1c8c374b8781c76`
- `v1.5.0`: `8c01e979ebeea5c5ed6cac6658b5da14322b9d6d`

Upstream `v1.4.0` is an ancestor of `v1.5.0`. The cumulative upstream delta from the fork's `v1.3.0` merge base contains 39 commits: 10 through v1.4.0 and another 29 through v1.5.0.

## Integration Structure

Use one branch and one cumulative pull request with two explicit merge checkpoints.

1. Merge exact upstream tag `v1.4.0` into the integration branch with a dedicated merge commit.
2. Resolve and verify that checkpoint without creating a fork release, tag, image, or deployment.
3. Merge exact upstream tag `v1.5.0` into the same branch with a second dedicated merge commit.
4. Resolve and verify the cumulative result.
5. Open one pull request to `develop` containing both checkpoints.
6. After review, green CI, and merge, cut only `v1.5.0-obiwave.1`.

This structure keeps upstream ancestry intact, limits the second conflict wave to the v1.4.0-to-v1.5.0 delta, and provides a reviewable midpoint without leaving `develop` on an unreleased intermediate version.

## Conflict Policy

Every conflict is classified before resolution.

### Upstream replaces superseded behavior

Prefer upstream when it supplies the same behavior through a newer implementation, module boundary, type, lifecycle, or UI. Do not retain obsolete fork code merely to minimize textual changes.

### Fork-only behavior remains

Preserve ObiWave behavior that upstream does not replace, including:

- immutable fork release tags and image publication;
- Trivy scanner pinning, vulnerability policy, and reviewed acceptance data;
- Portainer deployment, rollback, and exact analyzer verification;
- the fork's production topology and Caddy listener-auth protection;
- private-station authentication and provider-owned credentials;
- retained multi-format playback and fork-specific native-player behavior;
- existing operational safeguards introduced through `v1.3.0-obiwave.2` recovery work.

### Independent behavior is composed

When upstream and ObiWave changed the same path for independent reasons, retain both behaviors against the upstream v1.5 interfaces. Tests must describe the composed outcome before production behavior is changed.

Ambiguous policy conflicts stop for explicit review. They are not resolved by choosing an entire side wholesale.

## Upstream Behavior in Scope

The v1.4.0 checkpoint includes Cloud TTS picker improvements, an operator-configurable fallback voice, the `/apps` directory, appearance-modal changes, listener-table constraints, and canonical-page behavior.

The v1.5.0 checkpoint includes blocklist rules, show vocal/instrumental steering, openai-compatible TTS generation parameters, platform-specific setup pages, analysis-loop fixes, broadcast starvation and timing fixes, programme grounding, repeat-penalty persistence, Opus mount selection, queue skip consistency, custom skill settings fields, theme contrast, admin caching, and documentation updates.

No v1.4 or v1.5 feature is silently omitted. If an upstream change is intentionally superseded by stronger fork behavior, the pull request records the mapping and its verification evidence.

## State and Migration Handling

No published release requires a manual staged migration through v1.4.0. The v1.5 settings code normalizes absent fallback-TTS, repeat-penalty, and show-vocal fields so pre-v1.4 settings remain valid.

The integration must still verify migration-sensitive areas:

- settings load, normalize, validate, save, and restart persistence;
- library database schema and blocklist-rule storage;
- analyzer completion and retry state;
- Liquidsoap queue starvation and stream mount behavior;
- onboarding and admin forms for new settings.

Existing operator state is never rewritten outside the repository's normal runtime migration paths during development verification.

## Test Strategy

### Baseline

Before merging either upstream tag, install dependencies in the isolated worktree and run the repository's current local CI-equivalent gates. Any pre-existing failure is recorded before integration and is not disguised as an upstream regression.

### v1.4.0 checkpoint

For each behavior conflict, add or adapt a focused behavioral test first and observe it fail for the missing composed outcome. Resolve the implementation minimally, then rerun the focused test.

Before committing the checkpoint, run:

- controller lint/typecheck and its complete scripted test suite;
- web lint/typecheck and mounted-state tests;
- MCP, CLI, and native-app quality gates;
- deployment/workflow contract tests;
- affected Docker image smoke tests;
- `git diff --check` and configuration parsing checks.

### v1.5.0 checkpoint

Repeat test-first conflict resolution for the additional delta. Add focused coverage for blocklist rules, vocal steering, TTS compatibility parameters, settings persistence, analysis completion, programme grounding, queue skip behavior, music-starvation handling, and stream-format gating wherever upstream tests do not already cover the fork-composed result.

Run the complete local gate again. Exercise the dev stack from the integration worktree for controller/admin changes and verify Liquidsoap syntax or startup whenever `radio.liq` changes.

### Pull request gate

The final pull request must receive independent whole-branch review and all GitHub CI checks must pass on the exact reviewed head. Critical and Important findings are fixed and rereviewed before merge.

## Release and Deployment

After the integration pull request merges to `develop`:

1. Confirm upstream tag identities and the exact merge SHA.
2. Confirm `v1.4.0-obiwave.1` does not exist and do not create it.
3. Confirm `v1.5.0-obiwave.1`, its GitHub release, and all ten destination image tags are absent.
4. Dispatch the checked-in fork-release workflow for upstream version `1.5.0`, revision `1`.
5. Require reusable CI, immutable image publication, exact-image Trivy scans, aggregate policy, and the protected production deployment to pass.
6. Do not bypass new findings or overwrite a partial tag. A failed or partial publication stops for review rather than being automatically rerun.

Production verification requires:

- Portainer reports the exact target release and no rollback incident;
- the analyzer container uses the exact release tag, is running and healthy, and has restart count zero;
- `/api/health` returns HTTP 200 with `status: on-air`;
- `/api/now-playing` is populated and reports the stream online;
- `/api/listener-auth` and its trailing-slash form return 404 at the public edge;
- an exact MP3 sample decodes successfully and has a non-silent measured mean volume;
- post-deploy registry inspection confirms every published manifest digest remains immutable.

## Failure Policy

Stop without deployment when any of the following occurs:

- an upstream tag identity differs from the approved commit;
- a conflict cannot be resolved confidently under the three conflict rules;
- a baseline or checkpoint regression remains unexplained;
- independent review has unresolved Critical or Important findings;
- CI, image smoke, vulnerability policy, or production approval fails;
- a target tag or image unexpectedly already exists;
- publication is partial;
- Portainer verification fails or rollback is unverified;
- live health or audio verification fails.

No automatic security acceptance, policy bypass, tag mutation, force-push, or deployment retry is authorized by this design.

## Deliverables

- one cumulative integration pull request with distinct v1.4.0 and v1.5.0 merge checkpoints;
- conflict-resolution evidence and focused regression tests;
- one merged ObiWave integration on `develop`;
- one immutable `v1.5.0-obiwave.1` release and ten-image publication;
- one verified production deployment;
- no `v1.4.0-obiwave.*` release artifact.
