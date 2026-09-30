// A walking route on the lens's map, as scenario actions.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/oracle/route.mjs Assets/Generated/kanto.json PALLET_TOWN 5,6 9,10
//
// Breadth-first over the map's step cells, avoiding every shipped object cell
// (a wanderer may be anywhere near its cell), printed as {walk, n} actions a
// scenario can paste. The lens's collision has agreed with the cartridge's on
// every cell compared so far, which is what makes a route planned here worth
// walking on both.

import { readFileSync } from "node:fs";
globalThis.print = () => {};

const [bundlePath, mapId, from, to] = process.argv.slice(2);
if (!bundlePath || !mapId || !from || !to) {
  console.error("usage: route.mjs <bundle.json> <MAP_ID> x,y x,y");
  process.exit(2);
}
const { MapRuntime } = await import("../../Assets/Scripts/world/MapRuntime.ts");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const def = bundle.maps[mapId];
if (!def) { console.error("no map " + mapId); process.exit(2); }
const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
const [sx, sy] = from.split(",").map(Number);
const [tx, ty] = to.split(",").map(Number);

const blocked = {};
for (const o of def.objects) blocked[o.x + "," + o.y] = true;
const DIRS = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]];
const prev = {};
const queue = [[sx, sy]];
prev[sx + "," + sy] = null;
while (queue.length) {
  const [x, y] = queue.shift();
  if (x === tx && y === ty) break;
  for (const [d, dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    const key = nx + "," + ny;
    if (nx < 0 || ny < 0 || nx >= map.widthCells || ny >= map.heightCells) continue;
    if (key in prev || blocked[key] || !map.canEnter(nx, ny)) continue;  // canEnter: ledges and counters are not steps
    prev[key] = [x, y, d];
    queue.push([nx, ny]);
  }
}
if (!((tx + "," + ty) in prev)) { console.error("no route"); process.exit(1); }
const steps = [];
let cur = tx + "," + ty;
while (prev[cur]) { const [px, py, d] = prev[cur]; steps.unshift(d); cur = px + "," + py; }
const actions = [];
for (const d of steps) {
  if (actions.length && actions[actions.length - 1].walk === d) actions[actions.length - 1].n++;
  else actions.push({ walk: d, n: 1 });
}
console.log(JSON.stringify(actions));
