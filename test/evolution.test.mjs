// Evolution: who is due, what evolving does, and the sequence that asks.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/evolution.test.mjs Assets/Generated/kanto.json [--selftest]
//
// What this proves and what it does not. The rules and the sequence are pure
// and are tested here against the real cartridge's own numbers and words. The
// SCENE wiring in PokemonAR -- which surface the page lands on, when the frame
// is handed over -- is not: it needs a lens, and the only checks it has are the
// compiler and playing it. The last section walks the same recipe PokemonAR
// walks, in the same order, so at least the recipe is not guesswork.

const bundlePath = process.argv[2] || "Assets/Generated/kanto.json";
const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};
globalThis.getTime = () => 0;

const { readFileSync } = await import("node:fs");
const P = "../Assets/Scripts/play/";
const E = await import(P + "battle/Evolution.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { computeStats } = await import(P + "battle/Stats.ts");
const Party = await import(P + "battle/Party.ts");
const { EvolutionController, EVOLVE_CLOSED, EVOLVE_NONE } =
  await import(P + "EvolutionController.ts");
const { MoveLearnController, LEARN_CLOSED } = await import(P + "MoveLearnController.ts");

let bundle = null;
try {
  bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
} catch (e) {
  console.log("EVOLUTION SKIP: no bundle at " + bundlePath);
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

const NO_PAD = { up: false, down: false, left: false, right: false };
function seeded(n) {
  return () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
}
function mon(species, level, seed) {
  return makeWildMon(bundle, species, level, seeded(seed === undefined ? 7 : seed));
}

console.log("=== who is due ===");
{
  check("a CHARMANDER below 16 is not", E.evolvesInto(bundle, mon("CHARMANDER", 15)) === "");
  check("at 16 it is", E.evolvesInto(bundle, mon("CHARMANDER", 16)) === "CHARMELEON");
  check("and above it still is", E.evolvesInto(bundle, mon("CHARMANDER", 30)) === "CHARMELEON");
  check("a CHARMELEON at 16 is not due for CHARIZARD",
        E.evolvesInto(bundle, mon("CHARMELEON", 16)) === "");
  check("but at 36 it is", E.evolvesInto(bundle, mon("CHARMELEON", 36)) === "CHARIZARD");

  // A stone Pokemon must never evolve on its own, however high its level. EEVEE
  // carries three ITEM evolutions with a level of 1, which a rule that only
  // looked at the level would fire on immediately.
  check("EEVEE does not evolve by levelling", E.evolvesInto(bundle, mon("EEVEE", 60)) === "");
  check("nor does something with no evolutions at all",
        E.evolvesInto(bundle, mon("TAUROS", 60)) === "");

  const party = [mon("CHARMANDER", 16), mon("PIDGEY", 5), mon("CATERPIE", 9)];
  const due = E.evolutionsDue(bundle, party);
  check("a party reports each one due", due.length === 2, JSON.stringify(due));
  check("in party order and by slot",
        due[0].index === 0 && due[0].to === "CHARMELEON" &&
        due[1].index === 2 && due[1].to === "METAPOD", JSON.stringify(due));

  // The cartridge walks the party after the battle and skips anything at zero,
  // so a party that was wiped evolves nobody.
  const fainted = [mon("CHARMANDER", 16)];
  fainted[0].hp = 0;
  check("a fainted Pokemon does not evolve", E.evolutionsDue(bundle, fainted).length === 0);
  check("an empty party is not an error", E.evolutionsDue(bundle, []).length === 0);
  check("nor is no party at all", E.evolutionsDue(bundle, null).length === 0);
}

console.log("=== what evolving does ===");
{
  const before = mon("CHARMANDER", 16);
  const after = E.evolve(bundle, before, "CHARMELEON");
  check("the species changes", after.species === "CHARMELEON");
  check("and so does the name of an un-nicknamed one", after.name === "CHARMELEON");
  check("the level does not", after.level === before.level);
  check("the types come from the new species",
        after.types.join(",") === bundle.species.CHARMELEON.types.join(","),
        after.types.join(","));

  const expected = computeStats(bundle.species.CHARMELEON.baseStats,
                                before.ivs, before.evs, before.level);
  check("the stats are the new species', at the same level and DVs",
        JSON.stringify(after.stats) === JSON.stringify(expected),
        JSON.stringify(after.stats) + " vs " + JSON.stringify(expected));
  check("maxHp follows", after.maxHp === expected.hp);

  check("what it kept: moves, exp, DVs and stat experience",
        after.moves === before.moves && after.exp === before.exp &&
        after.ivs === before.ivs && after.evs === before.evs);
  check("the Pokemon handed in is untouched",
        before.species === "CHARMANDER" && before.maxHp !== after.maxHp);

  // Not healed, and not left at a maximum it no longer has: EvolveMon adds the
  // GAIN in maximum HP to the current value.
  const hurt = mon("CHARMANDER", 16);
  const gain = expected.hp - hurt.stats.hp;
  hurt.hp = 1;
  const healed = E.evolve(bundle, hurt, "CHARMELEON");
  check("a hurt Pokemon keeps its damage", healed.hp === 1 + gain,
        healed.hp + " of " + healed.maxHp + ", gain " + gain);
  check("and is not full", healed.hp < healed.maxHp);
  check("the gain is real", gain > 0, gain);

  const nicknamed = mon("CHARMANDER", 16);
  nicknamed.name = "SPARKY";
  check("a nickname survives", E.evolve(bundle, nicknamed, "CHARMELEON").name === "SPARKY");

  check("an unknown species hands the Pokemon straight back",
        E.evolve(bundle, before, "NOT_A_SPECIES") === before);
}

console.log("=== the moves an evolution brings ===");
{
  // Measured against the cartridge: four species learn something at exactly the
  // level they evolve at, and the cartridge teaches it on the same breath.
  check("GYARADOS learns BITE at 20",
        E.movesOnEvolution(bundle, "GYARADOS", 20).join(",") === "BITE");
  check("KADABRA learns CONFUSION at 16",
        E.movesOnEvolution(bundle, "KADABRA", 16).join(",") === "CONFUSION");
  check("CHARMELEON learns nothing at 16",
        E.movesOnEvolution(bundle, "CHARMELEON", 16).length === 0);
  check("an unknown species learns nothing rather than throwing",
        E.movesOnEvolution(bundle, "NOT_A_SPECIES", 5).length === 0);
}

console.log("=== the sequence, in the cartridge's words ===");
{
  function run(presses) {
    const c = new EvolutionController(bundle, "MAGIKARP", "GYARADOS");
    const seen = [];
    let outcome = EVOLVE_NONE;
    for (let i = 0; i < presses.length && outcome !== EVOLVE_CLOSED; i++) {
      seen.push(c.lines().join(" "));
      outcome = c.step(NO_PAD, presses[i] === "a", presses[i] === "b", 1 / 60);
    }
    seen.push(c.lines().join(" "));
    return { c, seen, outcome };
  }

  const letIt = run(["a", "a", "a", "a"]);
  check("it opens on the cartridge's own line",
        letIt.seen[0].indexOf("is evolving") >= 0, letIt.seen[0]);
  check("naming the Pokemon", letIt.seen[0].indexOf("MAGIKARP") >= 0, letIt.seen[0]);
  check("A lets it happen", letIt.c.evolved() === true);
  check("and it says what it became",
        letIt.seen.join(" | ").indexOf("GYARADOS") >= 0, letIt.seen.join(" | "));
  check("and that it evolved",
        letIt.seen.join(" | ").indexOf("evolved") >= 0, letIt.seen.join(" | "));
  check("then closes", letIt.outcome === EVOLVE_CLOSED && !letIt.c.isOpen());

  const stopped = run(["b", "a", "a", "a"]);
  check("B stops it", stopped.c.evolved() === false);
  check("and says so in the cartridge's words",
        stopped.seen.join(" | ").indexOf("stopped evolving") >= 0, stopped.seen.join(" | "));
  check("naming the Pokemon that did not", 
        stopped.seen.join(" | ").indexOf("MAGIKARP") >= 0);
  check("it still closes", stopped.outcome === EVOLVE_CLOSED);
  check("and never mentions what it would have become",
        stopped.seen.join(" | ").indexOf("GYARADOS") < 0, stopped.seen.join(" | "));

  check("nothing is a menu here", new EvolutionController(bundle, "A", "B").rows().length === 0);
}

console.log("=== the recipe, as the lens walks it ===");
{
  // The same order PokemonAR uses: evolve, then every move the NEW species
  // learns at this level, prompting when there is no room. A MAGIKARP with four
  // moves evolving into a GYARADOS at 20 is the case that exercises all of it.
  const party = [mon("MAGIKARP", 20)];
  party[0].moves = [
    { id: "SPLASH", pp: 40, maxPp: 40 },
    { id: "TACKLE", pp: 35, maxPp: 35 },
    { id: "TAIL_WHIP", pp: 30, maxPp: 30 },
    { id: "GROWL", pp: 40, maxPp: 40 },
  ];
  const due = E.evolutionsDue(bundle, party);
  check("MAGIKARP at 20 is due", due.length === 1 && due[0].to === "GYARADOS");

  const c = new EvolutionController(bundle, party[0].name, due[0].to);
  let guard = 0;
  while (c.isOpen() && guard < 20) {
    c.step(NO_PAD, true, false, 1 / 60);
    guard++;
  }
  check("the sequence finishes", !c.isOpen(), guard + " presses");
  check("and allowed it", c.evolved());

  party[0] = E.evolve(bundle, party[0], due[0].to);
  check("the party slot is a GYARADOS", party[0].species === "GYARADOS");

  const offered = E.movesOnEvolution(bundle, "GYARADOS", party[0].level);
  check("which is offered BITE", offered.join(",") === "BITE");

  const learned = Party.learnMove(bundle, party[0], offered[0]);
  check("a full moveset has no room for it",
        learned.outcome === Party.LEARN_NEEDS_ROOM, learned.outcome);

  const prompt = new MoveLearnController(bundle, party[0], offered[0]);
  // YES to the delete question, then the first move in the list.
  let out = EVOLVE_NONE;
  guard = 0;
  while (prompt.decision() === -2 && guard < 40) {
    out = prompt.step(NO_PAD, true, false, 1 / 60);
    guard++;
  }
  check("the prompt reaches a decision", prompt.decision() >= 0, prompt.decision());
  const slot = prompt.decision();
  const replaced = Party.replaceMove(bundle, party[0], slot, offered[0]);
  party[0] = replaced.mon;
  const moves = party[0].moves.map((m) => m.id);
  check("BITE is in the slot the player chose", moves[slot] === "BITE", moves.join(","));
  check("and the moveset is still four long", moves.length === 4, moves.join(","));
  check("at full PP", party[0].moves[slot].pp === bundle.moves.BITE.pp);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label); }
  }
  expectFailures("a stone Pokemon evolving on its own would be caught", () => {
    check("stone detector", E.evolvesInto(bundle, mon("EEVEE", 60)) !== "");
  });
  expectFailures("an evolution that healed would be caught", () => {
    const hurt = mon("CHARMANDER", 16);
    hurt.hp = 1;
    check("heal detector", E.evolve(bundle, hurt, "CHARMELEON").hp >= hurt.maxHp);
  });
}

console.log("");
console.log("EVOLUTION  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
