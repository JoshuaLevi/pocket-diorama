// POKeMON TOWER: the pad that heals, the soul on the sixth floor, and the
// rescue at the top.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/tower.test.mjs Assets/Generated/kanto.json
//
// scripts/PokemonTower2F.asm, PokemonTower5F.asm, PokemonTower6F.asm and
// PokemonTower7F.asm. What the GHOST looks like before the SILPH SCOPE is a
// system of its own and is not built yet; everything else on these floors is.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { healZoneAt, inQuietZone, talkScript } = await import(P + "script/MapScripts.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: tower.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "TOWER", "Red's Pokemon Tower cast");
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

function lensAt(mapId, x, y, facing, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  const mon = makeWildMon(bundle, "CHARMANDER", 30, () => 0.5);
  if (o.hurt) { mon.hp = 3; }
  state.party.push(mon);
  for (const f of o.flags || []) { state.flags[f] = true; }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function drive(lens, limit) {
  let n = 0;
  const cap = limit || 8000;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < cap) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens;
}

console.log("== The purified zone on the fifth floor ==");
{
  // PokemonTower5F.asm:16-50 -- the 2x2 pad at (10,8)-(11,9).
  check("the pad is four cells and nothing around it",
        healZoneAt("POKEMON_TOWER_5F", 10, 8) !== null && healZoneAt("POKEMON_TOWER_5F", 11, 9) !== null &&
        healZoneAt("POKEMON_TOWER_5F", 12, 8) === null && healZoneAt("POKEMON_TOWER_3F", 10, 8) === null);
  check("and wild Pokemon do not interrupt it",
        inQuietZone("POKEMON_TOWER_5F", 10, 8, {}) === true &&
        inQuietZone("POKEMON_TOWER_5F", 12, 8, {}) === false);

  // (9,8) is the cell beside the pad; (11,7) above it is a wall, so the way on
  // and off is sideways.
  const lens = lensAt("POKEMON_TOWER_5F", 9, 8, "right", { hurt: true });
  const mark = lens.pages.length;
  lens.run([{ walk: "right", n: 1 }]);
  drive(lens);
  const said = lens.pages.slice(mark).join(" ");
  check("stepping onto it heals the party", lens.play.party[0].hp === lens.play.party[0].maxHp,
        lens.play.party[0].hp + "/" + lens.play.party[0].maxHp);
  check("and says so", said.indexOf("purified") >= 0 && said.indexOf("fully healed") >= 0, said);
  check("the latch is set while you stand on it",
        lens.play.flags.EVENT_IN_PURIFIED_ZONE === true);

  lens.play.party[0].hp = 2;
  const mark2 = lens.pages.length;
  lens.run([{ walk: "right", n: 1 }]);
  drive(lens);
  check("walking across it does not heal again",
        lens.play.party[0].hp === 2 && lens.pages.length === mark2,
        JSON.stringify(lens.pages.slice(mark2)));

  lens.run([{ walk: "left", n: 2 }]);
  drive(lens);
  check("stepping off clears the latch", lens.play.flags.EVENT_IN_PURIFIED_ZONE !== true,
        JSON.stringify(lens.state()));
  const mark3 = lens.pages.length;
  lens.run([{ walk: "right", n: 1 }]);
  drive(lens);
  check("and coming back heals again",
        lens.play.party[0].hp === lens.play.party[0].maxHp && lens.pages.length > mark3,
        lens.play.party[0].hp + "/" + lens.play.party[0].maxHp);
}

console.log("\n== The restless soul on the sixth floor ==");
{
  // PokemonTower6F.asm:25-47: the one cell in front of the stairs.
  // (10,16) is the cell in front of the stairs; you reach it from (10,15).
  const lens = lensAt("POKEMON_TOWER_6F", 10, 15, "down");
  const mark = lens.pages.length;
  lens.run([{ walk: "down", n: 1 }]);
  drive(lens);
  const said = lens.pages.slice(mark).join(" ");
  check("she tells you to be gone", said.indexOf("Be gone") >= 0, said);
  check("and is fought at 30",
        lens.battles.length === 1 && lens.battles[0] === "MAROWAK@30", JSON.stringify(lens.battles));
  check("beaten, the GHOST was CUBONE's mother and her soul is calmed",
        said.indexOf("CUBONE's mother") >= 0 && said.indexOf("calmed") >= 0 &&
        said.indexOf("CUBONE's mother") < said.indexOf("calmed"), said);
  check("her cry is heard between the two lines", lens.events.indexOf("cry:MAROWAK") >= 0,
        JSON.stringify(lens.events.filter((e) => e.indexOf("cry:") === 0)));
  check("and the way to the stairs is open for good",
        lens.play.flags.EVENT_BEAT_GHOST_MAROWAK === true);

  const done = lensAt("POKEMON_TOWER_6F", 10, 15, "down", { flags: ["EVENT_BEAT_GHOST_MAROWAK"] });
  const mark2 = done.pages.length;
  done.run([{ walk: "down", n: 1 }]);
  drive(done);
  check("afterwards the cell is quiet",
        done.pages.length === mark2 && done.battles.length === 0, JSON.stringify(done.pages.slice(mark2)));
}

console.log("\n== MR FUJI at the top ==");
{
  const script = talkScript("POKEMON_TOWER_7F", "TEXT_POKEMONTOWER7F_MR_FUJI");
  const ops = script.map((c) => c.op).join(">");
  check("the rescue sets both flags, shows him at home and warps you there",
        ops.indexOf("set_flag>set_flag") >= 0 && ops.endsWith("warp"), ops);
  const hides = script.filter((c) => c.op === "hide_object");
  check("and takes him off the tower floor before the warp",
        hides.some((c) => c.map === "POKEMON_TOWER_7F" && c.npc === "POKEMONTOWER7F_MR_FUJI"),
        JSON.stringify(script));
  check("the Saffron guards still swap",
        hides.some((c) => c.npc === "SAFFRONCITY_ROCKET8") &&
        script.some((c) => c.op === "show_object" && c.npc === "SAFFRONCITY_ROCKET9"));
}

console.log("\n== The Rockets on the top floor ==");
{
  // PokemonTower7F.asm:25-65 and the movement table at :88-132: a beaten
  // Rocket walks out of the room and is gone.
  const { trainerTalkScript } = await import(P + "script/TrainerTalk.ts");
  const { trainerExitScript } = await import(P + "script/MapScripts.ts");
  const map = bundle.maps.POKEMON_TOWER_7F;
  const rocket = map.objects.find((o) => o.name === "POKEMONTOWER7F_ROCKET1");
  const header = { battle: "", won: "", after: "", event: "EVENT_BEAT_POKEMON_TOWER_7F_TRAINER_0" };
  const script = trainerTalkScript(map, {
    kind: "object", name: rocket.name, textId: rocket.text, x: rocket.x, y: rocket.y,
    trainerClass: rocket.trainerClass, trainerParty: rocket.trainerParty, item: "", index: 0,
  }, header, false);
  const ops = script.map((c) => c.op).join(">");
  check("beating him starts a walk and ends with him gone",
        ops.indexOf("beat_trainer") >= 0 && ops.indexOf("move>hide_object") >= 0, ops);
  check("all three of them leave", ["POKEMONTOWER7F_ROCKET1", "POKEMONTOWER7F_ROCKET2",
        "POKEMONTOWER7F_ROCKET3"].every((n) => trainerExitScript("POKEMON_TOWER_7F", n).length === 2));
  check("and every walk ends at the stairs' own column",
        trainerExitScript("POKEMON_TOWER_7F", "POKEMONTOWER7F_ROCKET2")[0].path.filter((d) => d === "left").length === 2,
        JSON.stringify(trainerExitScript("POKEMON_TOWER_7F", "POKEMONTOWER7F_ROCKET2")));
  check("a trainer anywhere else still just stands there",
        trainerExitScript("ROUTE_3", "ROUTE3_BUG_CATCHER1").length === 0);
  const afterwards = trainerTalkScript(map, {
    kind: "object", name: rocket.name, textId: rocket.text, x: rocket.x, y: rocket.y,
    trainerClass: rocket.trainerClass, trainerParty: rocket.trainerParty, item: "", index: 0,
  }, header, true);
  check("and a trainer already beaten does not walk out twice",
        afterwards.every((c) => c.op !== "move"), JSON.stringify(afterwards.map((c) => c.op)));
}

console.log("\n== The rival on the second floor ==");
{
  const script = talkScript("POKEMON_TOWER_2F", "TEXT_POKEMONTOWER2F_RIVAL");
  const ops = script.map((c) => c.op);
  const firstMusic = ops.indexOf("play_music");
  const firstText = ops.indexOf("show_text");
  check("MEET RIVAL plays before a word is said, not after the fight",
        firstMusic >= 0 && firstMusic < firstText, ops.join(">"));
  check("and the map's own music comes back when he has gone",
        ops[ops.length - 4] === "hide_object" || ops.indexOf("play_default_music") > firstMusic,
        ops.join(">"));
}

// The ghost on 6F is a static battle, and a static battle is started by the
// LENS, not by the harness -- so the one line that decides whether MAROWAK is
// a ghost is read from the source. Until 20 September it passed no map, and
// she could be beaten with no SILPH SCOPE at all.
{
  const lens = readFileSync(new URL("../Assets/Scripts/PokemonAR.ts", import.meta.url), "utf8");
  const at = lens.indexOf("beginStaticBattle: (species: string, level: number) =>");
  const body = at >= 0 ? lens.substring(at, lens.indexOf("beginDemoBattle", at)) : "";
  check("the lens starts a static battle with the map it happens on",
        body.indexOf("r.startWild(species, level, () => Math.random(), self.overworld.mapId)") >= 0, body.slice(0, 400));
}

console.log("\nTOWER " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
