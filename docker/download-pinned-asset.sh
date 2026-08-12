#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 URL SHA256 OUTPUT" >&2
  exit 2
fi

url=$1
expected_sha256=$2
output=$3
partial="${output}.part.$$"

cleanup() {
  rm -f "$partial"
}
trap cleanup EXIT HUP INT TERM

# GitHub release downloads redirect to a separate asset CDN. Retry transient
# failures on either leg, but keep the attempt count and wall clock bounded.
curl --fail --location --silent --show-error \
  --retry 4 --retry-all-errors --retry-delay 2 --retry-max-time 300 \
  --connect-timeout 30 --max-time 300 \
  --output "$partial" "$url"

printf '%s  %s\n' "$expected_sha256" "$partial" | sha256sum --check -
mv "$partial" "$output"
