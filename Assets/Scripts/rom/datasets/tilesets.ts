/**
 * tilesets.json -- the 24 overworld tilesets, and the tile sheets they draw.
 *
 * Port of `extract_tilesets` in gen1recomp/tools/build_rom_data.py.
 *
 * A Gen 1 map is a grid of BLOCKS, not tiles. One block is 16 tile indices
 * laid out as a 4x4 grid of 8x8 tiles, so a block is 32x32 px and a 20x18
 * screen shows five by four-and-a-half of them. `blocks[b]` here is that
 * 16-entry row-major list, and a map's block index selects one of them.
 *
 * The ROM's `Tilesets` table is 12 bytes per entry:
 *
 *   +0  bank holding the blockset and the tile sheet
 *   +1  pointer to the blockset (blockCount * 16 bytes)
 *   +3  pointer to the 2bpp tile sheet
 *   +5  pointer to the collision list ($FF terminated)
 *   +7  three counter tile ids, $FF for unused
 *   +10 the grass tile id, $FF when the tileset has no grass
 *   +11 index into tileAnimations
 *
 * The renderer leans hardest on two of the derived lists, so both are decoded
 * from the cart rather than guessed:
 *
 *   walkable   collision list: the tile ids the player may stand on. Every
 *              other tile is a wall. Sorted, not de-duplicated -- the cart
 *              does repeat ids and the reference keeps them.
 *   grassTile  the tile that triggers wild encounters, or null. Present as an
 *              explicit null, never omitted; see the contract note in
 *              registry.ts about omitted vs null keys.
 *
 * Four tile sheets are shared by more than one tileset (gym, gate, pokecenter,
 * reds_house), and only the FIRST tileset in `tilesetOrder` that names a sheet
 * writes it -- MART writes pokecenter.png and POKECENTER reuses it, DOJO
 * writes gym.png and GYM reuses it. That ordering is load-bearing and is
 * reproduced exactly.
 *
 * PNGs go to `ctx.emitAsset`, which is not part of the JSON contract: the
 * golden files carry only the path strings built from the manifest.
 */

import { encodeRgba } from "./graphics";
import { decode2bpp, type DecodedImage } from "../core/decode";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type { ManifestTilesetMeta, TilesetDef, TilesetTable } from "../types";

/** Bytes per row of the ROM `Tilesets` table. */
const HEADER_STRIDE = 12;
/** Tile indices per block: a 4x4 grid. */
const BLOCK_SIZE = 16;
/** Bytes per 8x8 tile at 2 bits per pixel. */
const BYTES_PER_TILE = 16;
/** Counter tile slots in a tileset header. */
const COUNTER_COUNT = 3;
/** Terminator for the collision, warp and door tile lists. */
const END_OF_LIST = 0xff;
/** Bytes per `DoorTileIDPointers` row: tileset id, then a 16-bit pointer. */
const DOOR_STRIDE = 3;
/** Start of the banked window; a pointer below it addresses ROM0. */
const BANKED_WINDOW = 0x4000;
/** Pixels along one edge of a tile. */
const TILE_SIZE = 8;
/** Upper bound on the door pointer table, so a bad read cannot spin forever. */
const MAX_DOOR_ROWS = 256;

interface TileIdLists {
  [tilesetId: string]: number[];
}

/* ------------------------------------------------------------------------ */
/* Small list helpers                                                        */
/* ------------------------------------------------------------------------ */

/** Ascending numeric sort on a copy. JS sorts lexicographically by default. */
function sortedNumbers(values: number[]): number[] {
  const out = values.slice();
  out.sort(function ascending(a: number, b: number): number {
    return a - b;
  });
  return out;
}

/** `sorted(set(values))`, without a Set -- Lens Studio TypeScript has none. */
function sortedUnique(values: number[]): number[] {
  const sorted = sortedNumbers(values);
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) {
      out.push(sorted[i]);
    }
  }
  return out;
}

/** Split a blockset into one 16-entry tile-index list per block. */
function splitBlocks(raw: Uint8Array, blockCount: number): number[][] {
  if (raw.length !== blockCount * BLOCK_SIZE) {
    throw new Error(
      `blockset is ${raw.length} bytes, expected ${blockCount * BLOCK_SIZE}`,
    );
  }
  const blocks: number[][] = [];
  for (let index = 0; index < blockCount; index += 1) {
    const block: number[] = [];
    const base = index * BLOCK_SIZE;
    for (let slot = 0; slot < BLOCK_SIZE; slot += 1) {
      block.push(raw[base + slot]);
    }
    blocks.push(block);
  }
  return blocks;
}

/* ------------------------------------------------------------------------ */
/* Door tiles                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Decode `DoorTileIDPointers`: rows of (tileset id, pointer to a 0-terminated
 * tile id list), ending at a tileset id of $FF. Tilesets absent from the table
 * simply have no doors.
 */
function readDoorTiles(ctx: ExtractContext): TileIdLists {
  const pointers = ctx.symbols.get("DoorTileIDPointers");
  const doors: TileIdLists = {};
  let address = pointers.address;
  for (let row = 0; row < MAX_DOOR_ROWS; row += 1) {
    const tilesetId = ctx.rom.byte(pointers.bank, address);
    if (tilesetId === END_OF_LIST) {
      return doors;
    }
    const pointer = ctx.rom.word(pointers.bank, address + 1);
    doors[String(tilesetId)] = ctx.rom.readTerminated(
      pointers.bank,
      pointer,
      0,
    );
    address += DOOR_STRIDE;
  }
  throw new Error("DoorTileIDPointers has no $FF terminator");
}

/* ------------------------------------------------------------------------ */
/* PNG output                                                                */
/* ------------------------------------------------------------------------ */

const PNG_SIGNATURE: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Largest payload a single deflate stored block can carry. */
const MAX_STORED_BLOCK = 0xffff;

let crcTable: number[] | null = null;

function crc32Table(): number[] {
  if (crcTable === null) {
    const table: number[] = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let bit = 0; bit < 8; bit += 1) {
        c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table.push(c >>> 0);
    }
    crcTable = table;
  }
  return crcTable;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

function writeUint32(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 24) & 0xff;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

/**
 * Wrap `data` in a zlib stream built entirely from deflate STORED blocks.
 *
 * No compressor: the Lens sandbox has no zlib and the extractor must not grow
 * a dependency for it. Stored blocks are a valid deflate encoding, so every
 * PNG decoder reads the result; the file is simply bigger than one PIL writes.
 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_STORED_BLOCK));
  const out = new Uint8Array(2 + blockCount * 5 + raw.length + 4);
  let at = 0;
  // CMF $78 (deflate, 32K window) + FLG $01: (0x78 << 8 | 0x01) % 31 === 0.
  out[at] = 0x78;
  out[at + 1] = 0x01;
  at += 2;

  let offset = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const size = Math.min(MAX_STORED_BLOCK, raw.length - offset);
    out[at] = block === blockCount - 1 ? 1 : 0; // BFINAL, BTYPE 00
    out[at + 1] = size & 0xff;
    out[at + 2] = (size >> 8) & 0xff;
    out[at + 3] = ~size & 0xff;
    out[at + 4] = (~size >> 8) & 0xff;
    at += 5;
    out.set(raw.subarray(offset, offset + size), at);
    at += size;
    offset += size;
  }
  writeUint32(out, at, adler32(raw));
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Prefix every scanline with filter type 0 (None), as PNG requires. */
function filterScanlines(image: DecodedImage): Uint8Array {
  const stride = image.width * 4;
  const out = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const source = y * stride;
    const target = y * (stride + 1);
    out[target] = 0;
    out.set(image.pixels.subarray(source, source + stride), target + 1);
  }
  return out;
}

/** Encode an RGBA image as an 8-bit truecolour-with-alpha PNG. */
function encodePng(image: DecodedImage): Uint8Array {
  const header = new Uint8Array(13);
  writeUint32(header, 0, image.width);
  writeUint32(header, 4, image.height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const parts: Uint8Array[] = [
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStored(filterScanlines(image))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  let total = 0;
  for (let i = 0; i < parts.length; i += 1) {
    total += parts[i].length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < parts.length; i += 1) {
    out.set(parts[i], at);
    at += parts[i].length;
  }
  return out;
}

/** Decode a 2bpp run and hand the PNG to the asset sink. */
function emit2bppPng(
  ctx: ExtractContext,
  raw: Uint8Array,
  width: number,
  height: number,
  path: string,
): void {
  const image = decode2bpp(raw, width, height);
  ctx.emitAsset(path, encodePng(image));
  // Also emit the raw pixels. The lens has no PNG decoder and needs none: the
  // pixels exist right here, one call before they are compressed. Emitting both
  // keeps the PNG path byte-identical to the reference for the gate, and gives
  // the lens something it can actually read.
  const stem = path.lastIndexOf(".") < 0 ? path : path.substring(0, path.lastIndexOf("."));
  ctx.emitAsset(stem + ".rgba", encodeRgba(image));
}

/* ------------------------------------------------------------------------ */
/* Tile sheets                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Emit one tileset's sheet.
 *
 * The sheet is stored between `gfxPointer` and `blockPointer`, and is usually
 * SHORTER than the VRAM area it is loaded into: the tail tiles are filled in
 * at runtime (animated water, the flower frames). The reference pads the
 * shortfall with zero bytes, which decode as solid white, so the PNG has the
 * full declared size with a blank tail.
 */
function emitTileSheet(
  ctx: ExtractContext,
  spec: ManifestTilesetMeta,
  constName: string,
  gfxBank: number,
  gfxPointer: number,
  blockPointer: number,
): void {
  const byteLength = Math.floor((spec.imageWidth * spec.imageHeight) / 4);
  const storedLength = blockPointer - gfxPointer;
  if (
    storedLength < 0 ||
    storedLength > byteLength ||
    storedLength % BYTES_PER_TILE !== 0
  ) {
    throw new Error(
      `${constName}: invalid stored tileset graphics length ${storedLength}`,
    );
  }
  const pixels = new Uint8Array(byteLength);
  pixels.set(ctx.rom.bytes(gfxBank, gfxPointer, storedLength), 0);
  emit2bppPng(
    ctx,
    pixels,
    spec.imageWidth,
    spec.imageHeight,
    `tilesets/${spec.imageBase}.png`,
  );
}

/** The three flower frames and the spinner arrows, animated in by the engine. */
function emitAnimationTiles(ctx: ExtractContext): void {
  for (let frame = 1; frame <= 3; frame += 1) {
    const symbol = ctx.symbols.get(`FlowerTile${frame}`);
    emit2bppPng(
      ctx,
      ctx.rom.bytes(symbol.bank, symbol.address, BYTES_PER_TILE),
      TILE_SIZE,
      TILE_SIZE,
      `tilesets/flower${frame}.png`,
    );
  }
  const spinner = ctx.symbols.get("SpinnerArrowAnimTiles");
  emit2bppPng(
    ctx,
    ctx.rom.bytes(spinner.bank, spinner.address, BYTES_PER_TILE * 4),
    TILE_SIZE * 4,
    TILE_SIZE,
    "tilesets/spinners.png",
  );
}

/* ------------------------------------------------------------------------ */
/* Builder                                                                   */
/* ------------------------------------------------------------------------ */

export const builder: DatasetBuilder = {
  name: "tilesets",
  build(ctx: ExtractContext): TilesetTable {
    const order = ctx.manifest.constants.tilesetOrder;
    const metadata = ctx.manifest.tilesets;
    const animations = ctx.manifest.tileAnimations;
    if (!Array.isArray(metadata) || metadata.length !== order.length) {
      throw new Error("tileset metadata count does not match constants");
    }

    const headers = ctx.symbols.get("Tilesets");
    const warpPointers = ctx.symbols.get("WarpTileIDPointers");
    const doors = readDoorTiles(ctx);

    const out: TilesetTable = {};
    const writtenImages: string[] = [];

    for (let index = 0; index < order.length; index += 1) {
      const constName = order[index];
      const spec = metadata[index];
      if (spec.id !== constName) {
        throw new Error(
          `tileset metadata ${spec.id} is out of order at ${constName}`,
        );
      }

      const rowAddress = headers.address + index * HEADER_STRIDE;
      const gfxBank = ctx.rom.byte(headers.bank, rowAddress);
      const blockPointer = ctx.rom.word(headers.bank, rowAddress + 1);
      const gfxPointer = ctx.rom.word(headers.bank, rowAddress + 3);
      const collisionPointer = ctx.rom.word(headers.bank, rowAddress + 5);
      const counters = ctx.rom.bytes(headers.bank, rowAddress + 7, COUNTER_COUNT);
      const grass = ctx.rom.byte(headers.bank, rowAddress + 10);
      const animationId = ctx.rom.byte(headers.bank, rowAddress + 11);
      if (animationId >= animations.length) {
        throw new Error(`${constName}: unknown tile animation ${animationId}`);
      }

      const blocks = splitBlocks(
        ctx.rom.bytes(gfxBank, blockPointer, spec.blockCount * BLOCK_SIZE),
        spec.blockCount,
      );

      // Red and Blue keep the collision lists in ROM0; a pointer inside the
      // banked window would belong to bank 1 (where Yellow moved them).
      const collisionBank = collisionPointer < BANKED_WINDOW ? 0 : 1;
      const walkable = sortedNumbers(
        ctx.rom.readTerminated(collisionBank, collisionPointer, END_OF_LIST),
      );

      const warpPointer = ctx.rom.word(
        warpPointers.bank,
        warpPointers.address + index * 2,
      );
      const warpTiles = sortedUnique(
        ctx.rom.readTerminated(warpPointers.bank, warpPointer, END_OF_LIST),
      );

      const counterTiles: number[] = [];
      for (let slot = 0; slot < counters.length; slot += 1) {
        if (counters[slot] !== END_OF_LIST) {
          counterTiles.push(counters[slot]);
        }
      }

      const doorList = doors[String(index)];
      if (writtenImages.indexOf(spec.imageBase) < 0) {
        emitTileSheet(
          ctx,
          spec,
          constName,
          gfxBank,
          gfxPointer,
          blockPointer,
        );
        writtenImages.push(spec.imageBase);
      }

      const def: TilesetDef = {
        animation: animations[animationId],
        blocks: blocks,
        counterTiles: counterTiles,
        doorTiles: doorList === undefined ? [] : sortedNumbers(doorList),
        grassTile: grass === END_OF_LIST ? null : grass,
        id: constName,
        image: `assets/generated/tilesets/${spec.imageBase}.png`,
        imageHeight: spec.imageHeight,
        imageWidth: spec.imageWidth,
        source: `ROM:Tilesets[${index}]`,
        tilesPerRow: Math.floor(spec.imageWidth / TILE_SIZE),
        walkable: walkable,
        warpTiles: warpTiles,
      };
      out[constName] = def;
    }

    emitAnimationTiles(ctx);
    return out;
  },
};

export default builder;
