// The five HM moves used outside battle: Cut, Fly, Surf, Strength, Flash.
//
// This file is the DATA half -- the tile ids, badge gates, text labels and the
// four hand-authored tables the ROM does not carry as a table at all. Overworld
// owns the world rules that read them and PlayLoop owns the scripts that show
// the cartridge's lines; nothing here touches state.
//
// Why the tables are TypeScript and not manifest entries: cutTiles, waterTile,
// shoreTiles and the Victory Road switches are constants read out of pokered's
// code, not bytes read out of the cartridge. Putting them in the manifest would
// make them part of the extractor's output, which is compared byte for byte
// against gen1recomp's reference by the golden gate -- and they have no
// counterpart there. Everything that IS in the ROM (the block swap table, the
// water tilesets, the dark maps, the fly landing spots, the Seafoam holes) is
// read from `bundle.field`.
//
// The one rule to keep in mind: a BLOCK id is only meaningful inside one
// tileset. Route 23 (PLATEAU) has blocks whose numbers appear in the cut swap
// table, and "cutting" one writes a block id PLATEAU does not have. The tileset
// and tile gate below is what stops that, and it is the gate pokered itself
// applies first (engine/overworld/cut.asm UsedCut).

import type { WorldBundle } from "../world/WorldData";
import type { BattleMon } from "./battle/types";

/** The five HM moves, in HM01..HM05 order (data/moves/hm_moves.asm). */
export const HM_MOVE_IDS: string[] = ["CUT", "FLY", "SURF", "STRENGTH", "FLASH"];

/**
 * The badge each field move needs (engine/menus/start_sub_menus.asm
 * StartMenu_Pokemon: .cut, .fly, .surf, .strength, .flash each test one bit).
 */
export const FIELD_MOVE_BADGES: any = {
  CUT: "CASCADEBADGE",
  FLY: "THUNDERBADGE",
  SURF: "SOULBADGE",
  STRENGTH: "RAINBOWBADGE",
  FLASH: "BOULDERBADGE",
};

/** The badges in the order PlayState.badges holds them. */
const BADGE_ORDER: string[] = [
  "BOULDERBADGE", "CASCADEBADGE", "THUNDERBADGE", "RAINBOWBADGE",
  "SOULBADGE", "MARSHBADGE", "VOLCANOBADGE", "EARTHBADGE",
];

/**
 * The cuttable TILE per tileset. Only two tilesets have anything cuttable at
 * all: OVERWORLD's tree ($3d) and tall grass ($52), and GYM's plant ($50).
 */
export const CUT_TREE_TILE: number = 0x3d;
export const CUT_GRASS_TILE: number = 0x52;
export const CUT_GYM_TILE: number = 0x50;

/** Water is $14 in every tileset; the two shore tiles are land in SHIP_PORT. */
export const WATER_TILE: number = 0x14;
export const SHORE_TILES: number[] = [0x32, 0x48];
export const NO_SHORE_TILESET: string = "SHIP_PORT";

/** The eleven towns FLY can name (BuildFlyLocationsList walks map ids 0..10). */
export const FLY_TOWN_COUNT: number = 11;

/** The lines, by the cartridge's own label. */
export const TEXT_NEW_BADGE_REQUIRED: string = "_NewBadgeRequiredText";
export const TEXT_NOTHING_TO_CUT: string = "_NothingToCutText";
export const TEXT_USED_CUT: string = "_UsedCutText";
export const TEXT_NO_SURFING_HERE: string = "_NoSurfingHereText";
export const TEXT_SURFING_GOT_ON: string = "_SurfingGotOnText";
export const TEXT_NO_PLACE_TO_GET_OFF: string = "_SurfingNoPlaceToGetOffText";
export const TEXT_USED_STRENGTH: string = "_UsedStrengthText";
export const TEXT_CAN_MOVE_BOULDERS: string = "_CanMoveBouldersText";
export const TEXT_CANNOT_FLY_HERE: string = "_CannotFlyHereText";
export const TEXT_FLASH_LIGHTS: string = "_FlashLightsAreaText";

/** The `call` routines the field-move scripts hand to PlayHost. */
export const ROUTINE_CUT: string = "cut_tree";
export const ROUTINE_SURF: string = "start_surf";
export const ROUTINE_STRENGTH: string = "activate_strength";
export const ROUTINE_FLY: string = "fly_to";
export const ROUTINE_FLASH: string = "light_area";

/** Every routine this system adds, for the contract test. */
export function fieldRoutines(): string[] {
  return [ROUTINE_CUT, ROUTINE_SURF, ROUTINE_STRENGTH, ROUTINE_FLY, ROUTINE_FLASH];
}

/** What using a field move amounted to. */
export interface FieldMoveOutcome {
  /** A script is running; the VM owns the frame. */
  started: boolean;
  /** FLY outdoors with the badge: the caller must open the town list. */
  pickFly: boolean;
}

/** A boulder that Strength moved one cell. */
export interface BoulderPush {
  name: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  direction: string;
}

/** A boulder resting here opens a block somewhere else. */
export interface BoulderSwitch {
  /** The cell the boulder has to come to rest on. */
  x: number;
  y: number;
  flag: string;
  /** Block coordinates of the barrier, and the id it becomes. */
  bx: number;
  by: number;
  block: number;
}

/** A hole a boulder falls down, landing on another floor. */
export interface BoulderHole {
  x: number;
  y: number;
  flag: string;
  destMap: string;
  /** The cell on destMap the fallen boulder appears at. */
  landsX: number;
  landsY: number;
}

/**
 * Victory Road's three switches, verbatim from scripts/VictoryRoad1F.asm,
 * VictoryRoad2F.asm and VictoryRoad3F.asm.
 *
 * The closed ids are the shipped .blk bytes and are NOT stored: an override
 * lives in the MapRuntime instance and dies when the map is left, which is the
 * cartridge's own reset (ReplaceTileBlock edits the loaded block map only).
 * The open block is re-stamped from the flag on every entry instead.
 */
export const BOULDER_SWITCHES: any = {
  VICTORY_ROAD_1F: [
    { x: 17, y: 13, flag: "EVENT_VICTORY_ROAD_1_BOULDER_ON_SWITCH", bx: 4, by: 6, block: 0x1d },
  ],
  VICTORY_ROAD_2F: [
    { x: 1, y: 16, flag: "EVENT_VICTORY_ROAD_2_BOULDER_ON_SWITCH1", bx: 3, by: 4, block: 0x15 },
    { x: 9, y: 16, flag: "EVENT_VICTORY_ROAD_2_BOULDER_ON_SWITCH2", bx: 11, by: 7, block: 0x1d },
  ],
  VICTORY_ROAD_3F: [
    { x: 3, y: 5, flag: "EVENT_VICTORY_ROAD_3_BOULDER_ON_SWITCH1", bx: 3, by: 5, block: 0x1d },
  ],
};

/**
 * Victory Road 3F's hole. The Seafoam holes come from bundle.field.seafoam;
 * this one is written into VictoryRoad3FDefaultScript rather than a table.
 */
export const VICTORY_ROAD_HOLES: any = {
  VICTORY_ROAD_3F: [
    {
      x: 23, y: 15,
      flag: "EVENT_VICTORY_ROAD_3_BOULDER_ON_SWITCH2",
      destMap: "VICTORY_ROAD_2F",
      landsX: 23, landsY: 16,
    },
  ],
};

/**
 * Flags a map entry clears. VictoryRoad2FResetBoulderEventScript drops the 1F
 * switch, so climbing back down finds that barrier closed again.
 */
export const MAP_ENTER_CLEARS: any = {
  VICTORY_ROAD_2F: ["EVENT_VICTORY_ROAD_1_BOULDER_ON_SWITCH"],
};

/** Index into PlayState.badges, or -1. */
export function badgeIndexOf(badge: string): number {
  for (let i = 0; i < BADGE_ORDER.length; i++) {
    if (BADGE_ORDER[i] === badge) {
      return i;
    }
  }
  return -1;
}

/** True when a move id is one of the five HMs. */
export function isHmMove(move: string): boolean {
  return HM_MOVE_IDS.indexOf(move) >= 0;
}

/** The HM moves this Pokemon knows, in slot order. */
export function fieldMovesOf(mon: BattleMon): string[] {
  const out: string[] = [];
  if (!mon || !mon.moves) {
    return out;
  }
  for (let i = 0; i < mon.moves.length; i++) {
    const id = mon.moves[i].id;
    if (isHmMove(id) && out.indexOf(id) < 0) {
      out.push(id);
    }
  }
  return out;
}

/** The block a cut turns this one into, or -1 when it is not cuttable. */
export function cutSwapFor(bundle: WorldBundle, block: number): number {
  const swaps = bundle.field ? bundle.field.cutTreeSwaps : null;
  if (!swaps) {
    return -1;
  }
  for (let i = 0; i < swaps.length; i++) {
    if (swaps[i].before === block) {
      return swaps[i].after;
    }
  }
  return -1;
}

/** Whether this tile in this tileset is cuttable, and whether it is grass. */
export function cutKindOf(tilesetId: string, tile: number): string {
  if (tilesetId === "OVERWORLD") {
    if (tile === CUT_TREE_TILE) {
      return "tree";
    }
    // Tall grass is cuttable too, and unlike a tree it is WALKABLE -- the
    // walkability gate below must not be applied to it.
    if (tile === CUT_GRASS_TILE) {
      return "grass";
    }
    return "";
  }
  if (tilesetId === "GYM" && tile === CUT_GYM_TILE) {
    return "tree";
  }
  return "";
}

/**
 * pokered's LedgeTiles (main.asm), OVERWORLD tileset only: facing `direction`
 * already, standing on a cell tiled `standingTile` with `aheadTile` directly
 * ahead is a hop over the ledge rather than a blocked step. Never fires on
 * another tileset, where the same tile numbers mean something else entirely.
 */
export function isLedgeHop(bundle: WorldBundle, tilesetId: string, direction: string,
                            standingTile: number, aheadTile: number): boolean {
  if (tilesetId !== "OVERWORLD") {
    return false;
  }
  const ledges = bundle.field ? bundle.field.ledges : null;
  if (!ledges) {
    return false;
  }
  for (let i = 0; i < ledges.length; i++) {
    const ledge = ledges[i];
    if (ledge.facing === direction && ledge.input === direction &&
        ledge.standingTile === standingTile && ledge.ledgeTile === aheadTile) {
      return true;
    }
  }
  return false;
}

/** The tilesets whose water can be surfed. ROM data, through the bundle. */
export function waterTilesetsOf(bundle: WorldBundle): string[] {
  const list = bundle.field ? bundle.field.waterTilesets : null;
  return list ? list : [];
}

/**
 * The map whose doorway turns the lights out: ROCK_TUNNEL_1F.
 *
 * The cartridge darkens on the warp INTO this map from an outside one, not on
 * arriving anywhere dark, which is why the ladders down to B2F stay lit once
 * FLASH has been used.
 */
export function darkEntryMapOf(bundle: WorldBundle): string {
  const dark = bundle.field ? bundle.field.darkMaps : null;
  return dark && dark.entryMap ? dark.entryMap : "";
}

/** The maps that need Flash, from the manifest's darkMaps block. */
export function darkMapsOf(bundle: WorldBundle): string[] {
  const dark = bundle.field ? bundle.field.darkMaps : null;
  return dark && dark.maps ? dark.maps : [];
}

/** Where FLY lands on this map, or null. */
export function flyWarpOf(bundle: WorldBundle, mapId: string): any {
  const warps = bundle.field ? bundle.field.flyWarps : null;
  const spot = warps ? warps[mapId] : null;
  return spot ? spot : null;
}

/**
 * Whether FLY may name this map: one of the eleven towns AND a map with a
 * landing spot. ROUTE_4 and ROUTE_10 carry landing spots for the dungeon-escape
 * table and are not fly destinations.
 */
export function isFlyTown(bundle: WorldBundle, mapId: string): boolean {
  const order = bundle.mapOrder ? bundle.mapOrder : [];
  const index = order.indexOf(mapId);
  return index >= 0 && index < FLY_TOWN_COUNT && flyWarpOf(bundle, mapId) !== null;
}

/** The switches on a map, or []. */
export function boulderSwitchesFor(mapId: string): BoulderSwitch[] {
  const rows = BOULDER_SWITCHES[mapId];
  return rows ? rows : [];
}

/**
 * The holes on a map: Seafoam's four floors from the bundle, plus Victory
 * Road 3F's from the table above.
 */
export function boulderHolesFor(bundle: WorldBundle, mapId: string): BoulderHole[] {
  const out: BoulderHole[] = [];
  const hard = VICTORY_ROAD_HOLES[mapId];
  for (let i = 0; hard && i < hard.length; i++) {
    out.push(hard[i]);
  }
  const seafoam = bundle.field ? bundle.field.seafoam : null;
  const floor = seafoam ? seafoam[mapId] : null;
  const holes = floor && floor.holes ? floor.holes : [];
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    const lands = hole.landsAt ? hole.landsAt : { x: hole.x, y: hole.y };
    out.push({
      x: hole.x,
      y: hole.y,
      flag: hole.boulderEvent,
      destMap: floor.holeDestination,
      landsX: lands.x,
      landsY: lands.y,
    });
  }
  return out;
}

/** The flags a map entry clears, or []. */
export function mapEnterClearsFor(mapId: string): string[] {
  const rows = MAP_ENTER_CLEARS[mapId];
  return rows ? rows : [];
}
