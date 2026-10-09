#!/usr/bin/env bash
# SUB/WAVE broadcast supervisor: resolves the icecast secrets, renders
# icecast.xml, launches icecast2 + liquidsoap, and exits as soon as either dies
# so the container's restart policy bounces the pair together.
#
# Bash (not /bin/sh) because we need `wait -n`; the base image's /bin/sh is
# dash, which lacks it.

set -eu

# Shared state bootstrap. Mode 777 because the controller, analyzer and
# liquidsoap write here as OTHER uids; without it an operator must chown every
# bind-mount source by hand. The state ROOT is 1777 instead: the sticky bit
# still lets every uid create files there, but only a file's owner can rename or
# delete it, so a sidecar's uid cannot replace root's icecast-secrets.env.
#
# NOTHING in here is fatal (#1300 bug 10): under `set -eu` a bulk mkdir/chmod
# makes every state path load-bearing, and one unwritable mount aborts this
# script before icecast starts. A degraded mount still serves and still airs the
# emergency loop; an exited container airs nothing.
#
# docker/aio/supervisor.sh keeps the same functions, list and messages;
# scripts/state-bootstrap.test.ts drives both through one table.
state_warn() { echo "broadcast: WARNING $*" >&2; }
state_log() { echo "broadcast: $*" >&2; }

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
    local mode=${2:-777}
    mkdir -p "$p" 2>/dev/null || true
    if [ ! -d "$p" ]; then
        state_warn "state dir $p could not be created — a read-only or unwritable mount; the station boots, but anything writing there will fail"
        return 0
    fi
    chmod "$mode" "$p" 2>/dev/null || true
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
    state_prepare_dir "$root" 1777
    # A single-station install serves from the root itself; a second plain 777
    # would strip the sticky bit again.
    [ "$dir" = "$root" ] || state_prepare_dir "$dir"
    # stems + transitions are the analyzer's (uid 10001); a fresh bind mount
    # lands root-owned 755, which it cannot write without the same 777.
    for sub in voice voices archive jingles logs sessions sfx stems transitions; do
        state_prepare_dir "$dir/$sub"
    done
    # A RELOCATED stem cache (STEMS_DIR in .env, container path
    # SUBWAVE_STEMS_DIR) sits outside $dir, so the loop above never reaches it.
    # Marker initialization shares any per-station directories it creates too.
    if [ -n "${SUBWAVE_STEMS_DIR:-}" ]; then
        state_prepare_dir "$SUBWAVE_STEMS_DIR"
    fi
    # Liquidsoap's reload_mode="watch" playlists need the files to exist.
    state_prepare_file "$dir/auto.m3u" 666
    state_prepare_file "$dir/jingles.m3u" 666
    # Keeps a co-located Navidrome from scanning the hourly archive mixdowns in
    # as junk "HH-00" tracks (#273).
    state_prepare_file "$dir/archive/.ndignore"
    return 0
}

# Listener buffer depth comes only from the controller-written handoff. An env
# override would change Icecast's real burst without changing /now-playing or
# voice-event timing, putting every listener-facing clock on the wrong offset.
read_state_num() {
    # $1 = filename, $2 = fallback. Non-numeric or missing → fallback.
    _v=$(cat "$STATE_DIR/$1" 2>/dev/null || true)
    case "$_v" in
        ''|*[!0-9]*) echo "$2" ;;
        *) echo "$_v" ;;
    esac
}

stream_buffer_seconds() {
    read_state_num liquidsoap_stream_buffer_seconds.txt 22
}

ICECAST_SECRET_CHARS='A-Z a-z 0-9 . _ ~ + = @ ! % ^ * , : / ? # -'

icecast_secret_valid() {
    case "$1" in
        ''|*[!A-Za-z0-9._~+=@!%^*,:/?#-]*) return 1 ;;
    esac
    return 0
}

# The uid this script's own files land as next to $1. Normally `id -u`, but a
# root-squashed NFS export or a user-namespaced runtime maps it, and a file this
# script wrote must still be recognised as its own. Falls back to `id -u` when
# the dir cannot be written.
icecast_secrets_owner() {
    local probe uid=''
    probe=$(mktemp "$1.XXXXXX" 2>/dev/null) || probe=''
    if [ -n "$probe" ]; then
        uid=$(stat -c %u "$probe" 2>/dev/null || true)
        rm -f "$probe" 2>/dev/null || true
    fi
    [ -n "$uid" ] || uid=$(id -u)
    echo "$uid"
}

# Reads $1 into _ICS_SOURCE / _ICS_ADMIN / _ICS_RELAY, each empty when absent
# or refused.
read_icecast_secrets_file() {
    local file=$1 line key val owner want
    _ICS_SOURCE='' _ICS_ADMIN='' _ICS_RELAY=''
    if [ -L "$file" ]; then
        state_warn "ignoring $file — it is a symlink, not a file this script wrote; the Icecast passwords will be regenerated unless ICECAST_*_PASSWORD is set"
        return 0
    fi
    [ -e "$file" ] || return 0
    if [ ! -f "$file" ] || [ ! -r "$file" ]; then
        state_warn "ignoring $file — not a readable regular file; the Icecast passwords will be regenerated unless ICECAST_*_PASSWORD is set"
        return 0
    fi
    owner=$(stat -c %u "$file" 2>/dev/null || echo '?')
    want=$(icecast_secrets_owner "$file")
    if [ "$owner" != "$want" ]; then
        state_warn "ignoring $file — owned by uid $owner, not uid $want which writes it; the Icecast passwords will be regenerated unless ICECAST_*_PASSWORD is set"
        return 0
    fi
    while IFS= read -r line || [ -n "$line" ]; do
        line=${line%$'\r'}
        key=${line%%=*}
        [ "$key" != "$line" ] || continue
        val=${line#*=}
        case "$key" in
            ICECAST_SOURCE_PASSWORD|ICECAST_ADMIN_PASSWORD|ICECAST_RELAY_PASSWORD) ;;
            *) continue ;;
        esac
        # A hand edit may quote the value; the controller strips one pair too.
        case "$val" in
            \"*\") val=${val#\"}; val=${val%\"} ;;
            \'*\') val=${val#\'}; val=${val%\'} ;;
        esac
        if ! icecast_secret_valid "$val"; then
            state_warn "ignoring $key in $file — it holds a character outside [$ICECAST_SECRET_CHARS]; it will be replaced"
            continue
        fi
        case "$key" in
            ICECAST_SOURCE_PASSWORD) _ICS_SOURCE=$val ;;
            ICECAST_ADMIN_PASSWORD) _ICS_ADMIN=$val ;;
            ICECAST_RELAY_PASSWORD) _ICS_RELAY=$val ;;
        esac
    done < "$file" || true
    return 0
}

# Sets and exports ICECAST_SOURCE/ADMIN/RELAY_PASSWORD from the env, then $1,
# then openssl.
resolve_icecast_secrets() {
    local file=$1 part name fileval val
    read_icecast_secrets_file "$file"
    for part in SOURCE ADMIN RELAY; do
        name=ICECAST_${part}_PASSWORD
        fileval=_ICS_$part
        val=${!name:-}
        if [ -n "$val" ] && ! icecast_secret_valid "$val"; then
            state_warn "ignoring $name from the environment — it holds a character outside [$ICECAST_SECRET_CHARS], which icecast.xml cannot carry safely; using the persisted or a generated password instead"
            val=''
        fi
        [ -n "$val" ] || val=${!fileval}
        [ -n "$val" ] || val=$(openssl rand -hex 16)
        printf -v "$name" '%s' "$val"
        export "${name?}"
    done
    return 0
}

# Written back for operator visibility + the documented "delete + restart to
# rotate" path. Through a fresh mktemp file and a rename, so the write never
# follows whatever sits at $1 (the rename replaces a symlink, it does not write
# through it). 0600: only root reads it (this script, and the controller off the
# shared mount in broadcast/listeners.ts). A failed write warns, never aborts.
write_icecast_secrets() {
    local file=$1 tmp
    tmp=$(mktemp "$file.XXXXXX" 2>/dev/null) || tmp=''
    if [ -n "$tmp" ] \
        && printf 'ICECAST_SOURCE_PASSWORD=%s\nICECAST_ADMIN_PASSWORD=%s\nICECAST_RELAY_PASSWORD=%s\n' \
            "$ICECAST_SOURCE_PASSWORD" "$ICECAST_ADMIN_PASSWORD" "$ICECAST_RELAY_PASSWORD" > "$tmp" 2>/dev/null \
        && chmod 600 "$tmp" 2>/dev/null \
        && mv -fT "$tmp" "$file" 2>/dev/null; then
        return 0
    fi
    [ -z "$tmp" ] || rm -f "$tmp" 2>/dev/null || true
    state_warn "could not write $file — the station runs on these Icecast passwords, but they will change on the next restart"
    return 0
}

# Escapes $1 for an XML attribute value. The replacements are quoted so bash
# 5.2's patsub_replacement does not read `&` as "the matched text".
xml_escape() {
    local s=$1
    s=${s//'&'/'&amp;'}
    s=${s//'<'/'&lt;'}
    s=${s//'>'/'&gt;'}
    s=${s//'"'/'&quot;'}
    printf '%s' "$s"
}

# Sourcing with SUBWAVE_BROADCAST_LIB=1 defines the helpers above WITHOUT
# booting a station, so scripts/state-bootstrap.test.ts can drive them.
if [ "${SUBWAVE_BROADCAST_LIB:-}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

# Multi-station pointer: state/stations/active.json ({"activeId":"<slug>"}) picks
# the station dir this boot serves; install-level files (icecast secrets) stay at
# $STATE_ROOT. No jq in this image — the sed matches the controller's canonical
# output and the slug charset [a-z0-9-]; a hand-mangled file falls back to root.
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

# Icecast passwords: env override > persisted secrets file > freshly generated,
# read as data and validated (see resolve_icecast_secrets above).
resolve_icecast_secrets "$SECRETS"
write_icecast_secrets "$SECRETS"
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

# Launch the pair, then wait for either to die.
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

echo "broadcast: starting liquidsoap" >&2
# TEMPORARY (re-harden later): run liquidsoap as root instead of dropping to the
# `liquidsoap` user. The savonet bump 2.2.5 -> 2.4.4 changed that user's uid
# (10000 -> 100), making persisted state files unwritable. Restore the privilege
# drop once they are chowned (also revert settings.init.allow_root in radio.liq).
liquidsoap /etc/liquidsoap/radio.liq &
LIQ_PID=$!

trap 'kill -TERM "$ICECAST_PID" "$LIQ_PID" 2>/dev/null || true' INT TERM

wait -n "$ICECAST_PID" "$LIQ_PID"
EXIT=$?

echo "broadcast: child exited ($EXIT) — taking the other down" >&2
kill -TERM "$ICECAST_PID" "$LIQ_PID" 2>/dev/null || true
wait 2>/dev/null || true

exit "$EXIT"
