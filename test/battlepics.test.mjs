// The two Pokemon on the field: their own colours, and a body behind the sketch.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlepics.test.mjs Assets/Generated/kanto.json
//
// Gen 1's back pictures are open-line sketches drawn for a white screen; the
// flood matte hollowed them into lace over the diorama floor. BodyMatte closes
// the outline's gaps and keeps the outside out. And every species has a Super
// Game Boy palette of its own (MonsterPalettes) that the bundle used to drop,
// so Charmander fought in the map's greens.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("usage: battlepics.test.mjs <bundle.json>");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.getTime = () => 0;

const { fillBody } = await import("../Assets/Scripts/rom/BodyMatte.ts");
const { unpackMask } = await import("../Assets/Scripts/world/WorldData.ts");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail ? "\n          " + detail : ""));
}

// ---------------------------------------------------------------------------
// 1. The fill on drawn masks
// ---------------------------------------------------------------------------
console.log("== the body fill ==");
{
  const grid = (rows) => {
    const w = rows[0].length;
    const out = new Uint8Array(w * rows.length);
    rows.forEach((r, y) => { for (let x = 0; x < w; x++) out[y * w + x] = r[x] === "#" ? 1 : 0; });
    return { mask: out, w, h: rows.length };
  };
  const text = (mask, w, h) => {
    const lines = [];
    for (let y = 0; y < h; y++) { let s = ""; for (let x = 0; x < w; x++) s += mask[y * w + x] ? "#" : "."; lines.push(s); }
    return lines;
  };
  // A box whose outline has gaps of one, three and five pixels: the flood has
  // been through every one of them; the body comes back whole.
  const dashed = grid([
    "..............",
    ".####.###.###.",
    ".#..........#.",
    "............#.",
    ".#............",
    ".#..........#.",
    "............#.",
    ".#..........#.",
    ".##.....#####.",
    "..............",
  ]);
  const got = text(fillBody(dashed.mask, dashed.w, dashed.h), dashed.w, dashed.h);
  // The missing outline pixels themselves stay white-on-nothing: they are one
  // step from the outside. Everything behind them is body.
  check("the inside of a dashed outline is body", got[2] === ".############." && got[5] === ".############.", got.join("\n"));
  check("a one-pixel gap closes flush", got[3] === "..###########." && got[4] === ".###########..", got.join("\n"));
  // A five-pixel gap lets the outside dent the body, no deeper than BODY_GAP.
  check("a wide gap dents the body and no more", got[6] === "..###.#######." && got[7] === ".###...######.", got.join("\n"));
  check("the frame around it stays open", got[0] === ".............." && got[9] === "..............", got.join("\n"));
  check("the original mask is not touched", text(dashed.mask, dashed.w, dashed.h)[3] === "............#.");

  // Two ears far apart: the air between them is a concavity, not a gap.
  const ears = grid([
    "#..........#",
    "#..........#",
    "#..........#",
    "############",
    "#..........#",
    "############",
  ]);
  const earsFilled = text(fillBody(ears.mask, ears.w, ears.h), ears.w, ears.h);
  // The corners of the concavity get a BODY_GAP fillet, the way a sketch's
  // corners are read; its middle stays air.
  check("a concavity wider than the gap stays transparent", earsFilled[0] === "#..........#" && earsFilled[2].substring(3, 9) === "......", earsFilled.join("\n"));
  check("a closed hole is filled", earsFilled[4] === "############", earsFilled.join("\n"));

  // Ink on the picture's edge: the outside still gets in around it.
  const edge = grid([
    "###",
    "#.#",
    "###",
  ]);
  check("a box on the edge is still a box", text(fillBody(edge.mask, 3, 3), 3, 3).join("") === "#########");
  const lone = grid([
    ".....",
    "..#..",
    ".....",
  ]);
  check("a lone dot grows no body", Array.from(fillBody(lone.mask, 5, 3)).filter((v) => v).length === 1);
  const empty = fillBody(new Uint8Array(9), 3, 3);
  check("nothing stays nothing", Array.from(empty).every((v) => v === 0));
}

// ---------------------------------------------------------------------------
// 2. The bundle's pictures
// ---------------------------------------------------------------------------
console.log("== the bundle ==");
{
  const species = Object.keys(bundle.species);
  const withBack = species.filter((s) => bundle.species[s].back);
  check("back pictures are carried", withBack.length > 100, String(withBack.length));
  // The fill is idempotent on what the bundle carries: baking applied it.
  const unfilled = withBack.filter((s) => {
    const pic = bundle.species[s].back;
    const alpha = unpackMask(pic.alpha, pic.width * pic.height);
    const again = fillBody(alpha, pic.width, pic.height);
    for (let i = 0; i < alpha.length; i++) if (again[i] !== alpha[i]) return true;
    return false;
  });
  check("every back picture was baked with its body", unfilled.length === 0, unfilled.slice(0, 8).join(", "));
  const pikachu = bundle.species.PIKACHU;
  if (pikachu && pikachu.back) {
    const alpha = unpackMask(pikachu.back.alpha, 32 * 32);
    let opaque = 0;
    for (let i = 0; i < alpha.length; i++) opaque += alpha[i];
    check("Pikachu's back has a body (the sketch alone was 232 pixels)", opaque > 350, String(opaque));
  }
  // Fronts are drawn closed; the flood is right for them and they are left as is.
  const front = bundle.species.PIKACHU.front;
  const frontAlpha = unpackMask(front.alpha, front.width * front.height);
  check("a front picture keeps its open concavities", frontAlpha[0 * front.width + 10] === 0 && frontAlpha[2 * front.width + 16] === 0);

  const pal = (s) => bundle.species[s] && bundle.species[s].palette;
  check("every species names its Super Game Boy palette", species.every((s) => typeof pal(s) === "string" && bundle.palettes[pal(s)]),
        species.filter((s) => !pal(s)).slice(0, 5).join(", "));
  check("Pikachu is YELLOWMON", pal("PIKACHU") === "YELLOWMON", pal("PIKACHU"));
  check("Charmander is REDMON", pal("CHARMANDER") === "REDMON", pal("CHARMANDER"));
  check("Squirtle is CYANMON", pal("SQUIRTLE") === "CYANMON", pal("SQUIRTLE"));
  check("Bulbasaur is GREENMON", pal("BULBASAUR") === "GREENMON", pal("BULBASAUR"));
  check("Mew is MEWMON", pal("MEW") === "MEWMON", pal("MEW"));
  const yellow = bundle.palettes.YELLOWMON;
  check("YELLOWMON is a yellow", yellow && yellow[1][0] > 200 && yellow[1][1] > 200 && yellow[1][2] < 160, JSON.stringify(yellow));
}

// ---------------------------------------------------------------------------
// 3. The three pictures that are not a species': the GHOST and two fossils
// ---------------------------------------------------------------------------
console.log("== the ghost and the fossils ==");
{
  const P = "../Assets/Scripts/play/";
  const { GbCanvas, GbFont } = await import(P + "screen/GbCanvas.ts");
  const Pic = await import(P + "screen/PictureScreen.ts");
  const { wallScript } = await import(P + "script/Bookshelves.ts");
  const Ghost = await import(P + "battle/Ghost.ts");
  const R = await import(P + "BattleRunner.ts");
  const PlayState = await import(P + "PlayState.ts");
  const { makeWildMon } = await import(P + "battle/Stats.ts");
  const { HeadlessLens } = await import("./headless.mjs");

  const pictures = bundle.pictures || {};
  check("the bundle carries the GHOST and both fossils",
        ["ghost", "fossilAerodactyl", "fossilKabutops"].every((k) => pictures[k] && pictures[k].width >= 40 && pictures[k].width === pictures[k].height),
        JSON.stringify(Object.keys(pictures)));
  check("a species' front picture is a picture too", Pic.pictureFor(bundle, "species:ARTICUNO") === bundle.species.ARTICUNO.front &&
        Pic.pictureFor(bundle, "nothing") === null && Pic.pictureFor({ species: {} }, "ghost") === null);
  check("the ghost wears MonsterPalettes entry 0", Ghost.GHOST_PALETTE === "MEWMON" && !!bundle.palettes[Ghost.GHOST_PALETTE]);

  // The screen: a frame, the picture standing in it, the caption under it.
  const font = new GbFont(bundle);
  const canvas = new GbCanvas();
  const screen = new Pic.PictureController(bundle, "fossilKabutops", [["KABUTOPS Fossil", "A primitive and"], ["A primitive and", "rare POKeMON."]]);
  screen.paint(canvas, font);
  let inFrame = 0;
  let outside = 0;
  const x0 = (Pic.PICTURE_BOX_TX + 1) * 8, y0 = (Pic.PICTURE_BOX_TY + 1) * 8;
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 160; x++) {
      if (canvas.shadeAt(x, y) === 0) continue;
      if (x >= x0 && x < x0 + 56 && y >= y0 && y < y0 + 56) inFrame++;
      else if (x < Pic.PICTURE_BOX_TX * 8 || x >= (Pic.PICTURE_BOX_TX + Pic.PICTURE_BOX_TILES) * 8) outside++;
    }
  }
  check("the picture is drawn inside its frame and nowhere beside it", inFrame > 300 && outside === 0, inFrame + " in, " + outside + " beside");
  const before = screen.stateVersion();
  screen.step(false);
  check("nothing turns without a press", screen.isOpen() && screen.stateVersion() === before);
  screen.step(true);
  check("a press turns the caption's page", screen.isOpen() && screen.stateVersion() !== before);
  screen.step(true);
  check("and the last one takes picture and caption down together", !screen.isOpen());

  // The walls that show one.
  const fossil = wallScript("MUSEUM_1F", 2, 3, "right", 0);
  check("the museum's first case is its picture and its words",
        fossil && fossil.length === 1 && fossil[0].op === "push_screen" && fossil[0].screen === "Picture" &&
        fossil[0].species === "fossilAerodactyl" && fossil[0].textId === "_AerodactylFossilText", JSON.stringify(fossil));
  const bird = wallScript("ROUTE_15_GATE_2F", 1, 2, "up", 0);
  check("the binoculars show ARTICUNO, faced from below only",
        bird && bird[0].species === "species:ARTICUNO" && wallScript("ROUTE_15_GATE_2F", 1, 2, "left", 0) === null);

  // Through the lens: the picture opens, its pages are the caption's, A closes it.
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  state.mapId = "MUSEUM_1F"; state.cellX = 2; state.cellY = 4; state.facing = "up";
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  const pages = lens.talk(10);
  check("facing the case opens the picture and says the words",
        lens.events.indexOf("picture:fossilAerodactyl") >= 0 && pages.join(" ").indexOf("AERODACTYL Fossil") >= 0 && !lens.loop.isBusy(),
        JSON.stringify({ events: lens.events.slice(-3), pages }));
  const bare = JSON.parse(JSON.stringify({ romSha1: bundle.romSha1 }));
  const old = new HeadlessLens({ ...bundle, pictures: undefined }, { state: PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), bundle.romSha1), wanderers: false, noWild: true });
  const oldPages = old.talk(10);
  check("a bundle baked without pictures still says the words", old.events.indexOf("picture:fossilAerodactyl") < 0 &&
        oldPages.join(" ").indexOf("AERODACTYL Fossil") >= 0, JSON.stringify(oldPages));

  // The battle: a ghost nobody has identified is drawn as the ghost, and the
  // restless soul is the ghost until the scope's line has been read.
  const view = () => {
    const seen = [];
    let shown = false;
    return { seen, showLines: (l) => { seen.push(l.join(" ")); shown = true; }, acknowledged: () => { if (shown) { shown = false; return true; } return false; },
             hideBox: () => {}, showMoves: () => {}, hideMoves: () => {}, chosenMove: () => -1, wantsToRun: () => false,
             chosenSwitch: () => -1, chosenBagItem: () => "", chosenBagTarget: () => -1, sound: () => {},
             askLearn: () => {}, learnDecision: () => 0, showSafariMenu: () => {}, chosenSafari: () => "" };
  };
  const party = [makeWildMon(bundle, "CHARMANDER", 40, () => 0.5)];
  const noScope = PlayState.newPlayState(bundle.romSha1);
  noScope.party = party;
  const hidden = new R.BattleRunner(bundle, noScope, view());
  hidden.startWild("GASTLY", 20, () => 0.5, "POKEMON_TOWER_3F");
  check("without the scope the foe is drawn as the GHOST", hidden.picturesOnField()[1] === Ghost.GHOST_PICTURE &&
        hidden.onField()[1] === "GASTLY", JSON.stringify(hidden.picturesOnField()));
  const scoped = PlayState.newPlayState(bundle.romSha1);
  scoped.party = party;
  scoped.bag.push({ id: "SILPH_SCOPE", count: 1 });
  const soulView = view();
  const soul = new R.BattleRunner(bundle, scoped, soulView);
  soul.startWild("MAROWAK", 30, () => 0.5, "POKEMON_TOWER_6F");
  check("the restless soul arrives as the ghost", soul.picturesOnField()[1] === Ghost.GHOST_PICTURE);
  for (let i = 0; i < 40 && soul.picturesOnField()[1] === Ghost.GHOST_PICTURE; i++) soul.update(1 / 60);
  const said = soulView.seen.join(" | ");
  check("the scope unveils her, and then she is a wild MAROWAK",
        soul.picturesOnField()[1] === "MAROWAK" && said.indexOf("GHOST") >= 0 && said.indexOf("unveiled") >= 0 &&
        said.indexOf("Wild MAROWAK") > said.indexOf("unveiled"), said);
  const plain = new R.BattleRunner(bundle, scoped, view());
  plain.startWild("GASTLY", 20, () => 0.5, "POKEMON_TOWER_3F");
  check("with the scope an ordinary tower Pokemon is itself from the start", plain.picturesOnField()[1] === "GASTLY");
}

const verdict = fail === 0 ? "OK" : "FAILED";
console.log(`BATTLEPICS ${pass} PASS  ${fail} FAIL  ${verdict}`);
process.exit(fail === 0 ? 0 : 1);
