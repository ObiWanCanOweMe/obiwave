# Qobuz request fallback

Enable **Admin → Settings → Station → Qobuz requests** to acquire an exact requested recording when it is missing from Navidrome. The feature defaults off. It checks the library first, then a station-local disk cache, then Qobuz. Both Direct and agentic request matching use this order before offering a substitute.

Enter the four values from your Qobuz application/account configuration: App ID, App secret, User auth token and User ID. **Test connection** tests edited fields without saving. **Save credentials** writes them to the active station's `secrets.env` at 0600. Blank inputs preserve stored values; each saved field has an explicit Clear button. Environment-provided values remain managed by the environment. Saved values never populate password inputs or ordinary settings backups. Credentials and cache are station-scoped; main station `settings.json` remains 0644 and contains only enablement and cache size.

Save station settings to apply enablement and the disk limit. No mixer restart is needed. Disabling stops new acquisitions; queued recordings can finish, and expiry cleanup continues.

Downloaded audio stays under the active station's `qobuz-cache`, outside every Navidrome music mount. It is never imported, tagged, embedded or offered to automatic library rotation. The default cap is 5 GiB, with CD-quality FLAC and a 200 MiB audio limit per recording. Two acquisitions may run at once. Capacity reservations include up to 2 MiB for optional artwork and preserve a 512 MiB free-space floor. Fresh files are not evicted to admit another download. Fresh crash leftovers also count toward the budget. Admission stops at 10,000 recordings or the 8 MiB metadata-index bound.

Each completed download starts a seven-day deadline. A valid cache hit accepted into the queue resets the deadline to seven days after that hit. Browsing Admin, polling requests and refused requests do not renew it. Expired entries cannot fulfil new requests. Queued, handed-over and playing generations stay protected until their use finishes, including a two-minute playback grace. Cleanup runs at startup and every 15 minutes. Frequently requested music can remain cached indefinitely through accepted hits.

Only an unambiguous exact recording is acquired. Live, remix and acoustic editions remain distinct; artist-only and vague requests do not trigger downloads. Catalogue errors, incomplete searches, blocks, explicit-show refusals, cooldowns and duplicates do not count as absence. Hard language/genre conditions remain on the existing library path because Qobuz search metadata cannot reliably prove them. No purchases are made. Preview-only or restricted results are unavailable. Ordinary fallback behavior remains available; strict requests refuse substitutes.

Cached tracks retain normal listener metadata, request intros, queue order and playback processing. Navidrome-specific stream, star, lyrics and scrobble operations are skipped. Listener likes can retain metadata but do not seed library discovery. Last.fm/ListenBrainz may scrobble the metadata under existing settings. Artwork is cached with the recording and served through the normal public cover route, matching existing library artwork and current web/mobile clients; missing artwork uses the player's usual fallback.

If a request cannot be acquired, check the card's sanitized recent error and use Test connection. Refresh expired tokens in the private credential fields. Account switching prevents reuse of the previous account's cache for new requests. Disk-capacity refusal leaves fresh files alone; increase the budget or wait for expiry. A corrupt manifest disables acquisitions and preserves uncertain files instead of guessing which live recordings to delete. A file unreadable by the mixer is removed from the queue with an operator diagnostic, while library/coast playback continues.

## Development smoke test

Ordinary automated tests use mocked Qobuz/CDN responses. To run a deliberate live check, create a 0600 credentials file outside Git containing `QOBUZ_APP_ID`, `QOBUZ_APP_SECRET`, `QOBUZ_USER_AUTH_TOKEN` and `QOBUZ_USER_ID`. Do not paste values into chat, shell arguments or logs.

With Node 22 and ffprobe/ffmpeg installed:

```sh
smoke_state=$(mktemp -d "${TMPDIR:-/tmp}/subwave-qobuz-smoke.XXXXXX")
cd controller
npx tsx scripts/qobuz-smoke.ts \
  --credentials-file "$HOME/.config/obiwave/qobuz-development.env" \
  --state-dir "$smoke_state" \
  --query 'Bohemian Rhapsody by Queen' \
  --album 'A Night At The Opera'
```

The selected directory must be empty and beneath the system temporary directory. The command authenticates, searches, downloads and decodes an exact recording, verifies cache reuse without another provider search/file-URL request, advances a private test clock to verify renewal/deletion, and removes its cache. It never queues live audio, writes production settings or modifies Navidrome. An optional album name can distinguish otherwise ambiguous catalogue editions. A catalogue ambiguity is reported rather than choosing the first result.
