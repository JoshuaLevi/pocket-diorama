// Using an item OUTSIDE a battle.
//
// The bag could be opened on the overworld and every item in it could be
// picked, and then nothing happened: the menu closed "rather than pretend".
// Four of the six item balls on Mt Moon's first floor -- a MOON STONE, a RARE
// CANDY, an ESCAPE ROPE and two POTIONs -- were dead weight, and REPEL, which
// the Pewter Mart sells, was a word.
//
// This is engine/items/item_effects.asm's out-of-battle half, as one pure
// decision: given the bag, the party and where the player is standing, what
// happens, what changes, and which of the cartridge's own lines and sounds
// say so. It writes the PlayState it is handed (the codebase's idiom: the
// battle engine's applyItemEffect writes its mon the same way) and returns
// the script the VM should run afterwards, so paging, the save gate and the
// encounter gate hold exactly as they do for every other conversation.
//
// What is here, each read against its ItemUse* routine:
//
//   medicine   potions and drinks, the five status cures, FULL HEAL, FULL
//              RESTORE, REVIVE and MAX REVIVE   (ItemUseMedicine)
//   vitamins   HP UP, PROTEIN, IRON, CARBOS, CALCIUM: +2560 stat experience,
//              refused at 25600                    (.useVitamin)
//   RARE CANDY one level, the exp for it, the HP gain, the moves learned at
//              that level, and a level evolution    (.useRareCandy)
//   stones     an ITEM evolution with that stone, else no effect
//                                                  (ItemUseEvoStone)
//   REPEL x3   100 / 200 / 250 steps               (ItemUseRepelCommon)
//   ESCAPE ROPE  five tilesets, never in Agatha's room, back to the fly
//              spot of the last blackout map       (ItemUseEscapeRope)
//   X items, GUARD SPEC, DIRE HIT, POKe DOLL, the balls
//              "OAK: This isn't the time to use that!"  (ItemUseNotTime)
//
// The three rods are here too, and their own file: Fishing.ts holds the rolls
// (ItemUseOldRod, ItemUseGoodRod, ItemUseSuperRod), this holds the rule about
// where a line may be cast at all.
//
// The BICYCLE is here too, with Bike.ts holding what riding means.
//
// What is NOT here, and closes the bag as it always did: the ITEMFINDER,
// the TOWN MAP, the COIN CASE, and every key item that is a plot token rather
// than a thing you use. Each is a system of its own and none of them is faked
// here.
//
// The PP items -- ETHER, MAX ETHER, ELIXER, MAX ELIXER, PP UP -- are
// battle/PpItems.ts; the three that work on one move get their "which
// technique?" from the menu, which hands the slot in with the target.

import type { WorldBundle } from "../world/WorldData";
import { castRod, fishingScript, isRod } from "./Fishing";
import { BICYCLE, bikeAllowed, bikeScript, TEXT_CANNOT_GET_OFF, TEXT_NO_CYCLING } from "./Bike";
import { fluteScript, POKE_FLUTE } from "./Flute";
import type { PlayState } from "./PlayState";
import { takeItem } from "./PlayState";
import type { BattleMon, StatSet } from "./battle/types";
import { STATUS_BURN, STATUS_FREEZE, STATUS_NONE, STATUS_PARALYSIS, STATUS_POISON, STATUS_SLEEP } from "./battle/types";
import { fillSlots } from "./script/Dialogue";
import { computeStats } from "./battle/Stats";
import { LEVEL_CAP, expForLevel, movesLearnedAt } from "./battle/Party";
import { EVO_ITEM } from "./battle/Evolution";
import type { ScriptCommand } from "./script/ScriptVM";
import { isPpItem, usePpItem } from "./battle/PpItems";

/** ItemUseNotTimeText, ItemUseNoEffectText: the two refusals. */
export const TEXT_NOT_TIME: string = "_ItemUseNotTimeText";
export const TEXT_NO_EFFECT: string = "_ItemUseNoEffectText";
/** "{PLAYER} used\n{ITEM}!" -- PrintItemUseTextAndRemoveItem's two halves as one box. */
export const TEXT_USED_ITEM: string = "{PLAYER} used\n{RAM:wStringBuffer}!";
export const TEXT_POTION: string = "_PotionText";
export const TEXT_REVIVE: string = "_ReviveText";
export const TEXT_VITAMIN_ROSE: string = "_VitaminStatRoseText";
export const TEXT_RARE_CANDY: string = "_RareCandyText";
export const TEXT_REPEL_WORE_OFF: string = "_RepelWoreOffText";

export const SOUND_HEAL_HP: string = "Heal_HP";
export const SOUND_HEAL_AILMENT: string = "Heal_Ailment";
export const SOUND_LEVEL_UP: string = "Level_Up";

/** The one map where the rope will not hold (ItemUseEscapeRope). */
export const ESCAPE_ROPE_FORBIDDEN_MAP: string = "AGATHAS_ROOM";
/** data/tilesets/escape_rope_tilesets.asm: where the rope works at all. */
export const ESCAPE_ROPE_TILESETS: string[] = ["FOREST", "CEMETERY", "CAVERN", "FACILITY", "INTERIOR"];
/** Where a blackout, the rope, DIG and TELEPORT land before any Center was used. */
export const FIRST_BLACKOUT_MAP: string = "PALLET_TOWN";

/** How many steps each REPEL buys (ItemUseRepel / SuperRepel / MaxRepel). */
const REPEL_STEPS: any = { REPEL: 100, SUPER_REPEL: 200, MAX_REPEL: 250 };

/** Heal amounts, .notUsingSoftboiled2. 0 means "to full"; -1 means half. */
const HEAL_AMOUNT: any = {
  POTION: 20, SUPER_POTION: 50, HYPER_POTION: 200, MAX_POTION: 0, FULL_RESTORE: 0,
  FRESH_WATER: 50, SODA_POP: 60, LEMONADE: 80,
  REVIVE: -1, MAX_REVIVE: 0,
};

/** The status each cure takes, and the party-menu line it prints. */
const STATUS_CURE: any = {
  ANTIDOTE: { status: STATUS_POISON, text: "_AntidoteText" },
  BURN_HEAL: { status: STATUS_BURN, text: "_BurnHealText" },
  ICE_HEAL: { status: STATUS_FREEZE, text: "_IceHealText" },
  AWAKENING: { status: STATUS_SLEEP, text: "_AwakeningText" },
  PARLYZ_HEAL: { status: STATUS_PARALYSIS, text: "_ParlyzHealText" },
  FULL_HEAL: { status: STATUS_NONE, text: "_FullHealText" },
};

/** Vitamin -> the stat it feeds and the word the cartridge prints for it. */
const VITAMIN: any = {
  HP_UP: { stat: "hp", name: "HEALTH" },
  PROTEIN: { stat: "attack", name: "ATTACK" },
  IRON: { stat: "defense", name: "DEFENSE" },
  CARBOS: { stat: "speed", name: "SPEED" },
  CALCIUM: { stat: "special", name: "SPECIAL" },
};
/** .useVitamin: refused once the MSB is 100, i.e. 25600 or more. */
const VITAMIN_CAP: number = 25600;
const VITAMIN_GAIN: number = 2560;

/** Items that are for a battle and nothing else (ItemUseNotTime outside one). */
const BATTLE_ONLY: string[] = [
  "X_ATTACK", "X_DEFEND", "X_SPEED", "X_SPECIAL", "X_ACCURACY", "GUARD_SPEC",
  "DIRE_HIT", "POKE_DOLL", "POKE_BALL", "GREAT_BALL", "ULTRA_BALL", "MASTER_BALL",
  "SAFARI_BALL",
];

const STONES: string[] = ["MOON_STONE", "FIRE_STONE", "THUNDER_STONE", "WATER_STONE", "LEAF_STONE"];

function listHas(list: string[], value: string): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) {
      return true;
    }
  }
  return false;
}

/** Whether this item, used outside a battle, asks "Use item on which POKeMON?". */
export function itemNeedsTarget(item: string): boolean {
  return HEAL_AMOUNT[item] !== undefined || STATUS_CURE[item] !== undefined ||
    VITAMIN[item] !== undefined || item === "RARE_CANDY" || listHas(STONES, item) ||
    isPpItem(item);
}

/** Whether the bag does anything at all with this item outside a battle. */
export function itemUsableOutside(item: string): boolean {
  return itemNeedsTarget(item) || REPEL_STEPS[item] !== undefined ||
    item === "ESCAPE_ROPE" || isRod(item) || item === BICYCLE || item === POKE_FLUTE ||
    listHas(BATTLE_ONLY, item);
}

/** Where the player is, as much of it as an item cares about. */
export interface ItemUsePlace {
  mapId: string;
  tileset: string;
  /**
   * Shore or water in front of the player, and whether they are already on it.
   *
   * IsNextTileShoreOrWater is the same test SURF uses, so the caller answers
   * it from the world rather than this file re-deriving it from a tile id.
   */
  waterAhead?: boolean;
  surfing?: boolean;
  /** Where the player stands: the POKe FLUTE asks which cell it is played on. */
  cellX?: number;
  cellY?: number;
}

/** A blackout landing: the fly spot of the last blackout map. */
export interface EscapeSpot {
  mapId: string;
  x: number;
  y: number;
}

export interface ItemUseOutcome {
  /** Ran through the VM afterwards: the lines and the sounds. */
  script: ScriptCommand[];
  /** One was taken from the bag. */
  consumed: boolean;
  /** Party index whose new level may teach these moves, in order; [] when none. */
  learnIndex: number;
  learn: string[];
  /** Party index that evolves, and into what; "" when nothing does. */
  evolveIndex: number;
  evolveTo: string;
  /** Set when the item is an ESCAPE ROPE that held. */
  escape: EscapeSpot;
}

function nothing(): ItemUseOutcome {
  return { script: [], consumed: false, learnIndex: -1, learn: [], evolveIndex: -1, evolveTo: "", escape: null };
}

function refused(textId: string): ItemUseOutcome {
  const out = nothing();
  out.script = [{ op: "show_text", textId: textId }];
  return out;
}

/**
 * The fly spot a blackout returns to: FlyWarpDataPtr of wLastBlackoutMap,
 * which SetLastBlackoutMap wrote from the last OUTDOOR map when the nurse
 * last healed you. PALLET_TOWN until she has (a new game's wLastBlackoutMap).
 */
export function blackoutSpot(bundle: WorldBundle, state: PlayState): EscapeSpot {
  const town = state.respawnLastMapId ? state.respawnLastMapId : FIRST_BLACKOUT_MAP;
  const spots = bundle.field ? bundle.field.flyWarps : null;
  const spot = spots ? spots[town] : null;
  if (!spot) {
    // A Center whose town has no fly spot does not exist in Red; the fallback
    // is the new-game one, and the print says which town lacked it.
    print("[ItemUse] no fly spot for " + town + "; landing in " + FIRST_BLACKOUT_MAP);
    const home = spots ? spots[FIRST_BLACKOUT_MAP] : null;
    return { mapId: FIRST_BLACKOUT_MAP, x: home ? home.x : 5, y: home ? home.y : 6 };
  }
  return { mapId: town, x: spot.x, y: spot.y };
}

/**
 * Use `item` on party member `partyIndex` (-1 for an item with no target).
 *
 * The bag's own rule -- is the item there at all -- is the caller's; this
 * assumes it is. Everything else is the cartridge's, per routine above.
 */
export function useItemOutside(bundle: WorldBundle, state: PlayState, item: string,
                               partyIndex: number, place: ItemUsePlace,
                               random?: () => number, moveSlot: number = -1): ItemUseOutcome {
  if (listHas(BATTLE_ONLY, item)) {
    return refused(TEXT_NOT_TIME);
  }
  if (REPEL_STEPS[item] !== undefined) {
    return useRepel(state, item);
  }
  if (item === "ESCAPE_ROPE") {
    return useEscapeRope(bundle, state, place);
  }
  if (isRod(item)) {
    return useRod(bundle, state, item, place, random ? random : Math.random);
  }
  if (item === BICYCLE) {
    return useBicycle(bundle, state, place);
  }
  if (item === POKE_FLUTE) {
    // A key item, never used up, and it says something wherever it is played.
    const out = nothing();
    out.script = fluteScript(bundle, state.flags, place.mapId,
                             place.cellX === undefined ? -1 : place.cellX,
                             place.cellY === undefined ? -1 : place.cellY);
    return out;
  }
  const mon = partyIndex >= 0 && partyIndex < state.party.length ? state.party[partyIndex] : null;
  if (mon === null) {
    return nothing();
  }
  if (HEAL_AMOUNT[item] !== undefined) {
    return useHealing(state, item, mon);
  }
  if (STATUS_CURE[item] !== undefined) {
    return useCure(state, item, mon);
  }
  if (VITAMIN[item] !== undefined) {
    return useVitamin(bundle, state, item, mon);
  }
  if (item === "RARE_CANDY") {
    return useRareCandy(bundle, state, mon, partyIndex);
  }
  if (listHas(STONES, item)) {
    return useStone(bundle, state, item, mon, partyIndex);
  }
  if (isPpItem(item)) {
    return usePp(bundle, state, item, partyIndex, moveSlot);
  }
  return nothing();
}

/**
 * ETHER, ELIXER and PP UP (battle/PpItems.ts). "It won't have any effect"
 * keeps the item; PP UP's "is maxed out" keeps it too and names the move.
 */
function usePp(bundle: WorldBundle, state: PlayState, item: string,
               partyIndex: number, moveSlot: number): ItemUseOutcome {
  const result = usePpItem(bundle, state.party[partyIndex], item, moveSlot);
  if (result.textId === "") {
    return refused(TEXT_NO_EFFECT);
  }
  const moveDef: any = result.move !== "" && bundle.moves ? (bundle.moves as any)[result.move] : null;
  const moveName: string = moveDef && moveDef.name ? moveDef.name : result.move;
  const out = nothing();
  out.script = [{ op: "show_text", textId: result.textId, ram: moveName }];
  if (result.used) {
    state.party[partyIndex] = result.mon;
    takeItem(state, item, 1);
    out.consumed = true;
    out.script = [{ op: "text_sound", name: SOUND_HEAL_AILMENT } as ScriptCommand].concat(out.script);
  }
  return out;
}

/**
 * On and off the BICYCLE (ItemUseBicycle, item_effects.asm:638-666).
 *
 * The cartridge's order exactly: surfing is refused first, then getting off
 * (which CYCLING ROAD does not allow), then whether riding is allowed here at
 * all. A bicycle is a key item and is never used up.
 */
function useBicycle(bundle: WorldBundle, state: PlayState, place: ItemUsePlace): ItemUseOutcome {
  if (place.surfing === true) {
    return refused(TEXT_NOT_TIME);
  }
  if (state.riding === true) {
    if (state.forcedBike === true) {
      return refused(TEXT_CANNOT_GET_OFF);
    }
    state.riding = false;
    const off = nothing();
    off.script = bikeScript(false);
    return off;
  }
  if (!bikeAllowed(bundle, place.mapId, place.tileset)) {
    return refused(TEXT_NO_CYCLING);
  }
  state.riding = true;
  const on = nothing();
  on.script = bikeScript(true);
  return on;
}

/**
 * Cast a rod (FishingInit, item_effects.asm:2765-2790).
 *
 * Three refusals, all of them the same line: in a battle, no shore or water in
 * front of you, or already surfing -- you cannot fish off your own Pokemon.
 * A rod is a key item and is never used up.
 */
function useRod(bundle: WorldBundle, state: PlayState, item: string,
                place: ItemUsePlace, random: () => number): ItemUseOutcome {
  if (place.surfing === true || place.waterAhead !== true) {
    return refused(TEXT_NOT_TIME);
  }
  const out = nothing();
  out.script = fishingScript(item, castRod(bundle, place.mapId, item, random), TEXT_USED_ITEM);
  return out;
}

function useRepel(state: PlayState, item: string): ItemUseOutcome {
  state.repelSteps = REPEL_STEPS[item];
  takeItem(state, item, 1);
  const out = nothing();
  out.consumed = true;
  out.script = [{ op: "show_text", textId: TEXT_USED_ITEM, ramItem: item }];
  return out;
}

function useEscapeRope(bundle: WorldBundle, state: PlayState, place: ItemUsePlace): ItemUseOutcome {
  if (place.mapId === ESCAPE_ROPE_FORBIDDEN_MAP || !listHas(ESCAPE_ROPE_TILESETS, place.tileset)) {
    return refused(TEXT_NOT_TIME);
  }
  const spot = blackoutSpot(bundle, state);
  takeItem(state, "ESCAPE_ROPE", 1);
  // The rope also clears the room's no-battle bit and resets the Safari Zone;
  // the first is a place here (inQuietZone) and the second is milestone 6's.
  const out = nothing();
  out.consumed = true;
  out.escape = spot;
  out.script = [
    { op: "fade", direction: "out", colour: "black" },
    { op: "warp", map: spot.mapId, x: spot.x, y: spot.y, facing: "down" },
    { op: "fade", direction: "in", colour: "black" },
  ];
  return out;
}

/**
 * .healHP: a fainted Pokemon takes only a REVIVE; a standing one takes
 * anything but; full HP is refused unless it is a FULL RESTORE with a status
 * to cure, which then becomes a FULL HEAL. REVIVE to half, the rest by amount
 * or to full; FULL RESTORE also clears the status. SFX_HEAL_HP, then
 * "{MON} recovered by N!" or "{MON} is revitalized!".
 */
function useHealing(state: PlayState, item: string, mon: BattleMon): ItemUseOutcome {
  const revive = item === "REVIVE" || item === "MAX_REVIVE";
  if (mon.hp <= 0 && !revive) {
    return refused(TEXT_NO_EFFECT);
  }
  if (mon.hp > 0 && revive) {
    return refused(TEXT_NO_EFFECT);
  }
  if (mon.hp >= mon.maxHp) {
    if (item !== "FULL_RESTORE" || mon.status === STATUS_NONE) {
      return refused(TEXT_NO_EFFECT);
    }
    return useCure(state, "FULL_HEAL", mon, "FULL_RESTORE");
  }
  const amount = HEAL_AMOUNT[item];
  const before = mon.hp;
  let after: number;
  if (amount === -1) {
    after = Math.floor(mon.maxHp / 2);
  } else if (amount === 0) {
    after = mon.maxHp;
  } else {
    after = mon.hp + amount;
  }
  mon.hp = after > mon.maxHp ? mon.maxHp : after;
  if (item === "FULL_RESTORE") {
    clearStatus(mon);
  }
  takeItem(state, item, 1);
  const out = nothing();
  out.consumed = true;
  out.script = [
    { op: "text_sound", name: SOUND_HEAL_HP },
    revive
      ? { op: "show_text", textId: TEXT_REVIVE, ram: mon.name }
      : { op: "show_text", textId: TEXT_POTION, ram: mon.name, num: mon.hp - before },
  ];
  return out;
}

function clearStatus(mon: BattleMon): void {
  mon.status = STATUS_NONE;
  mon.sleepTurns = 0;
  if (mon.volatile) {
    mon.volatile.badlyPoisoned = 0;
  }
}

/**
 * .cureStatusAilment: the item's own status, or any for a FULL HEAL; nothing
 * to cure is no effect. SFX_HEAL_AILMENT and the item's own line. `taken` is
 * the item actually removed from the bag, for the FULL RESTORE that turned
 * into a FULL HEAL at full HP.
 */
function useCure(state: PlayState, item: string, mon: BattleMon, taken?: string): ItemUseOutcome {
  const cure = STATUS_CURE[item];
  if (mon.status === STATUS_NONE || (cure.status !== STATUS_NONE && mon.status !== cure.status)) {
    return refused(TEXT_NO_EFFECT);
  }
  clearStatus(mon);
  takeItem(state, taken ? taken : item, 1);
  const out = nothing();
  out.consumed = true;
  out.script = [
    { op: "text_sound", name: SOUND_HEAL_AILMENT },
    { op: "show_text", textId: cure.text, ram: mon.name },
  ];
  return out;
}

/** The stats a Pokemon has right now from its base, DVs, stat exp and level. */
function recomputeStats(bundle: WorldBundle, mon: BattleMon): void {
  const species = bundle.species[mon.species];
  const grown: StatSet = computeStats(species.baseStats as StatSet, mon.ivs, mon.evs, mon.level);
  mon.stats = grown;
  mon.battleStats = { attack: grown.attack, defense: grown.defense, speed: grown.speed, special: grown.special };
}

/**
 * .useVitamin: 2560 stat experience to the one stat, refused once it holds
 * 25600 or more (the MSB test), then the stats recomputed. SFX_HEAL_AILMENT
 * and "{MON}'s {STAT} rose."
 */
function useVitamin(bundle: WorldBundle, state: PlayState, item: string, mon: BattleMon): ItemUseOutcome {
  const vitamin = VITAMIN[item];
  const evs = mon.evs as any;
  const current = typeof evs[vitamin.stat] === "number" ? evs[vitamin.stat] : 0;
  if (current >= VITAMIN_CAP) {
    return refused(TEXT_NO_EFFECT);
  }
  const raised = current + VITAMIN_GAIN;
  evs[vitamin.stat] = raised > 65535 ? 65535 : raised;
  // Max HP grows with HP stat experience; the cartridge's .recalculateStats
  // does not touch current HP, and neither does this.
  recomputeStats(bundle, mon);
  mon.maxHp = mon.stats.hp;
  if (mon.hp > mon.maxHp) {
    mon.hp = mon.maxHp;
  }
  takeItem(state, item, 1);
  // Two {RAM:} slots in one line -- the name and the stat -- and pagesOf puts
  // one value in every slot it finds, so the body is filled here and handed
  // over as words (the host takes anything that is not a label literally).
  const raw = bundle.text && typeof bundle.text[TEXT_VITAMIN_ROSE] === "string"
    ? bundle.text[TEXT_VITAMIN_ROSE] : "{RAM:wNameBuffer}'s\n{RAM:wStringBuffer} rose.";
  const out = nothing();
  out.consumed = true;
  out.script = [
    { op: "text_sound", name: SOUND_HEAL_AILMENT },
    { op: "show_text", textId: fillSlots(raw, [["wNameBuffer", mon.name], ["wStringBuffer", vitamin.name]]) },
  ];
  return out;
}

/**
 * .useRareCandy: level 100 is refused; else one level, the experience that
 * level starts at, the stats for it, and the gain in maximum HP added to the
 * current HP (a Pokemon at 3 HP is still nearly fainted). Then the cartridge
 * prints the stats box, runs LearnMoveFromLevelUp for the new level and
 * TryEvolvingMon WITHOUT the force flag -- a level evolution due now happens
 * now. The learning and the evolving are the caller's screens; this reports
 * what is owed.
 */
function useRareCandy(bundle: WorldBundle, state: PlayState, mon: BattleMon, partyIndex: number): ItemUseOutcome {
  if (mon.level >= LEVEL_CAP) {
    return refused(TEXT_NO_EFFECT);
  }
  const species = bundle.species[mon.species];
  const oldMax = mon.maxHp;
  mon.level = mon.level + 1;
  mon.exp = expForLevel(species.growthRate, mon.level);
  recomputeStats(bundle, mon);
  mon.maxHp = mon.stats.hp;
  const raised = mon.hp + (mon.maxHp - oldMax);
  mon.hp = raised > mon.maxHp ? mon.maxHp : raised;
  takeItem(state, "RARE_CANDY", 1);
  const out = nothing();
  out.consumed = true;
  out.learnIndex = partyIndex;
  out.learn = movesLearnedAt(species, mon.level);
  const to = levelEvolutionAt(bundle, mon);
  if (to !== "") {
    out.evolveIndex = partyIndex;
    out.evolveTo = to;
  }
  out.script = [
    { op: "text_sound", name: SOUND_LEVEL_UP },
    { op: "show_text", textId: TEXT_RARE_CANDY, ram: mon.name, num: mon.level },
  ];
  return out;
}

/** The LEVEL evolution this Pokemon has reached, or "". Not the stones. */
function levelEvolutionAt(bundle: WorldBundle, mon: BattleMon): string {
  const species = bundle.species[mon.species];
  if (!species || !species.evolutions) {
    return "";
  }
  for (let i = 0; i < species.evolutions.length; i++) {
    const evo = species.evolutions[i];
    if (evo && evo.method === "LEVEL" && mon.level >= evo.level && bundle.species[evo.species]) {
      return evo.species;
    }
  }
  return "";
}

/**
 * ItemUseEvoStone: SFX_HEAL_AILMENT, then TryEvolvingMon with the force flag
 * and the stone's id -- an ITEM evolution with THIS stone evolves, anything
 * else is no effect and the stone stays in the bag. The evolution scene
 * itself is the caller's; the stone is spent here because the cartridge
 * removes it before the scene, on wEvolutionOccurred.
 */
function useStone(bundle: WorldBundle, state: PlayState, item: string, mon: BattleMon, partyIndex: number): ItemUseOutcome {
  const species = bundle.species[mon.species];
  let to = "";
  if (species && species.evolutions) {
    for (let i = 0; i < species.evolutions.length; i++) {
      const evo = species.evolutions[i];
      if (evo && evo.method === EVO_ITEM && evo.item === item && bundle.species[evo.species]) {
        to = evo.species;
      }
    }
  }
  if (to === "") {
    return refused(TEXT_NO_EFFECT);
  }
  takeItem(state, item, 1);
  const out = nothing();
  out.consumed = true;
  out.evolveIndex = partyIndex;
  out.evolveTo = to;
  out.script = [{ op: "text_sound", name: SOUND_HEAL_AILMENT }];
  return out;
}

/**
 * One step with a REPEL running: TryDoWildEncounter decrements the counter
 * on every step that reaches the roll at all, and on the step it reaches
 * zero prints "REPEL's effect wore off." and rolls nothing. Returns the line
 * to show, or "".
 */
export function repelStep(state: PlayState): string {
  if (!(state.repelSteps > 0)) {
    return "";
  }
  state.repelSteps = state.repelSteps - 1;
  return state.repelSteps === 0 ? TEXT_REPEL_WORE_OFF : "";
}

/**
 * Whether a REPEL still running keeps this wild Pokemon away: yes when its
 * level is below the level of the FIRST party member -- fainted or not, it
 * is wPartyMon1Level the cartridge reads.
 */
export function repelBlocks(state: PlayState, wildLevel: number): boolean {
  if (!(state.repelSteps > 0) || state.party.length === 0) {
    return false;
  }
  return wildLevel < state.party[0].level;
}
