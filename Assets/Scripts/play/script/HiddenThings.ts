// The things in a room that are not objects: the man on the bench, and what
// is buried under a tile.
//
// The cartridge calls both HIDDEN EVENTS and handles them in one routine
// (engine/overworld/hidden_events.asm CheckForHiddenEvent): press A, and the
// cell IN FRONT of the player is looked up in the current map's list -- not
// the cell the player is standing on, which is the guess a reader of the
// itemfinder would make. A matching entry runs a routine, and two of the
// routines are worth a lens:
//
//   PrintBenchGuyText  twelve men drawn into the tilemap rather than placed as
//                      sprites. Each has a required facing, so the one on the
//                      left-hand bench answers only when you face LEFT at him.
//   HiddenItems        an item under a tile, given once, with the cartridge's
//                      own "found" line and a jingle; a full bag leaves it
//                      buried.
//
// Both tables are already extracted -- field.hiddenExtras.benchGuys and
// field.hiddenItems, 15 maps and 39 maps -- and until this file nothing read
// either. The Poke Balls on the floor have always worked (ItemBall.ts); these
// are the ones with nothing to see.
//
// The found flag is this project's own name rather than the cartridge's:
// wObtainedHiddenItemsFlags is a bit per entry in one game-wide table, and a
// save keyed by strings has no use for the numbering. The cell is the name.

import type { WorldBundle } from "../../world/WorldData";
import type { ScriptCommand } from "./ScriptVM";
import { slotMachineAt } from "./Slots";

/** FoundHiddenItemText, and the line for a bag with no room left. */
export const FOUND_HIDDEN_TEXT: string = "_FoundHiddenItemText";
export const HIDDEN_NO_ROOM_TEXT: string = "_HiddenItemBagFullText";
/** SFX_GET_ITEM_2, the second of the two pickup jingles. */
export const HIDDEN_ITEM_SOUND: string = "Get_Item2";

/** The save's name for "this cell has already been dug up". */
export function hiddenItemFlag(mapId: string, x: number, y: number): string {
  return "EVENT_FOUND_HIDDEN_" + mapId + "_" + x + "_" + y;
}

/**
 * Which words a bench guy's POINTER stands for.
 *
 * The manifest carries the label BenchGuyTextPointers names -- the pointer --
 * and the text table is keyed by the label its `text_far` names, which is a
 * different string for eleven of the twelve and not derivable from it:
 * CeruleanCityPokecenterBenchGuyText's words are `_CeruleanPokecenterGuyText`,
 * with the City gone. Transcribed from engine/events/hidden_events/
 * bench_guys.asm:34-100, one line per `label:: text_far body` pair.
 *
 * SAFFRON_POKECENTER is deliberately absent: its pointer is `text_asm` and
 * branches on EVENT_BEAT_SILPH_CO_GIOVANNI between two lines, so it is a
 * script and belongs with Silph Co. The three Safari rest houses are absent
 * from the cartridge's own table, so their benches are as mute here as there.
 */
const BENCH_GUY_TEXT: any = {
  ViridianCityPokecenterBenchGuyText: "_ViridianCityPokecenterGuyText",
  PewterCityPokecenterBenchGuyText: "_PewterCityPokecenterGuyText",
  CeruleanCityPokecenterBenchGuyText: "_CeruleanPokecenterGuyText",
  LavenderCityPokecenterBenchGuyText: "_LavenderPokecenterGuyText",
  MtMoonPokecenterBenchGuyText: "_MtMoonPokecenterBenchGuyText",
  RockTunnelPokecenterBenchGuyText: "_RockTunnelPokecenterGuyText",
  VermilionCityPokecenterBenchGuyText: "_VermilionPokecenterGuyText",
  CeladonCityPokecenterBenchGuyText: "_CeladonCityPokecenterGuyText",
  FuchsiaCityPokecenterBenchGuyText: "_FuchsiaCityPokecenterGuyText",
  CinnabarIslandPokecenterBenchGuyText: "_CinnabarPokecenterGuyText",
  CeladonCityHotelText: "_CeladonCityHotelText",
};

/**
 * What the bench guy at the faced cell says, or null.
 *
 * `textFacing` is the direction the PLAYER must be facing -- SPRITE_FACING_LEFT
 * for every one of them -- which is how a man drawn against the left wall
 * ignores you until you turn to him. (The entry's own `facing` is the tile's,
 * and Saffron's two disagree.) The cartridge's loop has a famous bug on the
 * mismatch, reading past the end of its table; that is not reproduced here.
 */
export function benchGuyScript(bundle: WorldBundle, mapId: string, x: number,
                               y: number, facing: string): ScriptCommand[] {
  const extras = bundle.field ? bundle.field.hiddenExtras : null;
  const byMap = extras && extras.benchGuys ? extras.benchGuys[mapId] : null;
  if (!byMap) {
    return null;
  }
  for (let i = 0; i < byMap.length; i++) {
    const guy = byMap[i];
    if (guy.x !== x || guy.y !== y || guy.textFacing !== facing) {
      continue;
    }
    const body = guy.text ? BENCH_GUY_TEXT[guy.text] : null;
    if (!body) {
      return null;
    }
    return [{ op: "show_text", textId: body }];
  }
  return null;
}

/**
 * The item buried under the faced cell, or null when there is none or it has
 * already been found.
 *
 * FoundHiddenItemText's own asm gives the item, sets the flag and rings
 * SFX_GET_ITEM_2, and on a full bag says so and leaves the item where it is --
 * which is what a give_item with a no-room line does here, because the VM
 * stops the script on a refusal and the set_flag after it never runs.
 */
export function hiddenItemScript(bundle: WorldBundle, flags: any, mapId: string,
                                 x: number, y: number): ScriptCommand[] {
  const byMap = bundle.field && bundle.field.hiddenItems ? bundle.field.hiddenItems[mapId] : null;
  if (!byMap) {
    return null;
  }
  for (let i = 0; i < byMap.length; i++) {
    const buried = byMap[i];
    if (buried.x !== x || buried.y !== y) {
      continue;
    }
    const flag = hiddenItemFlag(mapId, x, y);
    if (flags[flag] === true) {
      return null;
    }
    return [
      { op: "give_item", item: buried.item, count: 1, noRoom: HIDDEN_NO_ROOM_TEXT },
      { op: "set_flag", flag: flag },
      { op: "text_sound", name: HIDDEN_ITEM_SOUND },
      { op: "show_text", textId: FOUND_HIDDEN_TEXT, ramItem: buried.item },
    ];
  }
  return null;
}

/** PrintTrashText's one line, for the cans that hold no switch. */
export const TRASH_TEXT: string = "_VermilionGymTrashText";

/**
 * "Nope, there's only trash here." -- the two empty cans in the S.S. Anne's
 * kitchen and the one beside LT. SURGE, or null.
 *
 * The table's direction is the hidden event's argument byte. PrintBenchGuyText
 * reads it as the facing the player must have; PrintTrashText
 * (engine/events/hidden_events/vermilion_gym_trash.asm:1-3) never looks at it,
 * so these answer from whichever side you press A, as they do on the cartridge.
 */
export function printTrashScript(bundle: WorldBundle, mapId: string, x: number, y: number): ScriptCommand[] {
  const extras = bundle.field ? bundle.field.hiddenExtras : null;
  const byMap = extras && extras.printTrash ? extras.printTrash[mapId] : null;
  if (!byMap) {
    return null;
  }
  for (let i = 0; i < byMap.length; i++) {
    if (byMap[i].x === x && byMap[i].y === y) {
      return [{ op: "show_text", textId: TRASH_TEXT }];
    }
  }
  return null;
}

/** GymStatueText1 (the badge not yet won) and GymStatueText2 (the player's name added). */
export const GYM_STATUE_TEXT: string = "_GymStatueText1";
export const GYM_STATUE_TEXT_WON: string = "_GymStatueText2";

/**
 * MapBadgeFlags (data/maps/badge_maps.asm) joined with each gym script's
 * .LoadNames: the city and the leader the plaque names, and the badge whose
 * bit in wBeatGymFlags decides which of the two texts it shows.
 */
const GYM_PLAQUES: any = {
  PEWTER_GYM: { city: "PEWTER CITY", leader: "BROCK", badge: "BOULDERBADGE" },
  CERULEAN_GYM: { city: "CERULEAN CITY", leader: "MISTY", badge: "CASCADEBADGE" },
  VERMILION_GYM: { city: "VERMILION CITY", leader: "LT.SURGE", badge: "THUNDERBADGE" },
  CELADON_GYM: { city: "CELADON CITY", leader: "ERIKA", badge: "RAINBOWBADGE" },
  FUCHSIA_GYM: { city: "FUCHSIA CITY", leader: "KOGA", badge: "SOULBADGE" },
  SAFFRON_GYM: { city: "SAFFRON CITY", leader: "SABRINA", badge: "MARSHBADGE" },
  CINNABAR_GYM: { city: "CINNABAR ISLAND", leader: "BLAINE", badge: "VOLCANOBADGE" },
  VIRIDIAN_GYM: { city: "VIRIDIAN CITY", leader: "GIOVANNI", badge: "EARTHBADGE" },
};

/**
 * The plaque on a gym statue, or null.
 *
 * GymStatues (engine/events/hidden_events/gym_statues.asm) answers only when
 * the player faces UP, names the city and the leader, and lists the rival among
 * the WINNING TRAINERS -- with the player's own name under his once the badge
 * is won. The two names are the cartridge's {RAM:wGymCityName} and
 * {RAM:wGymLeaderName}; a show_text carries one slot and this line has two, so
 * they are filled here and the words go to the VM as they will be read.
 */
export function gymStatueScript(bundle: WorldBundle, mapId: string, x: number, y: number,
                                facing: string, hasBadge: (badge: string) => boolean): ScriptCommand[] {
  if (facing !== "up") {
    return null;
  }
  const plaque = GYM_PLAQUES[mapId];
  const extras = bundle.field ? bundle.field.hiddenExtras : null;
  const byMap = extras && extras.gymStatues ? extras.gymStatues[mapId] : null;
  if (!plaque || !byMap) {
    return null;
  }
  let here = false;
  for (let i = 0; i < byMap.length; i++) {
    if (byMap[i].x === x && byMap[i].y === y) {
      here = true;
    }
  }
  if (!here) {
    return null;
  }
  const textId = hasBadge(plaque.badge) ? GYM_STATUE_TEXT_WON : GYM_STATUE_TEXT;
  const body = bundle.text ? bundle.text[textId] : null;
  if (!body) {
    return null;
  }
  const filled = body.split("{RAM:wGymCityName}").join(plaque.city)
    .split("{RAM:wGymLeaderName}").join(plaque.leader);
  return [{ op: "show_text", textId: filled }];
}

/** FoundHiddenCoinsText, and its jingle: SFX_GET_ITEM_2, as a hidden item's is. */
export const FOUND_COINS_TEXT: string = "_FoundHiddenCoinsText";
export const DROPPED_COINS_TEXT: string = "_DroppedHiddenCoinsText";

/** The save's name for a pile already picked up. */
export function hiddenCoinFlag(mapId: string, x: number, y: number): string {
  return "EVENT_FOUND_COINS_" + mapId + "_" + x + "_" + y;
}

/**
 * The coins under the faced cell, or null.
 *
 * HiddenCoins (engine/events/hidden_items.asm:52-119) differs from HiddenItems
 * in three ways worth reproducing:
 *
 *   No COIN CASE, no answer. The routine returns before anything is said --
 *   not a refusal, silence -- so the pile is still there later.
 *   The pile declared as 40 pays 20. `cp 40 / jr z, .bcd20` with the
 *   disassembly's own comment "should be bcd40"; the .bcd40 branch is dead
 *   code. The manifest carries the declared 40, so the reader is where the
 *   typo has to live.
 *   A slot machine on the same cell wins. CheckForHiddenEvent walks the map's
 *   list in order and takes the FIRST coordinate match; the machine at (12,15)
 *   is listed before the pile there, so that pile can never be picked up.
 */
export function hiddenCoinScript(bundle: WorldBundle, flags: any, hasCoinCase: boolean,
                                 mapId: string, x: number, y: number): ScriptCommand[] {
  if (!hasCoinCase) {
    return null;
  }
  const byMap = bundle.field && bundle.field.hiddenCoins ? bundle.field.hiddenCoins[mapId] : null;
  if (!byMap) {
    return null;
  }
  for (let i = 0; i < byMap.length; i++) {
    const pile = byMap[i];
    if (pile.x !== x || pile.y !== y) {
      continue;
    }
    // A slot machine on the same cell wins, whichever way the player is
    // facing: CheckForHiddenObject takes the FIRST coordinate match and the
    // machines are listed before the piles, so the machine's own facing check
    // failing does not fall through to the coins underneath it.
    if (slotMachineAt(bundle, mapId, x, y) !== null) {
      return null;
    }
    const flag = hiddenCoinFlag(mapId, x, y);
    if (flags[flag] === true) {
      return null;
    }
    const coins = pile.coins === 40 ? 20 : pile.coins;
    return [
      { op: "give_coins", amount: coins },
      { op: "set_flag", flag: flag },
      { op: "show_text", textId: FOUND_COINS_TEXT, num: coins },
      { op: "text_sound", name: HIDDEN_ITEM_SOUND },
    ];
  }
  return null;
}
