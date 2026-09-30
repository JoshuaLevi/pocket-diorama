/**
 * maps.json -- the 222 Kanto map headers, block maps, connections, warps,
 * signs and object events.
 *
 * Port of `extract_maps` in gen1recomp/tools/build_rom_data.py. The golden
 * file is the contract; every validation the reference performs is kept, in
 * the same order, so a bad ROM or a drifted manifest fails here rather than
 * producing a plausible-looking diorama.
 *
 * What the ROM actually stores, per map:
 *
 *   <Label>_h:  the map header, 10 bytes
 *     +0  tileset id            index into constants.tilesetOrder
 *     +1  height                in BLOCKS (one block is 4x4 tiles)
 *     +2  width                 in blocks
 *     +3  block map pointer     16-bit, same bank as the header
 *     +5  text pointer          not read here
 *     +7  script pointer        not read here
 *     +9  connection flags      bit 3 north, 2 south, 1 west, 0 east
 *
 *   Then one 11-byte connection block per set flag, in north/south/west/east
 *   order, of which only three bytes matter here: the destination map id at
 *   +0 and the y/x alignment bytes at +7/+8. Which alignment byte carries the
 *   offset depends on the axis: a north or south neighbour slides along X, an
 *   east or west neighbour slides along Y. The stored value is in TILES and
 *   negated, so the block offset is `-encoded / 2`; the reference asserts the
 *   byte is even rather than rounding, because an odd value would mean the
 *   header does not describe a block-aligned connection and every downstream
 *   coordinate would be half a block out.
 *
 *   Then a 16-bit pointer to the object-event block, which holds the border
 *   block, the warp list, the sign list and the object list, each preceded by
 *   its own count byte.
 *
 * The manifest supplies what assembly erased: the map label, the human name
 * and text id of every object, the sign texts, and the true length of the
 * block payload (the ROM stores no length, and short payloads are padded out
 * with the border block).
 */

import type { DatasetBuilder, ExtractContext } from "../registry";
import type {
  ManifestBlob,
  ManifestMapMeta,
  MapConnection,
  MapConnections,
  MapDef,
  MapDimensions,
  MapObject,
  MapObjectMovement,
  MapObjectRange,
  MapSign,
  MapTable,
  MapWarp,
} from "../types";

/** Bytes of map header before the connection blocks start. */
const MAP_HEADER_SIZE = 10;
/** Offset of the connection flags byte inside the header. */
const CONNECTION_FLAGS_OFFSET = 9;
/** Bytes per connection block. */
const CONNECTION_SIZE = 11;
/** Offsets of the y and x alignment bytes inside a connection block. */
const CONNECTION_Y_ALIGN = 7;
const CONNECTION_X_ALIGN = 8;
/** Record sizes in the object-event block. */
const WARP_SIZE = 4;
const SIGN_SIZE = 3;
const OBJECT_SIZE = 6;
/** Connection-flag bits the engine defines; anything else is a decode error. */
const KNOWN_CONNECTION_FLAGS = 0x0f;
/** Map id meaning "wherever the player came from". */
const LAST_MAP_ID = 0xff;
/** Text-id flags that say an object carries an extra payload byte. */
const OBJECT_ITEM_FLAG = 0x80;
const OBJECT_TRAINER_FLAG = 0x40;
/**
 * Object coordinates are stored with the 4-block border baked in; the world
 * grid starts at (0, 0), so the border is subtracted back out.
 */
const OBJECT_BORDER = 4;

interface DirectionSpec {
  name: string;
  bit: number;
  /** True when a neighbour on this edge slides along X rather than Y. */
  alongX: boolean;
}

/** Connection order in the header: north, south, west, east. */
const DIRECTIONS: DirectionSpec[] = [
  { name: "north", bit: 0x08, alongX: true },
  { name: "south", bit: 0x04, alongX: true },
  { name: "west", bit: 0x02, alongX: false },
  { name: "east", bit: 0x01, alongX: false },
];

function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

/** Two's-complement reading of a single byte. */
function signedByte(value: number): number {
  return (value & 0x80) !== 0 ? value - 0x100 : value;
}

/** Whether a manifest object spec declares a key at all, null included. */
function hasKey(spec: ManifestBlob, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(spec, key);
}

/** Resolve a stored map id, or the sentinel for "the map we came from". */
function mapIdAt(order: string[], value: number): string {
  if (value === LAST_MAP_ID) {
    return "LAST_MAP";
  }
  if (value >= order.length) {
    throw new Error(`unknown map id $${hex2(value)}`);
  }
  return order[value];
}

/** Movement byte -> name, or null when the encoding is not one we know. */
function movementName(value: number): MapObjectMovement | null {
  if (value === 0xfe) {
    return "WALK";
  }
  if (value === 0xff) {
    return "STAY";
  }
  return null;
}

/** Range byte -> name, or null when the encoding is not one we know. */
function rangeName(value: number): MapObjectRange | null {
  switch (value) {
    case 0x00:
      return "ANY_DIR";
    case 0x01:
      return "UP_DOWN";
    case 0x02:
      return "LEFT_RIGHT";
    case 0x10:
      return "BOULDER_MOVEMENT_BYTE_2";
    case 0xd0:
      return "DOWN";
    case 0xd1:
      return "UP";
    case 0xd2:
      return "LEFT";
    case 0xd3:
      return "RIGHT";
    case 0xff:
      return "NONE";
    default:
      return null;
  }
}

/**
 * `trainerParty` as the reference computes it.
 *
 * build_rom_data.py hands a manifest-supplied party name through verbatim
 * when it is a string, and otherwise stores the level/party byte read from
 * the ROM. No shipped manifest -- red, blue or yellow -- carries a string in
 * any of the 334 trainer objects, so the golden file only ever exercises the
 * numeric branch and `MapObject.trainerParty` in ../types is declared
 * `number`. The branch is ported anyway so a future manifest behaves the same
 * way in both implementations; the assertion is the one place that costs.
 */
function trainerPartyValue(spec: ManifestBlob, romValue: number): number {
  const override: unknown = spec["trainerParty"];
  if (typeof override === "string") {
    return override as unknown as number;
  }
  return romValue;
}

/** Read the border block, warps, signs and objects for one map. */
function readObjectEvents(
  ctx: ExtractContext,
  mapId: string,
  spec: ManifestMapMeta,
  bank: number,
  objectPointer: number,
  mapOrder: string[],
  spriteOrder: string[],
): { borderBlock: number; warps: MapWarp[]; signs: MapSign[]; objects: MapObject[] } {
  const rom = ctx.rom;
  let address = objectPointer;

  const borderBlock = rom.byte(bank, address);
  address += 1;

  const warpCount = rom.byte(bank, address);
  address += 1;
  const warps: MapWarp[] = [];
  for (let i = 0; i < warpCount; i += 1) {
    const row = rom.bytes(bank, address, WARP_SIZE);
    warps.push({
      x: row[1],
      y: row[0],
      destMap: mapIdAt(mapOrder, row[3]),
      destWarp: row[2] + 1,
    });
    address += WARP_SIZE;
  }

  const signCount = rom.byte(bank, address);
  address += 1;
  if (signCount !== spec.signTexts.length) {
    throw new Error(
      `${mapId}: ROM has ${signCount} signs, metadata has ` +
        `${spec.signTexts.length}`,
    );
  }
  const signs: MapSign[] = [];
  for (let i = 0; i < spec.signTexts.length; i += 1) {
    // The third byte is the sign's text id; the manifest names it instead.
    const row = rom.bytes(bank, address, SIGN_SIZE);
    signs.push({ x: row[1], y: row[0], text: spec.signTexts[i] });
    address += SIGN_SIZE;
  }

  const objectCount = rom.byte(bank, address);
  address += 1;
  if (objectCount !== spec.objects.length) {
    throw new Error(
      `${mapId}: ROM has ${objectCount} objects, metadata has ` +
        `${spec.objects.length}`,
    );
  }
  const objects: MapObject[] = [];
  for (let i = 0; i < spec.objects.length; i += 1) {
    const objectSpec = spec.objects[i];
    const index = i + 1;
    const row = rom.bytes(bank, address, OBJECT_SIZE);
    const spriteId = row[0];
    const movement = movementName(row[3]);
    const range = rangeName(row[4]);
    const textId = row[5];
    if (spriteId < 1 || spriteId > spriteOrder.length) {
      throw new Error(`${mapId} object ${index}: unknown sprite ${spriteId}`);
    }
    if (movement === null || range === null) {
      throw new Error(`${mapId} object ${index}: unknown movement encoding`);
    }
    const object: MapObject = {
      index: index,
      x: row[2] - OBJECT_BORDER,
      y: row[1] - OBJECT_BORDER,
      sprite: spriteOrder[spriteId - 1],
      movement: movement,
      range: range,
      text: objectSpec["text"],
      name: objectSpec["name"],
    };
    address += OBJECT_SIZE;

    if ((textId & OBJECT_ITEM_FLAG) !== 0) {
      // An item ball: one extra byte holds the item id, which the manifest
      // already names, so it is skipped rather than read.
      if (!hasKey(objectSpec, "item")) {
        throw new Error(`${mapId} object ${index}: unexpected item payload`);
      }
      object.item = objectSpec["item"];
      address += 1;
    } else if ((textId & OBJECT_TRAINER_FLAG) !== 0) {
      // A trainer or a static encounter: two extra bytes, of which the second
      // is the party number or the Pokemon's level.
      const extra = rom.bytes(bank, address, 2);
      const levelOrParty = extra[1];
      address += 2;
      if (hasKey(objectSpec, "trainerClass")) {
        object.trainerClass = objectSpec["trainerClass"];
        object.trainerParty = trainerPartyValue(objectSpec, levelOrParty);
      } else if (hasKey(objectSpec, "pokemon")) {
        object.pokemon = objectSpec["pokemon"];
        object.level = levelOrParty;
      } else {
        throw new Error(
          `${mapId} object ${index}: unexpected trainer or static Pokemon ` +
            "payload",
        );
      }
    } else if (
      hasKey(objectSpec, "item") ||
      hasKey(objectSpec, "trainerClass") ||
      hasKey(objectSpec, "pokemon")
    ) {
      throw new Error(`${mapId} object ${index}: missing extra payload`);
    }

    if (hasKey(objectSpec, "hidden")) {
      object.hidden = objectSpec["hidden"];
    }
    objects.push(object);
  }

  return { borderBlock: borderBlock, warps: warps, signs: signs, objects: objects };
}

/** Decode one map header, its connections and its object-event block. */
function buildMap(
  ctx: ExtractContext,
  mapId: string,
  spec: ManifestMapMeta,
  dims: MapDimensions,
  mapOrder: string[],
  tilesetOrder: string[],
  spriteOrder: string[],
): MapDef {
  const rom = ctx.rom;
  const header = ctx.symbols.get(spec.label + "_h");
  const bank = header.bank;
  let address = header.address;

  const tilesetId = rom.byte(bank, address);
  const height = rom.byte(bank, address + 1);
  const width = rom.byte(bank, address + 2);
  if (width !== dims.width || height !== dims.height) {
    throw new Error(
      `${mapId}: ROM dimensions ${width}x${height} do not match manifest ` +
        `${dims.width}x${dims.height}`,
    );
  }
  if (tilesetId >= tilesetOrder.length) {
    throw new Error(`${mapId}: unknown tileset id ${tilesetId}`);
  }
  const blockPointer = rom.word(bank, address + 3);
  const connectionFlags = rom.byte(bank, address + CONNECTION_FLAGS_OFFSET);
  address += MAP_HEADER_SIZE;

  const connections: MapConnections = {};
  for (let i = 0; i < DIRECTIONS.length; i += 1) {
    const direction = DIRECTIONS[i];
    if ((connectionFlags & direction.bit) === 0) {
      continue;
    }
    const targetId = rom.byte(bank, address);
    const yOffset = signedByte(rom.byte(bank, address + CONNECTION_Y_ALIGN));
    const xOffset = signedByte(rom.byte(bank, address + CONNECTION_X_ALIGN));
    const encoded = direction.alongX ? xOffset : yOffset;
    if (encoded % 2 !== 0) {
      throw new Error(`${mapId}: odd ${direction.name} connection offset`);
    }
    const connection: MapConnection = {
      // Stored in tiles and negated; two tiles to a block along either axis.
      // The zero case is spelled out because `-0 / 2` is JavaScript's negative
      // zero, which serialises as `0` but fails Object.is and flips the sign
      // of anything that divides by it. Python's floor division yields a plain
      // 0 here, and so must this.
      map: mapIdAt(mapOrder, targetId),
      offset: encoded === 0 ? 0 : -encoded / 2,
    };
    if (direction.name === "north") {
      connections.north = connection;
    } else if (direction.name === "south") {
      connections.south = connection;
    } else if (direction.name === "west") {
      connections.west = connection;
    } else {
      connections.east = connection;
    }
    address += CONNECTION_SIZE;
  }
  if ((connectionFlags & ~KNOWN_CONNECTION_FLAGS & 0xff) !== 0) {
    throw new Error(
      `${mapId}: unknown connection flags $${hex2(connectionFlags)}`,
    );
  }

  const objectPointer = rom.word(bank, address);
  const events = readObjectEvents(
    ctx,
    mapId,
    spec,
    bank,
    objectPointer,
    mapOrder,
    spriteOrder,
  );

  // The ROM stores no block-map length. The manifest carries the assembled
  // payload length; anything the map is short by is border block, which is
  // how the engine renders the gap too.
  const expectedBlocks = width * height;
  const blockLength = spec.blockLength;
  if (blockLength > expectedBlocks) {
    throw new Error(`${mapId}: block payload is longer than map dimensions`);
  }
  const raw = rom.bytes(bank, blockPointer, blockLength);
  const blocks: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    blocks.push(raw[i]);
  }
  while (blocks.length < expectedBlocks) {
    blocks.push(events.borderBlock);
  }

  return {
    id: mapId,
    label: spec.label,
    index: dims.index,
    source: `ROM:${hex2(bank)}:${hex4(header.address)}`,
    tileset: tilesetOrder[tilesetId],
    width: width,
    height: height,
    blocks: blocks,
    borderBlock: events.borderBlock,
    connections: connections,
    warps: events.warps,
    signs: events.signs,
    objects: events.objects,
  };
}

export const builder: DatasetBuilder = {
  name: "maps",
  build(ctx: ExtractContext): MapTable {
    const constants = ctx.manifest.constants;
    const mapOrder = constants.mapOrder;
    const dimensions = constants.maps;
    const tilesetOrder = constants.tilesetOrder;
    const spriteOrder = constants.spriteOrder;
    const metadata = ctx.manifest.maps;

    const out: MapTable = {};
    const mapIds = Object.keys(metadata);
    for (let i = 0; i < mapIds.length; i += 1) {
      const mapId = mapIds[i];
      const dims = dimensions[mapId];
      if (dims === undefined) {
        throw new Error(`${mapId}: manifest has no dimensions entry`);
      }
      out[mapId] = buildMap(
        ctx,
        mapId,
        metadata[mapId],
        dims,
        mapOrder,
        tilesetOrder,
        spriteOrder,
      );
    }
    return out;
  },
};

export default builder;
