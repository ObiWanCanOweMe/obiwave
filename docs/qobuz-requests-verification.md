# Qobuz request fallback verification

Implementation branch: `feature/qobuz-request-cache`. Base: `9089588b97f2620d55cf98063abc6f22a6a5c14c`.

## Completed checks

- Node 22 controller lint/typecheck passed; existing repository `any` warnings remain.
- Web lint/typecheck, all registered web contract commands and the full discovered suite passed (642 tests).
- Production Next.js build passed, with the local verifier API address used only for the ignored build artifact.
- Admin query ownership audit passed. Schema/theme mirrors regenerated; theme tokens unchanged.
- 321 focused controller tests passed after resolving the initial full-run findings, including request/cache/provider, settings schema and shell fixture contracts. Additional publication/orphan/real-settings-route regressions passed.
- Explicit live Qobuz smoke passed with the operator-provided external 0600 credential file: authentication and full-track entitlement, album-qualified exact recording, full FLAC download/decode, cache hit without provider search/file URL, seven-day renewal and expired audio deletion. The broad unqualified search was correctly ambiguous; album qualification resolved it. No credential values or signed URLs were recorded.
- Isolated browser verification passed using a fresh provenance-attested loopback dummy Navidrome backend and temporary state. It covered private credential probe/save and 0600 storage, enable/cap persistence after reload, both Direct/agentic requests, same-generation cache reuse, sliding expiry and desktop/mobile render inspection. Provider work was mocked for this browser run.
- Isolated non-root Liquidsoap 2.4.5, with networking disabled, decoded a controller-published 0644 cached FLAC through the shared annotation builder into 35.0 seconds of WAV (6,174,044 bytes). The expected opaque Qobuz metadata ID reached the mixer. The live station was untouched.

## Final gates

The first full controller run completed 6,693 tests: 6,634 passed and 59 failed. Failures consisted of Mac shell fixtures run without the documented GNU tool path, structural assertions tied to moved source ownership, schema inventory/messages, and newly added edge-case regression tests. The affected checks subsequently passed with the documented PATH and fixes. The subsequent full controller run passed all 6,703 tests. Independent whole-branch review identified four Important correctness gaps, all reproduced with failing regression tests and corrected: authority changes during publication/lease/admission, replacement-generation reuse, existing-client artwork on private stations, and concurrent manifest-slot reservations. There were no Critical, Minor or declined-to-judge findings. Final controller lint/typecheck passed after those fixes; the post-fix full suite is running.

## Implementation decisions

- Preserve uncertain audio ownership: a corrupt manifest disables acquisition and retains files; an opaque recovered on-air ID conservatively pins matching generations. This can retain extra files until ownership is clear.
- Keep admission conservative: reserve 200 MiB audio plus 2 MiB optional art, count fresh crash orphans, preserve a 512 MiB free-space floor, and enforce 10,000-entry/8 MiB index bounds. Capacity can refuse a small recording before all nominal free space is used.
- Keep identity matching shared: use Direct's identity-only catalogue stage, with capped/error lookups indeterminate. Hard language/genre requirements retain ordinary library resolution when provider metadata cannot prove them. Slow or highly constrained requests can skip external acquisition.
- Bound catalogue work: local existence preflight has 30 seconds; Qobuz search checks at most 500 raw rows under one shared 15-second deadline. Broader/ambiguous catalogues fall back rather than guessing a recording.
- Protect final admission: per-request cooldown/dedup/policy checks run before download and after shared acquisition; a late policy change can leave a fresh cache entry without queueing that request.
- Preserve request/mixer compatibility: queue recovery defers unsent draining until cache ownership is restored; the opaque `subsonic_id` metadata field remains while a separate provider reference owns playback. Source checks use a leaf module and a final Navidrome URL guard.
- Preserve metadata reactions without ingestion: cached-track likes remain metadata-only, do not mirror Navidrome stars and do not seed local discovery. Optional artwork failures do not block validated music publication.
- Keep verification isolated: the current web test runner accepts one filter, so focused mounted/form tests ran separately; its complete suite also passed. No release, deployment or native-app build is part of this feature change.

## Review corrections

- Carry the acquisition authority with every delivered lease, recheck after file validation and before queue admission, and authorize the manifest at the final atomic rename. A credential change cannot commit a queued stale publication. Existing queued generations remain playable.
- Prefer a readable replacement generation when an older file is missing. A subsequent request reuses it without provider search/download.
- Match the existing public artwork policy for bounded cached raster images. Actual unchanged web and native client helpers now fetch covers successfully from a locked station. This exposes cached artwork by opaque track ID, as existing library covers already are; audio and settings gates are unchanged.
- Reserve manifest entry slots alongside disk bytes and enforce the bound again during publication. Two concurrent acquisitions at 9,999 entries cannot create an unrecoverable 10,001-entry index.

Deferred minors: none. Declined-to-judge items: none.

## Execution rulings in order

- keep authority fingerprint and verified account identity separate until successful account verification — avoid treating unverified user input as identity — unavailable provider may block new acquisitions but must not break queued audio.
- corrupt manifests disable cache admission and retain files rather than automatically quarantining/rebuilding — the lost index may describe a live generation, so preserving ownership uncertainty protects playback — costs operator repair if metadata is damaged.
- tests reserve four known bytes to exercise capacity boundaries; production reserves the full 200 MiB before acquisition — conservatively prevents concurrent disk overcommit — may refuse a small track near capacity.
- queue.recover accepts an optional drain=false during server startup; cached file ownership is restored before cache initialization and unsent drains resume afterwards — prevents startup reads against an uninitialized manifest — default recovery callers preserve prior behavior.
- library-mount structural contract now names track-source.ts as the local-path owner — planned seam extraction moved that call; real drain regression tests still exercise streaming fallback and operator diagnostics — costs a contract update when the seam moves again.
- add identityOnly to the existing Direct resolver instead of a second catalogue walker — preserves its title/artist/edition and reversible-reading rules, stops before substitutes, and marks capped searches indeterminate — a large artist catalogue can decline external fallback rather than risk false absence.
- hard requested genre/language conditions leave Qobuz acquisition ineligible because available provider metadata cannot prove them — ordinary resolution/refusal continues — fewer external downloads for constrained requests.
- service acquisition receives a per-request admission callback before download and again after shared work — cooldown/dedup cannot be bypassed by cache expiry or singleflight waiters — may finish a download whose request is refused at final admission.
- preserve metadata-only external likes but exclude them at the shared djFavourites gate and suppress Navidrome star sync — listeners retain reactions without library ingestion — cached tracks cannot become local discovery seeds.
- reserve an additional 2 MiB for optional artwork alongside the 200 MiB maximum audio reservation — keeps concurrent publications within the configured disk cap — may refuse a near-cap acquisition sooner.
- web test runner currently accepts only its first name filter despite repository guidance describing OR filters — ran qobuz-settings and QobuzRequestsCard separately and will run the full suite — avoids silently missing the mounted test.
- provider/API ID guards live in a leaf module re-exported by track-source.ts — avoids introducing Subsonic/runtime cycles at the shared network boundary — adds one small identity-policy file.
- incomplete provider search pages are unavailable rather than establishing uniqueness from a prefix — a later page could name another recording — some broad requests fall back instead of downloading.
- an opaque recovered on-air external ID without a generation creates an internal wildcard retention pin for matching owned generations — protects uncertain mixer ownership after partial recovery — may retain multiple matching account generations until the live reference clears. Wildcards never become playable refs or public fields.
- paginate provider search to at most 500 raw rows under one shared 15-second deadline — live Qobuz returned 457 catalogue rows for a popular recording, so a one-page-only policy made normal requests unavailable — broader catalogues remain unavailable rather than guessing uniqueness.
- cap local existence preflight at 30 seconds and propagate secondary artist-index errors in its strict lookup mode — prevents a long catalogue walk from exhausting the request ledger or turning a failed lookup into absence — slow local catalogues skip external acquisition and retain existing fallback.
- cap manifest admission at the 10,000-entry recovery bound and expose retryable cleanup failure counts — prevents successful writes that cannot be recovered and makes permission errors visible — a full cache can refuse despite spare bytes.
- retained crash orphans count toward actual disk admission and failed publication removes uncommitted generation files — prevents cache-cap bypass after crashes or manifest errors — extra bounded filesystem accounting on admission/cleanup, never on polling.
- cached raster artwork follows the existing public library-cover policy instead of adding station-password authentication — unchanged web/native helpers omit station passwords, and the approved spec requires compatibility without a mobile release — cached cover art remains publicly retrievable by opaque track ID, as library artwork already is; audio/settings authentication is unchanged.
- extend the shared asynchronous atomic writer with an optional final synchronous authorization/rename boundary — stage file I/O asynchronously and prevent credential revision changes between authorization and publication — one synchronous rename per guarded cache manifest commit; ordinary writers retain their existing async path.
