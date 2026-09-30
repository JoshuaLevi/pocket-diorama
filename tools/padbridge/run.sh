#!/usr/bin/env bash
# Builds the pad bridge if needed and runs it. Ctrl-C stops it and lets go of
# every key it is holding.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HERE/build/padbridge"
SRC="$HERE/PadBridge.swift"
mkdir -p "$HERE/build"
if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ]; then
  echo "building padbridge..."
  swiftc -O -o "$BIN" "$SRC"
fi
exec "$BIN" "$@"
