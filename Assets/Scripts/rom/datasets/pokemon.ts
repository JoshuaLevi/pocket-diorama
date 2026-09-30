/**
 * Species, moves and the type chart.
 *
 * Port of `extract_pokemon`, `extract_moves` and `extract_type_chart` from
 * gen1recomp/tools/build_rom_data.py. The three share this dataset because
 * they read the same three manifest orders (speciesOrder, moveOrder, types);
 * the registry lets one builder declare several outputs, so the CLI discovers
 * this file as `pokemon` and writes all three JSON files from one build().
 *
 * Everything here is a deliberate line-by-line port. Where the reference
 * raises, this raises; where it falls back to a synthetic `TYPE_1F`-style
 * name, so does this. The golden JSON is the contract, so a tidier
 * formulation that changes a rounding mode or a fallback string is a
 * regression even when it reads better.
 *
 * Sprites are decoded but are NOT part of the JSON -- the golden files carry
 * only asset path strings. The front pic is decompressed whether or not a sink
 * is attached, because its tile size cross-checks base stats byte 10: the one
 * place the lz3 decoder is validated against independent ROM data. The
 * reference also emits fossil, ghost and trainer-card art from this function;
 * that is pure asset side-effect with no JSON of its own and is left out.
 */

import { encodeRgba } from "./graphics";
import { decode2bpp, type DecodedImage } from "../core/decode";
import { decompressPic } from "../core/lz3";
import { readString, decodeText, type Charmap } from "../core/text";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type {
  ManifestPokemonAsset,
  MoveTable,
  RomManifest,
  SpeciesTable,
  TypeChartDef,
} from "../types";

/* ------------------------------------------------------------------------ */
/* Small shared helpers                                                      */
/* ------------------------------------------------------------------------ */

/** Python's `f"{value:02X}"`. */
function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

/** Python's `f"{value:04X}"`. */
function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

interface StringIndex {
  [key: string]: string;
}

interface BoolIndex {
  [key: string]: boolean;
}

/** Read a string-keyed table without tripping over a missing entry. */
function lookup(table: StringIndex, key: string): string | null {
  const value: string | undefined = table[key];
  return value === undefined ? null : value;
}

/**
 * Type id -> constant name. Mirrors `_types_by_id`: the manifest is walked in
 * file order and a later name wins a duplicate id, as the Python dict
 * comprehension does.
 */
function typesById(manifest: RomManifest): StringIndex {
  const byId: StringIndex = Object.create(null) as StringIndex;
  const types = manifest.constants.types;
  const names = Object.keys(types);
  for (let i = 0; i < names.length; i += 1) {
    byId[String(types[names[i]])] = names[i];
  }
  return byId;
}

function typeName(byId: StringIndex, value: number): string {
  const name = lookup(byId, String(value));
  return name === null ? "TYPE_" + hex2(value) : name;
}

/** Port of `_species`: 1-based index into speciesOrder. */
function speciesName(manifest: RomManifest, value: number): string {
  const order = manifest.constants.speciesOrder;
  if (value < 1 || value > order.length) {
    return "SPECIES_" + hex2(value);
  }
  return order[value - 1];
}

/** Port of `_item`: 1-based index into the manifest item order. */
function itemName(manifest: RomManifest, value: number): string {
  const order = manifest.items;
  if (value < 1 || value > order.length) {
    return "ITEM_" + hex2(value);
  }
  return order[value - 1];
}

/** Port of `_move`: 1-based index into moveOrder; 0 means "no move". */
function moveName(manifest: RomManifest, value: number): string | null {
  const order = manifest.constants.moveOrder;
  if (value === 0) {
    return null;
  }
  if (value < 1 || value > order.length) {
    return "MOVE_" + hex2(value);
  }
  return order[value - 1];
}

/* ------------------------------------------------------------------------ */
/* moves.json                                                                */
/* ------------------------------------------------------------------------ */

interface AnimationFlags {
  shake: boolean;
  flash: boolean;
}

/**
 * Whether each move's animation shakes or flashes the screen. Port of
 * `_animation_flags`: the script is a command list, $FF ends it, $D8 and above
 * are two-byte commands and the rest are three. $FB shakes, $F8 and $FE flash.
 * A script still running after 256 commands is a decode error.
 */
function animationFlags(ctx: ExtractContext, count: number): AnimationFlags[] {
  const table = ctx.symbols.get("AttackAnimationPointers");
  const out: AnimationFlags[] = [];
  for (let index = 0; index < count; index += 1) {
    let address = ctx.rom.word(table.bank, table.address + index * 2);
    let shake = false;
    let flash = false;
    let terminated = false;
    for (let step = 0; step < 256; step += 1) {
      const first = ctx.rom.byte(table.bank, address);
      if (first === 0xff) {
        terminated = true;
        break;
      }
      if (first >= 0xd8) {
        shake = shake || first === 0xfb;
        flash = flash || first === 0xf8 || first === 0xfe;
        address += 2;
      } else {
        address += 3;
      }
    }
    if (!terminated) {
      throw new Error(`unterminated move animation ${index + 1}`);
    }
    out.push({ shake: shake, flash: flash });
  }
  return out;
}

/**
 * Build moves.json. `Moves` is 165 six-byte rows: animation id, effect, power,
 * type, accuracy, PP. The animation id doubles as a checksum -- row N must
 * animate move N -- so a mismatch means the table was mis-addressed. Accuracy
 * is a 0-255 fraction reported as a percentage; no value in the table lands on
 * an exact half, so plain rounding matches Python's round().
 */
function buildMoves(ctx: ExtractContext): MoveTable {
  const manifest = ctx.manifest;
  const order = manifest.constants.moveOrder;
  const byId = typesById(manifest);
  const effects = manifest.moveEffects;
  const charmap: Charmap = manifest.charmap;
  const sfxKeys = manifest.sfxKeys;

  const moves = ctx.symbols.get("Moves");
  const names = ctx.symbols.get("MoveNames");
  const sounds = ctx.symbols.get("MoveSoundTable");
  const flags = animationFlags(ctx, order.length);

  const decodedNames: string[] = [];
  let nameAddress = names.address;
  for (let i = 0; i < order.length; i += 1) {
    const read = readString(ctx.rom, names.bank, nameAddress, charmap, 0x50, 32);
    decodedNames.push(read.text);
    nameAddress += read.length;
  }

  const out: MoveTable = Object.create(null) as MoveTable;
  for (let index = 0; index < order.length; index += 1) {
    const row = ctx.rom.bytes(moves.bank, moves.address + index * 6, 6);
    if (row[0] !== index + 1) {
      throw new Error(`Moves row ${index + 1} stores animation id ${row[0]}`);
    }
    const effect =
      row[1] < effects.length ? effects[row[1]] : "EFFECT_" + hex2(row[1]);
    const sound = ctx.rom.bytes(sounds.bank, sounds.address + index * 3, 3);
    const sfx = lookup(sfxKeys, String(sound[0]));

    const anim: {
      flash?: boolean;
      pitch: number;
      shake?: boolean;
      sound: string;
      tempo: number;
    } = {
      sound: sfx === null ? "SFX_" + hex2(sound[0]) : sfx,
      pitch: sound[1],
      tempo: sound[2],
    };
    if (flags[index].shake) {
      anim.shake = true;
    }
    if (flags[index].flash) {
      anim.flash = true;
    }

    out[order[index]] = {
      id: order[index],
      index: index + 1,
      name: decodedNames[index],
      source: `ROM:Moves[${index + 1}]`,
      effect: effect,
      power: row[2],
      type: typeName(byId, row[3]),
      accuracy: Math.round((row[4] * 100) / 255),
      pp: row[5],
      anim: anim,
    };
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* type_chart.json                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Build type_chart.json. `TypeEffects` is a flat $FF-terminated list of
 * (attacker, defender, multiplier) triples with the multiplier x10, so 20 is
 * super effective, 5 is not very effective, 0 is immune. Display names come
 * from `TypeNames`, deduplicated by address because labels alias strings.
 */
function buildTypeChart(ctx: ExtractContext): TypeChartDef {
  const manifest = ctx.manifest;
  const byId = typesById(manifest);
  const effects = ctx.symbols.get("TypeEffects");

  const matchups: TypeChartDef["matchups"] = [];
  let address = effects.address;
  while (ctx.rom.byte(effects.bank, address) !== 0xff) {
    const row = ctx.rom.bytes(effects.bank, address, 3);
    matchups.push({
      attacker: typeName(byId, row[0]),
      defender: typeName(byId, row[1]),
      multiplier: row[2],
    });
    address += 3;
  }

  const names: string[] = [];
  const seen: BoolIndex = Object.create(null) as BoolIndex;
  const labels = manifest.typeNameLabels;
  for (let i = 0; i < labels.length; i += 1) {
    const symbol = ctx.symbols.get(labels[i]);
    const key = symbol.bank + ":" + symbol.address;
    if (seen[key] === true) {
      continue;
    }
    seen[key] = true;
    names.push(
      readString(
        ctx.rom,
        symbol.bank,
        symbol.address,
        manifest.charmap,
        0x50,
        16,
      ).text,
    );
  }

  return {
    source: "ROM:TypeEffects + TypeNames",
    matchups: matchups,
    names: names,
  };
}

/* ------------------------------------------------------------------------ */
/* Sprites (assets only; never part of the JSON diff)                        */
/* ------------------------------------------------------------------------ */

const CRC_TABLE: number[] = buildCrcTable();

function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeU32(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 24) & 0xff;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

/**
 * zlib stream of stored (uncompressed) deflate blocks. Sprites are at most
 * 56x56, so the kilobytes a real deflate would save are not worth carrying a
 * compressor that also has to run inside the Lens sandbox.
 */
function deflateStored(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks = raw.length === 0 ? 1 : Math.ceil(raw.length / maxBlock);
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let p = 0;
  out[p] = 0x78;
  out[p + 1] = 0x01;
  p += 2;
  let offset = 0;
  for (let i = 0; i < blocks; i += 1) {
    const size = Math.min(maxBlock, raw.length - offset);
    out[p] = i === blocks - 1 ? 1 : 0;
    out[p + 1] = size & 0xff;
    out[p + 2] = (size >> 8) & 0xff;
    out[p + 3] = ~size & 0xff;
    out[p + 4] = (~size >> 8) & 0xff;
    p += 5;
    out.set(raw.subarray(offset, offset + size), p);
    p += size;
    offset += size;
  }
  writeU32(out, p, adler32(raw));
  return out;
}

function writeChunk(out: Uint8Array, at: number, type: string, body: Uint8Array): number {
  writeU32(out, at, body.length);
  let p = at + 4;
  const typeStart = p;
  for (let i = 0; i < 4; i += 1) {
    out[p] = type.charCodeAt(i);
    p += 1;
  }
  out.set(body, p);
  p += body.length;
  writeU32(out, p, crc32(out, typeStart, p));
  return p + 4;
}

/** Encode an RGBA8 image as a PNG. */
function encodePng(image: DecodedImage): Uint8Array {
  const stride = image.width * 4;
  const raw = new Uint8Array(image.height * (stride + 1));
  for (let y = 0; y < image.height; y += 1) {
    // Filter type 0 (none) in front of every scanline.
    raw[y * (stride + 1)] = 0;
    const row = image.pixels.subarray(y * stride, y * stride + stride);
    raw.set(row, y * (stride + 1) + 1);
  }
  const zlib = deflateStored(raw);

  // IHDR: 8-bit truecolour with alpha, no interlacing.
  const header = new Uint8Array(13);
  writeU32(header, 0, image.width);
  writeU32(header, 4, image.height);
  header[8] = 8;
  header[9] = 6;

  const out = new Uint8Array(8 + 25 + (12 + zlib.length) + 12);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let p = writeChunk(out, 8, "IHDR", header);
  p = writeChunk(out, p, "IDAT", zlib);
  writeChunk(out, p, "IEND", new Uint8Array(0));
  return out;
}

/**
 * Flood-fill the opaque-white background in from the border and make it
 * transparent. Port of `_matte_color0`; interior white stays opaque, so
 * highlights inside a sprite do not punch holes in it.
 */
function matteColor0(image: DecodedImage): void {
  const pixels = image.pixels;
  const count = image.width * image.height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let tail = 0;

  function add(x: number, y: number): void {
    const index = y * image.width + x;
    if (seen[index] !== 0) {
      return;
    }
    const at = index * 4;
    if (
      pixels[at] === 255 &&
      pixels[at + 1] === 255 &&
      pixels[at + 2] === 255 &&
      pixels[at + 3] === 255
    ) {
      seen[index] = 1;
      queue[tail] = index;
      tail += 1;
    }
  }

  for (let x = 0; x < image.width; x += 1) {
    add(x, 0);
    add(x, image.height - 1);
  }
  for (let y = 0; y < image.height; y += 1) {
    add(0, y);
    add(image.width - 1, y);
  }

  for (let head = 0; head < tail; head += 1) {
    const index = queue[head];
    pixels[index * 4 + 3] = 0;
    const x = index % image.width;
    const y = (index - x) / image.width;
    if (x > 0) {
      add(x - 1, y);
    }
    if (x + 1 < image.width) {
      add(x + 1, y);
    }
    if (y > 0) {
      add(x, y - 1);
    }
    if (y + 1 < image.height) {
      add(x, y + 1);
    }
  }
}

/**
 * Decompress one lz3 picture, matte it, hand it to the asset sink and return
 * its side in tiles, which base stats byte 10 must agree with. Port of
 * `_write_compressed_pic`.
 *
 * Exported so datasets/field.ts's emitIntro() can reuse it for the intro's
 * portraits (Oak, the rival, Red's own front sprite, the two shrink frames)
 * instead of re-implementing decompress + matte + emit a third time. Species
 * front/back pics below are the only other callers, and this export changes
 * nothing about what they get: same decode, same matte, same two emitted
 * assets, same returned tile side.
 */
export function writeCompressedPic(ctx: ExtractContext, label: string, path: string): number {
  const symbol = ctx.symbols.get(label);
  const compressed = ctx.rom.bytes(
    symbol.bank,
    symbol.address,
    0x8000 - symbol.address,
  );
  const pic = decompressPic(compressed);
  const image = decode2bpp(pic.data, pic.width * 8, pic.width * 8, false);
  matteColor0(image);
  ctx.emitAsset(path, encodePng(image));
  // Raw pixels beside the PNG, for the same reason as in tilesets: the lens has
  // no PNG decoder and does not need one, because the pixels are right here.
  const stem = path.lastIndexOf(".") < 0 ? path : path.substring(0, path.lastIndexOf("."));
  ctx.emitAsset(stem + ".rgba", encodeRgba(image));
  return pic.width;
}

/* ------------------------------------------------------------------------ */
/* pokemon.json                                                              */
/* ------------------------------------------------------------------------ */

interface EvolutionEntry {
  item?: string;
  level: number;
  method: string;
  species: string;
}

interface LearnEntry {
  level: number;
  move: string | null;
}

interface EvosMoves {
  evolutions: EvolutionEntry[];
  learnset: LearnEntry[];
}

/**
 * One species' evolution and level-up move stream. Port of
 * `_decode_evos_moves`: a method byte ($01 level, $02 stone, $03 trade) plus
 * its operands, terminated by $00, then (level, move) pairs ended by level 0.
 */
function decodeEvosMoves(ctx: ExtractContext, index: number): EvosMoves {
  const manifest = ctx.manifest;
  const table = ctx.symbols.get("EvosMovesPointerTable");
  let address = ctx.rom.word(table.bank, table.address + index * 2);

  const evolutions: EvolutionEntry[] = [];
  for (;;) {
    const method = ctx.rom.byte(table.bank, address);
    address += 1;
    if (method === 0) {
      break;
    }
    if (method === 1) {
      const row = ctx.rom.bytes(table.bank, address, 2);
      address += 2;
      evolutions.push({
        method: "LEVEL",
        level: row[0],
        species: speciesName(manifest, row[1]),
      });
    } else if (method === 2) {
      const row = ctx.rom.bytes(table.bank, address, 3);
      address += 3;
      evolutions.push({
        method: "ITEM",
        item: itemName(manifest, row[0]),
        level: row[1],
        species: speciesName(manifest, row[2]),
      });
    } else if (method === 3) {
      const row = ctx.rom.bytes(table.bank, address, 2);
      address += 2;
      evolutions.push({
        method: "TRADE",
        level: row[0],
        species: speciesName(manifest, row[1]),
      });
    } else {
      throw new Error(
        `unknown evolution method ${method} for species index ${index + 1}`,
      );
    }
  }

  const learnset: LearnEntry[] = [];
  for (;;) {
    const level = ctx.rom.byte(table.bank, address);
    address += 1;
    if (level === 0) {
      break;
    }
    const move = ctx.rom.byte(table.bank, address);
    address += 1;
    learnset.push({ level: level, move: moveName(manifest, move) });
  }
  return { evolutions: evolutions, learnset: learnset };
}

interface DexEntryData {
  heightFt: number;
  heightIn: number;
  kind: string;
  text: string;
  weight: number;
}

/**
 * One Pokedex entry header. Port of `_dex_entry`. `PokedexEntryPointers` is
 * indexed by INTERNAL species index, not dex number -- the table starts with
 * Rhydon. The flavour text sits in another bank behind a TX_FAR ($17) command,
 * so only its label is recorded; text.json carries the prose.
 */
function dexEntry(ctx: ExtractContext, index: number, species: string): DexEntryData {
  const manifest = ctx.manifest;
  const table = ctx.symbols.get("PokedexEntryPointers");
  let address = ctx.rom.word(table.bank, table.address + index * 2);
  const kind = readString(
    ctx.rom,
    table.bank,
    address,
    manifest.charmap,
    0x50,
    32,
  );
  address += kind.length;
  const height = ctx.rom.bytes(table.bank, address, 2);
  const weight = ctx.rom.word(table.bank, address + 2);
  address += 4;
  if (ctx.rom.byte(table.bank, address) !== 0x17) {
    throw new Error(`dex entry ${index + 1} has no TX_FAR command`);
  }
  const textAddress = ctx.rom.word(table.bank, address + 1);
  const textBank = ctx.rom.byte(table.bank, address + 3);
  const label = lookup(manifest.dexEntryLabels, species);
  return {
    kind: kind.text,
    heightFt: height[0],
    heightIn: height[1],
    weight: weight,
    text:
      label === null
        ? "_DexEntry_" + hex2(textBank) + "_" + hex4(textAddress)
        : label,
  };
}

/**
 * Build pokemon.json. `BaseStats` is 28-byte rows in dex order, except that
 * Red and Blue keep Mew out of the table at `MewBaseStats`; that symbol is
 * optional because Yellow folds Mew back in at dex 151. Row byte 0 repeats the
 * dex number and is checked, catching a mis-addressed table immediately.
 *
 * Species are keyed by their internal constant and `index` is the internal
 * index -- Bulbasaur is dex 1 but index 153. MISSINGNO, UNUSED, the fossil
 * objects and the Ghost are skipped, leaving 151.
 */
function buildPokemon(ctx: ExtractContext): SpeciesTable {
  const manifest = ctx.manifest;
  const speciesOrder = manifest.constants.speciesOrder;
  const dexOrder = manifest.dexOrder;
  const byId = typesById(manifest);
  const growthRates = manifest.growthRates;
  const tmhmMoves = manifest.tmhmMoves;

  const dexBySpecies: { [species: string]: number } = Object.create(
    null,
  ) as { [species: string]: number };
  for (let i = 0; i < dexOrder.length; i += 1) {
    dexBySpecies[dexOrder[i]] = i + 1;
  }

  const names = ctx.symbols.get("MonsterNames");
  const baseStats = ctx.symbols.get("BaseStats");
  const mewStats = ctx.symbols.tryGet("MewBaseStats");

  const decodedNames: string[] = [];
  for (let index = 0; index < speciesOrder.length; index += 1) {
    decodedNames.push(
      decodeText(
        ctx.rom.bytes(names.bank, names.address + index * 10, 10),
        manifest.charmap,
      ),
    );
  }

  const out: SpeciesTable = Object.create(null) as SpeciesTable;
  const writtenFront: BoolIndex = Object.create(null) as BoolIndex;
  const writtenBack: BoolIndex = Object.create(null) as BoolIndex;

  for (let index = 0; index < speciesOrder.length; index += 1) {
    const species = speciesOrder[index];
    if (
      species.indexOf("MISSINGNO") === 0 ||
      species.indexOf("UNUSED") === 0 ||
      species.indexOf("FOSSIL_") === 0 ||
      species.indexOf("MON_GHOST") === 0
    ) {
      continue;
    }
    const dex = dexBySpecies[species];
    if (dex === undefined) {
      throw new Error(`${species} is not in the manifest dex order`);
    }
    const row =
      species === "MEW" && mewStats !== null
        ? ctx.rom.bytes(mewStats.bank, mewStats.address, 28)
        : ctx.rom.bytes(
            baseStats.bank,
            baseStats.address + (dex - 1) * 28,
            28,
          );
    if (row[0] !== dex) {
      throw new Error(
        `${species} base stats store dex number ${row[0]}, expected ${dex}`,
      );
    }

    const level1Moves: string[] = [];
    for (let i = 15; i < 19; i += 1) {
      if (row[i] !== 0) {
        const move = moveName(manifest, row[i]);
        if (move !== null) {
          level1Moves.push(move);
        }
      }
    }

    const tmhm: string[] = [];
    for (let bit = 0; bit < tmhmMoves.length; bit += 1) {
      if ((row[20 + Math.floor(bit / 8)] & (1 << bit % 8)) !== 0) {
        tmhm.push(tmhmMoves[bit]);
      }
    }

    const evosMoves = decodeEvosMoves(ctx, index);

    const asset: ManifestPokemonAsset | undefined =
      manifest.pokemonAssets[species];
    if (asset === undefined) {
      throw new Error(`${species} has no entry in manifest.pokemonAssets`);
    }
    const front = asset.front;
    const back = asset.back;
    if (front !== "" && writtenFront[front] !== true) {
      const decodedSize = writeCompressedPic(
        ctx,
        asset.frontLabel,
        "battle/front/" + front + ".png",
      );
      if (decodedSize !== row[10] >> 4) {
        throw new Error(
          `${species}: front picture size ${decodedSize} does not match ` +
            `base stats ${row[10] >> 4}`,
        );
      }
      writtenFront[front] = true;
    }
    if (back !== "" && writtenBack[back] !== true) {
      writeCompressedPic(ctx, asset.backLabel, "battle/back/" + back + ".png");
      writtenBack[back] = true;
    }

    const types: string[] = [];
    for (let i = 6; i < 8; i += 1) {
      const name = typeName(byId, row[i]);
      if (types.indexOf(name) < 0) {
        types.push(name);
      }
    }

    if (row[19] >= growthRates.length) {
      throw new Error(`${species} has unknown growth rate ${row[19]}`);
    }

    out[species] = {
      id: species,
      index: index + 1,
      dex: dex,
      name: decodedNames[index],
      source: `ROM:BaseStats[${dex}]`,
      types: types,
      baseStats: {
        hp: row[1],
        attack: row[2],
        defense: row[3],
        speed: row[4],
        special: row[5],
      },
      catchRate: row[8],
      baseExp: row[9],
      level1Moves: level1Moves,
      growthRate: growthRates[row[19]],
      tmhm: tmhm,
      learnset: evosMoves.learnset as { level: number; move: string }[],
      evolutions: evosMoves.evolutions,
      spriteFront:
        front === "" ? null : "assets/generated/battle/front/" + front + ".png",
      spriteBack:
        back === "" ? null : "assets/generated/battle/back/" + back + ".png",
      frontSize: row[10] >> 4,
      dexEntry: dexEntry(ctx, index, species),
    } as SpeciesTable[string];
  }

  return out;
}

/* ------------------------------------------------------------------------ */
/* Registration                                                              */
/* ------------------------------------------------------------------------ */

export interface PokemonOutputs {
  moves: MoveTable;
  pokemon: SpeciesTable;
  type_chart: TypeChartDef;
}

export const builder: DatasetBuilder = {
  name: "pokemon",
  outputs: ["moves", "type_chart", "pokemon"],
  build(ctx: ExtractContext): PokemonOutputs {
    return {
      moves: buildMoves(ctx),
      type_chart: buildTypeChart(ctx),
      pokemon: buildPokemon(ctx),
    };
  },
};

export default builder;
