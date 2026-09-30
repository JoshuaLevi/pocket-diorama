// Which way is "up" when you have walked round the table.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/viewrelative.test.mjs [--selftest]
//
// Joshua, 10 September: "loop ik om het spel heen dan draait mijn karakter mee
// maar de controls blijven hetzelfde, waardoor ik vanuit een andere hoek
// dezelfde controls behoud."
//
// The whole risk in this change is a sign. Get the handedness wrong and every
// control is off by a quarter turn and every sprite faces the wrong way -- and
// it looks, from inside the code, exactly like getting it right. So the
// cardinal table below is written from the WEARER's point of view, in words,
// and the arithmetic has to agree with the words rather than the other way
// round.
//
// The frame of reference, from updatePlayerTransform: a cell is placed at
// `z = -height/2 + cellY * 2 + 1`, so a bigger cellY is a bigger local z, and
// north -- the way cellY gets smaller -- is local -Z. Map east is local +X.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const V = await import("../Assets/Scripts/play/ViewRelativeInput.ts");
const { bearingOf, turnFor, turnPress, seenFacing, signedDelta, usable,
        ViewCompass, SWITCH_DEGREES, CLOCKWISE } = V;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** Settle a compass on a bearing, with nothing held and nothing walking. */
function settle(compass, local) {
  compass.update(local, false, false);
  return compass.quarterTurns();
}

console.log("=== where the wearer is standing, in the diorama's own space ===");
{
  // `local` is the direction from the WEARER toward the diorama. A wearer due
  // south of the map is at +Z from its centre, so that direction is -Z.
  check("due south, looking north up the map", bearingOf([0, -1]) === 0);
  check("on the west side, looking east", bearingOf([1, 0]) === 90);
  check("due north, looking back south", bearingOf([0, 1]) === 180);
  check("on the east side, looking west", bearingOf([-1, 0]) === 270);

  check("a wearer standing on the model has no bearing", usable([0, 0]) === false);
  check("...and one a metre away does", usable([0, -100]) === true);
  check("the shortest way round is signed",
        signedDelta(350, 10) === 20 && signedDelta(10, 350) === -20);
}

console.log("=== the cardinal table, in words ===");
{
  // Read each of these as a sentence. This is the whole change.
  //
  // Standing due south -- the side the world is placed facing on -- nothing
  // moves, and the lens is the cartridge exactly.
  check("from the south, UP is still north", turnPress("up", turnFor(0, 0)) === "up");
  check("from the south, RIGHT is still east", turnPress("right", turnFor(0, 0)) === "right");

  // Walk to the WEST side of the table. You are now looking east across it, so
  // pushing away from you has to walk the character east.
  const west = turnFor(90, 0);
  check("from the west side, UP walks east", turnPress("up", west) === "right");
  check("...and RIGHT walks south", turnPress("right", west) === "down");
  check("...and DOWN walks west, back toward you", turnPress("down", west) === "left");
  check("...and LEFT walks north", turnPress("left", west) === "up");

  // Round to the far side. Everything is mirrored.
  const north = turnFor(180, 0);
  check("from the north side, UP walks south", turnPress("up", north) === "down");
  check("...and LEFT walks east", turnPress("left", north) === "right");

  const east = turnFor(270, 0);
  check("from the east side, UP walks west", turnPress("up", east) === "left");
  check("...and RIGHT walks north", turnPress("right", east) === "up");
}

console.log("=== the character shows the side you are looking at ===");
{
  // seenFacing is the inverse: a character whose map facing is the way the
  // wearer is looking is walking AWAY and shows its back.
  check("from the south, a character walking north shows its back",
        seenFacing("up", 0) === "up");
  check("...and one walking south shows its face", seenFacing("down", 0) === "down");

  // From the west side the wearer looks east, so a character walking east is
  // the one walking away.
  const west = turnFor(90, 0);
  check("from the west side, a character walking EAST shows its back",
        seenFacing("right", west) === "up");
  check("...and one walking west walks at you", seenFacing("left", west) === "down");
  check("...and one walking north crosses to your left",
        seenFacing("up", west) === "left");

  // Every press, from anywhere, draws the character walking away from the
  // wearer -- which is the whole of what "up is up" should mean.
  for (let turns = 0; turns < 4; turns++) {
    const walked = turnPress("up", turns);
    check("a press of UP always looks like walking away (turn " + turns + ")",
          seenFacing(walked, turns) === "up", walked + " -> " + seenFacing(walked, turns));
  }
  // ...and the round trip holds for all sixteen pairs.
  let broken = 0;
  for (let turns = 0; turns < 4; turns++) {
    for (let i = 0; i < CLOCKWISE.length; i++) {
      if (seenFacing(turnPress(CLOCKWISE[i], turns), turns) !== CLOCKWISE[i]) broken++;
    }
  }
  check("seenFacing undoes turnPress, always", broken === 0, broken + " broken");
}

console.log("=== the boundary is not where the geometry puts it ===");
{
  // The naive version snaps at 45 and is unusable: near a corner of the table
  // the smallest sway flips UP between two map axes, and a flip mid-step sends
  // the character somewhere nobody asked for.
  check("standing at 45 degrees changes nothing", turnFor(45, 0) === 0);
  check("...and so does 59", turnFor(59, 0) === 0);
  check("but 61 has clearly crossed", turnFor(61, 0) === 1);
  check("the switch is where the constant says", SWITCH_DEGREES === 60);

  // Having crossed, coming back needs the same margin from the NEW centre --
  // which is thirty degrees the other side of the boundary.
  check("having crossed, 61 stays crossed", turnFor(61, 1) === 1);
  check("...and 45 stays crossed too", turnFor(45, 1) === 1);
  check("...until 29", turnFor(29, 1) === 0);
  check("there is dead zone either side of every boundary",
        turnFor(45, 0) !== turnFor(45, 1));

  // And it wraps: 350 degrees is twenty degrees short of due south, not 350
  // degrees away from it.
  // The wrap is where an off-by-one hides. 350 is ten degrees short of due
  // south, not three hundred and fifty degrees away from it.
  check("the wrap is not a cliff", turnFor(350, 0) === 0);
  // ...and from the east side, whose centre is 270, the margin has to be
  // measured across 360 as well: 320 is fifty degrees away and holds, 340 is
  // seventy and crosses -- and crossing has to round UP to four and land on
  // zero rather than off the end of the ladder.
  check("...measured across 360 as well", turnFor(320, 3) === 3);
  check("...and crossing it lands back on north", turnFor(340, 3) === 0);
}

console.log("=== the latch never moves under a thumb ===");
{
  // A mapping that changes while a button is held is indistinguishable from a
  // bug. This is the rule that matters most in the whole file.
  const c = new ViewCompass();
  check("it starts on the cartridge's own north", c.quarterTurns() === 0);
  check("and walking round moves it", settle(c, [1, 0]) === 1);

  const held = new ViewCompass();
  settle(held, [0, -1]);
  held.update([1, 0], true, false);
  check("a held direction freezes the mapping", held.quarterTurns() === 0);
  held.update([1, 0], false, true);
  check("...and so does a step in progress", held.quarterTurns() === 0);
  held.update([1, 0], false, false);
  check("...and it catches up the moment the thumb lifts", held.quarterTurns() === 1);

  // A wearer standing directly over the model has no bearing to give.
  const over = new ViewCompass();
  settle(over, [1, 0]);
  over.update([0, 0], false, false);
  check("standing over the model holds the last mapping", over.quarterTurns() === 1);

  // Off is exactly the cartridge, which is what GAME BOY mode needs: there is
  // no table to walk round, the screen follows the head.
  const off = new ViewCompass();
  settle(off, [1, 0]);
  off.setFollowing(false);
  check("switching it off returns to north-is-up", off.quarterTurns() === 0);
  check("...and it stays there however far you walk",
        settle(off, [0, 1]) === 0);
  off.setFollowing(true);
  check("and switching it back on picks the wearer up again",
        settle(off, [0, 1]) === 2);
}

console.log("=== the rotation is applied at the WALK, never at the source ===");
{
  // THE TRAP, and the reason this section exists at all.
  //
  // The obvious implementation is to rotate input.dpad(). There are fourteen
  // callers of that and thirteen of them are menus -- the START list, the
  // OPTION page, the naming screen, the shop, the PC, the fight's menu -- and
  // in every one of them up is a CURSOR, not a compass. Rotating at the source
  // would make the wearer's menus scroll sideways when they stood on the west
  // side of their own table.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("Assets/Scripts/play/InputSource.ts", "utf8");
  check("InputSource knows nothing about the compass",
        source.indexOf("ViewRelativeInput") < 0 && source.indexOf("turnPress") < 0);

  const over = readFileSync("Assets/Scripts/play/Overworld.ts", "utf8");
  check("the walk is where the turn is applied", over.indexOf("turnPress(") > 0);
  check("...and it is the winning press that is turned, not the buttons",
        over.indexOf("return turnPress(pressed, turns);") > 0);
  // The cartridge resolves two opposing presses in a fixed order, and that
  // order is about the joypad REGISTER. Turning first would change which
  // physical press wins depending on where the wearer is standing.
  const held = over.slice(over.indexOf("private static heldDirection("));
  const tie = held.indexOf('pressed = "down"');
  const turn = held.indexOf("turnPress(");
  check("the tie-break happens before the turn", tie >= 0 && turn >= 0 && tie < turn,
        "tie at " + tie + ", turn at " + turn);

  const lens = readFileSync("Assets/Scripts/PokemonAR.ts", "utf8");
  check("the lens owns the compass", lens.indexOf("new ViewCompass()") > 0);
  check("...and feeds the walk with it", lens.indexOf("this.overworld.viewTurns = turns") > 0);
  // Before the walk, or the turn arrives a frame after the press it applies to.
  const compassAt = lens.indexOf("this.updateCompass();");
  const walkAt = lens.indexOf("const result = this.overworld.update(dt, this.input);");
  check("the compass is read before the walk uses it",
        compassAt >= 0 && walkAt >= 0 && compassAt < walkAt,
        "compass at " + compassAt + ", walk at " + walkAt);

  // The flat Game Boy screen draws the cartridge's own view, where north is up
  // by definition. It must never come through here.
  const canvas = readFileSync("Assets/Scripts/play/screen/OverworldCanvas.ts", "utf8");
  check("the flat screen is left alone",
        canvas.indexOf("seenFacing") < 0 && canvas.indexOf("ViewRelative") < 0);
  // Scoped to the method. "!this.isGameBoyMode()" appears a dozen times in
  // this file, so searching the whole of it proved nothing at all -- the first
  // version of this check passed with the guard deleted.
  const method = lens.slice(lens.indexOf("private updateCompass(): void {"));
  const body = method.slice(0, method.indexOf("\n  }"));
  check("GAME BOY mode switches the compass off, inside updateCompass",
        body.indexOf("!this.isGameBoyMode()") > 0, body.slice(0, 400));
  check("...through the row as well", body.indexOf("this.viewRelativeControls()") > 0);
  check("...and it is the compass that is told", body.indexOf("setFollowing(") > 0);

  // Both halves of the same number: the walk and what the character shows.
  check("the player's frame is drawn view-relative",
        // spriteFacing since 20 September: the same facing, except on an
        // arrow tile's slide, where the sprite goes round (Overworld.ts).
        lens.indexOf("frameFor(this.drawnFacing(this.overworld.spriteFacing())") > 0);
  check("...and a walking NPC's", lens.indexOf("frameFor(this.drawnFacing(pose.facing)") > 0);
  check("...and a standing one is repainted when the wearer moves",
        lens.indexOf("this.repaintNpcFacings()") > 0);
}

const label = "VIEWRELATIVE  " + pass + " PASS  " + fail + " FAIL";
console.log(label + (fail === 0 ? "  OK" : "  BROKEN"));
if (SELFTEST && fail > 0) process.exit(1);
