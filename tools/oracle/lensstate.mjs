// The lens's copy of a prepared oracle start: the same road walked on the
// headless lens, then the party set to the cartridge's exact levels and
// experience so both machines level up at the same step from here on.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//       tools/oracle/lensstate.mjs Assets/Generated/kanto.json after-rival|after-brock
//
// Reads tools/oracle/state/<name>.rom.json (written by `oracle.py prepare`)
// and writes tools/oracle/state/<name>.lens.json for compare.mjs.
//
// after-rival: Oak's escort, CHARMANDER, the lab battle. after-brock: the
// same with BULBASAUR, then the waypoints the cartridge recorded in its
// rom.json -- the clerk's parcel, Oak's Pokedex, Route 2's grass, the two
// Centers, Brock -- each leg planned by road.mjs from the lens's own cell
// exactly as oracle.py planned it from the cartridge's, and each talk held
// in the lens's own words. The headless lens does not fight: every battle on
// the road (the rival, the forest's Bug Catcher, Brock) resolves as a win at
// once, so what the cartridge earned by fighting -- levels, experience, stat
// experience, money, the Pokedex's seen list -- is copied from rom.json at
// the end. What the lens sets by walking (flags, toggles, the respawn
// Center, the badge, the TM) is left as the lens set it and checked against
// the cartridge; a difference is a finding (FINDINGS.md), not a patch.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [bundlePath, name] = process.argv.slice(2);
if (!bundlePath || (name !== "after-rival" && name !== "after-brock")) {
  console.error("usage: lensstate.mjs <bundle.json> after-rival|after-brock");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
globalThis.print = () => {};
const { HeadlessLens } = await import("../../test/headless.mjs");
const { makeWildMon, computeStats } = await import("../../Assets/Scripts/play/battle/Stats.ts");
const { planRoad } = await import("./road.mjs");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const rom = JSON.parse(readFileSync(join(here, "state", name + ".rom.json"), "utf8"));

// after-brock walks two hundred cells of road past Route 1's and Viridian's
// wanderers: they stay on their shipped cells here (as they do under a
// scenario's stillNpcs), so a road planned around those cells is never
// blocked by a random step. after-rival never leaves the lab and keeps the
// lens as it always had it.
const lens = new HeadlessLens(bundle, { wanderers: name !== "after-brock" });
lens.play.playerName = "RED";
lens.play.rivalName = "BLUE";
lens.clearText();
const escort = JSON.parse(readFileSync(join(here, "scenarios", "oak-escort.json"), "utf8")).actions;
lens.run(escort);
// The starter, in the words the lens shows for each ball (oracle.py's
// STARTER_PICKS walks the cartridge through the same pages); then back over
// the lab's aisle for BULBASAUR, whose ball is three cells to the right.
if (name === "after-rival") {
  lens.run([{ face: "right" }, { text: "CHARMANDER?", max: 40 }, { press: "a" },
            { text: "nickname", max: 40 }, { press: "a" }, { wait: 60 }, { press: "b" },
            { text: "SQUIRTLE!", max: 40 }, { press: "a" }, { wait: 120 }]);
} else {
  lens.run([{ walk: "down", n: 1 }, { walk: "right", n: 3 }, { face: "up" },
            { text: "BULBASAUR?", max: 40 }, { press: "a" },
            { text: "nickname", max: 40 }, { press: "a" }, { wait: 60 }, { press: "b" },
            { text: "CHARMANDER!", max: 40 }, { press: "a" }, { wait: 120 }]);
  lens.clearText();
  lens.run([{ walk: "down", n: 1 }, { walk: "left", n: 3 }]);
}
for (let i = 0; i < 8; i++) {
  lens.run([{ walk: "down", n: 1 }]);
  if (lens.pageWaiting || lens.loop.isBusy()) break;
}
// The headless lens does not fight: the rival battle resolves as a win at
// once and BLUE's parting script runs.
lens.run([{ text: "take", max: 40 }, { press: "a" }, { text: "later", max: 60 }, { press: "a" }, { wait: 300 }]);

/** Where the lens stands, as road.mjs and rom.json name a cell. */
const cell = () => [lens.overworld.mapId, lens.overworld.cellX, lens.overworld.cellY];
const sameCell = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Walks to a waypoint the way oracle.py's walk_leg does: plan from the cell
 * the lens stands on, check each action against the cell the planner said it
 * ends on, and when a script took the frame (a trainer's line of sight, a
 * page) see it through and plan again from wherever that left the lens.
 */
function walkLeg(leg) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (sameCell(cell(), leg.to)) return;
    const [map, x, y] = cell();
    const road = planRoad(bundle, { map, x, y }, { map: leg.to[0], x: leg.to[1], y: leg.to[2] },
                          { ...(leg.options || {}), lastMap: lens.overworld.lastMapId });
    if (!road) throw new Error(leg.name + ": no road from " + cell().join(",") + " to " + leg.to.join(","));
    let offRoad = false;
    for (let i = 0; i < road.actions.length && !offRoad; i++) {
      lens.run([road.actions[i]]);
      if (lens.pageWaiting || lens.loop.isBusy()) {
        console.log(leg.name + ": a script took the frame at " + cell().join(",") + " -- seen through");
        lens.clearText();
        lens.settle();
      }
      offRoad = !sameCell(cell(), road.ends[i]);
      // Off the plan with no script to blame: a body in the way. Give it a
      // moment to move on before planning again from here.
      if (offRoad) lens.frames(120);
    }
  }
  throw new Error(leg.name + ": could not reach " + leg.to.join(",") + "; standing at " + cell().join(","));
}

if (name === "after-brock") {
  // The clerk's errand, in the words of the transcript that already compares
  // (scenarios/viridian-mart-parcel.json), as the cartridge walked it.
  const errand = JSON.parse(readFileSync(join(here, "scenarios", "viridian-mart-parcel.json"), "utf8")).actions;
  lens.run(errand);
  for (const leg of rom.legs) {
    walkLeg(leg);
    console.log(leg.name + ": at " + cell().join(",") + " facing " + lens.overworld.facing);
    if (leg.name === "mart-to-oak") {
      // Oak's request scene (test/oakslab-parcel.test.mjs's own beats): the
      // parcel, BLUE in and out, the Pokedex.
      lens.run([{ face: "up" }, { text: "Gramps!", max: 60 }, { text: "call me for", max: 400 },
                { text: "Leave it", max: 200 }, { text: "Hahaha", max: 60 }, { press: "a" }, { wait: 900 }]);
      lens.clearText();
      lens.settle();
    } else if (leg.to[0].indexOf("POKECENTER") >= 0) {
      // The nurse: A turns her pages and answers YES.
      lens.run([{ face: "up" }, { press: "a" }]);
      lens.clearText();
      lens.settle();
    } else if (leg.name === "pewter-center-to-brock") {
      // Brock: his page, the (instant) battle, the badge and the TM.
      lens.run([{ face: "up" }, { press: "a" }]);
      lens.clearText();
      lens.settle();
    }
  }
}
const before = lens.state();
const ownBag = lens.play.bag.map((s) => s.id + "x" + s.count).join(",");
const ownParty = lens.play.party.map((m) => m.species + " L" + m.level + " " + m.hp + "/" + m.maxHp).join(",");

// The party as the cartridge has it after its own battles: the same DVs and
// stat experience, so the stat formula gives the same max HP, and the same
// moves with the PP they have left.
const party = rom.partyDetail.map((m) => {
  const mon = makeWildMon(bundle, m.species, m.level, () => 0.5);
  mon.exp = m.exp;
  if (m.dvs && m.statExp) {
    mon.ivs = { hp: 0, attack: m.dvs.attack, defense: m.dvs.defense, speed: m.dvs.speed, special: m.dvs.special };
    mon.evs = { hp: m.statExp.hp, attack: m.statExp.attack, defense: m.statExp.defense,
                speed: m.statExp.speed, special: m.statExp.special };
    mon.stats = computeStats(bundle.species[m.species].baseStats, mon.ivs, mon.evs, m.level);
    mon.battleStats = { attack: mon.stats.attack, defense: mon.stats.defense, speed: mon.stats.speed, special: mon.stats.special };
    mon.maxHp = mon.stats.hp;
    mon.hp = m.hp;
    if (mon.maxHp !== m.maxHp) {
      console.log("NOTE: the lens's stat formula gives " + m.species + " max HP " + mon.maxHp + ", the cartridge has " + m.maxHp);
    }
  } else {
    mon.hp = mon.maxHp;
  }
  if (m.moves) {
    mon.moves = m.moves.map((slot) => {
      const def = bundle.moves[slot.id];
      return { id: slot.id, pp: slot.pp, maxPp: def ? def.pp : slot.pp };
    });
  }
  return mon;
});
lens.play.party = party;
if (name === "after-rival") {
  // The cartridge's rival battle trigger at the lab's row 6 is not in the lens
  // yet (FINDINGS, open): the flag it sets and BLUE's exit are applied by hand
  // so the two machines agree on the lab from here.
  lens.play.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB = true;
  lens.loop.setRevealed("OAKS_LAB", "OAKSLAB_RIVAL", false);
}
lens.play.money = rom.money;   // the prizes for BLUE (and Brock), less what a whiteout on the grind took
if (name === "after-brock") {
  // The bag as the cartridge has it. The lens keeps the Pokedex as a bag item
  // (OaksLabOakGivesPokedexScript's give_item POKEDEX); the cartridge's
  // Pokedex is a flag and never in wBagItems, so its bag after Brock is TM34
  // alone (FINDINGS, 12 sep).
  lens.play.bag = rom.bag.map(([id, count]) => ({ id, count }));
  // What the cartridge saw and caught on the grind the lens did not fight:
  // the Pokedex's seen and owned lists, by dex number.
  for (const n of rom.dexSeen || []) lens.play.dexSeen[n - 1] = true;
  for (const n of rom.dexOwned || []) lens.play.dexOwned[n - 1] = true;
}
lens.play.mapId = rom.map;
lens.play.cellX = rom.x;
lens.play.cellY = rom.y;
lens.play.facing = rom.facing;

writeFileSync(join(here, "state", name + ".lens.json"), JSON.stringify(lens.play));
console.log("lens after its own road:", JSON.stringify(before));
console.log("lens's own party:", ownParty, "bag:", ownBag, "money:", before.money, "badges:", before.badges,
            "respawn:", lens.play.respawnMapId);
console.log("rom:", rom.map, rom.x + "," + rom.y, rom.facing, "party", JSON.stringify(rom.partyDetail),
            "bag", JSON.stringify(rom.bag), "money", rom.money, "badges", rom.badges, "respawn", rom.respawnMap);
const flags = name === "after-rival"
  ? ["EVENT_GOT_STARTER", "EVENT_CHOSE_CHARMANDER", "EVENT_BATTLED_RIVAL_IN_OAKS_LAB", "EVENT_FOLLOWED_OAK_INTO_LAB"]
  : ["EVENT_GOT_STARTER", "EVENT_CHOSE_BULBASAUR", "EVENT_BATTLED_RIVAL_IN_OAKS_LAB", "EVENT_GOT_OAKS_PARCEL",
     "EVENT_OAK_GOT_PARCEL", "EVENT_GOT_POKEDEX", "EVENT_BEAT_VIRIDIAN_FOREST_TRAINER_2", "EVENT_BEAT_BROCK",
     "EVENT_GOT_TM34", "EVENT_1ST_ROUTE22_RIVAL_BATTLE", "EVENT_ROUTE22_RIVAL_WANTS_BATTLE"];
console.log("flags:", flags.map((f) => f + "=" + lens.play.flags[f]).join(" "));
if (name === "after-brock") {
  const badgeOk = (lens.play.badges[0] === true) === ((rom.badgeMask & 1) === 1);
  const tmOk = before.bag.some((b) => b[0] === "TM_BIDE") === rom.bag.some((b) => b[0] === "TM_BIDE");
  console.log("badge agrees:", badgeOk, " TM34 agrees:", tmOk, " lens flag EVENT_GOT_TM34:", lens.play.flags.EVENT_GOT_TM34);
}
console.log("wrote", join(here, "state", name + ".lens.json"));
