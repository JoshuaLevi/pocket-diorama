// The shape of the world bundle, and the decoding of its packed graphics.
//
// A bundle is produced two ways that must agree byte for byte: baked on a desktop
// by tools/build_bundle.py, or extracted in-lens from the user's own ROM. Everything
// downstream of this file is blind to which one it got.
//
// Graphics travel as 2-bit Game Boy shade indices, four per byte, so the whole of
// Kanto — 222 maps, 24 tilesets, 66 sprites — is about 561 KB. The lens turns those
// indices into pixels at runtime through a palette; no PNG ever crosses the wire.

import type { CryBankData } from "../audio/CryBank";
import type { AudioBankData } from "../audio/AudioBank";

/** A block is 4x4 tiles of 8x8 pixels, so 32x32 px, and 2x2 walkable steps. */
export const TILES_PER_BLOCK_SIDE: number = 4;
export const STEPS_PER_BLOCK_SIDE: number = 2;
export const TILE_PIXELS: number = 8;

export interface TilesetDef {
  id: string;
  /** blocks[blockIndex][0..15] -> tile index, row-major over a 4x4 grid. */
  blocks: number[][];
  /** Tile indices the player may stand on. Everything else is solid. */
  walkable: number[];
  /** The tile that triggers wild encounters; -1 when the tileset has none. */
  grassTile: number;
  warpTiles: number[];
  doorTiles: number[];
  counterTiles: number[];
  tilesPerRow: number;
  tileWidth: number;
  tileHeight: number;
  /** base64, four 2-bit shade indices per byte, row-major over the sheet. */
  shades: string;
  /**
   * The water rotation's and flower swap's own graphics, packed the same way
   * `shades` is (base64, four 2-bit shade indices per byte, 8x8) -- present
   * only when this tileset's ROM header names TILEANIM_WATER or
   * TILEANIM_WATER_FLOWER (rom/datasets/tilesets.ts). null on every other
   * tileset (most interiors, and REDS_HOUSE_1/2), and flowerTile/flowerFrames
   * are null on a WATER-only tileset (CAVERN, FOREST, ...), which never shows
   * a flower bed. Shape: `{ waterTile, waterFrame, flowerTile, flowerFrames }`
   * -- waterTile/flowerTile are fixed tile ids (0x14/0x03, the same on every
   * tileset that carries them: Gen 1's engine hardcodes these two indices
   * rather than reading them from any per-tileset ROM table), flowerFrames is
   * the three FlowerTile1-3 frames in that order. See
   * play/screen/OverworldCanvas.ts for how the measured WRAM counter selects
   * among them, and PLAYTEST.md's "GAME BOY mode" section for the pixel
   * measurement.
   */
  animation: any;
}

export interface MapConnection {
  map: string;
  offset: number;
}

export interface MapWarp {
  x: number;
  y: number;
  destMap: string;
  destWarp: number;
}

export interface MapObject {
  index: number;
  name: string;
  sprite: string;
  x: number;
  y: number;
  movement: string;
  range: string;
  /** Label into the bundle's text, shown when the player faces and talks to them. */
  text: string;
  /**
   * True when an event has to reveal them first. Oak is hidden until he finds you.
   *
   * Declared non-optional and ABSENT from every object that is not hidden -- the
   * baker only emits the key when it is true. Read it as `hidden === true`, never
   * as `!hidden`, and never assume it is present.
   */
  hidden: boolean;
  /**
   * The item lying here when this object is a Poke Ball on the ground, e.g.
   * "NUGGET". Absent from every object that is not one, and the string "0" --
   * the cartridge's ITEM_NONE -- on two plain objects. Read it through
   * itemIdOf(), never as `!!object.item`.
   */
  item: string;
  /**
   * The trainer this object fights as, e.g. "OPP_BROCK", or absent for an NPC
   * who does not fight. Resolves against the bundle's `trainers` table.
   */
  trainerClass: string;
  /**
   * Which of that trainer's rosters, 1-based, as the cartridge numbers them.
   * Absent alongside trainerClass.
   */
  trainerParty: number;
}

export interface MapSign {
  x: number;
  y: number;
  text: string;
}

export interface MapDef {
  id: string;
  /** The ROM's own label for this map, e.g. "PalletTown". Keys the text tables. */
  label: string;
  /** SGB overworld palette for this map; towns own theirs, routes share one. */
  palette: string;
  /** In blocks. Multiply by STEPS_PER_BLOCK_SIDE for the walkable grid. */
  width: number;
  height: number;
  blocks: number[];
  borderBlock: number;
  tileset: string;
  connections: any;
  warps: MapWarp[];
  signs: any[];
  objects: MapObject[];
}

export interface EncounterSlot {
  level: number;
  species: string;
}

export interface EncounterGroup {
  rate: number;
  slots: EncounterSlot[];
}

export interface EncounterTable {
  grass: EncounterGroup;
  water: EncounterGroup;
}

export interface SpriteDef {
  id: string;
  frames: number;
  walker: boolean;
  width: number;
  height: number;
  shades: string;
  /** base64, one bit per pixel, 1 = opaque. */
  alpha: string;
}

export interface SpritePixels {
  width: number;
  height: number;
  shades: string;
  alpha: string;
}

export interface SpeciesDef {
  id: string;
  name: string;
  index: number;
  dex: number;
  types: string[];
  baseStats: any;
  catchRate: number;
  baseExp: number;
  growthRate: string;
  level1Moves: string[];
  learnset: any[];
  evolutions: any[];
  /** Move names of the TMs and HMs this species can learn. */
  tmhm: string[];
  /** Battle portrait, present only for species reachable on the shipped maps. */
  front: SpritePixels;
  /** The picture of its back, as the player sees his own; its body filled in. */
  back?: SpritePixels;
  /** The species' Super Game Boy palette in bundle.palettes ("YELLOWMON"); absent in older bakes. */
  palette?: string;
  /** The Pokedex page's category, e.g. "LIZARD" (shown as "LIZARD POKeMON"). */
  category: string;
  heightFeet: number;
  heightInches: number;
  /** Weight in tenths of a pound: 190 is 19.0lb. */
  weightTenths: number;
  /** Label of the two-page description in bundle.text, e.g. "_CharmanderDexEntry". */
  dexText: string;
}

/** One cartridge in-game trade. Scripts select these with a 1-based index. */
export interface TradeDef {
  give: string;
  get: string;
  nickname: string;
  dialogset: number;
}

export interface WorldBundle {
  format: number;
  source: string;
  romSha1: string;
  /** palettes[name] -> four [r,g,b] triples, darkest last. */
  palettes: any;
  defaultPalette: string;
  mapOrder: string[];
  tilesets: any;
  maps: any;
  encounters: any;
  sprites: any;
  species: any;
  moves: any;
  typeChart: any;
  /** Dialogue bodies, keyed by an internal label like "_PalletTownGirlText". */
  text: any;
  /** map label -> TEXT_* id -> { label, text }. The indirection between them. */
  textPointers: any;
  /**
   * Per map id, the blocks a flag opens or closes; see world/BlockOverrides.ts.
   * Absent from older bundles: every passage then stays as shipped.
   */
  blockOverrides: any;
  /**
   * The manifest's field metadata (gameCornerPoster, cardKeyDoors, flyWarps,
   * hiddenExtras.pcTiles, waterTilesets, darkMaps, seafoam, spinners...).
   * Absent from bundles baked before it was carried; readers guard it.
   */
  field: any;
  /**
   * Per map LABEL ("CeladonGym"), per object index as a string ("2"): the
   * labels of that trainer's challenge, end-battle and after-battle lines, the
   * EVENT_BEAT_* bit that retires them, and their sight range. Absent from
   * bundles baked before it was carried; readers go through trainerHeaderFor().
   */
  trainerHeaders: any;
  /**
   * Trainer rosters, keyed "OPP_BROCK". Each has `parties`, a list of rosters,
   * which a map object selects with its 1-based `trainerParty`.
   *
   * These were extracted all along and dropped on the way into the bundle, so a
   * trainer battle had a class name and no Pokemon to put behind it.
   */
  trainers: any;
  /**
   * The title screen's art as shade images: logo, version, player, copyright,
   * gamefreakInc, each { width, height, shades, alpha }. Absent (null or {})
   * from bundles baked before it was carried; the boot then skips to the game.
   */
  title: any;
  /**
   * The intro cutscene's portraits as shade images: oak, rival, player,
   * shrink1, shrink2, each { width, height, shades, alpha } like title's
   * images. Absent (null or {}) from bundles baked before it was carried;
   * readers guard it the same way they guard title.
   */
  introArt: any;
  /** The GHOST and the museum's fossils: ghost, fossilAerodactyl, fossilKabutops. Absent in older bakes. */
  pictures?: any;
  /** The cartridge's in-game trades, in their original 1-based script order. */
  trades: TradeDef[];
  /** The glyph sheet the message box draws from. */
  font: any;
  /**
   * Item ids to their display name and price.
   *
   * The two are not the same string: Brock's TM is the item `TM_BIDE` and reads
   * "TM34" on the screen. A bag that shows the id shows the wrong thing.
   */
  items: any;
  /** Baked, compact pulse/wave programs for all 151 Pokemon cries. */
  cries: CryBankData;
  /** The cartridge's sound banks, for music and effects. */
  audio: AudioBankData;
}

const B64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

let b64Lookup: number[] = null;

function base64Lookup(): number[] {
  if (b64Lookup === null) {
    // 123 covers '{'; every base64 character sits below it.
    const table: number[] = [];
    for (let i = 0; i < 123; i++) {
      table.push(-1);
    }
    for (let i = 0; i < B64_ALPHABET.length; i++) {
      table[B64_ALPHABET.charCodeAt(i)] = i;
    }
    b64Lookup = table;
  }
  return b64Lookup;
}

/**
 * Encodes bytes as standard base64. The lens sandbox has no btoa either.
 *
 * Here rather than in the extractor because this file owns what the bundle's
 * encodings ARE; the baker and the reader disagreeing about padding is the kind
 * of bug that shows up as one wrong pixel in a corner, or one wrong note.
 */
export function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet.charAt(b0 >> 2);
    out += alphabet.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? alphabet.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < bytes.length ? alphabet.charAt(b2 & 63) : "=";
  }
  return out;
}

/** Decodes standard base64 to bytes. The lens sandbox has no atob. */
export function decodeBase64(text: string): Uint8Array {
  const table = base64Lookup();
  let length = text.length;
  while (length > 0 && text.charAt(length - 1) === "=") {
    length--;
  }
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 123 ? table[code] : -1;
    if (value < 0) {
      continue;
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (acc >> bits) & 0xff;
      written++;
    }
  }
  return written === out.length ? out : out.subarray(0, written);
}

/** Unpacks four 2-bit shade indices per byte into one byte per pixel. */
export function unpackShades(encoded: string, pixelCount: number): Uint8Array {
  const packed = decodeBase64(encoded);
  const out = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const byte = packed[i >> 2];
    out[i] = byte === undefined ? 0 : (byte >> ((i & 3) * 2)) & 3;
  }
  return out;
}

/** Unpacks one bit per pixel into a 0/1 byte per pixel. */
export function unpackMask(encoded: string, pixelCount: number): Uint8Array {
  const packed = decodeBase64(encoded);
  const out = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const byte = packed[i >> 3];
    out[i] = byte === undefined ? 0 : (byte >> (i & 7)) & 1;
  }
  return out;
}

/** Parses a bundle and fails loudly rather than half-loading a broken world. */
export function parseBundle(text: string): WorldBundle {
  const bundle = JSON.parse(text) as WorldBundle;
  if (!bundle || bundle.format < 1 || bundle.format > 2) {
    throw new Error("world bundle: unsupported format " + (bundle ? bundle.format : "none"));
  }
  if (!bundle.maps || !bundle.tilesets) {
    throw new Error("world bundle: missing maps or tilesets");
  }
  return bundle;
}

/**
 * Whether an object is hidden RIGHT NOW: the script's override if there is one,
 * else the state the cartridge ships it in.
 *
 * One rule, shared by everything that looks at an object -- the talk layer, the
 * renderer and the collision -- because it was written into only one of them:
 * the lens drew every object it had a sprite for, and the collision blocked on
 * every object it had a cell for, so the thirty-two the cartridge ships hidden
 * stood in plain sight and every hidden one was an invisible wall.
 *
 * `hidden` is the state the cartridge SHIPS the object in, not the state it is
 * in now: Oak stands in Pallet Town hidden until an event reveals him, and a
 * script that reveals him has to be able to make him talkable. Keyed by map AND
 * name: a reveal can target another map, and two maps can hold objects with the
 * same name.
 */
export function isObjectHidden(mapId: string, object: MapObject, revealed: any): boolean {
  const override = revealed ? revealed[mapId + ":" + object.name] : undefined;
  return override === undefined ? object.hidden === true : override !== true;
}

/**
 * Which way a standing object is looking: object_event's fifth field.
 *
 * For a STAY object the cartridge's `range` byte IS the facing; for a walker
 * it names the axis instead, and a walker's real direction comes from its
 * pose. Everything that has to agree about where an NPC is looking reads this
 * one function -- the diorama's billboards, the Game Boy view, and the
 * sightline that decides whether a trainer can see you. Three copies of it
 * would be three chances for the drawing and the rule to disagree.
 */
export function shippedFacing(object: MapObject): string {
  if (object.range === "UP") { return "up"; }
  if (object.range === "LEFT") { return "left"; }
  if (object.range === "RIGHT") { return "right"; }
  return "down";
}

/** The item a Poke Ball object holds, or "" -- "0" is the cartridge's none. */
export function itemIdOf(object: MapObject): string {
  return typeof object.item === "string" && object.item !== "" && object.item !== "0"
    ? object.item : "";
}

/** The move a TM or HM item teaches, with its kind and number, or null. */
export function machineOf(bundle: WorldBundle, item: string): any {
  const def = bundle.items ? bundle.items[item] : null;
  return def && def.machine ? def.machine : null;
}
