#!/usr/bin/env bash
# Every gate this project has, in one command. Run it before calling anything done.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="${1:-$ROOT/Assets/Generated/kanto.json}"
# Only the audio suite needs the cartridge itself (it decodes cries out of it),
# and it is skipped rather than failed where there is no ROM. Same default path
# golden.sh uses.
ROM="${2:-$HOME/Downloads/Pokemon - Red Version (USA, Europe).gb}"
FAILED=0

echo "=== TypeScript, Lens Studio 5.23 ==="
"$ROOT/tools/gate.sh" || FAILED=1
echo
echo "=== TypeScript, Lens Studio 5.15.4 (device target) ==="
"$ROOT/tools/gate515.sh" || FAILED=1
echo
# gate515 compiles against the 5.23 project's packages; this one compiles
# against the package the DEVICE build actually carries, SIK 0.16.4. It skips
# itself where 5.15 or the sibling project is missing.
echo "=== TypeScript, against the 5.15 sibling's own SIK ==="
"$ROOT/tools/make515.sh" gate 2>&1 | grep -E "MAKE515-GATE" || FAILED=1
echo
# These two run OUTSIDE the bundle guard on purpose: they are the suites for
# what the lens says when there is NO world, and a gate that only runs when the
# world is there could never have caught the black screen.
echo "=== The built-in font: glyphs with no cartridge ==="
node --experimental-strip-types --import "$ROOT/test/register.mjs" \
     "$ROOT/test/tinyfont.test.mjs" --selftest 2>&1 \
  | grep -E "FAIL|TINYFONT" || FAILED=1
echo
echo "=== The first-run wizard: what it says with no world ==="
node --experimental-strip-types --import "$ROOT/test/register.mjs" \
     "$ROOT/test/setupwizard.test.mjs" --selftest 2>&1 \
  | grep -E "FAIL|SETUPWIZARD" || FAILED=1
echo
echo "=== The code keyboard, and the world over https ==="
node --experimental-strip-types --import "$ROOT/test/register.mjs" \
     "$ROOT/test/codeentry.test.mjs" --selftest 2>&1 \
  | grep -E "FAIL|CODEENTRY" || FAILED=1
node --experimental-strip-types --import "$ROOT/test/register.mjs" \
     "$ROOT/test/httpsworld.test.mjs" --selftest 2>&1 \
  | grep -E "FAIL|HTTPSWORLD" || FAILED=1
echo
if [ -f "$BUNDLE" ]; then
  echo "=== Overworld logic against the real bundle ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/overworld.test.mjs" "$BUNDLE" 2>&1 \
    | grep -vE "Warning|Reparsing|trace-warnings|eliminate this" || FAILED=1
  echo
  echo "=== Ledges: hopped, not walked ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/ledges.test.mjs" "$BUNDLE" 2>&1 \
    | grep -vE "Warning|Reparsing|trace-warnings|eliminate this" || FAILED=1
  echo
  echo "=== The battle engine ==="
  for suite in battle battle-moves battle-status battle-turnorder battle-capture battle.integration battle-ai battle-wiring; do
    [ -f "$ROOT/test/$suite.test.mjs" ] || continue
    # battle-ai runs its own selftest every time: its sweeps are statistical, and
    # a sweep that has quietly stopped reaching the AI reports zero rather than
    # failing. The selftest unwires each class and checks the sweep notices.
    FLAG=""
    [ "$suite" = "battle-ai" ] && FLAG="--selftest"
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/test/$suite.test.mjs" "$BUNDLE" $FLAG 2>&1 \
      | grep -E "PASS +[0-9]+ FAIL|[0-9]+ pass, [0-9]+ fail" | tail -1 || FAILED=1
  done
  echo
  echo "=== Legendaries and money ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/legendary.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|LEGENDARY" || FAILED=1
  echo
  echo "=== The mart and the dex entry ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/mart.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|MART" || FAILED=1
  echo
  echo "=== Trades, through the VM ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/trade.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TRADE" || FAILED=1
  echo
  echo "=== Yellow's opening, when the bundle is Yellow ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/yellow.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|YELLOW" || FAILED=1
  echo
  echo "=== Pinch-to-walk: a pinched cell becomes steps ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/route.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|ROUTE" || FAILED=1
  echo
  echo "=== The keepers: Badge House, Bill's list, the NAME RATER, the DAYCARE ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/keepers.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|KEEPERS" || FAILED=1
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/keepers.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "SELFTEST OK" || FAILED=1
  echo
  echo "=== CINNABAR GYM's quiz machines ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/cinnabarquiz.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|CINNABARQUIZ" || FAILED=1
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/cinnabarquiz.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "SELFTEST OK" || FAILED=1
  echo
  echo "=== The SILPH SCOPE's fade ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/unveil.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|UNVEIL" || FAILED=1
  echo
  echo "=== Battle pictures: own colours, a body behind the sketch ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battlepics.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|BATTLEPICS" || FAILED=1
  echo
  echo "=== The cartridge names its family ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/cartridge.test.mjs" --selftest 2>&1 \
    | grep -E "SELFTEST OK" || FAILED=1
  echo
  echo "=== The cartridge picks its own manifest ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/manifest.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|CARTRIDGE MANIFEST TEST" || FAILED=1
  echo
  echo "=== Cries, from the bundle to samples ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/cry.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|ALL PASS" || FAILED=1
  echo
  echo "=== The menu ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/menu.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|MENU" || FAILED=1
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/dpad.test.mjs" 2>&1 | grep -E "FAIL|DPAD" || FAILED=1
  echo
  echo "=== A battle, played through the runner ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battlerunner.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|RUNNER" || FAILED=1
  echo
  echo "=== What the battle box actually draws, line by line ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battletext.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|BATTLETEXT" || FAILED=1
  echo
  echo "=== The battle HUD: the bar against the cartridge's own tiles ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battlehud.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|BATTLEHUD" || FAILED=1
  echo
  echo "=== A fills the line in rather than waiting for it ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/texthurry.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|TEXTHURRY" || FAILED=1
  echo
  echo "=== How a fight is framed for the wearer ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battleframing.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|BATTLEFRAMING" || FAILED=1
  echo
  echo "=== What the pair does when a move lands ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battleanimator.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|BATTLEANIMATOR" || FAILED=1
  echo
  echo "=== The hour the world is lit at ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/daytint.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|DAYTINT" || FAILED=1
  echo
  echo "=== Blocks a flag opens or closes ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/blockoverrides.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|BLOCKOVERRIDES" || FAILED=1
  echo
  echo "=== Scripted NPC walks, as state ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/npcmotion.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|NPCMOTION" || FAILED=1
  echo
  echo "=== The wanderers: WALK NPCs, as state ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/npcwander.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|NPCWANDER" || FAILED=1
  echo
  echo "=== Coordinate triggers ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/steptrigger.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|STEPTRIGGER" || FAILED=1
  echo
  echo "=== Doors, mats and LAST_MAP ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/warps.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|WARPS" || FAILED=1
  echo
  echo "=== The Poke Mart: buying, selling, and the script that waits for it ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/shop.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|SHOP" || FAILED=1
  echo
  echo "=== The helper expansions: gifts, badges, rods, through the VM ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/helpers.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|HELPERS" || FAILED=1
  echo
  echo "=== HM field moves: Cut, Surf, Strength, Fly, Flash ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/fieldmoves.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|FIELDMOVES" || FAILED=1
  echo
  echo "=== Teaching a TM or an HM ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/teach.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TEACH" || FAILED=1
  echo
  echo "=== The PC: the bedroom's items and a Center's boxes ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/pc.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|^PC " || FAILED=1
  echo
  echo "=== Party growth: the box, the save, and the two-slot lines ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/growth.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|GROWTH" || FAILED=1
  echo
  echo "=== The play loop: intro to first badge, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/playloop.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|PLAYLOOP" || FAILED=1
  echo
  echo "=== Oak's escort to the lab, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/escort.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|ESCORT" || FAILED=1
  echo
  # Seven suites that existed and were run by nothing. Found on 12 September by
  # listing test/*.test.mjs against what this file names: every one of them
  # passed, which is the worst way for a hole in a gate to be discovered --
  # "VERIFY: ALL GATES PASS" had been quietly saying less than it sounded.
  # (test/intro.pixel.test.mjs stays out: it writes reference pictures and
  # asserts nothing.)
  echo "=== The suites the gate had been skipping ==="
  for suite in dexentry onboarding textpace viridianmart canvasmenu battlescreen; do
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/test/$suite.test.mjs" "$BUNDLE" 2>&1 \
      | grep -iE "FAIL|[0-9]+ pass" | tail -1 || FAILED=1
  done
  for suite in gbscreen intro; do
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/test/$suite.test.mjs" --selftest 2>&1 \
      | grep -iE "FAIL|[0-9]+ pass" | tail -1 || FAILED=1
  done
  if [ -f "$ROM" ]; then
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/test/audio.test.mjs" "$ROM" 2>&1 \
      | grep -iE "FAIL|[0-9]+ passed" | tail -1 || FAILED=1
  else
    echo "  audio: skipped, no ROM at $ROM"
  fi
  echo
  echo "=== Trainers who attack on sight ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/trainersight.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TRAINERSIGHT" || FAILED=1
  echo
  echo "=== The two coordinate gates, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gates.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|GATES" || FAILED=1
  echo
  echo "=== Mt Moon's fossil chamber, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/mtmoon.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|MTMOON" || FAILED=1
  echo
  echo "=== Vermilion Gym's trash cans, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/vermiliongym.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|VERMILIONGYM" || FAILED=1
  echo
  echo "=== The lift's jolt ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/worldshake.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|WORLDSHAKE" || FAILED=1
  echo
  echo "=== The Game Boy the screen lives in ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gameboyshell.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|GAMEBOYSHELL" || FAILED=1
  echo
  echo "=== The Game Boy model, split and measured ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gameboymodel.test.mjs" 2>&1 \
    | grep -E "FAIL|GAMEBOYMODEL" || FAILED=1
  echo
  echo "=== The print on the Game Boy's face ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gameboylabels.test.mjs" 2>&1 \
    | grep -E "FAIL|GAMEBOYLABELS" || FAILED=1
  echo
  echo "=== The buttons' caps: shading drawn in, measured against the model ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/buttoncaps.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|BUTTONCAPS" || FAILED=1
  echo
  echo "=== The loose buttons: where they ride and when they show ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/loosebuttons.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|LOOSEBUTTONS" || FAILED=1
  echo
  echo "=== The hand as a joystick, and the marker ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/stick.test.mjs" 2>&1 \
    | grep -E "FAIL|STICK" || FAILED=1
  echo
  echo "=== The built-in click ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/click.test.mjs" 2>&1 \
    | grep -E "FAIL|CLICK" || FAILED=1
  echo
  echo "=== The setup pages' icons ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/pixelicons.test.mjs" 2>&1 \
    | grep -E "FAIL|PIXELICONS" || FAILED=1
  echo
  echo "=== The two lifts, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/elevator.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|ELEVATOR " || FAILED=1
  echo
  echo "=== The player on the bike and on the water ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/ride.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|RIDE " || FAILED=1
  echo
  echo "=== What is written on the walls ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/bookshelves.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|BOOKSHELVES " || FAILED=1
  echo
  echo "=== The credits, after the HALL OF FAME ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/credits.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|CREDITS " || FAILED=1
  echo
  echo "=== The save ladder: ten doors to drop in at ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/ladder.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|LADDER " || FAILED=1
  echo
  echo "=== The GAME CORNER's slot machines ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/slots.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|SLOTS " || FAILED=1
  echo
  echo "=== The ELITE FOUR and the HALL OF FAME ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/endgame.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|ENDGAME " || FAILED=1
  echo
  echo "=== The POKeMON MANSION's switches ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/mansion.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|MANSION " || FAILED=1
  echo
  echo "=== SILPH CO and SAFFRON ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/silph.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|SILPH " || FAILED=1
  echo
  echo "=== The SAFARI ZONE ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/safari.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|SAFARI " || FAILED=1
  echo
  echo "=== The ROCKET HIDEOUT, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/hideout.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|HIDEOUT " || FAILED=1
  echo
  echo "=== POKeMON TOWER, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/tower.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|TOWER " || FAILED=1
  echo
  echo "=== The BICYCLE, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/bike.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|BIKE " || FAILED=1
  echo
  echo "=== The three rods, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/fishing.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|FISHING" || FAILED=1
  echo
  echo "=== The gate houses, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gatehouses.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|GATEHOUSES" || FAILED=1
  echo
  echo "=== The S.S. Anne sailing, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/sailing.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|SAILING" || FAILED=1
  echo
  echo "=== The S.S. Anne, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/ssanne.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|SSANNE" || FAILED=1
  echo
  echo "=== The Viridian old man, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/oldman.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|OLDMAN" || FAILED=1
  echo
  echo "=== A traded Pokemon above the badge ladder ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/obedience.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|OBEDIENCE" || FAILED=1
  echo
  echo "=== Using an item outside a battle, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/itemuse.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|ITEMUSE" || FAILED=1
  echo
  echo "=== The bench and what is under the tile, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/hiddenthings.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|HIDDENTHINGS" || FAILED=1
  echo
  echo "=== The museum door, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/museum.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|MUSEUM" || FAILED=1
  echo
  echo "=== Nugget Bridge and the road to Bill, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/cerulean.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|CERULEAN" || FAILED=1
  echo
  echo "=== BLUE stops you for the first battle, headless ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/rivaltrigger.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|RIVALTRIGGER" || FAILED=1
  echo
  echo "=== The boot: title, main menu, OPTION and the naming screen ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/bootscreens.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|BOOTSCREENS" || FAILED=1
  echo
  echo "=== The Game Boy panel and the keyboard ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/padpanel.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|PADPANEL" || FAILED=1
  echo
  echo "=== The pad drawn on the phone ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/phonepad.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|PHONEPAD" || FAILED=1
  echo
  echo "=== The question asked at the first fight ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battlestyle.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|BATTLESTYLE" || FAILED=1
  echo
  echo "=== Where a battle is staged ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battlearena.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|BATTLEARENA" || FAILED=1
  echo
  echo "=== The YES/NO box ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/choicebox.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|CHOICEBOX" || FAILED=1
  echo
  echo "=== The dialogue panel, in degrees ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/messagepanel.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|MESSAGEPANEL" || FAILED=1
  echo
  echo "=== Props are not people ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/spriteprops.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|SPRITEPROPS" || FAILED=1
  echo
  echo "=== The phone as a pad, through the Spectacles App ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/motioncontroller.test.mjs" 2>&1 \
    | grep -E "FAILURES|ALL PASS" || FAILED=1
  echo
  echo "=== The pixel-voxel terrain: window, chunks, heights, quads ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/voxelterrain.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|VOXELTERRAIN" || FAILED=1
  echo
  echo "=== Which way every triangle of the terrain faces ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/terrainwinding.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TERRAINWINDING" || FAILED=1
  echo
  echo "=== Depth: the crevices, the per-tile lift, and what they cost ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/voxeldepth.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|VOXELDEPTH" || FAILED=1
  echo
  echo "=== What the world costs to draw, every map, every ZOOM rung ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/geometrybudget.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|GEOMETRYBUDGET|^ +[0-9]+ " || FAILED=1
  echo
  echo "=== What a step of walking costs the terrain ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/terrainstream.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TERRAINSTREAM" || FAILED=1
  echo
  echo "=== A bundle transfer that stops halfway says so ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/bridgestall.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|BRIDGESTALL" || FAILED=1
  echo
  echo "=== Which way is up once you have walked round the table ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/viewrelative.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|VIEWRELATIVE" || FAILED=1
  echo
  echo "=== The fight's menu is on a panel, so the panel is on ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/panelvisibility.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|PANELVISIBILITY" || FAILED=1
  echo
  echo "=== The shape library: what a tile is shaped like ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/tileshapes.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TILESHAPES" || FAILED=1
  echo
  echo "=== Every Pokemon you keep names a trainer ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/trainerid.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|TRAINERID" || FAILED=1
  echo
  echo "=== Indoors nothing is a house: no gable, no eave ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/indoorvolumes.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|INDOORVOLUMES" || FAILED=1
  echo
  echo "=== Indoors a PC is a machine, a bed is linen, a shelf is tall ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/indoorkinds.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|INDOORKINDS" || FAILED=1
  echo
  echo "=== Can you tell what you may walk on? ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/legibility.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|LEGIBILITY|DELTA|delta|BRIGHTER" || FAILED=1
  echo
  echo "=== Evolution: who is due, and what it does ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/evolution.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|EVOLUTION" || FAILED=1
  echo
  echo "=== The music: banks, channels, mixer, jukebox ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/music.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|MUSIC" || FAILED=1
  echo
  echo "=== Moving and resizing the diorama by hand ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/dioramahands.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|DIORAMAHANDS" || FAILED=1
  echo
  echo "=== The fight's menu, in a box on the panel ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/battlemenubox.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|BATTLEMENUBOX" || FAILED=1
  echo
  echo "=== The Bluetooth pad: whether the lens ever asks for one ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gamepad.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|GAMEPAD" || FAILED=1
  echo
  echo "=== The Bluetooth pad's own state, and that none of it is silent ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/padscan.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|PADSCAN" || FAILED=1
  echo
  echo "=== The order a pad is connected in, against Snap's own sample ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/padconnect.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|PADCONNECT" || FAILED=1
  echo
  echo "=== Nobody stands where no terrain was built ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/npccull.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|NPCCULL" || FAILED=1
  echo
  echo "=== In GAME BOY mode the screen is the game ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/gameboyscreen.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|GAMEBOYSCREEN" || FAILED=1
  echo
  echo "=== Where the world is put down, and which way round ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/dioramaplacer.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|DIORAMAPLACER" || FAILED=1
  echo
  echo "=== Where the graphics page hangs beside the world ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/sidepanel.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|SIDEPANEL" || FAILED=1
  echo
  echo "=== The view settings page ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/viewoptions.test.mjs" --selftest 2>&1 \
    | grep -E "FAIL|VIEWOPTIONS" || FAILED=1
  echo
  echo "=== The play area: the square window, the ZOOM ladder, the plate ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/playarea.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|PLAYAREA" || FAILED=1
  echo
  echo "=== Dialogue and the script VM ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/script.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|SCRIPT" || FAILED=1
  echo
  echo "=== The drawn world is the view, cut from the cover, a tile a step ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/viewclip.test.mjs" "$BUNDLE" --selftest 2>&1 \
    | grep -E "FAIL|VIEWCLIP" || FAILED=1
  echo
  echo "=== Oak's parcel: the request scene, the Poke Balls, the rating ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/oakslab-parcel.test.mjs" "$BUNDLE" 2>&1 \
    | grep -E "FAIL|OAKSLAB-PARCEL" || FAILED=1
else
  echo "=== Overworld logic: SKIP, no bundle at $BUNDLE ==="
fi

ROM="${CARTRIDGE_ROM:-$HOME/Downloads/Pokemon - Red Version (USA, Europe).gb}"
if [ -f "$ROM" ]; then
  echo
  echo "=== Checksums against the real cartridge ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/checksum.test.mjs" "$ROM" 2>&1 \
    | grep -vE "Warning|Reparsing|trace-warnings|eliminate this" || FAILED=1
  echo
  echo "=== The lens's own extraction, against the golden reference ==="
  GOLDEN="${CARTRIDGE_GOLDEN:-}"
  if [ -n "$GOLDEN" ] && [ -d "$GOLDEN" ]; then
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/test/worldfromrom.test.mjs" "$ROM" \
         "$ROOT/Assets/Manifests/rom_manifest_red.json" "$GOLDEN" 2>&1 \
      | grep -E "FAIL|MISS|LENS EXTRACTION" || FAILED=1
  else
    echo "    SKIP: no golden reference. This is the ONLY gate that can catch our"
    echo "          extractor being consistently wrong -- everything else compares"
    echo "          our code against our code. Regenerate it with:"
    echo "              ./tools/golden.sh"
  fi
  echo
  echo "=== The two world paths agree ==="
  if [ -f "$ROOT/Assets/Generated/kanto.json" ]; then
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/test/bundle.test.mjs" "$ROM" \
         "$ROOT/Assets/Manifests/rom_manifest_red.json" \
         "$ROOT/Assets/Generated/kanto.json" 2>&1 \
      | grep -E "FAIL|BUNDLE PARITY" || FAILED=1
  else
    echo "    SKIP: no baked bundle to compare against"
  fi
  echo
  echo "=== Lens client against the real bridge ==="
  node --experimental-strip-types --import "$ROOT/test/register.mjs" \
       "$ROOT/test/rombridge.test.mjs" "$ROM" 2>&1 \
    | grep -vE "Warning|Reparsing|trace-warnings|eliminate this" || FAILED=1
else
  echo
  echo "=== Cartridge tests: SKIP, no ROM at $ROM ==="
  echo "    (set CARTRIDGE_ROM to point at your own)"
fi

# The cartridge as oracle: every scenario under tools/oracle/scenarios runs on
# the headless lens and on the ROM in PyBoy, and the states must agree after
# every action. Needs the ROM and the oracle's venv (tools/oracle/README.md).
if [ -f "$ROM" ] && [ -x "$ROOT/tools/oracle/.venv/bin/python" ]; then
  echo
  echo "=== The cartridge agrees: lens vs ROM, scenario by scenario ==="
  for scenario in "$ROOT"/tools/oracle/scenarios/*.json; do
    [ -f "$scenario" ] || continue
    node --experimental-strip-types --import "$ROOT/test/register.mjs" \
         "$ROOT/tools/oracle/compare.mjs" "$ROM" "$ROOT/Assets/Generated/kanto.json" "$scenario" 2>&1 \
      | grep -E "DIFF|COMPARE" | sed "s|^|  $(basename "$scenario" .json): |" || FAILED=1
  done
else
  echo
  echo "=== Oracle comparison: SKIP (no ROM or no tools/oracle/.venv) ==="
fi

echo
[ "$FAILED" -eq 0 ] && echo "VERIFY: ALL GATES PASS" || echo "VERIFY: FAILURES ABOVE"
exit $FAILED
