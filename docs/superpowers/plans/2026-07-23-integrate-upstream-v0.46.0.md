# SUB/WAVE v0.46.0 Upstream Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge exact upstream SUB/WAVE `v0.46.0` into ObiWave, adopt upstream implementations wherever they fully replace fork behavior, and preserve the documented fork-specific security, provider, player, analyzer-handoff, and release contracts.

**Architecture:** Perform one non-fast-forward merge whose second parent is the exact upstream tag commit. Resolve the eight textual conflicts upstream-first, keep the fork's shared Icecast renderer and missing-client fallbacks, and compose upstream measured web lag with the fork's authenticated four-format player. All merge work stays staged and uncommitted until the final verification task creates the merge commit.

**Tech Stack:** Git, Node.js 22, TypeScript, React 19, Next.js 16, Expo/React Native, Express, Docker Compose, Icecast, Bash, Python analyzer/TTS workers, GitHub Actions, Node test runner, ESLint, and TypeScript.

## Global Constraints

- Start from `origin/develop` at `d378ca84a50b463503bafb7235e8971c6f44db0d`.
- Merge exact tag `v0.46.0` at `8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392`; never merge a moving upstream branch.
- The final merge commit's second parent must be `8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392`.
- Prefer upstream v0.46.0 behavior whenever it fully replaces fork behavior for the same clients and guarantees.
- Preserve four-format selection, MP3 fallback, private-player lifecycle, station-scoped credentials, provider-owned URLs and keys, Odin URL handoff, quiet analysis, Portainer controls, and immutable fork-release gates.
- Active web playback uses upstream measured listener lag; native and non-playing clients use the active format's advertised fallback.
- Keep one shared Icecast renderer for split and AIO deployments.
- Use upstream `ghcr.io/perminder-klair/subwave-analyzer-cuda`; never build or publish `subwave-analyzer-cuda` in ObiWave.
- Preserve the reusable app CI invocation of `npm run test:stream-buffer-format`.
- Generated CLI assets and theme tokens are never hand-edited.
- Do not deploy, push, publish, mutate Odin, tag, cut a release, or create a pull request during integration.
- Do not commit while the merge is in progress. Tasks 2–7 operate inside one staged, uncommitted merge; Task 8 creates the merge commit.

## File Responsibility Map

- `controller/src/broadcast/stream-buffer.ts`: advertised per-format fallback timing.
- `docker/icecast-render.sh`: single split/AIO mount renderer, per-mount burst/queue sizing, and optional listener auth.
- `docker/icecast.xml.template`: global defaults plus generated mount insertion marker.
- `docker/broadcast-entrypoint.sh` and `docker/aio/supervisor.sh`: invoke the shared renderer.
- `web/hooks/usePlayer.ts`: authenticated four-format playback plus upstream actual-lag measurement.
- `web/hooks/useStationFeed.ts`: measured-lag-first listener-time promotion with per-format fallback.
- `web/components/player/PlayerCore.tsx`: stable bridge between player-owned measurement/format and the feed.
- `app/src/lib/streamBuffer.ts`: native active-format fallback.
- `controller/src/settings.ts`: upstream moods/beds/stale-theme behavior plus fork privacy, provider, buffer, and public-response contracts.
- `controller/scripts/analyze_worker.py` and `controller/src/music/analyze.ts`: upstream vocal fixes composed with Odin URL handoff, quiet gating, CUDA, and idle release.
- `web/components/admin/**` and `web/app/admin/**`: upstream shadcn shell, Moods, Imaging, and shared state UI.
- `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, and `web/eslint.config.mjs`: upstream Next.js 16 toolchain plus fork behavior scripts.
- `.github/workflows/ci.yml` and `scripts/ci/workflow-contract.test.mjs`: reusable gates, including native source-integrity timing coverage.
- `cli/src/assets.generated.ts` and `web/lib/theme-tokens.generated.ts`: generated outputs only.
- `CLAUDE.md`: composed operational invariants for beds, streams, auth, providers, and analyzer ownership.

---

### Task 1: Establish the current fork baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-23-integrate-upstream-v0.46.0-design.md`
- Read: `docs/superpowers/plans/2026-07-23-integrate-upstream-v0.46.0.md`

**Interfaces:**
- Consumes: branch `integrate/upstream-v0.46.0` based on current `origin/develop`.
- Produces: a clean isolated worktree with reproducible dependencies and a passing pre-merge baseline.

- [ ] **Step 1: Verify branch provenance and worktree isolation**

```bash
test "$(git branch --show-current)" = integrate/upstream-v0.46.0
test "$(git merge-base HEAD origin/develop)" = d378ca84a50b463503bafb7235e8971c6f44db0d
test "$(git rev-list --count origin/develop..HEAD)" = 2
git status --short
```

Expected: all tests exit 0 and status is empty. `HEAD` is the plan commit whose parent is current `origin/develop`.

- [ ] **Step 2: Install every package reproducibly**

```bash
npm ci --no-audit --no-fund
npm --prefix controller ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm --prefix mcp-subwave ci --no-audit --no-fund
npm --prefix cli ci --no-audit --no-fund
npm --prefix app ci --no-audit --no-fund
```

Expected: every command exits 0 and no lockfile changes.

- [ ] **Step 3: Run the pre-merge controller and repository suites**

```bash
npm --prefix controller test
node --test scripts/**/*.test.mjs
```

Expected: the current controller suite and all 59 repository contracts pass.

- [ ] **Step 4: Run every current web and native behavior contract**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix app run test:stream-buffer-format
```

Expected: every command exits 0. Node module-type warnings are acceptable; assertion failures are not.

- [ ] **Step 5: Confirm dependency installation and tests left the branch clean**

```bash
git status --short
```

Expected: no output. Stop and report any baseline failure before beginning the merge.

### Task 2: Begin the exact non-fast-forward merge

**Files:**
- Merge: every path changed by `v0.45.0..v0.46.0`
- Conflict: `CLAUDE.md`
- Conflict: `controller/src/settings.ts`
- Conflict: `docker/aio/supervisor.sh`
- Conflict: `docker/broadcast-entrypoint.sh`
- Conflict: `docker/icecast.xml.template`
- Conflict: `web/components/player/PlayerCore.tsx`
- Conflict: `web/hooks/usePlayer.ts`
- Conflict: `web/hooks/useStationFeed.ts`

**Interfaces:**
- Consumes: the clean Task 1 worktree and exact immutable tag.
- Produces: one in-progress merge with the exact upstream commit in `MERGE_HEAD` and the forecasted conflict set.

- [ ] **Step 1: Verify the local and remote tag object**

```bash
test "$(git rev-parse 'v0.46.0^{}')" = 8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392
test "$(git ls-remote --tags upstream refs/tags/v0.46.0 | cut -f1)" = 8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392
```

Expected: both commands exit 0.

- [ ] **Step 2: Start the merge without committing**

```bash
git merge --no-ff --no-commit v0.46.0
```

Expected: Git stops for conflict resolution and does not create a commit.

- [ ] **Step 3: Verify the conflict inventory**

```bash
git diff --name-only --diff-filter=U | sort
```

Expected exactly:

```text
CLAUDE.md
controller/src/settings.ts
docker/aio/supervisor.sh
docker/broadcast-entrypoint.sh
docker/icecast.xml.template
web/components/player/PlayerCore.tsx
web/hooks/usePlayer.ts
web/hooks/useStationFeed.ts
```

- [ ] **Step 4: Verify merge provenance**

```bash
test "$(git rev-parse MERGE_HEAD)" = 8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/heads/integrate/upstream-v0.46.0)"
```

Expected: both commands exit 0.

- [ ] **Step 5: Record the immutable merge ledger**

Create `.superpowers/sdd/progress.md` with:

```markdown
# SUB/WAVE v0.46.0 integration progress

Fork base: d378ca84a50b463503bafb7235e8971c6f44db0d
Plan head: recorded from `git rev-parse HEAD` immediately before the merge
Upstream second parent: 8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392
Execution rule: Tasks 2–7 remain one staged, uncommitted merge; Task 8 creates the merge commit.

Task 1: complete
Task 2: complete
```

Expected: the ignored ledger records review checkpoints without entering the merge commit.

### Task 3: Compose stream rendering, measured web lag, and client fallbacks

**Files:**
- Modify: `controller/src/broadcast/stream-buffer.ts`
- Modify: `controller/scripts/stream-buffer-formats.test.ts`
- Modify: `controller/scripts/icecast-render.test.ts`
- Modify: `controller/scripts/aio-icecast-render.test.ts`
- Modify: `docker/icecast-render.sh`
- Resolve: `docker/broadcast-entrypoint.sh`
- Resolve: `docker/aio/supervisor.sh`
- Resolve: `docker/icecast.xml.template`
- Resolve: `web/hooks/usePlayer.ts`
- Resolve: `web/hooks/useStationFeed.ts`
- Resolve: `web/components/player/PlayerCore.tsx`
- Modify: `web/lib/audioFormat.ts`
- Modify: `web/scripts/audio-format.test.ts`
- Modify: `web/scripts/stream-auth-format.test.ts`
- Modify: `app/scripts/stream-buffer-format.test.mjs`
- Review: `app/src/lib/streamBuffer.ts`

**Interfaces:**
- Consumes: `AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac'`, current `bufferSecondsByFormat`, upstream `getListenerLagMs()`, and listener-auth state.
- Produces:
  - `streamBufferSecondsByFormat(seconds: number): Record<StreamFormat, number>`
  - `Player.getListenerLagMs(): number | null`
  - `StationFeedTiming { activeFormat?: { readonly current: AudioFormat }; getListenerLagMs?: () => number | null }`
  - `useStationFeed(timing?: StationFeedTiming): StationFeed`

- [ ] **Step 1: Change the API timing regression first**

Replace the nonzero-input expectation in `controller/scripts/stream-buffer-formats.test.ts` with:

```ts
assert.deepEqual(streamBufferSecondsByFormat(22), {
  mp3: 22,
  opus: 22,
  aac: 22,
  flac: 22,
});
```

Keep the zero-input expectation at zero for all formats.

- [ ] **Step 2: Run the API timing regression and observe RED**

```bash
cd controller
npx tsx scripts/stream-buffer-formats.test.ts
```

Expected: FAIL because the current fork returns zero for Opus and FLAC.

- [ ] **Step 3: Publish the intended delay for every rendered mount**

Replace `streamBufferSecondsByFormat()` in `controller/src/broadcast/stream-buffer.ts` with:

```ts
export function streamBufferSecondsByFormat(seconds: number): StreamBufferSecondsByFormat {
  return { mp3: seconds, opus: seconds, aac: seconds, flac: seconds };
}
```

Update its comment to state that MP3/AAC are exact CBR targets, Opus is a constrained-VBR target, FLAC uses the renderer's estimate, and active web playback measures actual lag.

- [ ] **Step 4: Make the renderer test require upstream per-mount bursts and queues**

In `controller/scripts/icecast-render.test.ts`, require these private-mode blocks for a 22-second buffer, MP3 192 kbps, Opus 96 kbps, AAC 128 kbps, and FLAC estimate 900 kbps:

```ts
const expected = {
  '/stream.mp3':  { burst: 528000,  queue: 2112000 },
  '/stream.opus': { burst: 264000,  queue: 2097152 },
  '/stream.aac':  { burst: 352000,  queue: 2097152 },
  '/stream.flac': { burst: 2475000, queue: 9900000 },
};

for (const [mount, sizes] of Object.entries(expected)) {
  const block = mountBlock(mount);
  assert.match(block, new RegExp(`<burst-size>${sizes.burst}</burst-size>`));
  assert.match(block, new RegExp(`<queue-size>${sizes.queue}</queue-size>`));
  assert.match(block, /<authentication type="url">/);
}
```

Keep public-mode assertions that all four mount blocks exist and contain no URL authentication.

- [ ] **Step 5: Run renderer tests and observe RED**

```bash
cd controller
npx tsx scripts/icecast-render.test.ts
npx tsx scripts/aio-icecast-render.test.ts
```

Expected: the render test fails because the current shared renderer gives Opus/FLAC zero burst and lacks per-mount queue values. The AIO wiring test remains green.

- [ ] **Step 6: Upgrade the shared renderer to upstream mount semantics**

In `docker/icecast-render.sh`:

- retain `ICECAST_STATE_DIR`, `ICECAST_TEMPLATE`, `ICECAST_RENDERED`, and optional `LISTENER_AUTH_URL`;
- read MP3, Opus, and AAC bitrate state files;
- set `FLAC_BITRATE_EST=900`;
- use `${BUFFER_SECONDS} * bitrate * 125` for every mount;
- set each mount queue to four times its burst, floored at `2097152`;
- include both `<burst-size>` and `<queue-size>` inside every mount;
- retain the optional URL-auth block inside the same mount;
- insert mounts at `<!--@STREAM_MOUNTS@-->`.

The complete mount helper must be:

```bash
render_mount() {
    local mount=$1 bitrate=$2 burst queue
    burst=$(( BUFFER_SECONDS * bitrate * 125 ))
    queue=$(( burst * 4 ))
    [ "$queue" -lt 2097152 ] && queue=2097152
    cat >> "$MOUNTS_XML" <<EOF
    <mount type="normal">
        <mount-name>$mount</mount-name>
        <burst-size>$burst</burst-size>
        <queue-size>$queue</queue-size>
EOF
    if [ "$AUTH_ENABLED" = true ]; then
        cat >> "$MOUNTS_XML" <<EOF
        <authentication type="url">
            <option name="listener_add" value="$AUTH_URL"/>
            <option name="auth_header" value="icecast-auth-user: 1"/>
        </authentication>
EOF
    fi
    cat >> "$MOUNTS_XML" <<EOF
    </mount>
EOF
}

render_mount /stream.mp3 "$MP3_BITRATE"
render_mount /stream.opus "$OPUS_BITRATE"
render_mount /stream.flac "$FLAC_BITRATE_EST"
render_mount /stream.aac "$AAC_BITRATE"
```

Use the largest mount burst for the global queue and MP3 for the legacy global burst.

- [ ] **Step 7: Resolve split/AIO/template conflicts toward one renderer**

Resolve `docker/broadcast-entrypoint.sh` to invoke `/usr/local/bin/icecast-render` once after secrets are available. Resolve `docker/aio/supervisor.sh` to invoke the same binary from `render_icecast()` on every pair launch with the loopback auth URL. Do not retain upstream's duplicated shell renderer bodies.

Resolve `docker/icecast.xml.template` to keep upstream's per-mount documentation and this single marker:

```xml
    <!--@STREAM_MOUNTS@-->
```

Keep the global `${ICECAST_BURST_SIZE}` and `${ICECAST_QUEUE_SIZE}` placeholders as safe defaults.

- [ ] **Step 8: Add the upstream measured-lag interface to the fork player**

Add to `Player` in `web/hooks/usePlayer.ts`:

```ts
getListenerLagMs: () => number | null;
```

Add this stable callback before the return:

```ts
const getListenerLagMs = useCallback((): number | null => {
  const el = audioRef.current;
  if (!el || !tunedInRef.current || el.paused) return null;
  try {
    const n = el.buffered.length;
    if (n === 0) return null;
    const lag = el.buffered.end(n - 1) - el.currentTime;
    if (!Number.isFinite(lag) || lag <= 0) return null;
    return Math.min(lag, 120) * 1000;
  } catch {
    return null;
  }
}, []);
```

Return it alongside the existing `audioElementRef`, `format`, `availability`, `selectFormat`, and `formatFailure` fields. Do not replace the fork return shape with upstream's smaller return object.

- [ ] **Step 9: Define measured-first feed timing**

In `web/hooks/useStationFeed.ts`, define:

```ts
export interface StationFeedTiming {
  activeFormat?: { readonly current: AudioFormat };
  getListenerLagMs?: () => number | null;
}

export function useStationFeed({
  activeFormat,
  getListenerLagMs,
}: StationFeedTiming = {}): StationFeed {
```

At each poll, update the fallback from `bufferSecondsForFormat()` and choose the effective lag with:

```ts
const measuredLagMs = getListenerLagMs?.() ?? null;
const leadMs = measuredLagMs ?? leadMsRef.current;
```

The polling effect dependency list must be:

```ts
[activeFormat, client, getListenerLagMs]
```

- [ ] **Step 10: Bridge the feed/player cycle without duplicating state**

In `web/components/player/PlayerCore.tsx`, keep the player after the feed and use a stable ref bridge:

```ts
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type Dispatch,
  type RefCallback,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';

const activeFormatRef = useRef<AudioFormat>('mp3');
const listenerLagGetterRef = useRef<() => number | null>(() => null);
const getListenerLagMs = useCallback(() => listenerLagGetterRef.current(), []);
const feed = useStationFeed({ activeFormat: activeFormatRef, getListenerLagMs });
const {
  // existing fork fields
  getListenerLagMs: measureListenerLagMs,
} = usePlayer({ streamEnablement: streamEnablementFor(feed.stream) });
activeFormatRef.current = format;
listenerLagGetterRef.current = measureListenerLagMs;
```

Retain `audioElementRef`, format actions, private-player remount behavior, and authenticated URL behavior.

- [ ] **Step 11: Strengthen web and native timing contracts**

Add assertions to `web/scripts/audio-format.test.ts` that:

```ts
assert.equal(bufferSecondsForFormat({
  bufferSeconds: 22,
  bufferSecondsByFormat: { mp3: 22, opus: 22, aac: 22, flac: 22 },
}, 'flac'), 22);
```

Add bounded source-contract assertions to `web/scripts/stream-auth-format.test.ts` that the player exports `getListenerLagMs`, `PlayerCore` passes both `activeFormat` and the stable lag callback, and the feed uses measured lag before `leadMsRef.current`.

Update `app/scripts/stream-buffer-format.test.mjs` to assert Opus and FLAC select their explicit map values and that a literal NUL byte is absent from `app/src/hooks/useStationFeed.ts`.

- [ ] **Step 12: Run focused stream verification**

```bash
npm --prefix controller exec -- tsx scripts/stream-buffer-formats.test.ts
npm --prefix controller exec -- tsx scripts/icecast-render.test.ts
npm --prefix controller exec -- tsx scripts/aio-icecast-render.test.ts
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix app run test:stream-buffer-format
bash -n docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh
npm --prefix controller run typecheck
npm --prefix web run typecheck
npm --prefix app run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 13: Stage and review the stream task**

```bash
git add controller/src/broadcast/stream-buffer.ts controller/scripts/stream-buffer-formats.test.ts controller/scripts/icecast-render.test.ts controller/scripts/aio-icecast-render.test.ts docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh docker/icecast.xml.template web/hooks/usePlayer.ts web/hooks/useStationFeed.ts web/components/player/PlayerCore.tsx web/lib/audioFormat.ts web/scripts/audio-format.test.ts web/scripts/stream-auth-format.test.ts app/scripts/stream-buffer-format.test.mjs app/src/lib/streamBuffer.ts
git diff --cached --check
```

Expected: no whitespace errors. A fresh reviewer approves measured-first web timing, active-format fallback, format/auth preservation, and split/AIO parity before Task 4.

### Task 4: Compose settings, moods, beds, themes, and provider isolation

**Files:**
- Resolve: `controller/src/settings.ts`
- Review: `controller/src/routes/settings.ts`
- Review: `controller/src/routes/public.ts`
- Review: `controller/src/audio/bed-gen.ts`
- Review: `controller/src/broadcast/bed-policy.ts`
- Review: `controller/src/broadcast/beds.ts`
- Review: `controller/src/music/audio-moods.ts`
- Review: `web/components/admin/SettingsPanel.tsx`
- Review: `web/components/admin/settings/shared.tsx`
- Test: `controller/scripts/moods.test.ts`
- Test: `controller/scripts/bed-policy.test.ts`
- Test: `controller/scripts/show-theme-id.test.ts`
- Test: `controller/scripts/stream-buffer-settings.test.ts`
- Test: `controller/scripts/cloud-tts-provider-key.test.ts`
- Test: `controller/scripts/embedding-provider-config.test.ts`
- Test: `controller/scripts/settings-route-security.test.ts`

**Interfaces:**
- Consumes: upstream `moodEntries()`, `moodVocab()`, `moodPromptFor()`, `moodScheduleFor()`, `weatherMoodFor()`, bed settings, and stale-theme validation.
- Produces: all upstream settings features plus fork `publicUpdateResult()`, privacy, provider-owned secrets, and bounded stream-buffer persistence.

- [ ] **Step 1: Resolve the settings conflict by retaining both interfaces**

Keep the fork's public response seam exactly:

```ts
export function publicUpdateResult(result: { requiresRestart?: unknown }) {
  return { requiresRestart: !!result?.requiresRestart };
}
```

Immediately after it, retain upstream's complete mood accessor block:

```ts
export function moodEntries(): Array<{ name: string; clapPrompt: string }> {
  const m = get().moods;
  return Array.isArray(m) && m.length ? m : MOOD_DEFAULTS;
}
export function moodVocab(): string[] {
  return moodEntries().map((m) => m.name);
}
export function moodPromptFor(name: string): string {
  const e = moodEntries().find((m) => m.name === name);
  return e?.clapPrompt ? e.clapPrompt : `${name} music`;
}
export function moodScheduleFor(period: string): string {
  const s = get().moodSchedule || {};
  return s[period] ?? PERIOD_MOOD_DEFAULTS[period] ?? '';
}
export function weatherMoodFor(condition: string): string {
  const w = get().weatherMoods || {};
  return (w[condition] ?? WEATHER_MOOD_DEFAULTS[condition] ?? '') || '';
}
```

Retain upstream's `validateShowsStrict(..., moodNames = SHOW_MOODS)` signature and stale-theme tolerance. Retain fork load/update behavior for `stream.bufferSeconds`, privacy, provider base URLs, and provider-owned keys.

- [ ] **Step 2: Run focused settings tests before any corrective edit**

```bash
npm --prefix controller exec -- tsx scripts/moods.test.ts
npm --prefix controller exec -- tsx scripts/bed-policy.test.ts
npm --prefix controller exec -- tsx scripts/show-theme-id.test.ts
npm --prefix controller exec -- tsx scripts/stream-buffer-settings.test.ts
npm --prefix controller exec -- tsx scripts/settings-route-security.test.ts
npm --prefix controller exec -- tsx scripts/cloud-tts-provider-key.test.ts
npm --prefix controller exec -- tsx scripts/embedding-provider-config.test.ts
```

Expected: all pass. Any failure is treated as a composition defect and fixed with a regression in the failing focused test before proceeding.

- [ ] **Step 3: Audit settings load, update, and response ownership**

Verify with bounded source inspection:

```bash
rg -n "moods: normalizeMoods|moodSchedule: normalizeMoodMap|weatherMoods: normalizeMoodMap|beds: \\{|bufferSeconds|publicUpdateResult|providerBaseUrls|resolveCloudApiKey" controller/src/settings.ts controller/src/routes/settings.ts
```

Expected: every upstream field is loaded and saved; the route returns `publicUpdateResult`; provider credentials do not enter the response.

- [ ] **Step 4: Audit admin state composition**

Verify `web/components/admin/SettingsPanel.tsx` and `web/components/admin/settings/shared.tsx` contain upstream mood/bed-compatible state and fork privacy/provider fields:

```bash
rg -n "privacy|listenerAuth|providerBaseUrls|litellm|moods|beds|theme" web/components/admin/SettingsPanel.tsx web/components/admin/settings/shared.tsx
```

Expected: no fork field is lost and upstream's moved Imaging/Moods ownership does not leave duplicate settings controls.

- [ ] **Step 5: Run provider and admin contracts**

```bash
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix controller run typecheck
npm --prefix web run typecheck
```

Expected: all pass.

- [ ] **Step 6: Stage and review the settings task**

```bash
git add controller/src/settings.ts controller/src/routes/settings.ts controller/src/routes/public.ts controller/src/audio/bed-gen.ts controller/src/broadcast/bed-policy.ts controller/src/broadcast/beds.ts controller/src/music/audio-moods.ts controller/scripts/moods.test.ts controller/scripts/bed-policy.test.ts controller/scripts/show-theme-id.test.ts controller/scripts/stream-buffer-settings.test.ts controller/scripts/settings-route-security.test.ts controller/scripts/cloud-tts-provider-key.test.ts controller/scripts/embedding-provider-config.test.ts web/components/admin/SettingsPanel.tsx web/components/admin/settings/shared.tsx
git diff --cached --check
```

Expected: a fresh reviewer approves settings reconstruction, response secrecy, provider ownership, moods/beds, stale-theme behavior, and buffer persistence before Task 5.

### Task 5: Compose analyzer vocal gating with Odin, quiet mode, and CUDA

**Files:**
- Review/modify: `controller/scripts/analyze_worker.py`
- Review/modify: `controller/src/music/analyze.ts`
- Review: `controller/src/music/embeddings.ts`
- Review: `controller/src/music/tag-library.ts`
- Review: `controller/src/music/lyric-vocal.ts`
- Test: `controller/scripts/analyze-quiet.test.ts`
- Test: `controller/scripts/lyric-vocal.test.ts`
- Test: `controller/scripts/vocal_gate_test.py`
- Review: `docker-compose.analyzer-gpu.yml`
- Review: `scripts/ci/workflow-contract.test.mjs`
- Review: `.github/workflows/publish-images.yml`

**Interfaces:**
- Consumes: upstream vocal-range gate and fork `ANALYZE_HANDOFF`/quiet/CUDA worker behavior.
- Produces: one analyzer path that retains URL handoff and upstream false-positive prevention without adding a fork CUDA publication.

- [ ] **Step 1: Run upstream vocal regressions against the merged worker**

```bash
npm --prefix controller exec -- tsx scripts/lyric-vocal.test.ts
python3 controller/scripts/vocal_gate_test.py
```

Expected: both pass. A failure proves the automatic merge lost upstream vocal gating and must be corrected in `analyze_worker.py` or `lyric-vocal.ts` before continuing.

- [ ] **Step 2: Run fork handoff and quiet regressions**

```bash
npm --prefix controller exec -- tsx scripts/analyze-quiet.test.ts
npm --prefix controller exec -- tsx scripts/analyzer-handoff.test.ts
```

Expected: URL mode disables prefetch, path/auto modes retain it, and quiet gating remains fail-open for unknown listener state.

- [ ] **Step 3: Audit the merged analyzer control flow**

```bash
rg -n "ANALYZE_HANDOFF|prefetch|quiet|cuda|idle|unload|vocal" controller/src/music/analyze.ts controller/scripts/analyze_worker.py controller/src/music/lyric-vocal.ts
```

Verify in order:

1. quiet gating occurs before new work/prefetch;
2. URL mode sends analyzer requests without path prefetch;
3. path and auto modes retain existing prefetch;
4. upstream vocal gating runs before tags are committed;
5. CUDA selection, CPU fallback, request serialization, and idle unload remain present.

- [ ] **Step 4: Pin CUDA ownership and publication policy**

Run:

```bash
rg -n "ghcr.io/perminder-klair/subwave-analyzer-cuda" docker-compose.analyzer-gpu.yml
! rg -n "subwave-analyzer-cuda" .github/workflows/publish-images.yml
node --test scripts/ci/workflow-contract.test.mjs
```

Expected: the overlay names the upstream image, the fork publisher does not name it, and all workflow contracts pass.

- [ ] **Step 5: Run analyzer-related type and syntax checks**

```bash
python3 -m py_compile controller/scripts/analyze_worker.py
npm --prefix controller run typecheck
git diff --check -- controller/scripts/analyze_worker.py controller/src/music/analyze.ts controller/src/music/lyric-vocal.ts
```

Expected: all exit 0.

- [ ] **Step 6: Stage and review the analyzer task**

```bash
git add controller/scripts/analyze_worker.py controller/src/music/analyze.ts controller/src/music/embeddings.ts controller/src/music/tag-library.ts controller/src/music/lyric-vocal.ts controller/scripts/analyze-quiet.test.ts controller/scripts/lyric-vocal.test.ts controller/scripts/vocal_gate_test.py docker-compose.analyzer-gpu.yml scripts/ci/workflow-contract.test.mjs .github/workflows/publish-images.yml
```

Expected: a fresh reviewer approves upstream vocal behavior, Odin URL handoff, quiet gating, CUDA fallback/unload, and publication ownership before Task 6.

### Task 6: Adopt upstream admin, Imaging/Moods, beds, Chatterbox, and Next.js 16

**Files:**
- Adopt/review: `web/app/admin/**`
- Adopt/review: `web/components/admin/**`
- Adopt/review: `web/components/ui/**`
- Adopt/review: `web/app/*/loading.tsx`
- Adopt/review: `web/app/error.tsx`
- Adopt/review: `web/app/global-error.tsx`
- Adopt/review: `web/app/not-found.tsx`
- Modify: `web/package.json`
- Adopt: `web/package-lock.json`
- Resolve/review: `web/tsconfig.json`
- Adopt/review: `web/eslint.config.mjs`
- Review: `controller/scripts/chatterbox_worker.py`
- Test: `controller/scripts/test_chatterbox_chunk.py`
- Review: `.github/workflows/ci.yml`
- Review: `scripts/ci/workflow-contract.test.mjs`

**Interfaces:**
- Consumes: upstream Next.js 16/admin component tree and the fork's behavior scripts/provider/privacy controls.
- Produces: upstream web architecture with fork scripts and reusable CI gates intact.

- [ ] **Step 1: Reconcile the web package manifest toward upstream**

Keep upstream dependency and devDependency versions, including `next: ^16.2.11`, `react: ^19.2.8`, `react-dom: ^19.2.8`, `@next/third-parties: ^16.2.11`, and `eslint-config-next: ^16.2.11`. Preserve these fork scripts exactly:

```json
"test:audio-format": "node --experimental-strip-types scripts/audio-format.test.ts",
"test:stream-auth-format": "node --experimental-strip-types scripts/stream-auth-format.test.ts",
"test:llm-provider": "node --experimental-strip-types scripts/llm-provider-meta.test.ts",
"test:onboarding-provider-state": "node --experimental-strip-types scripts/onboarding-provider-state.test.ts",
"test:async-generation": "node --experimental-strip-types scripts/async-result-generation.test.ts",
"test:llm-section-provider-url-contract": "node --experimental-strip-types scripts/llm-section-provider-url-contract.test.ts"
```

Use upstream `web/package-lock.json`, `web/tsconfig.json`, and `web/eslint.config.mjs` as the base, changing only what is required for the retained fork sources to lint and typecheck.

- [ ] **Step 2: Verify old Imaging settings components are removed**

```bash
test ! -e web/components/admin/settings/JinglesSection.tsx
test ! -e web/components/admin/settings/SfxSection.tsx
test -e web/components/admin/imaging/JinglesSection.tsx
test -e web/components/admin/imaging/SfxSection.tsx
test -e web/components/admin/imaging/BedsSection.tsx
test -e web/components/admin/MoodsPanel.tsx
```

Expected: all commands exit 0.

- [ ] **Step 3: Run upstream feature tests**

```bash
npm --prefix controller exec -- tsx scripts/bed-policy.test.ts
npm --prefix controller exec -- tsx scripts/moods.test.ts
npm --prefix controller exec -- tsx scripts/show-theme-id.test.ts
python3 controller/scripts/test_chatterbox_chunk.py
```

Expected: all pass.

- [ ] **Step 4: Keep the native regression in reusable CI**

Ensure the app matrix entry in `.github/workflows/ci.yml` is exactly:

```yaml
- package: app
  command: npm run lint && npm run typecheck && npm run test:stream-buffer-format
```

Keep the workflow contract:

```js
test('app quality matrix runs the native stream-buffer contract', () => {
  const appCommand = ci.match(/- package: app\s*\n\s+command: ([^\n]+)/)?.[1];
  assert.ok(appCommand, 'missing app quality-matrix command');
  assert.match(appCommand, /(?:^|&& )npm run test:stream-buffer-format(?: &&|$)/);
});
```

- [ ] **Step 5: Install the resolved web dependency graph**

```bash
npm --prefix web ci --no-audit --no-fund
```

Expected: exit 0 and no lockfile drift.

- [ ] **Step 6: Run web behavior, lint, typecheck, and production build**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix web run lint
npm --prefix web run build
```

Expected: all commands exit 0 under Next.js 16. Warnings are acceptable only when lint reports zero errors.

- [ ] **Step 7: Run workflow and package command contracts**

```bash
node --test scripts/ci/workflow-contract.test.mjs
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run test:stream-buffer-format
```

Expected: all pass and the app lint reports zero errors.

- [ ] **Step 8: Stage and review the upstream feature/toolchain task**

```bash
git add web/app web/components web/hooks/use-mobile.tsx web/package.json web/package-lock.json web/tsconfig.json web/eslint.config.mjs controller/scripts/chatterbox_worker.py controller/scripts/test_chatterbox_chunk.py .github/workflows/ci.yml scripts/ci/workflow-contract.test.mjs
git diff --cached --check
```

Expected: a fresh reviewer approves the upstream admin architecture, removal of duplicate controls, Next.js 16 configuration, Chatterbox chunking, and retained fork CI/scripts before Task 7.

### Task 7: Resolve documentation, regenerate assets, and audit every overlap

**Files:**
- Resolve: `CLAUDE.md`
- Review: `.env.example`
- Review: `.gitignore`
- Review: `README.md`
- Regenerate: `cli/src/assets.generated.ts`
- Regenerate: `web/lib/theme-tokens.generated.ts`
- Review: all 24 both-sides overlap paths

**Interfaces:**
- Consumes: fully resolved source assets and all reviewed behavior tasks.
- Produces: deterministic generated files, zero unresolved paths, and a complete semantic overlap audit.

- [ ] **Step 1: Resolve operational documentation**

Resolve `CLAUDE.md` upstream-first. Retain fork operational invariants for:

- station-scoped listener authentication;
- the authenticated four-format player;
- shared split/AIO rendering;
- measured web lag with active-format fallback;
- provider-owned URLs and keys;
- Odin URL handoff and upstream-owned CUDA image;
- fork publication excluding the CUDA image.

Adopt upstream documentation for beds, moods, Imaging, the admin shell, Next.js 16, Chatterbox chunking, vocal gating, and picker variety.

- [ ] **Step 2: Discard and regenerate CLI assets**

```bash
git rm -f cli/src/assets.generated.ts
npm --prefix cli run embed-assets
git add cli/src/assets.generated.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
```

Expected: the first run recreates the file; the second creates no diff.

- [ ] **Step 3: Regenerate theme tokens twice**

```bash
npm --prefix controller run gen:themes
git add web/lib/theme-tokens.generated.ts
npm --prefix controller run gen:themes
git diff --exit-code -- web/lib/theme-tokens.generated.ts
```

Expected: the second run creates no diff.

- [ ] **Step 4: Verify all conflicts and markers are gone**

```bash
test -z "$(git diff --name-only --diff-filter=U)"
test -z "$(git ls-files -u)"
! rg -n '^(<<<<<<<|=======|>>>>>>>)' . --hidden -g '!node_modules' -g '!.git'
git diff --check
git diff --cached --check
```

Expected: every command exits 0.

- [ ] **Step 5: Audit all 24 both-sides overlap paths**

```bash
while IFS= read -r path; do
  printf '\n===== %s: staged merge =====\n' "$path"
  git diff --cached -- "$path"
  printf '\n===== %s: upstream delta =====\n' "$path"
  git diff v0.45.0..v0.46.0 -- "$path"
  printf '\n===== %s: fork delta =====\n' "$path"
  git diff v0.45.0..d378ca84a50b463503bafb7235e8971c6f44db0d -- "$path"
done < <(
  comm -12 \
    <(git diff --name-only v0.45.0..d378ca84a50b463503bafb7235e8971c6f44db0d | sort) \
    <(git diff --name-only v0.45.0..v0.46.0 | sort)
)
```

Expected: exactly 24 paths are audited. Record one sentence per path in `.superpowers/sdd/task-7-report.md`, explicitly stating how upstream and fork behavior compose.

- [ ] **Step 6: Render Compose shapes without starting containers**

Because each controller service requires `env_file: ./.env`, create a temporary ignored `.env` fixture containing:

```dotenv
ADMIN_USER=ci
ADMIN_PASS=ci
SITE_URL=https://radio.example.test
```

Then run:

```bash
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.byo.yml config --quiet
docker compose -f docker-compose.dev.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.analyzer-gpu.yml config --quiet
rm -f .env
```

Expected: all four renders exit 0, no container starts, and the temporary file is removed.

- [ ] **Step 7: Stage the complete merge**

```bash
git add -A
git status --short
```

Expected: every change is staged and there are no `UU`, `UD`, `DU`, `AA`, or unstaged entries.

- [ ] **Step 8: Review the completed semantic merge**

A fresh reviewer reads the Task 7 report and live staged diff, then verifies:

- all 24 overlap paths are accounted for;
- no provider/auth/player/analyzer/release behavior was silently lost;
- generated assets match their resolved sources;
- upstream admin/bed/mood/toolchain changes are intact;
- only the intended upstream CUDA reference exists.

Expected: no material findings before Task 8.

### Task 8: Run full verification and create the merge commit

**Files:**
- Verify: entire repository
- Commit: all staged merge changes

**Interfaces:**
- Consumes: the fully resolved and reviewed v0.46.0 merge.
- Produces: one verified merge commit whose second parent is the exact upstream tag.

- [ ] **Step 1: Run the full controller and Python suites**

```bash
npm --prefix controller test
python3 controller/scripts/vocal_gate_test.py
python3 controller/scripts/test_chatterbox_chunk.py
```

Expected: all discovered controller test files and both focused Python suites pass.

- [ ] **Step 2: Run repository and deployment contracts**

```bash
node --test scripts/**/*.test.mjs
node --test scripts/ci/workflow-contract.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/release/fork-tag.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: all repository contracts pass, including native CI coverage and the nine-image/CUDA exclusion boundary.

- [ ] **Step 3: Run every web and native behavior contract**

```bash
npm --prefix web run test:audio-format
npm --prefix web run test:stream-auth-format
npm --prefix web run test:llm-provider
npm --prefix web run test:onboarding-provider-state
npm --prefix web run test:async-generation
npm --prefix web run test:llm-section-provider-url-contract
npm --prefix app run test:stream-buffer-format
```

Expected: every command exits 0.

- [ ] **Step 4: Run every lint and typecheck gate**

```bash
npm --prefix controller run lint
npm --prefix web run lint
npm --prefix mcp-subwave run lint
npm --prefix cli run typecheck
npm --prefix app run lint
npm --prefix app run typecheck
```

Expected: every command exits 0. Existing warnings are acceptable only when there are zero errors.

- [ ] **Step 5: Build the Next.js 16 production application**

```bash
npm --prefix web run build
```

Expected: production compilation, type validation, and page generation complete successfully.

- [ ] **Step 6: Re-run generator drift gates**

```bash
npm --prefix controller run gen:themes
git diff --exit-code -- web/lib/theme-tokens.generated.ts
npm --prefix cli run embed-assets
git diff --exit-code -- cli/src/assets.generated.ts
```

Expected: both generators exit 0 and leave no diff.

- [ ] **Step 7: Run runtime syntax and rendering checks**

```bash
bash -n docker/icecast-render.sh docker/broadcast-entrypoint.sh docker/aio/supervisor.sh
npm --prefix controller exec -- tsx scripts/icecast-render.test.ts
npm --prefix controller exec -- tsx scripts/aio-icecast-render.test.ts
python3 -m py_compile controller/scripts/analyze_worker.py controller/scripts/chatterbox_worker.py
```

Expected: all commands exit 0.

- [ ] **Step 8: Inspect the staged result**

```bash
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached -- .github/workflows/ci.yml .github/workflows/publish-images.yml controller/src/settings.ts controller/src/music/analyze.ts controller/scripts/analyze_worker.py docker/icecast-render.sh docker-compose.analyzer-gpu.yml web/hooks/usePlayer.ts web/hooks/useStationFeed.ts web/components/player/PlayerCore.tsx web/package.json
```

Expected: all v0.46.0 and documented fork behavior is intentional, no unstaged file exists, and the CUDA image is absent from fork publication.

- [ ] **Step 9: Create the merge commit**

```bash
git commit -m "merge: integrate subwave v0.46.0"
```

Expected: Git creates a merge commit.

- [ ] **Step 10: Verify exact ancestry and cleanliness**

```bash
test "$(git rev-parse HEAD^2)" = 8e4e56761e1ce6f50a4ccc0312d9eb6175bbd392
git merge-base --is-ancestor v0.46.0 HEAD
git status --short
git log --oneline --decorate --graph -8
```

Expected: both ancestry checks exit 0, status is empty, and the graph shows `v0.46.0` as the second parent.

- [ ] **Step 11: Request final whole-branch review**

Provide a fresh reviewer:

- base/first parent;
- exact upstream second parent;
- approved design and this plan;
- full verification evidence;
- the 24-path overlap report.

Expected: no Critical or Important finding. Fix any material finding with a regression, amend the merge commit while preserving both parents, rerun the affected checks and the full matrix, and request focused re-review.

- [ ] **Step 12: Record the local handoff**

Report:

- final merge SHA and both parents;
- test counts and warning-only lint totals;
- upstream features adopted;
- fork behavior retained;
- measured-web/per-format-fallback timing decision;
- upstream-owned CUDA decision;
- clean worktree.

Do not push, deploy, publish, tag, release, create a PR, or mutate Odin.
