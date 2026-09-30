#!/usr/bin/env bash
# Regenerate the golden reference: gen1recomp's own extractor, over your cartridge.
#
#   ./tools/golden.sh [/path/to/rom.gb] [red|blue|yellow]
#
# The golden files are what makes `worldfromrom.test.mjs` meaningful. That test
# runs the LENS's extractor over the same ROM and requires the output to be
# byte-identical to gen1recomp's -- which is the only check in this project that
# can catch our extractor being confidently, consistently wrong. Without it the
# suite still passes, because everything else compares our code against our code.
#
# The output is DERIVED FROM THE CARTRIDGE and must never be committed. It lands
# in a scratch directory outside the repository, and the path is printed so you
# can export CARTRIDGE_GOLDEN and re-run ./tools/verify.sh.
#
# Needs: python3 with Pillow, git, and a network connection the first time.
set -euo pipefail

ROM="${1:-$HOME/Downloads/Pokemon - Red Version (USA, Europe).gb}"
VERSION="${2:-red}"
WORK="${CARTRIDGE_WORK:-${TMPDIR:-/tmp}/cartridge-golden}"

if [ ! -f "$ROM" ]; then
  echo "no ROM at $ROM" >&2
  echo "usage: golden.sh [/path/to/rom.gb] [red|blue|yellow]" >&2
  exit 2
fi

mkdir -p "$WORK"
if [ ! -d "$WORK/g1r/.git" ]; then
  echo "cloning gen1recomp's tools (MIT, no ROM bytes)..."
  git clone --depth 1 --filter=blob:none --sparse \
      https://github.com/bryanthaboi/gen1recomp.git "$WORK/g1r" >/dev/null 2>&1
  git -C "$WORK/g1r" sparse-checkout set tools >/dev/null 2>&1
fi

OUT="$WORK/$VERSION"
rm -rf "$OUT"
echo "extracting with gen1recomp's build_data.py..."
python3 "$WORK/g1r/tools/build_data.py" --rom "$ROM" --version "$VERSION" \
        --out "$OUT/data" --assets "$OUT/assets" >/dev/null

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$ROOT/tools/lua_to_json.py" "$OUT/data" "$OUT/json" >/dev/null

echo
echo "GOLDEN OK  $(ls "$OUT/json" | wc -l | tr -d ' ') datasets"
echo
echo "  export CARTRIDGE_GOLDEN=$OUT/json"
echo "  ./tools/verify.sh"
