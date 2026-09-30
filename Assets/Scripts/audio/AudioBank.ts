/**
 * The cartridge's sound banks, carried into the lens.
 *
 * Cries are decoded at bake time and shipped as events (CryBank), which works
 * because a cry ENDS. Music does not: a song's channels run until something
 * stops them, and the loop command that makes that so is the same command the
 * decoder refuses to follow when it is asked for a finite event list. So music
 * cannot be baked as events, and the bytes have to come along instead.
 *
 * That is what this is: the three 16 KiB banks the sound engine's programs live
 * in (two, eight and thirty-one in Red), base64'd, plus the tables that say
 * where in them each song, sound effect, drum and waveform begins. The reader
 * at the bottom presents them as the two byte accessors ChannelProgram wants,
 * so the SAME decoder that reads cries off a Rom reads music off a bundle,
 * unchanged and streaming.
 *
 * 48 KiB of ROM is 64 KiB of base64 -- about four percent of the bundle, for
 * every piece of music and every sound effect in the game.
 *
 * Lens Studio TypeScript restrictions apply: no Record/Map/Set, no export enum.
 */

import { decodeBase64, encodeBase64 } from "../world/WorldData";
import type { ProgramBytes, ProgramLocation } from "./ChannelProgram";

export const AUDIO_BANK_VERSION: number = 1;

/** Bytes in one banked window: 0x4000..0x7FFF. */
const BANK_SIZE: number = 0x4000;
const BANK_BASE: number = 0x4000;

/** Sixteen bytes, thirty-two four-bit samples: one wave instrument. */
export const WAVE_BYTES: number = 16;
export const WAVE_SAMPLES: number = 32;

/** A table keyed by name, since the lens has no Map. */
export interface LocationTable {
  [key: string]: ProgramLocation;
}

export interface StringTable {
  [key: string]: string;
}

export interface NumberTable {
  [key: string]: number;
}

/** Per engine, its own copy of a table: noise["1"]["5"]. */
export interface EngineLocationTables {
  [engine: string]: LocationTable;
}

/** JSON-safe value stored under `WorldBundle.audio`. */
export interface AudioBankData {
  v: number;
  /** Bank numbers carried, and each bank's bytes as base64, in parallel. */
  banks: number[];
  data: string[];
  /** Which sound engine a bank holds: engines["31"] === 3. */
  engines: NumberTable;
  /** Music label -> its sound header. */
  music: LocationTable;
  /** Sound-effect key -> its sound header. */
  sfx: LocationTable;
  /** Drum programs, per engine, by instrument index. */
  noise: EngineLocationTables;
  /** The wave instrument table's start, per engine. */
  wave: LocationTable;
  /** Map id -> music label. */
  mapSongs: StringTable;
  /** The battle themes and their fanfares, by role. */
  battle: StringTable;
}

export function emptyAudioBank(): AudioBankData {
  return {
    v: AUDIO_BANK_VERSION,
    banks: [],
    data: [],
    engines: {},
    music: {},
    sfx: {},
    noise: {},
    wave: {},
    mapSongs: {},
    battle: {},
  };
}

/* ------------------------------------------------------------------------ */
/* Baking                                                                    */
/* ------------------------------------------------------------------------ */

function location(raw: any): ProgramLocation {
  return { bank: raw.bank, address: raw.address };
}

/** Every bank any of the manifest's audio tables points into. */
function banksUsed(audio: any): number[] {
  const seen: NumberTable = {};
  const out: number[] = [];
  const note = (raw: any) => {
    if (!raw || typeof raw.bank !== "number") return;
    const key = String(raw.bank);
    if (seen[key] === 1) return;
    seen[key] = 1;
    out.push(raw.bank);
  };
  const walk = (table: any) => {
    if (!table) return;
    const keys = Object.keys(table);
    for (let i = 0; i < keys.length; i++) note(table[keys[i]]);
  };
  walk(audio.musicHeaders);
  walk(audio.sfxHeaders);
  walk(audio.cryHeaders);
  walk(audio.waveBanks);
  note(audio.cryData);
  const engines = audio.noiseHeaders ? Object.keys(audio.noiseHeaders) : [];
  for (let i = 0; i < engines.length; i++) walk(audio.noiseHeaders[engines[i]]);
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Reads the audio banks out of a cartridge, with the tables that address them.
 *
 * Whole banks rather than the reachable streams: reachability means following
 * every call and every loop of forty-five songs and a hundred sound effects,
 * and being wrong about one of them is a song that stops in the middle. A bank
 * is 16 KiB and cannot be wrong.
 */
export function bakeAudioBank(rom: any, audio: any): AudioBankData {
  if (!rom || !audio) {
    throw new Error("audio bank: missing ROM or manifest audio");
  }
  const out = emptyAudioBank();
  const banks = banksUsed(audio);
  if (banks.length === 0) {
    throw new Error("audio bank: the manifest names no audio banks");
  }
  for (let i = 0; i < banks.length; i++) {
    const bank = banks[i];
    const bytes = new Uint8Array(BANK_SIZE);
    for (let at = 0; at < BANK_SIZE; at++) {
      bytes[at] = rom.byte(bank, BANK_BASE + at);
    }
    out.banks.push(bank);
    out.data.push(encodeBase64(bytes));
  }

  const copy = (table: any, into: LocationTable) => {
    if (!table) return;
    const keys = Object.keys(table);
    for (let i = 0; i < keys.length; i++) {
      const raw = table[keys[i]];
      if (!raw || typeof raw.bank !== "number") continue;
      into[keys[i]] = location(raw);
      if (typeof raw.engine === "number") {
        out.engines[String(raw.bank)] = raw.engine;
      }
    }
  };
  copy(audio.musicHeaders, out.music);
  copy(audio.sfxHeaders, out.sfx);
  copy(audio.waveBanks, out.wave);

  const engines = audio.noiseHeaders ? Object.keys(audio.noiseHeaders) : [];
  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i];
    const table: LocationTable = {};
    copy(audio.noiseHeaders[engine], table);
    out.noise[engine] = table;
  }
  // waveBanks is keyed by engine, not by name, and carries no engine field.
  const waveKeys = Object.keys(out.wave);
  for (let i = 0; i < waveKeys.length; i++) {
    out.engines[String(out.wave[waveKeys[i]].bank)] = Number(waveKeys[i]);
  }

  if (audio.mapSongs) {
    const maps = Object.keys(audio.mapSongs);
    for (let i = 0; i < maps.length; i++) {
      out.mapSongs[maps[i]] = audio.mapSongs[maps[i]];
    }
  }
  if (audio.battle) {
    const roles = Object.keys(audio.battle);
    for (let i = 0; i < roles.length; i++) {
      out.battle[roles[i]] = audio.battle[roles[i]];
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * The banks, as the two accessors the program decoder asks for.
 *
 * Structurally a Rom as far as ChannelProgram is concerned, which is the point:
 * one decoder, two sources.
 */
export class AudioBanks implements ProgramBytes {
  private readonly data: AudioBankData;
  /** bank number -> its bytes. Decoded once, on construction. */
  private readonly bytes: any;

  constructor(data: AudioBankData) {
    this.data = data && data.banks ? data : emptyAudioBank();
    this.bytes = Object.create(null);
    for (let i = 0; i < this.data.banks.length; i++) {
      const encoded = this.data.data[i];
      if (typeof encoded !== "string") continue;
      this.bytes[String(this.data.banks[i])] = decodeBase64(encoded);
    }
  }

  /** True when there is anything to play at all. */
  get playable(): boolean {
    return this.data.banks.length > 0 && Object.keys(this.data.music).length > 0;
  }

  byte(bank: number, address: number): number {
    const held = this.bytes[String(bank)];
    if (!held) {
      throw new Error("audio bank " + bank + " was not carried in this bundle");
    }
    const at = address - BANK_BASE;
    if (at < 0 || at >= held.length) {
      throw new Error("audio address " + address + " is outside bank " + bank);
    }
    return held[at];
  }

  word(bank: number, address: number): number {
    return this.byte(bank, address) + this.byte(bank, address + 1) * 256;
  }

  /** Which sound engine a bank's programs are written for: 1, 2 or 3. */
  engineOf(bank: number): number {
    const engine = this.data.engines[String(bank)];
    return typeof engine === "number" ? engine : 1;
  }

  /** A song's header, or null when the bundle does not carry that label. */
  music(label: string): ProgramLocation {
    const found = this.data.music[label];
    return found ? found : null;
  }

  /** A sound effect's header, or null. */
  sfx(key: string): ProgramLocation {
    const found = this.data.sfx[key];
    return found ? found : null;
  }

  /** Every music label carried, sorted, for tests and for a debug cycle. */
  musicLabels(): string[] {
    const keys = Object.keys(this.data.music);
    keys.sort();
    return keys;
  }

  /** The song a map plays, or "" when the map names none. */
  songForMap(mapId: string): string {
    const found = this.data.mapSongs[mapId];
    return found ? found : "";
  }

  /** A battle role's music label ("wild", "trainer", "gym", "final", ...). */
  battleSong(role: string): string {
    const found = this.data.battle[role];
    return found ? found : "";
  }

  /**
   * A drum's program header.
   *
   * The engine is the one the CALLING program belongs to: the same instrument
   * index is a different drum in each of the three, and a song in bank 31 that
   * borrowed bank 2's kit would play the wrong percussion throughout.
   */
  noiseInstrument(engine: number, index: number): ProgramLocation {
    const table = this.data.noise[String(engine)];
    if (!table) {
      return null;
    }
    const found = table[String(index)];
    return found ? found : null;
  }

  /**
   * One wave instrument, as its 32 four-bit samples.
   *
   * Empty when the engine carries no table, which the wave channel reads as
   * silence rather than as a reason to stop.
   */
  waveSamples(engine: number, instrument: number): Uint8Array {
    const table = this.data.wave[String(engine)];
    if (!table || instrument < 0) {
      return new Uint8Array(0);
    }
    const start = table.address + instrument * WAVE_BYTES;
    const out = new Uint8Array(WAVE_SAMPLES);
    for (let i = 0; i < WAVE_BYTES; i++) {
      const packed = this.byte(table.bank, start + i);
      out[i * 2] = (packed >> 4) & 0x0f;
      out[i * 2 + 1] = packed & 0x0f;
    }
    return out;
  }
}
