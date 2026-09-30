// The two lifts, and the floors they will take you to.
//
// A lift car in Red has no destination of its own: on every map load it
// rewrites BOTH of its own warp entries to the floor the player boarded from
// (CeladonMartElevator.asm:16-32, RocketHideoutElevator.asm:16-32), so
// stepping straight back out returns you where you were. Picking a floor from
// the panel rewrites them again, to that floor's own lift door
// (engine/events/elevator.asm:24-44), and the doors then open on a different
// floor -- which is why the car needs no animation to travel.
//
// The lens reproduces that with a per-session warp override rather than by
// editing the map: Overworld.overrideWarp is written when the player boards
// and again when a floor is chosen, and cleared on every map entry.
//
// The tables are the cartridge's own, and the warp numbers in them are
// zero-based indices into the DESTINATION map's warp list -- each naming that
// floor's lift door. CELADON_MART_1F's is index 5, every other Mart floor's is
// index 2, and the hideout's are 4, 4 and 2.

/** One lift: the rows the panel shows and where each one lets you out. */
export interface ElevatorFloor {
  label: string;
  map: string;
  /** Index into that map's own warps: the door of this lift. */
  warp: number;
}

export interface ElevatorDef {
  /** The cells the car's own two warps sit on. */
  doors: number[][];
  floors: ElevatorFloor[];
  /** The key the panel asks for, or "" when it asks for nothing. */
  keyItem: string;
  /** What it says without that key. */
  noKeyText: string;
}

const ELEVATORS: any = {
  CELADON_MART_ELEVATOR: {
    doors: [[1, 3], [2, 3]],
    floors: [
      { label: "1F", map: "CELADON_MART_1F", warp: 5 },
      { label: "2F", map: "CELADON_MART_2F", warp: 2 },
      { label: "3F", map: "CELADON_MART_3F", warp: 2 },
      { label: "4F", map: "CELADON_MART_4F", warp: 2 },
      { label: "5F", map: "CELADON_MART_5F", warp: 2 },
    ],
    keyItem: "",
    noKeyText: "",
  },
  // SILPH CO's, and the tallest list in the game: every floor from the lobby
  // to Giovanni's office. Its two warps ship pointing at UNUSED_MAP_ED, which
  // is the cartridge saying out loud that a lift car's warps are written at
  // runtime and never read as shipped.
  SILPH_CO_ELEVATOR: {
    doors: [[1, 3], [2, 3]],
    floors: [
      { label: "1F", map: "SILPH_CO_1F", warp: 3 },
      { label: "2F", map: "SILPH_CO_2F", warp: 2 },
      { label: "3F", map: "SILPH_CO_3F", warp: 2 },
      { label: "4F", map: "SILPH_CO_4F", warp: 2 },
      { label: "5F", map: "SILPH_CO_5F", warp: 2 },
      { label: "6F", map: "SILPH_CO_6F", warp: 2 },
      { label: "7F", map: "SILPH_CO_7F", warp: 2 },
      { label: "8F", map: "SILPH_CO_8F", warp: 2 },
      { label: "9F", map: "SILPH_CO_9F", warp: 2 },
      { label: "10F", map: "SILPH_CO_10F", warp: 2 },
      { label: "11F", map: "SILPH_CO_11F", warp: 1 },
    ],
    keyItem: "",
    noKeyText: "",
  },
  // B3F is deliberately not offered: the cartridge's list is three long.
  ROCKET_HIDEOUT_ELEVATOR: {
    doors: [[2, 1], [3, 1]],
    floors: [
      { label: "B1F", map: "ROCKET_HIDEOUT_B1F", warp: 4 },
      { label: "B2F", map: "ROCKET_HIDEOUT_B2F", warp: 4 },
      { label: "B4F", map: "ROCKET_HIDEOUT_B4F", warp: 2 },
    ],
    keyItem: "LIFT_KEY",
    noKeyText: "_RocketHideoutElevatorAppearsToNeedKeyText",
  },
};

/** "Which floor do you want?" */
export const TEXT_WHICH_FLOOR: string = "_WhichFloorText";

export function elevatorFor(mapId: string): ElevatorDef {
  const def = ELEVATORS[mapId];
  return def ? def : null;
}

export function elevatorMaps(): string[] {
  return Object.keys(ELEVATORS);
}
