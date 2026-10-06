# Player pause verification for #1776

The shared transport now has separate play, pause and stop commands. Skin
buttons still toggle play/pause. Supported iOS devices attach an 8,044-byte,
0.5-second local WAV on pause, without playing it. Other browsers unload the
stream. Resume uses a fresh authenticated stream URL. Stop, idle cutoff and
element removal unload the source and release any blob URL.

## Automated verification

`verify-player.mjs` bundles the actual player and media-session hooks into an
isolated React fixture. It serves paced MP3 data and counts open HTTP stream
connections. It does not use Icecast, a controller, or station state. Optional
tools are installed separately from the application's dependency manifest.

```sh
npm install --prefix /tmp/player-tools --no-save esbuild playwright
/tmp/player-tools/node_modules/.bin/playwright install chromium firefox webkit
VERIFY_TOOLS=/tmp/player-tools VERIFY_BROWSERS=chromium,firefox,webkit \
  node web/scripts/verify-player.mjs
```

Coverage includes repeated OS commands before React commits, 25 rapid cycles,
pause during pending play, stale promises and events, blob contents and release,
element replacement/removal, full stop, idle cutoff, autoplay refusal,
unsupported actions/API, failed blob creation, codec selection/failure recovery,
and preservation of stream query parameters and authentication. iPhone and
iPad user-agent cases exercise the platform branch on each desktop engine.

The script also supports the real `/`, `/listen` and `/landing` contained player
through `VERIFY_WEB` and `VERIFY_FIXTURE_ORIGIN`. Its header documents the local
Next environment. Browser requests to other origins are blocked in this mode.

On 2026-10-05, all 150 fixture checks passed across Chromium, Firefox
and desktop WebKit. The late-rejection regression verifies an advancing media
clock, an unchanged stream source and one open connection after an older play
attempt rejects. Removing the generation guard makes that regression fail.
The production build also passed 18 route checks across those browsers. Local lint/typecheck passes with five warnings in unchanged
files. The real home, listen and
contained landing player were checked against the isolated fixture, including
UI tune controls, OS commands and navigation cleanup. The dev-server browser
check showed the player controls and no error overlay or uncaught page errors.

## Real Icecast verification

An isolated Icecast 2.4.0-kh22 and Liquidsoap 2.4.5 run exercised the actual
combined hooks against a 128 kbps MP3 mount. Chromium, Firefox and desktop
WebKit each passed ordinary and iOS-user-agent branches: 60 settled cycles
and 150 rapid cycles in total. Icecast reported zero listeners after pause
and one after resume; resumed connections had new client IDs and fresh URLs.
The publisher kept advancing while listeners were paused. Full stop and
navigation released the connections and every paused-clip blob. All six
cases ended with no residual listeners or page errors.

These tests used native media decoding and measured Icecast's own client list.
They invoked captured Media Session handlers; they did not deliver real
lock-screen commands on an iPhone.

## Physical device validation: pending

No physical iPhone was available. Desktop WebKit, mocked OS action delivery and
iOS user-agent selection do not establish iOS lock-screen ownership. The paced
HTTP fixture proves connection cancellation in desktop browsers. Real Icecast
listener-count checks are recorded separately; neither establishes iPhone
lock-screen ownership.

On a real iPhone, record the iOS version, Safari tab or installed PWA mode,
station build and stream codec. Start Apple Music first, then tune in to the
station, lock the phone, pause from the lock screen, wait several seconds and
press play. Confirm the station resumes live and Apple Music stays paused.
Repeat at least ten times, including rapid presses and a longer pause. Confirm
pause closes the Icecast connection and leaves no audible or silent background
playback. Check full stop/navigation releases the session, and repeat for the
home, listen and embedded player. Record those results before marking the
reported iOS lock-screen failure verified.

## Fork v1.18 integration verification (2026-10-05)

The combined fork hooks passed 159 fixture checks across Chromium, Firefox and
WebKit (ordinary desktop, iPhone UA and iPad UA branches). The actual `/`,
`/listen` and `/landing` pages passed 18 UI pause/resume and navigation checks
across the three browsers. A separate isolated controller with fresh state and
an attested dummy Subsonic backend verified Gemini library-language and
pronunciation saves, reload persistence, and compatibility-provider/key
preservation. No browser page errors occurred. Full web tests, lint/typecheck
and the production build passed; lint reports nine existing warnings.

The fixture needed two fork-specific corrections: its codec expectation now
preserves Safari's deliberate Opus exclusion, and WebKit's exact two-byte
`Range: bytes=0-1` probe receives a finished 206 response instead of an endless
MP3 stream. Diagnostics showed that probe and playback sharing the same fresh
URL/generation, including when the original upstream hook was substituted.
The response reports `Content-Range: bytes 0-1/*`: the live stream's total
length is unknown. The full playback response remains paced and unbounded.
Checks still require exactly one full live connection and zero connections
after pause, stop, element removal or navigation; HTTP cancellation is checked
within the same five-second bound used by the other lifecycle assertions.

These runs remain desktop browser evidence; physical iPhone lock-screen
ownership still needs device validation as described above.
