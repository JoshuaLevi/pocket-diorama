// BLUE stops you for the first battle: OaksLabScript7's row-6 coordinate
// event, once a starter has been chosen. Measured on the cartridge
// (tools/oracle, 6 sep; FINDINGS.md "BLUE does not stop you for the first
// battle"): reaching row 6 turns the player to face up, BLUE says the whole
// of _OaksLabRivalIllTakeYouOnText unmoving from where he took his own
// Pokemon, walks over once it closes, and OPP_RIVAL1 begins. Beaten, he
// says his line and is gone for good.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/rivaltrigger.test.mjs Assets/Generated/kanto.json

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: rivaltrigger.test.mjs <bundle.json>"); process.exit(2); }
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "RIVALTRIGGER", "Red's rival triggers");
globalThis.print = () => {};
globalThis.getTime = () => 0;

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { rivalRosterFor } = await import(P + "script/Host.ts");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/**
 * Where oak-escort.json plus a CHARMANDER pick leaves you: (5,3) in
 * OAKS_LAB, facing up at Oak's desk, the starter in the party, BLUE not yet
 * fought. Built directly -- escort.test.mjs already proves the walk there
 * and playloop.test.mjs already proves the pick -- so this suite stays
 * about the row 6 trigger itself.
 */
function afterStarter(extraFlags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "OAKS_LAB";
  state.cellX = 5;
  state.cellY = 3;
  state.facing = "up";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 5, () => 0.5));
  if (extraFlags) { for (const f of extraFlags) { state.flags[f] = true; } }
  return new HeadlessLens(bundle, { state });
}

console.log("\n== Walking down from (5,3) is stopped on row 6 ==");
{
  const lens = afterStarter();
  const linesBefore = lens.lines.length;
  lens.run([{ walk: "down", n: 3 }]);
  const stopped = lens.state();
  check("landed on row 6, not further, and the cutscene owns the frame",
        stopped.map === "OAKS_LAB" && stopped.x === 5 && stopped.y === 6 && lens.loop.isBusy(),
        JSON.stringify(stopped) + " busy=" + lens.loop.isBusy());
  check("turned to face up before BLUE speaks", stopped.facing === "up", JSON.stringify(stopped));

  lens.run([{ text: "take you on!", max: 200 }, { press: "a" }, { wait: 150 }]);
  const said = lens.lines.slice(linesBefore).join(" ");
  check("BLUE's challenge is said, not the pre-starter line",
        said.indexOf("check out") >= 0 && said.indexOf("take you on") >= 0 && said.indexOf("away yet") < 0,
        said);
  check("the battle began, against OPP_RIVAL1 with the roster CHARMANDER decided",
        lens.battles.length === 1 && lens.battles[0] === "OPP_RIVAL1#" + rivalRosterFor(lens.play),
        JSON.stringify(lens.battles));

  lens.run([{ text: "Smell you later", max: 200 }, { press: "a" }, { wait: 30 }]);
  const reveals = lens.loop.reveals();
  check("the win is recorded and BLUE is gone",
        lens.play.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB === true && reveals["OAKS_LAB:OAKSLAB_RIVAL"] !== true,
        JSON.stringify(reveals));
  check("the trigger let go and the starter is still the only Pokemon",
        !lens.loop.isBusy() && lens.play.party.length === 1 && lens.play.party[0].species === "CHARMANDER");

  lens.run([{ walk: "down", n: 5 }]);
  const out = lens.state();
  check("the player can now leave the lab", out.map !== "OAKS_LAB", JSON.stringify(out));
}

console.log("\n== The trigger is disarmed once the battle is recorded ==");
{
  const lens = afterStarter(["EVENT_BATTLED_RIVAL_IN_OAKS_LAB"]);
  lens.loop.setRevealed("OAKS_LAB", "OAKSLAB_RIVAL", false);
  lens.run([{ walk: "down", n: 8 }]);
  const s = lens.state();
  check("nothing stops the walk to the door", s.map !== "OAKS_LAB" && lens.battles.length === 0, JSON.stringify(s));
}

console.log("\n== Talking to BLUE directly still works when the trigger has not fired ==");
{
  // The case the notes ask to keep working: BLUE ships at (4,3), one cell
  // left of where the player stands right after picking, so he can be
  // fought by facing and talking without ever visiting row 6.
  const lens = afterStarter();
  lens.run([{ face: "left" }, { text: "take you on!", max: 200 }, { press: "a" }, { wait: 60 }]);
  check("the talk-driven battle still starts",
        lens.battles.length === 1 && lens.battles[0] === "OPP_RIVAL1#" + rivalRosterFor(lens.play),
        JSON.stringify(lens.battles));
}

console.log("\n== He takes the one that beats yours ==");
{
  // data/trainers/parties.asm:487-490 -- Rival1Data is SQUIRTLE, BULBASAUR,
  // CHARMANDER, and every rival script picks between them off wRivalStarter
  // (OaksLab.asm:387-397). Asserted by SPECIES, not by roster number: a test
  // that compares the number against rivalRosterFor() passes whatever that
  // function returns, which is how the mapping stayed reversed.
  const beats = { CHARMANDER: "SQUIRTLE", SQUIRTLE: "BULBASAUR", BULBASAUR: "CHARMANDER" };
  const rosters = bundle.trainers.OPP_RIVAL1.parties;
  for (const starter of ["CHARMANDER", "SQUIRTLE", "BULBASAUR"]) {
    const state = PlayState.newPlayState(bundle.romSha1);
    state.flags["EVENT_CHOSE_" + starter] = true;
    const n = rivalRosterFor(state);
    // The lab (base 1), Route 22 (base 4) and Cerulean (base 7) are the same
    // three rosters three times over; his starter is the LAST of each party.
    for (const base of [1, 4, 7]) {
      const party = rosters[base + n - 2];
      const his = party[party.length - 1].species;
      check("with " + starter + ", roster " + (base + n - 1) + " brings " + beats[starter],
            his === beats[starter], "he brought " + his);
    }
  }
}

console.log("\nRIVALTRIGGER " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
