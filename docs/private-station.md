# Private station mode

SUB/WAVE is public by default: anyone with the address can open the player and
anyone who guesses `/stream.mp3` can listen. If you'd rather keep your station
to yourself (issue #478), **admin → Settings → Station → Privacy** gives you
two independent locks.

Both locks share **one station password**, set in the same place. Turning on
either lock requires a password first.

## Private player (UI lock)

Swaps the public web pages (`/`, `/listen`) for a password prompt. Type the
station password and the player appears as normal; the browser remembers it.
The SUB/WAVE app shows the same prompt in place of its player. `/admin` and
`/onboarding` keep working (the admin console keeps its own separate sign-in).
Applies live — no restart.

This only hides the interface. The now-playing JSON endpoints stay public
(the player and admin dash rely on them), and the stream URL still works —
for actual gating you want the stream password too.

## Stream password (the real boundary)

Turns on Icecast listener authentication for every mount (`/stream.mp3`,
`/stream.opus`, `/stream.flac`, `/stream.aac`). The same station password, for
all listeners — Icecast only speaks HTTP basic auth, so there are no per-user
accounts (and no OIDC; that's not viable for a live audio stream).

How it works under the hood: the controller writes
`state/icecast_listener_auth.txt`, and on the next broadcast restart the
Icecast config gains per-mount `<authentication type="url">` blocks pointing
at the controller's `POST /listener-auth`. Icecast asks the controller on
every listener connect, so:

- **Enabling/disabling needs a mixer restart** (the admin UI tells you, same
  as the Opus/AAC toggles).
- **Password changes apply live** — the controller validates each connect
  against the current settings.
- **If the controller is down, new listeners can't connect** (fail closed);
  already-connected listeners keep playing.

> **Running your own reverse proxy?** `POST /listener-auth` answers 200 or 401
> depending on whether the submitted password is right, which makes it a
> password oracle for anyone who can reach it — and it's the *same* password
> that guards the private player. Icecast always calls the controller directly
> over the internal network, so the endpoint never needs to be reachable from
> the internet. The bundled Caddy config returns 404 for
> `/api/listener-auth` and everything under it; if you use
> `docker-compose.byo.yml` with your own Traefik/nginx/Caddy, block that path
> too — as a case-insensitive prefix, since the controller also answers a
> trailing slash and any case
> ([recipes](reverse-proxy.md#the-route-contract)). As backstops, the
> controller refuses any call carrying a proxy's forwarding headers
> (`X-Forwarded-For` and the like — Icecast's own call has none) and slows
> repeated failed attempts (correct passwords are never delayed), but not
> exposing the path at all is the real protection.

### Tuning in with a password

- **Web player** — asks for the password once and remembers it in the
  browser. If the private player is on too, the single prompt unlocks both the
  interface and the audio. Under the hood it rides a `?auth=PASSWORD` token on
  the stream URL (browsers can't attach basic auth to an `<audio>` element).
- **Radio apps / VLC / Sonos / hardware** — use a credentialed URL:
  `https://listener:PASSWORD@your-station.example/stream.mp3`
  (any username works; only the password is checked).
- **Anything that can't do userinfo URLs** — append the token instead:
  `https://your-station.example/stream.mp3?auth=PASSWORD`.
- **SUB/WAVE app** — asks for the station password when either lock is on,
  checks it with `POST /station-auth`, and stores it per station in the device's
  Keychain/Keystore, separately from any **Station login**. The saved and
  displayed station address stays credential-free; the station password is
  added as `?auth=` only when building the stream URL. Google Cast can play
  this URL when the station has no saved **Station login**. An earlier
  **Station login** containing the stream password is adopted after the
  station verifies it; its saved login still keeps Cast unavailable until
  that login is removed. Rotating the password prompts again when the station
  is next opened, or after playback stalls.

While the password is on, `/listen.pls` and `/listen.m3u` return 403 — they
would otherwise hand out credential-less URLs that no longer play.

## A different thing: HTTP Basic Auth in front of the whole station

Everything above is SUB/WAVE's *own* privacy lock. Plenty of operators instead
put **HTTP Basic Auth on the reverse proxy** (nginx `auth_basic`, Caddy
`basic_auth`, Traefik's `BasicAuth` middleware), which gates the admin UI, the
player, the API and the streams in one go — before a request ever reaches the
controller.

> Identity proxies like **Cloudflare Access** are a different mechanism and are
> **not** supported by the apps: they authenticate with an SSO session cookie
> (or `CF-Access-Client-*` service-token headers), not HTTP Basic Auth, so
> there is no Basic Auth username/password pair for the app to send. Everything
> below is about plain basic auth.

Plain basic auth works in both mobile apps. Enter the public station address,
open **Station login**, then fill in the username and password. The app takes
the same scoped header approach for these requests:

- **API polls, same-origin artwork, and the audio stream** all keep a
  URL without proxy credentials and attach an explicit `Authorization: Basic`
  header. If SUB/WAVE's own stream password is also enabled, the audio URL
  additionally carries its separate `?auth=` token. Keeping proxy credentials
  out of URLs protects diagnostics and cache keys; the
  explicit stream header is also required because **iOS's AVPlayer silently
  drops `user:pass@` userinfo from a media URL** (and Android's player is no
  more reliable about it). Third-party persona artwork receives no station
  header. Without the explicit audio header, a basic-auth station can report
  *Stream Unreachable* / HTTP 401 in the app while the same login plays in a
  browser, VLC, or `curl` (#764).

Things to know:

- **The station URL is stored without credentials.** The username and password
  live in this device's iOS Keychain or Android Keystore-backed secure storage.
  It is still a shared listening password, not an account — don't reuse a
  password that matters.
- **An authenticated bare address never falls back silently to HTTP.** Type an
  explicit `http://` address if a trusted station really has no TLS; the app
  asks before it sends the login over cleartext.
- **Google Cast is unavailable** for a station with a saved login (the cast
  button doesn't appear). A Chromecast fetches the stream itself, and it has no
  way to send the header. SUB/WAVE's own stream password is not affected:
  entered at the app's private-station prompt, it rides the stream URL.
- **Special characters need no percent-encoding in the fields.** Type the real
  username and password, including `@` or `:`.

Older app versions accepted `https://user:pass@host` addresses. On upgrade,
the app removes that userinfo from the saved station URL and migrates the
decoded credentials into secure storage.

Basic auth on the proxy and SUB/WAVE's own stream password are independent and
can be combined, but there's rarely a reason to: the proxy lock is broader
(it covers admin too) while the stream password is what lets you hand a
listener the stream without handing them the console.

## Known limits

- One shared password for both locks; rotating it logs every listener out
  (web and app listeners get re-prompted automatically).
- Metadata endpoints (`/api/now-playing`, `/api/state`) stay public.
- The landing broadsheet (`/landing`) is not gated — it exists to market a
  station, which is at odds with private mode; leave `SUBWAVE_HOMEPAGE=player`
  (the default) on a private install.
- The `?auth=` token appears in Icecast's access log on your own box.
