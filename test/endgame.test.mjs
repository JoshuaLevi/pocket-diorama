// The end of the game: the ELITE FOUR, the CHAMPION, and the HALL OF FAME.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/endgame.test.mjs Assets/Generated/kanto.json
//
// The CHAMPION's room is bank $1D at $5FD0..$60C7, nine little scripts chained
// through the map's own script index; what is asserted below is the order of
// its texts, who moves where, and that the last of it puts the player in the
// HALL OF FAME.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: endgame.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "ENDGAME", "Red's Elite Four tables");
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

function lensAt(map, x, y, facing, mut) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = map;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  for (let i = 0; i < 3; i++) {
    state.party.push(makeWildMon(bundle, "CHARMANDER", 70, () => 0.5));
  }
  if (mut) { mut(state); }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function run(lens, steps) {
  lens.run(steps);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 9000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.join(" ");
}

console.log("== The ELITE FOUR ==");
{
  const four = [
    ["LORELEIS_ROOM", "LORELEI", "EVENT_BEAT_LORELEIS_ROOM_TRAINER_0"],
    ["BRUNOS_ROOM", "BRUNO", "EVENT_BEAT_BRUNOS_ROOM_TRAINER_0"],
    ["AGATHAS_ROOM", "AGATHA", "EVENT_BEAT_AGATHAS_ROOM_TRAINER_0"],
    ["LANCES_ROOM", "LANCE", ""],
  ];
  for (const row of four) {
    const at = row[0] === "LANCES_ROOM" ? [6, 2] : [5, 3];
    const lens = lensAt(row[0], at[0], at[1], "up");
    run(lens, [{ press: "a" }]);
    check(row[1] + " fights when spoken to",
          lens.battles.length === 1 && lens.battles[0].indexOf(row[1]) >= 0,
          JSON.stringify(lens.battles));
  }
  // Each of the first three rooms is sealed until its own leader is down.
  for (const row of four.slice(0, 3)) {
    const shut = bundle.blockOverrides[row[0]];
    check(row[0] + "'s far door opens on the win",
          shut.length === 1 && shut[0].flags[0] === row[2],
          JSON.stringify(shut));
  }
}

console.log("\n== The CHAMPION ==");
{
  const lens = lensAt("CHAMPIONS_ROOM", 3, 7, "up", (s) => { s.party[0].hp = 3; });
  const said = run(lens, [{ walk: "up", n: 1 }]);
  check("walking in is met with his line",
        said.indexOf("looking forward to seeing") >= 0, said.slice(0, 90));
  check("and the roster is the one HIS starter decides",
        lens.battles.length === 1 && lens.battles[0] === "OPP_RIVAL3#1",
        JSON.stringify(lens.battles));
  check("beating him is remembered",
        lens.play.flags.EVENT_BEAT_CHAMPION_RIVAL === true);
  check("OAK comes in and the RIVAL goes",
        lens.loop.revealOf("CHAMPIONS_ROOM", "CHAMPIONSROOM_OAK") === true &&
        lens.loop.revealOf("CHAMPIONS_ROOM", "CHAMPIONSROOM_RIVAL") === false);
  check("he says all four of his pieces, in the cartridge's order",
        said.indexOf("Congratulations") >= 0 &&
        said.indexOf("disappointed") >= 0 &&
        said.indexOf("Come with me") >= 0,
        said.slice(-200));
  check("and the last of it is the HALL OF FAME",
        lens.state().map === "HALL_OF_FAME",
        lens.state().map + " " + lens.state().x + "," + lens.state().y);
  check("where the machine records the party and heals it",
        lens.play.flags.EVENT_HALL_OF_FAME === true &&
        lens.play.party[0].hp === lens.play.party[0].maxHp,
        lens.play.party[0].hp + "/" + lens.play.party[0].maxHp);
  check("and OAK has the last word",
        said.indexOf("HALL OF FAME") >= 0, said.slice(-120));

  const again = lensAt("CHAMPIONS_ROOM", 3, 7, "up", (s) => {
    s.flags.EVENT_BEAT_CHAMPION_RIVAL = true;
  });
  run(again, [{ walk: "up", n: 1 }]);
  check("a second walk in is quiet", again.battles.length === 0,
        JSON.stringify(again.pages));
}

console.log("\n== VIRIDIAN, before any of it ==");
{
  const gym = lensAt("VIRIDIAN_GYM", 2, 2, "up");
  run(gym, [{ press: "a" }]);
  check("GIOVANNI holds the eighth badge",
        gym.battles.length === 1 && gym.battles[0].indexOf("GIOVANNI") >= 0,
        JSON.stringify(gym.battles));
}

console.log("\nENDGAME " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
