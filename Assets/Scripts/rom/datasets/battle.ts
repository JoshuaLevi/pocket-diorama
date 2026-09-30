/**
 * The three battle-side datasets: encounters, items and trainers.
 *
 * Ports `extract_encounters`, `extract_items` and `extract_trainers` (plus the
 * `_wild_table`, `_trainer_parties`, `_nybbles` and `_species` helpers) from
 * gen1recomp/tools/build_rom_data.py. They share the same species-name lookup
 * and the same "walk a packed table with the manifest as the index" shape, so
 * they live together rather than in three files that would each be a third
 * helper and two thirds boilerplate.
 *
 * Discovery lives in the three sibling modules `encounters.ts`, `items.ts` and
 * `trainers.ts`, which re-export the builders below under the filenames
 * src/cli.ts probes for.
 *
 * NOT produced here: trainer_headers.json. Despite the name it comes out of
 * `extract_text` in the reference (build_rom_data.py:1728), and registry.ts
 * declares it as one of the three outputs of the `text` dataset.
 */

import type { Rom } from "../core/Rom";
import { bcd } from "../core/decode";
import { TEXT_TERMINATOR, readString, type Charmap } from "../core/text";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type {
  EncounterGroup,
  EncounterTable,
  EncounterTableSet,
  ItemDef,
  ItemTable,
  PartyMon,
  RomManifest,
  TrainerDef,
  TrainerTable,
} from "../types";

/** Longest a name in ItemNames or TrainerNames may run before we give up. */
const NAME_LIMIT = 32;

/** Wild tables are always exactly ten slots per section, present or absent. */
const WILD_SLOT_COUNT = 10;

/** Marks a party whose members each carry their own level. */
const PARTY_MIXED_LEVELS = 0xff;

function hex2Upper(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function hex4Upper(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

/** Zero-padded machine number, e.g. 1 -> "01". Matches Python's `{n:02d}`. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Species constant for a party or encounter byte.
 *
 * Internal species order is not Pokedex order, and the table has holes: an
 * index outside the manifest's list comes back as `SPECIES_XX` rather than
 * throwing, exactly as `_species` does, so one bad byte cannot take down a
 * whole extraction.
 */
function speciesName(manifest: RomManifest, value: number): string {
  const order = manifest.constants.speciesOrder;
  if (value < 1 || value > order.length) {
    return "SPECIES_" + hex2Upper(value);
  }
  return order[value - 1];
}

/**
 * Decode `count` consecutive terminated strings starting at one address.
 *
 * ItemNames and TrainerNames are both a solid run of 0x50-terminated strings
 * with no index, so the only way to reach entry N is to decode the N-1 before
 * it. Port of the identical loop in `extract_items` and `extract_trainers`.
 */
function readNameRun(
  rom: Rom,
  bank: number,
  start: number,
  charmap: Charmap,
  count: number,
): string[] {
  const names: string[] = [];
  let address = start;
  for (let i = 0; i < count; i += 1) {
    const read = readString(
      rom,
      bank,
      address,
      charmap,
      TEXT_TERMINATOR,
      NAME_LIMIT,
    );
    names.push(read.text);
    address += read.length;
  }
  return names;
}

/* ------------------------------------------------------------------------ */
/* items.json                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Split packed bytes into `count` nybbles, high nybble first.
 *
 * TechnicalMachinePrices stores two TM prices per byte. Port of `_nybbles`.
 */
function nybbles(raw: Uint8Array, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    out.push(raw[i] >> 4);
    out.push(raw[i] & 0x0f);
  }
  return out.slice(0, count);
}

/**
 * Every buyable item, every TM and every HM, keyed by item constant.
 *
 * Three ROM tables and two manifest lists feed this:
 *   ItemNames               names, in a single run of terminated strings
 *   ItemPrices              three BCD bytes each, positional
 *   KeyItemFlags            one bit per item; a key item cannot be sold
 *   TechnicalMachinePrices  one nybble per TM, in thousands
 *   manifest.tms/.hms       machine number -> move, which assembly erased
 *
 * TMs and HMs deliberately carry no `index`: they are numbered in their own
 * sequence, and the golden files omit the key rather than emitting null.
 */
export function buildItems(ctx: ExtractContext): ItemTable {
  const manifest = ctx.manifest;
  const rom = ctx.rom;
  const order = manifest.items;
  const charmap = manifest.charmap;

  const names = ctx.symbols.get("ItemNames");
  const prices = ctx.symbols.get("ItemPrices");
  const keyFlags = ctx.symbols.get("KeyItemFlags");
  const tmPrices = ctx.symbols.get("TechnicalMachinePrices");

  const decodedNames = readNameRun(
    rom,
    names.bank,
    names.address,
    charmap,
    order.length,
  );

  // One bit per item, low bit first, covering only the first numItems entries.
  const numItems = manifest.numItems;
  const flags = rom.bytes(
    keyFlags.bank,
    keyFlags.address,
    Math.floor((numItems + 7) / 8),
  );

  const out: ItemTable = {};

  for (let index = 0; index < order.length; index += 1) {
    const itemId = order[index];
    const isKeyItem =
      index < numItems &&
      (flags[Math.floor(index / 8)] & (1 << index % 8)) !== 0;
    out[itemId] = {
      id: itemId,
      index: index + 1,
      // `undefined` omits the key; `false` would emit one the golden lacks.
      keyItem: isKeyItem ? true : undefined,
      name: decodedNames[index],
      price: bcd(rom.bytes(prices.bank, prices.address + index * 3, 3)),
      source: "ROM:ItemNames[" + String(index + 1) + "]",
    };
  }

  const hms = manifest.hms;
  for (let i = 0; i < hms.length; i += 1) {
    const number = i + 1;
    const move = hms[i];
    const itemId = "HM_" + move;
    out[itemId] = {
      id: itemId,
      machine: { kind: "HM", move: move, number: number },
      name: "HM" + pad2(number),
      price: 0,
      source: "ROM metadata manifest (HM mapping)",
    };
  }

  const tms = manifest.tms;
  const packed = rom.bytes(
    tmPrices.bank,
    tmPrices.address,
    Math.floor((tms.length + 1) / 2),
  );
  const tmPriceNybbles = nybbles(packed, tms.length);
  for (let i = 0; i < tms.length; i += 1) {
    const number = i + 1;
    const move = tms[i];
    const itemId = "TM_" + move;
    out[itemId] = {
      id: itemId,
      machine: { kind: "TM", move: move, number: number },
      name: "TM" + pad2(number),
      price: tmPriceNybbles[i] * 1000,
      source: "ROM:TechnicalMachinePrices[" + String(number) + "]",
    };
  }

  return out;
}

/* ------------------------------------------------------------------------ */
/* trainers.json                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Decode every party between two addresses in the trainer party blob.
 *
 * A party is one of two shapes, chosen by its first byte:
 *   $FF  then (level, species) pairs, terminated by a zero level
 *   L    then species bytes all at level L, terminated by a zero species
 *
 * There is no party count anywhere: the roster for trainer N runs from its
 * pointer up to trainer N+1's, and the last one runs to TrainerAI. Overrunning
 * that boundary means a pointer was misread, so it throws rather than eating
 * into the next trainer. Port of `_trainer_parties`.
 */
function trainerParties(
  rom: Rom,
  bank: number,
  start: number,
  end: number,
  manifest: RomManifest,
): PartyMon[][] {
  const parties: PartyMon[][] = [];
  let address = start;

  while (address < end) {
    const first = rom.byte(bank, address);
    address += 1;
    const party: PartyMon[] = [];

    if (first === PARTY_MIXED_LEVELS) {
      for (;;) {
        const level = rom.byte(bank, address);
        address += 1;
        if (level === 0) {
          break;
        }
        const species = rom.byte(bank, address);
        address += 1;
        party.push({ level: level, species: speciesName(manifest, species) });
      }
    } else {
      for (;;) {
        const species = rom.byte(bank, address);
        address += 1;
        if (species === 0) {
          break;
        }
        party.push({ level: first, species: speciesName(manifest, species) });
      }
    }
    parties.push(party);
  }

  if (address !== end) {
    throw new Error(
      `trainer party data overran ${hex2Upper(bank)}:${hex4Upper(end)}`,
    );
  }
  return parties;
}

/**
 * Read the zero-terminated AI move-choice modifier list for each trainer class.
 *
 * TrainerClassMoveChoiceModifications is one packed run with no index, so the
 * lists have to be walked in order, same as the name tables.
 */
function readAiMods(
  rom: Rom,
  bank: number,
  start: number,
  count: number,
): number[][] {
  const out: number[][] = [];
  let address = start;
  for (let i = 0; i < count; i += 1) {
    const mods: number[] = [];
    for (;;) {
      const value = rom.byte(bank, address);
      address += 1;
      if (value === 0) {
        break;
      }
      mods.push(value);
    }
    out.push(mods);
  }
  return out;
}

/**
 * Every trainer class: name, portrait, prize money, AI flags and rosters.
 *
 * `pic` is null, not omitted, for the two classes the manifest has no portrait
 * for (OPP_CHIEF and OPP_UNUSED_JUGGLER) -- the golden file carries an explicit
 * null there.
 *
 * The portrait PNGs the reference writes alongside this table are assets, not
 * part of the JSON contract, so nothing is emitted through ctx.emitAsset here.
 */
export function buildTrainers(ctx: ExtractContext): TrainerTable {
  const manifest = ctx.manifest;
  const rom = ctx.rom;
  const order = manifest.trainers;
  const charmap = manifest.charmap;

  const names = ctx.symbols.get("TrainerNames");
  const pointers = ctx.symbols.get("TrainerDataPointers");
  const money = ctx.symbols.get("TrainerPicAndMoneyPointers");
  const choices = ctx.symbols.get("TrainerClassMoveChoiceModifications");
  const trainerAi = ctx.symbols.get("TrainerAI");

  const decodedNames = readNameRun(
    rom,
    names.bank,
    names.address,
    charmap,
    order.length,
  );
  const aiMods = readAiMods(
    rom,
    choices.bank,
    choices.address,
    order.length,
  );

  const partyStarts: number[] = [];
  for (let index = 0; index < order.length; index += 1) {
    partyStarts.push(rom.word(pointers.bank, pointers.address + index * 2));
  }

  const out: TrainerTable = {};
  for (let index = 0; index < order.length; index += 1) {
    const trainerId = "OPP_" + order[index];
    const pic = manifest.trainerPics[index];
    // Five bytes per entry: a two-byte pic pointer then three BCD money bytes,
    // which are stored a hundred times the real prize.
    const rawMoney = rom.bytes(money.bank, money.address + index * 5 + 2, 3);
    const partyEnd =
      index + 1 < partyStarts.length
        ? partyStarts[index + 1]
        : trainerAi.address;

    const trainer: TrainerDef = {
      aiMods: aiMods[index],
      baseMoney: Math.floor(bcd(rawMoney) / 100),
      id: trainerId,
      index: index + 1,
      name: decodedNames[index],
      parties: trainerParties(
        rom,
        pointers.bank,
        partyStarts[index],
        partyEnd,
        manifest,
      ),
      pic: pic ? pic.path : null,
      source: "ROM:TrainerDataPointers",
    };
    out[trainerId] = trainer;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* encounters.json                                                           */
/* ------------------------------------------------------------------------ */

interface WildTable {
  grass: EncounterGroup;
  water: EncounterGroup;
}

/**
 * Decode one wild-encounter table: a grass section then a water section.
 *
 * Each section is a rate byte followed by exactly ten (level, species) pairs.
 * A rate of zero means the ten pairs are simply not there, so the water rate
 * byte sits immediately after the grass rate byte -- reading a fixed-size
 * record would put water 20 bytes too late. Port of `_wild_table`.
 */
function wildTable(
  rom: Rom,
  bank: number,
  start: number,
  manifest: RomManifest,
): WildTable {
  let address = start;

  const grassRate = rom.byte(bank, address);
  address += 1;
  const grass: EncounterGroup = { rate: grassRate, slots: [] };
  if (grassRate !== 0) {
    for (let i = 0; i < WILD_SLOT_COUNT; i += 1) {
      const pair = rom.bytes(bank, address, 2);
      grass.slots.push({
        level: pair[0],
        species: speciesName(manifest, pair[1]),
      });
      address += 2;
    }
  }

  const waterRate = rom.byte(bank, address);
  address += 1;
  const water: EncounterGroup = { rate: waterRate, slots: [] };
  if (waterRate !== 0) {
    for (let i = 0; i < WILD_SLOT_COUNT; i += 1) {
      const pair = rom.bytes(bank, address, 2);
      water.slots.push({
        level: pair[0],
        species: speciesName(manifest, pair[1]),
      });
      address += 2;
    }
  }

  return { grass: grass, water: water };
}

/**
 * Wild encounter tables, keyed by map id.
 *
 * WildDataPointers is indexed by map id and covers all 248 maps, but most of
 * them point at the shared NothingWildMons stub; those maps are left out of
 * the table entirely rather than emitted with two empty sections. A map that
 * has its own table but zero on both rates (Pokemon Tower's lower floors, for
 * instance) still gets an entry, carrying only `source`. Port of
 * `extract_encounters`.
 */
export function buildEncounters(ctx: ExtractContext): EncounterTableSet {
  const manifest = ctx.manifest;
  const rom = ctx.rom;
  const maps = manifest.constants.mapOrder;

  const pointers = ctx.symbols.get("WildDataPointers");
  const nothing = ctx.symbols.get("NothingWildMons");

  const out: EncounterTableSet = {};
  for (let index = 0; index < maps.length; index += 1) {
    const address = rom.word(pointers.bank, pointers.address + index * 2);
    if (address === nothing.address) {
      continue;
    }
    const table = wildTable(rom, pointers.bank, address, manifest);
    const entry: EncounterTable = {
      source:
        "ROM:" + hex2Upper(pointers.bank) + ":" + hex4Upper(address),
    };
    if (table.grass.rate !== 0 || table.grass.slots.length > 0) {
      entry.grass = table.grass;
    }
    if (table.water.rate !== 0 || table.water.slots.length > 0) {
      entry.water = table.water;
    }
    out[maps[index]] = entry;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Builders                                                                  */
/* ------------------------------------------------------------------------ */

export const itemsBuilder: DatasetBuilder = {
  name: "items",
  build(ctx: ExtractContext): ItemTable {
    return buildItems(ctx);
  },
};

export const trainersBuilder: DatasetBuilder = {
  name: "trainers",
  build(ctx: ExtractContext): TrainerTable {
    return buildTrainers(ctx);
  },
};

export const encountersBuilder: DatasetBuilder = {
  name: "encounters",
  build(ctx: ExtractContext): EncounterTableSet {
    return buildEncounters(ctx);
  },
};
