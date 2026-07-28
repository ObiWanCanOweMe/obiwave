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

ICECAST_MAX_CLIENTS="${ICECAST_MAX_CLIENTS:-100}"
case "$ICECAST_MAX_CLIENTS" in *[!0-9]*|'') ICECAST_MAX_CLIENTS=100 ;; esac

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
if [ -n "${ICECAST_TRUSTED_PROXY_IPS:-}" ]; then
    TRUSTED_LIST=$(echo "$ICECAST_TRUSTED_PROXY_IPS" | tr ',' ' ')
else
    for host in $(echo "${ICECAST_TRUSTED_PROXY_HOSTS:-caddy}" | tr ',' ' '); do
        found=$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)
        [ -n "$found" ] && TRUSTED_LIST="$TRUSTED_LIST $found"
    done
fi
for ip in $TRUSTED_LIST; do
    case "$ip" in
        ''|*[!0-9a-fA-F.:]*) continue ;;
    esac
    echo "        <x-forwarded-for>$ip</x-forwarded-for>" >> "$TRUSTED_XML"
done
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
