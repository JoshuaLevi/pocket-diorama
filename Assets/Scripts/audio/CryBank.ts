/**
 * Baked Pokemon cries and the small decoder used by the lens.
 *
 * The cartridge stores cries as sound-engine programs. `bakeCryBank` runs that
 * program decoder while a real Rom is available, drops the unsupported noise
 * channel, and packs the pulse/wave events into arrays. The bundle therefore
 * contains no ROM addresses or bytecode and the playback half below imports no
 * ROM implementation at runtime.
 */

import {
  decodeCry,
  readCryEntry,
  registerToHz,
  TICKS_PER_SECOND,
} from "./ChannelProgram";
import type {
  DecodedProgram,
  ProgramEvent,
  ProgramLocation,
} from "./ChannelProgram";
import type { Rom } from "../rom/core/Rom";

/** The manifest fields needed to decode cries at bake time. */
export interface CryAudioManifest {
  cryData: ProgramLocation;
  cryHeaders: any;
}

/** One packed event is positional to keep 151 decoded cries compact in JSON. */
export type PackedCryEvent = number[];
export type PackedCryChannel = PackedCryEvent[];
export type PackedCry = PackedCryChannel[];

/** JSON-safe value stored under `WorldBundle.cries`. */
export interface CryBankData {
  /** Packed format version. */
  v: number;
  /** Species ids, parallel to `data`. */
  ids: string[];
  /** Pulse/wave channel programs, parallel to `ids`. */
  data: PackedCry[];
}

const CRY_BANK_VERSION = 1;

/** A valid empty bank for callers that have not supplied a cartridge yet. */
export function emptyCryBank(): CryBankData {
  return { v: CRY_BANK_VERSION, ids: [], data: [] };
}

function packDutyCycle(dutyCycle: number[]): number {
  let packed = 0;
  for (let i = 0; i < 4; i++) {
    packed += ((dutyCycle[i] || 0) & 3) * Math.pow(2, i * 2);
  }
  return packed;
}

function unpackDutyCycle(packed: number): number[] {
  return [
    packed & 3,
    Math.floor(packed / 4) & 3,
    Math.floor(packed / 16) & 3,
    Math.floor(packed / 64) & 3,
  ];
}

function packEvent(event: ProgramEvent, expectedStart: number): PackedCryEvent {
  const gap = event.startTicks - expectedStart;
  if (event.kind === "noise") {
    throw new Error("cry bank: noise must be filtered before packing");
  }
  if (event.kind === "rest") {
    // Rest needs only its duration. A second value preserves a discontinuity if
    // a future decoder ever emits one, while costing nothing for today's ROMs.
    return gap === 0 ? [-event.ticks] : [-event.ticks, gap];
  }

  let flags = 0;
  if (event.dutyCycle !== null) flags |= 1;
  if (event.vibrato !== null) flags |= 2;
  if (event.slide !== null) flags |= 4;
  if (event.sweep !== null) flags |= 8;
  if (gap !== 0) flags |= 16;

  const out: number[] = [
    event.ticks,
    event.register,
    event.volume,
    event.fade,
    event.duty,
    flags,
  ];
  if (event.dutyCycle !== null) {
    out.push(packDutyCycle(event.dutyCycle));
  }
  if (event.vibrato !== null) {
    const v = event.vibrato;
    // Four one-byte fields fit exactly in a JavaScript integer.
    out.push((((v.delay * 256 + v.rate) * 256 + v.below) * 256 + v.above));
  }
  if (event.slide !== null) {
    out.push(event.slide.frames * 2048 + event.slide.target);
  }
  if (event.sweep !== null) {
    out.push(event.sweep.pace * 16 + (event.sweep.subtract ? 8 : 0) + event.sweep.shift);
  }
  if (gap !== 0) {
    out.push(gap);
  }
  return out;
}

/** Packs one already-decoded cry, excluding the hardware-noise channel. */
export function packCry(decoded: DecodedProgram): PackedCry {
  const out: PackedCry = [];
  for (let c = 0; c < decoded.channels.length; c++) {
    const channel = decoded.channels[c];
    // Pulse.ts deliberately rejects noise. Hardware 1-3 are the exact filter
    // used by the cartridge-backed audio test.
    if (channel.hardware === 4) continue;
    const packed: PackedCryChannel = [];
    let expectedStart = 0;
    for (let e = 0; e < channel.events.length; e++) {
      const event = channel.events[e];
      packed.push(packEvent(event, expectedStart));
      expectedStart = event.startTicks + event.ticks;
    }
    if (packed.length > 0) out.push(packed);
  }
  return out;
}

/**
 * Bake every real species' cry using the manifest's internal species order.
 *
 * `speciesOrder` is the cartridge's 1-based CryData order, not Pokedex order.
 * Its unused and battle-placeholder slots are skipped; the 151 Pokemon slots
 * become the bundle bank.
 */
export function bakeCryBank(
  rom: Rom,
  audio: CryAudioManifest,
  speciesOrder: string[],
): CryBankData {
  if (!rom || !audio || !audio.cryData || !audio.cryHeaders || !speciesOrder) {
    throw new Error("cry bank: missing ROM, manifest audio, or species order");
  }
  const out = emptyCryBank();
  const seen: any = {};
  for (let i = 0; i < speciesOrder.length; i++) {
    const species = speciesOrder[i];
    const placeholder = species === "UNUSED" || species === "MON_GHOST" ||
      species.indexOf("FOSSIL_") === 0;
    if (!species || placeholder || seen[species] === true) continue;
    const entry = readCryEntry(rom, audio.cryData, i + 1);
    const header = audio.cryHeaders[String(entry.cryId)];
    if (!header) {
      throw new Error("cry bank: " + species + " names missing cry header " + entry.cryId);
    }
    const packed = packCry(decodeCry(rom, audio.cryData, header, entry));
    if (packed.length === 0) {
      throw new Error("cry bank: " + species + " decoded to no supported channels");
    }
    seen[species] = true;
    out.ids.push(species);
    out.data.push(packed);
  }
  return out;
}

function unpackTone(packed: PackedCryEvent, startTicks: number): ProgramEvent {
  if (packed.length < 6) {
    throw new Error("cry bank: malformed tone event");
  }
  const ticks = packed[0];
  const register = packed[1];
  const flags = packed[5];
  let at = 6;
  let dutyCycle: number[] | null = null;
  let vibrato: any = null;
  let slide: any = null;
  let sweep: any = null;

  if ((flags & 1) !== 0) dutyCycle = unpackDutyCycle(packed[at++]);
  if ((flags & 2) !== 0) {
    const value = packed[at++];
    vibrato = {
      delay: Math.floor(value / 16777216) & 255,
      rate: Math.floor(value / 65536) & 255,
      below: Math.floor(value / 256) & 255,
      above: value & 255,
    };
  }
  if ((flags & 4) !== 0) {
    const value = packed[at++];
    slide = { frames: Math.floor(value / 2048), target: value % 2048 };
  }
  if ((flags & 8) !== 0) {
    const value = packed[at++];
    sweep = {
      pace: Math.floor(value / 16),
      subtract: (value & 8) !== 0,
      shift: value & 7,
    };
  }
  if ((flags & 16) !== 0) startTicks += packed[at++];

  return {
    kind: "tone",
    startTicks: startTicks,
    ticks: ticks,
    seconds: ticks / TICKS_PER_SECOND,
    register: register,
    frequencyHz: registerToHz(register),
    volume: packed[2],
    fade: packed[3],
    duty: packed[4],
    dutyCycle: dutyCycle,
    noiseParameter: 0,
    waveInstrument: 0,
    waveLevel: 0,
    vibrato: vibrato,
    slide: slide,
    sweep: sweep,
    at: 0,
  };
}

function unpackChannel(packed: PackedCryChannel): ProgramEvent[] {
  const out: ProgramEvent[] = [];
  let startTicks = 0;
  for (let i = 0; i < packed.length; i++) {
    const value = packed[i];
    if (!value || value.length === 0 || typeof value[0] !== "number") {
      throw new Error("cry bank: malformed event");
    }
    let event: ProgramEvent;
    if (value[0] < 0) {
      const ticks = -value[0];
      const eventStart = startTicks + (value.length > 1 ? value[1] : 0);
      event = {
        kind: "rest",
        startTicks: eventStart,
        ticks: ticks,
        seconds: ticks / TICKS_PER_SECOND,
        register: -1,
        frequencyHz: 0,
        volume: 0,
        fade: 0,
        duty: 0,
        dutyCycle: null,
        noiseParameter: 0,
        waveInstrument: 0,
        waveLevel: 0,
        vibrato: null,
        slide: null,
        sweep: null,
        at: 0,
      };
    } else {
      event = unpackTone(value, startTicks);
    }
    out.push(event);
    startTicks = event.startTicks + event.ticks;
  }
  return out;
}

/** Turns one species' packed bundle entry back into synth-ready channels. */
export function cryEvents(bank: CryBankData, speciesId: string): ProgramEvent[][] {
  if (!bank || bank.v !== CRY_BANK_VERSION || !bank.ids || !bank.data ||
      bank.ids.length !== bank.data.length) {
    throw new Error("cry bank: missing or unsupported bundle data");
  }
  let index = -1;
  for (let i = 0; i < bank.ids.length; i++) {
    if (bank.ids[i] === speciesId) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    throw new Error("cry bank: no cry for species " + speciesId);
  }
  const packed = bank.data[index];
  if (!packed || packed.length === 0) {
    throw new Error("cry bank: empty cry for species " + speciesId);
  }
  const out: ProgramEvent[][] = [];
  for (let i = 0; i < packed.length; i++) {
    const events = unpackChannel(packed[i]);
    if (events.length > 0) out.push(events);
  }
  if (out.length === 0) {
    throw new Error("cry bank: empty cry for species " + speciesId);
  }
  return out;
}
