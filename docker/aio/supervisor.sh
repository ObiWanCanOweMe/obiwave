#!/usr/bin/env bash
# SUB/WAVE all-in-one supervisor — runs icecast2 + liquidsoap (the broadcast
# pair), the controller, the web UI, and Caddy in ONE container
# (docker/Dockerfile.aio). Everything shares localhost + /var/sub-wave, so the
# file-based IPC works unchanged; only *_HOST/*_URL overrides repoint loopback.
#
# Each service runs in its own restart loop, so a web or controller crash does
# NOT take the station off the air. The broadcast pair is launched as a unit
# (mirroring docker/broadcast-entrypoint.sh): if either dies both are bounced.
#
# Bash (not /bin/sh) for `wait -n`.
set -u

SECRETS=/var/sub-wave/icecast-secrets.env
TEMPLATE=/etc/icecast2/icecast.xml.template
RENDERED=/etc/icecast2/icecast.xml

# Multi-station pointer (kept in lockstep with docker/broadcast-entrypoint.sh).
# Called at the top of run_broadcast so every mixer relaunch re-resolves.
#
# Both paths are env-overridable so scripts/aio-log-link.test.ts can drive
# link_liquidsoap_log() against a scratch dir; neither var is set in the image.
STATE_ROOT="${SUBWAVE_STATE_ROOT:-/var/sub-wave}"
LIQ_LOG_DIR="${SUBWAVE_LIQ_LOG_DIR:-/var/log/liquidsoap}"
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
# One-time state bootstrap. Mode 777 because the services run under different
# uids (icecast2 / liquidsoap / root).
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

	# Keep a co-located Navidrome from scanning the hourly archive mixdowns
	# in as junk "HH-00" tracks (issue #273).
	touch /var/sub-wave/archive/.ndignore

	link_liquidsoap_log

	# Rotate radio.log on boot once it passes 50MB (liquidsoap appends
	# forever; boot is the one safe moment — fd not yet held). Rotating via
	# $LIQ_LOG_DIR matters: after link_liquidsoap_log it resolves to wherever
	# radio.log actually lands, which the state path can miss.
	RADIO_LOG="$LIQ_LOG_DIR/radio.log"
	if [ -f "$RADIO_LOG" ] && [ "$(stat -c %s "$RADIO_LOG" 2>/dev/null || echo 0)" -gt 52428800 ]; then
		mv -f "$RADIO_LOG" "$RADIO_LOG.old"
		echo "supervisor: rotated oversized radio.log to radio.log.old" >&2
	fi
}

# ---------------------------------------------------------------------------
# Point /var/log/liquidsoap at the state ROOT's logs/ (#1196: radio.log must
# survive recreates; routes/debug.ts tails <stateRoot>/logs/radio.log) — but
# never at the cost of the station: radio.liq opens the log path as its FIRST
# lifecycle step, so an unopenable path is a fatal startup error, not a
# degraded log. Every branch below must end in a path liquidsoap can open,
# verified by probe.
#
# The original #1196 fix created the link unconditionally and guarded on -L
# only. If <state>/logs was itself a symlink back at /var/log/liquidsoap (a
# natural pre-#1196 host-side workaround), the two links closed an ELOOP cycle
# ("Too many levels of symbolic links") that the guard then never repaired —
# an unbreakable crash loop the "Restart mixer" button couldn't touch.
# ---------------------------------------------------------------------------
link_liquidsoap_log() {
	local target="$STATE_ROOT/logs"

	# 1. Heal a broken state-side logs link. `-d` is false for dangling AND
	#    looping symlinks — exactly the set worth replacing. A link that
	#    resolves elsewhere is an operator parking logs on another disk on
	#    purpose — left alone.
	if [ -L "$target" ] && [ ! -d "$target" ]; then
		log "WARNING $target is a broken symlink (-> $(readlink "$target" 2>/dev/null || echo '?')) — replacing it with a real directory"
		rm -f "$target" 2>/dev/null || true
	fi

	# 1b. A state-side link that resolves INTO the container log path is the
	#     #1196 cycle half in disguise — it only looks healthy while the fresh
	#     image's plain /var/log/liquidsoap still exists. Linking $LIQ_LOG_DIR
	#     at a path that resolves to itself can only re-create the cycle, so
	#     replace the link with a real directory now (keeps persistence).
	if [ -L "$target" ] && [ -d "$target" ] && command -v realpath >/dev/null 2>&1; then
		local target_real liq_real
		target_real=$(realpath -m -- "$target" 2>/dev/null || realpath "$target" 2>/dev/null || true)
		liq_real=$(realpath -m -- "$LIQ_LOG_DIR" 2>/dev/null || realpath "$LIQ_LOG_DIR" 2>/dev/null || true)
		if [ -n "$target_real" ] && [ "$target_real" = "$liq_real" ]; then
			log "WARNING $target resolves into $LIQ_LOG_DIR — the #1196 cycle half; replacing it with a real directory"
			rm -f "$target" 2>/dev/null || true
		fi
	fi

	mkdir -p "$target" 2>/dev/null || true
	chmod 777 "$target" 2>/dev/null || true

	# 2. Point the in-container path at it — unless something is mounted
	#    there (an operator's bind mount is already persistent; use as-is).
	#    The mountpoint test must come BEFORE any `rm -rf`: rm on a
	#    mountpoint can't remove the mountpoint but DOES delete everything
	#    inside — wiping the log history the mount exists to keep.
	if [ -d "$target" ]; then
		if [ -e "$LIQ_LOG_DIR" ] && [ ! -L "$LIQ_LOG_DIR" ] && is_mountpoint "$LIQ_LOG_DIR"; then
			log "$LIQ_LOG_DIR is a mountpoint — leaving it as-is; radio.log stays there"
		else
			# rm first: `ln -s` onto a surviving directory would
			# silently create the link INSIDE it.
			[ -L "$LIQ_LOG_DIR" ] || rm -rf "$LIQ_LOG_DIR" 2>/dev/null || true
			if [ -e "$LIQ_LOG_DIR" ] && [ ! -L "$LIQ_LOG_DIR" ]; then
				# Unremovable yet not detected as a mountpoint
				# (exotic mount setups) — same outcome, use as-is.
				log "$LIQ_LOG_DIR survived removal (bind mount?) — leaving it; radio.log stays there"
			else
				# -f replaces an existing link (including a looping
				# one); -n keeps it from being planted inside a
				# link-to-directory.
				ln -sfn "$target" "$LIQ_LOG_DIR" 2>/dev/null || true
			fi
		fi
	else
		log "WARNING $target is not a usable directory — not linking $LIQ_LOG_DIR at it"
	fi

	# 3. Prove liquidsoap can open a file there before handing over the path
	#    — the backstop that turns the whole ELOOP class into a warning. Any
	#    failing shape falls back to a container-local dir: no persistence,
	#    but the station stays on the air.
	if ! probe_log_dir; then
		log "WARNING $LIQ_LOG_DIR is unopenable — falling back to a container-local log dir; radio.log will NOT persist in the state dir"
		# A mountpoint can be neither removed nor replaced — rebuild
		# unmounted paths only (rm -rf on a failing mount would just strip
		# the operator's files without fixing the path).
		if ! is_mountpoint "$LIQ_LOG_DIR"; then
			rm -rf "$LIQ_LOG_DIR" 2>/dev/null || true
			mkdir -p "$LIQ_LOG_DIR" 2>/dev/null || true
		fi
		probe_log_dir || log "ERROR $LIQ_LOG_DIR is still unopenable — liquidsoap will fail to start"
	fi

	# Deliberately NOT recursive: liquidsoap only needs to create/append
	# radio.log in the directory itself, and an operator who pointed
	# <state>/logs at their own disk shouldn't have its contents re-owned.
	chmod 777 "$LIQ_LOG_DIR" 2>/dev/null || true
	chown liquidsoap:liquidsoap "$LIQ_LOG_DIR" 2>/dev/null || true
}

# Can a file actually be created under $LIQ_LOG_DIR? Runs as root, so it proves
# the PATH resolves (the ELOOP/dangling class), not that the liquidsoap user
# has write permission — that's the chmod/chown above.
probe_log_dir() {
	local probe="$LIQ_LOG_DIR/.write-probe"
	: > "$probe" 2>/dev/null || return 1
	rm -f "$probe" 2>/dev/null || true
	return 0
}

# Is $1 a mountpoint? Falls back to /proc/self/mountinfo (field 5 is the mount
# point) so the answer never degrades to "not a mount" just because the
# `mountpoint` binary is missing.
is_mountpoint() {
	if command -v mountpoint >/dev/null 2>&1; then
		mountpoint -q "$1" 2>/dev/null
	else
		awk -v p="$1" '$5 == p { found = 1; exit } END { exit found ? 0 : 1 }' /proc/self/mountinfo 2>/dev/null
	fi
}

# ---------------------------------------------------------------------------
# Warn loudly if /var/sub-wave isn't a mounted volume: everything the station
# writes would live in the container's writable layer and be wiped by the next
# image update. A bare `docker run` that forgets `-v` is the footgun (#902); a
# real mount gets its own /proc/mounts entry, an overlay dir doesn't.
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
# Resolve the ICECAST_*_PASSWORD values. Precedence: env override > persisted
# secrets file > freshly generated. Written back for operator visibility + the
# documented rotate path; exported for liquidsoap.
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
	# 0600 — passwords, read only by root (all in-container readers are root).
	chmod 600 "$SECRETS"

	export ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD
	# Liquidsoap connects over loopback; radio.liq reads ICECAST_HOST.
	export ICECAST_HOST=localhost
}

# ---------------------------------------------------------------------------
# Render icecast.xml. Called on EVERY broadcast pair (re)launch — not just boot
# — so a restart-mixer picks up a flipped listener-auth flag or a changed
# buffer/bitrate setting, the same way the split stack's container restart
# re-runs its entrypoint.
# ---------------------------------------------------------------------------
read_state_num() {
	# $1 = filename under $STATE_DIR, $2 = fallback. Non-numeric/missing → fallback.
	local _v
	_v=$(cat "$STATE_DIR/$1" 2>/dev/null || true)
	case "$_v" in
		''|*[!0-9]*) echo "$2" ;;
		*) echo "$_v" ;;
	esac
}

render_icecast() {
	ICECAST_STATE_DIR="$STATE_DIR" \
	ICECAST_TEMPLATE="$TEMPLATE" \
	ICECAST_RENDERED="$RENDERED" \
	ICECAST_TRUSTED_PROXY_IPS="${ICECAST_TRUSTED_PROXY_IPS:-127.0.0.1 ::1}" \
	LISTENER_AUTH_URL="${LISTENER_AUTH_URL:-http://localhost:7701/listener-auth}" \
		/usr/local/bin/icecast-render
	chown icecast2 "$RENDERED" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Service launchers. Each blocks until its process exits, so the supervise()
# loop can restart it. Do NOT `exec` — that would replace the loop.
# ---------------------------------------------------------------------------

# icecast2 + liquidsoap as a unit; returns when either dies.
run_broadcast() {
	# Re-resolve the active station on every pair launch — this is how a
	# station switch takes effect in the AIO without a container bounce.
	resolve_state_dir

	# Bootstrap the resolved station dir's subdirs (the root case is covered
	# by init_state at boot; a non-root station dir needs its own here).
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
	# TEMPORARY (re-harden later): run liquidsoap as root — same reason as
	# docker/broadcast-entrypoint.sh (savonet base bump changed the liquidsoap
	# uid 10000 → 100, making persisted state files unwritable). Restore the
	# privilege drop once state files are chowned to the new uid
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

# Controller. The *_HOST/*_URL overrides repoint the compose service names at
# loopback. DOCKER_HOST and TTS_HEAVY_URL are intentionally unset — the Stats
# panel hides and TTS falls back to Piper. Everything else is inherited from
# the container env + settings.json.
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
# Boot. Sourcing with SUBWAVE_SUPERVISOR_LIB=1 defines the functions WITHOUT
# booting — the seam scripts/aio-log-link.test.ts uses. The image never sets
# it, so PID 1 always falls through to the real boot.
# ---------------------------------------------------------------------------
if [ "${SUBWAVE_SUPERVISOR_LIB:-}" = "1" ]; then
	return 0 2>/dev/null || exit 0
fi

warn_if_state_unmounted
init_state
init_secrets

# On stop, signal the whole process group once, then give the children time to
# shut down (reset the trap first so the kill doesn't re-enter). The grace
# period matters: this is PID 1, and the instant it exits everything left gets
# SIGKILLed — which robbed the controller of its SIGTERM handler and left
# library.db's WAL un-checkpointed on every stop (#786). `wait` covers the
# supervise loops; the sleep covers their reparented children, which bash's
# wait can't see. Docker's stop timeout still hard-caps the whole thing.
trap 'trap "" TERM INT; log "shutting down"; kill -TERM 0 2>/dev/null; wait; sleep 2; exit 0' TERM INT

supervise broadcast  run_broadcast  &
supervise controller run_controller &
supervise web        run_web        &
supervise caddy      run_caddy      &

wait
