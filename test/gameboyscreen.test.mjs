// In GAME BOY mode the screen IS the game, so nothing may switch it off.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/gameboyscreen.test.mjs [--selftest]
//
// Joshua, 10 September: "als ik van mode van diorama naar gameboy ga dan
// verdwijnt heel het spel."
//
// He was right, and it was one missing question. GAME BOY mode clears the
// terrain -- that is the mode -- and draws the overworld on the flat screen
// instead. Six places in PokemonAR.ts switched that screen back off when they
// were done borrowing it, and five of them asked isGameBoyMode() first. The
// sixth was closeViewSurfaces(), so closing the OPTION menu after switching
// mode left no terrain AND no screen: an empty room.
//
// The fix is not a sixth guard, it is one door. handBackScreen() owns the rule
// and every caller goes through it, so a seventh call site cannot forget a
// question it never has to ask. This suite reads the source as text, the way
// padconnect does, because the thing being pinned is a rule about call sites
// rather than a value a function returns.

const SELFTEST = process.argv.includes("--selftest");
const { readFileSync } = await import("node:fs");

const SRC = "Assets/Scripts/PokemonAR.ts";
const src = readFileSync(SRC, "utf8");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** The file with its comments removed: these checks are about CODE. */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** The body of one method, from its signature to the brace that closes it. */
function methodBody(name) {
  const at = src.indexOf(name);
  if (at < 0) return "";
  const open = src.indexOf("{", at);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.substring(open, i + 1);
    }
  }
  return "";
}

const code = codeOnly(src);

console.log("=== there is exactly one door ===");
{
  const offs = code.split("setScreenEnabled(false)").length - 1;
  check("only one place switches the screen off", offs === 1, "" + offs);

  const door = codeOnly(methodBody("private handBackScreen("));
  check("and that place is handBackScreen", door.indexOf("setScreenEnabled(false)") >= 0);
  check("which refuses in GAME BOY mode", door.indexOf("this.isGameBoyMode()") >= 0);
}

console.log("=== every caller goes through it ===");
{
  // The four that borrow the screen and hand it back, plus the boot.
  const callers = code.split("this.handBackScreen()").length - 1;
  check("several callers use the door", callers >= 4, "" + callers);

  // The one that started this: closing the OPTION page.
  const close = codeOnly(methodBody("private closeViewSurfaces("));
  check("closing the view page uses it", close.indexOf("this.handBackScreen()") >= 0);
  check("...and does not switch the screen off itself",
        close.indexOf("setScreenEnabled(false)") < 0, close);
}

console.log("=== GAME BOY mode still turns the screen ON ===");
{
  // A door that only ever closes would be its own bug: the mode has to light
  // the screen when it takes over, or the switch itself is the empty room.
  const rebuild = codeOnly(methodBody("private rebuildDiorama("));
  check("the mode lights the screen", rebuild.indexOf("setScreenEnabled(true)") >= 0);
  check("and clears the terrain", rebuild.indexOf("this.terrain.clear()") >= 0);
}

console.log("=== the lens never STARTS in GAME BOY ===");
{
  // "Kan je ervoor zorgen dat diorama de standaard playstyle wordt en niet
  // gameboy" -- Joshua, 10 September, after half a day of PLAY MODE being
  // restored from the file. Trying the mode once was enough to be started in
  // it for ever, and a lens that opens on a flat screen where a diorama used
  // to be reads as a broken world rather than as a remembered choice.
  const restore = codeOnly(methodBody("private restoreViewSettings("));
  check("the settings are restored", restore.indexOf("sanitiseViewSettings(") >= 0);
  check("but the mode is forced to DIORAMA",
        restore.indexOf("MODE_DIORAMA") >= 0 && restore.indexOf("PLAY_MODE_DIORAMA") >= 0,
        restore);
  check("and never to GAME BOY", restore.indexOf("PLAY_MODE_GAMEBOY") < 0, restore);

  // PLAY MODE lives in TWO places and fixing one was not enough. The SAVE
  // carries its own copy (PlayState.playMode), which CONTINUE adopts, so the
  // lens went on opening in GAME BOY after the settings file had stopped
  // asking for it: "ik merk dat de lens nogsteeds in gameboy ipv diarama
  // wordt gespeeld bij het starten".
  const forced = codeOnly(methodBody("private startInDiorama("));
  check("there is a second door for the save", forced.length > 0);
  check("it writes the play mode", forced.indexOf("this.play.playMode = PLAY_MODE_DIORAMA") >= 0,
        forced);
  check("and the OPTION row's own value with it",
        forced.indexOf("view.mode = MODE_DIORAMA") >= 0, forced);

  // And it is actually CALLED on the way into a world from a save.
  const world = codeOnly(methodBody("private startWorld(state: PlayState): void {"));
  check("the save path forces it", world.indexOf("this.startInDiorama()") >= 0, world.slice(-400));
  check("...before the world is built",
        world.indexOf("this.startInDiorama()") < world.indexOf("this.rebuildDiorama()"),
        world.indexOf("this.startInDiorama()") + " vs " + world.indexOf("this.rebuildDiorama()"));
}

console.log("=== nobody stands where the terrain has no ground ===");
{
  // The first cull converted the holder's position back into map cells and
  // compared them with the window's tile bounds. The arithmetic was right on
  // paper and people still stood in mid-air on the glasses -- "ik zie een
  // gedeelte van de map maar buiten dat gedeelte dan random paar mensen".
  //
  // So there is no arithmetic left to be wrong: the terrain is asked.
  //
  // WHICH question it is asked changed on 20 September. It used to be
  // surfaceY() -- "is there ground built here" -- and that stopped meaning
  // "can the wearer see this" on 11 September, when the terrain began building
  // a cover wider than the view and cutting the view out of it. Ground two
  // tiles past the plate is built and not drawn, so the cast standing on it
  // stayed visible, floating beside the model.
  const cull = codeOnly(methodBody("private cullNpcsToWindow("));
  check("the cull exists", cull.length > 0);
  check("it asks the terrain what the wearer can see",
        cull.indexOf("this.terrain.coversPoint(") >= 0, cull);
  check("and not merely what is built",
        cull.indexOf("surfaceY(") < 0 && cull.indexOf("pendingCovers(") < 0, cull);
  check("and it toggles the holder", cull.indexOf("holder.enabled") >= 0);
  check("no cell arithmetic is left", cull.indexOf("windowHasCell") < 0, cull);
  // A cull that silently does nothing is what the first one was, and there was
  // no way to tell from outside.
  check("it says how many it hid", cull.indexOf("print(") >= 0);
}

console.log("=== a fight in GAME BOY mode stays on the flat screen ===");
{
  // 26 September: the classic layout. The battle frame repaints the Game Boy
  // screen instead of the actors, the start of a fight stages no arena, and
  // the START list is painted on the screen rather than on the pad's panel.
  const frame = codeOnly(methodBody("private updateBattle("));
  check("the battle frame repaints the screen in GAME BOY mode",
        frame.indexOf("this.updateGameBoyScreen(dt)") >= 0 && frame.indexOf("this.isGameBoyMode()") >= 0);
  const screen = codeOnly(methodBody("private updateGameBoyScreen("));
  check("the screen paints the battle when a runner is up",
        screen.indexOf("this.paintGameBoyBattle(dt)") >= 0 && screen.indexOf("this.runner !== null") >= 0);
  check("and the list over the world", screen.indexOf("paintCanvasMenu(") >= 0);
  const menu = codeOnly(methodBody("private paintMenu("));
  check("the pad's panel stays dark for the list in GAME BOY mode", menu.indexOf("this.isGameBoyMode()") >= 0);
  check("no GAME BOY mode work is marked TODO any more", src.indexOf('TODO SPEC.md "GAME BOY mode') < 0);
  const panel = codeOnly(methodBody("private updateMessagePanel("));
  check("the room's panel is told about GAME BOY mode", panel.indexOf("gameBoy: this.isGameBoyMode()") >= 0);
  check("a fight's list uses the battle layout on the screen", screen.indexOf("paintCanvasBattleMenu(") >= 0);
}

console.log("=== the phone's buttons are not drawn over the phone ===");
{
  // "Kan je de layover van de UI van de buttons op de telefoon controller
  // weghalen". The phone still drives the game; only the picture is gone.
  const phone = codeOnly(methodBody("private updatePhonePad("));
  check("nothing builds the overlay any more",
        phone.indexOf("new PhonePadView(") < 0, phone);
  check("and one that exists is switched off",
        phone.indexOf("setEnabled(false)") >= 0);
}

if (SELFTEST) {
  // These checks stand entirely on methodBody and codeOnly. If either quietly
  // returned nothing, "does not switch the screen off itself" would pass by
  // vacuum on every file ever written.
  check("SELFTEST a missing method reads as empty",
        methodBody("private thisDoesNotExist(") === "");
  const close = methodBody("private closeViewSurfaces(");
  check("SELFTEST a real body is balanced and not empty",
        close.charAt(0) === "{" && close.charAt(close.length - 1) === "}" &&
        close.length > 40, "" + close.length);
  // And that stripping comments matters here too: the fix left a comment in
  // closeViewSurfaces that names the very call it must not make.
  check("SELFTEST comments would have failed the closeViewSurfaces check",
        close.indexOf("setScreenEnabled(false)") >= 0 &&
        codeOnly(close).indexOf("setScreenEnabled(false)") < 0);
}

console.log("\nGAMEBOYSCREEN  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
