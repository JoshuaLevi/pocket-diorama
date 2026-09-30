// screenOf(headlessLens): the 144x160 GAME BOY-mode shade grid for the lens's
// CURRENT state, built the way the real thing will be -- an OverworldView
// from the HeadlessLens's Overworld, NpcMotion and reveals, painted by
// OverworldCanvas.paintOverworld onto a fresh GbCanvas -- and read back the
// same row-major, top-down order tools/oracle/oracle.py's screen_shades()
// uses, so tools/oracle/compare.mjs --screens can diff the two arrays
// directly. See SPEC.md "The cartridge as oracle" and
// Assets/Scripts/play/screen/OverworldCanvas.ts's own measured facts.

import { GbCanvas } from "../Assets/Scripts/play/screen/GbCanvas.ts";
import { paintOverworld, connectedTileAt } from "../Assets/Scripts/play/screen/OverworldCanvas.ts";
import { isObjectHidden } from "../Assets/Scripts/world/WorldData.ts";

const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;

/** The range byte's own facing, for an object that has never moved or turned
 * (no NpcMotion pose yet) -- the exact rule PokemonAR.ts's rebuildNpcs uses
 * for the diorama's billboards, kept identical here so both modes agree. */
function shippedFacing(object) {
  if (object.range === "UP") return "up";
  if (object.range === "LEFT") return "left";
  if (object.range === "RIGHT") return "right";
  return "down";
}

/** cellX/cellY/facing/walkOffset/walking from an Overworld's OWN public API --
 * stepProgress is private, so walkOffset is derived from visualCell() instead:
 * how many of the 16 pixels of the CURRENT step the camera still has to close,
 * 0 at rest or while turning (visualCell() already collapses to cellX/cellY
 * in both cases). */
function spriteFromOverworld(overworld, spriteId) {
  const visual = overworld.visualCell();
  const offset = Math.round(
    Math.abs(overworld.cellX - visual[0]) * 16 + Math.abs(overworld.cellY - visual[1]) * 16
  );
  return {
    cellX: overworld.cellX, cellY: overworld.cellY, facing: overworld.facing,
    walkOffset: offset, walking: offset > 0, spriteId: spriteId,
  };
}

/** The same walkOffset derivation, off an NpcMotion pose's own visualX/visualY. */
function spriteFromPose(pose, spriteId) {
  const offset = Math.round(
    Math.abs(pose.x - pose.visualX) * 16 + Math.abs(pose.y - pose.visualY) * 16
  );
  return {
    cellX: pose.x, cellY: pose.y, facing: pose.facing,
    walkOffset: offset, walking: pose.walking, spriteId: spriteId,
  };
}

/** The OverworldView for the lens's current state: every visible object on
 * the current map (player plus NPCs), a connection-aware tileAt, and the
 * frame counter. Exported so a test can inspect the view a screen came from
 * without re-painting. */
export function buildView(headlessLens) {
  const overworld = headlessLens.overworld;
  const map = overworld.map;
  const reveals = headlessLens.loop.reveals();
  const npcs = [];
  for (const object of map.def.objects) {
    if (isObjectHidden(map.def.id, object, reveals)) {
      continue;
    }
    const pose = headlessLens.npcMotion.pose(object.name);
    if (pose) {
      npcs.push(spriteFromPose(pose, object.sprite));
    } else {
      const cell = map.objectCell(object);
      npcs.push({
        cellX: cell[0], cellY: cell[1], facing: shippedFacing(object),
        walkOffset: 0, walking: false, spriteId: object.sprite,
      });
    }
  }
  const neighbours = {};
  return {
    tilesetId: map.def.tileset,
    tileAt: (tx, ty) => connectedTileAt(headlessLens.bundle, map, neighbours, tx, ty),
    grassTile: map.tileset.grassTile,
    player: spriteFromOverworld(overworld, "SPRITE_RED"),
    npcs: npcs,
    frame: headlessLens.frameCount,
    // -1: no ROM counter to reproduce unless screenOf's own caller gives one
    // (tools/oracle/compare.mjs --screens, from the cartridge's own read) --
    // see OverworldCanvas.ts's OverworldView.animPhase.
    animPhase: -1,
    // ROCK TUNNEL without FLASH: the cartridge shows the whole LCD through
    // FadePal2, and the oracle compares these pixels against it.
    dark: overworld.isDark(),
  };
}

/** The 144x160 shade grid (row-major, top-down, values 0..3) GAME BOY mode
 * shows right now. A fresh GbCanvas every call: painting is stateless, and a
 * screen dump must never carry over the previous one's pixels. `animPhase`
 * (0..7) reproduces the cartridge's own water/flower animation step for a
 * pixel comparison; omitted, the tileset's static tiles draw untouched. */
export function screenOf(headlessLens, animPhase) {
  const canvas = new GbCanvas();
  const view = buildView(headlessLens);
  if (animPhase !== undefined) {
    view.animPhase = animPhase;
  }
  paintOverworld(canvas, headlessLens.bundle, view);
  const rows = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const row = [];
    const base = y * SCREEN_WIDTH;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      row.push(canvas.pixels[base + x]);
    }
    rows.push(row);
  }
  return rows;
}
