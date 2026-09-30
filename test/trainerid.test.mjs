// Every Pokemon in your keeping names a trainer, and a traded one names theirs.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/trainerid.test.mjs Assets/Generated/kanto.json --selftest
//
// These three fields -- PlayState.playerId, BattleMon.otId and otName -- are
// the only part of the save that cannot be added later. The moment a save is
// exported as a real cartridge .sav (docs/RESEARCH-SAVE-EXCHANGE.md) every
// Pokemon needs an owner, and a save written before the field existed would
// disagree with every save written after it. Nothing in the lens reads them
// yet; this suite is what stops them rotting until something does.
//
// The rule they encode is the cartridge's: a Pokemon whose OTID differs from
// wPlayerID is TRADED, and a traded Pokemon disobeys above your badge level.
// So "claim what has no owner" and "never overwrite an owner" are not two
// conveniences, they are the two halves of one rule.
//
// --selftest breaks each half and checks the suite notices.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: trainerid.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};

const { newPlayState, migratePlayState, rollTrainerId, PLAY_STATE_VERSION } =
  await import("../Assets/Scripts/play/PlayState.ts");
const { claimUnowned, receiveMon, depositToBox } =
  await import("../Assets/Scripts/play/Storage.ts");
const { makeWildMon, cloneMon } = await import("../Assets/Scripts/play/battle/Stats.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** A roll that answers a fixed sequence, so an id can be asserted. */
function pinned(values) {
  let at = 0;
  return () => values[at++ % values.length];
}

/** A wild Pokemon, owned by nobody. */
function wild(species, level) {
  return makeWildMon(bundle, species, level, pinned([0.5]));
}

console.log("=== a new game rolls an id, and it is a cartridge id ===");
{
  check("the version says v13", PLAY_STATE_VERSION === 13, "" + PLAY_STATE_VERSION);

  const state = newPlayState("abc", pinned([0.0]));
  check("a roll of 0 is 0", state.playerId === 0, "" + state.playerId);
  check("a roll of 1 stays inside two bytes",
        newPlayState("abc", pinned([0.999999])).playerId === 65535,
        "" + newPlayState("abc", pinned([0.999999])).playerId);
  check("a half roll is half the range",
        newPlayState("abc", pinned([0.5])).playerId === 32768,
        "" + newPlayState("abc", pinned([0.5])).playerId);

  // The real roll, unpinned, a hundred times: always a whole number in range.
  let bad = 0;
  const seen = {};
  for (let i = 0; i < 100; i++) {
    const id = rollTrainerId(null);
    if (!(id >= 0 && id <= 65535) || Math.floor(id) !== id) bad++;
    seen[id] = true;
  }
  check("a hundred real rolls are all whole and in range", bad === 0, bad + " bad");
  // Two players called RED must not be the same trainer. A hundred rolls out of
  // 65,536 collide with probability under 8%, so requiring 90 distinct is safe
  // and still catches a constant.
  check("and they are not a constant", Object.keys(seen).length >= 90,
        Object.keys(seen).length + " distinct");
}

console.log("\n=== an old save gets an id and a new one keeps its own ===");
{
  const before = newPlayState("abc", pinned([0.25]));
  const older = JSON.parse(JSON.stringify(before));
  older.version = 6;
  delete older.playerId;
  const migrated = migratePlayState(older, "abc");
  check("a pre-v7 save loads at all", migrated !== null);
  check("and comes out with an id in range",
        migrated.playerId >= 0 && migrated.playerId <= 65535, "" + migrated.playerId);
  check("and is stamped with the current version", migrated.version === PLAY_STATE_VERSION, "" + migrated.version);

  const carried = JSON.parse(JSON.stringify(before));
  carried.playerId = 4242;
  check("a v7 save keeps the id it was written with",
        migratePlayState(carried, "abc").playerId === 4242);
  // A hand-edited or corrupt value must not become the trainer.
  for (const rubbish of [-1, 70000, "4242", null, 1.5]) {
    const bent = JSON.parse(JSON.stringify(before));
    bent.playerId = rubbish;
    const out = migratePlayState(bent, "abc");
    check("rubbish id " + JSON.stringify(rubbish) + " is refused",
          out.playerId >= 0 && out.playerId <= 65535 && Math.floor(out.playerId) === out.playerId,
          "" + out.playerId);
  }
}

console.log("\n=== a wild Pokemon belongs to nobody ===");
{
  const mon = wild("RATTATA", 3);
  check("no id", mon.otId === 0, "" + mon.otId);
  check("no name", mon.otName === "", JSON.stringify(mon.otName));
  const copy = cloneMon(mon);
  check("and a copy of it is still nobody's", copy.otId === 0 && copy.otName === "");
}

console.log("\n=== keeping it claims it ===");
{
  const state = newPlayState("abc", pinned([0.5]));
  state.playerName = "JOSHUA";
  receiveMon(bundle, state, wild("PIDGEY", 4));
  check("it went to the party", state.party.length === 1, "" + state.party.length);
  check("and it names the trainer", state.party[0].otName === "JOSHUA",
        JSON.stringify(state.party[0].otName));
  check("with the trainer's id", state.party[0].otId === 32768, "" + state.party[0].otId);

  // Into a box, which is a different code path and must behave the same.
  depositToBox(state, wild("CATERPIE", 3));
  const box = state.boxes[state.currentBox];
  check("a boxed Pokemon is claimed too", box[box.length - 1].otName === "JOSHUA",
        JSON.stringify(box[box.length - 1].otName));
}

console.log("\n=== a traded Pokemon keeps the trainer who caught it ===");
{
  const state = newPlayState("abc", pinned([0.5]));
  state.playerName = "JOSHUA";
  const traded = wild("ABRA", 10);
  traded.otId = 1234;
  traded.otName = "MIKE";
  receiveMon(bundle, state, traded);
  const got = state.party[0];
  check("the id is not overwritten", got.otId === 1234, "" + got.otId);
  check("nor the name", got.otName === "MIKE", JSON.stringify(got.otName));
  check("so it reads as traded", got.otId !== state.playerId);

  // The sweep runs on every save, so it must not drift on the second pass.
  const again = claimUnowned(state);
  check("a second sweep claims nothing", again === 0, again + " claimed");
  check("and the trade survives it", state.party[0].otName === "MIKE");
}

console.log("\n=== the sweep reaches everything the player keeps ===");
{
  const state = newPlayState("abc", pinned([0.5]));
  state.playerName = "RED";
  // Put Pokemon in by hand, the way a path that forgot to claim would.
  state.party.push(wild("BULBASAUR", 5), wild("CHARMANDER", 5));
  state.boxes[0].push(wild("SQUIRTLE", 5));
  state.boxes[7].push(wild("PIKACHU", 5));
  const claimed = claimUnowned(state);
  check("all four were claimed", claimed === 4, claimed + " claimed");
  let orphans = 0;
  for (const mon of state.party) if (!mon.otName) orphans++;
  for (const box of state.boxes) for (const mon of box) if (!mon.otName) orphans++;
  check("and nothing is left ownerless", orphans === 0, orphans + " orphans");
  check("it is idempotent", claimUnowned(state) === 0);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // Break each half of the rule and prove the suite is what catches it.
  const state = newPlayState("abc", pinned([0.5]));
  state.playerName = "RED";

  // Half one: a sweep that skipped boxes would pass every party check above.
  state.boxes[3].push(wild("ODDISH", 8));
  claimUnowned(state);
  check("the box half of the sweep is real", state.boxes[3][0].otName === "RED",
        JSON.stringify(state.boxes[3][0].otName));

  // Half two: a sweep that stamped unconditionally would erase a trade, and
  // that is the failure the disobedience rule would inherit.
  const traded = wild("MACHOP", 12);
  traded.otId = 999;
  traded.otName = "CHAD";
  state.party.push(traded);
  claimUnowned(state);
  check("the do-not-overwrite half is real", state.party[0].otName === "CHAD",
        JSON.stringify(state.party[0].otName));
  check("and it is the thing that makes it traded", state.party[0].otId !== state.playerId);
}

console.log("\nTRAINERID  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
