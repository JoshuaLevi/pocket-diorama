// GAME BOY mode's own per-frame view: the OverworldView paintOverworld wants,
// built from the SAME live objects the diorama uses -- Overworld, NpcMotion,
// the current map's own object list -- not a second model of the same world.
//
// This mirrors test/headlessscreen.mjs's buildView(headlessLens) field for
// field (spriteFromOverworld, spriteFromPose, shippedFacing, the connection-
// aware tileAt, a fresh `neighbours` cache every call): one runs headless in
// the oracle harness, this one runs in the live lens, over the identical
// Overworld/NpcMotion shapes, so the two are provably the same construction
// rather than two hand-kept copies that can drift. See SPEC.md "GAME BOY
// mode -- design" and OverworldCanvas.ts's own header for the measured facts
// this painter reproduces.
//
// The other half owned here is the cartridge's own tile-animation counter
// (WRAM 0xD085; OverworldCanvas.ts's header): it cycles 0..7, one step every
// 21 frames, at the DMG's OWN ~59.7275 Hz -- not the Lens's frame rate, which
// varies with load. GameBoyAnimClock advances a frame accumulator from dt at
// that fixed rate and derives the same phase, so the water rotation and the
// flower frame play at the cartridge's own speed regardless of how fast or
// slow the Lens itself is ticking.

import type { MapObject, WorldBundle } from "../../world/WorldData";
import { playerSpriteId } from "../PlayerSprite";
import { isObjectHidden, shippedFacing } from "../../world/WorldData";
import type { Overworld } from "../Overworld";
import type { NpcMotion, NpcPose } from "../NpcMotion";
import type { OverworldSprite, OverworldView } from "./OverworldCanvas";
import { connectedTileAt } from "./OverworldCanvas";

/** The DMG's own frame rate: a 4.194304 MHz clock, 70224 cycles per frame. */
export const GB_FPS: number = 59.7275;
/** WRAM 0xD085 holds each of its 8 values for this many GB frames -- OverworldCanvas.ts's header. */
const FRAMES_PER_ANIM_STEP: number = 21;
const ANIM_PHASES: number = 8;
const ANIM_CYCLE_FRAMES: number = FRAMES_PER_ANIM_STEP * ANIM_PHASES;

/**
 * The cartridge's own tile-animation counter, kept at the DMG's rate rather
 * than the Lens's. One instance lives for as long as GAME BOY mode's
 * overworld is being driven; it is never reset on a map change or a warp --
 * the real counter is a free-running WRAM byte, not something a map entry
 * touches.
 */
export class GameBoyAnimClock {
  private frames: number = 0;

  tick(dt: number): void {
    this.frames = (this.frames + dt * GB_FPS) % ANIM_CYCLE_FRAMES;
  }

  /** 0..7, WRAM 0xD085's own value right now. */
  phase(): number {
    return Math.floor(this.frames / FRAMES_PER_ANIM_STEP);
  }
}

/**
 * cellX/cellY/facing/walkOffset/walking from an Overworld's OWN public API.
 * stepProgress is private, so walkOffset is derived from visualCell()
 * instead: how many of the 16 pixels of the CURRENT step the camera still
 * has to close, 0 at rest or while turning (visualCell() already collapses
 * to cellX/cellY in both cases) -- the same derivation
 * test/headlessscreen.mjs uses, so a screen built here and one built there
 * agree given the same Overworld state.
 */
function spriteFromOverworld(overworld: Overworld, spriteId: string): OverworldSprite {
  const visual = overworld.visualCell();
  const offset = Math.round(
    Math.abs(overworld.cellX - visual[0]) * 16 + Math.abs(overworld.cellY - visual[1]) * 16
  );
  return {
    // spriteFacing: the sprite turns on an arrow tile's slide (Overworld.ts).
    cellX: overworld.cellX, cellY: overworld.cellY, facing: overworld.spriteFacing(),
    walkOffset: offset, walking: offset > 0, spriteId: spriteId,
  };
}

/** The same walkOffset derivation, off an NpcMotion pose's own visualX/visualY. */
function spriteFromPose(pose: NpcPose, spriteId: string): OverworldSprite {
  const offset = Math.round(
    Math.abs(pose.x - pose.visualX) * 16 + Math.abs(pose.y - pose.visualY) * 16
  );
  return {
    cellX: pose.x, cellY: pose.y, facing: pose.facing,
    walkOffset: offset, walking: pose.walking, spriteId: spriteId,
  };
}

/**
 * The OverworldView for the lens's OWN live state right now: every visible
 * object on the current map (player plus NPCs), a connection-aware tileAt,
 * and the measured tile-animation phase. `reveals` is `PlayLoop.reveals()`
 * (or null before a world's own loop exists), the same table
 * PokemonAR.rebuildNpcs already reads for the diorama's cast.
 */
export function buildGameBoyView(bundle: WorldBundle, overworld: Overworld,
                                  npcMotion: NpcMotion, reveals: any,
                                  frame: number, animPhase: number): OverworldView {
  const map = overworld.map;
  const objects = map.def.objects;
  const npcs: OverworldSprite[] = [];
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    if (isObjectHidden(map.def.id, object, reveals)) {
      continue;
    }
    const pose = npcMotion.pose(object.name);
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
  // Fresh every call, exactly like test/headlessscreen.mjs's buildView: a
  // neighbour's MapRuntime is cheap to rebuild and a cache held across a
  // warp would answer for the map the player just left.
  const neighbours: any = {};
  return {
    tilesetId: map.def.tileset,
    tileAt: (tx: number, ty: number) => connectedTileAt(bundle, map, neighbours, tx, ty),
    grassTile: map.tileset.grassTile,
    player: spriteFromOverworld(overworld, playerSpriteId(overworld.riding, overworld.surfing, bundle)),
    // ROCK TUNNEL without FLASH is dark on the flat screen too: the cartridge
    // darkens by swapping the palette the whole LCD is shown through, and the
    // diorama's lit window is this view's business, not the world's.
    dark: overworld.isDark(),
    npcs: npcs,
    frame: frame,
    animPhase: animPhase,
  };
}
