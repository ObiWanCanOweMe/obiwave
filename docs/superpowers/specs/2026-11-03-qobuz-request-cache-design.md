# Qobuz fallback for listener song requests

Status: approved by the operator on 2026-11-03; implemented on the feature branch and undergoing final verification.

## Intent and agreed requirements

When a listener requests a specific recording absent from the music library, SUB/WAVE should check its Qobuz disk cache, then search Qobuz if needed, download an exact match and queue it. The station keeps broadcasting while this happens. Downloaded recordings never enter Navidrome or the station's library index. Cache entries expire seven days after download completion or their latest successful cache-backed request, whichever is later.

The operator wants a standalone SUB/WAVE adapter and Qobuz credentials managed through SUB/WAVE's Admin settings. An existing QBZ-Downloader installation has working credentials, but is not a runtime dependency and will not be read or modified by this feature.

## Approaches and selection

1. **Native TypeScript adapter, using selected QBZ-Downloader code as a reference.** Fits the controller's Node/TypeScript runtime and MIT license. SUB/WAVE owns matching, admission, file lifetime and playback; it does not import QBZ's desktop UI, database, library manager, media-server notifications or background downloads. Recommended builder choice, consistent with the operator's own-adapter requirement.
2. **A separate streamrip Python worker.** Reuses its downloader but adds another runtime/service and separate configuration, and its persistent downloaded-ID history needs reconciling with seven-day expiry. Considered, but not selected for this design.

Reviewed references:
- QBZ-Downloader: https://github.com/ifauzeee/QBZ-Downloader, commit `25e18176ce6bc35413780fbc419ac5142691ec56`, MIT; relevant source `src/api/qobuz.ts`, `src/services/DownloadEngine.ts`, `src/services/QobuzAccountService.ts`.
- streamrip: https://github.com/nathom/streamrip, commit `e3291615ba6be34aa76df19da8aeb6f41673c6a0`, GPL-3.0; considered as a standalone worker, not a source-copy dependency.

Any reused MIT code retains its copyright/license notice and is documented in the repository's third-party acknowledgements. No runtime dependency on streamrip or QBZ is introduced.

## Settings and credentials

Add a **Qobuz requests** card within the request settings surface. It contains an enable toggle (default off), four credential inputs, a test-connection action, cache limit, usage and clear status text. No credentials are required until the feature is enabled.

Credential fields: `QOBUZ_APP_ID`, `QOBUZ_APP_SECRET`, `QOBUZ_USER_AUTH_TOKEN`, `QOBUZ_USER_ID`. Register them in the existing secrets allowlist and use the Admin-gated secret save/test mechanisms. Persist them in the active station's `secrets.env` at 0600, with the existing environment-override policy. Never put them in `settings.json` (main station's file is deliberately 0644), public responses, request receipts, logs, URLs displayed to users or backups that omit secrets. Redacted settings report only presence/source. Empty/redacted form round trips must preserve saved values; clearing uses the existing explicit clear mechanism.

The connection test checks the supplied credential bundle without saving it, validates account identity and availability for full-track access, and returns sanitized results. A successful login alone must not be represented as proof that every catalogue track is available. Missing/invalid credentials leave ordinary library requests operational and surface an actionable operator status.

Settings schemas remain controller-owned, mirrored through the existing generator. Enabling, limits and credential changes apply without restarting the mixer. Turning the feature off stops admitting new Qobuz work; existing queued/playing tracks can finish, and cache cleanup continues.

## Resolution and admission

Use one shared exact-recording preflight in front of both the Direct and agent request paths. The current agent may queue a substitute itself, so adding a handler only after the existing cascade returns no-match would be too late.

When Qobuz is disabled, preserve existing request behavior, including agent call count and latency. When enabled:

1. Run the current request screening, rate limits, pending-request limits and unsupported-condition checks before external acquisition.
2. Resolve named recording identity against the local catalogue using shared existing title/artist/edition rules. Distinguish genuine absence from lookup errors, policy refusal, cooldown and already-queued outcomes. Only proven absence opens Qobuz fallback. A timeout, blocked local track, explicit-track refusal or a local recording on cooldown must not trigger external acquisition as a way around policy.
3. Check fresh cache entries by normalized requested identity; validate the referenced file still exists and is complete. A valid hit requires no Qobuz search or file-URL request. Once the request is accepted into the queue, atomically reset that entry’s expiry to seven days from the hit.
4. Otherwise search Qobuz, compare returned metadata against the named recording, and select only an unambiguous exact match. Preserve distinctions such as live/remix/acoustic editions when requested. A vague mood request or artist-only request does not trigger automatic downloads. A title-only request may succeed only when the recording is unambiguous; do not choose the first unrelated search result.
5. Check station/show eligibility and blocklist attributes before downloading, and run ordinary final queue admission after download. Exact Qobuz matches are listener requests, with the existing request cooldown, deduplication, pending limits and exemptions.
6. Queue the validated cached recording through the existing queue owner; use the actual matched title/artist in acknowledgements and intros. A Qobuz match is `matched`, not `substituted`.

If Qobuz cannot provide an exact, full recording, resume the existing request fallback/refusal policy; strict requests continue to refuse substitutes. No Qobuz purchase is made automatically. Geographic/account restrictions and sample-only responses are ordinary unavailable outcomes, not tracks to queue.

Interpret a request once where possible. Reuse the same interpreted identity across library, cache and Qobuz checks; avoid an extra model call merely to select a Qobuz result. Cache matching shares the existing identity rules rather than maintaining a second fuzzy policy.

## Provider adapter and bounded download

The adapter exposes metadata search, credential testing, and acquisition of a full-track download URL using operator-supplied credentials. Keep it independent of Express, the DJ model and the library database. API endpoint configuration is fixed to Qobuz; requests never accept a listener-supplied URL, filesystem path or command.

Use explicit timeouts and bounded retries for transient errors; authentication, account restrictions and unavailable recordings are not endlessly retried. Proposed defaults: 15 seconds for search/account calls and 180 seconds for an individual download. Request processing remains asynchronous using the existing request ID/polling contract, within its current ten-minute ledger lifetime.

Default audio quality: CD-quality FLAC (16-bit/44.1 kHz), a builder choice for predictable radio playback and disk use. Reject previews and incomplete audio. Validate downloaded duration/codec and plausible agreement with provider metadata before publishing a usable cache entry. Do not truncate a file to enforce a byte limit and then treat it as playable.

Download URLs and redirects must be HTTPS, bounded in count, and validated against non-public destinations. Never forward Qobuz API credentials to a CDN, another host or a redirect. Treat signed media URLs as secrets: do not persist them or include query strings in diagnostic errors. Use the repository's bounded networking patterns, with a hard streaming byte cap even when Content-Length is absent.

## Cache ownership and lifetime

Store audio and its cache index under the active station's shared state directory, e.g. `STATE_DIR/qobuz-cache/`, outside every Navidrome music mount. Both controller and broadcast already share this mount. Cache audio must be readable by the mixer across container UIDs; credential files remain private.

The cache is separate from `library.db`, mood/tag indexes, embedding graphs, analyzer walks and auto playlists. Use stable namespaced recording identities such as `qobuz:<track-id>` for dedup/history, plus an immutable cache-generation reference for the actual local file. Persist only playback metadata and expiry information; never persist account tokens or signed download URLs in the cache manifest.

**Expiry rule selected by the operator:** seven 24-hour periods from successful download completion, reset to seven days from each successful cache hit accepted into the queue. Inspection, polling, unsuccessful lookups and refused requests do not refresh expiry. Expired entries cannot satisfy a new request. An expired file still needed by a queued/handed-over/playing request is deleted once that use safely finishes; playback must never be broken by cleanup.

Use controller-owned atomic publication: download into a generated partial path, validate it, publish the finished file, then atomically record the manifest entry. A request cannot discover a partial file. Multiple requests for the same identity share lookup work, and acquisitions resolving to the same Qobuz track ID share one download. Failures release slots and do not leave a successful manifest entry.

Pins/leases protect downloading files and files referenced by the durable queue, including its sent-but-not-yet-aired handoffs. Restore protection from queue state before startup cleanup. Account for mixer read-ahead and crossfades when releasing a played file; use a conservative bounded grace after the final reference, and keep the file when ownership of a live use is uncertain. Preserve a generation's immutable path while it is in use; do not overwrite it for a later download of the same recording.

Run a non-spoken cleanup task at boot and every 15 minutes. It may delete only files/directories created by this cache, with validated manifest references and anchored generated names. Never sweep arbitrary state files, follow symlinks outside the cache, or purge Navidrome/library/stem data. Crash recovery removes only old, unleased owned partials/orphans. Failed deletions are counted and retried; they do not stop the station.

Proposed disk admission defaults: 5 GiB total cache budget, configurable in Admin, and 200 MiB per track. Purge expired, unpinned entries before checking room, but do not evict fresh recordings before seven days merely to admit another request. When capacity/free-space checks refuse a download, follow the ordinary fallback policy. The cap and filesystem free-space floor must protect the shared state volume. Limit simultaneous acquisitions to two; existing listener limits still apply independently.

Credentials and cache are station-scoped. Partition cache ownership by authenticated Qobuz account identity, so switching accounts cannot reuse another account's recordings for new requests. Token rotation for the same verified account may retain its cache. Credential/account changes invalidate in-flight acquisition authority; do not publish or enqueue a late result under a different account or station. Already queued recordings retain their protected generation until played/cancelled.

## Playback and source boundaries

A Qobuz cache item must not masquerade as a Navidrome track. Introduce an explicit provider/source reference on its track metadata while retaining the queue item's existing request/operator/AI origin semantics.

Keep `queue.push()` and `queue.drainToLiquidsoap()` as the existing admission and handoff owners. Generalize the annotated-URI construction through a shared source-resolution seam so cached local audio carries the normal identity/timing annotations and uses the ordinary mixer pipeline. Verify actual mixer readability; a missing or invalid cache file is an acquisition failure, not a fabricated Subsonic URL.

Audit every downstream consumer of track IDs. Qobuz IDs must not be sent to Navidrome getSong/stream/cover/lyrics/scrobble endpoints or used to seed unsupported local-library similarity calls. Serve cache-owned artwork through a constrained, existing-auth-aware controller route when available; otherwise use the ordinary missing-cover presentation. Do not expose local paths or signed remote URLs through public feeds. Existing web/native clients should still receive usable title, artist, album, duration and artwork without a mandatory app update.

Queue/session/history can retain metadata after audio expires. External tracks must not enter library discovery, tagging, embedding or auto-rotation via likes/history. Last.fm/ListenBrainz metadata scrobbles may follow existing operator settings; Navidrome-specific scrobbles are skipped for external tracks. No new talk cron or voice writer is introduced.

## Observability and operator experience

Admin shows credential readiness, feature enablement, cache bytes/items, expiry policy and sanitized recent acquisition failures. Reuse existing settings navigation/query helpers and secret test/save feedback. Never require a restart merely to save a key.

Keep existing request statuses compatible. Optional progress/source metadata may distinguish cache lookup, Qobuz lookup and downloading without replacing the existing pending/resolved/failed contract. The listener sees accurate queued/unavailable/fallback wording; an unverified match or failed download is never announced as queued. Log bounded source, latency, cache-hit/miss, byte count and outcome fields without credentials, signed URLs or local paths in public data.

## Verification and delivery

Tests must cover: disabled behavior; library hit without any Qobuz call; proven absence versus local lookup/policy failure; cache hit without a provider call; exact and ambiguous results; preview rejection; byte/time limits; concurrent duplicate acquisition; partial/crash recovery; initial seven-day expiry and sliding renewal on accepted cache hits; no renewal from inspection, polling, missing/expired files or refused requests; pin restoration and delayed deletion; capacity refusal without early eviction; station/account changes during lookup/download; final queue refusal; source-specific playback/cover/lyrics/scrobble boundaries; secret redaction and 0600 storage; Admin credential save/test wiring.

Use deterministic clocks and stubbed Qobuz/CDN responses for automated tests. Test the real request router and queue seam in an isolated state directory, including both matching routes. Never write tests against production settings or trigger live downloads during ordinary CI. Run meaningful full package/contract checks and rendered Admin/request checks before merge.

Delivery for this feature is implementation and a reviewable PR to develop after design approval and verification. A live Qobuz smoke test may use operator-provided credentials in a private development file outside Git (0600), then Admin’s private secret flow once implemented. The operator may manually copy their existing credential bundle into that file; do not extract it from the QBZ instance or ask for tokens in chat. Ordinary automated tests remain mocked, and smoke tests must redact secrets and signed URLs. No production rollout is implied by this new feature request; release/deployment is a separate action when the feature is ready.

## Operator-review defaults

These are builder proposals rather than requirements the operator explicitly selected: CD-quality FLAC, 5 GiB cache cap, 200 MiB per-track limit, two concurrent downloads, 15-minute cleanup, and existing fallback behavior when external acquisition fails. They can be changed during design review. Detailed module naming and cache-index storage format are left to implementation planning, provided the separation, atomicity, lifetime and secrecy contracts above hold.
