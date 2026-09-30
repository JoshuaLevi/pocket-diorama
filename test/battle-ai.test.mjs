// The trainer AI, driven through a real battle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle-ai.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Every other battle suite plays WILD battles, where ctx.isWild is true and the
// AI is never consulted. Ai.ts was fully written and fully unreachable for that
// reason: 533 assertions were green with classAction wired to nothing. This file
// exists to make the item and switch paths reachable from takeTurn, so that
// removing the wiring FAILS something.
//
// The behavioural claim it pins down is the one the ROM makes at bank 15:$439f:
//
//   439f  jr c, $43ae      ; the AI acted
//   43a1  call $66bc       ; ExecuteEnemyMove   <- skipped
//   ...
//   43b7  call $450f       ; ExecutePlayerMove  <- still runs
//
// The trainer's item costs the trainer its ATTACK, not the round. A version that
// ends the turn makes every Full Restore worth two turns instead of one.
//
// `--selftest` re-runs the checks against a battle whose AI has been unwired by
// hand. A check that still passes there is not testing the AI.

import { readFileSync } from "node:fs";

globalThis.print = () => {};

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battle-ai.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const Types = await import("../Assets/Scripts/play/battle/types.ts");
const Stats = await import("../Assets/Scripts/play/battle/Stats.ts");
const Ai = await import("../Assets/Scripts/play/battle/Ai.ts");
const State = await import("../Assets/Scripts/play/battle/BattleState.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

// A seeded xorshift32 so a failure is always the same failure.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function mon(speciesId, level, seed) {
  return Stats.makeWildMon(bundle, speciesId, level, seeded(seed));
}

const MOVE = (i) => ({ kind: Types.ACTION_MOVE, moveIndex: i, partyIndex: -1, item: "" });

function trainerBattle(trainerId, foeSpecies, seed, foeCount) {
  const party = [mon("CHARMANDER", 30, seed + 1)];
  const foes = [];
  for (let i = 0; i < (foeCount || 1); i++) {
    foes.push(mon(foeSpecies[i] || foeSpecies[0], 12, seed + 10 + i));
  }
  return State.startTrainerBattle(bundle, party, 0, foes, trainerId, seeded(seed));
}

// ---------------------------------------------------------------------------
// 1. Brock's Full Heal. BrockAI has no roll at all: `onStatus` fires whenever the
//    enemy Pokemon is statused, so this is deterministic in a way the percentage
//    classes are not.
// ---------------------------------------------------------------------------

function brockHeals() {
  const battle = trainerBattle("OPP_BROCK", ["GEODUDE"], 4242);
  battle.ctx.foe.active.status = Types.STATUS_PARALYSIS;
  const before = battle.ctx.foe.active.status;
  const report = battle.takeTurn(MOVE(0));
  return { battle, report, before, after: battle.ctx.foe.active.status };
}

const heal = brockHeals();
check("a statused trainer Pokemon starts the turn statused",
      heal.before === Types.STATUS_PARALYSIS, "before=" + heal.before);
check("Brock's Full Heal clears it",
      heal.after === Types.STATUS_NONE, "after=" + heal.after);
check("the item is announced",
      heal.report.messages.some((m) => m.indexOf("FULL HEAL") >= 0),
      JSON.stringify(heal.report.messages));

// The invariant the ROM disassembly pins: the player still moves.
check("the player still moves on the turn the trainer uses an item",
      heal.report.playerMove !== null,
      "playerMove=" + JSON.stringify(heal.report.playerMove));
check("and the trainer does not also attack",
      heal.report.foeMove === null,
      "foeMove=" + JSON.stringify(heal.report.foeMove));

// ---------------------------------------------------------------------------
// 2. The allowance. wAICount is spent, not free: Brock may act 5 times per
//    Pokemon, and a sixth statused turn must go unanswered.
// ---------------------------------------------------------------------------

function allowance(expected) {
  const battle = trainerBattle("OPP_BROCK", ["GEODUDE"], 77);
  const uses = expected;
  let acted = 0;
  for (let turn = 0; turn < uses + 3; turn++) {
    if (battle.phase !== State.PHASE_CHOOSE) { break; }
    battle.ctx.foe.active.status = Types.STATUS_PARALYSIS;
    battle.ctx.foe.active.hp = battle.ctx.foe.active.maxHp;  // never faint
    const report = battle.takeTurn(MOVE(0));
    if (report.messages.some((m) => m.indexOf("FULL HEAL") >= 0)) { acted++; }
  }
  return { acted, uses };
}

const spent = allowance(Ai.AI_CLASSES.OPP_BROCK.uses);
check("the trainer acts exactly its allowance and no more",
      spent.acted === spent.uses, "acted=" + spent.acted + " uses=" + spent.uses);

// ---------------------------------------------------------------------------
// 3. Switching. The Juggler's roll is a percentage, so this counts over a fixed
//    set of seeds instead of asserting on one.
// ---------------------------------------------------------------------------

function switchSweep() {
  let switched = 0;
  let battles = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const battle = trainerBattle("OPP_JUGGLER", ["DROWZEE", "KADABRA"], seed * 37, 2);
    battles++;
    const first = battle.ctx.foe.active.name;
    for (let turn = 0; turn < 6; turn++) {
      if (battle.phase !== State.PHASE_CHOOSE) { break; }
      battle.ctx.foe.active.hp = battle.ctx.foe.active.maxHp;
      const report = battle.takeTurn(MOVE(0));
      if (report.messages.some((m) => m.indexOf("withdrew") >= 0)) {
        if (battle.ctx.foe.active.name !== first) { switched++; }
        break;
      }
    }
  }
  return { switched, battles };
}

const swept = switchSweep();
check("a Juggler withdraws a Pokemon and a different one comes out",
      swept.switched > 0, "switched=" + swept.switched + "/" + swept.battles);

// ---------------------------------------------------------------------------
// 4. Healing HP. Agatha's Super Potion sits behind two rolls and an HP gate.
// ---------------------------------------------------------------------------

// The foe has to be FASTER than the player here. The AI acts at the enemy's slot
// in the turn order, so a player that one-shots a Pokemon sitting under the
// healing line ends the round before that slot is ever reached -- the sweep then
// reports zero and looks like a broken AI instead of a broken test.
function healSweep() {
  let healed = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const party = [mon("CHARMANDER", 5, seed * 91 + 1)];
    const foes = [mon("GASTLY", 50, seed * 91 + 10), mon("HAUNTER", 50, seed * 91 + 11)];
    const battle = State.startTrainerBattle(bundle, party, 0, foes, "OPP_AGATHA",
                                            seeded(seed * 91));
    for (let turn = 0; turn < 6; turn++) {
      if (battle.phase !== State.PHASE_CHOOSE) { break; }
      const active = battle.ctx.foe.active;
      active.hp = Math.max(1, Math.floor(active.maxHp / 4) - 1);
      battle.ctx.player.active.hp = battle.ctx.player.active.maxHp;
      const report = battle.takeTurn(MOVE(0));
      if (report.messages.some((m) => m.indexOf("recovered health") >= 0)) {
        healed++;
        break;
      }
    }
  }
  return healed;
}

check("Agatha spends a Super Potion on a Pokemon under the healing line",
      healSweep() > 0, "healed=0/120");

// ---------------------------------------------------------------------------
// 5. Wild battles have no trainer and must never reach any of this.
// ---------------------------------------------------------------------------

function wildSweep() {
  let lines = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const party = [mon("CHARMANDER", 30, seed)];
    const wild = mon("PIDGEY", 8, seed + 500);
    const battle = State.startWildBattle(bundle, party, 0, wild, seeded(seed * 13));
    for (let turn = 0; turn < 6; turn++) {
      if (battle.phase !== State.PHASE_CHOOSE) { break; }
      battle.ctx.foe.active.status = Types.STATUS_PARALYSIS;
      battle.ctx.foe.active.hp = 1;
      const report = battle.takeTurn(MOVE(0));
      if (report.messages.some((m) => m.indexOf("Enemy used ") >= 0 ||
                                      m.indexOf("withdrew") >= 0)) { lines++; }
    }
  }
  return lines;
}

check("a wild Pokemon never uses an item and never switches",
      wildSweep() === 0, "lines=" + wildSweep());

// ---------------------------------------------------------------------------
// 6. The player's own bag
//
// playerAction used to treat EVERY ACTION_ITEM as a ball throw, so reaching for
// a Potion threw it at the wild Pokemon. The heal path the trainer AI has always
// had is the same itemEffect table; a player's Potion and Brock's Potion are the
// same Potion, and it is transcribed once.
// ---------------------------------------------------------------------------

console.log("\n== The player's bag ==");
// The setup runs AFTER construction: a party with nothing healthy cannot start a
// battle at all, so a fainted-Pokemon case has to faint it once the battle is up.
// The foe is a level-3 Pidgey against a level-20 Charmander, so its attack is a
// couple of points -- enough to see, not enough to drown the effect being tested.
function usesItem(item, setup) {
  const party = [mon("CHARMANDER", 20, 55)];
  const battle = State.startWildBattle(bundle, party, 0, mon("PIDGEY", 3, 56), seeded(9));
  const before = { hp: 0, status: "" };
  if (setup) { setup(battle.ctx.player.active); }
  before.hp = battle.ctx.player.active.hp;
  before.status = battle.ctx.player.active.status;
  const report = battle.takeTurn({ kind: Types.ACTION_ITEM, moveIndex: -1,
                                   partyIndex: -1, item: item });
  return { battle, report, before, mon: battle.ctx.player.active };
}

{
  const hurt = usesItem("POTION", (m) => { m.hp = 1; });
  check("a Potion heals instead of being thrown",
        hurt.mon.hp > 1, "hp=" + hurt.mon.hp);
  // Not exactly twenty: using an item costs the turn, so the foe answers and
  // takes a couple back. Healed-then-hit is the behaviour, and a test that
  // demanded exactly twenty would be asserting that the foe never moved.
  check("by about twenty, less whatever the foe hit back for",
        hurt.mon.hp > hurt.before.hp + 14 && hurt.mon.hp <= hurt.before.hp + 20,
        `${hurt.before.hp} -> ${hurt.mon.hp}`);
  check("and no ball was thrown", hurt.report.ball === null,
        JSON.stringify(hurt.report.ball));

  const sick = usesItem("FULL_HEAL", (m) => { m.hp = 5; m.status = Types.STATUS_PARALYSIS; });
  check("a Full Heal clears status", sick.mon.status === Types.STATUS_NONE);
  check("and does not also heal", sick.mon.hp <= sick.before.hp,
        `${sick.before.hp} -> ${sick.mon.hp}`);

  const boosted = usesItem("X_ATTACK", null);
  check("an X Attack raises the stage", boosted.mon.stages.attack === 1,
        JSON.stringify(boosted.mon.stages));

  const fainted = usesItem("POTION", (m) => { m.hp = 0; });
  check("a Potion cannot revive a fainted Pokemon", fainted.mon.hp === 0,
        "that is what a Revive is for, and Gen 1 refuses it");

  // What the turn actually CONSUMED, which is not the same as "the turn was
  // legal". A caller that decrements the bag on report.ok deletes items that
  // healed nothing.
  const healed = usesItem("POTION", (m) => { m.hp = 1; });
  check("a Potion that heals is reported as consumed",
        healed.report.itemConsumed === "POTION", healed.report.itemConsumed);
  const wasted = usesItem("POTION", (m) => { m.hp = 0; });
  check("a Potion on a fainted Pokemon is NOT",
        wasted.report.ok === true && wasted.report.itemConsumed === "",
        `ok=${wasted.report.ok} consumed=${JSON.stringify(wasted.report.itemConsumed)}`);
  const useless = usesItem("BICYCLE", null);
  check("nor is an item with no battle effect",
        useless.report.itemConsumed === "", useless.report.itemConsumed);

  // Still a ball when it is a ball.
  const thrown = usesItem("POKE_BALL", null);
  check("a ball is still thrown", thrown.report.ball !== null,
        JSON.stringify(thrown.report.ball));

  // The turn is spent either way: reaching for a Potion at low HP is a gamble.
  const spent = usesItem("POTION", (m) => { m.hp = 1; });
  check("using an item costs the turn",
        spent.report.messages.some((l) => l.indexOf("POTION") >= 0),
        JSON.stringify(spent.report.messages.slice(0, 3)));
}

// ---------------------------------------------------------------------------
// selftest: unwire the AI and confirm the checks above go red.
// ---------------------------------------------------------------------------

if (selftest) {
  console.log("\n-- selftest: the same checks against an AI wired to nothing --");
  // aiClassFor reads AI_CLASSES; removing a row is exactly "this class is not
  // wired to anything". Every sweep above must notice.
  const savedBrock = Ai.AI_CLASSES.OPP_BROCK;
  delete Ai.AI_CLASSES.OPP_BROCK;
  const blind = brockHeals();
  const blindSpent = allowance(savedBrock.uses);
  Ai.AI_CLASSES.OPP_BROCK = savedBrock;
  check("[selftest] removing Brock's class stops the heal",
        blind.after === Types.STATUS_PARALYSIS &&
        !blind.report.messages.some((m) => m.indexOf("FULL HEAL") >= 0),
        "the heal checks pass with the AI unwired -- they prove nothing");
  check("[selftest] and the allowance check notices too",
        blindSpent.acted === 0, "acted=" + blindSpent.acted);

  const savedJuggler = Ai.AI_CLASSES.OPP_JUGGLER;
  delete Ai.AI_CLASSES.OPP_JUGGLER;
  const blindSwept = switchSweep();
  Ai.AI_CLASSES.OPP_JUGGLER = savedJuggler;
  check("[selftest] removing the Juggler's class stops the switching",
        blindSwept.switched === 0, "switched=" + blindSwept.switched);

  const savedAgatha = Ai.AI_CLASSES.OPP_AGATHA;
  delete Ai.AI_CLASSES.OPP_AGATHA;
  const blindHealed = healSweep();
  Ai.AI_CLASSES.OPP_AGATHA = savedAgatha;
  check("[selftest] removing Agatha's class stops the potion",
        blindHealed === 0, "healed=" + blindHealed);
}

// ---------------------------------------------------------------------------
// 5. What the cartridge calls the trainer. The bundle carries the class names
//    (JR.TRAINER\u2642, BROCK); the battle must print those, never the OPP_ id, and
//    the rival's three classes print the rival's given name.
// ---------------------------------------------------------------------------

{
  const names = { player: "ASH", rival: "GARY" };
  const jr = State.startTrainerBattle(bundle, [mon("CHARMANDER", 12, 5)], 0,
                                      [mon("DIGLETT", 12, 6)], "OPP_JR_TRAINER_M",
                                      seeded(77), names);
  const opening = jr.log.join(" | ").split("\n").join(" ");
  check("the sent-out line names the trainer class",
        opening.indexOf("JR.TRAINER\u2642 sent out DIGLETT!") >= 0, opening);
  check("and never the raw id", opening.indexOf("OPP_") < 0, opening);

  const rival = State.startTrainerBattle(bundle, [mon("CHARMANDER", 12, 5)], 0,
                                         [mon("SQUIRTLE", 12, 6)], "OPP_RIVAL1",
                                         seeded(78), names);
  const rivalOpening = rival.log.join(" | ").split("\n").join(" ");
  check("the rival's class prints the rival's name",
        rivalOpening.indexOf("GARY sent out SQUIRTLE!") >= 0, rivalOpening);
  const plain = trainerBattle("OPP_RIVAL2", ["PIDGEOTTO"], 79);
  check("without names the rival is still not an OPP_ id",
        plain.log.join(" ").indexOf("RIVAL sent") >= 0, plain.log.join(" | "));
  check("an item the trainer uses is named as the cartridge names it",
        heal.report.messages.some((m) => m.indexOf("BROCK used FULL HEAL!") >= 0),
        JSON.stringify(heal.report.messages));
}

// ---------------------------------------------------------------------------
// 6. The class's move-choice modifications are actually applied. Misty's list
//    is [1, 3]; layer 3 takes one off a super-effective move, and the minimum
//    is chosen, so her Staryu (TACKLE, WATER GUN) opens with WATER GUN against
//    a CHARMANDER every single time. Without the list it is a coin toss, and
//    until 17 September the battle passed an empty list for every trainer.
// ---------------------------------------------------------------------------

{
  // Misty's item AI spends an X DEFEND on a quarter of first turns; those turns
  // choose no move at all and are left out, so the count is over move turns.
  let moveTurns = 0;
  let waterGuns = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const battle = State.startTrainerBattle(bundle, [mon("CHARMANDER", 20, seed * 7 + 1)], 0,
                                            [mon("STARYU", 18, seed * 7 + 2)], "OPP_MISTY",
                                            seeded(seed * 7));
    const report = battle.takeTurn(MOVE(1));
    const used = report.messages.filter((m) => m.indexOf("Enemy STARYU\nused") >= 0);
    if (used.length === 0) { continue; }
    moveTurns++;
    if (used[0].indexOf("WATER GUN") >= 0) { waterGuns++; }
  }
  check("Staryu chose a move on most first turns", moveTurns >= 12, moveTurns + " move turns");
  check("Misty's layer 3 opens with the super-effective move every time",
        waterGuns === moveTurns, waterGuns + " of " + moveTurns);
}

console.log("\n" + passed + " PASS  " + failed + " FAIL");
process.exit(failed === 0 ? 0 : 1);
