// What is written on the walls: bookshelves, posters, notebooks and statues.
//
// The cartridge has two ways of putting words on a piece of furniture, and
// the extraction carried neither.
//
// The first is a TILE rule. PrintBookshelfText (bank 3, the handler behind
// every "press A facing up at nothing") reads the tile in front of the player
// and looks it up, with the current tileset, in BookshelfTileIDs -- seventeen
// rows at bank 3 $7B8B, `db tileset, tile, predef text id`, closed by $FF.
// That is why every bookshelf in every house says the same thing: it is the
// same tile. The five texts the rows point at were resolved through the
// TextPredefs table at $3F22 (66 two-byte pointers into the caller's own
// bank): the statues routine at 3:$7BBF, TownMapText, BookOrSculptureText at
// 3:$7BE8, ElevatorText and PokemonStuffText.
//
// The second is a CELL rule: the hidden-object lists of bank $11
// (HiddenObjectMaps at $6A3D, HiddenObjectPointers at $6A96), the same lists
// the hidden items, the bench guys and the PCs come from. The text-only
// entries had been dropped on the way into the manifest; they are here, read
// out of the ROM on 12 September 2026, each with the handler that decides
// whether it needs the player facing up and which text it prints.
//
// Pure. The lens hands in the tiles and the cell; this hands back a script.

import type { ScriptCommand } from "./ScriptVM";

/** The five things a bookshelf tile can say. */
export const SHELF_STATUES: string = "statues";
export const SHELF_TOWN_MAP: string = "townmap";
export const SHELF_BOOKS: string = "books";
export const SHELF_ELEVATOR: string = "elevator";
export const SHELF_STUFF: string = "stuff";

/** BookshelfTileIDs, bank 3 $7B8B. Tileset names are the manifest's own. */
export const BOOKSHELF_TILES: any[] = [
  { tileset: "PLATEAU", tile: 0x30, kind: SHELF_STATUES },
  { tileset: "HOUSE", tile: 0x3d, kind: SHELF_TOWN_MAP },
  { tileset: "HOUSE", tile: 0x1e, kind: SHELF_BOOKS },
  { tileset: "MANSION", tile: 0x32, kind: SHELF_BOOKS },
  { tileset: "REDS_HOUSE_1", tile: 0x32, kind: SHELF_BOOKS },
  { tileset: "LAB", tile: 0x28, kind: SHELF_BOOKS },
  { tileset: "LOBBY", tile: 0x16, kind: SHELF_ELEVATOR },
  { tileset: "GYM", tile: 0x1d, kind: SHELF_BOOKS },
  { tileset: "DOJO", tile: 0x1d, kind: SHELF_BOOKS },
  { tileset: "GATE", tile: 0x22, kind: SHELF_BOOKS },
  { tileset: "MART", tile: 0x54, kind: SHELF_STUFF },
  { tileset: "MART", tile: 0x55, kind: SHELF_STUFF },
  { tileset: "POKECENTER", tile: 0x54, kind: SHELF_STUFF },
  { tileset: "POKECENTER", tile: 0x55, kind: SHELF_STUFF },
  { tileset: "LOBBY", tile: 0x50, kind: SHELF_STUFF },
  { tileset: "LOBBY", tile: 0x52, kind: SHELF_STUFF },
  { tileset: "SHIP", tile: 0x36, kind: SHELF_BOOKS },
];

export const TEXT_TOWN_MAP: string = "_TownMapText";
export const TEXT_BOOKS: string = "_PokemonBooksText";
export const TEXT_SCULPTURE: string = "_DiglettSculptureText";
export const TEXT_ELEVATOR: string = "_ElevatorText";
export const TEXT_STUFF: string = "_PokemonStuffText";
export const TEXT_STATUES_1: string = "_IndigoPlateauStatuesText1";
export const TEXT_STATUES_2: string = "_IndigoPlateauStatuesText2";
export const TEXT_STATUES_3: string = "_IndigoPlateauStatuesText3";
/** BookOrSculptureText: the tile ABOVE the bookshelf tile, in the MANSION tileset. */
export const SCULPTURE_TILE: number = 0x38;
export const SCULPTURE_TILESET: string = "MANSION";

/** The kinds a wall object can be. */
export const WALL_TEXT: string = "text";
export const WALL_NOTEBOOK: string = "notebook";
export const WALL_BLACKBOARD: string = "blackboard";
export const WALL_LINK_BOARD: string = "linkboard";
export const WALL_OAK_POSTER: string = "oakposter";
/** A text with its picture (screen/PictureScreen.ts): `picture` is the key. */
export const WALL_PICTURE: string = "picture";
export const SCREEN_PICTURE: string = "Picture";

export const ROUTINE_BLACKBOARD: string = "blackboard";
export const ROUTINE_LINK_BOARD: string = "link_cable_board";

export const TEXT_TURN_PAGE: string = "_TurnPageText";
export const NOTEBOOK_TEXTS: string[] = [
  "_ViridianSchoolNotebookText1", "_ViridianSchoolNotebookText2",
  "_ViridianSchoolNotebookText3", "_ViridianSchoolNotebookText4",
  "_ViridianSchoolNotebookText5",
];
export const TEXT_BLACKBOARD_1: string = "_ViridianSchoolBlackboardText1";
export const TEXT_BLACKBOARD_2: string = "_ViridianSchoolBlackboardText2";
/** The menu at 17:$5DAC and $5DBB, two columns of three, read across then down. */
export const BLACKBOARD_TOPICS: string[] = ["SLP", "PSN", "PAR", "BRN", "FRZ", "QUIT"];
export const BLACKBOARD_TEXTS: string[] = [
  "_ViridianBlackboardSleepText", "_ViridianBlackboardPoisonText",
  "_ViridianBlackboardPrlzText", "_ViridianBlackboardBurnText",
  "_ViridianBlackboardFrozenText",
];
export const TEXT_LINK_1: string = "_LinkCableHelpText1";
export const TEXT_LINK_2: string = "_LinkCableHelpText2";
/** The menu at 17:$5CA8. */
export const LINK_TOPICS: string[] = ["HOW TO LINK", "COLOSSEUM", "TRADE CENTER", "STOP"];
export const LINK_TEXTS: string[] = ["_LinkCableInfoText1", "_LinkCableInfoText2", "_LinkCableInfoText3"];
/** OAKS_LAB (5,0): the poster changes once two species are owned. */
export const TEXT_OAK_POSTER_EARLY: string = "_SaveOptionText";
export const TEXT_OAK_POSTER_LATE: string = "_StrengthsAndWeaknessesText";

/**
 * The text-only hidden objects, bank $11. `up` is whether the handler tests
 * the player's facing (`ld a,[$C109]; cp $04; ret nz`); the ones without it
 * answer from any side, as the cartridge's do.
 */
export const WALL_OBJECTS: any[] = [
  // 17:$5B79 PrintRedSNESText
  { map: "REDS_HOUSE_2F", x: 3, y: 5, up: false, kind: WALL_TEXT, text: "_RedBedroomSNESText" },
  // 18:$6509, predef 14 in bank $18
  { map: "BLUES_HOUSE", x: 0, y: 1, up: false, kind: WALL_TEXT, text: "_BookcaseText" },
  { map: "BLUES_HOUSE", x: 1, y: 1, up: false, kind: WALL_TEXT, text: "_BookcaseText" },
  { map: "BLUES_HOUSE", x: 7, y: 1, up: false, kind: WALL_TEXT, text: "_BookcaseText" },
  // 07:$6958 / $6965 / $6CAF
  { map: "OAKS_LAB", x: 4, y: 0, up: false, kind: WALL_TEXT, text: "_PushStartText" },
  { map: "OAKS_LAB", x: 5, y: 0, up: false, kind: WALL_OAK_POSTER, text: "" },
  { map: "OAKS_LAB", x: 0, y: 1, up: true, kind: WALL_TEXT, text: "_OakLabEmailText" },
  { map: "OAKS_LAB", x: 1, y: 1, up: true, kind: WALL_TEXT, text: "_OakLabEmailText" },
  // 17:$5BAD / $5BC3 -- DisplayMonFrontSpriteInBox with the fossil's own picture
  { map: "MUSEUM_1F", x: 2, y: 3, up: false, kind: WALL_PICTURE, text: "_AerodactylFossilText", picture: "fossilAerodactyl" },
  { map: "MUSEUM_1F", x: 2, y: 6, up: false, kind: WALL_PICTURE, text: "_KabutopsFossilText", picture: "fossilKabutops" },
  // 14:$6A22 / $6A08 / $6A15
  { map: "FIGHTING_DOJO", x: 3, y: 9, up: false, kind: WALL_TEXT, text: "_FightingDojoText" },
  { map: "FIGHTING_DOJO", x: 6, y: 9, up: false, kind: WALL_TEXT, text: "_FightingDojoText" },
  { map: "FIGHTING_DOJO", x: 4, y: 0, up: false, kind: WALL_TEXT, text: "_EnemiesOnEverySideText" },
  { map: "FIGHTING_DOJO", x: 5, y: 0, up: false, kind: WALL_TEXT, text: "_WhatGoesAroundComesAroundText" },
  // 14:$6A2F
  { map: "INDIGO_PLATEAU", x: 8, y: 13, up: true, kind: WALL_TEXT, text: "_IndigoPlateauHQText" },
  { map: "INDIGO_PLATEAU", x: 11, y: 13, up: true, kind: WALL_TEXT, text: "_IndigoPlateauHQText" },
  // 07:$6B60
  { map: "MR_FUJIS_HOUSE", x: 0, y: 1, up: false, kind: WALL_TEXT, text: "_MagazinesText" },
  { map: "MR_FUJIS_HOUSE", x: 1, y: 1, up: false, kind: WALL_TEXT, text: "_MagazinesText" },
  { map: "MR_FUJIS_HOUSE", x: 7, y: 1, up: false, kind: WALL_TEXT, text: "_MagazinesText" },
  // 17:$5B8F -- ARTICUNO's front picture, through the glass
  { map: "ROUTE_15_GATE_2F", x: 1, y: 2, up: true, kind: WALL_PICTURE, text: "_Route15UpstairsBinocularsText", picture: "species:ARTICUNO" },
  // 17:$5C1A PrintBlackboardLinkCableText with predef 33 and 52; 14:$6996 PrintNotebookText with 32 and 53
  { map: "VIRIDIAN_SCHOOL_HOUSE", x: 3, y: 0, up: false, kind: WALL_BLACKBOARD, text: "" },
  { map: "VIRIDIAN_SCHOOL_HOUSE", x: 3, y: 4, up: false, kind: WALL_NOTEBOOK, text: "" },
  { map: "CELADON_MANSION_ROOF_HOUSE", x: 3, y: 0, up: false, kind: WALL_LINK_BOARD, text: "" },
  { map: "CELADON_MANSION_ROOF_HOUSE", x: 4, y: 0, up: false, kind: WALL_LINK_BOARD, text: "" },
  { map: "CELADON_MANSION_ROOF_HOUSE", x: 3, y: 4, up: false, kind: WALL_TEXT, text: "TMNotebookText" },
];

function say(textId: string): ScriptCommand {
  return { op: "show_text", textId: textId } as ScriptCommand;
}

/** The wall object on a cell, or null. */
export function wallObjectAt(mapId: string, x: number, y: number): any {
  for (let i = 0; i < WALL_OBJECTS.length; i++) {
    const w = WALL_OBJECTS[i];
    if (w.map === mapId && w.x === x && w.y === y) {
      return w;
    }
  }
  return null;
}

/**
 * The notebook, ViridianSchoolNotebookText (14:$69AA): a page, "Turn the
 * page?", and so on to the fourth, which turns to the fifth unasked.
 */
export function notebookScript(): ScriptCommand[] {
  const out: ScriptCommand[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(say(NOTEBOOK_TEXTS[i]));
    out.push({ op: "ask", textId: TEXT_TURN_PAGE } as ScriptCommand);
    out.push({ op: "jump_if_false", to: "shut" } as ScriptCommand);
  }
  out.push(say(NOTEBOOK_TEXTS[3]));
  out.push(say(NOTEBOOK_TEXTS[4]));
  out.push({ op: "label", name: "shut" } as ScriptCommand);
  return out;
}

/**
 * What pressing A at a cell says, or null when the cell has nothing on it.
 *
 * `dexOwned` is how many species the player owns: OAK's second poster
 * (07:$6965) counts wPokedexOwned and changes its mind at two.
 */
export function wallScript(mapId: string, x: number, y: number, facing: string,
                           dexOwned: number): ScriptCommand[] {
  const w = wallObjectAt(mapId, x, y);
  if (w === null) {
    return null;
  }
  if (w.up && facing !== "up") {
    return null;
  }
  if (w.kind === WALL_TEXT) {
    return [say(w.text)];
  }
  if (w.kind === WALL_PICTURE) {
    // The host falls back to the words alone where there is no picture to
    // show or no screen to show it on.
    return [{ op: "push_screen", screen: SCREEN_PICTURE, species: w.picture, textId: w.text } as ScriptCommand];
  }
  if (w.kind === WALL_OAK_POSTER) {
    return [say(dexOwned < 2 ? TEXT_OAK_POSTER_EARLY : TEXT_OAK_POSTER_LATE)];
  }
  if (w.kind === WALL_NOTEBOOK) {
    return notebookScript();
  }
  if (w.kind === WALL_BLACKBOARD) {
    return [{ op: "call", routine: ROUTINE_BLACKBOARD, argument: "" } as ScriptCommand];
  }
  if (w.kind === WALL_LINK_BOARD) {
    return [{ op: "call", routine: ROUTINE_LINK_BOARD, argument: "" } as ScriptCommand];
  }
  return null;
}

/** The bookshelf row for a tileset and the tile in front of the player, or null. */
export function bookshelfKind(tileset: string, tile: number): string {
  for (let i = 0; i < BOOKSHELF_TILES.length; i++) {
    const row = BOOKSHELF_TILES[i];
    if (row.tileset === tileset && row.tile === tile) {
      return row.kind;
    }
  }
  return "";
}

/**
 * What a bookshelf tile says. Facing up only, as PrintBookshelfText is.
 *
 * `tile` is the tile the cartridge tests, aCoord 8,7: the bottom-left tile
 * of the cell in front. `tileAbove` is aCoord 8,6, the one over it, which
 * BookOrSculptureText reads in the MANSION tileset to tell the DIGLETT
 * sculpture from a shelf. `playerX` decides which statue text follows the
 * first: odd columns get the second, even the third (3:$7BBF, `bit 0,a`).
 */
export function bookshelfScript(tileset: string, tile: number, tileAbove: number,
                                facing: string, playerX: number): ScriptCommand[] {
  if (facing !== "up") {
    return null;
  }
  const kind = bookshelfKind(tileset, tile);
  if (kind === "") {
    return null;
  }
  if (kind === SHELF_TOWN_MAP) {
    return [say(TEXT_TOWN_MAP)];
  }
  if (kind === SHELF_ELEVATOR) {
    return [say(TEXT_ELEVATOR)];
  }
  if (kind === SHELF_STUFF) {
    return [say(TEXT_STUFF)];
  }
  if (kind === SHELF_BOOKS) {
    const sculpture = tileset === SCULPTURE_TILESET && tileAbove === SCULPTURE_TILE;
    return [say(sculpture ? TEXT_SCULPTURE : TEXT_BOOKS)];
  }
  return [say(TEXT_STATUES_1), say((playerX & 1) === 1 ? TEXT_STATUES_2 : TEXT_STATUES_3)];
}
