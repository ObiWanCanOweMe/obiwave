---
name: verify
description: Drive a controller/admin-UI change end-to-end from a worktree without touching the live station — isolated controller on a spare port + temp STATE_DIR, worktree Next dev server, Playwright against /admin.
---

# Verifying controller + admin-UI changes in isolation

The operator's real station is usually running (docker `sub-wave-*` containers). Never restart or
point tests at it. Boot your own stack from the worktree instead:

## Isolated controller (API surface)

Generate one fresh marker per verification run and give it only to the
controller, verifiers, and the task-local Subsonic stub:

```bash
SUBWAVE_VERIFY_PROVENANCE="subwave-verify-$(uuidgen | tr '[:upper:]' '[:lower:]')"
export SUBWAVE_VERIFY_PROVENANCE
```

Before starting the controller, start a task-local dummy Subsonic server on
`127.0.0.1:9999` with that same environment variable. It must expose
`GET /__subwave_verify_provenance` returning JSON whose `verifyProvenance` is
the SHA-256 hex digest of `subwave-dummy-backend\0<marker>`. Keep all of its
fixtures and logs under the task's ignored evidence directory.

```bash
cd <worktree>/controller
STATE_DIR=$CLAUDE_JOB_DIR/tmp/state PORT=7791 ADMIN_USER=test ADMIN_PASS=test \
  NODE_ENV=development SUBWAVE_VERIFY_PROVENANCE=$SUBWAVE_VERIFY_PROVENANCE \
  NAVIDROME_URL=http://127.0.0.1:9999 NAVIDROME_USER=x NAVIDROME_PASS=x \
  npx tsx src/server.ts
```

- With a valid verifier marker, controller config fails before startup unless
  Navidrome is exactly the loopback dummy URL. `/health` then adds only an
  opaque attestation hash; production, absent-marker, and invalid-marker health
  responses keep their original shape.
- Run `verify-library.py` and `verify-query-cache.py` with the same exported
  marker and a Python interpreter that has Playwright installed. Their guard
  checks controller + stub attestations before any verifier mutation and never
  calls a controller route that proxies to Subsonic.
- A fresh `STATE_DIR` boots clean (seeds sfx/jingles, writes `settings.json` on first save).
- The fake `NAVIDROME_*` env matters: without it `needsSetup` is true and the admin shell
  redirects every page to `/onboarding`, so UI tests never find their controls.
- Drive `/settings` etc. with `curl -u test:test http://localhost:7791/...`.
- To test load-time migrations: stop the server, hand-edit `settings.json`, restart, GET.
- Kill by port (`fuser -k 7791/tcp`) — a `pkill -f "tsx src/server.ts"` matches the Bash tool's
  own wrapper cmdline and kills your shell (exit 144).

## Worktree web dev server (UI surface)

```bash
cd <worktree>/web
NEXT_PUBLIC_API_URL=http://localhost:7791 npm run dev -- -p 7793
```

Then Playwright (headless chromium, sync API):

- Pre-seed auth before load: `ctx.add_init_script("localStorage.setItem('subwave_admin_auth', '<base64 user:pass>')")`.
- Assert state through the controller API after clicking Save, not through sonner toasts.
- Admin modals portal into `.admin-root`; scope input lookups with `[role="dialog"]`.
