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

The first full controller run completed 6,693 tests: 6,634 passed and 59 failed. Failures consisted of Mac shell fixtures run without the documented GNU tool path, structural assertions tied to moved source ownership, schema inventory/messages, and newly added edge-case regression tests. The affected checks subsequently passed with the documented PATH and fixes. A final full controller run and the independent whole-branch review are pending; this document will be updated with their results before delivery.

## Implementation decisions

- Preserve uncertain audio ownership: a corrupt manifest disables acquisition and retains files; an opaque recovered on-air ID conservatively pins matching generations. This can retain extra files until ownership is clear.
- Keep admission conservative: reserve 200 MiB audio plus 2 MiB optional art, count fresh crash orphans, preserve a 512 MiB free-space floor, and enforce 10,000-entry/8 MiB index bounds. Capacity can refuse a small recording before all nominal free space is used.
- Keep identity matching shared: use Direct's identity-only catalogue stage, with capped/error lookups indeterminate. Hard language/genre requirements retain ordinary library resolution when provider metadata cannot prove them. Slow or highly constrained requests can skip external acquisition.
- Bound catalogue work: local existence preflight has 30 seconds; Qobuz search checks at most 500 raw rows under one shared 15-second deadline. Broader/ambiguous catalogues fall back rather than guessing a recording.
- Protect final admission: per-request cooldown/dedup/policy checks run before download and after shared acquisition; a late policy change can leave a fresh cache entry without queueing that request.
- Preserve request/mixer compatibility: queue recovery defers unsent draining until cache ownership is restored; the opaque `subsonic_id` metadata field remains while a separate provider reference owns playback. Source checks use a leaf module and a final Navidrome URL guard.
- Preserve metadata reactions without ingestion: cached-track likes remain metadata-only, do not mirror Navidrome stars and do not seed local discovery. Optional artwork failures do not block validated music publication.
- Keep verification isolated: the current web test runner accepts one filter, so focused mounted/form tests ran separately; its complete suite also passed. No release, deployment or native-app build is part of this feature change.
