// The fight's menu is on the message panel, so the panel has to be ON.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/panelvisibility.test.mjs [--selftest]
//
// Joshua, 10 September, fourth glasses playtest: "als ik een gevecht eenmaal
// in table mode heb, dan kan ik nergens het menu zien voor de attack etc. Ik
// zie alleen een heel nice frame met daarin de dialoog."
//
// He was right, and nothing about the menu was broken. BattleRunner's
// afterReading() calls view.hideBox() -- which switches the whole message
// panel off -- and then view.showMoves() four lines later. The menu was
// painted onto the panel's canvas, cropped to reach it, and uploaded, every
// frame, with the panel's SceneObject disabled. Everything else in a fight
// survived because everything else is its OWN object: the frame is a
// PanelFrame, the two HUD blocks are their own quads reading the same
// texture, and the message box turns the panel back on whenever it opens.
//
// This suite is the truth table. It also pins the two rules that are easy to
// lose in a refactor: a fight on its own does not show the panel (there is
// nothing on it between pages, and a blank slab over the table is worse than
// none), and the OPTION page beats everything (it has taken the frame).

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { panelShouldShow } = await import("../Assets/Scripts/play/screen/PanelVisibility.ts");
const { readFileSync } = await import("node:fs");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** Nothing is happening. Every case below turns one thing on. */
function quiet(over) {
  return Object.assign({
    boxOpen: false, fightOn: false, menuOpen: false,
    styleAsked: false, frameTaken: false,
  }, over || {});
}

console.log("=== the regression itself ===");
{
  // The exact frame the wearer was looking at: a fight running, the message
  // box shut by hideBox(), and the FIGHT / PKMN / ITEM / RUN menu open.
  const theBug = quiet({ fightOn: true, boxOpen: false, menuOpen: true });
  check("a fight's menu with the box shut is on screen", panelShouldShow(theBug) === true);

  // And the frame either side of it, which always worked and must keep
  // working: the line before the menu, and the line after it.
  check("...as is the line that came before it",
        panelShouldShow(quiet({ fightOn: true, boxOpen: true })) === true);
  check("...and the one after", panelShouldShow(quiet({ fightOn: true, boxOpen: true, menuOpen: false })) === true);
}

console.log("=== a fight alone is not a reason to show anything ===");
{
  // Between one page and the next there is genuinely nothing on the panel.
  // The canvas keeps being painted and uploaded -- the HUD blocks live on it
  // -- but the panel itself is a blank white slab over the table.
  check("a fight with nothing to say shows nothing",
        panelShouldShow(quiet({ fightOn: true })) === false);
  check("and an empty lens shows nothing", panelShouldShow(quiet()) === false);
}

console.log("=== the menu only counts inside a fight ===");
{
  // menu.isOpen() is also true for the START menu in the overworld, which has
  // its own surface entirely. If that showed this panel, walking around with
  // START pressed would hang an empty box in front of the world.
  check("the START menu does not open the fight's panel",
        panelShouldShow(quiet({ menuOpen: true })) === false);
  check("but it does once a fight owns it",
        panelShouldShow(quiet({ menuOpen: true, fightOn: true })) === true);
}

console.log("=== the first fight's question takes the box ===");
{
  // closeBattleStyle deliberately leaves the panel enabled, because the
  // fight's first line lands on it a frame later. It must be shown while the
  // question stands whether or not the box is open.
  // GAME BOY mode: everything is on the flat screen, so nothing is on the
  // panel -- not even the fight's menu the whole file exists to keep visible.
  check("GAME BOY mode shows no panel at all, even for a fight's menu",
        panelShouldShow(quiet({ fightOn: true, boxOpen: false, menuOpen: true, gameBoy: true })) === false);
  check("and a caller that does not say is DIORAMA", panelShouldShow(quiet({ fightOn: true, menuOpen: true })) === true);
  check("the style question is on screen",
        panelShouldShow(quiet({ fightOn: true, styleAsked: true })) === true);
  check("...even with the box shut and no menu",
        panelShouldShow(quiet({ styleAsked: true })) === true);
}

console.log("=== a surface that has taken the frame beats all of it ===");
{
  // The OPTION page, the naming screen and a Pokedex entry each own the whole
  // frame. Nothing may be on screen behind them, which is the rule
  // setScreenEnabled has always enforced for the box.
  //
  // This mattered for nothing until the rule started turning the panel ON.
  // Before that, a surface that switched the panel off could be sure it
  // stayed off, because the only things that ever re-enabled it were the
  // things that put something on it.
  const cases = [
    quiet({ frameTaken: true, boxOpen: true }),
    quiet({ frameTaken: true, fightOn: true, menuOpen: true }),
    quiet({ frameTaken: true, styleAsked: true }),
  ];
  let shown = 0;
  for (const c of cases) if (panelShouldShow(c)) shown++;
  check("nothing shows behind a surface that took the frame", shown === 0, shown + " shown");
}

console.log("=== the lens actually asks ===");
{
  // The rule is only worth stating if the one caller uses it. A hand-rolled
  // copy of this condition in PokemonAR is how it drifted the first time.
  const src = readFileSync("Assets/Scripts/PokemonAR.ts", "utf8");
  check("PokemonAR imports the rule", src.indexOf("panelShouldShow") > 0);
  const at = src.indexOf("const panelWanted = panelShouldShow({");
  check("and uses it for the panel's own enabled flag", at > 0);
  const after = src.slice(at, at + 1400);
  check("passing the fight's menu into it", after.indexOf("menuOpen:") > 0);
  check("and every surface that takes the frame", after.indexOf("frameTaken:") > 0);
  // Named individually, so leaving one out is a diff someone can see.
  check("...the OPTION page", after.indexOf("this.viewPage !== null") > 0);
  check("...the naming screen", after.indexOf("this.naming !== null") > 0);
  check("...and a Pokedex entry", after.indexOf("this.dexEntryScreen !== null") > 0);
  check("and setting the panel from the answer",
        after.indexOf("this.messagePanel.setEnabled(panelWanted)") > 0);
  // The frame is a separate object hanging behind the panel. It stood in the
  // room around nothing for as long as the menu was invisible, which is the
  // "heel nice frame" the wearer could see.
  check("the frame goes with the panel",
        src.indexOf("this.messagePanel.pinned() && panelWanted") > 0);
}

console.log("=== the hazard is still there, which is why the rule is ===");
{
  // If this ever stops being true the rule above is still correct, but the
  // reason it exists has changed and the header should be reread.
  const runner = readFileSync("Assets/Scripts/play/BattleRunner.ts", "utf8");
  const body = runner.slice(runner.indexOf("private afterReading()"));
  const hide = body.indexOf("this.view.hideBox()");
  const show = body.indexOf("this.view.showMoves(");
  check("afterReading still hides the box", hide >= 0);
  check("...and offers the moves after it", show >= 0 && show > hide,
        "hideBox at " + hide + ", showMoves at " + show);
}

const label = "PANELVISIBILITY  " + pass + " PASS  " + fail + " FAIL";
console.log(label + (fail === 0 ? "  OK" : "  BROKEN"));
if (SELFTEST && fail > 0) process.exit(1);
