#!/usr/bin/env bash
# SUB/WAVE all-in-one supervisor.
#
# Runs the whole stack — icecast2 + liquidsoap (the broadcast pair), the
# controller, the Next.js web UI, and Caddy — inside ONE container for the
# Unraid Community Applications one-click image (docker/Dockerfile.aio).
#
# The split-stack deployment runs these as five compose services wired over an
# internal network; here they all share localhost and the /var/sub-wave volume,
# so the file-based IPC (next.txt / say.txt / now-playing.json …) works exactly
# as before with no code changes — only a handful of *_HOST/*_URL env overrides
# repoint the controller at loopback.
#
# Each service runs in its own restart loop, so a web or controller crash does
# NOT take the station off the air. The icecast+liquidsoap pair is launched as a
# unit (mirroring docker/broadcast-entrypoint.sh): if either dies the pair is
# bounced together, because liquidsoap is useless without its icecast sink.
#
# Bash (not /bin/sh) for `wait -n`; the savonet/liquidsoap base ships bash.
set -u

SECRETS=/var/sub-wave/icecast-secrets.env
TEMPLATE=/etc/icecast2/icecast.xml.template
RENDERED=/etc/icecast2/icecast.xml

# Multi-station pointer (see docker/broadcast-entrypoint.sh — kept in lockstep).
# Called at the top of run_broadcast so every mixer relaunch re-resolves.
STATE_ROOT=/var/sub-wave
STATE_DIR="$STATE_ROOT"
resolve_state_dir() {
	STATE_DIR="$STATE_ROOT"
	local active="$STATE_ROOT/stations/active.json" id=""
	if [ -f "$active" ]; then
		id=$(sed -n 's/.*"activeId"[[:space:]]*:[[:space:]]*"\([a-z0-9][a-z0-9-]\{0,40\}\)".*/\1/p' "$active" | head -n1)
		if [ -n "$id" ] && [ -d "$STATE_ROOT/stations/$id" ]; then
			STATE_DIR="$STATE_ROOT/stations/$id"
			log "active station '$id' → $STATE_DIR"
		else
			log "WARNING stations/active.json unresolvable (id='$id') — using root"
		fi
	fi
	export SUBWAVE_STATE_DIR="$STATE_DIR"
}

log() { echo "[subwave-aio] $*" >&2; }

# ---------------------------------------------------------------------------
# One-time state bootstrap — shared dirs, watch-mode m3u stubs, archive ignore.
# Same responsibilities as docker/broadcast-entrypoint.sh, minus launching the
# audio processes (the supervisor does that in a restart loop below). Mode 777
# because the services run under different uids (icecast2 / liquidsoap / root).
# ---------------------------------------------------------------------------
init_state() {
	mkdir -p /var/sub-wave \
	         /var/sub-wave/voice \
	         /var/sub-wave/voices \
	         /var/sub-wave/archive \
	         /var/sub-wave/jingles \
	         /var/sub-wave/logs \
	         /var/sub-wave/sessions \
	         /var/sub-wave/sfx
	chmod 777 /var/sub-wave \
	          /var/sub-wave/voice \
	          /var/sub-wave/voices \
	          /var/sub-wave/archive \
	          /var/sub-wave/jingles \
	          /var/sub-wave/logs \
	          /var/sub-wave/sessions \
	          /var/sub-wave/sfx

	# Liquidsoap's reload_mode="watch" playlists need the files to exist.
	touch /var/sub-wave/auto.m3u /var/sub-wave/jingles.m3u
	chmod 666 /var/sub-wave/auto.m3u /var/sub-wave/jingles.m3u

	# Keep a co-located Navidrome from scanning the station's own hourly
	# archive mixdowns as junk "HH-00" tracks (issue #273).
	touch /var/sub-wave/archive/.ndignore

	# Liquidsoap writes radio.log to /var/log/liquidsoap. Point that at the
	# state ROOT's logs/ so the log survives container recreates and the
	# controller's debug page can tail it (routes/debug.ts reads
	# <stateRoot>/logs/radio.log — the same install-level location the
	# compose stacks pin via their ${STATE_DIR}/logs bind mount). A plain
	# in-container dir here left AIO installs with no radio.log in the
	# state dir at all, so the debug tail always errored ENOENT.
	if [ ! -L /var/log/liquidsoap ]; then
		rm -rf /var/log/liquidsoap
		ln -s /var/sub-wave/logs /var/log/liquidsoap
	fi

	# Rotate radio.log on boot once it passes 50MB — same policy as
	# docker/broadcast-entrypoint.sh. Now that the log persists in state,
	# it would otherwise append forever; boot is the one safe moment to
	# move it since liquidsoap isn't holding the fd yet. One .old
	# generation caps disk at ~2x the threshold.
	RADIO_LOG=/var/sub-wave/logs/radio.log
	if [ -f "$RADIO_LOG" ] && [ "$(stat -c %s "$RADIO_LOG" 2>/dev/null || echo 0)" -gt 52428800 ]; then
		mv -f "$RADIO_LOG" "$RADIO_LOG.old"
		echo "supervisor: rotated oversized radio.log to radio.log.old" >&2
	fi
}

# ---------------------------------------------------------------------------
# Warn loudly if the state dir isn't a mounted volume. With no host path (or
# volume) mapped to /var/sub-wave, everything the station writes — settings,
# library.db with the acoustic analysis, hourly archives, the model cache —
# lives in the container's throwaway writable layer, and the next image update
# (which recreates the container) silently wipes it. The Unraid CA template maps
# this as a required Appdata path; a bare `docker run` that forgets `-v` is the
# footgun this catches (issue #902). A real bind/volume mount gets its own entry
# in /proc/mounts at the target path; an un-mapped dir on the overlay fs doesn't.
# ---------------------------------------------------------------------------
warn_if_state_unmounted() {
	if ! grep -q ' /var/sub-wave ' /proc/mounts 2>/dev/null; then
		log "################################################################"
		log "WARNING: /var/sub-wave is NOT a mounted volume."
		log "  Your settings, library cache (library.db), hourly archives and"
		log "  model cache are being written into the container's writable"
		log "  layer, and will be LOST the next time this image is updated."
		log "  Map a host path to /var/sub-wave (on Unraid: the Appdata path,"
		log "  e.g. /mnt/user/appdata/subwave) and recreate the container."
		log "  https://github.com/perminder-klair/subwave/issues/902"
		log "################################################################"
	fi
}

# ---------------------------------------------------------------------------
# Resolve the three ICECAST_*_PASSWORD values and render icecast.xml.
# Precedence (unchanged from broadcast-entrypoint): env override > persisted
# state/icecast-secrets.env > freshly generated. Resolved values are exported
# (liquidsoap reads ICECAST_SOURCE_PASSWORD from the environment) and written
# back to the secrets file for operator visibility + the documented rotate path.
# ---------------------------------------------------------------------------
init_secrets() {
	local ENV_SRC="${ICECAST_SOURCE_PASSWORD:-}"
	local ENV_ADM="${ICECAST_ADMIN_PASSWORD:-}"
	local ENV_REL="${ICECAST_RELAY_PASSWORD:-}"

	if [ -f "$SECRETS" ]; then
		# shellcheck disable=SC1090
		. "$SECRETS"
	fi

	[ -n "$ENV_SRC" ] && ICECAST_SOURCE_PASSWORD="$ENV_SRC"
	[ -n "$ENV_ADM" ] && ICECAST_ADMIN_PASSWORD="$ENV_ADM"
	[ -n "$ENV_REL" ] && ICECAST_RELAY_PASSWORD="$ENV_REL"

	[ -z "${ICECAST_SOURCE_PASSWORD:-}" ] && ICECAST_SOURCE_PASSWORD="$(openssl rand -hex 16)"
	[ -z "${ICECAST_ADMIN_PASSWORD:-}"  ] && ICECAST_ADMIN_PASSWORD="$(openssl rand -hex 16)"
	[ -z "${ICECAST_RELAY_PASSWORD:-}"  ] && ICECAST_RELAY_PASSWORD="$(openssl rand -hex 16)"

	cat > "$SECRETS" <<-EOF
		ICECAST_SOURCE_PASSWORD=$ICECAST_SOURCE_PASSWORD
		ICECAST_ADMIN_PASSWORD=$ICECAST_ADMIN_PASSWORD
		ICECAST_RELAY_PASSWORD=$ICECAST_RELAY_PASSWORD
	EOF
	# 0600: holds the Icecast passwords, read only by root (this supervisor
	# sources it, and the in-process controller reads it off the state dir —
	# all root in the AIO's single container). Keep it owner-only.
	chmod 600 "$SECRETS"

	export ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD
	# Liquidsoap connects to icecast over loopback inside this container;
	# radio.liq reads ICECAST_HOST (default "icecast").
	export ICECAST_HOST=localhost
}

# ---------------------------------------------------------------------------
# Render icecast.xml from the template + resolved secrets. Called on EVERY
# broadcast pair (re)launch — not just boot — so a restart-mixer picks up a
# flipped listener-auth flag the same way the split stack's container restart
# re-runs its entrypoint.
# ---------------------------------------------------------------------------
render_icecast() {
	ICECAST_STATE_DIR="$STATE_DIR" \
	ICECAST_TEMPLATE="$TEMPLATE" \
	ICECAST_RENDERED="$RENDERED" \
	LISTENER_AUTH_URL="${LISTENER_AUTH_URL:-http://localhost:7701/listener-auth}" \
		/usr/local/bin/icecast-render
	chown icecast2 "$RENDERED" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Service launchers. Each blocks until its process exits, so the supervise()
# loop can restart it. Do NOT `exec` — that would replace the loop.
# ---------------------------------------------------------------------------

# icecast2 + liquidsoap as a unit. Returns when either dies (the loop bounces
# the pair). icecast runs as the icecast2 user; liquidsoap as the liquidsoap
# user (uid 10000). `sudo -E` preserves the resolved ICECAST_* env.
run_broadcast() {
	# Re-resolve the active station on every pair launch — this is how a
	# station switch takes effect in the AIO without a container bounce (the
	# supervise loop re-runs run_broadcast after every mixer restart).
	resolve_state_dir

	# Bootstrap the resolved station dir's subdirs (mirrors init_state, but
	# scoped to $STATE_DIR — the root case is already covered by init_state at
	# boot, and a non-root station dir needs its own subdirs created here).
	mkdir -p "$STATE_DIR" \
	         "$STATE_DIR/voice" \
	         "$STATE_DIR/voices" \
	         "$STATE_DIR/archive" \
	         "$STATE_DIR/jingles" \
	         "$STATE_DIR/logs" \
	         "$STATE_DIR/sessions" \
	         "$STATE_DIR/sfx"
	chmod 777 "$STATE_DIR" \
	          "$STATE_DIR/voice" \
	          "$STATE_DIR/voices" \
	          "$STATE_DIR/archive" \
	          "$STATE_DIR/jingles" \
	          "$STATE_DIR/logs" \
	          "$STATE_DIR/sessions" \
	          "$STATE_DIR/sfx"
	touch "$STATE_DIR/auto.m3u" "$STATE_DIR/jingles.m3u"
	chmod 666 "$STATE_DIR/auto.m3u" "$STATE_DIR/jingles.m3u"
	touch "$STATE_DIR/archive/.ndignore"

	# Re-render on every pair launch so a flipped listener-auth flag lands
	# after a restart-mixer (which bounces this pair, not the container).
	render_icecast
	log "starting icecast2"
	sudo -E -u icecast2 icecast2 -n -c "$RENDERED" &
	local ic=$!

	# Give icecast a moment to accept HTTP so liquidsoap's first source
	# connect doesn't bail with "Cannot connect to remote host".
	local i
	for i in 1 2 3 4 5 6 7 8 9 10; do
		if curl -fsS http://localhost:7702/ >/dev/null 2>&1; then
			log "icecast accepting connections after ${i}s"
			break
		fi
		sleep 1
	done

	log "starting liquidsoap"
	# TEMPORARY (re-harden later): run liquidsoap as root instead of dropping to
	# the `liquidsoap` user — same reason as docker/broadcast-entrypoint.sh. The
	# savonet base bump 2.2.5 -> 2.4.4 changed that user's uid (10000 -> 100), so
	# state files persisted under /var/sub-wave by the old image became unwritable
	# to uid 100 and every on_meta write EACCES'd. Root ignores those perms.
	# Restore the privilege drop once the state files are chowned to the new uid
	# (radio.liq's settings.init.allow_root is set for the same reason).
	liquidsoap /etc/liquidsoap/radio.liq &
	local lq=$!

	wait -n "$ic" "$lq"
	local code=$?
	log "broadcast pair: a child exited ($code) — taking the other down"
	kill -TERM "$ic" "$lq" 2>/dev/null || true
	wait "$ic" "$lq" 2>/dev/null || true
	return "$code"
}

# Controller — the AI DJ brain. The *_HOST/*_URL overrides repoint it from the
# compose service names (broadcast:7702 / 1234) at loopback. DOCKER_HOST and
# TTS_HEAVY_URL are intentionally unset: the Stats system panel degrades
# gracefully and TTS falls back to the bundled Piper voice. All other config
# (Navidrome, LLM, ADMIN_*, SITE_URL, TZ) is inherited from the container env
# and the first-run wizard's settings.json.
run_controller() {
	cd /app || return 1
	export NODE_ENV=production \
	       STATE_DIR=/var/sub-wave \
	       SOUNDS_DIR=/sounds \
	       LIQUIDSOAP_HOST=127.0.0.1 \
	       ICECAST_STATUS_URL=http://127.0.0.1:7702/status-json.xsl \
	       ICECAST_ADMIN_URL=http://127.0.0.1:7702/admin/listclients
	node_modules/.bin/tsx src/server.ts
}

# Web — Next.js listener UI (standalone build).
run_web() {
	cd /web || return 1
	export NODE_ENV=production \
	       PORT=7700 \
	       HOSTNAME=0.0.0.0 \
	       CONTROLLER_INTERNAL_URL=http://127.0.0.1:7701 \
	       SUBWAVE_HOMEPAGE="${SUBWAVE_HOMEPAGE:-player}"
	node server.js
}

# Caddy — the single-origin edge that fronts all three on :80.
run_caddy() {
	caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
}

# ---------------------------------------------------------------------------
# supervise <name> <launcher-fn> — restart loop with backoff.
# ---------------------------------------------------------------------------
supervise() {
	local name="$1"; shift
	while true; do
		log "starting $name"
		"$@"
		local code=$?
		log "$name exited ($code) — restarting in 3s"
		sleep 3
	done
}

# ---------------------------------------------------------------------------
# Boot.
# ---------------------------------------------------------------------------
warn_if_state_unmounted
init_state
init_secrets

# On stop, signal the whole process group once, then give the children time to
# shut down before exiting (reset the trap first so the kill doesn't re-enter
# this handler). The grace period matters: this script is PID 1, and the
# instant it exits the container namespace is torn down and everything left
# gets SIGKILLed — which robbed the controller of its SIGTERM handler and left
# library.db's WAL sidecar un-checkpointed on every stop (#786). `wait` covers
# the supervise loops; the sleep covers their children (node etc.), which get
# reparented to us when the loops die and which bash's wait can't see. Docker's
# stop timeout (default 10s) still hard-caps the whole thing.
trap 'trap "" TERM INT; log "shutting down"; kill -TERM 0 2>/dev/null; wait; sleep 2; exit 0' TERM INT

supervise broadcast  run_broadcast  &
supervise controller run_controller &
supervise web        run_web        &
supervise caddy      run_caddy      &

wait
