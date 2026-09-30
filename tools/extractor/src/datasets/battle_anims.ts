/**
 * battle_anims.json -- the move animation tables.
 *
 * Port of `extract_battle_anims` in gen1recomp/tools/build_rom_data.py. This
 * one was not part of the five-way split, so it is written here against the
 * same core and proved with the same gate.
 *
 * ---------------------------------------------------------------------------
 * What the ROM stores
 * ---------------------------------------------------------------------------
 *
 * A move animation is four indirections deep, and each level is a separate
 * table with its own indexing scheme:
 *
 *   AttackAnimationPointers[move]  -> a byte script, terminated by $FF
 *     Each step is either a special effect (2 bytes) or a subanimation
 *     (3 bytes). The first byte tells them apart: >= firstSpecialEffect ($D8)
 *     means "run effect N"; below that it packs the tileset in bits 6-7 and a
 *     frame delay in bits 0-5. The second byte is a sound index, $FF for none.
 *
 *   SubanimationPointers[n]        -> a packed header byte then N x 3 bytes
 *     Header: type in bits 5-7 (NORMAL / HFLIP / ... ), entry count in bits
 *     0-4. Each entry names a frame block, a base coordinate and a mode.
 *
 *   FrameBlockPointers[n]          -> a count byte then N x 4 bytes
 *     One OAM-shaped part per entry: y, x, tile, attributes. The attribute
 *     bits are the DMG sprite flags -- $20 x-flip, $40 y-flip, $80 priority,
 *     $10 palette 1.
 *
 *   FrameBlockBaseCoords[n]        -> y, x
 *
 * MoveAnimationTilesPointers holds three 4-byte rows (tile count, pointer low,
 * pointer high, $FF padding) naming the OAM tile atlases the scripts index
 * into. Tilesheet 2 shares its atlas with tilesheet 0, which is why the tile
 * payloads are grouped by path and take the largest tile count of the rows
 * that share one.
 *
 * ---------------------------------------------------------------------------
 * Why the validation is not optional
 * ---------------------------------------------------------------------------
 *
 * Every index in this file is a raw byte pointing into a table whose length
 * lives somewhere else. A subanimation that names frame block 200 out of 122,
 * or a script step whose tile index runs past the end of its atlas, is the
 * signature of a wrong symbol address -- and it would render as plausible
 * garbage rather than as an error. The reference checks all of it, so does
 * this, and the checks are what make a silent address drift loud.
 *
 * Runtime rules: no node:fs, no Record/Map/Set, inputs are never mutated.
 */

import { emitImage, hasOwn, read2bpp } from "./graphics";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type {
  AnimTilesheet,
  BattleAnimDef,
  FrameBlockPart,
  ManifestBlob,
  MoveAnimScript,
  MoveAnimStep,
  Point,
  SubanimBlock,
  SubanimDef,
  SubanimType,
} from "../types";

/** Attribute bits of a frame-block part, as the DMG OAM lays them out. */
const ATTR_PAL1 = 0x10;
const ATTR_XFLIP = 0x20;
const ATTR_YFLIP = 0x40;
const ATTR_PRIORITY = 0x80;

/** Script terminator, and the "no sound" sentinel in the same encoding. */
const SCRIPT_END = 0xff;

/** A runaway script is a wrong pointer, not a very long animation. */
const MAX_SCRIPT_STEPS = 256;

/** The three tilesheet rows in MoveAnimationTilesPointers. */
const TILESHEET_COUNT = 3;

/** Padding byte every tilesheet row ends with. */
const TILESHEET_PADDING = 0xff;

/** One row of MoveAnimationTilesPointers, joined to its manifest spec. */
interface TileRow {
  /** Tiles this sheet loads. */
  count: number;
  /** 16-bit address of the atlas inside the pointer table's bank. */
  pointer: number;
  /** Manifest entry: path, source, width, height. */
  spec: ManifestBlob;
  /** Index of the row, which is also the MoveAnimationTiles<n> symbol suffix. */
  index: number;
}

/** A decoded atlas, shared by every row that names the same path. */
interface TilePayload {
  pointer: number;
  tiles: number;
  spec: ManifestBlob;
  /** Row whose MoveAnimationTiles<n> symbol addresses this payload. */
  symbolIndex: number;
}

interface TilePayloadIndex {
  [path: string]: TilePayload;
}

/** FrameBlockBaseCoords: 177 y/x pairs, keyed by index. */
function readBaseCoords(
  ctx: ExtractContext,
  count: number,
): { [index: string]: Point } {
  const symbol = ctx.symbols.get("FrameBlockBaseCoords");
  const coords: { [index: string]: Point } = {};
  for (let index = 0; index < count; index += 1) {
    const pair = ctx.rom.bytes(symbol.bank, symbol.address + index * 2, 2);
    coords[String(index)] = { y: pair[0], x: pair[1] };
  }
  return coords;
}

/** FrameBlockPointers: a count byte then that many 4-byte OAM parts. */
function readFrameBlocks(
  ctx: ExtractContext,
  count: number,
): { [index: string]: FrameBlockPart[] } {
  const symbol = ctx.symbols.get("FrameBlockPointers");
  const blocks: { [index: string]: FrameBlockPart[] } = {};

  for (let index = 0; index < count; index += 1) {
    let address = ctx.rom.word(symbol.bank, symbol.address + index * 2);
    const partCount = ctx.rom.byte(symbol.bank, address);
    address += 1;

    const parts: FrameBlockPart[] = [];
    for (let i = 0; i < partCount; i += 1) {
      const raw = ctx.rom.bytes(symbol.bank, address, 4);
      const attrs = raw[3];
      const part: FrameBlockPart = {
        y: raw[0],
        x: raw[1],
        tile: raw[2],
        xflip: (attrs & ATTR_XFLIP) !== 0,
        yflip: (attrs & ATTR_YFLIP) !== 0,
      };
      // prio and pal1 are omitted when clear, not written as false: the
      // reference only sets them on the truthy branch and canonical JSON
      // distinguishes an absent key from a false one.
      if ((attrs & ATTR_PRIORITY) !== 0) {
        part.prio = true;
      }
      if ((attrs & ATTR_PAL1) !== 0) {
        part.pal1 = true;
      }
      parts.push(part);
      address += 4;
    }
    blocks[String(index)] = parts;
  }
  return blocks;
}

/** SubanimationPointers: a packed type/count byte then 3-byte entries. */
function readSubanims(
  ctx: ExtractContext,
  count: number,
  typeNames: string[],
  frameBlockCount: number,
  baseCoordCount: number,
): { [index: string]: SubanimDef } {
  const symbol = ctx.symbols.get("SubanimationPointers");
  const subanims: { [index: string]: SubanimDef } = {};

  for (let index = 0; index < count; index += 1) {
    let address = ctx.rom.word(symbol.bank, symbol.address + index * 2);
    const packed = ctx.rom.byte(symbol.bank, address);
    const typeId = packed >> 5;
    const entryCount = packed & 0x1f;
    if (typeId >= typeNames.length) {
      throw new Error(`subanimation ${index} has unknown type ${typeId}`);
    }
    address += 1;

    const blocks: SubanimBlock[] = [];
    for (let i = 0; i < entryCount; i += 1) {
      const raw = ctx.rom.bytes(symbol.bank, address, 3);
      if (raw[0] >= frameBlockCount) {
        throw new Error(
          `subanimation ${index} has invalid frame block ${raw[0]}`,
        );
      }
      if (raw[1] >= baseCoordCount) {
        throw new Error(
          `subanimation ${index} has invalid base coord ${raw[1]}`,
        );
      }
      blocks.push({ block: raw[0], coord: raw[1], mode: raw[2] });
      address += 3;
    }
    subanims[String(index)] = {
      type: typeNames[typeId] as SubanimType,
      blocks: blocks,
    };
  }
  return subanims;
}

/**
 * Read the three tilesheet rows and cross-check each against its symbol.
 *
 * The row carries the atlas address as two loose bytes; the manifest also
 * ships a MoveAnimationTiles<n> symbol for the same address. Requiring them to
 * agree turns a stale symbol table into an immediate failure instead of an
 * atlas full of the wrong tiles.
 */
function readTileRows(ctx: ExtractContext, specs: ManifestBlob[]): TileRow[] {
  if (specs.length !== TILESHEET_COUNT) {
    throw new Error("expected three battle animation tilesheets");
  }
  const table = ctx.symbols.get("MoveAnimationTilesPointers");
  const rows: TileRow[] = [];

  for (let index = 0; index < specs.length; index += 1) {
    const raw = ctx.rom.bytes(table.bank, table.address + index * 4, 4);
    if (raw[3] !== TILESHEET_PADDING) {
      throw new Error(
        `battle animation tilesheet ${index} has invalid padding`,
      );
    }
    const pointer = raw[1] | (raw[2] << 8);
    const expected = ctx.symbols.get("MoveAnimationTiles" + String(index));
    if (expected.bank !== table.bank || expected.address !== pointer) {
      throw new Error(
        `battle animation tilesheet ${index} pointer differs`,
      );
    }
    rows.push({
      count: raw[0],
      pointer: pointer,
      spec: specs[index],
      index: index,
    });
  }
  return rows;
}

/**
 * Decode each distinct atlas once and hand it to the asset sink.
 *
 * Two rows can name the same PNG (sheet 2 reuses sheet 0's), in which case the
 * larger tile count wins -- and the two rows had better agree on the pointer,
 * or the manifest is describing a different ROM.
 */
function emitTileAtlases(ctx: ExtractContext, rows: TileRow[]): void {
  const payloads: TilePayloadIndex = Object.create(null) as TilePayloadIndex;
  const order: string[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const path = String(row.spec.path);
    if (hasOwn(payloads, path)) {
      const existing = payloads[path];
      if (existing.pointer !== row.pointer) {
        throw new Error(
          `shared battle animation atlas ${path} has two pointers`,
        );
      }
      if (row.count > existing.tiles) {
        existing.tiles = row.count;
      }
      continue;
    }
    payloads[path] = {
      pointer: row.pointer,
      tiles: row.count,
      spec: row.spec,
      symbolIndex: row.index,
    };
    order.push(path);
  }

  for (let i = 0; i < order.length; i += 1) {
    const path = order[i];
    const payload = payloads[path];
    const width = Number(payload.spec.width);
    const height = Number(payload.spec.height);
    const byteLength = (width * height) / 4;
    const storedLength = payload.tiles * 16;
    if (storedLength > byteLength) {
      throw new Error(`${path}: battle animation atlas is too large`);
    }
    const prefix = "assets/generated/";
    if (path.indexOf(prefix) !== 0) {
      throw new Error(`invalid generated asset path ${JSON.stringify(path)}`);
    }
    // The row/symbol agreement checked above is what lets this read by symbol
    // instead of by raw pointer, so it reuses the shared 2bpp reader.
    const image = read2bpp(
      ctx,
      "MoveAnimationTiles" + String(payload.symbolIndex),
      width,
      height,
      { transparent: true, storedLength: storedLength },
    );
    emitImage(ctx, path.substring(prefix.length), image);
  }
}

/** One script step: a special effect, or a subanimation with its timing. */
function readScriptStep(
  ctx: ExtractContext,
  bank: number,
  address: number,
  name: string,
  metadata: ManifestBlob,
  tilesheetCount: number,
): { step: MoveAnimStep; size: number } {
  const first = ctx.rom.byte(bank, address);
  const firstSpecial = Number(metadata.firstSpecialEffect);

  if (first >= firstSpecial) {
    const effects = metadata.specialEffects as { [code: string]: string };
    const key = String(first);
    const effect = hasOwn(effects, key) ? effects[key] : "";
    if (effect === "") {
      throw new Error(
        `${name}: unknown special effect $${first.toString(16).toUpperCase().padStart(2, "0")}`,
      );
    }
    return { step: { effect: effect }, size: 2 };
  }

  const subanim = ctx.rom.byte(bank, address + 2);
  const delay = first & 0x3f;
  const tileset = first >> 6;
  if (delay === 0) {
    throw new Error(`${name}: zero animation delay`);
  }
  if (subanim >= Number(metadata.subanimCount)) {
    throw new Error(`${name}: unknown subanimation ${subanim}`);
  }
  if (tileset >= tilesheetCount) {
    throw new Error(`${name}: unknown animation tileset ${tileset}`);
  }
  return {
    step: { subanim: subanim, tileset: tileset, delay: delay },
    size: 3,
  };
}

/** AttackAnimationPointers: one $FF-terminated script per move. */
function readMoveAnims(
  ctx: ExtractContext,
  moveNames: string[],
  moveOrder: string[],
  metadata: ManifestBlob,
  tilesheetCount: number,
): { [moveId: string]: MoveAnimScript } {
  const table = ctx.symbols.get("AttackAnimationPointers");
  const anims: { [moveId: string]: MoveAnimScript } = {};

  for (let index = 0; index < moveNames.length; index += 1) {
    const name = moveNames[index];
    let address = ctx.rom.word(table.bank, table.address + index * 2);
    const seq: MoveAnimStep[] = [];
    let terminated = false;

    for (let guard = 0; guard < MAX_SCRIPT_STEPS; guard += 1) {
      if (ctx.rom.byte(table.bank, address) === SCRIPT_END) {
        terminated = true;
        break;
      }
      const sound = ctx.rom.byte(table.bank, address + 1);
      const read = readScriptStep(
        ctx,
        table.bank,
        address,
        name,
        metadata,
        tilesheetCount,
      );
      address += read.size;

      const step = read.step;
      if (sound !== SCRIPT_END) {
        if (sound >= moveOrder.length) {
          throw new Error(`${name}: unknown animation sound ${sound}`);
        }
        step.sound = moveOrder[sound];
      }
      seq.push(step);
    }
    if (!terminated) {
      throw new Error(`${name}: unterminated battle animation`);
    }

    anims[name] = {
      source: `ROM:AttackAnimationPointers[${index}]`,
      seq: seq,
    };
  }
  return anims;
}

/**
 * Every tile a script can reach has to exist in the atlas it loads.
 *
 * This is the check that catches a tilesheet whose tile count is read from the
 * wrong row: the JSON would still be well-formed and the animation would draw
 * whatever happened to be past the end of the sheet.
 */
function assertTilesInRange(
  anims: { [moveId: string]: MoveAnimScript },
  subanims: { [index: string]: SubanimDef },
  frameBlocks: { [index: string]: FrameBlockPart[] },
  tilesheets: { [index: string]: AnimTilesheet },
): void {
  const names = Object.keys(anims);
  for (let i = 0; i < names.length; i += 1) {
    const seq = anims[names[i]].seq;
    for (let j = 0; j < seq.length; j += 1) {
      const step = seq[j];
      if (step.subanim === undefined || step.tileset === undefined) {
        continue;
      }
      const sheet = tilesheets[String(step.tileset)];
      const blocks = subanims[String(step.subanim)].blocks;
      for (let k = 0; k < blocks.length; k += 1) {
        const parts = frameBlocks[String(blocks[k].block)];
        for (let p = 0; p < parts.length; p += 1) {
          if (parts[p].tile >= sheet.tiles) {
            throw new Error(
              `${names[i]}: tile ${parts[p].tile} is out of range for ` +
                `tileset ${step.tileset}`,
            );
          }
        }
      }
    }
  }
}

function build(ctx: ExtractContext): BattleAnimDef {
  const metadata = ctx.manifest.battleAnimations;
  const moveOrder = ctx.manifest.constants.moveOrder;
  if (moveOrder.length !== Number(metadata.moveCount)) {
    throw new Error("battle animation move count does not match constants");
  }

  const baseCoordCount = Number(metadata.baseCoordCount);
  const frameBlockCount = Number(metadata.frameBlockCount);

  const baseCoords = readBaseCoords(ctx, baseCoordCount);
  const frameBlocks = readFrameBlocks(ctx, frameBlockCount);
  const subanims = readSubanims(
    ctx,
    Number(metadata.subanimCount),
    metadata.subanimTypes as string[],
    frameBlockCount,
    baseCoordCount,
  );

  const rows = readTileRows(ctx, metadata.tilesheets as ManifestBlob[]);
  emitTileAtlases(ctx, rows);

  const tilesheets: { [index: string]: AnimTilesheet } = {};
  for (let i = 0; i < rows.length; i += 1) {
    tilesheets[String(i)] = {
      path: String(rows[i].spec.path),
      width: Number(rows[i].spec.width),
      height: Number(rows[i].spec.height),
      tiles: rows[i].count,
      source: String(rows[i].spec.source),
    };
  }

  // The misc animations (SHOWPIC_ANIM and friends) continue the pointer table
  // past the last real move, so they are indexed as if they were moves.
  const moveNames = moveOrder.concat(metadata.miscAnimations as string[]);
  const moveAnims = readMoveAnims(
    ctx,
    moveNames,
    moveOrder,
    metadata,
    rows.length,
  );
  assertTilesInRange(moveAnims, subanims, frameBlocks, tilesheets);

  return {
    tilesheets: tilesheets,
    baseCoords: baseCoords,
    frameBlocks: frameBlocks,
    subanims: subanims,
    moveAnims: moveAnims,
  };
}

export const builder: DatasetBuilder = {
  name: "battle_anims",
  build: build,
};

export default builder;
