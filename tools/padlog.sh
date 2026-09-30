#!/usr/bin/env bash
# What the Bluetooth pad did ON THE GLASSES, out of Lens Studio's own log.
#
#   tools/padlog.sh              the last pad activity, whichever Lens Studio ran it
#   tools/padlog.sh --devices    just the sightings, deduplicated
#   tools/padlog.sh --all        every pad line in the file
#   tools/padlog.sh --list       which log belongs to which Lens Studio
#
# This exists because six rounds of this were spent asking Joshua to copy log
# text out of a panel, and twice the answer was already in a file nobody read.
# Lens Studio writes everything to disk, INCLUDING the prints a lens sends back
# from the glasses -- those arrive through PushToDevice's WebSocketServer and
# are marked `handleLogMessage`, as against `[Preview N]` for the editor's own
# preview. The difference matters more than anything else in here: preview has
# no Bluetooth radio at all, so a pad line from preview is not evidence.
set -uo pipefail

LOGS="$HOME/Library/Preferences/Snap/Lens Studio/logs"
MODE="${1:-recent}"

if [ ! -d "$LOGS" ]; then
  echo "PADLOG: no Lens Studio logs at $LOGS"
  exit 1
fi

# Newest first, and only files still being written to today: several Lens
# Studio versions run at once here (5.15 for the device, 5.23 for the MCP) and
# each keeps its own file.
# Newline-separated rather than an array: macOS ships bash 3.2, which has no
# mapfile, and this script has to run on the machine the glasses are plugged
# into rather than on a modern shell somewhere else.
FILES="$(ls -t "$LOGS"/LensStudioLog-*.txt 2>/dev/null | head -6)"
if [ -z "$FILES" ]; then
  echo "PADLOG: no log files"
  exit 1
fi

version_of() {
  # The version is in the analytics payloads Lens Studio writes as it goes.
  grep -ao '"app_version":"[^"]*"' "$1" 2>/dev/null | tail -1 |
    sed 's/.*:"//; s/"//'
}

# Every line the pad wrote, from the DEVICE only.
device_lines() {
  grep -a "handleLogMessage" "$1" 2>/dev/null |
    grep -aE "BLE TEST|\[pad\]|pad: " |
    sed 's/^\(. [0-9:.]*\).*\(\[Assets[^]]*\]\) /\1 /'
}

if [ "$MODE" = "--list" ]; then
  echo "$FILES" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf "%s  %s  device pad lines: %s\n" \
      "$(version_of "$f")" "$(basename "$f")" "$(device_lines "$f" | wc -l | tr -d ' ')"
  done
  exit 0
fi

# The file with the most recent device pad activity is the one worth reading.
BEST=""
BEST_COUNT=0
OLDIFS="$IFS"
IFS='
'
for f in $FILES; do
  [ -n "$f" ] || continue
  n="$(device_lines "$f" | wc -l | tr -d ' ')"
  if [ "$n" -gt "$BEST_COUNT" ]; then
    BEST="$f"
    BEST_COUNT="$n"
  fi
done
IFS="$OLDIFS"

if [ -z "$BEST" ]; then
  echo "PADLOG: no pad lines from the glasses in any recent log."
  echo "PADLOG: (preview lines are ignored on purpose -- preview has no radio.)"
  exit 0
fi

echo "PADLOG: Lens Studio $(version_of "$BEST") -- $(basename "$BEST")"
echo "PADLOG: $BEST_COUNT pad lines from the glasses"
echo

case "$MODE" in
  --devices)
    echo "=== every device the glasses saw, once each ==="
    # The trailing space is not always there: a sighting with neither a name
    # nor an address -- which is what the older log format wrote -- ends at the
    # colon, and a sed expecting "seen: " leaves the whole timestamped line in.
    device_lines "$BEST" | grep -a "BLE TEST: seen:" |
      sed 's/^.*BLE TEST: seen:[[:space:]]*//' |
      grep -v '^$' | sort -u
    echo
    echo "(a line with only an address is a device advertising no name)"
    ;;
  --all)
    device_lines "$BEST"
    ;;
  *)
    echo "=== the last 60 ==="
    device_lines "$BEST" | tail -60
    ;;
esac
