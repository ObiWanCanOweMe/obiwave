#!/usr/bin/env bash
# Render Icecast once for both the split broadcast image and the AIO image.
if [ "${SUBWAVE_ICECAST_RENDER_LIB:-}" != "1" ]; then set -eu; fi

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

stream_buffer_seconds() {
    read_state_uint liquidsoap_stream_buffer_seconds.txt 22
}

# A handoff number as a plain decimal. What the controller writes reads here as
# it does in radio.liq, and so does a CRLF or padded hand-edit: surrounding
# whitespace is trimmed (its string.trim), so liquidsoap is handed the bitrate it
# would have read itself, not the fallback. At most six digits (anything longer
# is the fallback), and leading zeros as decimal, never as bash arithmetic's
# octal. The trim below is quadratic, and a padded or corrupt file must not hold
# icecast and the dead-air guard back at boot, so whitespace runs are squeezed
# first and at most 64 bytes of that reach it. Squeezed, padding can neither push
# a value out of those bytes nor cut one in half, which a plain `head -c` of the
# file would: 62 spaces and 128 would read as 12. Other hand-edits part from
# radio.liq, whose int_of_string also takes 0x80, +128, 1_000 and 7+ digits: each
# of those is the fallback here.
read_state_uint() {
    local v
    v=$(tr -s '[:space:]' ' ' 2>/dev/null < "$STATE_DIR/$1" | head -c 64 || true)
    v=${v#"${v%%[![:space:]]*}"}
    v=${v%"${v##*[![:space:]]}"}
    case "$v" in ''|*[!0-9]*) v=$2 ;; esac
    [ "${#v}" -le 6 ] || v=$2
    echo "$(( 10#$v ))"
}

# A bitrate a burst can be sized for. Zero is junk here because radio.liq
# refuses it too (`v > 0`): a burst sized for 0 kbps holds nothing, while the
# encoder runs at its default.
read_state_kbps() {
    local v
    v=$(read_state_uint "$1" "$2")
    [ "$v" -gt 0 ] || v=$2
    echo "$v"
}

# A burst's bitrate, from ICECAST_*_BITRATE or the setting it overrides, as a
# plain number, so stream-mounts.json always holds valid JSON. $1 = the value,
# $2 = the default for junk. Bash arithmetic reads it, because the burst sizing
# always has: a leading zero is octal here (0100 is 64), and reading that as
# decimal would re-size the burst of a station that sets one. 0128 is not octal,
# and was an arithmetic error that aborted the render, so it reads as decimal,
# like a handoff file.
burst_kbps() {
    local v=$1
    case "$v" in
        ''|*[!0-9]*) v=$2 ;;
        0*[89]*) v=$(( 10#$v )) ;;
    esac
    echo "$(( v ))"
}

# Liquidsoap source $1 on one line, with its comments out. Whichever form starts
# first wins, as in the lexer, so a `#<` inside a `#` comment opens nothing. Not
# a lexer: a `#` in a string cuts too. A `#<` that never closes leaves a bare
# %opus behind, which reads as doubt: Liquidsoap refuses such a file unless the
# `#<` sat in a string, and then what it cut is real code. scripts/opus-cbr.test.ts
# cuts the same way, and both answer to one table
# (scripts/test-utils/opus-cbr-table.ts).
liq_code() {
    awk '{
line = $0
while ((i = index(line, block ? ">#" : "#"))) {
    if (block) {
        block = 0
        line = substr(line, i + 2)
    } else if (substr(line, i, 2) == "#<") {
        block = 1
        code = code substr(line, 1, i - 1) " "
        line = substr(line, i + 2)
    } else {
        line = substr(line, 1, i - 1)
        break
    }
}
print code (block ? "" : line)
code = ""
}
END { if (block) print "%opus" }' "$1" 2>/dev/null | tr '\n' ' '
}

# The Opus mount's encoding, read from the radio.liq liquidsoap is about to load:
# `cbr` only when EVERY %opus encoder in it says vbr="none" (hard CBR, whose
# byte-sized burst holds the seconds it was sized for), `vbr` when any does not,
# and nothing when there is none to read. Taken from the encoder line itself,
# not declared beside it, so the answer changes in the same edit as the encoder
# (#2138) and cannot outlive it. A client may treat the Opus burst as seconds
# only on `cbr` (#2142); every doubt reads as not-CBR:
# - no vbr at all, or a bare %opus: the 2.4.6 default is constrained VBR;
# - any dtx but a literal false: true can stop sending silent frames whatever the
#   vbr mode, and dtx=(true) or dtx=d is as real;
# - vbr given twice: the last one wins, so one saying "none" proves nothing;
# - a `(` inside the call: the first `)` then need not close it, so a dtx or a
#   second vbr can sit past it, and `bitrate=(96), dtx=true` is DTX on 2.4.6;
# - libopus, an %ffmpeg encoder this cannot read.
# Read in the C locale, or a UTF-8 grep would take an em space for [[:space:]] and
# the operator's LC_ALL would change the answer.
opus_encoding() {
    local -x LC_ALL=C
    local calls key='[^[:alnum:]_]' eq='[[:space:]]*=[[:space:]]*'
    calls=$(liq_code "$1" | grep -oE 'libopus|%opus([[:space:]]*\([^)]*\)|[^[:alnum:]_])' || true)
    [ -n "$calls" ] || return 0
    if printf '%s\n' "$calls" | grep -qvE "${key}vbr$eq[\"']none[\"']" \
        || printf '%s\n' "$calls" | grep -qE "libopus|\(.*\(|${key}vbr$eq.*${key}vbr$eq" \
        || printf '%s\n' "$calls" | grep -oE "${key}dtx$eq[^,)[:space:]]*" | grep -qvE "^${key}dtx${eq}false$"; then
        echo vbr
    else
        echo cbr
    fi
    return 0
}

# Appends one stream mount to the icecast.xml fragment $1, and its entry to the
# caller's STREAM_MOUNTS_JSON. $2 = mount path, $3 = kbps this mount's burst is
# sized for, $4 = listener-auth URL already XML-escaped ('' = auth off), $5 =
# extra marker fields (',"key":"value"' or '').
emit_stream_mount() {
    local xml=$1 mount=$2 kbps=$3 auth_url=$4 extra=${5:-} burst queue
    burst=$(( BUFFER_SECONDS * kbps * 125 ))
    queue=$(( burst * 4 ))
    [ "$queue" -ge 2097152 ] || queue=2097152
    state_log "  $mount @ ${kbps}kbps → burst-size ${burst}B, queue-size ${queue}B"
    {
        echo '    <mount type="normal">'
        echo "        <mount-name>$mount</mount-name>"
        echo "        <burst-size>$burst</burst-size>"
        echo "        <queue-size>$queue</queue-size>"
        if [ -n "$auth_url" ]; then
            echo '        <authentication type="url">'
            echo "            <option name=\"listener_add\" value=\"$auth_url\"/>"
            echo '            <option name="auth_header" value="icecast-auth-user: 1"/>'
            # The station has ONE shared password and the username is ignored, so many
            # listeners present the same name (docs suggest `listener`). icecast-kh admits
            # one connection per username unless told otherwise: the second gets a 403,
            # or hangs unanswered when it arrives while the first is still closing, which
            # is what an iOS player's range probe followed by its real request does.
            echo '            <option name="allow_duplicate_users" value="1"/>'
            echo '        </authentication>'
        fi
        echo '    </mount>'
    } >> "$xml"
    STREAM_MOUNTS_JSON="$STREAM_MOUNTS_JSON,\"$mount\":{\"kbps\":$kbps,\"burstSeconds\":$BUFFER_SECONDS,\"burstBytes\":$burst$extra}"
    return 0
}

# Replaces the state marker $1 with the line $2, non-zero if it could not.
# Through a fresh mktemp file and a rename, like write_icecast_secrets, so a
# symlink planted ahead of the write is not written through, and one planted at
# $1 is replaced, not followed. The fixed-name temp this used to write is dropped
# first. 644 before the rename, so the marker never shows at mktemp's 600; a
# refused chmod is no failure, because a mount that refuses chmod is a working
# config (see state_writable_by_others).
write_state_marker() {
    local marker=$1 line=$2 tmp
    rm -f "$marker.tmp" 2>/dev/null || true
    tmp=$(mktemp "$marker.XXXXXX" 2>/dev/null) || return 1
    chmod 644 "$tmp" 2>/dev/null || true
    if printf '%s\n' "$line" > "$tmp" 2>/dev/null \
        && mv -fT "$tmp" "$marker" 2>/dev/null; then
        return 0
    fi
    rm -f "$tmp" 2>/dev/null || true
    return 1
}

# $STATE_DIR/stream-mounts.json: what this render gave each mount (#2142).
# /now-playing advertises the MP3 mount's burstSeconds to listeners, so the
# marker is rewritten on EVERY render. A failed write removes the old one rather
# than leave it describing an earlier render (the controller then advertises the
# setting), and is never fatal, same rule as the state bootstrap above. Only
# when that removal fails too, as on a read-only state mount, does a marker
# outlive its render.
write_stream_mounts_marker() {
    # $1 = the mounts JSON object
    local dir=${STATE_DIR:-}
    [ -n "$dir" ] || return 0
    local marker=$dir/stream-mounts.json
    if ! write_state_marker "$marker" "{\"mounts\":$1,\"at\":$(date +%s)}"; then
        rm -f "$marker" 2>/dev/null || true
        state_warn "could not write $marker — the station is unaffected, but listeners may be told a buffer these mounts were not rendered with"
    fi
    return 0
}

# Listener buffer depth (<burst-size>, #993/#1114) for every stream mount, ALWAYS
# rendered (not just under auth). burst-size is a BYTE count, so it is sized in
# SECONDS and converted per mount's bitrate: one global figure sized for MP3 is
# a different depth everywhere else (22s of mp3-192k is ~43s of opus-96k, ~6s of
# FLAC). Each <queue-size> is 4x its burst, floored at 2 MB, or a client is
# evicted the moment it falls behind its own primed buffer (#993).
#
# Every setting is read ONCE, here (#2143). The same bitrates are handed to
# liquidsoap as SUBWAVE_{STREAM,OPUS,AAC}_BITRATE, which radio.liq takes before
# its own file read, so a save landing between this render and liquidsoap's
# start cannot size a burst for one encoder and build another. What was
# rendered goes to stream-mounts.json, because listeners must be told the burst
# these mounts hold, not a setting saved since (#2142). A change applies on the
# next pair launch.
#
#   render_stream_mounts $1=XML fragment path, $2=listener-auth URL already
#   XML-escaped ('' = auth off), $3=the radio.liq liquidsoap will load.
#
# Sets BUFFER_SECONDS, STREAM_BITRATE, OPUS_BITRATE, AAC_BITRATE,
# FLAC_BITRATE_EST, and the global <limits> ICECAST_BURST_SIZE /
# ICECAST_QUEUE_SIZE (sized for MP3).
#
# docker/aio/supervisor.sh sources these shared functions and messages;
# scripts/stream-mounts.test.ts drives both from one table.
render_stream_mounts() {
    local xml=$1 auth_url=$2 radio_liq=$3 opus_enc STREAM_MOUNTS_JSON=''
    BUFFER_SECONDS=$(stream_buffer_seconds)
    [ "$BUFFER_SECONDS" -le 60 ] || BUFFER_SECONDS=60
    SUBWAVE_STREAM_BITRATE=$(read_state_kbps liquidsoap_stream_bitrate.txt 192)
    SUBWAVE_OPUS_BITRATE=$(read_state_kbps liquidsoap_opus_bitrate.txt 96)
    SUBWAVE_AAC_BITRATE=$(read_state_kbps liquidsoap_aac_bitrate.txt 192)
    export SUBWAVE_STREAM_BITRATE SUBWAVE_OPUS_BITRATE SUBWAVE_AAC_BITRATE
    # ICECAST_*_BITRATE re-size a mount's burst and nothing else; the encoder
    # keeps the setting, as it always has.
    STREAM_BITRATE=$(burst_kbps "${ICECAST_STREAM_BITRATE:-$SUBWAVE_STREAM_BITRATE}" 192)
    OPUS_BITRATE=$(burst_kbps "${ICECAST_OPUS_BITRATE:-$SUBWAVE_OPUS_BITRATE}" 96)
    AAC_BITRATE=$(burst_kbps "${ICECAST_AAC_BITRATE:-$SUBWAVE_AAC_BITRATE}" 192)
    # FLAC is VBR with no bitrate setting — ~900 kbps is a typical average for
    # 44.1/16 stereo, close enough for a buffer depth.
    FLAC_BITRATE_EST=900

    # kbps → bytes/sec is bitrate * 1000 / 8 = bitrate * 125.
    ICECAST_BURST_SIZE=$(( BUFFER_SECONDS * STREAM_BITRATE * 125 ))
    ICECAST_QUEUE_SIZE=$(( ICECAST_BURST_SIZE * 4 ))
    [ "$ICECAST_QUEUE_SIZE" -ge 2097152 ] || ICECAST_QUEUE_SIZE=2097152

    opus_enc=$(opus_encoding "$radio_liq")
    state_log "listener buffer ${BUFFER_SECONDS}s @ mp3 ${STREAM_BITRATE}kbps / opus ${OPUS_BITRATE}kbps (${opus_enc:-unknown encoding}) / aac ${AAC_BITRATE}kbps / flac ~${FLAC_BITRATE_EST}kbps"
    : > "$xml"
    emit_stream_mount "$xml" /stream.mp3  "$STREAM_BITRATE"   "$auth_url"
    emit_stream_mount "$xml" /stream.opus "$OPUS_BITRATE"     "$auth_url" "${opus_enc:+,\"encoding\":\"$opus_enc\"}"
    emit_stream_mount "$xml" /stream.flac "$FLAC_BITRATE_EST" "$auth_url"
    emit_stream_mount "$xml" /stream.aac  "$AAC_BITRATE"      "$auth_url"
    write_stream_mounts_marker "{${STREAM_MOUNTS_JSON#,}}"
    return 0
}


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
    if ! write_state_marker "$marker" "{\"count\":$1,\"source\":\"$2\",\"proxies\":$3,\"dropped\":$4,\"at\":$(date +%s)}"; then
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


xml_escape() {
    local s=$1
    s=${s//'&'/'&amp;'}
    s=${s//'<'/'&lt;'}
    s=${s//'>'/'&gt;'}
    s=${s//'"'/'&quot;'}
    printf '%s' "$s"
}


render_icecast_config() {
    # Keep the caller's env override distinct from a value resolved this run.
    # AIO calls again after settings saves; a prior result must not become env.
    local ICECAST_MAX_CLIENTS="${ICECAST_MAX_CLIENTS:-}"
    STATE_DIR="${ICECAST_STATE_DIR:-/var/sub-wave}"
    TEMPLATE="${ICECAST_TEMPLATE:-/etc/icecast2/icecast.xml.template}"
    RENDERED="${ICECAST_RENDERED:-/etc/icecast2/icecast.xml}"
    MOUNTS_XML="${RENDERED}.mounts"
    TRUSTED_XML="${RENDERED}.proxies"
    MAX_CLIENTS_LINE=$(resolve_max_clients)
    ICECAST_MAX_CLIENTS="${MAX_CLIENTS_LINE%% *}"
    echo "icecast-render: max listeners $ICECAST_MAX_CLIENTS (from ${MAX_CLIENTS_LINE#* })" >&2

    AUTH_ENABLED=false
    if [ "$(cat "$STATE_DIR/icecast_listener_auth.txt" 2>/dev/null | tr -d '[:space:]')" = "true" ]; then
        AUTH_ENABLED=true
    fi
    AUTH_URL="${LISTENER_AUTH_URL:-http://controller:7701/listener-auth}"
    MOUNT_AUTH_URL_XML=''
    if [ "$AUTH_ENABLED" = true ]; then MOUNT_AUTH_URL_XML=$(xml_escape "$AUTH_URL"); fi
    render_stream_mounts "$MOUNTS_XML" "$MOUNT_AUTH_URL_XML" "${ICECAST_RADIO_LIQ:-/etc/liquidsoap/radio.liq}"

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

}

if [ "${SUBWAVE_ICECAST_RENDER_LIB:-}" != "1" ]; then
    render_icecast_config
fi
