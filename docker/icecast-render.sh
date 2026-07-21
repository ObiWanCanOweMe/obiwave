#!/usr/bin/env bash
# Render Icecast once for both the split broadcast image and the AIO image.
set -eu

STATE_DIR="${ICECAST_STATE_DIR:-/var/sub-wave}"
TEMPLATE="${ICECAST_TEMPLATE:-/etc/icecast2/icecast.xml.template}"
RENDERED="${ICECAST_RENDERED:-/etc/icecast2/icecast.xml}"
MOUNTS_XML="${RENDERED}.mounts"

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
AAC_BITRATE="${ICECAST_AAC_BITRATE:-$(read_state_num liquidsoap_aac_bitrate.txt 192)}"
case "$BUFFER_SECONDS" in *[!0-9]*|'') BUFFER_SECONDS=22 ;; esac
case "$MP3_BITRATE" in *[!0-9]*|'') MP3_BITRATE=192 ;; esac
case "$AAC_BITRATE" in *[!0-9]*|'') AAC_BITRATE=192 ;; esac
[ "$BUFFER_SECONDS" -gt 60 ] && BUFFER_SECONDS=60

# Icecast burst sizes are bytes. MP3 and AAC have exact configured byte rates.
# Opus uses constrained VBR and FLAC is variable-rate, so their mounts
# deliberately override the global burst with zero rather than promising an
# invented duration from a target/unknown bitrate.
MP3_BURST_SIZE=$(( BUFFER_SECONDS * MP3_BITRATE * 125 ))
OPUS_BURST_SIZE=0
AAC_BURST_SIZE=$(( BUFFER_SECONDS * AAC_BITRATE * 125 ))
FLAC_BURST_SIZE=0
ICECAST_BURST_SIZE=$MP3_BURST_SIZE

MAX_BURST_SIZE=$MP3_BURST_SIZE
[ "$AAC_BURST_SIZE" -gt "$MAX_BURST_SIZE" ] && MAX_BURST_SIZE=$AAC_BURST_SIZE
ICECAST_QUEUE_SIZE=$(( MAX_BURST_SIZE * 4 ))
[ "$ICECAST_QUEUE_SIZE" -lt 2097152 ] && ICECAST_QUEUE_SIZE=2097152

AUTH_ENABLED=false
if [ "$(cat "$STATE_DIR/icecast_listener_auth.txt" 2>/dev/null | tr -d '[:space:]')" = "true" ]; then
    AUTH_ENABLED=true
fi
AUTH_URL="${LISTENER_AUTH_URL:-http://controller:7701/listener-auth}"

: > "$MOUNTS_XML"
render_mount() {
    local mount=$1 burst=$2
    cat >> "$MOUNTS_XML" <<EOF
    <mount type="normal">
        <mount-name>$mount</mount-name>
        <burst-size>$burst</burst-size>
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

render_mount /stream.mp3 "$MP3_BURST_SIZE"
render_mount /stream.opus "$OPUS_BURST_SIZE"
render_mount /stream.flac "$FLAC_BURST_SIZE"
render_mount /stream.aac "$AAC_BURST_SIZE"

sed \
    -e "s|\${ICECAST_SOURCE_PASSWORD}|$ICECAST_SOURCE_PASSWORD|g" \
    -e "s|\${ICECAST_ADMIN_PASSWORD}|$ICECAST_ADMIN_PASSWORD|g" \
    -e "s|\${ICECAST_RELAY_PASSWORD}|$ICECAST_RELAY_PASSWORD|g" \
    -e "s|\${ICECAST_MAX_CLIENTS}|$ICECAST_MAX_CLIENTS|g" \
    -e "s|\${ICECAST_BURST_SIZE}|$ICECAST_BURST_SIZE|g" \
    -e "s|\${ICECAST_QUEUE_SIZE}|$ICECAST_QUEUE_SIZE|g" \
    -e "/<!--@LISTENER_AUTH_MOUNTS@-->/r $MOUNTS_XML" \
    -e "/<!--@LISTENER_AUTH_MOUNTS@-->/d" \
    "$TEMPLATE" > "$RENDERED"

echo "icecast-render: ${BUFFER_SECONDS}s CBR bursts: mp3=${MP3_BURST_SIZE}B aac=${AAC_BURST_SIZE}B; VBR bursts disabled: opus=0B flac=0B; queue=${ICECAST_QUEUE_SIZE}B; auth=${AUTH_ENABLED}" >&2
