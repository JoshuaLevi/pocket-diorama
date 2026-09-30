// Teaching a TM or an HM, played by hand.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/teach.test.mjs Assets/Generated/kanto.json [--selftest]
//
// This is the on-ramp for every field move: HM01 is handed over on the S.S.
// Anne and until now there was no way to put CUT into a Pokemon, so the whole
// HM system was a road nothing could reach.
//
// Driven the way shop.test drives the mart: one button edge per call, idle
// frames between, against the real item table, the real per-species TM/HM
// bitfields and the cartridge's own lines.

import { readFileSync } from "node:fs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: teach.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const T = await import(P + "TeachController.ts");
const L = await import(P + "MoveLearnController.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { replaceMove, knowsMove } = await import(P + "battle/Party.ts");
const { emptyDPad } = await import(P + "InputSource.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

const NONE = emptyDPad();
const DT = 0.016;
function pad(dir) {
  const p = emptyDPad();
  p[dir] = true;
  return p;
}

const mon = (species, level, seed) => makeWildMon(bundle, species, level, () => (seed === undefined ? 0.5 : seed));

/** A Pokemon with exactly `moves` in its slots. */
function withMoves(species, level, moves) {
  let m = mon(species, level);
  for (let i = 0; i < moves.length; i++) {
    m = replaceMove(bundle, m, i, moves[i]).mon;
  }
  m.moves = m.moves.slice(0, Math.max(moves.length, 1));
  return m;
}

/** A driver that presses like a person. */
function player(screen) {
  const step = (p, a, b) => screen.step(p || NONE, !!a, !!b, DT);
  const seen = [];
  return {
    seen,
    a: () => step(NONE, true, false),
    b: () => step(NONE, false, true),
    tap: (dir) => {
      const r = step(pad(dir), false, false);
      for (let i = 0; i < 40; i++) { step(NONE, false, false); }
      return r;
    },
    idle: (n) => { for (let i = 0; i < (n || 1); i++) { step(NONE, false, false); } },
    /** A through every page of the message on screen. */
    read: () => {
      let n = 0;
      while (screen.isOpen() && screen.lines() !== null && !screen.asking() &&
             screen.rows().length === 0 && n < 20) {
        seen.push(screen.lines().join(" "));
        step(NONE, true, false);
        n++;
      }
      if (screen.isOpen() && screen.lines() !== null) { seen.push(screen.lines().join(" ")); }
    },
    said: () => seen.join(" | "),
  };
}

function bagCount(state, id) {
  for (let i = 0; i < state.bag.length; i++) { if (state.bag[i].id === id) { return state.bag[i].count; } }
  return 0;
}

function stage(party, item) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = party;
  state.bag = [{ id: item, count: 1 }, { id: "POTION", count: 1 }];
  return { state, teach: new T.TeachController(bundle, state, item) };
}

// ---------------------------------------------------------------------------
console.log("\n== THE JOIN: HM01 puts CUT into a Pokemon ==");
function teachCut(opts) {
  const o = opts || {};
  const s = stage([withMoves("CHARMANDER", 12, ["SCRATCH", "GROWL"])], "HM_CUT");
  const me = player(s.teach);
  me.read();
  check("an HM says it booted up an HM", me.said().indexOf("HM") >= 0, me.said());
  check("then asks, naming the move it holds",
        s.teach.asking() && s.teach.rows().join(",") === "YES,NO" &&
        me.said().indexOf("CUT") >= 0, me.said() + " / " + s.teach.rows().join(","));
  me.a();                                          // YES
  check("the party list comes up with the cartridge's own question",
        s.teach.rows()[0].indexOf("CHARMANDER") >= 0 &&
        s.teach.lines().join(" ").indexOf("which") >= 0,
        JSON.stringify([s.teach.rows(), s.teach.lines()]));
  me.a();                                          // CHARMANDER
  me.read();
  check("it learns CUT into its first free slot",
        knowsMove(s.state.party[0], "CUT") === true &&
        s.state.party[0].moves[2].id === "CUT" &&
        s.state.party[0].moves[2].pp === bundle.moves.CUT.pp,
        JSON.stringify(s.state.party[0].moves.map((m) => m.id)));
  check("and is told so by name", me.said().indexOf("learned") >= 0, me.said());
  check("the HM stays in the bag -- an HM is never used up",
        bagCount(s.state, "HM_CUT") === 1 && s.teach.consumed() === false);
  check("and the screen is finished", s.teach.isOpen() === false);
  return s;
}
teachCut();

// ---------------------------------------------------------------------------
console.log("\n== A TM ==");
{
  const s = stage([withMoves("CHARMANDER", 12, ["SCRATCH", "GROWL", "EMBER"])], "TM_BIDE");
  const me = player(s.teach);
  me.read();
  check("a TM says it booted up a TM", me.said().indexOf("TM") >= 0, me.said());
  me.a();
  me.a();
  me.read();
  check("the move lands in the fourth slot at full PP",
        s.state.party[0].moves[3].id === "BIDE" &&
        s.state.party[0].moves[3].pp === bundle.moves.BIDE.pp,
        JSON.stringify(s.state.party[0].moves.map((m) => m.id)));
  check("and the TM is gone", bagCount(s.state, "TM_BIDE") === 0 && s.teach.consumed() === true);

  // NO at the question leaves everything alone.
  const no = stage([withMoves("CHARMANDER", 12, ["SCRATCH"])], "TM_BIDE");
  const nome = player(no.teach);
  nome.read();
  nome.tap("down");
  nome.a();                                        // NO
  check("saying no closes it and keeps the TM",
        no.teach.isOpen() === false && bagCount(no.state, "TM_BIDE") === 1 &&
        knowsMove(no.state.party[0], "BIDE") === false);

  // B on the party list is the same.
  const backOut = stage([withMoves("CHARMANDER", 12, ["SCRATCH"])], "TM_BIDE");
  const bme = player(backOut.teach);
  bme.read();
  bme.a();
  bme.b();
  check("B on the party list closes it and keeps the TM",
        backOut.teach.isOpen() === false && bagCount(backOut.state, "TM_BIDE") === 1 &&
        knowsMove(backOut.state.party[0], "BIDE") === false);
}

// ---------------------------------------------------------------------------
console.log("\n== What it refuses ==");
{
  // CATERPIE's TM/HM bitfield does not carry BIDE.
  const s = stage([withMoves("CATERPIE", 8, ["TACKLE"]),
                   withMoves("CHARMANDER", 12, ["SCRATCH"])], "TM_BIDE");
  const me = player(s.teach);
  me.read();
  me.a();
  me.a();                                          // CATERPIE
  me.read();
  check("an incompatible species is told so, by name and by move",
        me.said().indexOf("CATERPIE") >= 0 && me.said().indexOf("BIDE") >= 0 &&
        me.said().indexOf("{RAM:") < 0, me.said());
  check("the list comes back and the TM is still there",
        s.teach.isOpen() === true && s.teach.rows()[0].indexOf("CATERPIE") >= 0 &&
        bagCount(s.state, "TM_BIDE") === 1, JSON.stringify(s.teach.rows()));
  me.tap("down");
  me.a();                                          // CHARMANDER
  me.read();
  check("and the next one along can still learn it",
        knowsMove(s.state.party[1], "BIDE") === true && bagCount(s.state, "TM_BIDE") === 0);

  const known = stage([withMoves("CHARMANDER", 12, ["BIDE", "SCRATCH"])], "TM_BIDE");
  const kme = player(known.teach);
  kme.read();
  kme.a();
  kme.a();
  kme.read();
  check("a Pokemon that already knows it is told so",
        kme.said().indexOf("knows") >= 0 && known.teach.isOpen() === true &&
        bagCount(known.state, "TM_BIDE") === 1, kme.said());
}

// ---------------------------------------------------------------------------
console.log("\n== Four moves already ==");
{
  const full = () => stage([withMoves("CHARMANDER", 25, ["SCRATCH", "GROWL", "EMBER", "LEER"])], "TM_BIDE");

  // Abandon it.
  const quit = full();
  const qme = player(quit.teach);
  qme.read();
  qme.a();
  qme.a();
  qme.read();
  check("the trying-to-learn question names the Pokemon and the move",
        qme.said().indexOf("CHARMANDER") >= 0 && qme.said().indexOf("BIDE") >= 0 &&
        qme.said().indexOf("{RAM:") < 0 && quit.teach.asking() === true, qme.said());
  qme.tap("down");
  qme.a();                                         // NO -> abandon?
  qme.read();
  check("saying no asks whether to abandon it", quit.teach.asking() === true &&
        qme.said().indexOf("Abandon") >= 0, qme.said());
  qme.a();                                         // YES, abandon
  qme.read();
  check("and it did not learn it",
        quit.teach.isOpen() === false && knowsMove(quit.state.party[0], "BIDE") === false &&
        bagCount(quit.state, "TM_BIDE") === 1 && qme.said().indexOf("did not learn") >= 0,
        qme.said());

  // Say no to abandoning: back to the same question.
  const again = full();
  const ame = player(again.teach);
  ame.read();
  ame.a();
  ame.a();
  ame.read();
  ame.tap("down");
  ame.a();                                         // NO
  ame.read();
  ame.tap("down");
  ame.a();                                         // NO to abandoning
  ame.read();
  check("saying no to abandoning comes back to the same question",
        again.teach.isOpen() === true && again.teach.asking() === true &&
        ame.said().indexOf("trying to learn") >= 0, ame.said());

  // Pick a move to forget.
  const swap = full();
  const sme = player(swap.teach);
  sme.read();
  sme.a();
  sme.a();
  sme.read();
  sme.a();                                         // YES, delete one
  check("the four moves are offered, with the forget question in the box",
        swap.teach.rows().join(",") === "SCRATCH,GROWL,EMBER,LEER" &&
        swap.teach.lines().join(" ").indexOf("forgotten") >= 0,
        JSON.stringify([swap.teach.rows(), swap.teach.lines()]));
  sme.tap("down");
  sme.a();                                         // GROWL
  sme.read();
  check("'1, 2 and... Poof!' and then the swap, named both ways",
        sme.said().indexOf("Poof") >= 0 && sme.said().indexOf("forgot") >= 0 &&
        sme.said().indexOf("GROWL") >= 0 && sme.said().indexOf("BIDE") >= 0,
        sme.said());
  check("the new move is in the slot the old one had",
        swap.state.party[0].moves[1].id === "BIDE" &&
        swap.state.party[0].moves[1].pp === bundle.moves.BIDE.pp &&
        knowsMove(swap.state.party[0], "GROWL") === false,
        JSON.stringify(swap.state.party[0].moves.map((m) => m.id)));
  check("and the TM is spent", bagCount(swap.state, "TM_BIDE") === 0);

  // An HM move cannot be deleted.
  const hm = stage([withMoves("CHARMANDER", 25, ["SCRATCH", "CUT", "EMBER", "LEER"])], "TM_BIDE");
  const hme = player(hm.teach);
  hme.read();
  hme.a();
  hme.a();
  hme.read();
  hme.a();                                         // YES
  hme.tap("down");
  hme.a();                                         // CUT
  hme.read();
  check("an HM move is refused, and the list comes back",
        hme.said().indexOf("HM") >= 0 && hme.said().indexOf("deleted") >= 0 &&
        hm.teach.rows().join(",") === "SCRATCH,CUT,EMBER,LEER",
        hme.said() + " / " + hm.teach.rows().join(","));
  check("nothing was learned and nothing was spent",
        knowsMove(hm.state.party[0], "BIDE") === false && bagCount(hm.state, "TM_BIDE") === 1);

  // B on the move list is the abandon question.
  const bail = full();
  const bme = player(bail.teach);
  bme.read();
  bme.a();
  bme.a();
  bme.read();
  bme.a();
  bme.b();
  bme.read();
  check("B on the move list asks whether to abandon it",
        bail.teach.asking() === true && bme.said().indexOf("Abandon") >= 0, bme.said());
}

// ---------------------------------------------------------------------------
console.log("\n== Columns ==");
{
  const s = stage([withMoves("CHARMANDER", 25, ["SCRATCH", "GROWL", "EMBER", "LEER"]),
                   mon("BULBASAUR", 30)], "TM_BIDE");
  const me = player(s.teach);
  me.read();
  me.a();
  const wide = s.teach.rows().filter((r) => r.length > 17);
  check("every party row fits the seventeen columns a row has",
        wide.length === 0, JSON.stringify(s.teach.rows().map((r) => r.length)));
}

// ---------------------------------------------------------------------------
if (selftest) {
  console.log("\n-- selftest --");
  function failsWith(run) {
    quiet = true;
    quietFails = 0;
    try { run(); } catch (e) { quietFails++; }
    quiet = false;
    return quietFails;
  }

  // A player who never presses anything must never learn or spend anything.
  const idle = stage([withMoves("CHARMANDER", 12, ["SCRATCH"])], "TM_BIDE");
  for (let i = 0; i < 500; i++) { idle.teach.step(NONE, false, false, DT); }
  check("[selftest] an idle player never learns or spends anything",
        knowsMove(idle.state.party[0], "BIDE") === false &&
        bagCount(idle.state, "TM_BIDE") === 1 && idle.teach.isOpen() === true);

  // A controller that never writes the party back is caught by the join.
  const realChose = T.TeachController.prototype.step;
  check("[selftest] the real wiring passes the same quiet run",
        failsWith(() => teachCut()) === 0);
  check("[selftest] an HM that consumes itself would be caught",
        failsWith(() => {
          const s = stage([withMoves("CHARMANDER", 12, ["SCRATCH", "GROWL"])], "HM_CUT");
          s.state.bag = [];
          const me = player(s.teach);
          me.read(); me.a(); me.a(); me.read();
          check("the HM stays in the bag -- an HM is never used up",
                bagCount(s.state, "HM_CUT") === 1);
        }) > 0);
  check("[selftest] step() is the only way in", typeof realChose === "function");
}

console.log(`\n${fail === 0 ? "TEACH OK" : "TEACH FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
