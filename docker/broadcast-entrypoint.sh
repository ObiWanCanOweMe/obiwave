#!/usr/bin/env bash
# SUB/WAVE broadcast supervisor: resolves the icecast secrets, renders
# icecast.xml, launches icecast2 + liquidsoap, and exits as soon as either dies
# so the container's restart policy bounces the pair together.
#
# Bash (not /bin/sh) because we need `wait -n`; the base image's /bin/sh is
# dash, which lacks it.

set -eu

# ---- Shared state bootstrap -------------------------------------------------
# Creates the dirs the controller, analyzer and liquidsoap share and opens them
# to mode 777: those containers write here as OTHER uids, so an operator would
# otherwise have to chown every bind-mount source before first boot.
#
# NOTHING in here is fatal (#1300 bug 10). Under `set -eu` the old bulk
# `mkdir -p a b c` / `chmod 777 a b c` made every state path load-bearing: one
# on a mount that refuses the change — a read-only bind, an NFS export without
# the right perms, the exFAT/NTFS disk people move the stem cache to — aborted
# this script BEFORE icecast started, and compose surfaced that as
# `dependency failed to start: container sub-wave-broadcast is unhealthy`,
# naming neither the path nor the chmod. A station that refuses to boot over a
# permission convenience is strictly worse than one running on a degraded
# mount: icecast still serves and the dead-air guard still airs the emergency
# loop, but an exited container airs nothing.
#
# Kept byte-for-byte in step with docker/aio/supervisor.sh's copy (same
# function, same list, same messages) — scripts/state-bootstrap.test.ts drives
# both through one table.
state_warn() { echo "broadcast: WARNING $*" >&2; }

# GNU stat uses `-c %a`; macOS/BSD stat uses `-f %Lp`. Contributor tests run
# these library-mode helpers on both families, while production containers use
# GNU coreutils. Keep one probe so warning decisions and diagnostics agree.
state_mode() {
    stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null || echo '?'
}

# True when `other` can write the dir. This — not chmod's exit status — is
# what the warning keys on: a mount that is already world-writable and simply
# refuses chmod is a WORKING configuration, and a line printed on every boot of
# a healthy station is a line operators learn to skip past.
state_writable_by_others() {
    case "$(state_mode "$1")" in
        *[2367]) return 0 ;;
        *) return 1 ;;
    esac
}

state_prepare_dir() {
    local p=$1
    mkdir -p "$p" 2>/dev/null || true
    if [ ! -d "$p" ]; then
        state_warn "state dir $p could not be created — a read-only or unwritable mount; the station boots, but anything writing there will fail"
        return 0
    fi
    chmod 777 "$p" 2>/dev/null || true
    if [ ! -w "$p" ] || ! state_writable_by_others "$p"; then
        state_warn "state dir $p is mode $(state_mode "$p") and chmod could not change it — the controller and analyzer containers write there as other uids; chown/chmod it on the host"
    fi
    return 0
}

state_prepare_file() {
    local p=$1
    local mode=${2:-}
    touch "$p" 2>/dev/null || true
    if [ ! -f "$p" ]; then
        state_warn "state file $p could not be created — a read-only or unwritable mount"
        return 0
    fi
    [ -n "$mode" ] && chmod "$mode" "$p" 2>/dev/null || true
    return 0
}

bootstrap_state_dirs() {
    local root=$1
    local dir=$2
    local sub
    state_prepare_dir "$root"
    state_prepare_dir "$dir"
    # stems + transitions belong to the analyzer (uid 10001) — the stem cache
    # and the rendered transition clips. They are also the only two dirs worth
    # relocating to a bigger disk, and the ONLY way to do that is a bind mount
    # at <state>/stems (music/stem-cache.ts stemsRoot() is <stateDir>/stems,
    # with no setting behind it). A fresh bind mount lands root-owned 755, so
    # without the same 777 treatment the rest of the state dir gets, the
    # analyzer cannot write the cache it was just pointed at.
    for sub in voice voices archive jingles logs sessions sfx stems transitions; do
        state_prepare_dir "$dir/$sub"
    done
    # Liquidsoap's reload_mode="watch" playlists need the files to exist.
    state_prepare_file "$dir/auto.m3u" 666
    state_prepare_file "$dir/jingles.m3u" 666
    # Keep a co-located Navidrome from scanning the hourly archive mixdowns in
    # as junk "HH-00" tracks (issue #273). Harmless when paths don't overlap.
    state_prepare_file "$dir/archive/.ndignore"
    return 0
}

# Sourcing with SUBWAVE_BROADCAST_LIB=1 defines the helpers above WITHOUT
# booting a station, so scripts/state-bootstrap.test.ts can drive them.
if [ "${SUBWAVE_BROADCAST_LIB:-}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

# ---- Multi-station pointer resolution ---------------------------------------
# state/stations/active.json ({"activeId":"<slug>"}) picks the station dir this
# boot serves; install-level files (icecast secrets) stay at $STATE_ROOT. No jq
# in this image — the sed matches the controller's canonical output and the
# slug charset [a-z0-9-]; a hand-mangled file falls back to the root.
STATE_ROOT=/var/sub-wave
STATE_DIR="$STATE_ROOT"
ACTIVE_FILE="$STATE_ROOT/stations/active.json"
if [ -f "$ACTIVE_FILE" ]; then
    ACTIVE_ID=$(sed -n 's/.*"activeId"[[:space:]]*:[[:space:]]*"\([a-z0-9][a-z0-9-]\{0,40\}\)".*/\1/p' "$ACTIVE_FILE" | head -n1)
    if [ -n "$ACTIVE_ID" ] && [ -d "$STATE_ROOT/stations/$ACTIVE_ID" ]; then
        STATE_DIR="$STATE_ROOT/stations/$ACTIVE_ID"
        echo "broadcast: active station '$ACTIVE_ID' → $STATE_DIR" >&2
    else
        echo "broadcast: WARNING stations/active.json unresolvable (id='$ACTIVE_ID') — using root" >&2
    fi
fi
export SUBWAVE_STATE_DIR="$STATE_DIR"

SECRETS=$STATE_ROOT/icecast-secrets.env
TEMPLATE=/etc/icecast2/icecast.xml.template
RENDERED=/etc/icecast2/icecast.xml

# ---- Bootstrap shared state dirs --------------------------------------------
bootstrap_state_dirs "$STATE_ROOT" "$STATE_DIR"

# The compose logs bind mount lands owned by root on first boot; liquidsoap
# (uid 10000) writes radio.log there.
mkdir -p /var/log/liquidsoap
chown -R liquidsoap:liquidsoap /var/log/liquidsoap 2>/dev/null || true

# Rotate radio.log on boot once it passes 50MB — liquidsoap has no size-based
# rotation and appends forever; boot is the one safe moment (fd not yet held).
# One .old generation caps disk at ~2x the threshold.
RADIO_LOG=/var/log/liquidsoap/radio.log
if [ -f "$RADIO_LOG" ] && [ "$(stat -c %s "$RADIO_LOG" 2>/dev/null || echo 0)" -gt 52428800 ]; then
    mv -f "$RADIO_LOG" "$RADIO_LOG.old"
    echo "broadcast: rotated oversized radio.log to radio.log.old" >&2
fi

# ---- Resolve passwords ------------------------------------------------------
# Precedence: env override > persisted secrets file > freshly generated.
# Capture env values FIRST so sourcing the secrets file can't clobber them.

ENV_SRC="${ICECAST_SOURCE_PASSWORD:-}"
ENV_ADM="${ICECAST_ADMIN_PASSWORD:-}"
ENV_REL="${ICECAST_RELAY_PASSWORD:-}"

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

# Written back for operator visibility + the documented "delete + restart to
# rotate" path.
cat > "$SECRETS" <<EOF
ICECAST_SOURCE_PASSWORD=$ICECAST_SOURCE_PASSWORD
ICECAST_ADMIN_PASSWORD=$ICECAST_ADMIN_PASSWORD
ICECAST_RELAY_PASSWORD=$ICECAST_RELAY_PASSWORD
EOF
# 0600 — only root reads it (this entrypoint, and the controller container off
# the shared mount in broadcast/listeners.ts).
chmod 600 "$SECRETS"

export ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD
# Liquidsoap connects over loopback inside this container; radio.liq reads
# ICECAST_HOST (default "icecast").
export ICECAST_HOST=localhost

# ---- Render icecast.xml -----------------------------------------------------
# Shared with the AIO supervisor so per-format burst sizing and listener-auth
# mount blocks cannot drift between deployment modes.
ICECAST_STATE_DIR="$STATE_DIR" \
ICECAST_TEMPLATE="$TEMPLATE" \
ICECAST_RENDERED="$RENDERED" \
ICECAST_TRUSTED_PROXY_HOSTS="${ICECAST_TRUSTED_PROXY_HOSTS:-caddy}" \
LISTENER_AUTH_URL="${LISTENER_AUTH_URL:-http://controller:7701/listener-auth}" \
    /usr/local/bin/icecast-render
chown icecast2 "$RENDERED" 2>/dev/null || true

# ---- Launch icecast in the background --------------------------------------

echo "broadcast: starting icecast2" >&2
sudo -E -u icecast2 icecast2 -n -c "$RENDERED" &
ICECAST_PID=$!

# Wait up to ~10s for icecast to accept HTTP, or liquidsoap can beat it and
# bail with "Cannot connect to remote host" on its first source connect.
for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS http://localhost:7702/ > /dev/null 2>&1; then
        echo "broadcast: icecast accepting connections after ${i}s" >&2
        break
    fi
    sleep 1
done

# ---- Launch liquidsoap in the background -----------------------------------

echo "broadcast: starting liquidsoap" >&2
# TEMPORARY (re-harden later): run liquidsoap as root instead of dropping to
# the `liquidsoap` user. The savonet base bump 2.2.5 → 2.4.4 changed that
# user's uid (10000 → 100), making state files persisted by the old image
# unwritable — every on_meta write EACCES'd and the UI froze one song behind.
# Restore the privilege drop once the state files are chowned to the new uid
# (needs settings.init.allow_root reverted in radio.liq too).
liquidsoap /etc/liquidsoap/radio.liq &
LIQ_PID=$!

# ---- Wait for either to die, then exit -------------------------------------

trap 'kill -TERM "$ICECAST_PID" "$LIQ_PID" 2>/dev/null || true' INT TERM

wait -n "$ICECAST_PID" "$LIQ_PID"
EXIT=$?

echo "broadcast: child exited ($EXIT) — taking the other down" >&2
kill -TERM "$ICECAST_PID" "$LIQ_PID" 2>/dev/null || true
wait 2>/dev/null || true

exit "$EXIT"
