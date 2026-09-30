// Pinch-to-walk: a pinched cell becomes a route, and the route becomes steps.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/route.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Three layers, each on its own: PathFind over a grid (walls, bodies, a goal
// you cannot stand on), RouteSource as a d-pad (the next cell's direction,
// un-turned for the wearer's view, dropped when stuck or overtaken by a real
// thumb), and the whole thing through the headless lens on Pallet Town, where
// Red walks from his front door to a pinched cell and up to the girl.
//
// --selftest turns the view without telling the route and expects it to walk
// the wrong way.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const SELFTEST = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: route.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.getTime = () => 0;

const { findPath, stepToward } = await import("../Assets/Scripts/world/PathFind.ts");
const { RouteSource, ROUTE_STUCK_SECONDS, personMoved } = await import("../Assets/Scripts/play/RouteSource.ts");
const { InputRouter, ScriptedInputSource } = await import("../Assets/Scripts/play/InputSource.ts");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail ? "\n          " + detail : ""));
}

// ---------------------------------------------------------------------------
// 1. PathFind on a drawn grid
// ---------------------------------------------------------------------------
console.log("== the search ==");
{
  const rows = [
    "..........",
    ".####.....",
    ".#........",
    ".#.#######",
    ".#........",
    "..........",
  ];
  const grid = {
    widthCells: 10, heightCells: 6,
    canEnter: (x, y) => rows[y][x] === ".",
  };
  const straight = findPath(grid, 0, 0, 5, 0);
  check("a straight line is its cells in order", JSON.stringify(straight) === JSON.stringify([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]),
        JSON.stringify(straight));
  const round = findPath(grid, 0, 0, 2, 2);
  // Ten either way round the wall (over the top or down the left side).
  check("a wall is walked round, shortest way", round !== null && round.length === 10 &&
        round[round.length - 1][0] === 2 && round[round.length - 1][1] === 2 &&
        round.every((c) => grid.canEnter(c[0], c[1])), JSON.stringify(round));
  check("every step is one cell", round.slice(1).every((c, i) => Math.abs(c[0] - round[i][0]) + Math.abs(c[1] - round[i][1]) === 1));
  const beside = findPath(grid, 0, 0, 2, 1);
  check("a cell you cannot stand on ends beside it", beside !== null && beside.length > 0 &&
        Math.abs(beside[beside.length - 1][0] - 2) + Math.abs(beside[beside.length - 1][1] - 1) === 1,
        JSON.stringify(beside));
  check("already there is an empty route", JSON.stringify(findPath(grid, 3, 3, 3, 3)) === "[]");
  check("beside the goal already is an empty route", JSON.stringify(findPath(grid, 2, 0, 2, 1)) === "[]");
  const walled = {
    widthCells: 3, heightCells: 3,
    canEnter: (x, y) => !(x === 1 && y !== 2) && !(x === 1 && y === 2),
  };
  check("nothing reaches across a full wall", findPath(walled, 0, 0, 2, 0) === null);
  check("off the map is nothing", findPath(grid, 0, 0, 12, 0) === null && findPath(grid, 0, 0, -1, 0) === null);
  check("stepToward names the four neighbours and nothing else",
        stepToward(1, 1, 1, 0) === "up" && stepToward(1, 1, 1, 2) === "down" &&
        stepToward(1, 1, 0, 1) === "left" && stepToward(1, 1, 2, 1) === "right" &&
        stepToward(1, 1, 3, 1) === "" && stepToward(1, 1, 1, 1) === "");
}

// ---------------------------------------------------------------------------
// 2. RouteSource as a d-pad
// ---------------------------------------------------------------------------
console.log("== the route as a d-pad ==");
{
  const held = (r) => { const p = r.dpad(); return p.up ? "up" : p.down ? "down" : p.left ? "left" : p.right ? "right" : ""; };
  const r = new RouteSource();
  check("idle it holds nothing and is not connected", held(r) === "" && !r.isActive() && !r.isConnected());
  r.setRoute([[5, 4], [6, 4], [6, 5]]);
  r.observe(5, 5, 1 / 60);
  check("it holds toward the first cell", held(r) === "up" && r.isActive() && r.remaining() === 3, held(r));
  r.observe(5, 4, 1 / 60);
  check("reaching a cell moves it on", held(r) === "right" && r.remaining() === 2, held(r));
  r.observe(6, 4, 1 / 60);
  r.observe(6, 5, 1 / 60);
  check("at the end it lets go", held(r) === "" && !r.isActive());

  const turned = new RouteSource();
  turned.setViewTurns(SELFTEST ? 0 : 1);
  turned.setRoute([[5, 4]]);
  turned.observe(5, 5, 1 / 60);
  // turnPress(dir, 1) is what Overworld applies; the route must hand it the
  // press that comes out as "up" after that turn.
  const { turnPress } = await import("../Assets/Scripts/play/ViewRelativeInput.ts");
  check("with the view turned, the press is pre-turned so the overworld walks north",
        turnPress(held(turned), 1) === "up", held(turned) + " -> " + turnPress(held(turned), 1));

  const stuck = new RouteSource();
  stuck.setRoute([[5, 4]]);
  stuck.observe(5, 5, 0.1);
  for (let i = 0; i < 12; i++) stuck.observe(5, 5, 0.1);
  check("a second without progress drops the route", !stuck.isActive() && held(stuck) === "");

  const lost = new RouteSource();
  lost.setRoute([[5, 4]]);
  lost.observe(9, 9, 1 / 60);
  check("a player who is not beside the next cell drops it too", !lost.isActive());

  // An exit: on the last cell the route keeps pressing toward the edge until
  // the player is moved (the mat's warp), or gives up after a second.
  const exit = new RouteSource();
  exit.setRoute([[3, 7]], "down");
  exit.observe(4, 7, 1 / 60);
  check("before the mat it walks", held(exit) === "left", held(exit));
  exit.observe(3, 7, 1 / 60);
  check("on the mat it presses into the edge and stays active", held(exit) === "down" && exit.isActive(), held(exit));
  for (let i = 0; i < 5; i++) exit.observe(3, 7, 0.1);
  check("...and keeps pressing", held(exit) === "down");
  exit.observe(5, 6, 1 / 60);
  check("being moved off the mat (the warp) ends it", !exit.isActive() && held(exit) === "");
  const noDoor = new RouteSource();
  noDoor.setRoute([[3, 7]], "down");
  noDoor.observe(3, 7, 1 / 60);
  for (let i = 0; i < 12; i++) noDoor.observe(3, 7, 0.1);
  check("a second of pressing at a wall gives up", !noDoor.isActive() && held(noDoor) === "");
  const turnedExit = new RouteSource();
  turnedExit.setViewTurns(1);
  turnedExit.setRoute([], "down");
  turnedExit.observe(3, 7, 1 / 60);
  check("the exit press is pre-turned like a step", turnPress(held(turnedExit), 1) === "down", held(turnedExit));

  // A face: beside the pinched person, the route turns toward them (held
  // until the overworld reports the facing) and presses A for one frame.
  const face = new RouteSource();
  face.setRoute([[5, 6]], "", [6, 6]);
  face.observe(5, 5, 1 / 60, "down");
  check("it walks to the cell beside the person", held(face) === "down");
  face.observe(5, 6, 1 / 60, "down");
  check("arrived, it holds toward the person", held(face) === "right" && face.isActive() && !face.pressedA(), held(face));
  face.observe(5, 6, 1 / 60, "down");
  check("...until the facing is reported", held(face) === "right" && !face.pressedA());
  face.observe(5, 6, 1 / 60, "right", true);
  check("facing them mid-beat, it lets go and waits", held(face) === "" && !face.pressedA() && face.isActive());
  face.observe(5, 6, 1 / 60, "right");
  check("facing them, it presses A", held(face) === "" && face.pressedA() && face.isActive());
  face.observe(5, 6, 1 / 60, "right");
  check("A is one frame, then the route is over", !face.pressedA() && !face.isActive());
  const already = new RouteSource();
  already.setRoute([], "", [6, 6]);
  already.observe(5, 6, 1 / 60, "right");
  check("already facing them, it presses at once", already.pressedA());
  const gone = new RouteSource();
  gone.setRoute([], "", [6, 6]);
  gone.observe(5, 6, 1 / 60, "up");
  for (let i = 0; i < 12; i++) gone.observe(5, 6, 0.1, "up");
  check("a turn that never comes is given up on", !gone.isActive() && !gone.pressedA());

  // A person who walks off (both of Pallet Town's are WALK sprites): the
  // caller asks whom the route meant to face, sees them stand elsewhere, and
  // plans again from where Red is. The new route ends beside the new cell
  // and talks there. A route to a bare cell faces no one.
  const moved = new RouteSource();
  moved.setRoute([[5, 6]], "", [6, 6]);
  moved.observe(5, 5, 1 / 60, "down");
  check("a route to a person says whom it faces", JSON.stringify(moved.faceTarget()) === "[6,6]",
        JSON.stringify(moved.faceTarget()));
  const bare = new RouteSource();
  bare.setRoute([[5, 6]]);
  check("a route to a bare cell faces no one", bare.faceTarget() === null && !personMoved(bare, [6, 6]));
  check("a person still there is not a move", !personMoved(moved, [6, 6]));
  check("a person who walked off is noticed", personMoved(moved, [6, 4]));
  moved.setRoute([[5, 4]], "", [6, 4]);
  moved.observe(5, 5, 1 / 60, "down");
  check("planned again, it walks toward the new cell beside her", held(moved) === "up", held(moved));
  moved.observe(5, 4, 1 / 60, "up");
  check("arrived there, it turns to her", held(moved) === "right", held(moved));
  moved.observe(5, 4, 1 / 60, "right");
  check("and talks where she stands now", moved.pressedA());

  // The router: a real direction cancels the route; a route owns the d-pad.
  const thumb = new ScriptedInputSource();
  const router = new InputRouter([thumb]);
  const route = new RouteSource();
  router.setRoute(route);
  route.setRoute([[1, 0]]);
  route.observe(0, 0, 1 / 60);
  router.update();
  check("the router hands out the route's d-pad", router.dpad().right === true);
  thumb.hold("down");
  router.update();
  check("a real direction cancels it and wins", !route.isActive() && router.dpad().down === true && !router.dpad().right);
}

// ---------------------------------------------------------------------------
// 3. Through the headless lens, on Pallet Town
// ---------------------------------------------------------------------------
console.log("== on Pallet Town ==");
{
  const PlayState = await import("../Assets/Scripts/play/PlayState.ts");
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
  state.mapId = "PALLET_TOWN"; state.cellX = 5; state.cellY = 6; state.facing = "down";
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  const thumb = lens.input;
  const router = new InputRouter([thumb]);
  const route = new RouteSource();
  router.setRoute(route);
  lens.input = router;
  const walk = (route, cells, maxFrames) => {
    route.setRoute(cells);
    let frames = 0;
    while (route.isActive() && frames < maxFrames) {
      route.setViewTurns(lens.overworld.viewTurns);
      route.observe(lens.overworld.cellX, lens.overworld.cellY, 1 / 60);
      lens.frame(1 / 60);
      frames++;
    }
    return frames;
  };
  const map = lens.overworld.map;
  const path = findPath(map, 5, 6, 10, 3);
  check("a route exists from the front door to the north path", path !== null && path.length >= 8, path && path.length);
  const frames = walk(route, path, 2000);
  const s = lens.state();
  check("Red walks it, step by step", s.x === 10 && s.y === 3, JSON.stringify({ x: s.x, y: s.y, frames }));
  check("and it took the walk's own time, not a jump", frames > path.length * 8, String(frames));

  const girl = map.def.objects.filter((o) => o.name === "PALLETTOWN_GIRL")[0];
  const toGirl = findPath(map, s.x, s.y, girl.x, girl.y);
  check("a pinch on the girl routes to a cell beside her", toGirl !== null &&
        Math.abs(toGirl[toGirl.length - 1][0] - girl.x) + Math.abs(toGirl[toGirl.length - 1][1] - girl.y) === 1,
        JSON.stringify(toGirl && toGirl.slice(-1)));
  const pagesBefore = lens.pages.length;
  route.setRoute(toGirl, "", [girl.x, girl.y]);
  {
    let frames = 0;
    while (route.isActive() && frames < 3000) {
      route.setViewTurns(lens.overworld.viewTurns);
      route.observe(lens.overworld.cellX, lens.overworld.cellY, 1 / 60, lens.overworld.facing, lens.overworld.isMoving());
      lens.frame(1 / 60);
      frames++;
    }
  }
  const s2 = lens.state();
  check("and Red stands there", Math.abs(s2.x - girl.x) + Math.abs(s2.y - girl.y) === 1, JSON.stringify({ x: s2.x, y: s2.y }));
  check("facing her", s2.facing === (girl.x > s2.x ? "right" : girl.x < s2.x ? "left" : girl.y > s2.y ? "down" : "up"), s2.facing);
  for (let i = 0; i < 30; i++) lens.frame(1 / 60);
  check("and she speaks: the pinch was the talk", lens.pages.length > pagesBefore, JSON.stringify(lens.pages.slice(-1)));

  // She wanders. Talked to where she stands now, not where she shipped: the
  // first LEAF run that met her one cell off her shipped cell found her mute.
  {
    const wandered = PlayState.newPlayState(bundle.romSha1);
    wandered.flags.EVENT_INTRO_DONE = true;
    wandered.flags.EVENT_GOT_STARTER = true;
    wandered.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
    wandered.mapId = "PALLET_TOWN"; wandered.cellX = 5; wandered.cellY = 6; wandered.facing = "down";
    const walkLens = new HeadlessLens(bundle, { state: wandered, wanderers: false, noWild: true });
    const walkRouter = new InputRouter([walkLens.input]);
    const walkRoute = new RouteSource();
    walkRouter.setRoute(walkRoute);
    walkLens.input = walkRouter;
    const wmap = walkLens.overworld.map;
    const gx = girl.x + 1;
    const gy = girl.y;
    walkLens.npcMotion.place(girl.name, gx, gy, "down");
    wmap.moveObject(girl.name, gx, gy);
    check("the girl has stepped one cell to the right", wmap.objectAt(gx, gy) !== null && wmap.objectAt(girl.x, girl.y) === null);
    const besideNow = findPath(wmap, 5, 6, gx, gy);
    check("a pinch on her routes to a cell beside where she stands", besideNow !== null &&
          Math.abs(besideNow[besideNow.length - 1][0] - gx) + Math.abs(besideNow[besideNow.length - 1][1] - gy) === 1,
          JSON.stringify(besideNow && besideNow.slice(-1)));
    const before = walkLens.pages.length;
    walkRoute.setRoute(besideNow, "", [gx, gy]);
    for (let f = 0; f < 2000 && walkRoute.isActive(); f++) {
      walkRoute.setViewTurns(walkLens.overworld.viewTurns);
      walkRoute.observe(walkLens.overworld.cellX, walkLens.overworld.cellY, 1 / 60,
                        walkLens.overworld.facing, walkLens.overworld.isMoving());
      walkLens.frame(1 / 60);
    }
    for (let f = 0; f < 30; f++) walkLens.frame(1 / 60);
    check("and she speaks where she stands now", walkLens.pages.length > before, JSON.stringify(walkLens.pages.slice(-1)));

    const empty = PlayState.newPlayState(bundle.romSha1);
    empty.flags.EVENT_INTRO_DONE = true;
    empty.flags.EVENT_GOT_STARTER = true;
    empty.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
    empty.mapId = "PALLET_TOWN"; empty.cellX = 5; empty.cellY = 6; empty.facing = "down";
    const emptyLens = new HeadlessLens(bundle, { state: empty, wanderers: false, noWild: true });
    const emptyRouter = new InputRouter([emptyLens.input]);
    const emptyRoute = new RouteSource();
    emptyRouter.setRoute(emptyRoute);
    emptyLens.input = emptyRouter;
    emptyLens.npcMotion.place(girl.name, gx, gy, "down");
    emptyLens.overworld.map.moveObject(girl.name, gx, gy);
    const toShipped = findPath(emptyLens.overworld.map, 5, 6, girl.x, girl.y + 1);
    const pagesEmpty = emptyLens.pages.length;
    emptyRoute.setRoute(toShipped, "", [girl.x, girl.y]);
    for (let f = 0; f < 2000 && emptyRoute.isActive(); f++) {
      emptyRoute.setViewTurns(emptyLens.overworld.viewTurns);
      emptyRoute.observe(emptyLens.overworld.cellX, emptyLens.overworld.cellY, 1 / 60,
                         emptyLens.overworld.facing, emptyLens.overworld.isMoving());
      emptyLens.frame(1 / 60);
    }
    for (let f = 0; f < 30; f++) emptyLens.frame(1 / 60);
    check("her shipped cell, now empty, says nothing", emptyLens.pages.length === pagesEmpty,
          JSON.stringify(emptyLens.pages.slice(-1)));
  }
  lens.input = router;
  // Read her out before the next route; a page owns the frame.
  for (let n = 0; n < 8 && lens.pageWaiting; n++) { thumb.press("A"); for (let i = 0; i < 40; i++) lens.frame(1 / 60); }

  // Out of the house: the mat at (3,7) is a warp whose tile is a floor, and
  // it fires only with the pad held down on it. A route that ends there with
  // an exit walks Red out into Pallet Town.
  {
    const inside = PlayState.newPlayState(bundle.romSha1);
    inside.flags.EVENT_INTRO_DONE = true;
    inside.mapId = "REDS_HOUSE_1F"; inside.cellX = 7; inside.cellY = 1; inside.facing = "down";
    inside.lastOutsideMap = "PALLET_TOWN";
    const home = new HeadlessLens(bundle, { state: inside, wanderers: false, noWild: true });
    const homeRouter = new InputRouter([home.input]);
    const homeRoute = new RouteSource();
    homeRouter.setRoute(homeRoute);
    home.input = homeRouter;
    const toMat = findPath(home.overworld.map, 7, 1, 3, 7);
    check("the mat can be reached from the stairs", toMat !== null && toMat.length > 0);
    homeRoute.setRoute(toMat, "down");
    let frames = 0;
    while (homeRoute.isActive() && frames < 3000) {
      homeRoute.setViewTurns(home.overworld.viewTurns);
      homeRoute.observe(home.overworld.cellX, home.overworld.cellY, 1 / 60);
      home.frame(1 / 60);
      frames++;
    }
    for (let i = 0; i < 120; i++) home.frame(1 / 60);
    const out = home.state();
    check("and the exit press walks Red out of the house", out.map === "PALLET_TOWN",
          JSON.stringify({ map: out.map, x: out.x, y: out.y, frames }));
  }

  // Interrupted: a thumb on the pad mid-route wins.
  const away = findPath(map, s2.x, s2.y, 5, 6);
  route.setRoute(away);
  route.observe(lens.overworld.cellX, lens.overworld.cellY, 1 / 60);
  lens.frame(1 / 60);
  thumb.hold("right");
  router.update();
  check("a thumb mid-route cancels it", !route.isActive());
  thumb.hold("");
}

const verdict = fail === 0 ? "OK" : "FAILED";
console.log(`ROUTE ${pass} PASS  ${fail} FAIL  ${verdict}`);
if (SELFTEST) {
  if (fail === 0) { console.log("SELFTEST FAILED: an un-turned route went unnoticed"); process.exit(1); }
  console.log("SELFTEST OK: the planted fault was caught");
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
