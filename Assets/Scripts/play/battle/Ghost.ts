// The GHOST in POKeMON TOWER.
//
// engine/battle/core.asm IsGhostBattle (:3309-3324) is the whole condition: a
// WILD battle, on a map between POKEMON_TOWER_1F and POKEMON_TOWER_7F, with no
// SILPH SCOPE in the bag. There is no flag anywhere -- the state is recomputed
// from the map and the bag every time it is asked -- so the scope works the
// moment it is picked up, mid-floor, with no script to notice.
//
// What it changes, each at its own site on the cartridge:
//
//   the opening   PrintBeginningBattleText (common_text.asm:31-60): no cry,
//                 "<NAME> appeared!" and "Darn! The GHOST can't be ID'd!"
//                 rather than "Wild GASTLY appeared!".
//   the name      InitWildBattle (:6695-6727) writes "GHOST" over the nick and
//                 swaps the front sprite for GhostPic.
//   attacking     PrintGhostText (:3281-3300): the player is too scared to
//                 move and the ghost only says "Get out... Get out..."; neither
//                 side's move runs.
//   catching      ItemUseBall (item_effects.asm:149-153) skips the capture
//                 calculation with the can't-be-caught value.
//   running       TryRunningFromBattle (:1496-1498) always succeeds.
//
// So the tower cannot be cleared without the scope, which is the point: it is
// what sends the player to the Game Corner.
//
// Not here: GhostPic itself. The extractor deliberately leaves MON_GHOST out
// of the species table (rom/datasets/pokemon.ts), so the disguised Pokemon is
// drawn with its own front sprite and only its NAME is the ghost's.

import type { BattleMon } from "./types";

/** Every floor of the tower; the cartridge uses the map-id range 1F..7F. */
const TOWER_PREFIX: string = "POKEMON_TOWER_";
export const SILPH_SCOPE: string = "SILPH_SCOPE";

/** What the nick becomes while the ghost is unidentified. */
export const GHOST_NAME: string = "GHOST";

export const TEXT_APPEARED: string = "_EnemyAppearedText";
export const TEXT_CANT_BE_IDD: string = "_GhostCantBeIDdText";
export const TEXT_SCARED: string = "_ScaredText";
export const TEXT_GET_OUT: string = "_GetOutText";
export const TEXT_UNVEILED: string = "_UnveiledGhostText";
/**
 * What BattleActors draws in place of a species while the foe is a ghost:
 * `bundle.pictures.ghost`, the cartridge's own GhostPic, in the palette of
 * MonsterPalettes entry 0 -- the slot MON_GHOST's dex number (none) reads.
 */
export const GHOST_PICTURE: string = "MON_GHOST";
export const GHOST_PALETTE: string = "MEWMON";

/**
 * IsGhostBattle: a wild battle in the tower with no SILPH SCOPE in the bag.
 *
 * `hasScope` is the caller's -- the bag lives in the save and the battle
 * engine has never been allowed to read it.
 */
export function isGhostBattle(mapId: string, hasScope: boolean): boolean {
  return !hasScope && mapId.indexOf(TOWER_PREFIX) === 0;
}

/** item_effects.asm: `cp POKEMON_TOWER_6F` / `cp RESTLESS_SOUL` -- Cubone's mother. */
export const RESTLESS_SOUL_MAP: string = "POKEMON_TOWER_6F";
export const RESTLESS_SOUL: string = "MAROWAK";

/** True for the one wild Pokemon a ball can never hold, scope or no scope. */
export function isRestlessSoul(mapId: string, species: string): boolean {
  return mapId === RESTLESS_SOUL_MAP && species === RESTLESS_SOUL;
}

/** The nick the foe fights under: its own, or the ghost's. */
export function ghostName(mon: BattleMon, ghost: boolean): string {
  return ghost ? GHOST_NAME : mon.name;
}
