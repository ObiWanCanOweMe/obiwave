# Community apps directory

**Date:** 2026-08-03
**Status:** design, approved for planning

## Summary

Add **apps** as a fifth community catalog type, alongside skills, personas, shows
and stations. People are building clients and integrations against SUB/WAVE
stations — native apps, alternative web players, TUIs, bots, MCP servers — and
there is nowhere to list them. This gives them a public directory at `/apps`, a
teaser section on the landing page, and a one-click submission path.

It reuses the machinery that already exists end to end: an entry is one JSON file
in the `getsubwave/community` repo, a GitHub issue form turns into a one-file PR
via a bot, CI rebuilds `catalog.json`, and the web tier live-fetches that index.
Nothing new is invented — apps are the same shape of problem as stations.

## Goals

- A public, browsable directory of third-party SUB/WAVE apps and integrations.
- Submission with no fork, no JSON, no repo access — a GitHub issue form.
- Entries refresh without a web redeploy (live catalog fetch, same as stations).
- Each card carries enough to decide: what it is, who made it, what it runs on,
  and what it looks like.

## Non-goals

- **No install path.** Unlike skills/personas/shows, an app is not installed into
  a station. This is a browse-and-link directory, like `/stations`.
- **No controller work.** Verified: `controller/src/community/registry.ts` picks
  named keys off the catalog (`skills`, `personas`, `shows`, `stations`) and
  ignores everything else. An `apps` array is inert to a running station.
- **No skins/themes.** Player skins live in-repo (`web/components/skins`) with no
  external submission path at all. Listing them is a separate, larger problem.
- **No ratings, download counts, versions, changelogs, or pricing.** A directory
  entry is a pointer, not a store listing.

## What counts as an app

Anything third-party that talks to a SUB/WAVE station. One required `type` field
puts each entry in exactly one bucket, and the bucket set is deliberately small —
six chips that a reader can scan, not a taxonomy:

| `type`        | What lands here                                              |
| ------------- | ------------------------------------------------------------ |
| `mobile`      | iOS / Android / cross-platform handset apps                   |
| `web`         | Alternative web players, embeds, hosted front-ends            |
| `desktop`     | macOS / Windows / Linux clients, menubar and tray apps        |
| `terminal`    | TUIs and CLIs                                                 |
| `bot`         | Discord / Telegram / Slack / Matrix bots                      |
| `integration` | Everything else that wires a station into another system — MCP servers, Home Assistant, hardware builds, libraries and SDKs |

`integration` is deliberately a catch-all. Splitting out `hardware` or `library`
now would ship three chips that each hold one entry.

## Data model

One file per app: `apps/<slug>.json` in the community repo. The filename minus
`.json` is the slug, exactly as stations work — one file per entry keeps PRs from
colliding and makes each trivially reviewable or revertible.

```json
{
  "name": "Night Owl",
  "url": "https://apps.apple.com/app/night-owl",
  "type": "mobile",
  "description": "A one-thumb SUB/WAVE player with a sleep timer and CarPlay.",
  "author": "@yourhandle",
  "platforms": ["iOS", "Android"],
  "repo": "https://github.com/yourhandle/night-owl",
  "icon": "https://raw.githubusercontent.com/yourhandle/night-owl/main/icon.png",
  "screenshot": "https://raw.githubusercontent.com/yourhandle/night-owl/main/shot.png",
  "featured": false,
  "submitted": "2026-08-03"
}
```

| Field        | Required | Rules                                                                 |
| ------------ | -------- | --------------------------------------------------------------------- |
| `name`       | yes      | Display name. Trimmed, non-empty.                                     |
| `url`        | yes      | Where you get it — store listing, site, or repo. Must be `http(s)://`. |
| `type`       | yes      | One of the six above. Anything else is a build error.                 |
| `description`| no       | One or two sentences, capped at 280 chars.                            |
| `author`     | no       | Name or `@handle`. A leading `@` renders as a GitHub link, matching `CommunitySkillCard`. |
| `platforms`  | no       | Up to 6 short tags, ≤24 chars each. Free text ("iOS", "Sonos", "Home Assistant"). |
| `repo`       | no       | Source URL. Its presence is what renders a "source available" marker — there is no separate boolean to contradict it. |
| `icon`       | no       | Square image URL. Host-allowlisted (below).                           |
| `screenshot` | no       | Wide image URL. Host-allowlisted (below).                             |
| `featured`   | no       | Maintainer-only; the bot always writes `false`. Floats to the top.    |
| `submitted`  | no       | `yyyy-mm-dd`, stamped by the bot from the issue's creation date.      |

`slug` is stamped by the catalog builder from the filename and is not a field
submitters write, same as stations.

## Image policy

Submitter-hosted image URLs are the chosen trade-off, but "any URL" would mean
listener browsers fetching from arbitrary hosts and an image that can be swapped
to anything after review. Two constraints contain that:

1. **Host allowlist.** `icon` and `screenshot` must be `https://` on one of
   `raw.githubusercontent.com`, `user-images.githubusercontent.com`, or
   `github.com`. Enforced as a hard error in the catalog builder, so a bad URL
   fails CI on the submission PR rather than reaching the site.
2. **Rendered through `next/image`.** Add an `images.remotePatterns` block to
   `web/next.config.js` for exactly those three hosts. This is the real
   enforcement: the framework refuses to render anything else, and images are
   proxied and optimised by the site rather than hot-linked, so a listener's
   browser never contacts the submitter's host directly.

`web/lib/apps.ts` re-checks the same allowlist and **drops the offending field
while keeping the app**. `catalog.json` is a live remote fetch, so the web tier
cannot assume the builder that validated it is the one that produced what it just
received; a non-allowlisted URL reaching `next/image` throws at render and would
take the whole page down. Dropping the image degrades one card instead.

Rendering: `icon` in a 1:1 box, `screenshot` in a 16:10 box, both `loading="lazy"`.
Cards render fine with neither.

## Community repo changes (`getsubwave/community`)

1. **`apps/` directory** with a `README.md` mirroring `stations/README.md` — the
   easy path (issue form) and the by-hand path (fork + one JSON file), plus the
   listing policy below.
2. **`scripts/build-catalog.mjs`** — add `buildApps()` alongside `buildStations()`,
   wire it into the `Promise.all` and into the emitted `catalog` object and the
   `counts` log line. Stations are pass-through (`name`/`url` only); apps validate
   harder because `type` drives UI and the image URLs are a trust boundary:
   required `name`/`url`/`type`, `url` scheme, `type` membership, image host
   allowlist, description length, `platforms` bounds.
3. **`.github/ISSUE_TEMPLATE/add-app.yml`** — modelled on `add-station.yml`. Name,
   URL and type required (type as a `dropdown` so the six values can't be
   mistyped); everything else optional with placeholder guidance. Labels:
   `["app-submission"]`.
4. **`.github/workflows/app-submission.yml`** — a direct adaptation of
   `station-submission.yml`: `DIR = 'apps'`, the field-heading map for this form,
   branch `app/<slug>`, PR title `feat(apps): add <name>`, label `apps`. Keep its
   security posture verbatim — the issue body is untrusted and must stay inside
   `actions/github-script` (REST + base64), never interpolated into a `run:` step,
   and the slug stays sanitised to `[a-z0-9-]`.
5. **Repo labels.** `app-submission` and `apps` must be created as real labels
   before the form ships. The station workflow carries an explicit note about
   this: if the label doesn't exist, GitHub silently drops it from the template
   and the workflow's `if:` guard never matches — every run shows "skipped" with
   no error anywhere.
6. **`.github/ISSUE_TEMPLATE/report-app.yml`** — clone of `report-station.yml`,
   for reporting or requesting removal of a listed app.
7. **`.github/ISSUE_TEMPLATE/config.yml`** and `CONTRIBUTING.md` — mention apps.

## Web changes (`web/`)

**`lib/apps.ts`** — the loader, modelled on `lib/stations.ts`:

- `export interface CommunityApp` — the shape above plus `slug`.
- `parseApp(raw)` — coerce one catalog entry; return `null` when `name`, `url` or
  a valid `type` is missing; drop non-allowlisted image URLs; clamp `platforms`
  and `description`.
- `getAllApps(): Promise<CommunityApp[]>` — reads `fetchCommunityCatalog().apps`,
  parses, sorts featured-first then alphabetical. `arr()` in `communityCatalog.ts`
  already returns `[]` for a missing key, so an older `catalog.json` with no
  `apps` array is an empty directory, not a crash — the web tier can ship before
  or after the community repo without ordering risk.
- `appStats(all)` — pure, over an already-loaded list: total count and count of
  distinct `type`s. Pure and list-taking for the same reason `stationStats` is —
  `/apps` streams the list into several Suspense boundaries and a helper that
  re-entered the loader would issue a second catalog fetch per render.
- `getShowcaseApps(all, limit = 6): CommunityApp[]` — pure, over an
  already-loaded list; featured first, then newest by `submitted`, capped for
  the landing teaser. No separate `ShowcaseApp` type: `ShowcaseStation` exists
  because the landing player tabs cross a server→client boundary and carry
  local-station logic, and the teaser is a server component with neither.

**`lib/communityCatalog.ts`** — add `apps` to `CommunityCatalog`, `EMPTY`, and the
`fetchCommunityCatalog` return.

**`lib/repo.ts`** — `appSubmitUrl()` and `reportAppUrl()`, following the existing
`communitySubmitUrl` helper.

**`components/apps/AppCard.tsx`** — a server component (no live probe; unlike a
station there is nothing to poll). Renders: screenshot (if any), icon + name,
type chip, description via the shared `CatalogBrief`, platform tags reusing the
`bs-skill-tag` treatment, author credit in the `bs-skill-credit` pattern, and up
to two links — "Get it" (`url`) and "Source" (`repo`, when present). Existing
`bs-*` broadsheet classes throughout; new styles co-locate rather than growing
`globals.css` where that is avoidable.

**`components/apps/AppTypeFilter.tsx`** — a client component rendering the six
chips plus "All". Filtering is client-side over the already-rendered list; the
directory is small enough that a route param and a re-render would be
ceremony. Chips for types with zero entries are hidden.

**`app/apps/page.tsx`** — mirrors `app/stations/page.tsx` structurally:
`export const dynamic = 'force-dynamic'`, `pageMeta`, the list promise started
and not awaited, `<Suspense>` around the stat strip and the grid with the
existing `CatalogStatSkeleton` / `CatalogGridSkeleton`. Eyebrow `THE RECEIVERS`,
heading "Community Apps.", a `bs-station-cta` block with "Submit an app" +
"How it works", and a closing `bs-stations-report` line carrying the disclaimer
and the report link.

**`app/apps/layout.tsx`** and **`loading.tsx`** — copy the `/stations` pair.

**`components/what/TheReceivers.tsx`** — the landing teaser. Takes an
`apps: ShowcaseApp[]` prop, renders up to 6 icon-and-name tiles with a "See all
N apps →" link to `/apps`. **Returns `null` when the list is empty** — a
self-hosted station with no catalog reach must not render an empty section on its
landing page. Mounted in `components/Landing.tsx` after `Navidrome`, before
`Coda`: the ecosystem beat reads best as a closing note, after the reader has
seen what the station itself is.

**`components/Landing.tsx`** and **`app/landing/page.tsx`** — thread the app list
through the same way `stations` already is: the page resolves
`getShowcaseApps(await getAllApps())` and passes it as a prop, `Landing` forwards
it to `TheReceivers`. `app/page.tsx` renders `Landing` too when
`SUBWAVE_HOMEPAGE=landing` (verified) and needs the identical thread-through —
missing it is the easy bug here, since `/landing` would look correct while a
landing-mode homepage silently lost the section.

**`components/landing/StationFooter.tsx`** — apps become back page **06**: tag
"The Receivers", title "Community Apps". The panel grid moves from
`lg:grid-cols-5` to `lg:grid-cols-6` and the section label from `§§ 01–05` to
`§§ 01–06`.

**`app/sitemap.ts`** — add `/apps` to `ROUTES`.

**`components/manual/Clients.tsx`** — one cross-link. `/manual/clients` is
"Listen With" (generic players: Sonos, VLC, car receivers); `/apps` is things
built *for* SUB/WAVE. Adjacent, distinct, worth pointing at each other.

## Trust, safety and listing policy

An app is software a reader may install, which is a heavier ask than a station's
"click this URL". Three things carry that:

1. **The disclaimer.** "Apps are built and maintained by their authors, not by
   SUB/WAVE" — the same footing as the stations directory, in the same
   `bs-stations-report` slot, next to the report link.
2. **A report path.** `report-app.yml`, linked from the page.
3. **Listing rules** in `apps/README.md`, applied by maintainers at review:
   - It must actually work against a SUB/WAVE station.
   - It must not ask listeners for their station's admin credentials, or route
     them through a third party that receives those credentials.
   - Closed-source and paid apps are welcome, but must say so plainly in the
     description — an entry with no `repo` and no disclosure gets a review note.
   - No malware, no undisclosed telemetry, no ad injection into the stream.

## Error handling and degradation

Every failure mode already has a precedent, and all of them degrade to "less
content", never to a broken page:

| Failure                          | Result                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| Catalog unreachable / bad JSON    | `fetchCommunityCatalog` returns `EMPTY`; `/apps` shows its empty state, landing section renders nothing. |
| Catalog has no `apps` key (old)   | `arr()` → `[]`. Same as above. |
| One malformed entry               | `parseApp` returns `null`; that entry is skipped, the rest render. |
| Image URL off the allowlist       | Field dropped, card renders without it. |
| Image host 404s at request time   | `next/image` renders the broken-image state in a fixed box; layout holds. |
| Zero apps in the catalog          | Empty state on `/apps` with the submit CTA; no landing section. |

## Testing and verification

`web/` has no test suite and `npm run lint` (`eslint . && tsc --noEmit`) is the
merge gate, so verification is lint plus a real render.

**Community repo:** `node scripts/build-catalog.mjs --check` is already in CI.
Add app fixtures that exercise the new validators — a full entry, a
name/url/type-only entry, and (as deliberate failures checked by hand before
committing the passing set) an unknown `type` and a non-allowlisted image host.

**Web:** `npm run lint` in `web/`, then render against a stub catalog rather than
the live one, so edge cases are reachable:

```bash
# serve a stub catalog.json carrying sample apps
cd web && COMMUNITY_CATALOG_URL=http://127.0.0.1:8099/catalog.json \
  npm run dev -- --webpack
```

`--webpack` is required: Turbopack panics on this worktree's symlinked
`node_modules`. Cases to have in the stub: an app with everything, one with no
icon and no screenshot, one with a 280-char description, one per `type` so every
filter chip appears, one with a non-allowlisted image host (must render without
the image, not 500), and an empty `apps: []` (landing section must vanish).

Check by hand: `/apps` renders and filters; the landing teaser appears and links
through; the footer shows six panels and reads `§§ 01–06`; `/sitemap.xml`
contains `/apps`.

## Rollout

Two repos, two PRs, community repo first:

1. **`getsubwave/community`** — `apps/` + README, builder, issue forms, workflow,
   labels. Merging republishes `catalog.json` with `apps: []`, which every
   existing station and the current site ignore harmlessly.
2. **`perminder-klair/subwave`** (→ `develop`) — the web tier. Ships against a
   catalog that already has the key.

Seeding matters more than the code here: the directory should not launch empty.
Collect the apps people have already built and land them as maintainer PRs before
the web PR merges — the `subwave-web-player` starter and the MCP server are
obvious first entries.

## Deferred

Cut from v1, listed so they are decisions rather than omissions:

- **Search.** Six chips over a short list is enough until the directory is large.
- **Per-app detail pages.** Cards link out; a `/apps/<slug>` page is a second hop
  to content the author's own page already carries better.
- **Skins and themes as catalog types.** Needs an external submission path for
  in-repo skins first.
- **Multiple screenshots / galleries.** One is enough to convey a look.
- **`hardware` and `library` types.** Folded into `integration` until either has
  enough entries to fill a chip.
- **An `apps` accessor on the controller registry.** Nothing on a station
  consumes it; add it if an admin-side "apps" browser is ever wanted.
