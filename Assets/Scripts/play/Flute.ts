// The POKe FLUTE, and the two SNORLAX it is for.
//
// engine/items/item_effects.asm ItemUsePokeFlute (:1671-1705). Outside a
// battle the flute asks one question: is there a SNORLAX asleep next to you?
// On ROUTE_12 the four cells around (10,62) and on ROUTE_16 the two beside
// (26,10) -- Route12SnorlaxFluteCoords and Route16SnorlaxFluteCoords at
// :1774-1784 -- answer yes until that road's snorlax is beaten. Everywhere
// else, and standing anywhere else on those two roads, it is just a catchy
// tune.
//
// The cartridge splits what follows across two frames: the flute sets
// EVENT_FIGHT_ROUTE12_SNORLAX and the map's default script picks it up next
// frame (scripts/Route12.asm:24-43), wakes him, hides the sprite BEFORE the
// battle and fights SNORLAX at 30. Here it is one program, the way the dock's
// departure is, because the lens has no per-frame map script.
//
// Two differences worth knowing:
//
//   Caught or beaten reads the same. The cartridge skips the calmed-down line
//   when wBattleResult says caught (:50-56); check_battle_result only knows
//   the battle was not lost, so the line is shown either way.
//
//   In a battle the flute wakes the whole party (:1706-1730). That is the
//   battle bag's business and is not here.

import type { WorldBundle } from "../world/WorldData";
import type { ScriptCommand } from "./script/ScriptVM";

export const POKE_FLUTE: string = "POKE_FLUTE";

export const TEXT_HAD_EFFECT: string = "_PlayedFluteHadEffectText";
export const TEXT_NO_EFFECT: string = "_PlayedFluteNoEffectText";

/** One road's sleeping obstacle: where he is, who wakes him, what he says. */
interface SnorlaxSpot {
  mapId: string;
  npc: string;
  /** The cells the flute is heard from: his four (or two) neighbours. */
  cells: number[][];
  flag: string;
  wokeText: string;
  calmedText: string;
}

const SNORLAX_SPOTS: SnorlaxSpot[] = [
  {
    mapId: "ROUTE_12",
    npc: "ROUTE12_SNORLAX",
    cells: [[9, 62], [10, 61], [10, 63], [11, 62]],
    flag: "EVENT_BEAT_ROUTE12_SNORLAX",
    wokeText: "_Route12SnorlaxWokeUpText",
    calmedText: "_Route12SnorlaxCalmedDownText",
  },
  {
    mapId: "ROUTE_16",
    npc: "ROUTE16_SNORLAX",
    cells: [[27, 10], [25, 10]],
    flag: "EVENT_BEAT_ROUTE16_SNORLAX",
    wokeText: "_Route16SnorlaxWokeUpText",
    calmedText: "_Route16SnorlaxReturnedToMountainsText",
  },
];

/** SNORLAX is level 30 on both roads (scripts/Route12.asm:33-36). */
const SNORLAX_LEVEL: number = 30;

/** The snorlax this cell is next to, or null. */
export function snorlaxBeside(mapId: string, x: number, y: number): SnorlaxSpot {
  for (let i = 0; i < SNORLAX_SPOTS.length; i++) {
    const spot = SNORLAX_SPOTS[i];
    if (spot.mapId !== mapId) {
      continue;
    }
    for (let k = 0; k < spot.cells.length; k++) {
      if (spot.cells[k][0] === x && spot.cells[k][1] === y) {
        return spot;
      }
    }
  }
  return null;
}

/**
 * What playing the flute here does.
 *
 * `flags` is the save's flag store: a snorlax that has already been moved is
 * not there to wake, and the flute is only a tune again.
 */
export function fluteScript(bundle: WorldBundle, flags: any, mapId: string,
                            x: number, y: number): ScriptCommand[] {
  const spot = snorlaxBeside(mapId, x, y);
  if (spot === null || flags[spot.flag] === true) {
    return [{ op: "show_text", textId: TEXT_NO_EFFECT }];
  }
  void bundle;
  return [
    { op: "show_text", textId: TEXT_HAD_EFFECT },
    { op: "show_text", textId: spot.wokeText },
    // Hidden BEFORE the fight, as the cartridge hides him (:37-39): lose to
    // him and the road is open anyway, which is the cartridge's own outcome.
    { op: "hide_object", map: spot.mapId, npc: spot.npc },
    { op: "static_battle", species: "SNORLAX", level: SNORLAX_LEVEL, flag: spot.flag },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
    // Route12.asm $564C and Route16.asm $598F both read wBattleResult and
    // skip the line when it is 2. A SNORLAX in a ball did not calm down and
    // wander back to the mountains; the flag is set either way, so the road
    // is open whichever happened.
    { op: "check_caught" },
    { op: "jump_if_true", to: "end" },
    { op: "show_text", textId: spot.calmedText },
  ];
}
