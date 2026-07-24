# Task 7 report — final documentation, generated assets, deployment renders, and overlap audit

## Status and immutable merge state

Task 7 finalizes the active v0.47.0 merge without committing it.

- `HEAD`: `e4fe19f67bfe9698afa5b78f6fc98a46a45cb01e`
- `MERGE_HEAD`: `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`
- Fork comparison base: `dde3f45de28c7ae75c216981c7359c534c259d7c`
- Upstream comparison base/tag range: `v0.46.0..v0.47.0`
- Remaining unmerged paths: none

No commit, merge completion, abort, reset, push, PR, deployment, container
start, publication, tag, release, or Odin mutation was performed.

## Active documentation finalization

`CLAUDE.md` remains upstream-first and now explicitly documents the
`/admin/stations` owner, live-profile Navidrome settings, roster table/list
views, and the `ThemeProvider` bootstrap boundary. Its existing upstream
multi-station, vocal-tail, pair-drain, stem-blend, active-state, loading/error,
and accessibility guidance remains intact.

The fork invariants remain explicit: authenticated MP3/Opus/AAC/FLAC playback,
station-scoped credentials, measured web lag with per-format fallback,
provider-owned URLs/keys, settings-response secrecy, the single shared
Icecast renderer, exact-tag fork releases, and image-only Portainer
deployment. The analyzer guidance distinguishes the fork-published lean/heavy
CPU images from the upstream-owned
`ghcr.io/perminder-klair/subwave-analyzer-cuda`; the fork workflow must never
build or publish the CUDA image.

`.env.example`, `README.md`, and upstream `docs/multi-station.md` were reviewed
as active operator surfaces. The dedicated obsolete handoff plan/design stay
deleted. All other fork planning and design records remain immutable history.

## URL-handoff removal contract and deterministic generation

The absence contract was strengthened before regeneration by adding
`cli/src/assets.generated.ts` to its active surface list. The required RED run
failed only on that generated asset, which still contained
`ANALYZE_HANDOFF` and stale URL-mode guidance; the implementation/deletion
test remained green.

`cli/src/assets.generated.ts` was removed, regenerated from the six resolved
embedded sources, staged, then regenerated a second time:

- first hash: `b8f8d02d28e6d957e0b3674f31740bff86a4d1cb`
- second hash: `b8f8d02d28e6d957e0b3674f31740bff86a4d1cb`
- second-run working-tree diff: none
- embedded CLI version: `0.47.0`

The strengthened absence contract then passed its two removal tests, proving
the removed surface is absent from the generated CLI asset as well as runtime,
configuration, Compose, active documentation, helper/test files, and the two
dedicated documents; the history-retention regression below later expanded
the file to three tests.

`web/lib/theme-tokens.generated.ts` was generated and staged, then generated
a second time:

- first hash: `bdb4a1aaeb57b0eefae43e3733a01ad60538822b`
- second hash: `bdb4a1aaeb57b0eefae43e3733a01ad60538822b`
- second-run working-tree diff: none

The theme mirror already matched `HEAD`, so deterministic regeneration
correctly produced no staged theme-token delta.

## Semantic-review correction — historical design retention

Semantic review found that the staged merge had accepted upstream's deletion
of 14 unrelated fork design specs in addition to the two approved handoff
documents. The upstream delta deletes those 14 specs, the fork delta deletes
none of them, and every one remained present in `HEAD`; accepting the upstream
cleanup therefore violated the approved design's explicit history-retention
exception.

Before restoration, the absence contract gained a third test enumerating all
14 retained specs. The RED run passed the two handoff tests and failed on
`docs/superpowers/specs/2026-07-16-dj-beds-design.md`, proving the regression
detected the review finding.

Only the 14 unrelated staged deletion patches were reversed from `HEAD`.
Every restored working-tree blob and index blob was then compared to its
`HEAD` blob and all 14 matched byte-for-byte. The GREEN run passed all three
tests. The exact remaining staged deletion set under `docs/superpowers` is:

- `docs/superpowers/plans/2026-07-07-remote-analyzer-url-handoff.md`
- `docs/superpowers/specs/2026-07-07-remote-analyzer-url-handoff-design.md`

The exact 22-path both-sides intersection is unchanged because the 14
corrected specs are upstream-only deletions rather than both-sides paths.

## Compose render evidence

An ignored root `.env` containing only `ADMIN_USER=ci`, `ADMIN_PASS=ci`, and
`SITE_URL=https://radio.example.test` was created and deleted exclusively
with `apply_patch`.

The Portainer manifest intentionally consumes Portainer's generated
`deploy/portainer/stack.env` through a service-level `env_file`; a root
Compose `.env` cannot satisfy that file reference. The first Portainer render
therefore failed closed with the expected missing-`stack.env` error while the
other four shapes passed. The root `.env` was immediately patch-deleted.

For the complete rerun, both the required root `.env` and a temporary
Portainer-equivalent `deploy/portainer/stack.env` with the same three
non-secret CI values were created and deleted exclusively with `apply_patch`.
The five no-start renders then produced:

- default bundled-Caddy Compose: exit 0
- BYO proxy Compose: exit 0
- development Compose: exit 0
- Portainer with `SUBWAVE_VERSION=v0.47.0-obiwave.1`: exit 0
- default plus GPU overlay with `SUBWAVE_VERSION=v0.47.0`: exit 0

Neither `.env` nor `deploy/portainer/stack.env` exists after rendering, and no
container-start command was run.

## Exact 22-path both-sides audit

The intersection of the sorted fork and upstream path deltas contains exactly
22 paths. The final working-tree relation is one upstream-exact path and 21
intentional compositions. Each numbered entry below is one concrete
composition sentence for exactly one path:

1. `.gitignore` combines the fork's ignored `.worktrees/` directory with upstream's new ignored Python `__pycache__/` directories.
2. `CLAUDE.md` adopts upstream multi-station, vocal/stem, Navidrome, admin, accessibility, and theme guidance while retaining the fork player/auth/provider/renderer/release invariants and upstream-only CUDA ownership.
3. `cli/src/assets.generated.ts` is regenerated from the resolved fork Compose/environment sources plus upstream v0.47 overlays so CLI scaffolds retain fork deployment behavior without any URL-handoff residue.
4. `controller/scripts/analyze_worker.py` adopts upstream tail-vocal detection, shared stem caching, and transition rendering while retaining the fork's multichannel Demucs input normalization.
5. `controller/scripts/llm-pure.test.ts` adds upstream intro-budget coverage on top of the fork's provider, retry, budget, and strategy contract set.
6. `controller/src/config.ts` takes upstream active-station state resolution exactly, fully replacing the fork's obsolete analyzer-handoff configuration while preserving all still-supported environment fields through upstream-equivalent definitions.
7. `controller/src/music/analyze.ts` adopts upstream shared-volume stem/tail persistence while retaining the fork quiet-gate rule that the first download cannot begin until quiet work is permitted.
8. `controller/src/routes/onboarding.ts` adopts upstream Navidrome ping/live-config handling while retaining LiteLLM resolution and provider-scoped onboarding behavior.
9. `controller/src/routes/public.ts` adds upstream boot-frozen active-station identity to the fork public state surface without weakening private-station or per-format stream metadata.
10. `controller/src/routes/settings.ts` adds upstream Navidrome test/save routes while retaining the fork admin gate, redaction behavior, and `publicUpdateResult()` response boundary.
11. `controller/src/settings.ts` adds upstream station, transition, stem-cache, theme, and Navidrome settings while retaining LiteLLM, strict-request, bounded-buffer, provider-owned URL/key, and settings-response secrecy contracts.
12. `docker/aio/supervisor.sh` adopts upstream active-station resolution and pair restart lifecycle while retaining exactly one call to the fork shared Icecast renderer with the AIO loopback auth callback.
13. `docker/broadcast-entrypoint.sh` adopts upstream active-station boot resolution and paired process lifecycle while retaining exactly one call to the fork shared Icecast renderer with the controller-service auth callback.
14. `web/app/globals.css` adopts upstream sidebar, scrollbar, loading, roster, and skin-transition styles while retaining the fork contained-player rail sizing.
15. `web/components/admin/AdminShell.tsx` adopts the upstream station navigation and shell architecture while preserving the fork result modulo its intentionally harmless final blank-line composition.
16. `web/components/admin/SettingsPanel.tsx` adopts upstream Navidrome section placement while retaining hydration of the fork's strict-request setting.
17. `web/components/admin/settings/LlmSection.tsx` adopts upstream accessibility refinements while retaining LiteLLM, provider-owned URLs/keys, leg-specific model discovery, and stale-result suppression.
18. `web/components/admin/settings/shared.tsx` adopts upstream accessible required-field semantics while retaining the fork form-value contract.
19. `web/components/onboarding/steps.tsx` adopts upstream accessibility labels and state cues while retaining provider-scoped onboarding state plus LiteLLM discovery/test safeguards.
20. `web/components/player/PlayerShell.tsx` adopts upstream shell presentation changes while retaining the fork callback-ref audio lifecycle and station-auth presentation.
21. `web/components/player/StationGate.tsx` adopts upstream accessibility text refinements while retaining station-scoped credentials and fail-closed auth reset across station changes.
22. `web/package.json` adopts the upstream package version while retaining all six fork audio/auth/provider behavior scripts.

## Workflows, CI, Portainer, images, and release audit

Upstream `v0.46.0..v0.47.0` changes no path under `.github/workflows`,
`scripts/ci`, or `deploy/portainer`, so the fork's consolidated/reusable CI,
immutable exact-tag image preflight, scans, rollback-aware Portainer release,
fork release creation, and CLI-publication separation remain authoritative.
Task 3's only active additions in these surfaces are Portainer's removal of
handoff environment/guidance and the repository absence contract.

The focused workflow/release/Portainer matrix passed 59 tests with zero
failures. It proves, among other boundaries:

- fork publication deliberately excludes `subwave-analyzer-cuda`;
- all nine fork image tags pass immutable preflight before any build;
- publication waits for reusable CI, authenticated scans, and bounded deploy;
- Portainer requires exact `ghcr.io/obiwancanoweme` first-party images and
  rejects the upstream namespace;
- exact fork-qualified release parsing, image-tag absence, deployment,
  probing, timeout, rollback, and environment-preservation contracts hold.

The only active runtime CUDA image reference is the GPU overlay's
`ghcr.io/perminder-klair/subwave-analyzer-cuda:${SUBWAVE_VERSION:-latest}`.
The Portainer stack continues to use fork-qualified images and the fork
publisher continues to build the existing CPU image matrix only.

## Removal, merge, marker, whitespace, and staging gates

The final post-correction gate sequence passed:

- analyzer-handoff/history-retention contract: 3 tests passed, 0 failed
- staged `docs/superpowers` deletion set: exactly the two approved handoff docs
- unmerged name list: empty
- unmerged index entries: empty
- repository conflict-marker scan: empty
- unstaged whitespace check: clean
- staged whitespace check: clean
- root `.env`: absent
- temporary Portainer `stack.env`: absent
- unstaged changes: none
- untracked files: none

The complete merge is staged with `git add -A`; `git diff --exit-code` exits
0 and porcelain-v2 contains only index records. The corrected staged summary
is 162 paths, 17,672 insertions, and 1,059 deletions.

## Review source and applicability proof

The full live staged diff is the Task 7 semantic-review source. A separate
`.superpowers/sdd/task-7-review.diff` is intentionally not materialized
because including the report/review artifact in an exact complete staged
patch creates a self-referential package; reviewers should run:

```text
git diff --cached -U0 HEAD
```

against the live index.

Applicability of that exact live stream was proved in both directions:

```text
git diff --cached -U0 HEAD |
  git apply --cached --check --reverse --unidiff-zero -
```

passed against the current staged index, and the same stream passed forward
`git apply --cached --check --unidiff-zero -` against a temporary index
initialized with `git read-tree HEAD`.

Because placing the full live diff's hash inside this staged report changes
that diff recursively, the stable material-review hash excludes only
`.superpowers/sdd` session artifacts while covering every repository source,
test, generated asset, documentation, workflow, and deployment change:

```text
835699b91470d4d9923c8dc8fdd452c501118c3f4885ac8ea32e73488937412a
```

The complete live staged-diff hash, including this report, is recalculated
after final staging and supplied in the Task 7 handoff.

## Concerns

The Important historical-document deletion finding is corrected and
regression-covered. The sole remaining plan nuance is that the checked-in
Portainer manifest intentionally requires Portainer's generated `stack.env`,
so a standalone local render needs that temporary equivalent in addition to
the plan's root `.env`; both were handled through `apply_patch` and guaranteed
absent afterward.
