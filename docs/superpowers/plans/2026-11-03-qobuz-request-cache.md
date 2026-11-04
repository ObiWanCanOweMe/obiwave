# Qobuz Request Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fulfil named listener requests missing from Navidrome through a standalone Qobuz adapter and a private, station-scoped disk cache whose seven-day expiry renews on accepted cache hits.

**Architecture:** Keep provider I/O, cache ownership, recording identity and queue playback as separate modules. An exact-recording preflight runs before either request route can substitute, and the existing queue remains the sole playback/handoff owner. Credentials use private secret storage; cached audio uses the existing shared state mount, without library ingestion.

**Tech Stack:** Existing Node 22.13+ / TypeScript / Express / Zod controller, Next.js Admin, Node test runner, ffprobe/ffmpeg validation, Liquidsoap file IPC. Native HTTPS transport; no Python worker or new service.

**Spec:** `docs/superpowers/specs/2026-11-03-qobuz-request-cache-design.md` (operator approved).

## Global Constraints

- Work only in `.worktrees/qobuz-request-cache`, branch `feature/qobuz-request-cache`; ordinary PR targets `develop`. No production rollout in this feature's scope.
- Feature defaults off. Disabled behavior preserves current request routing, model-call count and provider-call count.
- Credentials: `QOBUZ_APP_ID`, `QOBUZ_APP_SECRET`, `QOBUZ_USER_AUTH_TOKEN`, `QOBUZ_USER_ID`; station `secrets.env` at 0600, never `settings.json` (main remains 0644).
- Cache expiry: seven 24-hour periods after successful download completion, reset to seven days from each successful cache hit accepted into the queue. No refresh for polling, inspection or refused requests.
- Defaults: CD-quality FLAC, 5 GiB cache budget, 200 MiB maximum per track, two simultaneous acquisitions, 15-second API timeout, 180-second download timeout, boot and 15-minute cleanup.
- Audio never enters Navidrome, library track indexes, analyzer walks, embeddings, playlists or automatic rotation. Metadata-only broadcast history may persist.
- `queue.push()` and `queue.drainToLiquidsoap()` retain admission/handoff ownership. Do not add voice writers or talk crons. Preserve request origin fields separately from provider identity.
- No automatic purchase; previews and incomplete files are unavailable. Strict requests never substitute.
- Existing schema mirrors are generated, not edited manually. New schema files import only `zod`.
- Use `npm test` in controller for isolated STATE_DIR. Heavy installs, test suites and builds run serially with Node 22; do not attach tests to the live station.
- Ordinary tests mock Qobuz. Live smoke tests read only `~/.config/obiwave/qobuz-development.env`, never print values or signed URLs, and never source production configuration.

## Review Focus

1. A blocked local recording is hidden by ordinary Subsonic searches: absence checking must see its existence and refuse external bypass (Task 4).
2. A mixer restart invalidates file-readability evidence: cached audio must be rechecked and never fall back to a fabricated Subsonic URL (Task 3).
3. Two concurrent requests and cleanup race at expiry: a lookup lease protects the generation through final queue admission and renewal (Tasks 2 and 4).
4. Credentials change while a download is running: stale authority may neither publish nor enqueue; already queued generations remain protected (Tasks 1, 2 and 4).
5. A publicly visible track's opaque identifier reaches likes, lyrics, similarity or file-format readers: provider IDs must not become Navidrome calls or library inserts (Task 5).

## File Structure and Shared Types

New domain files live in `controller/src/music/qobuz/`: `types.ts` (internal contracts), `credentials.ts` (effective credentials/authority), `client.ts` (Qobuz API/signing), `download.ts` (bounded HTTPS and media validation), `cache.ts` (one manifest writer and leases), `service.ts` (singleflight acquisition and status). No Express or queue imports in these modules; inject queue reference snapshots for cleanup.

New source seam `controller/src/music/track-source.ts` owns `isExternalTrackId(id: unknown): boolean`, `isQobuzTrack(track: unknown): boolean` and `resolveTrackPlayback(track: Track, opts: { timeoutMs: number }): Promise<{ localPath: string | null; resolveProbeId?: string }>`; it uses cache validation plus the mixer's direct `pathReadable()` for Qobuz, and preserves existing library mount proof for Navidrome.

Types in `qobuz/types.ts`:

```ts
type QobuzCredentials = { appId: string; appSecret: string; userAuthToken: string; userId: string };
type QobuzAuthority = { accountKey: string; revision: number }; // no raw credentials
type QobuzTrack = { id: string; title: string; artist: string; album: string; duration: number; explicit: boolean; isrc?: string; artworkUrl?: string };
type QobuzRef = { provider: 'qobuz'; trackId: string; accountKey: string; generation: string };
type CachedTrack = Track & { id: string; providerRef: QobuzRef };
type CacheLease = { track: CachedTrack; release(): void; accepted(hitAt: number): Promise<void> };
type QobuzStatus = { enabled: boolean; ready: boolean; credentials: Record<'appId' | 'appSecret' | 'userAuthToken' | 'userId', { present: boolean; source: 'environment' | 'saved' | 'unset' }>; cache: { bytes: number; items: number }; lastError: { code: string; at: number } | null };
```

Track IDs use `qobuz:<numeric-track-id>`. `accountKey` is a stable digest of the verified account ID; revision changes on credential writes/clear. Files use validated generated UUID basenames, not user metadata. No local paths in `providerRef` or public projections. Manifest format v1 stores metadata, file byte count/format, completion/last-hit/expiry timestamps, generation and account key; it stores no credentials or signed URLs. A lease spans lookup through `queue.push()`, then queue references protect the file. `accepted()` renews only cache hits; newly downloaded entries already start their seven days at completion.

### Task 1: Provider Client, Credentials and Settings Contract

**Files:** Create `controller/src/music/qobuz/{types,credentials,client,download}.ts`, `controller/src/schemas/qobuz.ts`, `THIRD_PARTY_NOTICES.md`; modify `controller/src/setup/secrets.ts`, `controller/src/{settings.ts,schemas/settings.ts}`, `controller/src/settings/{defaults,patch-registry}.ts`; regenerate `web/lib/schemas.generated.ts`. Tests: `controller/scripts/qobuz-provider.test.ts`, `controller/scripts/qobuz-settings.test.ts`, existing `secrets-env.test.ts`.

**Interfaces:** `effectiveQobuzCredentials(): QobuzCredentials | null`, `qobuzAuthority(): QobuzAuthority | null`; `createQobuzClient(credentials, dependencies)` returns `testConnection(signal?): Promise<{ accountKey: string; fullTrackAccess: boolean }>`, `search(query, signal?): Promise<QobuzTrack[]>`, `fileUrl(trackId, signal?): Promise<{ url: string; sample: boolean; duration: number }>`; `downloadQobuzAudio(url, partialPath, expectedDuration, signal?): Promise<{ bytes: number; duration: number; suffix: 'flac'; samplingRate: number; bitDepth: number; channelCount: number }>`.

- [ ] Write failing provider tests using captured request fixtures from the pinned MIT QBZ reference: exact signature/format ID 6 (CD FLAC), account ID agreement, restricted account, malformed metadata, sample response, 401, bounded transient retry and API timeout. Test errors never contain injected tokens or URL queries.
- [ ] Write failing download tests for a valid full FLAC, truncated/preview audio, duration mismatch, missing Content-Length, streaming over 200 MiB, stalled body, cancellation and redirect limits. Test loopback/private/link-local/IPv4-mapped IPv6 destinations and DNS rebinding; validate and pin public DNS results in the HTTPS connection, not just before an unrelated fetch. No credentials accompany CDN requests. Bound JSON responses to 2 MiB and redirects to three. Allow one retry for API transient failures within the shared 15-second deadline; no download retry after bytes are written.
- [ ] Run `cd controller && npm test -- qobuz-provider qobuz-settings`; verify failures identify missing behavior.
- [ ] Implement these interfaces with fixed Qobuz API origin, injected transport/clock for tests and sanitized typed errors. Validate complete FLAC by bounded ffprobe plus full decode verification; failures remove partials. Keep all validation inside the 180-second acquisition deadline. Retain MIT attribution for adapted source at the reviewed commit.
- [ ] Add top-level nonsecret `qobuz: { enabled: false, cacheMaxGb: 5 }`. Patch/cold-load validation permits boolean enablement and finite cache budget 0.25–1024 GiB. Register both fields in defaults/load/update/patch schema; use strict patch and lenient cold-load postures. Add the four keys to secret allowlist. Capture true boot environment overrides separately from keys loaded from secrets.env, so a saved edit can update live credentials without overriding an explicitly configured boot value. Expose presence/source only; blank/'set' preserves, explicit clear removes the saved key and live saved overlay. Invalidate authority synchronously on changes.
- [ ] Run provider/settings/secrets tests, controller lint, regenerate schemas, and inspect the mirror diff. Commit `feat: add bounded Qobuz adapter and private credential contract`.

### Task 2: Atomic Cache, Sliding Expiry and Account Isolation

**Files:** Create `controller/src/music/qobuz/{cache,service}.ts` and `controller/src/music/request-recording.ts`; extract pure identity helpers from `controller/src/music/request-match.ts`. Tests: `controller/scripts/qobuz-cache.test.ts`, `controller/scripts/qobuz-service.test.ts`, `controller/scripts/qobuz-request-identity.test.ts`.

**Interfaces:** `selectExactRecording(match: RequestMatch, candidates: RequestSong[]): RequestSong | null` in `request-recording.ts` shares the existing title/artist/edition/album identity rules; both cache and provider selection use it. `createQobuzCache({ root, now, references, capacityBytes, freeBytes })` returns `load(): Promise<void>`, `lookup(match: RequestMatch, authority: QobuzAuthority): Promise<CacheLease | null>`, `publish(metadata: QobuzTrack, validatedPartial, authority): Promise<CacheLease>`, `cleanup(): Promise<void>`, `status(): QobuzStatus`, `resolve(ref: QobuzRef): Promise<string | null>`. `createQobuzService(deps)` consumes the cache, an authority/credentials reader, a client factory and `allowed(track: QobuzTrack): boolean` policy callback, and returns `acquire(match: RequestMatch, signal?): Promise<CacheLease | null>`, `status(): QobuzStatus`, `cleanup(): Promise<void>`. `references()` returns protected QobuzRefs from durable upcoming/sent/current items and recent ended uses.

- [ ] Write failing identity tests for exact title+artist, title-only ambiguity, live/remix editions, accent/punctuation, album constraints and vague/artist-only asks. Extract shared identity helpers rather than copying a second fuzzy policy. Repeated albums with the same ISRC may count as one recording; different/unknown recordings remain ambiguous.
- [ ] Write clock-controlled failing tests that assert initial `expiresAt === completedAt + 7*24*60*60*1000`, lookup alone leaves expiry unchanged, `accepted(hitAt)` sets `expiresAt === hitAt + 7*24*60*60*1000`, and release/refusal does not renew. An expired entry never serves a new request, even when pinned for an older one.
- [ ] Add tests for concurrent lookup/cleanup/acceptance, query and track-ID singleflight, capacity reservations across two downloads, exact-limit admission, missing files, corrupt manifest, symlink files/root/ancestors, traversal, crash before/after atomic rename, stale owned partials, failed unlink and account changes. Assert fresh files are never evicted for capacity; stale authority never publishes. Same verified account token refresh retains committed cache but invalidates old in-flight jobs.
- [ ] Run `cd controller && npm test -- qobuz-cache qobuz-service` and confirm the new tests fail before implementation.
- [ ] Implement serialized manifest mutation and atomic file publication under active `STATE_DIR/qobuz-cache`. Use 0755 cache dirs and 0644 audio, 0600 manifest/temp metadata. Enforce no-follow regular-file checks and owned UUID paths; track leased partials/reserved bytes. Free-space floor is max(512 MiB, one 200 MiB reservation); refuse safely when statfs fails. Old unleased partials/orphans are eligible after 24 hours. Quarantine invalid index data without sweeping unrelated files.
- [ ] Implement matching through this task’s shared identity functions, capped candidate sets and no first-result guessing. Download only after injected policy precheck. Preserve immutable generations; when uncertain about a live reference, retain the file. Use a 120-second post-final-reference grace to cover crossfade/read-ahead; startup holds known references before cleanup.
- [ ] Run focused tests and controller lint. Commit `feat: add station-scoped Qobuz cache with sliding retention`.

### Task 3: Playback Resolution and Durable Cache Protection

**Files:** Create `controller/src/music/track-source.ts`; modify `controller/src/music/subsonic.ts`, `controller/src/broadcast/{queue.ts,queue/types.ts}`, `controller/src/server.ts`, `controller/src/broadcast/scheduler.ts`, `controller/src/stations/pure.ts`; tests `controller/scripts/qobuz-playback.test.ts`, `controller/scripts/qobuz-recovery.test.ts`, existing queue/annotation/station contracts.

**Interfaces:** Add `providerRef?: QobuzRef` to `Track`; expose `Queue.qobuzReferences(): QobuzRef[]` covering upcoming (including sent), current and grace-protected history. `resolveTrackPlayback()` returns a proved cache path or throws a sanitized unavailable error for Qobuz; it never returns a Navidrome stream fallback for external tracks. Extract common annotation construction into `music/track-annotation.ts`, `annotateTrackUri(song: Track, target: string, opts: AnnotationOptions): string`; keep Subsonic's existing exported wrapper for current callers. `AnnotationOptions` is the exact existing `getAnnotatedUri` options type, moved without changing its fields or defaults.

- [ ] Add failing tests for cached FLAC annotation parity, correct metadata/cue/crossfade stamps, no Subsonic URL/probe for Qobuz, mixer unreadable/missing cache failures and reproof after mixer restart. Keep `subsonic_id` as the existing opaque now-playing identity key for client/mixer compatibility; provider identity is separate and every consumer checks it before Navidrome use.
- [ ] Add recovery tests pinning expired sent-but-not-aired and current files before boot cleanup, cancelled items releasing only after grace, late duplicate references, multiple generations and unknown live ownership. Test that station duplication skips cache and legacy conversion moves it with station state.
- [ ] Run `cd controller && npm test -- qobuz-playback qobuz-recovery` and confirm failure.
- [ ] Extract annotation formatting without behavior changes, then use source resolution in drain. Verify a cache path with direct `pathReadable` rather than libraryMount's Navidrome-specific proof; recheck at publication after any await/restart. Failed resolution drops/reports the unavailable item through existing failure handling, preserving FIFO and the sole next.txt writer.
- [ ] Initialize cache after `queue.recover()` and before watcher/readiness; initialization/cleanup errors degrade only this feature. Add non-spoken `*/15 * * * *` cleanup with no overlap in the existing scheduler, including cleanup while feature disabled. Avoid circular queue/cache imports by injected reference readers. Explicitly classify cache in station duplication/conversion and verify root/AIO shared state visibility without introducing another mount.
- [ ] Run focused tests plus existing queue timing, handoff, mount, station and annotation suites; lint. Commit `feat: play cached Qobuz requests through the shared queue`.

### Task 4: Shared Exact-Recording Preflight and Request Integration

**Files:** Modify `controller/src/music/request-match.ts`, `controller/src/routes/{request.ts,request-strict.ts}`; modify `controller/src/music/request-recording.ts`; create `controller/src/routes/request-qobuz.ts`; tests `controller/scripts/qobuz-request-identity.test.ts`, `controller/scripts/qobuz-request-route.test.ts` and existing Direct/strict/limits/request tests.

**Interfaces:** `RecordingProbe = { kind: 'not-specific' | 'absent' | 'indeterminate' | 'refused'; errors: string[] } | { kind: 'found'; track: RequestSong; outcome: 'matched' | 'cooldown' | 'already-queued'; errors: string[] }`. `probeRequestedRecording(match: RequestMatch, deps: RecordingProbeDeps): Promise<RecordingProbe>` uses Task 2’s shared `selectExactRecording` identity rules. `tryQobuzRequest({ match, text, queue, service, now }): Promise<{ kind: 'continue' } | { kind: 'queued'; track: CachedTrack; queuePosition: number } | { kind: 'refused'; message: string }>` owns lease release/acceptance, never next.txt writes. `RecordingProbeDeps` carries `catalog: RequestCatalog`, `text: string`, `recentIds: Set<string>`, `queuedIds: Set<string>`, `currentId?: string | null`, `blocked(song: RequestSong): boolean` and `heldBack(song: RequestSong): boolean`; absence uses a catalogue adapter including blocked rows solely for internal existence checks.

- [ ] Extend failing identity tests for reversible literal reading, chat asks, explicit hard conditions and local policy outcomes. Extract the existing catalogue identity stage rather than run the entire substitute resolver as an absence detector. A bounded/truncated catalogue walk is indeterminate, not proven absence.
- [ ] Add router tests exercising Direct and agentic configurations: missing named song reaches cache/Qobuz before a substitute; local hit makes no Qobuz calls; disabled Qobuz preserves baseline model/agent calls. Lookup failure, unsupported condition, cooldown, duplicate, blocked local song and clean-show refusal never cause acquisition. Use internal includeBlocked lookup only for existence proof; run shared blocklist policy before download and queue.push after download.
- [ ] Add tests for acquisition failure resuming ordinary fallback, strict refusal mentioning both available sources accurately, account/enable/show change during download, final push refusal, concurrent requests/rate/pending limits and truthful acknowledgement/intro/wait position. Assert rejected pushes do not renew cache expiry, accepted hits do, and every acquired lease is released in finally.
- [ ] Run `cd controller && npm test -- qobuz-request-identity qobuz-request-route`; confirm failure before implementation.
- [ ] Refactor shared recording identity/catalogue stage, preserving the existing disabled path. When enabled, interpret at most once before both routes, probe local existence, then attempt external resolution only on absent. Reuse interpreted identity in the cascade. Let agentic fallback retain its existing conversation behavior; preflight never adds a second interpretation call. Recheck active authority/enablement and shared policy immediately before queue.push; preserve cooldown and dedup semantics using stable namespaced IDs.
- [ ] Use existing request intro generation, screenAck, wait notice, session and durable request-log contracts. Add bounded provider/cache outcome fields; never spread internal track paths/credentials into receipts. Qobuz success is `matched`; no fabricated queued receipt before admission.
- [ ] Run Qobuz tests plus full discovered request/strict/limits/claim/explicit/budget suites and controller lint. Commit `feat: fulfil missing listener requests from Qobuz`.

### Task 5: External Track Metadata Boundaries

**Files:** Modify `controller/src/routes/{public.ts,lyrics.ts,likes.ts,now-playing-file.ts,dj.ts}`, `controller/src/routes/library/blocklist.ts`, `controller/src/music/{lyrics-sources.ts,loudness.ts,picker.ts,playlist-gen.ts}`, `controller/src/broadcast/{scrobble-pure.ts,queue.ts}`, `controller/src/util/public-feed.ts`; inspect source-aware seeds in `controller/src/llm/internal/tools/picker/` and modify only affected seed consumers. Tests `controller/scripts/qobuz-source-boundaries.test.ts` plus existing scrobble/public-feed/lyrics/likes tests.

**Interfaces:** All ID-only readers use `isExternalTrackId`; track readers use `isQobuzTrack`. Public metadata retains title/artist/album/duration/opaque ID and a controller-owned cover identifier, never providerRef/accountKey/path. Cache format comes from validated manifest. Add `QobuzService.cover(trackId): Promise<{ bytes: Buffer; contentType: string } | null>` for at most 2 MiB JPEG/PNG/WebP fetched with the bounded public-HTTPS transport and stored with the generation; missing artwork is normal.

- [ ] Write failing tests with Subsonic spies asserting zero external-ID calls from covers, lyrics, gain, file format, scrobbling, likes/star sync, “more like this”, picker and playlist seeds, library/blocklist ID hydration. Verify Last.fm/ListenBrainz still receive metadata when eligible. External likes cannot seed local discovery or write library tracks; either record metadata-only reactions or return the existing unsupported result without claiming a library star.
- [ ] Add tests for public request/state/now-playing/history/session redaction, cached artwork traversal/size/type/account/expiry checks and private station authentication. Preserve existing `/cover/:id` client URL behavior by dispatching a bounded opaque `qobuz-<track-id>` cover ID to cache art with `requireStationAuth`; never proxy arbitrary URLs. Metadata remains usable after audio expiry with missing artwork. Lyrics for external IDs return the normal empty/unavailable payload without touching Navidrome, lyric offsets or library tables.
- [ ] Run `cd controller && npm test -- qobuz-source-boundaries`; confirm failure.
- [ ] Implement provider guards centrally via track-source predicates and cache metadata readers. Preserve metadata-only play history while excluding external IDs from local tag/discovery/analyzer inputs. Keep annotation/now-playing compatibility and avoid mandatory native client changes. Complete a repository-wide ID-consumer search, documenting each additional changed call site in this task before editing it.
- [ ] Run focused source-boundary tests and existing public feed/scrobble/likes/lyrics/format/similarity contracts, then lint. Commit `fix: keep Qobuz metadata outside Navidrome and library operations`.

### Task 6: Admin Settings and Safe Operator Feedback

**Files:** Create `controller/src/routes/settings/qobuz.ts`, `web/components/admin/settings/QobuzRequestsCard.tsx`; modify `controller/src/routes/settings.ts`, `web/components/admin/settings/{StationSection.tsx,shared.tsx,form-state.ts,save-payload.ts,registry.ts,queries.ts}` and settings search index if separate. Tests `controller/scripts/qobuz-admin.test.ts`, `web/components/admin/settings/QobuzRequestsCard.test.tsx`, `web/tests/qobuz-settings.test.ts`.

**Interfaces:** Admin-only `GET /settings/qobuz` returns `QobuzStatus` with per-field presence/source, readiness, cache bytes/items and sanitized last error; `POST /settings/qobuz/test` tests submitted nonempty credentials merged over effective credentials without saving; `POST /settings/qobuz/credentials` accepts four allowlisted credential fields plus explicit clear list and returns field names only. Nonsecret enable/cap saves through ordinary `/settings` `qobuz` patch. Define status/test schemas once in `schemas/qobuz.ts` and regenerate browser mirror. Cache usage queries use `useAdminQuery` with abort signal; credential test/save use mutations and invalidate status/settings.

- [ ] Write failing API tests for unauthenticated access, no-write probe, blank preservation, explicit clear, real-env lock, malformed/control-character input, 0600 save, concurrent saves, authority invalidation, redacted JSON/errors and disabled/partial-credential status.
- [ ] Write mounted UI tests asserting “Qobuz requests” beside existing Listener requests, four password inputs never hydrated with saved values, enable toggle/cache budget save/dirtiness/error association, test feedback and usage/expiry text. Test failed test/save retains typed input; successful save clears local secret input; navigation/logout drops it and stale async answers cannot update a new station. Use `fieldAria`; never localStorage for credentials.
- [ ] Run `cd controller && npm test -- qobuz-admin`, then `cd web && npm test -- QobuzRequestsCard qobuz-settings`; confirm failure.
- [ ] Implement Admin routes and card using existing save bars, query ownership, toast/error and settings-navigation conventions. Explain seven days since last accepted cache hit and that the cache is outside the music library. Secrets never join FormState/settings save payload. No cache-clear button is required; “clear status” means understandable status copy, with credential clear explicitly supported.
- [ ] Run focused tests, schema generation, controller/web lint, web admin-query audit and settings registry/draft tests. Commit `feat: configure Qobuz requests and credentials in Admin`.

### Task 7: End-to-End Verification and Reviewable Delivery

**Files:** Create `controller/scripts/qobuz-smoke.ts`, `docs/qobuz-requests.md`; update `docs/internals/{music,schemas,infrastructure}.md` and applicable scoped CLAUDE notes. Extend request integration tests where live smoke exposes a reproducible bug.

**Interfaces:** Explicit smoke command `npx tsx scripts/qobuz-smoke.ts --credentials-file <path> --state-dir <temporary-dir> --query <specific-recording>` validates account/search/full download, decodes audio, performs a cache hit with zero additional provider calls, renews expiry and cleans only its own temporary cache. It cannot enqueue to a live station. The harness requires a caller-selected temporary state dir, rejects known station roots, and never logs raw exceptions from authenticated network requests.

- [ ] Run controller lint and full `npm test`, then web lint, full `npm test`, production build and admin-query audit, serially under Node 22. Run schema/theme generation drift checks and repository contracts applicable to changed files. Resolve failures; record exact commands/results rather than claiming unrun checks.
- [ ] Read and use the repository `verify` skill for an isolated controller/Admin browser check: save/test credentials, enable feature, request a missing named recording through each request mode with mocked services, inspect truthful receipt/queue, reload for persistence and verify expiry renewal/refusal behavior. Verify actual local FLAC readability/annotation playback on an isolated mixer/shared temporary state; never connect next.txt to the live station.
- [ ] Run the explicit real Qobuz smoke using the provided private development file, with account ID omitted from public output. Report readiness/search/download/decode/cache-hit outcomes only. If credentials/provider deny access, retain the sanitized diagnosis and mocked test evidence; do not claim live success.
- [ ] Document credential setup, token refresh, cache/limits/expiry, disk full/unavailable behavior and troubleshooting. Confirm backup/station duplicate contracts do not include cache audio in a library/config backup or expose credentials without existing secret opt-in.
- [ ] Use `superpowers:requesting-code-review` for a fresh whole-branch review; fix material findings and rerun affected checks. Use `superpowers:verification-before-completion` before success claims and committing final fixes. No version bump, release, production deployment or native build.
- [ ] Commit documentation/verification changes, push the feature branch and open a concrete PR against `develop` with scope, evidence, live smoke result and any remaining limitations. Return the PR link and concise verified behavior summary.

## Execution Notes

Tasks are a single feature with shared interfaces, not independent deployable projects. Implement Tasks 1–7 in order. Task 2 extracts shared identity helpers; Task 4 adds the local catalogue probe and route wiring. Task 3 depends on the cache, and Tasks 5–6 consume the resulting source/status contracts. Prefer native execution in this session to avoid repeating the substantial queue/request context across workers; one fresh whole-branch review remains required.

Self-review completed against the approved spec: credentials/Admin, both request routes, acquisition bounds, cache renewal/recovery/capacity/account isolation, mixer handoff, metadata consumers, observability and isolated/live verification each have an owning task. No product code or dependency installation is part of this planning commit.
