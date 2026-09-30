#!/usr/bin/env bash
# Portability gate: do the lens scripts still compile against Lens Studio 5.15.4?
#
# The device target is Spectacles (2024), which ships from LS 5.15.4, while
# development happens in 5.23 for CLAD and LEAF. Finding a 5.23-only API at
# migration time is exactly the failure this project is built to avoid, so 5.15's
# compiler runs against the same sources on every change.
#
# The gate stages a throwaway copy of the tree -- scripts, unpacked package sources
# and 5.15's own declarations under one root -- which is also what the real
# migration does, so a pass here means the migration is mechanical.
#
# Three ways this compiler passes silently, all guarded:
#   1. --componentsCompileDir is required; without it the binary exits before
#      compiling and prints a CLI usage error and no diagnostics.
#   2. 5.15 rejects noEmit and demands outDir and rootDir, and reports that as a
#      thrown Error rather than as a diagnostic.
#   3. The process exit code does not track diagnostics.
# Run with --selftest to prove the gate can still fail.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="CARTRIDGE-GATE-515"
LS515="/Applications/Lens Studio 5.15.app"
COMPILER="$LS515/Contents/Plugins/Es_TypeScriptCompiler.bundle/lensifyts"
DECLS="$LS515/Contents/Plugins/Es_TypeScriptCompiler.bundle/TypeScript/lib/LensifyTS/Declarations"

[ -x "$COMPILER" ] || { echo "$MARKER: SKIP - Lens Studio 5.15 not installed"; exit 0; }
[ -d "$DECLS" ]    || { echo "$MARKER: SKIP - 5.15 declarations not found"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SRC="$TMP/src"
mkdir -p "$SRC/Assets" "$SRC/Packages" "$TMP/out" "$TMP/components"
cp -R "$ROOT/Assets/Scripts" "$SRC/Assets/Scripts"
if [ -d "$ROOT/Cache/TypeScript/Src/Packages" ]; then
  rsync -a --chmod=u+w "$ROOT/Cache/TypeScript/Src/Packages/" "$SRC/Packages/"
fi

# ...and then the DEVICE project's own packages on top, where it has them.
#
# This gate compiles our sources with 5.15's compiler, and until 8 September it
# resolved their imports against the 5.23 project's packages -- SIK 0.18, and
# whatever else development had installed. The device project has different
# ones: SIK 0.16.4, and now UIKit 0.1.4. So the gate could pass on an API the
# device does not have, which is the exact failure it exists to prevent.
#
# Overlaid rather than replacing, because the 5.23 tree is where most of the
# package sources come from and the sibling only carries the few it installs.
# rsync rather than cp: the cached sources are read-only and cp refuses to
# overwrite them, which silently left the 5.23 copy in place.
SIB="$ROOT/../Pokemon-AR-515"
if [ -d "$SIB/Cache/TypeScript/Src/Packages" ]; then
  rsync -a --chmod=u+w "$SIB/Cache/TypeScript/Src/Packages/" "$SRC/Packages/"
fi
# A package installed from the Asset Library lands unpacked under Assets/
# rather than as a zip in Packages/ -- that is where Lens Studio 5.15 put
# UIKit -- so both places are staged.
if [ -d "$SIB/Cache/TypeScript/Src/Assets" ]; then
  for pkg in "$SIB/Cache/TypeScript/Src/Assets/"*.lspkg; do
    [ -d "$pkg" ] && rsync -a --chmod=u+w "$pkg" "$SRC/Assets/"
  done
fi
cp -R "$DECLS/." "$SRC/Declarations/"
rm -f "$SRC/Declarations/tsconfig.json"

if [ "${1:-}" = "--selftest" ]; then
  # Two planted faults. The first is a plain type error, which must always be
  # caught -- if it is not, the gate is not compiling our sources at all. The
  # second is a 5.23-only API, which is the failure this gate actually exists for.
  cat > "$SRC/Assets/Scripts/__Gate515SelfTest.ts" <<'TS'
const wrongType: number = "not a number";
export const selfTestA = wrongType;
export function selfTestB(gatt: Bluetooth.BluetoothGatt): unknown {
  return (gatt as { mtu: number }).mtu;
}
TS
fi

cat > "$TMP/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "allowJs": true,
    "isolatedModules": true,
    "lib": ["es2021"],
    "module": "commonjs",
    "target": "es2021",
    "rootDir": "$SRC",
    "outDir": "$TMP/out",
    "skipDefaultLibCheck": true,
    "skipLibCheck": true,
    "types": [],
    "baseUrl": "$SRC",
    "paths": { "*": ["./Assets/*", "./Packages/*"] }
  },
  "include": ["$SRC/**/*.ts"]
}
JSON

RAW="$TMP/out.txt"
"$COMPILER" --tsconfig "$TMP/tsconfig.json" --declarations "$DECLS" \
            --parseDir "$SRC/Assets/Scripts" \
            --componentsCompileDir "$TMP/components" --jsonLogs >"$RAW" 2>&1
EXIT_CODE=$?

echo "$MARKER: compiler=5.15.4"

if grep -qE "Failed to parse tsconfig|^Error:|^error: (required|unknown) option" "$RAW"; then
  echo "$MARKER: BROKEN - the compiler stopped before type checking, nothing was verified"
  grep -E "Failed to parse tsconfig|^Error:|^error: (required|unknown) option" "$RAW" | head -3
  exit 2
fi
if [ ! -s "$RAW" ]; then
  echo "$MARKER: BROKEN - compiler produced no output at all"
  exit 2
fi

DIAG="$TMP/diagnostics.txt"
sed -E 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$RAW" \
  | grep -oE "[^\"]*error TS[0-9]+[^\\\\\"]*" | sort -u > "$DIAG"

# Errors are split by origin, because they mean different things.
#
# Package errors are expected and are NOT this project's problem: the tree carries
# SIK 0.18, a 5.23-era package that uses vec3 helpers (uniformScaleInPlace,
# addInPlace, copyFrom) which do not exist in the 5.15 API. The migration playbook
# is explicit that a 5.15 project takes its own SIK from the 5.15 template and that
# 5.22+ .lspkg packages must never be copied across. So they are reported, loudly,
# and not counted.
#
# What this gate actually asserts is that OUR OWN scripts compile against 5.15.
OURS="$(grep -c "src/Assets/Scripts/" "$DIAG" || true)"
PKG="$(grep -c "src/Packages/" "$DIAG" || true)"

echo "$MARKER: exit=$EXIT_CODE ours=$OURS packages=$PKG bytes=$(wc -c <"$RAW" | tr -d ' ')"
if [ "$PKG" -gt 0 ]; then
  echo "$MARKER: note - $PKG package diagnostics, expected: the kits are compiled here for their TYPES, not to ship, and neither is clean under 5.15's own compiler"
fi
if [ "$OURS" -gt 0 ]; then
  grep "src/Assets/Scripts/" "$DIAG" | head -30
  echo "$MARKER: FAIL"
  exit 1
fi
echo "$MARKER: PASS"
