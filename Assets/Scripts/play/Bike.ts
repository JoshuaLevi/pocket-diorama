// Riding the BICYCLE.
//
// engine/items/item_effects.asm ItemUseBicycle (:638-666) is the whole switch:
// in a battle or on the water it is not the time; already riding and you get
// off; otherwise IsBikeRidingAllowed (home/overworld.asm:842-869) decides, and
// "No cycling allowed here." is the answer where it is not. What riding then
// changes:
//
//   speed   DoBikeSpeedup (home/overworld.asm:376-388) advances the sprite
//           twice per frame, so a step takes 8 frames instead of 16.
//   music   PlayDefaultMusicCommon (home/audio.asm:21-27) plays
//           MUSIC_BIKE_RIDING over the map's own song while the state is 1.
//   sprite  RedBikeSprite. Not drawn: the player's billboard is built once
//           from SPRITE_RED and does not change for surfing either, so the
//           bike is owed together with the surf sprite.
//
// Where riding is allowed is a TILESET rule plus two maps by name, not a
// per-map script: data/tilesets/bike_riding_tilesets.asm and ROUTE_23 /
// INDIGO_PLATEAU, extracted whole as field.bikeRiding. LoadPlayerSpriteGraphics
// (:811-838) drops the player back to walking on a map where it is not
// allowed, which is why entering a building puts the bike away.
//
// CYCLING ROAD's own rules -- the forced mount on the cells outside both
// gates, and the downhill roll on ROUTE_17 -- are the forcedMovement table.
// The mount is here; the roll (JoypadOverworld:1817-1834, a simulated PAD_DOWN
// every frame nothing is held) belongs with milestone 6 and is not.

import type { WorldBundle } from "../world/WorldData";
import type { ScriptCommand } from "./script/ScriptVM";

export const BICYCLE: string = "BICYCLE";

/** The two pages of each line; the cartridge prints them as one text. */
export const TEXT_GOT_ON_1: string = "_GotOnBicycleText1";
export const TEXT_GOT_ON_2: string = "_GotOnBicycleText2";
export const TEXT_GOT_OFF_1: string = "_GotOffBicycleText1";
export const TEXT_GOT_OFF_2: string = "_GotOffBicycleText2";
export const TEXT_NO_CYCLING: string = "_NoCyclingAllowedHereText";
export const TEXT_CANNOT_GET_OFF: string = "_CannotGetOffHereText";
export const TEXT_CYCLING_IS_FUN: string = "_CyclingIsFunText";

/** A step on a bike is half a step on foot (8 frames against 16). */
export const BIKE_STEP_FACTOR: number = 0.5;

/** IsBikeRidingAllowed: two maps by name, or a tileset from the list. */
export function bikeAllowed(bundle: WorldBundle, mapId: string, tileset: string): boolean {
  const table = bundle.field ? bundle.field.bikeRiding : null;
  if (!table) {
    return false;
  }
  const maps = table.maps ? table.maps : [];
  for (let i = 0; i < maps.length; i++) {
    if (maps[i] === mapId) {
      return true;
    }
  }
  const tilesets = table.tilesets ? table.tilesets : [];
  for (let i = 0; i < tilesets.length; i++) {
    if (tilesets[i] === tileset) {
      return true;
    }
  }
  return false;
}

/**
 * Whether this cell puts the player on the bike whether they like it or not
 * (CheckForceBikeOrSurf, engine/overworld/player_state.asm:34-82).
 *
 * The same table carries SEAFOAM's two forced dives; `forcesSurf` reads those.
 */
export function forcesBike(bundle: WorldBundle, mapId: string, x: number, y: number): boolean {
  const table = bundle.field ? bundle.field.forcedMovement : null;
  const cells = table && table.tiles ? table.tiles[mapId] : null;
  if (!cells) {
    return false;
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].x === x && cells[i].y === y && cells[i].mode === "bike") {
      return true;
    }
  }
  return false;
}

/**
 * A cell that puts the player in the water whether they meant it or not.
 *
 * Two of them, both in SEAFOAM ISLANDS, both where a hole drops you into the
 * current below (CheckForceBikeOrSurf's other branch). Falling in is how you
 * arrive on B3F and B4F, so there is nobody to ask about SURF first.
 */
export function forcesSurf(bundle: WorldBundle, mapId: string, x: number, y: number): boolean {
  const table = bundle.field ? bundle.field.forcedMovement : null;
  const cells = table && table.tiles ? table.tiles[mapId] : null;
  if (!cells) {
    return false;
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].x === x && cells[i].y === y && cells[i].mode === "surf") {
      return true;
    }
  }
  return false;
}

/** ROUTE_17: the hill that pedals itself. Riding here can never be stopped. */
export function isSlopeMap(bundle: WorldBundle, mapId: string): boolean {
  const table = bundle.field ? bundle.field.forcedMovement : null;
  const maps = table && table.slopeMaps ? table.slopeMaps : [];
  for (let i = 0; i < maps.length; i++) {
    if (maps[i] === mapId) {
      return true;
    }
  }
  return false;
}

/** "{PLAYER} got on the BICYCLE!", or off it. */
export function bikeScript(gettingOn: boolean): ScriptCommand[] {
  return gettingOn
    ? [
      { op: "show_text", textId: TEXT_GOT_ON_1 },
      { op: "show_text", textId: TEXT_GOT_ON_2, ramItem: BICYCLE },
    ]
    : [
      { op: "show_text", textId: TEXT_GOT_OFF_1 },
      { op: "show_text", textId: TEXT_GOT_OFF_2, ramItem: BICYCLE },
    ];
}
