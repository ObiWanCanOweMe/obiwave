# CLAUDE.md — `web/`

Loaded when working under `web/`. Station-wide architecture lives in the root `CLAUDE.md`.

### Web UI (`web/`)

Next.js 16 App Router + React 19 + Tailwind. Routes:

- `/` — `PlayerApp` or `Landing`, chosen at request time by `SUBWAVE_HOMEPAGE` (`player` default).
- `/listen` (always player), `/landing` (always broadsheet), `/setup` (docs), `/onboarding` (first-run wizard, the in-browser counterpart to `npm run setup`).
- `/admin`, `/admin/settings`, `/admin/debug` — admin shell behind a **single sign-in gate** (`AdminShell` + `useAdminAuth` in `web/lib/adminAuth.js`). Credentials cached in `localStorage` as `base64(user:pass)`, dropped on sign-out.

**Player = shell + skin.** `PlayerApp` mounts `components/player/PlayerShell.tsx`: the headless core (`PlayerCore.tsx` — feed/audio/actions contexts split by update cadence, plus the OS media session) with the `<audio>` element, contained-embed portal plumbing, and toaster; the shell resolves the active **skin** from the registry (`components/skins/index.ts`, contract in `components/skins/types.ts`; lazy chunks, SSR on). Skins ship in-repo: `classic` (the original face), `unit` (UNIT SW-9 — a milled-aluminium receiver with a dot-matrix display and TIMELINE/BOOTH/REQ windows; replaced the retired `spool` walkman deck, which aliases to it), `drift` (ambient cover-wash poster), `subamp` (1998 modular player with a live spectrum analyzer), `tty` (full TUI; the registry aliases the retired `terminal` id to it), and `platter` (the flagship vinyl face). Shared pure derivations live in `components/skins/shared.ts`. Selection mirrors themes end to end: operator default `settings.ui.skin` rides `GET /state`, listener override in `localStorage` (`subwave-skin-override`, picker in the palette menu — hidden unless >1 skin), unknown ids always fall back to classic. Rules for skins: consume only the core contexts + shared hooks, render the tune-in gate via `useTuneInGate` (the tap is the browser's audio-unblock gesture), honor the theme tokens, and co-locate styles — never touch `globals.css`. All controller fetches go through `lib/stationClient.ts` (install-level calls — themes, onboarding — use `defaultStationClient`, always same-origin). Install-level page effects (first-run redirect, audience beacon) live in `components/player/PlayerPageEffects.tsx`, mounted by `/` and `/listen` only — never by showcase embeds.

PWA-installable (`app/manifest.js`, `app/icon.js`, dynamic icon/screenshot routes via `next/og` ImageResponse — mind Satori's constraints). `useMediaSession` wires OS lock-screen / headphone / car controls; **skip is intentionally omitted** on the listener side so a stray AirPods double-tap doesn't skip for everyone.

Stream URL + API base default to same-origin (`/api`, `/stream.mp3`) for the prod image; dev overrides via `web/.env.local` (`NEXT_PUBLIC_API_URL=http://localhost:7701`, `NEXT_PUBLIC_STREAM_URL=http://localhost:7702/stream.mp3`).

### Fork contracts

- **Authenticated four-format playback**: `AudioFormat` is exactly `'mp3' | 'opus' | 'aac' | 'flac'`. Intersect station-advertised mounts with browser support, restore the preference under the station-scoped key, and fall back permanently to MP3 when an optional mount fails. Every tune, format switch, and watchdog reconnect assigns a URL through `withStreamAuth(apiUrl, ...)`. Audio-node detach/remount must remove listeners, pause, clear the private URL, and reset playback state before binding the replacement node.
- **Listener timing**: `usePlayer` exposes `getListenerLagMs(): number | null`. While playing, measured lag (`buffered.end - currentTime`) wins. Otherwise `useStationFeed` uses the active format's `stream.bufferSecondsByFormat` entry, with legacy `stream.bufferSeconds` fallback, and delays the listener-facing track switch; admin/operator surfaces remain at the live edge.
- **Provider forms**: settings and onboarding preserve provider-scoped URLs and inline keys for the active primary/fallback/embedding/TTS provider. Provider, URL, model, or typed-key changes invalidate prior discovery/probe generations, and stale async results must never overwrite the current provider's form state.
