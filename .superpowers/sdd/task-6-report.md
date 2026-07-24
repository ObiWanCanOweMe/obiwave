# Task 6 report — upstream web/admin adoption with fork player/provider seams

## Status

Task 6 is reconciled in the active v0.47.0 merge. The complete upstream web
delta is present, including station administration, Navidrome settings,
accessibility, theme, loading/error, sidebar, roster, and CSS-skin transition
surfaces. ObiWave's authenticated four-format player, listener timing, private
detach/remount behavior, and provider-owned connection state remain composed
around those upstream changes.

No commit, merge completion, abort, reset, push, PR, deployment, publication,
tag, release, or Odin mutation was performed.

- `HEAD`: `e4fe19f67bfe9698afa5b78f6fc98a46a45cb01e`
- `MERGE_HEAD`: `6dea8f751b9e9b5d783c9de831d234aad1e5c2ed`
- Remaining unresolved paths: none

## Upstream web/admin adoption audit

The exact `v0.46.0..v0.47.0` Task 6 pathset contains 82 web paths. All 82 are
present in the staged merge result:

- 73 are byte-for-byte equal to `MERGE_HEAD`;
- nine are deliberately composed rather than replaced:
  - `web/app/globals.css` retains the fork's contained-player rail sizing;
  - `web/components/admin/AdminShell.tsx` differs only by a trailing blank
    line;
  - `web/components/admin/SettingsPanel.tsx` retains strict-request hydration;
  - `web/components/admin/settings/LlmSection.tsx` retains LiteLLM,
    provider-scoped URLs/keys, leg-specific discovery, and stale-result
    suppression;
  - `web/components/admin/settings/shared.tsx` retains the fork form contract;
  - `web/components/onboarding/steps.tsx` retains provider-scoped onboarding
    state and LiteLLM discovery/test behavior;
  - `web/components/player/PlayerShell.tsx` adapts upstream's shell to the
    fork's callback-ref audio lifecycle and station-auth presentation;
  - `web/components/player/StationGate.tsx` retains station-scoped
    credentials and fail-closed auth state across station changes;
  - `web/package.json` retains all six fork web behavior scripts.

The adopted upstream surfaces include:

- `/admin/stations`, `StationsPanel`, `StationSwitcher`, and
  `useStationSwitchPoll`; the poll waits for the boot-frozen target station id
  (or conversion sentinel) and hard-reloads after the restarted controller
  answers;
- `ThemeProvider` replacing the deleted `ThemeBootstrap`, plus upstream
  loading/error states and scrollbar/sidebar behavior;
- the Navidrome settings section and its test/save endpoints;
- shared roster table/list toggles for DJs, Shows, and Skills;
- upstream accessible labels, alerts, busy/invalid state, and control roles;
- track-change motion in Drift, Platter, Spool, Subamp, and TTY, retaining
  lite-mode/reduced-motion gates.

## Retained player, auth, timing, and provider contracts

The core retained fork seams remain byte-for-byte equal to `HEAD`, including
`PlayerCore`, `usePlayer`, `useStationFeed`, `audioFormat`,
`playerAudioBinding`, `stationAuth`, provider metadata/state, async generation,
model discovery, all six web contract scripts, and the native app.

The player still exports:

```ts
type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac';
getListenerLagMs(): number | null;
```

All three live stream assignments are authenticated with
`withStreamAuth(apiUrl, ...)`: explicit format/restored switches, watchdog
reconnects, and tune-in. Optional mount errors permanently mark that format
failed for the mounted player and fall back to MP3. Callback-ref replacement
cleans listeners before rebinding; detach resets playback state, pauses the
private audio node, and clears its source before a remount can occur.

While tuned in and actively playing, `getListenerLagMs()` returns the measured
buffered-end minus current-time lag. `useStationFeed` prefers that measured
value and otherwise resolves `bufferSecondsByFormat[activeFormat]`, falling
back to the legacy MP3 field. The native player uses the same active-format
advertised fallback contract.

Format preferences and listener credentials remain keyed by station API
identity. Primary/fallback provider URLs remain separate maps, inline keys are
provider-owned, model discovery carries the active leg and credentials, and
generation invalidation prevents stale provider results from being applied.

`web/package.json` contains exactly these six fork web contract scripts:

```text
test:audio-format
test:stream-auth-format
test:llm-provider
test:onboarding-provider-state
test:async-generation
test:llm-section-provider-url-contract
```

## TDD disposition

All required behavior contracts passed on their first Task 6 run and the
semantic audit found no corrective defect. Therefore no production corrective
edit was made and no artificial red-green cycle was invented. The existing
contracts served as the required regression gate for the retained fork seams.

## Commands and exact results

The seven required behavior contracts all exited 0:

```text
npm --prefix web run test:audio-format
```

`audio-format: all assertions passed`

```text
npm --prefix web run test:stream-auth-format
```

`stream-auth-format: all assertions passed`

```text
npm --prefix web run test:llm-provider
```

`✓ LiteLLM provider metadata`

```text
npm --prefix web run test:onboarding-provider-state
```

`✓ onboarding provider state stays scoped and current`

```text
npm --prefix web run test:async-generation
```

`✓ async result generations suppress stale responses`

```text
npm --prefix web run test:llm-section-provider-url-contract
```

`✓ LLM settings composes provider-scoped URLs with LiteLLM transport safeguards`

```text
npm --prefix app run test:stream-buffer-format
```

`stream-buffer-format.test.mjs: native resolves its active-format delay`

The module-type performance warnings emitted by these scripts were
warning-only and match the plan's accepted baseline.

```text
npm --prefix web run lint
```

Exit 0: `eslint . && tsc --noEmit`.

```text
npm --prefix app run lint
```

Exit 0 with zero errors and four existing warnings: one unused eslint-disable,
two array-style warnings, and one hook-dependency warning.

```text
npm --prefix app run typecheck
```

Exit 0: `tsc --noEmit`.

```text
npm --prefix web run build
```

Exit 0: Next.js 16.2.11 compiled, typechecked, generated 32/32 static pages,
and included `/admin/stations`.

The build rewrote `web/tsconfig.json` from `"jsx": "preserve"` to
`"react-jsx"` and rewrote the route reference in `web/next-env.d.ts`. Both
were restored to their intended pre-build forms with `apply_patch`. The
mandated follow-up `npm --prefix web run lint` exited 0, and neither file has
an unstaged diff.

## Review package and applicability proof

`.superpowers/sdd/task-6-review.diff` is the complete Task 6 scoped staged
patch against `HEAD`, generated directly with `git diff --cached -U0`. It has
82 changed paths, 3,827 insertions, 523 deletions, 5,051 lines, and 229,750
bytes. Retained fork-only review paths and the native app were staged/reviewed
by path but have no diff from `HEAD`.

Exactness and applicability were verified:

```text
git diff --cached -U0 HEAD -- <Task 6 pathset> > <temporary patch>
cmp -s <temporary patch> .superpowers/sdd/task-6-review.diff
```

Exit 0: `review-diff-byte-match PASS`.

```text
git apply --cached --check --reverse --unidiff-zero \
  .superpowers/sdd/task-6-review.diff
```

Exit 0: `reverse-apply-current-index PASS`.

```text
GIT_INDEX_FILE=<temporary-index> git read-tree HEAD
GIT_INDEX_FILE=<temporary-index> git apply --cached --check --unidiff-zero \
  .superpowers/sdd/task-6-review.diff
```

Exit 0: `forward-apply-temporary-head-index PASS`.

## Concerns

No Critical or Important concern was found in the Task 6 scope. The four
warning-only native lint findings are accepted by the implementation plan and
were not introduced by Task 6.
