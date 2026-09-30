// The three rods, and what bites.
//
// engine/items/item_effects.asm ItemUseOldRod (:1826-1831), ItemUseGoodRod
// (:1833-1857) and ItemUseSuperRod (:1861-1865), with FishingInit (:2765-2790)
// deciding whether a cast is allowed at all and ReadSuperRodData (:2855-2898)
// reading the map's own table.
//
// Three rods, three ways of picking:
//
//   OLD ROD    always a bite, always MAGIKARP at level 5. No roll at all.
//   GOOD ROD   half the casts are a nibble; the rest are GOLDEEN or POLIWAG
//              at level 10 (data/wild/good_rod.asm).
//   SUPER ROD  nothing at all on a map with no fishing group; otherwise half
//              the casts are a nibble and the rest come from the map's own
//              group of up to four (data/wild/super_rod.asm, extracted as
//              field.superRod).
//
// The rolls are transcribed bit for bit rather than written as percentages,
// because the cartridge's own arithmetic is where the odds come from: ONE
// random byte, bit 0 decides bite or nibble, and bits 1-2 index the group with
// a re-roll whenever they name a row the group does not have. A "50%" written
// straight would agree on the average and disagree with the oracle on the
// byte.
//
// What is not here: the rod sprite, the ten-frame pause, the shake and the
// exclamation bubble of FishingAnim (player_animations.asm:378-450). The waits
// are, so a cast takes as long as it does on hardware.

import type { WorldBundle } from "../world/WorldData";
import type { ScriptCommand } from "./script/ScriptVM";
import { randomByte } from "./battle/Damage";

export const OLD_ROD: string = "OLD_ROD";
export const GOOD_ROD: string = "GOOD_ROD";
export const SUPER_ROD: string = "SUPER_ROD";

/** FishingAnim's three endings. */
export const TEXT_BITE: string = "_ItsABiteText";
export const TEXT_NIBBLE: string = "_NoNibbleText";
export const TEXT_NOTHING_HERE: string = "_NothingHereText";

/** SFX_HEAL_AILMENT, which FishingInit plays as the line is shown. */
export const SOUND_CAST: string = "Heal_Ailment";

/** FishingInit's 80 frames, and FishingAnim's 10 + 100 before it answers. */
export const CAST_FRAMES: number = 80;
export const ANIM_FRAMES: number = 110;

/** MAGIKARP at 5: the Old Rod's only catch. */
const OLD_ROD_SPECIES: string = "MAGIKARP";
const OLD_ROD_LEVEL: number = 5;

/** GoodRodMons, in the table's order: bits 1-2 of the byte pick one. */
const GOOD_ROD_MONS: any[] = [
  { species: "GOLDEEN", level: 10 },
  { species: "POLIWAG", level: 10 },
];

/**
 * A cast's answer: a bite with what took it, a nibble, or -- the Super Rod on
 * a map with no fishing group -- nothing here at all.
 */
export interface FishingBite {
  /** "bite", "nibble" or "nothing". */
  kind: string;
  species: string;
  level: number;
}

export function isRod(item: string): boolean {
  return item === OLD_ROD || item === GOOD_ROD || item === SUPER_ROD;
}

function bite(species: string, level: number): FishingBite {
  return { kind: "bite", species: species, level: level };
}

function nibble(): FishingBite {
  return { kind: "nibble", species: "", level: 0 };
}

/**
 * One draw of the cartridge's index: bit 0 is bite-or-not, bits 1-2 are the
 * row, re-rolled while they name a row that is not there.
 *
 * Returns -1 for a nibble, else the row. The re-roll is capped: on hardware it
 * draws until it lands, and a test handing out one constant byte would spin.
 */
function rollRow(rows: number, random: () => number): number {
  for (let tries = 0; tries < 32; tries++) {
    const byte = randomByte(random);
    if ((byte & 1) !== 0) {
      return -1;
    }
    const row = (byte >> 1) & 3;
    if (row < rows) {
      return row;
    }
  }
  return -1;
}

/** The map's Super Rod group, or null when it has none. */
export function superRodGroup(bundle: WorldBundle, mapId: string): any[] {
  const table = bundle.field ? bundle.field.superRod : null;
  const group = table ? table[mapId] : null;
  return group && group.length > 0 ? group : null;
}

/** Cast `rod` on `mapId`: what takes it, if anything. */
export function castRod(bundle: WorldBundle, mapId: string, rod: string,
                        random: () => number): FishingBite {
  if (rod === OLD_ROD) {
    return bite(OLD_ROD_SPECIES, OLD_ROD_LEVEL);
  }
  if (rod === GOOD_ROD) {
    const row = rollRow(GOOD_ROD_MONS.length, random);
    return row < 0 ? nibble() : bite(GOOD_ROD_MONS[row].species, GOOD_ROD_MONS[row].level);
  }
  const group = superRodGroup(bundle, mapId);
  if (group === null) {
    return { kind: "nothing", species: "", level: 0 };
  }
  const row = rollRow(group.length, random);
  return row < 0 ? nibble() : bite(group[row].species, group[row].level);
}

/**
 * The cast, as the lines and waits the player sees.
 *
 * `usedText` is ItemUseText00, which the caller owns because every other item
 * prints it too. A bite ends in a wild battle with the roll already taken out,
 * which is what static_battle is: no flag, so nothing is remembered.
 */
export function fishingScript(item: string, taken: FishingBite, usedText: string): ScriptCommand[] {
  const out: ScriptCommand[] = [
    { op: "show_text", textId: usedText, ramItem: item },
    { op: "text_sound", name: SOUND_CAST },
    { op: "wait", frames: CAST_FRAMES },
    { op: "wait", frames: ANIM_FRAMES },
  ];
  if (taken.kind === "nothing") {
    out.push({ op: "show_text", textId: TEXT_NOTHING_HERE });
    return out;
  }
  if (taken.kind === "nibble") {
    out.push({ op: "show_text", textId: TEXT_NIBBLE });
    return out;
  }
  out.push({ op: "show_text", textId: TEXT_BITE });
  out.push({ op: "static_battle", species: taken.species, level: taken.level, flag: "" });
  return out;
}
