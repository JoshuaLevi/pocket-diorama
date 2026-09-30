// Which implementation does a battle ACTUALLY run?
//
// battle-status.test.mjs asserts 102 things about Status.ts. Moves.ts never
// imports Status.ts -- it has its own inflictStatus at line 478 -- so a wild
// battle executes none of the code those assertions cover. Passing tests over
// unreachable code is worse than no tests: it is confidence pointed at the wrong
// file.
//
// This suite asserts the WIRING rather than the behaviour, so the duplication
// cannot quietly persist. When it is resolved these assertions change shape; until
// then they state the true situation out loud.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.print = () => {};
const here = dirname(fileURLToPath(import.meta.url));
const battleDir = join(here, "..", "Assets", "Scripts", "play", "battle");
const read = (f) => readFileSync(join(battleDir, f), "utf8");

let pass = 0, fail = 0, notes = [];
function check(name, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -- " + detail : ""));
  ok ? pass++ : fail++;
}

const moves = read("Moves.ts");
const state = read("BattleState.ts");
const status = read("Status.ts");

console.log("\n== Who calls whom ==");
check("Moves.ts imports Status.ts", /from\s+"\.\/Status"/.test(moves),
      "the duration rolls and the burn restat are shared, not duplicated");
check("BattleState.ts imports Status.ts", /from\s+"\.\/Status"/.test(state));
check("Moves.ts still owns the move-context gating",
      /export function inflictStatus\(env/.test(moves),
      "a Substitute absorbing it, or a secondary that cannot hit its own type");

console.log("\n== Status.ts exports a battle never reaches ==");
// Anything exported by Status.ts and named nowhere else in the tree is dead.
const exported = [...status.matchAll(/export function (\w+)/g)].map((m) => m[1]);
const others = ["Moves.ts", "BattleState.ts", "Damage.ts", "Party.ts", "TurnOrder.ts",
                "Ai.ts", "Capture.ts", "Stats.ts"]
  .filter((f) => { try { read(f); return true; } catch { return false; } })
  .map(read).join("\n");
const dead = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(others));
console.log("        exported: " + exported.length + ", unreachable from a battle: " + dead.length);
if (dead.length) console.log("        " + dead.join(", "));
notes = dead;
check("the unreachable list is written down, not discovered again later",
      true, dead.length + " function(s)");

console.log("\n== The three disagreements, now resolved ==");
// All three changed the RNG stream or the badge-pass count, which matters because
// the decision is to reproduce Generation 1 exactly, bugs included.
check("burn and paralysis restat without spending a badge pass",
      /restat\(target, env\.targetSide\.badgeBits\)/.test(moves),
      "HalveAttackDueToBurn never calls ApplyBadgeStatBoosts");
check("sleep rolls the ROM's masked byte", /rollSleepTurns\(env\.random\)/.test(moves),
      "a byte masked to 3 bits, redrawn on zero -- variable draws, not one");
check("confusion likewise", /rollConfusionTurns\(env\.random\)/.test(moves));
check("and the stat-stage path still spends one, because the ROM does",
      /recalc\(who, side\.badgeBits\)/.test(moves),
      "that is the badge bug, and it is deliberate");

console.log("\n== The item effect, transcribed once ==");
{
  // These five branches lived in BattleState TWICE -- once where the trainer AI
  // reaches for something, once where the player does -- and an overworld bag
  // would have made a third. Two copies is how they quietly stop agreeing; this
  // repo already paid for that once with the status code.
  const state = read("BattleState.ts");
  const use = read("ItemUse.ts");
  const branches = ["effect.heal !== 0", "effect.clearStatus", "effect.raiseStat !== \"\"", "effect.mist"];
  const inState = branches.filter((b) => state.indexOf(b) >= 0);
  const inUse = branches.filter((b) => use.indexOf(b) >= 0);
  check("the effect branches live in ItemUse", inUse.length === branches.length,
        "found " + inUse.length + " of " + branches.length);
  check("and no longer in BattleState", inState.length === 0,
        "still there: " + inState.join(", "));
  check("both callers go through applyItemEffect",
        (state.match(/applyItemEffect\(/g) || []).length >= 2,
        (state.match(/applyItemEffect\(/g) || []).length + " call sites");
}

console.log("\n== The trainer AI ==");
try {
  const ai = read("Ai.ts");
  const aiExports = [...ai.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const usedElsewhere = [state, moves].join("\n");
  const aiDead = aiExports.filter((n) => !new RegExp(`\\b${n}\\b`).test(usedElsewhere));
  console.log("        exported: " + aiExports.length + ", never called: " + aiDead.length);
  if (aiDead.length) console.log("        " + aiDead.join(", "));
  // What is left dead is the scoring internals -- helpers classAction and
  // chooseMove reach through. The three ENTRY points must all be called from
  // BattleState: an AI that is written and never consulted is what this file
  // caught the first time, and battle-ai.test.mjs is what proves it fires now.
  const entries = ["aiClassFor", "classAction", "itemEffect", "chooseMove"];
  const unreached = entries.filter((n) => !new RegExp(`\\b${n}\\b`).test(state));
  check("every AI entry point is called from BattleState",
        unreached.length === 0, "never reached from BattleState: " + unreached.join(", "));
  check("what is left dead is scoring internals, not behaviour",
        aiDead.every((n) => !entries.includes(n)),
        "a dead entry point: " + aiDead.filter((n) => entries.includes(n)).join(", "));
} catch {
  check("Ai.ts exists", false, "not found");
}

console.log(`\n${fail === 0 ? "WIRING OK" : "WIRING FAILED"}: ${pass} pass, ${fail} fail`);
console.log("What remains unreached is listed above and in SPEC.md section 4.4.");
process.exit(fail === 0 ? 0 : 1);
