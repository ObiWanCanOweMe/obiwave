#!/usr/bin/env bash
# Render Icecast once for both the split broadcast image and the AIO image.
set -eu

STATE_DIR="${ICECAST_STATE_DIR:-/var/sub-wave}"
TEMPLATE="${ICECAST_TEMPLATE:-/etc/icecast2/icecast.xml.template}"
RENDERED="${ICECAST_RENDERED:-/etc/icecast2/icecast.xml}"
MOUNTS_XML="${RENDERED}.mounts"
TRUSTED_XML="${RENDERED}.proxies"

read_state_num() {
    local value
    value=$(cat "$STATE_DIR/$1" 2>/dev/null || true)
    case "$value" in
        ''|*[!0-9]*) echo "$2" ;;
        *) echo "$value" ;;
    esac
}

# Concurrent-listener ceiling. The legacy env var wins when present; otherwise
# use the controller handoff so AIO/Unraid operators can set the ceiling. The
# shared renderer owns this once for both launch shapes.
resolve_max_clients() {
    local source=ICECAST_MAX_CLIENTS
    local value="${ICECAST_MAX_CLIENTS:-}"
    if [ -z "$value" ]; then
        source=settings
        value=$(read_state_num liquidsoap_icecast_max_clients.txt 100)
    fi
    case "$value" in
        *[!0-9]*|''|0) echo "100 fallback:${value}@${source}" ;;
        *) echo "$value $source" ;;
    esac
}

state_warn() { echo "icecast-render: WARNING $*" >&2; }
state_log() { echo "icecast-render: $*" >&2; }

trusted_proxy_token() {
    printf '%s' "$1" | tr -cd '0-9A-Za-z.:/_-' | cut -c1-48
}

# True when $1 has the SHAPE of an address icecast can match. A bare character
# class (`''|*[!0-9a-fA-F.:]*`) is NOT enough: it accepts every hex-only word,
# so `cafe`, `beef`, `ff` and a bare `a` pass while `caddy` is dropped, and the
# operator-facing count then claims proxies that can never match.
#
# Shape only, deliberately: whether the address is the RIGHT one is the
# operator's to know, and this must keep dropping rather than repairing.
trusted_proxy_valid() {
    local addr=$1 rest octet n=0
    # Anything with a colon is IPv6 (dots allowed for the ::ffff:1.2.3.4 form).
    # Not a full parser; icecast's own exact match is the real arbiter.
    case "$addr" in
        *:*)
            case "$addr" in *[!0-9a-fA-F:.]*) return 1 ;; esac
            case "$addr" in *[0-9a-fA-F]*) return 0 ;; *) return 1 ;; esac
            ;;
    esac
    # IPv4: exactly four dot-separated decimal octets, each 0-255.
    rest=$addr
    while [ "$n" -lt 4 ]; do
        case "$rest" in
            *.*) octet=${rest%%.*}; rest=${rest#*.} ;;
            *)   octet=$rest; rest='' ;;
        esac
        n=$(( n + 1 ))
        case "$octet" in ''|*[!0-9]*) return 1 ;; esac
        # Length first: `[ 99999999999999999999 -le 255 ]` is an arithmetic
        # error, not a false.
        [ "${#octet}" -le 3 ] || return 1
        [ "$octet" -le 255 ] || return 1
        [ "$n" -eq 4 ] || [ -n "$rest" ] || return 1
    done
    [ -z "$rest" ] || return 1
    return 0
}

write_trusted_proxy_marker() {
    # $1 = count, $2 = source label, $3 = proxies JSON array, $4 = dropped array
    local dir=${STATE_DIR:-}
    [ -n "$dir" ] || return 0
    local marker=$dir/trusted-proxies.json
    local tmp=$marker.tmp
    if printf '{"count":%s,"source":"%s","proxies":%s,"dropped":%s,"at":%s}\n' \
            "$1" "$2" "$3" "$4" "$(date +%s)" > "$tmp" 2>/dev/null \
        && mv -f "$tmp" "$marker" 2>/dev/null; then
        chmod 644 "$marker" 2>/dev/null || true
    else
        rm -f "$tmp" 2>/dev/null || true
        state_warn "could not write $marker — the station is unaffected, but the admin Listeners table cannot explain a missing trusted proxy"
    fi
    return 0
}

render_trusted_proxies() {
    local xml=$1
    local source=$2
    shift 2
    local ip names="" kept="" dropped="" count=0
    : > "$xml" 2>/dev/null || true
    # Candidates arrive already word-split, so prose is dropped word by word.
    # Left alone: the list has always been space-separated (the DNS path returns
    # several addresses for one name).
    for ip in "$@"; do
        if ! trusted_proxy_valid "$ip"; then
            state_warn "ignoring malformed trusted proxy '$ip' — icecast matches an exact IP, so a CIDR, a hostname or anything else that is not an address never matches"
            dropped="$dropped,\"$(trusted_proxy_token "$ip")\""
            continue
        fi
        echo "        <x-forwarded-for>$ip</x-forwarded-for>" >> "$xml"
        names="$names $ip"
        kept="$kept,\"$ip\""
        count=$(( count + 1 ))
    done
    if [ "$count" -gt 0 ]; then
        state_log "trusting X-Forwarded-For from$names (from $source)"
    else
        state_log "no trusted proxy resolved from $source — listener IPs will show the connecting peer (docs/reverse-proxy.md)"
    fi
    write_trusted_proxy_marker "$count" "$source" "[${kept#,}]" "[${dropped#,}]"
    return 0
}


# Library mode lets the max-listener owner test drive the exact production
# resolver without rendering or touching /etc.
if [ "${SUBWAVE_ICECAST_RENDER_LIB:-}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

MAX_CLIENTS_LINE=$(resolve_max_clients)
ICECAST_MAX_CLIENTS="${MAX_CLIENTS_LINE%% *}"
echo "icecast-render: max listeners $ICECAST_MAX_CLIENTS (from ${MAX_CLIENTS_LINE#* })" >&2

BUFFER_SECONDS="${ICECAST_BUFFER_SECONDS:-$(read_state_num liquidsoap_stream_buffer_seconds.txt 22)}"
MP3_BITRATE="${ICECAST_STREAM_BITRATE:-$(read_state_num liquidsoap_stream_bitrate.txt 192)}"
OPUS_BITRATE="${ICECAST_OPUS_BITRATE:-$(read_state_num liquidsoap_opus_bitrate.txt 96)}"
AAC_BITRATE="${ICECAST_AAC_BITRATE:-$(read_state_num liquidsoap_aac_bitrate.txt 192)}"
FLAC_BITRATE_EST=900
case "$BUFFER_SECONDS" in *[!0-9]*|'') BUFFER_SECONDS=22 ;; esac
case "$MP3_BITRATE" in *[!0-9]*|'') MP3_BITRATE=192 ;; esac
case "$OPUS_BITRATE" in *[!0-9]*|'') OPUS_BITRATE=96 ;; esac
case "$AAC_BITRATE" in *[!0-9]*|'') AAC_BITRATE=192 ;; esac
[ "$BUFFER_SECONDS" -gt 60 ] && BUFFER_SECONDS=60

# Icecast burst sizes are bytes. MP3 and AAC use their exact CBR targets, Opus
# uses its constrained-VBR target, and FLAC uses a 900 kbps estimate.
MP3_BURST_SIZE=$(( BUFFER_SECONDS * MP3_BITRATE * 125 ))
OPUS_BURST_SIZE=$(( BUFFER_SECONDS * OPUS_BITRATE * 125 ))
AAC_BURST_SIZE=$(( BUFFER_SECONDS * AAC_BITRATE * 125 ))
FLAC_BURST_SIZE=$(( BUFFER_SECONDS * FLAC_BITRATE_EST * 125 ))
ICECAST_BURST_SIZE=$MP3_BURST_SIZE

MAX_BURST_SIZE=$MP3_BURST_SIZE
[ "$OPUS_BURST_SIZE" -gt "$MAX_BURST_SIZE" ] && MAX_BURST_SIZE=$OPUS_BURST_SIZE
[ "$AAC_BURST_SIZE" -gt "$MAX_BURST_SIZE" ] && MAX_BURST_SIZE=$AAC_BURST_SIZE
[ "$FLAC_BURST_SIZE" -gt "$MAX_BURST_SIZE" ] && MAX_BURST_SIZE=$FLAC_BURST_SIZE
ICECAST_QUEUE_SIZE=$(( MAX_BURST_SIZE * 4 ))
[ "$ICECAST_QUEUE_SIZE" -lt 2097152 ] && ICECAST_QUEUE_SIZE=2097152

AUTH_ENABLED=false
if [ "$(cat "$STATE_DIR/icecast_listener_auth.txt" 2>/dev/null | tr -d '[:space:]')" = "true" ]; then
    AUTH_ENABLED=true
fi
AUTH_URL="${LISTENER_AUTH_URL:-http://controller:7701/listener-auth}"

: > "$MOUNTS_XML"
: > "$TRUSTED_XML"
TRUSTED_LIST=""
TRUSTED_SOURCE=ICECAST_TRUSTED_PROXY_IPS
if [ -n "${ICECAST_TRUSTED_PROXY_IPS:-}" ]; then
    TRUSTED_LIST=$(echo "$ICECAST_TRUSTED_PROXY_IPS" | tr ',' ' ')
else
    TRUSTED_SOURCE=ICECAST_TRUSTED_PROXY_HOSTS
    for host in $(echo "${ICECAST_TRUSTED_PROXY_HOSTS:-caddy}" | tr ',' ' '); do
        found=$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)
        [ -n "$found" ] && TRUSTED_LIST="$TRUSTED_LIST $found"
    done
fi
render_trusted_proxies "$TRUSTED_XML" "$TRUSTED_SOURCE" $TRUSTED_LIST
render_mount() {
    local mount=$1 bitrate=$2 burst queue
    burst=$(( BUFFER_SECONDS * bitrate * 125 ))
    queue=$(( burst * 4 ))
    [ "$queue" -lt 2097152 ] && queue=2097152
    cat >> "$MOUNTS_XML" <<EOF
    <mount type="normal">
        <mount-name>$mount</mount-name>
        <burst-size>$burst</burst-size>
        <queue-size>$queue</queue-size>
EOF
    if [ "$AUTH_ENABLED" = true ]; then
        cat >> "$MOUNTS_XML" <<EOF
        <authentication type="url">
            <option name="listener_add" value="$AUTH_URL"/>
            <option name="auth_header" value="icecast-auth-user: 1"/>
        </authentication>
EOF
    fi
    cat >> "$MOUNTS_XML" <<EOF
    </mount>
EOF
}

render_mount /stream.mp3 "$MP3_BITRATE"
render_mount /stream.opus "$OPUS_BITRATE"
render_mount /stream.flac "$FLAC_BITRATE_EST"
render_mount /stream.aac "$AAC_BITRATE"

sed \
    -e "s|\${ICECAST_SOURCE_PASSWORD}|$ICECAST_SOURCE_PASSWORD|g" \
    -e "s|\${ICECAST_ADMIN_PASSWORD}|$ICECAST_ADMIN_PASSWORD|g" \
    -e "s|\${ICECAST_RELAY_PASSWORD}|$ICECAST_RELAY_PASSWORD|g" \
    -e "s|\${ICECAST_MAX_CLIENTS}|$ICECAST_MAX_CLIENTS|g" \
    -e "s|\${ICECAST_BURST_SIZE}|$ICECAST_BURST_SIZE|g" \
    -e "s|\${ICECAST_QUEUE_SIZE}|$ICECAST_QUEUE_SIZE|g" \
    -e "/<!--@STREAM_MOUNTS@-->/r $MOUNTS_XML" \
    -e "/<!--@STREAM_MOUNTS@-->/d" \
    -e "/<!--@TRUSTED_PROXIES@-->/r $TRUSTED_XML" \
    -e "/<!--@TRUSTED_PROXIES@-->/d" \
    "$TEMPLATE" > "$RENDERED"

echo "icecast-render: ${BUFFER_SECONDS}s bursts: mp3=${MP3_BURST_SIZE}B opus=${OPUS_BURST_SIZE}B aac=${AAC_BURST_SIZE}B flac~=${FLAC_BURST_SIZE}B; queue=${ICECAST_QUEUE_SIZE}B; auth=${AUTH_ENABLED}" >&2
