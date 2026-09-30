// The POKeMON MANSION's four switches, and the seventeen doors they move.
//
// None of this is in the extraction: the mansion's floors ship with no bg
// events at all, and the switches are hidden objects whose handler is a
// facing check. Read out of the cartridge -- the switch handlers at bank $11
// $4316 and bank $14 $6037/$627A/$6420, the hidden-object entries that name
// them, and the four redraw routines at bank $11 $42C5 and bank $14 $5FEE,
// $6204 and $63CF.
//
// There is ONE bit for the whole building, $D796 bit 0 ($437F toggles it), so
// every switch in the mansion is the same switch: pressing any of them moves
// every door on every floor at once. The floors' redraw routines read that one
// bit and call ReplaceTileBlock four, three, two and four times.
//
// A switch is read from the cell BELOW it, facing up, which is what
// `ld a,[$C109]; cp $04; ret nz` says.

import type { ScriptCommand } from "./ScriptVM";

/** $D796 bit 0: one bit for the whole building. */
export const EVENT_MANSION_SWITCH_ON: string = "EVENT_MANSION_SWITCH_ON";

export const TEXT_SWITCH: string = "_PokemonMansion1FSwitchText";
export const TEXT_PRESSED: string = "_PokemonMansion1FSwitchPressedText";
export const TEXT_NOT_PRESSED: string = "_PokemonMansion1FSwitchNotPressedText";

/** SFX_SWITCH, the click it makes ($437A plays $AD). */
export const SOUND_SWITCH: string = "Switch";

/** Where each floor's switch is, in cells; read from the cell below it. */
const SWITCHES: any = {
  POKEMON_MANSION_1F: [{ x: 2, y: 5 }],
  POKEMON_MANSION_2F: [{ x: 2, y: 11 }],
  POKEMON_MANSION_3F: [{ x: 10, y: 5 }],
  POKEMON_MANSION_B1F: [{ x: 20, y: 3 }, { x: 18, y: 25 }],
};

/**
 * The doors, in BLOCK coordinates, with the block each shows.
 *
 * `off` is what stands there while the bit is clear and `on` what stands
 * there once it is set -- which is the order the redraw routines are written
 * in, `bit 0,a / jr nz` taking the second branch.
 */
const DOORS: any = {
  // bank $11 $42C5
  POKEMON_MANSION_1F: [
    { bx: 12, by: 6, off: 0x0e, on: 0x2d },
    { bx: 8, by: 3, off: 0x2d, on: 0x0e },
    { bx: 10, by: 8, off: 0x2d, on: 0x0e },
    { bx: 13, by: 13, off: 0x2d, on: 0x0e },
  ],
  // bank $14 $5FEE
  POKEMON_MANSION_2F: [
    { bx: 4, by: 2, off: 0x0e, on: 0x5f },
    { bx: 9, by: 4, off: 0x54, on: 0x0e },
    { bx: 3, by: 11, off: 0x5f, on: 0x0e },
  ],
  // bank $14 $6204
  POKEMON_MANSION_3F: [
    { bx: 7, by: 2, off: 0x0e, on: 0x5f },
    { bx: 7, by: 5, off: 0x5f, on: 0x0e },
  ],
  // bank $14 $63CF
  POKEMON_MANSION_B1F: [
    { bx: 13, by: 8, off: 0x0e, on: 0x2d },
    { bx: 6, by: 11, off: 0x0e, on: 0x5f },
    { bx: 4, by: 3, off: 0x5f, on: 0x0e },
    { bx: 8, by: 8, off: 0x54, on: 0x0e },
  ],
};

/** The floors that have any of this. */
export function mansionFloors(): string[] {
  return Object.keys(DOORS);
}

/** The switch on a cell, or null. */
export function mansionSwitchAt(mapId: string, x: number, y: number): any {
  const rows = SWITCHES[mapId];
  if (!rows) {
    return null;
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].x === x && rows[i].y === y) {
      return rows[i];
    }
  }
  return null;
}

/** Every switch cell on a floor, for a test to walk to. */
export function mansionSwitches(mapId: string): any[] {
  const rows = SWITCHES[mapId];
  return rows ? rows : [];
}

/**
 * The doors as block-override rows: closed while the bit is clear, open once
 * it is set. "Open" here is only which block stands there -- half of them are
 * a wall when the bit is SET, which is the whole point of a switch that both
 * opens and closes.
 */
export function mansionOverrides(): any {
  const out: any = {};
  const floors = Object.keys(DOORS);
  for (let i = 0; i < floors.length; i++) {
    const doors = DOORS[floors[i]];
    const rows = [];
    for (let d = 0; d < doors.length; d++) {
      rows.push({
        bx: doors[d].bx,
        by: doors[d].by,
        closedBlock: doors[d].off,
        openBlock: doors[d].on,
        flags: [EVENT_MANSION_SWITCH_ON],
        all: true,
        inverted: false,
        keyItem: "",
        disabled: false,
      });
    }
    out[floors[i]] = rows;
  }
  return out;
}

/**
 * Pressing one ($435A).
 *
 * "A switch! Press it?" -- no and it says you left it alone; yes and it says
 * so, clicks, and flips the one bit the whole building reads.
 */
export function mansionSwitchScript(on: boolean): ScriptCommand[] {
  return [
    { op: "ask", textId: TEXT_SWITCH },
    { op: "jump_if_false", to: "left_alone" },
    { op: "show_text", textId: TEXT_PRESSED },
    { op: "text_sound", name: SOUND_SWITCH },
    on
      ? { op: "clear_flag", flag: EVENT_MANSION_SWITCH_ON }
      : { op: "set_flag", flag: EVENT_MANSION_SWITCH_ON },
    { op: "jump", to: "end" },
    { op: "label", name: "left_alone" },
    { op: "show_text", textId: TEXT_NOT_PRESSED },
  ] as ScriptCommand[];
}
