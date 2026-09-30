// A road across Kanto on the lens's own map data, as scenario actions.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/oracle/road.mjs Assets/Generated/kanto.json OAKS_LAB 5,6 PEWTER_GYM 4,2 ['{"toggles":{...}}']
//
// route.mjs plans inside one map. This plans THROUGH maps: a breadth-first
// search over (map, cell) whose edges are ordinary steps, the seam onto a
// connected map (Overworld.crossConnection's offset math) and a warp cell
// (Overworld.takeWarp's destWarp, LAST_MAP resolved as the last outside map
// walked). Walkability is MapRuntime.canEnter, the same rule the lens walks
// by, which has agreed with the cartridge on every cell compared so far.
//
// What it steers clear of, because a scenario compared on both machines has
// to: every visible object's cell, a margin around a WALK npc (its own RNG
// puts it anywhere near its cell), and every cell a trainer can see from
// where he ships (TrainerSight.ts's rule: the cells straight ahead of him,
// up to his header's range, through walls). A defeated trainer's line is
// passed with `beaten`. The output splits a walk at every seam and warp and
// rests after it, the way the hand-made transcripts do.
//
// Both oracle.py (`prepare after-brock`, by subprocess) and lensstate.mjs
// (by import) plan their legs here, so the two machines walk one road that
// neither of them hardcodes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

globalThis.print = globalThis.print || (() => {});
const { MapRuntime } = await import("../../Assets/Scripts/world/MapRuntime.ts");
const { isObjectHidden, shippedFacing } = await import("../../Assets/Scripts/world/WorldData.ts");

const DIRS = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]];
const COMPASS = { up: "north", down: "south", left: "west", right: "east" };
/** Frames rested after a door (the fade and the forced step out) and after a seam. */
export const WARP_REST = 90;
export const SEAM_REST = 60;

function isOutside(def) {
  return def.tileset === "OVERWORLD" || def.tileset === "PLATEAU";
}

/** The header row of a trainer object on its map, or null: where its sight range lives. */
function headerFor(bundle, mapId, object) {
  const headers = bundle.trainerHeaders || {};
  // PEWTER_GYM -> PewterGym, MT_MOON_1F -> MtMoon1F, ROUTE_3 -> Route3.
  const key = mapId.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const rows = headers[key];
  if (!rows) return null;
  const row = rows[String(object.index)];
  return row ? row : null;
}

/**
 * Plans a road. `from`/`to` are {map, x, y}. Options:
 *   toggles  -- objectToggles ("MAP:NAME" -> shown?) that decide who stands where
 *   margin   -- cells kept clear around a WALK npc (default 2, relaxed to 1 and 0 if no road)
 *   beaten   -- names of trainers whose sight line no longer matters
 *   avoid    -- extra [{map, x, y}] never stepped on
 *   noGrass  -- keep off tall grass (tried first when set; relaxed if there is no road)
 *   lastMap  -- the outside map a LAST_MAP warp at the start would mean
 * Returns { actions, path } or null when there is no road.
 */
export function planRoad(bundle, from, to, options) {
  const o = options || {};
  const margins = [o.margin === undefined ? 2 : o.margin, 1, 0].filter((m, i, a) => a.indexOf(m) === i);
  const grassTries = o.noGrass ? [true, false] : [false];
  for (const noGrass of grassTries) {
    for (const margin of margins) {
      const found = search(bundle, from, to, { ...o, margin, noGrass });
      if (found) return found;
    }
  }
  return null;
}

function search(bundle, from, to, o) {
  const runtimes = {};
  const blockedByMap = {};
  const runtime = (id) => {
    if (!runtimes[id]) {
      const def = bundle.maps[id];
      if (!def) return null;
      const rt = new MapRuntime(def, bundle.tilesets[def.tileset]);
      rt.setReveals(o.toggles || null);
      runtimes[id] = rt;
      blockedByMap[id] = blockedCells(bundle, def, o);
    }
    return runtimes[id];
  };
  const avoid = {};
  for (const a of (o.avoid || [])) avoid[a.map + "|" + a.x + "," + a.y] = true;
  const enterable = (id, x, y) => {
    const rt = runtime(id);
    if (!rt || !rt.canEnter(x, y)) return false;
    if (blockedByMap[id][x + "," + y] || avoid[id + "|" + x + "," + y]) return false;
    if (o.noGrass && rt.isGrass(x, y)) return false;
    return true;
  };

  const startLast = o.lastMap ? o.lastMap : (isOutside(bundle.maps[from.map]) ? from.map : outsideMapInto(bundle, from.map));
  const key = (m, x, y, last) => m + "|" + x + "," + y + "|" + last;
  const start = { map: from.map, x: from.x, y: from.y, last: startLast };
  const prev = {};
  prev[key(start.map, start.x, start.y, start.last)] = null;
  const queue = [start];
  let goal = null;
  while (queue.length) {
    const cur = queue.shift();
    if (cur.map === to.map && cur.x === to.x && cur.y === to.y) { goal = cur; break; }
    const rt = runtime(cur.map);
    for (const [d, dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      let next = null;
      let kind = "step";
      if (!rt.inBounds(nx, ny)) {
        // Off the edge: a seam onto the connected map, at Overworld's offset math.
        const conn = rt.connection(COMPASS[d]);
        if (!conn) continue;
        const destDef = bundle.maps[conn.map];
        if (!destDef) continue;
        const w = destDef.width * 2, h = destDef.height * 2;
        let x = 0, y = 0;
        if (d === "up") { x = cur.x - conn.offset * 2; y = h - 1; }
        else if (d === "down") { x = cur.x - conn.offset * 2; y = 0; }
        else if (d === "left") { x = w - 1; y = cur.y - conn.offset * 2; }
        else { x = 0; y = cur.y - conn.offset * 2; }
        x = Math.max(0, Math.min(w - 1, x));
        y = Math.max(0, Math.min(h - 1, y));
        if (!enterable(conn.map, x, y)) continue;
        next = { map: conn.map, x, y, last: isOutside(destDef) ? conn.map : cur.last };
        kind = "seam";
      } else {
        if (!enterable(cur.map, nx, ny)) continue;
        const warp = rt.warpAt(nx, ny);
        if (warp && warpFires(bundle, rt, d, nx, ny)) {
          const destId = warp.destMap === "LAST_MAP" ? cur.last : warp.destMap;
          const destDef = bundle.maps[destId];
          if (!destDef) continue;
          const target = destDef.warps[warp.destWarp - 1];
          if (!target) continue;
          let ax = target.x, ay = target.y;
          // Arriving outdoors on a door tile, the cartridge walks the player
          // one step down out of the doorway on its own (FINDINGS, 6 sep).
          const destRt = runtime(destId);
          if (isOutside(destDef) && destRt.isDoorTile(ax, ay)) ay += 1;
          const here = bundle.maps[cur.map];
          next = { map: destId, x: ax, y: ay, last: isOutside(here) ? cur.map : cur.last };
          kind = "warp";
        } else {
          next = { map: cur.map, x: nx, y: ny, last: cur.last };
        }
      }
      const k = key(next.map, next.x, next.y, next.last);
      if (k in prev) continue;
      prev[k] = { from: cur, dir: d, kind };
      queue.push(next);
    }
  }
  if (!goal) return null;
  const edges = [];
  let cur = goal;
  while (true) {
    const p = prev[key(cur.map, cur.x, cur.y, cur.last)];
    if (!p) break;
    edges.unshift({ dir: p.dir, kind: p.kind, to: cur });
    cur = p.from;
  }
  const { actions, ends } = toActions(edges);
  return { actions, ends, path: edges };
}

/**
 * Whether landing on a warp cell by a step in direction `d` takes the warp --
 * PlayLoop.afterStep's rule, which is CheckWarpsNoCollision's: a door, stair
 * or hole tile fires on arrival from any side; any other warp cell (a mat)
 * fires only with the pad held toward it AND Overworld.extraWarpCheck
 * passing -- on the OVERWORLD/SHIP/PLATEAU tilesets and the four
 * function2Maps the tile in FRONT must be one of the warp carpets listed
 * for that direction (bundle.field.warpCarpets, ExtraWarpCheck's tables),
 * everywhere else the player must be facing the map edge. Walking sideways
 * along the mats of a house goes nowhere, as measured (FINDINGS, 6 sep).
 */
function warpFires(bundle, rt, d, x, y) {
  if (rt.isWarpTile(x, y)) return true;
  const [dx, dy] = DIRS.find((e) => e[0] === d).slice(1);
  const facingEdge = (d === "up" && y === 0) || (d === "down" && y === rt.heightCells - 1) ||
    (d === "left" && x === 0) || (d === "right" && x === rt.widthCells - 1);
  const carpets = bundle.field ? bundle.field.warpCarpets : null;
  if (!carpets) return facingEdge;
  const mapId = rt.def.id;
  let useCarpet;
  if ((carpets.edgeMaps || []).indexOf(mapId) >= 0) useCarpet = false;
  else if ((carpets.function2Maps || []).indexOf(mapId) >= 0) useCarpet = true;
  else useCarpet = (carpets.function2Tilesets || []).indexOf(rt.def.tileset) >= 0;
  if (!useCarpet) return facingEdge;
  const front = rt.cellTile(x + dx, y + dy);
  if (carpets.ssAnneBow && mapId === carpets.ssAnneBow.map) return front === carpets.ssAnneBow.tile;
  const tiles = carpets.tiles ? carpets.tiles[d] : null;
  return !!tiles && tiles.indexOf(front) >= 0;
}

/**
 * The outside map whose door leads into `mapId`: what LAST_MAP means for a
 * road that STARTS indoors (Overworld.resolveLastMap's candidates, first one
 * wins -- a gate has two and a road never starts in one).
 */
function outsideMapInto(bundle, mapId) {
  for (const id in bundle.maps) {
    const def = bundle.maps[id];
    if (!isOutside(def)) continue;
    for (const w of def.warps) if (w.destMap === mapId) return id;
  }
  return "";
}

/** Cells never stepped on: visible objects, a margin round walkers, and trainers' lines of sight. */
function blockedCells(bundle, def, o) {
  const out = {};
  const beaten = o.beaten || [];
  for (const obj of def.objects) {
    if (isObjectHidden(def.id, obj, o.toggles || null)) continue;
    out[obj.x + "," + obj.y] = true;
    if (obj.movement === "WALK") {
      for (let dx = -o.margin; dx <= o.margin; dx++) {
        for (let dy = -o.margin; dy <= o.margin; dy++) out[(obj.x + dx) + "," + (obj.y + dy)] = true;
      }
    }
    if (obj.trainerClass && beaten.indexOf(obj.name) < 0) {
      const header = headerFor(bundle, def.id, obj);
      const range = header && header.range ? header.range : 0;
      const facing = shippedFacing(obj);
      const [dx, dy] = facing === "up" ? [0, -1] : facing === "down" ? [0, 1] : facing === "left" ? [-1, 0] : [1, 0];
      for (let i = 1; i <= range; i++) out[(obj.x + dx * i) + "," + (obj.y + dy * i)] = true;
    }
  }
  return out;
}

/**
 * Edges to {walk, n} runs, split and rested at every seam and warp, with the
 * [map, x, y] each action should end on -- what a walker checks after each
 * one to know an interruption (a trainer's approach, a body in the way) has
 * knocked it off the road.
 */
function toActions(edges) {
  const actions = [];
  const ends = [];
  const cellOf = (e) => [e.to.map, e.to.x, e.to.y];
  for (const e of edges) {
    const last = actions.length ? actions[actions.length - 1] : null;
    if (last && last.walk === e.dir) { last.n += 1; ends[ends.length - 1] = cellOf(e); }
    else { actions.push({ walk: e.dir, n: 1 }); ends.push(cellOf(e)); }
    if (e.kind === "warp") { actions.push({ wait: WARP_REST }); ends.push(cellOf(e)); }
    else if (e.kind === "seam") { actions.push({ wait: SEAM_REST }); ends.push(cellOf(e)); }
  }
  return { actions, ends };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [bundlePath, fromMap, fromCell, toMap, toCell, optJson] = process.argv.slice(2);
  if (!bundlePath || !fromMap || !fromCell || !toMap || !toCell) {
    console.error("usage: road.mjs <bundle.json> <MAP> x,y <MAP> x,y ['{\"toggles\":{},\"beaten\":[],\"avoid\":[]}']");
    process.exit(2);
  }
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const [fx, fy] = fromCell.split(",").map(Number);
  const [tx, ty] = toCell.split(",").map(Number);
  const options = optJson ? JSON.parse(optJson) : {};
  const road = planRoad(bundle, { map: fromMap, x: fx, y: fy }, { map: toMap, x: tx, y: ty }, options);
  if (!road) { console.error("no road"); process.exit(1); }
  if (options.verbose) {
    for (const e of road.path) console.error(e.kind.padEnd(5), e.dir.padEnd(6), e.to.map, e.to.x + "," + e.to.y);
  }
  // `ends: true` asks for the object form, actions with the cell each ends on
  // (oracle.py's walk_leg); the bare list pastes into a scenario.
  console.log(JSON.stringify(options.ends ? { actions: road.actions, ends: road.ends } : road.actions));
}
