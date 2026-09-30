// The overworld, drawn exactly as the cartridge draws it, on the flat 160x144
// Game Boy screen. See SPEC.md "GAME BOY mode -- design" and "The cartridge
// as oracle": every fact below is measured against PyBoy
// (tools/oracle/compare.mjs --screens), not assumed, and PLAYTEST.md's
// "GAME BOY mode" section carries the same facts for a human.
//
// Measured, not guessed:
//   - the player's 16x16 sprite sits at screen tiles (8,8)-(9,9): world tile
//     (tx,ty) draws at screen tile (tx - cellX*2 + 8, ty - cellY*2 + 8).
//     Confirmed byte for byte against wTileMap in REDS_HOUSE_2F (player at
//     step cell (3,6)) and in Pallet Town (step cell (12,12)) -- the whole
//     20x18 grid matched the bundle's own block/tile computation both times,
//     with no special-casing needed at the map edges.
//   - every overworld sprite -- player and NPC alike -- draws 4px HIGHER than
//     that tile-aligned anchor: OAM Y=76 (screen pixel row 60) for a sprite
//     whose tile-aligned position would put it at pixel row 64. Fixed, not a
//     function of facing or position (measured identically in the bedroom
//     and in Pallet Town).
//   - standing in tall grass sets the OBJ-to-BG priority bit (attr bit 7) on
//     the sprite's BOTTOM two OAM tiles only: the grass tile's own ink shows
//     through the lower 8 rows of the sprite instead of the sprite drawing
//     over it. Measured on Route 1's grass at step cell (10,1): bit 7 off on
//     plain ground, on the instant the player's own cell tile equals the
//     tileset's grassTile.
//   - every overworld character sprite draws through OBP0, not through the
//     background's identity palette (BGP reads E4 -- index N is shade N --
//     which is why the tile grid above needed no such correction). OBP0
//     itself read D0 in both the bedroom and Pallet Town: index 0 AND 1 both
//     shade 0 (paper), 2 comes out as shade 1, 3 as shade 3 (black). A
//     sprite's raw 2bpp bit-plane value is not a shade index the way a
//     background tile's is; every OAM tile sampled (player and an ordinary
//     standing NPC alike) used OBP0, none OBP1.
//   - water and flower tile ids never change on wTileMap -- Gen 1 animates
//     them by rewriting the tile's OWN pattern-table graphic instead, which
//     is why the bundle carries them as a separate `tileset.animation` asset
//     (rom/datasets/tilesets.ts's emitAnimationTiles; still ROM-derived, still
//     gitignored, same as every other pixel in the bundle -- nothing here
//     ships an animation bitmap in committed source). WRAM 0xD085 cycles 0..7
//     once every 21 frames and alone drives both: the water tile is the
//     tileset's own shipped bitmap rotated WATER_ROTATION_BY_PHASE[counter]
//     columns, and the flower tile shows flowerFrames[FLOWER_FRAME_BY_PHASE
//     [counter]] (tools/oracle, GAME BOY mode pass 2 -- PLAYTEST.md has the
//     full measurement, corrected in pass 3: the water table was one column
//     short at every entry). `view.animPhase` carries that counter's value so
//     a frame can be reproduced exactly; -1 (or anything outside 0..7) leaves
//     the tileset's own static sheet tile alone, which is why every existing
//     caller that never sets it keeps working unchanged.

import type { WorldBundle } from "../../world/WorldData";
import { MapRuntime } from "../../world/MapRuntime";
import { frameFor } from "../../world/SpriteBillboard";
import { GbCanvas, imageFromPacked } from "./GbCanvas";
import type { ShadeImage } from "./GbCanvas";

/** One 8px tile, one 16px step. */
const TILE: number = 8;
const STEP_PIXELS: number = 16;
/** The player's tile-aligned screen anchor: tiles (8,8)-(9,9), pixel (64,64) -- measured. */
const ANCHOR_TILE: number = 8;
const ANCHOR_PIXEL: number = ANCHOR_TILE * TILE;
/** Every overworld sprite draws 4px above its tile-aligned position -- measured. */
const SPRITE_LIFT_PIXELS: number = 4;
const SPRITE_SIZE: number = 16;
/** Screen tile columns/rows to cover, plus one for whatever the walk offset spills past the edge. */
const SCREEN_TILE_COLS: number = 21;
const SCREEN_TILE_ROWS: number = 19;
/**
 * OBP0, the palette every overworld character sprite draws through --
 * measured (tools/oracle, GAME BOY mode pass): register D0, and index 0 AND
 * 1 both come out as paper, only 2 and 3 carry ink (2 as shade 1, not 2).
 * A sprite's raw 2bpp value is not a shade index the way a tile's is.
 */
const SPRITE_PALETTE: number[] = [0, 0, 1, 3];

/** One drawn character: the player, or one visible map object. */
export interface OverworldSprite {
  cellX: number;
  cellY: number;
  facing: string;
  /** 0..16: pixels of the CURRENT step the camera still has to close. 0 at rest or while turning. */
  walkOffset: number;
  walking: boolean;
  spriteId: string;
}

export interface OverworldView {
  /** The current map's own tileset id, e.g. "OVERWORLD" -- selects bundle.tilesets[...] for the sheet. */
  tilesetId: string;
  /**
   * World tile id at any tile coordinate on the 8px grid; already border- and
   * connection-aware exactly like MapRuntime.tileAt, but able to reach past
   * this map's own edge into a connected neighbour's tiles -- see
   * `connectedTileAt`, which is what a caller builds this from.
   */
  tileAt: (tx: number, ty: number) => number;
  /** The current tileset's grass tile id, for the sprite priority rule; -1 when it has none. */
  grassTile: number;
  player: OverworldSprite;
  npcs: OverworldSprite[];
  /** Frames since boot. Not read by this file; carried for the caller. */
  frame: number;
  /**
   * The measured WRAM tile-animation counter (0..7 -- see the animation note
   * above), so the water rotation and the flower frame reproduce exactly the
   * ROM's own step. Anything outside 0..7 (a screen with no ROM to read, or a
   * caller that has not been taught this yet) leaves the tileset's static
   * sheet tile alone instead of guessing.
   */
  animPhase: number;
  /**
   * The screen is dark (wMapPalOffset != 0): ROCK TUNNEL without FLASH.
   *
   * LoadGBPal (home/fade.asm:3-19) is the whole of the cartridge's darkness:
   * the offset indexes FadePal4 backwards, and 6 lands on FadePal2, whose BGP
   * and OBP0 are both 3,3,3,2 -- every shade but 3 comes out black, and 3
   * comes out as shade 2. Nothing else about the frame changes, which is why
   * this is a palette pass over the finished picture rather than a rule
   * inside the painter.
   */
  dark?: boolean;
}

/** FadePal2 (home/fade.asm:66): what every shade becomes in the dark. */
const DARK_PALETTE: number[] = [3, 3, 3, 2];

/**
 * A tile id beyond `map`'s own bounds, following a connection when the
 * coordinate falls off the edge a connection names and the border block
 * everywhere else -- one hop, mirroring Overworld.crossConnection's cell-space
 * math one level up in tile space (tiles = cells * 2 = blocks * 4).
 *
 * Verified for a zero offset (Pallet Town <-> Route 1: the whole 20x18
 * wTileMap matched with no connection crossed yet, since the viewport reaches
 * the connection before the player's own cell does). A nonzero offset is not
 * independently pixel-verified here; the formula is the same one
 * Overworld.crossConnection already uses for every map transition in the
 * existing scenario suite, just applied at an arbitrary distance past the
 * edge instead of only at the exact seam cell.
 *
 * Single-hop: a coordinate that lands outside the NEIGHBOUR's own bounds too
 * reads that neighbour's own border block, without following a second
 * connection. True for every map this project ships within the 8-tile
 * lookahead a screen needs (checked: Pallet Town, Route 1 and Viridian City
 * all name tileset OVERWORLD, so a neighbour's tiles always read correctly
 * off the sheet `paintOverworld` already has loaded).
 */
export function connectedTileAt(bundle: WorldBundle, map: MapRuntime, neighbours: any,
                                 tx: number, ty: number): number {
  const widthTiles = map.widthTiles;
  const heightTiles = map.heightTiles;
  if (tx >= 0 && ty >= 0 && tx < widthTiles && ty < heightTiles) {
    return map.tileAt(tx, ty);
  }
  let compass = "";
  if (ty < 0) {
    compass = "north";
  } else if (ty >= heightTiles) {
    compass = "south";
  } else if (tx < 0) {
    compass = "west";
  } else if (tx >= widthTiles) {
    compass = "east";
  }
  const connection = compass ? map.connection(compass) : null;
  if (!connection) {
    return map.tileAt(tx, ty);
  }
  const bundleAny: any = bundle;
  const neighbourDef = bundleAny.maps[connection.map];
  if (!neighbourDef) {
    return map.tileAt(tx, ty);
  }
  let neighbour: MapRuntime = neighbours[connection.map];
  if (!neighbour) {
    neighbour = new MapRuntime(neighbourDef, bundleAny.tilesets[neighbourDef.tileset]);
    neighbours[connection.map] = neighbour;
  }
  let nx = tx;
  let ny = ty;
  if (compass === "north") {
    ny = neighbour.heightTiles + ty;
    nx = tx - connection.offset * 4;
  } else if (compass === "south") {
    ny = ty - heightTiles;
    nx = tx - connection.offset * 4;
  } else if (compass === "west") {
    nx = neighbour.widthTiles + tx;
    ny = ty - connection.offset * 4;
  } else {
    nx = tx - widthTiles;
    ny = ty - connection.offset * 4;
  }
  return neighbour.tileAt(nx, ny);
}

/** A sprite sheet's raw shade indices, remapped through OBP0. A new image:
 * the caller's own imageFromPacked() result is never mutated. */
function throughSpritePalette(img: ShadeImage): ShadeImage {
  const shades = new Uint8Array(img.shades.length);
  for (let i = 0; i < shades.length; i++) {
    shades[i] = SPRITE_PALETTE[img.shades[i]];
  }
  return { width: img.width, height: img.height, shades: shades, alpha: img.alpha };
}

/** A sprite's own world pixel position (top-left of its 16x16 box), mid-step included. */
function refPixel(sprite: OverworldSprite): number[] {
  let x = sprite.cellX * STEP_PIXELS;
  let y = sprite.cellY * STEP_PIXELS;
  if (sprite.facing === "left") {
    x += sprite.walkOffset;
  } else if (sprite.facing === "right") {
    x -= sprite.walkOffset;
  } else if (sprite.facing === "up") {
    y += sprite.walkOffset;
  } else if (sprite.facing === "down") {
    y -= sprite.walkOffset;
  }
  return [x, y];
}

/**
 * The water tile's own rotation, and the flower tile's own frame, indexed by
 * the measured WRAM counter (0..7) -- tools/oracle, GAME BOY mode pass 2,
 * Pallet Town's pond, cross-checked against the tileset's own shipped bitmap.
 *
 * Both cycle over the SAME 8-tick period (168 frames): the flower does not
 * advance on every tick (it shares 8 water ticks across only 3 frames), and
 * the two repeating values in a row here (index 0/1 and 4/5) are that hold,
 * not a mistake.
 *
 * WATER_ROTATION_BY_PHASE was re-measured in GAME BOY mode pass 3, walking
 * one full 0..7 cycle with the counter and PyBoy's OWN water-tile VRAM bytes
 * sampled together every frame (tools/oracle/oracle.py, no separate
 * `--screens` capture involved): every entry the earlier pass shipped was
 * exactly one column short of what the cartridge actually draws --
 * `tileset.animation.waterFrame` (the tileset's shipped, unrotated bitmap)
 * decodes to the counter reading **7**, not 0 as previously assumed; that
 * assumption was never itself checked against a live frame. The corrected
 * table is the old one with 1 subtracted from every entry (equivalently, one
 * column further in whichever direction that entry already rotated).
 * FLOWER_FRAME_BY_PHASE re-measured clean against the same walk: unchanged --
 * a decoy along the way, though: sampling the instant the counter changes
 * catches the FLOWER tile's own graphic one frame before its redraw catches
 * up (it still shows the previous phase's frame for exactly that one frame),
 * which first looked like the table itself was wrong. The water tile showed
 * no such lag -- every one of its 8 phases held one constant, unchanging
 * rotation for its whole ~21-frame window in this same measurement -- so
 * only the table's own values needed correcting, not the sampling method.
 */
const WATER_ROTATION_BY_PHASE: number[] = [-1, -2, -3, -4, -3, -2, -1, 0];
const FLOWER_FRAME_BY_PHASE: number[] = [0, 0, 1, 2, 0, 0, 1, 2];

/** True for a value this file treats as "a real counter reading", 0..7. */
function isAnimPhase(phase: number): boolean {
  return phase >= 0 && phase <= 7;
}

/**
 * One 8x8 packed shade tile, every row rotated left by `amount` columns
 * (negative rotates right), wrapping -- the per-row transform measured on
 * the cartridge's own animated water tile. Rotating at the shade level
 * rather than the raw 2bpp bytes gives the same pixels regardless of which
 * shade values a tileset's water art happens to use (every one shipped here
 * only ever uses two, but the transform does not depend on that).
 */
function rotateTileRowsLeft(shades: Uint8Array, amount: number): Uint8Array {
  const shift = ((amount % 8) + 8) % 8;
  const out = new Uint8Array(64);
  for (let row = 0; row < 8; row++) {
    const base = row * 8;
    for (let col = 0; col < 8; col++) {
      out[base + col] = shades[base + ((col + shift) % 8)];
    }
  }
  return out;
}

/**
 * The frame-specific water/flower tiles to substitute while painting the
 * background, or null when the tileset does not animate or `phase` is not a
 * counter reading this file can reproduce -- see `isAnimPhase`.
 */
function animationOverrides(tileset: any, phase: number): any {
  const animation = tileset ? tileset.animation : null;
  if (!animation || !isAnimPhase(phase)) {
    return null;
  }
  const p = Math.floor(phase);
  let waterTile = -1;
  let waterImage: ShadeImage = null;
  if (typeof animation.waterTile === "number" && animation.waterTile >= 0 && animation.waterFrame) {
    const base = imageFromPacked({ width: 8, height: 8, shades: animation.waterFrame, alpha: "" });
    if (base) {
      waterTile = animation.waterTile;
      waterImage = { width: 8, height: 8, shades: rotateTileRowsLeft(base.shades, WATER_ROTATION_BY_PHASE[p]), alpha: null };
    }
  }
  let flowerTile = -1;
  let flowerImage: ShadeImage = null;
  if (typeof animation.flowerTile === "number" && animation.flowerTile >= 0 && animation.flowerFrames) {
    const packed = animation.flowerFrames[FLOWER_FRAME_BY_PHASE[p]];
    const image = packed ? imageFromPacked({ width: 8, height: 8, shades: packed, alpha: "" }) : null;
    if (image) {
      flowerTile = animation.flowerTile;
      flowerImage = image;
    }
  }
  return { waterTile: waterTile, waterImage: waterImage, flowerTile: flowerTile, flowerImage: flowerImage };
}

function paintBackground(canvas: GbCanvas, sheet: ShadeImage, tilesPerRow: number,
                          view: OverworldView, refX: number, refY: number, overrides: any): void {
  const originX = refX - ANCHOR_PIXEL;
  const originY = refY - ANCHOR_PIXEL;
  const tileOriginX = Math.floor(originX / TILE);
  const tileOriginY = Math.floor(originY / TILE);
  const subPixelX = originX - tileOriginX * TILE;
  const subPixelY = originY - tileOriginY * TILE;
  for (let row = 0; row < SCREEN_TILE_ROWS; row++) {
    const worldTy = tileOriginY + row;
    const screenY = row * TILE - subPixelY;
    for (let col = 0; col < SCREEN_TILE_COLS; col++) {
      const worldTx = tileOriginX + col;
      const screenX = col * TILE - subPixelX;
      const tileId = view.tileAt(worldTx, worldTy);
      if (overrides && tileId === overrides.waterTile) {
        canvas.blitPart(overrides.waterImage, 0, 0, TILE, TILE, screenX, screenY, false);
        continue;
      }
      if (overrides && tileId === overrides.flowerTile) {
        canvas.blitPart(overrides.flowerImage, 0, 0, TILE, TILE, screenX, screenY, false);
        continue;
      }
      const sx = (tileId % tilesPerRow) * TILE;
      const sy = Math.floor(tileId / tilesPerRow) * TILE;
      canvas.blitPart(sheet, sx, sy, TILE, TILE, screenX, screenY, false);
    }
  }
}

function paintSprite(canvas: GbCanvas, bundle: WorldBundle, view: OverworldView,
                      sprite: OverworldSprite, refX: number, refY: number): void {
  const bundleAny: any = bundle;
  const spriteDef: any = bundleAny.sprites ? bundleAny.sprites[sprite.spriteId] : null;
  if (!spriteDef) {
    return;
  }
  const raw = imageFromPacked({
    width: spriteDef.width, height: spriteDef.height,
    shades: spriteDef.shades, alpha: spriteDef.alpha,
  });
  if (!raw) {
    return;
  }
  const sheet = throughSpritePalette(raw);
  const rows = Math.floor(sheet.height / SPRITE_SIZE);
  const [frameIndex, flip] = frameFor(sprite.facing, sprite.walking);
  const safeFrame = frameIndex < 0 || frameIndex >= rows ? 0 : frameIndex;
  const sy = safeFrame * SPRITE_SIZE;
  const [px, py] = refPixel(sprite);
  const screenX = px - refX + ANCHOR_PIXEL;
  const screenY = py - refY + ANCHOR_PIXEL - SPRITE_LIFT_PIXELS;
  const onGrass = view.grassTile >= 0 &&
    view.tileAt(sprite.cellX * 2, sprite.cellY * 2 + 1) === view.grassTile;
  const hFlip = flip === 1;
  const half = SPRITE_SIZE / 2;
  // Two halves, not one blit: only the BOTTOM one ever draws behind grass ink
  // (measured: the priority bit sits on the bottom two OAM tiles only).
  canvas.blitPartMasked(sheet, 0, sy, SPRITE_SIZE, half, screenX, screenY, true, hFlip, false);
  canvas.blitPartMasked(sheet, 0, sy + half, SPRITE_SIZE, half, screenX, screenY + half, true, hFlip, onGrass);
}

/**
 * Paints the overworld -- background, then every NPC, then the player -- onto
 * `canvas`. Draws no menu or message box; a screens comparison is skipped
 * while either machine has one open (tools/oracle/compare.mjs --screens).
 */
export function paintOverworld(canvas: GbCanvas, bundle: WorldBundle, view: OverworldView): void {
  canvas.clear(0);
  const bundleAny: any = bundle;
  const tileset: any = bundleAny.tilesets ? bundleAny.tilesets[view.tilesetId] : null;
  if (!tileset) {
    return;
  }
  const sheet = imageFromPacked({
    width: tileset.tileWidth, height: tileset.tileHeight, shades: tileset.shades, alpha: "",
  });
  if (!sheet) {
    return;
  }
  const overrides = animationOverrides(tileset, view.animPhase);
  const [refX, refY] = refPixel(view.player);
  paintBackground(canvas, sheet, tileset.tilesPerRow, view, refX, refY, overrides);
  // Freezes the background for blitPartMasked's behindInk test (GbCanvas.ts):
  // a sprite drawn after this point must never be mistaken for ground ink
  // under a LATER sprite's own grass-masked half (measured regression: an
  // NPC painted here first, standing where the player's masked half lands,
  // made that check read the NPC's own ink off the live composite instead of
  // the ground and hide the player's own leg pixel under grass that was
  // never there).
  canvas.snapshotBackground();
  for (let i = 0; i < view.npcs.length; i++) {
    paintSprite(canvas, bundle, view, view.npcs[i], refX, refY);
  }
  paintSprite(canvas, bundle, view, view.player, refX, refY);
  if (view.dark === true) {
    canvas.remapShades(DARK_PALETTE);
  }
}
