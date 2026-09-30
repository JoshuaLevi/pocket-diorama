#!/usr/bin/env bash
# TypeScript compile gate for the lens scripts.
#
# This gate has four known ways to pass silently, all guarded here:
#   1. lensifyts colours its human output, so grepping for "error TS" on the raw
#      stream matches nothing even when the build failed. We use --jsonLogs instead
#      of stripping ANSI, so there is no colouring to be blind to in the first place.
#   2. The binary moved between Lens Studio versions (Es_TypeScriptCompiler.bundle on
#      5.15, Es_TypeScriptCompilationManager.bundle on 5.23). We resolve it, never assume.
#   3. The exit code does not reliably track compilation errors, so we count them.
#   4. The count comes from the structured stream but attribution needs the file path,
#      which only the text carries; if the two disagree the gate reports BROKEN rather
#      than a verdict. See the long note by the split below.
#
# A marker line is always printed, so "gate passed" and "gate never ran" cannot be
# confused. Run with --selftest to prove the gate can still fail.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="CARTRIDGE-GATE"

find_compiler() {
  local candidate
  for candidate in \
    "/Applications/Lens Studio 5.23.app/Contents/Plugins/Es_TypeScriptCompilationManager.bundle/lensifyts" \
    "/Applications/Lens Studio 5.15.app/Contents/Plugins/Es_TypeScriptCompiler.bundle/lensifyts"
  do
    [ -x "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

COMPILER="$(find_compiler)" || { echo "$MARKER: FAIL - no lensifyts binary found"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TSCONFIG="$ROOT/tsconfig.json"
SELFTEST_FILE=""
if [ "${1:-}" = "--selftest" ]; then
  # Plant a file that cannot typecheck, then confirm the gate reports FAIL.
  SELFTEST_FILE="$ROOT/Assets/Scripts/__GateSelfTest.ts"
  printf 'const broken: number = "not a number";\nexport const selfTest = broken;\n' > "$SELFTEST_FILE"
  trap 'rm -rf "$TMP"; rm -f "$SELFTEST_FILE"' EXIT
fi

RAW="$TMP/out.json"
"$COMPILER" tsc-only --tsconfig "$TSCONFIG" --jsonLogs >"$RAW" 2>&1
EXIT_CODE=$?

# Diagnostics are split by origin, because they mean different things. This is the
# same split tools/gate515.sh has made since 8 September, made here for the same
# reason and one more.
#
# What this gate asserts is that OUR OWN scripts compile. The tsconfig Lens Studio
# generates also pulls Cache/TypeScript/Src/Packages/**/*.ts into the program, so
# every installed package is type checked too. That is worth reporting and wrong as
# a verdict: we did not write those sources, we do not ship them, and WHICH of them
# exist is a property of the developer's machine, not of this repository.
# Packages/Leaf.lspkg is gitignored (.gitignore:47), so before this split a clean
# clone and a working copy could disagree about whether the gate passed at all.
#
# Measured on 9 September: Lens Studio 5.22, opened only to serve the MCP, re-unpacked
# every package into the cache at 01:04, and the gate went red at once on a tree whose
# last commit was 00:38. Leaf 2.0.2 types a createEvent result as MessageEvent, and no
# installed Lens Studio declares that name -- 5.15, 5.22 and 5.23 have only
# WebSocketMessageEvent. Nothing our code did, and nothing our code can fix. Nine
# stages of work stashed themselves against it rather than weaken a gate, which is the
# protocol working, and a whole night that produced no commits, which is the protocol
# costing more than it protected.
#
# A fourth way to pass silently, guarded below: the count comes from the structured
# stream but the ATTRIBUTION needs the file path, which only the text carries. If the
# two disagree about whether there are diagnostics at all, this gate refuses to give a
# verdict. A gate that cannot read its own compiler must never report PASS.
#
# Anything that cannot be attributed to a package counts as ours, so an unrecognised
# diagnostic shape fails the gate rather than escaping through it.
STRIPPED="$TMP/stripped.txt"
sed -E 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$RAW" > "$STRIPPED"

JSON_COUNT="$(grep -o '"code"[[:space:]]*:[[:space:]]*"\?TS[0-9]\+' "$RAW" 2>/dev/null | wc -l | tr -d ' ')"
DIAG="$TMP/diagnostics.txt"
grep -E "error TS[0-9]+" "$STRIPPED" | sort -u > "$DIAG"
COUNT="$(grep -c "error TS" "$DIAG" || true)"

echo "$MARKER: compiler=$(basename "$(dirname "$COMPILER")")"

if [ "$JSON_COUNT" -gt 0 ] && [ "$COUNT" -eq 0 ]; then
  echo "$MARKER: BROKEN - $JSON_COUNT diagnostics in the structured stream, none readable as text, so none can be attributed"
  exit 2
fi

PKG="$(grep -c "Cache/TypeScript/Src/Packages/" "$DIAG" || true)"
OURS=$((COUNT - PKG))

echo "$MARKER: exit=$EXIT_CODE ours=$OURS packages=$PKG"
if [ "$PKG" -gt 0 ]; then
  echo "$MARKER: note - $PKG package diagnostic(s), reported and not counted: installed packages are neither our source nor shipped from here"
  grep "Cache/TypeScript/Src/Packages/" "$DIAG" | head -5
fi
if [ "$OURS" -gt 0 ]; then
  grep -v "Cache/TypeScript/Src/Packages/" "$DIAG" | head -40
  echo "$MARKER: FAIL"
  exit 1
fi
echo "$MARKER: PASS"
