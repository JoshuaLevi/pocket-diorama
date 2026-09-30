#!/usr/bin/env bash
# The Spectacles (2024) build: this project as a Lens Studio 5.15 sibling.
#
#   ./tools/make515.sh bootstrap   # once: build ../Pokemon-AR-515 from scratch
#   ./tools/make515.sh sync        # after: push scripts and the world across
#
# WHY A SECOND PROJECT AT ALL. Development happens in Lens Studio 5.23, which is
# what CLAD, LEAF and the SPECS template need. Spectacles (2024) runs from 5.15,
# and 5.15 will not open a 5.23 project: the version block alone stops it, and
# the packages behind it are built for a different runtime. The same split the
# BOXING project already lives with (SPECS/boxing and SPECS/boxing-515).
#
# WHAT TRAVELS AND WHAT DOES NOT.
#   * Scripts travel unchanged. tools/gate515.sh compiles them against 5.15's own
#     compiler on every change, so they are portable by construction rather than
#     by hope.
#   * The baked world travels: it is a JSON asset, and the lens reads it the same
#     way on both.
#   * The scene and its .meta files travel WITH THEIR UUIDS, so every asset the
#     scene points at still resolves. Re-importing instead would mint new ids and
#     leave the scene pointing at nothing -- the failure this copy exists to
#     avoid.
#   * The packages do NOT travel. SIK 0.18 is a 5.23 build; 5.15 gets the 5.15
#     build (from SPECS/boxing-515, which is where the last migration left one),
#     and LEAF, the AI preview agents, Bitmoji and UI Kit are editor tooling this
#     lens never imports.
#
# WHAT IS LEFT FOR A PAIR OF HANDS: opening it in 5.15 once. The SIK scene
# objects come from the 5.23 package and will not resolve against the 5.15 one,
# so they are deleted and the 5.15 package's own prefab dragged in. See
# README-515.md in the project this writes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${CARTRIDGE_515:-$(cd "$ROOT/.." && pwd)/Pokemon-AR-515}"
# SIK 0.16.4, out of the official Spectacles (2024) sample that ships with 5.15.4.
# Two reasons over the rebuilt 0.17.2 next door in boxing-515: this one is what
# Snap themselves ship for this device, and it carries the
# SpectaclesInteractionKit.prefab -- the interactor hierarchy the pad plate needs
# in the scene, which the rebuilt package does not have.
SIK515="${SIK_515:-$(cd "$ROOT/../.." && pwd)/Spectacles2024/projects/Spectacles-BoxingTrainer/Packages/SpectaclesInteractionKit.lspkg}"
MODE="${1:-sync}"

say() { echo "MAKE515: $*"; }

if [ "$MODE" != "bootstrap" ] && [ "$MODE" != "sync" ] && [ "$MODE" != "gate" ] \
   && [ "$MODE" != "publish" ] && [ "$MODE" != "testbuild" ]; then
  echo "usage: make515.sh [bootstrap|sync|gate|publish|testbuild]" >&2
  exit 2
fi

# The two device flavours. Both are the PUBLISHABLE configuration -- no
# Bluetooth pad, no LAN bridge, no Experimental APIs, the world from the site
# by code and cached from then on -- and they differ in one input: the save
# ladder behind SELECT on the title screen, which the test build has and the
# one that ships does not. Written as text rewrites of the 515 project's own
# files, the way this script has always set its lensName: the 515 project is
# a generated artefact, and Lens Studio 5.15 re-reads both files on open.
if [ "$MODE" = "publish" ] || [ "$MODE" = "testbuild" ]; then
  [ -d "$DEST/Assets" ] || { say "no project at $DEST; run bootstrap first"; exit 1; }
  LADDER="false"
  [ "$MODE" = "testbuild" ] && LADDER="true"
  python3 - "$DEST/Pokemon-AR-515.esproj" "$DEST/Assets/Scene.scene" "$LADDER" <<'PY4'
import re, sys
esproj, scene, ladder = sys.argv[1], sys.argv[2], sys.argv[3]

# Experimental APIs off: the descriptor is what makes a lens unpublishable,
# and nothing in this configuration needs it.
text = open(esproj).read()
fixed = re.sub(r"\n    - EXPERIMENTAL_API(?=\n)", "", text)
fixed = re.sub(r"lensName: .*", "lensName: Pocket Diorama", fixed, count=1)
if fixed != text:
    open(esproj, "w").write(fixed)
    print("MAKE515: esproj -- EXPERIMENTAL_API off, lensName Pocket Diorama")
else:
    print("MAKE515: esproj -- already clean")

# The PokemonAR component's inputs, inside its own ScriptInputs block only.
text = open(scene).read()
start = text.find("  Name: PokemonAR\n")
if start < 0:
    print("MAKE515: FAIL -- no PokemonAR component in Scene.scene")
    sys.exit(1)
begin = text.find("  ScriptInputs:\n", start)
end = text.find("  ScriptTypes:\n", begin)
block = text[begin:end]
wanted = {
    "preferCache": "true",
    "enableBleController": "false",
    "useLanBridge": "false",
    "debugLadder": ladder,
    # The testbuild runs the whole onboarding on every start -- the intro
    # pages, the code on the keyboard, the fetch from the site -- as if the
    # headset had never seen a world, so it can be tested on one that has.
    # The publish build shows it once and then remembers.
    "debugFirstRun": ladder,
    "debugForceIngest": ladder,
    "worldSite": "https://pocket-diorama.vercel.app",
}
# The Game Boy prefab: the id 5.15 gave the model when IT imported it (the
# PrimaryAsset in the meta it wrote), never the development project's. No
# meta yet means 5.15 has not opened the project since the sync: the key is
# taken out, so the scene carries no dangling reference, and this script
# says so; run it again after 5.15 has imported the model.
import os
model_meta = os.path.join(os.path.dirname(scene), "Models", "gameboy.glb.meta")
prefab_id = None
if os.path.exists(model_meta):
    m = re.search(r"^\s*PrimaryAsset: !<reference> ([0-9a-f-]{36})", open(model_meta).read(), re.M)
    if m:
        prefab_id = m.group(1)
if prefab_id:
    wanted["gameBoyPrefab"] = "!<reference.ObjectPrefab> " + prefab_id
else:
    print("MAKE515: scene -- gameBoyPrefab left unwired: 5.15 has not imported Assets/Models/gameboy.glb yet; open the project in 5.15, then run this again")
changed = []
if not prefab_id:
    dangling = re.compile(r"^      gameBoyPrefab: .*\n", re.M)
    if dangling.search(block):
        block = dangling.sub("", block)
        changed.append("gameBoyPrefab removed")
for key, value in wanted.items():
    pattern = re.compile(r"^(      " + key + r": ).*$", re.M)
    if pattern.search(block):
        new = pattern.sub(lambda m: m.group(1) + value, block)
    else:
        # A key the scene has never carried: added at the end of the block,
        # in the same form the others take.
        new = block.rstrip("\n") + "\n      " + key + ": " + value + "\n"
    if new != block:
        changed.append(key + "=" + value)
        block = new
# A key that is new to the scene must ALSO be listed in ScriptInputsDefault,
# the block before ScriptTypesDefault: 5.15 drops a ScriptInputs value whose
# key is not registered there (debugFirstRun arrived as false on 28 Sept
# until it was). Existing keys are left as they are.
dbegin = text.find("  ScriptInputsDefault:\n", start)
dend = text.find("  ScriptTypesDefault:\n", dbegin)
defaults = text[dbegin:dend] if 0 <= dbegin < dend else ""
added_defaults = []
for key in wanted:
    if defaults and not re.search(r"^    " + key + r": ", defaults, re.M):
        defaults = defaults.rstrip("\n") + "\n    " + key + ": true\n"
        added_defaults.append(key)
if added_defaults:
    text = text[:dbegin] + defaults + text[dend:]
    # The inputs block moved with the insertion: find it again.
    begin = text.find("  ScriptInputs:\n", start)
    end = text.find("  ScriptTypes:\n", begin)
    changed.append("registered " + ", ".join(added_defaults))
if changed:
    # Atomic: 5.15 watches this file, and once read it half-written -- every
    # input came back at its default and the next save kept it that way.
    import tempfile
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(scene), prefix=".Scene.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        f.write(text[:begin] + block + text[end:])
    os.replace(tmp, scene)
    print("MAKE515: scene -- " + ", ".join(changed))
else:
    print("MAKE515: scene -- already set")
PY4
  say "$MODE flavour set: pad off, bridge off, Experimental APIs off, cache on, ladder=$LADDER"
  say "open $DEST in Lens Studio 5.15 and send it to the glasses"
  exit 0
fi

# The gate the OTHER gate cannot be: tools/gate515.sh compiles our scripts with
# 5.15's compiler but against the packages of the 5.23 project (SIK 0.18). The
# device build uses a different SIK -- 0.16.4, the one Snap ships with the 5.15
# samples -- and an API that moved between them would only show up here.
if [ "$MODE" = "gate" ]; then
  MARKER="MAKE515-GATE"
  COMPILER="/Applications/Lens Studio 5.15.app/Contents/Plugins/Es_TypeScriptCompiler.bundle/lensifyts"
  DECLS="/Applications/Lens Studio 5.15.app/Contents/Plugins/Es_TypeScriptCompiler.bundle/TypeScript/lib/LensifyTS/Declarations"
  PKG="$DEST/Packages/SpectaclesInteractionKit.lspkg"
  [ -x "$COMPILER" ] || { echo "$MARKER: SKIP - Lens Studio 5.15 not installed"; exit 0; }
  [ -f "$PKG" ]      || { echo "$MARKER: SKIP - no 515 project at $DEST"; exit 0; }
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  SRC="$TMP/src"
  mkdir -p "$SRC/Assets" "$SRC/Packages/SpectaclesInteractionKit.lspkg" "$TMP/out" "$TMP/components"
  cp -R "$ROOT/Assets/Scripts" "$SRC/Assets/Scripts"
  # LEAF's scenarios never travel to the device build (see sync below), so
  # they are not compiled against it either: they import a package the 515
  # project does not have, and the gate would fail on the test harness rather
  # than on the lens.
  rm -rf "$SRC/Assets/Scripts/leaf"
  unzip -q "$PKG" -d "$TMP/pkg" || { echo "$MARKER: FAIL - cannot read $PKG"; exit 1; }
  cp -R "$TMP/pkg/Package/Assets/." "$SRC/Packages/SpectaclesInteractionKit.lspkg/"
  cp -R "$DECLS/." "$SRC/Declarations/"
  rm -f "$SRC/Declarations/tsconfig.json"
  if [ "${2:-}" = "--selftest" ]; then
    # A planted fault, and an import of the package itself: the first proves the
    # compiler is reading our sources, the second that it resolves the package.
    cat > "$SRC/Assets/Scripts/__Make515SelfTest.ts" <<'TS'
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
const wrongType: number = "not a number";
export const selfTest = [wrongType, SIK];
TS
  fi
  cat > "$TMP/tsconfig.json" <<JSON
{ "compilerOptions": { "allowJs": true, "isolatedModules": true, "lib": ["es2021"],
  "module": "commonjs", "target": "es2021", "rootDir": "$SRC", "outDir": "$TMP/out",
  "skipDefaultLibCheck": true, "skipLibCheck": true, "types": [], "baseUrl": "$SRC",
  "paths": { "*": ["./Assets/*", "./Packages/*"] } }, "include": ["$SRC/**/*.ts"] }
JSON
  RAW="$TMP/out.txt"
  "$COMPILER" --tsconfig "$TMP/tsconfig.json" --declarations "$DECLS" \
              --parseDir "$SRC/Assets/Scripts" \
              --componentsCompileDir "$TMP/components" --jsonLogs >"$RAW" 2>&1
  # The output is ANSI-coloured, so grepping it raw is blind. Strip first.
  PLAIN="$TMP/plain.txt"
  sed 's/\x1b\[[0-9;]*m//g' "$RAW" > "$PLAIN"
  OURS=$(grep -c "Assets/Scripts.*error TS" "$PLAIN")
  PKGS=$(grep -c "Packages/.*error TS" "$PLAIN")
  echo "$MARKER: SIK $(unzip -p "$PKG" Package/Assets/VersionNumber.ts 2>/dev/null | grep -o '[0-9]\+' | tr '\n' '.' | sed 's/\.$//')  ours=$OURS packages=$PKGS"
  grep "error TS" "$PLAIN" | head -5
  if [ "$OURS" -gt 0 ]; then
    echo "$MARKER: FAIL"
    exit 1
  fi
  echo "$MARKER: PASS"
  exit 0
fi

if [ "$MODE" = "bootstrap" ] && [ -d "$DEST/Assets" ]; then
  say "REFUSING: $DEST already has an Assets/ -- bootstrap would overwrite the"
  say "scene you wired up in 5.15. Use 'sync', or move it aside first."
  exit 1
fi

mkdir -p "$DEST"

if [ "$MODE" = "bootstrap" ]; then
  say "copying the project into $DEST"
  # Everything the lens needs, and nothing the editor regenerates: Cache and
  # Support are minted per Lens Studio version and copying them across versions
  # is how a project ends up half in one schema and half in the other.
  # --delete, but NOT of the packages the device project installed for itself.
  #
  # A package added from 5.15's own Asset Library lands unpacked under Assets/
  # -- that is where UIKit 0.1.4 went on 8 September -- and it does not exist in
  # the 5.23 tree, so a plain --delete takes it away. The device build then
  # stops compiling for a reason nothing in the diff explains, and bootstrap is
  # exactly the command someone runs when things are already confusing.
  rsync -a --delete \
    --exclude "Cache/" --exclude "Support/" --exclude "Workspaces/" \
    --exclude "PluginsUserPreferences/" --exclude ".git/" \
    --exclude "*.lspkg" --exclude "*.lspkg.meta" \
    "$ROOT/Assets/" "$DEST/Assets/"

  mkdir -p "$DEST/Packages"
  if [ -f "$SIK515" ]; then
    cp "$SIK515" "$DEST/Packages/SpectaclesInteractionKit.lspkg"
    cp "$ROOT/Packages/SpectaclesInteractionKit.lspkg.meta" \
       "$DEST/Packages/SpectaclesInteractionKit.lspkg.meta" 2>/dev/null
    say "SIK: $(basename "$(dirname "$(dirname "$SIK515")")")'s 5.15 build, prefab and all"
  else
    say "WARNING: no 5.15 SIK at $SIK515 -- install it from 5.15's own template"
  fi

  # The version block 5.15 checks before it will open anything, over our own
  # project's ids so the scene and its assets stay the same document.
  python3 - "$ROOT/Pokemon-AR.esproj" "$DEST/Pokemon-AR-515.esproj" <<'PY'
import re, sys
source, target = sys.argv[1], sys.argv[2]
text = open(source).read()
text = re.sub(r"studioVersion:\n  major: \d+\n  minor: \d+\n  patch: \d+\n  build: \d+\n",
              "studioVersion:\n  major: 5\n  minor: 15\n  patch: 3\n  build: 26011319\n",
              text, count=1)
text = re.sub(r"coreVersion: \d+", "coreVersion: 330", text, count=1)
text = re.sub(r"clientVersion: [\d.]+", "clientVersion: 13.60", text, count=1)
# 5.15 has no SPECS target: the 2024 glasses are the Spectacles platform it knows.
text = re.sub(r"\ntargetPlatform: .*\n?", "\n", text)
# Any existing name, not just the template's. The lens was renamed once
# already -- Cartridge Diorama to Pocket Diorama -- and a replace that only
# matched SpecsBaseTemplate silently did nothing on a project that had been
# bootstrapped before, leaving the glasses showing the old name.
text = re.sub(r"lensName: .*", "lensName: Pocket Diorama", text, count=1)
open(target, "w").write(text)
print("MAKE515: wrote " + target.split("/")[-1] + " at 5.15.3")
PY

  for keep in jsconfig.json tsconfig.json; do
    [ -f "$ROOT/$keep" ] && cp "$ROOT/$keep" "$DEST/$keep"
  done

  # Texture compression settings do not survive the trip. 5.15 builds the entity
  # type from the compressor's NAME -- "Performance" becomes
  # PerformanceCompressionSettings -- and has no such type, so it opens the
  # project with "Cannot read property CompressionSettings" and resets the lens
  # in a loop. The block is dropped for the empty form every other meta here
  # already carries; the asset's ids are untouched, so the scene still resolves.
  python3 - "$DEST/Assets" <<'PY2'
import os, re, sys
root = sys.argv[1]
fixed = []
for dirpath, _, files in os.walk(root):
    for name in files:
        if not name.endswith(".meta"):
            continue
        path = os.path.join(dirpath, name)
        text = open(path).read()
        if "CompressorName" not in text:
            continue
        new = re.sub(r"  CompressionSettings: !<SingleCompressionSettings>\n(?:    .*\n|      .*\n)*",
                     "  CompressionSettings: !<own> 00000000-0000-0000-0000-000000000000\n",
                     text)
        if new != text:
            open(path, "w").write(new)
            fixed.append(os.path.relpath(path, root))
print("MAKE515: stripped 5.23 compression settings from " + (", ".join(fixed) if fixed else "nothing"))
PY2

  # The ignore rules come with it. A copied project arrives with the world
  # already baked into it, which is precisely where "no ROM content in git" gets
  # forgotten -- the copy is not covered by the original's .gitignore.
  if [ -f "$ROOT/.gitignore" ]; then
    python3 - "$ROOT/.gitignore" "$DEST/.gitignore" <<'PY2'
import sys
source, target = sys.argv[1], sys.argv[2]
keep = []
for line in open(source):
    stripped = line.strip()
    if stripped.startswith("#") and "Agents-Docs" in stripped:
        break
    keep.append(line)
open(target, "w").write("".join(keep))
PY2
    say "wrote .gitignore -- the baked world stays out of git here too"
  fi
  say "bootstrap done -- now open it once in Lens Studio 5.15 (README-515.md)"
else
  say "syncing scripts and the world into $DEST"
  [ -d "$DEST/Assets" ] || { say "no project at $DEST; run bootstrap first"; exit 1; }
  # Scripts and the baked world only. The scene, the materials and every .meta
  # in the 515 project belong to 5.15 now, and copying ours over them would undo
  # whatever was fixed there.
  # LEAF's scenarios stay behind. They import from Packages/Leaf.lspkg, which
  # only the 5.23 project has -- the 515 project has never had the package and
  # does not need it, because LEAF runs against the preview and this project is
  # the one that goes on the glasses. Copied in, every scenario is an unresolved
  # import in the device build.
  rsync -a --delete --exclude "*.meta" --exclude "leaf/" \
        "$ROOT/Assets/Scripts/" "$DEST/Assets/Scripts/"
  mkdir -p "$DEST/Assets/Generated"
  rsync -a --exclude "*.meta" "$ROOT/Assets/Generated/" "$DEST/Assets/Generated/"
  # The Game Boy the screen lives in, WITHOUT its .meta. A 5.23 import meta
  # carries settings 5.15 cannot read (PersistentIdGenerationAlgorithm
  # DescriptorBasedV2, PerformanceCompressionSettings) and 5.15 asserted and
  # died on it on 28 September. 5.15 imports the .glb itself on open and
  # writes its own meta with its own asset id; the scene rewrite below reads
  # that id back, so the reference is wired on the NEXT publish/testbuild.
  mkdir -p "$DEST/Assets/Models"
  rsync -a --exclude "*.meta" "$ROOT/Assets/Models/" "$DEST/Assets/Models/"
  # The lens's NAME travels on every sync, not only on bootstrap. The rename
  # from Cartridge Diorama to Pocket Diorama happened after this project was
  # bootstrapped, and every build since then went to the glasses -- and into
  # the recorded demo's outro -- under the old name, because sync copied
  # scripts and world and left the .esproj alone. The same one-line rewrite
  # bootstrap does, on the file that is already there.
  python3 - "$DEST/Pokemon-AR-515.esproj" <<'PY3'
import re, sys
path = sys.argv[1]
text = open(path).read()
fixed = re.sub(r"lensName: .*", "lensName: Pocket Diorama", text, count=1)
if fixed != text:
    open(path, "w").write(fixed)
    print("MAKE515: lensName -> Pocket Diorama")
PY3
  say "synced. Lens Studio re-imports on its own; watch its log for errors."
fi

say "next: ./tools/gate515.sh proves these scripts still compile for 5.15"
