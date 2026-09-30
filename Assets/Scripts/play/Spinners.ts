// The arrow tiles that slide the player across a floor.
//
// scripts/RocketHideoutB2F.asm:17-35 (and B3F, and Viridian Gym) is the shape:
// the map's DEFAULT script looks the player's cell up in a table of arrow
// tiles, and on a hit sets BIT_SPINNING, plays SFX_ARROW_TILES and hands the
// pad a run of simulated presses -- DecodeArrowMovementRLE (home/map_objects.asm
// :5-27) unpacks them from a run-length list -- until the run is out.
//
// The whole table is already in the bundle as field.spinners, one entry per
// tile, each carrying the run it plays: 43 tiles on B2F, 16 on B3F and 12 in
// Viridian Gym, in playback order (the cartridge's index counts DOWN through
// its own list, and the extraction has already turned that round).
//
// So this file is small on purpose: it is a lookup and a script. The player
// turning a quarter clockwise on every step of the slide (spinners.asm:54-61)
// is Overworld.spriteFacing, switched on by PlayLoop for as long as the
// slide's script runs. The four blurred floor tiles swapping on alternate
// steps (:1-50) are still not drawn.

import type { WorldBundle } from "./../world/WorldData";
import type { ScriptCommand } from "./script/ScriptVM";

/** SFX_ARROW_TILES, the click the floor makes as it takes hold. */
export const SOUND_ARROW_TILES: string = "Arrow_Tiles";

/** The run of moves an arrow tile plays, or null when the cell is ordinary. */
export function spinnerAt(bundle: WorldBundle, mapId: string, x: number, y: number): any[] {
  const table = bundle.field ? bundle.field.spinners : null;
  const rows = table ? table[mapId] : null;
  if (!rows) {
    return null;
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].x === x && rows[i].y === y) {
      const moves = rows[i].moves;
      return moves && moves.length > 0 ? moves : null;
    }
  }
  return null;
}

/**
 * The slide, as the VM runs it: the sound, then the run.
 *
 * Each move_player walks the player through the ordinary step path, so a run
 * that meets a wall stops there -- which is what a simulated press does on the
 * cartridge too.
 */
export function spinnerScript(moves: any[]): ScriptCommand[] {
  const out: ScriptCommand[] = [{ op: "play_once", track: SOUND_ARROW_TILES }];
  for (let i = 0; i < moves.length; i++) {
    out.push({ op: "move_player", direction: moves[i].dir, steps: moves[i].count });
  }
  return out;
}
