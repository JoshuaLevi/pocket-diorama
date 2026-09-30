/**
 * Generation 1 channel-program decoder.
 *
 * Gen 1 stores no audio samples. Music, sound effects and cries are all
 * bytecode for the ROM's own sound engine: a header naming two to four
 * channels, and one command stream per channel. This module turns those bytes
 * into a readable event list. It synthesises nothing -- see Pulse.ts for that.
 *
 * The reference implementation is gen1recomp's src/core/ChipSynth.lua (MIT),
 * which this is a port of. Where the two disagree, ChipSynth wins; where
 * ChipSynth's own behaviour looked surprising, it was checked against the
 * sound engine's machine code inside the cartridge itself. Two such checks are
 * recorded below, because both change what a cry sounds like:
 *
 *   The cry pitch byte is added to the WHOLE 11-bit frequency, carry included.
 *   Audio1_ApplyFrequencyModifier at 02:56B5 in Pokemon Red reads
 *
 *       ld a,[$C0F1] / add a,e / jr nc,+1 / inc d / ld [hl],e / ld [hl],d
 *
 *   -- the carry out of the low byte increments the high byte, and only bits
 *   0-2 of that byte reach NR14, so the sum is masked to 0x7FF and anything
 *   above bit 10 is thrown away. Adding the byte to the low byte alone would
 *   give Pidgey a tidy descending chirp instead of the squawk the hardware
 *   makes. The ugly one is the correct one.
 *
 *   A cry's tempo is 0x80 plus its length byte. Audio_SetSfxTempo at 02:5693
 *   does `ld d,0 / ld a,[$C0F2] / add a,$80 / jr nc,+1 / inc d` and stores the
 *   pair, so the tempo is a 9-bit value; the else-branch stores 0x0100, which
 *   is why a program that never sets a tempo still times correctly.
 *
 * Lens Studio TypeScript restrictions apply: no Record/Map/Set, no export
 * enum, plain objects with index signatures.
 */

/**
 * All this decoder ever asks of a cartridge.
 *
 * `Rom` satisfies it, and so does AudioBanks -- the three sound banks carried
 * in the bundle. That is what lets one decoder read cries off a ROM at bake
 * time and music off a bundle at play time, with no second implementation to
 * keep in step.
 */
export interface ProgramBytes {
  byte(bank: number, address: number): number;
  word(bank: number, address: number): number;
}

/* ------------------------------------------------------------------------ */
/* Timebase                                                                  */
/* ------------------------------------------------------------------------ */

/** The engine's tick rate: 256 ticks a frame at 60 frames a second. */
export const TICKS_PER_SECOND = 15360;

/** Ticks in one 60 Hz frame, and the tempo a channel starts with. */
export const FRAME_TICKS = 256;

/** LoadChannel's default tempo, one frame per length unit. */
export const DEFAULT_TEMPO = 0x100;

/**
 * Ticks to samples, matching the reference's rounding exactly.
 *
 * Always call this on a CUMULATIVE tick count and subtract consecutive
 * results, never on one event's duration: rounding each duration in isolation
 * lets the error accumulate, and a cry is short enough for that to be audible
 * as a tempo drift between its channels.
 */
export function snapTicks(ticks: number, sampleRate: number): number {
  return Math.floor(
    (ticks * sampleRate + TICKS_PER_SECOND / 2) / TICKS_PER_SECOND,
  );
}

/** Hardware frequency of an 11-bit pulse/wave period register. */
export function registerToHz(register: number): number {
  return 131072 / (2048 - Math.min(register, 2047));
}

/* ------------------------------------------------------------------------ */
/* Tables the engine reads                                                   */
/* ------------------------------------------------------------------------ */

/** Gen 1 note table, C through B, as raw 16-bit values. */
const PITCHES: number[] = [
  0xf82c, 0xf89d, 0xf907, 0xf96b, 0xf9ca, 0xfa23,
  0xfa77, 0xfac7, 0xfb12, 0xfb58, 0xfb9b, 0xfbda,
];

/** Wave channel output levels for the two bits in a volume command. */
const WAVE_LEVEL: number[] = [0, 1, 0.5, 0.25];

/* ------------------------------------------------------------------------ */
/* Shapes                                                                    */
/* ------------------------------------------------------------------------ */

/** A banked ROM location, as the manifest stores one. */
export interface ProgramLocation {
  bank: number;
  address: number;
}

/** A sound header entry: which channel runs which command stream. */
export interface ChannelSpec {
  /** Software channel, 1-8. Above 4 means an sfx/cry channel. */
  number: number;
  /** Hardware channel: 1 and 2 pulse, 3 wave, 4 noise. */
  hardware: number;
  address: number;
}

/** Command 0xEA: a periodic frequency wobble, in frames. */
export interface Vibrato {
  delay: number;
  above: number;
  below: number;
  rate: number;
}

/** Command 0xEB: glide to a target register over the note. */
export interface Slide {
  target: number;
  frames: number;
}

/** Command 0x10: the pulse-1 hardware frequency sweep. */
export interface Sweep {
  pace: number;
  subtract: boolean;
  shift: number;
}

/**
 * One thing a channel does for a span of time.
 *
 * `startTicks` and `ticks` are the timebase; sample counts are deliberately
 * absent so a decoded program is independent of the rate it is rendered at.
 */
export interface ProgramEvent {
  kind: "tone" | "noise" | "rest";
  /** Ticks elapsed on this channel before the event begins. */
  startTicks: number;
  ticks: number;
  seconds: number;
  /** 11-bit period register; -1 when the event makes no pitch. */
  register: number;
  /** registerToHz(register), or 0. Convenience for readers and tests. */
  frequencyHz: number;
  /** Envelope start volume, 0-15. */
  volume: number;
  /** Envelope step, signed: positive decays, negative grows. */
  fade: number;
  /** Duty index 0-3 when dutyCycle is null. */
  duty: number;
  /** Command 0xFC's four-frame duty rotation, or null. */
  dutyCycle: number[] | null;
  /** Noise polynomial byte, noise events only. */
  noiseParameter: number;
  waveInstrument: number;
  waveLevel: number;
  vibrato: Vibrato | null;
  slide: Slide | null;
  sweep: Sweep | null;
  /** ROM address of the command that produced this, for debugging. */
  at: number;
}

/** State the whole program shares, not one channel. */
export interface ProgramState {
  tempo: number;
  pan: number;
}

/** How a program is to be interpreted. */
export interface ReaderOptions {
  bank: number;
  /** Cry pitch byte, added to every frequency this channel produces. */
  frequencyOffset: number;
  /** Tempo seed for sfx channels: 0x80 + a cry's length byte. */
  frameTicks: number;
  /** False stops at the first infinite loop instead of running forever. */
  allowLoops: boolean;
  /** Frames at the head of an sfx that ignore the frequency offset. */
  plainFrames: number;
}

/** A decoded channel and how its decode finished. */
export interface DecodedChannel {
  number: number;
  hardware: number;
  address: number;
  events: ProgramEvent[];
  /** True when the program ended on its own rather than hitting the cap. */
  complete: boolean;
  totalTicks: number;
}

/** A decoded program: every channel its header names. */
export interface DecodedProgram {
  channels: DecodedChannel[];
  state: ProgramState;
  /** Longest channel, in seconds. */
  seconds: number;
}

/** One row of the ROM's CryData table. */
export interface CryEntry {
  /** Index into cryHeaders: which of the 38 base cries this species uses. */
  cryId: number;
  /** Frequency offset applied to every note. */
  pitch: number;
  /** Tempo modifier: the channel tempo becomes 0x80 + this. */
  length: number;
}

/* ------------------------------------------------------------------------ */
/* Header                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Read a sound header: one three-byte descriptor per channel.
 *
 * The channel count lives in the top nibble of the FIRST descriptor, shifted
 * by six rather than four -- the low two bits of that nibble are the count,
 * the high two are flags the engine uses elsewhere.
 */
export function readSoundHeader(rom: ProgramBytes, header: ProgramLocation): ChannelSpec[] {
  const specs: ChannelSpec[] = [];
  let address = header.address;
  const first = rom.byte(header.bank, address);
  const count = ((first & 0xf0) >> 6) + 1;
  for (let i = 0; i < count; i++) {
    const descriptor = rom.byte(header.bank, address);
    const number = (descriptor & 0x0f) + 1;
    specs.push({
      number: number,
      hardware: ((number - 1) % 4) + 1,
      address: rom.word(header.bank, address + 1),
    });
    address += 3;
  }
  return specs;
}

/* ------------------------------------------------------------------------ */
/* The interpreter                                                           */
/* ------------------------------------------------------------------------ */

function fadeValue(nibble: number): number {
  if ((nibble & 8) !== 0) return -(nibble & 7);
  return nibble;
}

/**
 * Walks one channel's command stream, handing back one event at a time.
 *
 * Incremental on purpose. A cry is short enough to decode in full, but music
 * loops forever, so the full synth will drive this from the mixer's buffer
 * fill rather than materialising an event list. decodeChannel() below is the
 * eager convenience for the short programs and for tests.
 */
export class ChannelReader {
  private readonly rom: ProgramBytes;
  private readonly state: ProgramState;
  private readonly bank: number;
  private readonly frequencyOffset: number;
  private readonly frameTicks: number;
  private readonly plainTicks: number;
  private readonly allowLoops: boolean;

  readonly number: number;
  readonly hardware: number;
  readonly isSfx: boolean;

  private address: number;
  private ended: boolean;
  private timeTicks: number;

  private executeMusic: boolean;
  private speed: number;
  private volume: number;
  private fade: number;
  private duty: number;
  private dutyCycle: number[] | null;
  private octave: number;
  private perfectPitch: boolean;
  private waveInstrument: number;
  private waveLevel: number;
  private vibrato: Vibrato | null;
  private pendingSlide: Slide | null;
  private sweep: Sweep | null;
  private readonly callStack: number[];
  private readonly loopCounts: { [address: number]: number };

  constructor(
    rom: ProgramBytes,
    spec: ChannelSpec,
    state: ProgramState,
    options: ReaderOptions,
  ) {
    this.rom = rom;
    this.state = state;
    this.bank = options.bank;
    this.frequencyOffset = options.frequencyOffset;
    this.frameTicks = options.frameTicks;
    this.plainTicks = options.plainFrames * FRAME_TICKS;
    this.allowLoops = options.allowLoops;

    this.number = spec.number;
    this.hardware = ((spec.number - 1) % 4) + 1;
    this.isSfx = spec.number > 4;

    this.address = spec.address;
    this.ended = false;
    this.timeTicks = 0;

    this.executeMusic = !this.isSfx;
    this.speed = 12;
    this.volume = 12;
    this.fade = 0;
    this.duty = 2;
    this.dutyCycle = null;
    this.octave = 4;
    this.perfectPitch = false;
    this.waveInstrument = 0;
    this.waveLevel = 1;
    this.vibrato = null;
    this.pendingSlide = null;
    this.sweep = null;
    this.callStack = [];
    this.loopCounts = {};
  }

  /** True once the stream has run off its end or hit a loop it may not take. */
  get finished(): boolean {
    return this.ended;
  }

  /** Ticks this channel has produced so far. */
  get elapsedTicks(): number {
    return this.timeTicks;
  }

  private readByte(): number {
    const value = this.rom.byte(this.bank, this.address);
    this.address += 1;
    return value;
  }

  private readWord(): number {
    const value = this.rom.word(this.bank, this.address);
    this.address += 2;
    return value;
  }

  /** A music note's period, from the note table and the current octave. */
  private frequency(note: number, octave: number): number {
    const raw = PITCHES[note];
    if (raw === undefined) {
      // Only reachable from a malformed slide command; the reference errors
      // here too. Throwing beats returning NaN, which would poison the synth
      // silently for the rest of the note.
      throw new Error("note " + note + " is outside the Gen 1 pitch table");
    }
    const signed = raw - 0x10000;
    let register = (signed >> Math.max(0, octave - 1)) & 0x7ff;
    if (this.perfectPitch) register = (register + 1) & 0x7ff;
    return (register + this.frequencyOffset) & 0x7ff;
  }

  /**
   * How long a length unit lasts.
   *
   * An sfx channel runs off its own tempo seed, a music channel off the shared
   * one; and an sfx channel's speed is pinned to 1 unless a toggle_sfx command
   * has handed it back to the music interpreter.
   */
  private durationTicks(length: number, plain: boolean): number {
    const tempo = this.isSfx
      ? (plain ? FRAME_TICKS : this.frameTicks)
      : this.state.tempo;
    const speed = this.isSfx
      ? (this.executeMusic ? this.speed : 1)
      : this.speed;
    return length * speed * tempo;
  }

  private timed(event: ProgramEvent, ticks: number): ProgramEvent {
    event.startTicks = this.timeTicks;
    event.ticks = ticks;
    event.seconds = ticks / TICKS_PER_SECOND;
    this.timeTicks += ticks;
    return event;
  }

  private blank(kind: "tone" | "noise" | "rest", at: number): ProgramEvent {
    return {
      kind: kind,
      startTicks: 0,
      ticks: 0,
      seconds: 0,
      register: -1,
      frequencyHz: 0,
      volume: 0,
      fade: 0,
      duty: this.duty,
      dutyCycle: this.dutyCycle,
      noiseParameter: 0,
      waveInstrument: this.waveInstrument,
      waveLevel: this.waveLevel,
      vibrato: null,
      slide: null,
      sweep: null,
      at: at,
    };
  }

  private tone(
    at: number,
    ticks: number,
    register: number,
    volume: number,
    fade: number,
  ): ProgramEvent {
    if (register >= 0x800) return this.timed(this.blank("rest", at), ticks);
    const event = this.blank("tone", at);
    event.register = register;
    event.frequencyHz = registerToHz(register);
    event.volume = volume;
    event.fade = fade;
    if (this.pendingSlide !== null) {
      // The slide command carries a length in frames measured from the END of
      // the note, so the ramp is however much of the note is left over.
      event.slide = {
        target: this.pendingSlide.target,
        frames: Math.max(
          1,
          (ticks / TICKS_PER_SECOND) * 60 - this.pendingSlide.frames,
        ),
      };
      this.pendingSlide = null;
    } else {
      event.vibrato = this.vibrato;
    }
    if (this.isSfx && this.hardware === 1) event.sweep = this.sweep;
    return this.timed(event, ticks);
  }

  /**
   * The next event, or null at the end of the stream.
   *
   * The loop below runs the command stream until it reaches a command that
   * produces sound; everything else is state and falls through to the next
   * iteration. The iteration cap matches the reference and exists so a
   * malformed program cannot hang the render thread.
   */
  next(): ProgramEvent | null {
    if (this.ended) return null;
    for (let guard = 0; guard < 100000; guard++) {
      const at = this.address;
      const command = this.readByte();

      if ((this.executeMusic || !this.isSfx) && command < 0xc0) {
        const note = command >> 4;
        const length = (command & 0x0f) + 1;
        if (this.hardware === 4) {
          let instrument = note;
          if (command >= 0xb0) instrument = this.readByte();
          const event = this.blank("noise", at);
          event.noiseParameter = instrument;
          event.volume = this.volume;
          event.fade = this.fade;
          return this.timed(event, this.durationTicks(length, false));
        }
        return this.tone(
          at,
          this.durationTicks(length, false),
          this.frequency(note, this.octave),
          this.volume,
          this.fade,
        );
      }

      if (command >= 0xc0 && command < 0xd0) {
        const length = (command & 0x0f) + 1;
        return this.timed(
          this.blank("rest", at),
          this.durationTicks(length, false),
        );
      }

      if (command >= 0xd0 && command < 0xe0) {
        this.speed = command & 0x0f;
        if (this.hardware !== 4) {
          const packed = this.readByte();
          if (this.hardware === 3) {
            this.waveLevel = WAVE_LEVEL[(packed >> 4) & 3];
            this.waveInstrument = packed & 0x0f;
          } else {
            this.volume = packed >> 4;
            this.fade = fadeValue(packed & 0x0f);
          }
        }
        continue;
      }

      if (command >= 0xe0 && command <= 0xe7) {
        this.octave = 8 - (command & 7);
        continue;
      }

      switch (command) {
        case 0xe8:
          this.perfectPitch = !this.perfectPitch;
          continue;
        case 0xe9:
          continue; // unused command
        case 0xea: {
          const delay = this.readByte();
          const packed = this.readByte();
          const depth = packed >> 4;
          if (depth === 0) {
            this.vibrato = null;
          } else {
            this.vibrato = {
              delay: delay,
              above: (depth >> 1) + (depth & 1),
              below: depth >> 1,
              rate: packed & 0x0f,
            };
          }
          continue;
        }
        case 0xeb: {
          const length = this.readByte();
          const packed = this.readByte();
          const octave = 8 - (packed >> 4);
          this.pendingSlide = {
            frames: length,
            target: this.frequency(packed & 0x0f, octave),
          };
          continue;
        }
        case 0xec:
          this.duty = this.readByte() & 3;
          this.dutyCycle = null;
          continue;
        case 0xed: {
          const high = this.readByte();
          const low = this.readByte();
          this.state.tempo = high * 0x100 + low;
          continue;
        }
        case 0xee:
          this.state.pan = this.readByte();
          continue;
        case 0xef:
        case 0xf0:
          this.readByte();
          continue;
        case 0xf8:
          this.executeMusic = !this.executeMusic;
          continue;
        case 0xfc: {
          const packed = this.readByte();
          this.dutyCycle = [
            (packed >> 6) & 3,
            (packed >> 4) & 3,
            (packed >> 2) & 3,
            packed & 3,
          ];
          continue;
        }
        case 0xfd:
          this.callStack.push(this.address + 2);
          this.address = this.readWord();
          continue;
        case 0xfe: {
          const count = this.readByte();
          const target = this.readWord();
          if (count === 0) {
            if (this.allowLoops) {
              this.address = target;
              continue;
            }
            this.ended = true;
            return null;
          }
          let remaining = this.loopCounts[at];
          if (remaining === undefined) remaining = count;
          remaining -= 1;
          if (remaining > 0) {
            this.loopCounts[at] = remaining;
            this.address = target;
          } else {
            delete this.loopCounts[at];
          }
          continue;
        }
        case 0xff: {
          const returnAddress = this.callStack.pop();
          if (returnAddress === undefined) {
            this.ended = true;
            return null;
          }
          this.address = returnAddress;
          continue;
        }
        case 0x10: {
          const packed = this.readByte();
          this.sweep = {
            pace: (packed >> 4) & 7,
            subtract: (packed & 8) !== 0,
            shift: packed & 7,
          };
          continue;
        }
        default:
          break;
      }

      // The sfx note: an explicit volume/fade byte and an explicit frequency,
      // rather than the music channels' note-table lookup.
      if (this.isSfx && command >= 0x20 && command < 0x30) {
        const length = (command & 0x0f) + 1;
        const packed = this.readByte();
        const volume = packed >> 4;
        const fade = fadeValue(packed & 0x0f);
        const plain = this.timeTicks < this.plainTicks;
        const offset = plain ? 0 : this.frequencyOffset;
        if (this.hardware === 4) {
          // On the noise channel the frequency byte IS the polynomial counter,
          // so the cry pitch moves the noise colour. It wraps at eight bits;
          // the carry lands in a high byte noise does not use.
          const event = this.blank("noise", at);
          event.noiseParameter = (this.readByte() + offset) & 0xff;
          event.volume = volume;
          event.fade = fade;
          return this.timed(event, this.durationTicks(length, plain));
        }
        const register = (this.readWord() + offset) & 0x7ff;
        return this.tone(
          at,
          this.durationTicks(length, plain),
          register,
          volume,
          fade,
        );
      }

      this.ended = true;
      return null;
    }
    this.ended = true;
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Eager decode                                                              */
/* ------------------------------------------------------------------------ */

/** Read a whole channel into an event list, up to maxEvents. */
export function decodeChannel(
  reader: ChannelReader,
  spec: ChannelSpec,
  maxEvents: number,
): DecodedChannel {
  const events: ProgramEvent[] = [];
  while (events.length < maxEvents) {
    const event = reader.next();
    if (event === null) break;
    events.push(event);
  }
  return {
    number: spec.number,
    hardware: ((spec.number - 1) % 4) + 1,
    address: spec.address,
    events: events,
    complete: reader.finished,
    totalTicks: reader.elapsedTicks,
  };
}

/** Options for decodeProgram, all of them defaulted by the cry helper. */
export interface ProgramOptions {
  frequencyOffset: number;
  /** Tempo seed for every non-noise channel. Noise always runs at FRAME_TICKS. */
  frameTicks: number;
  allowLoops: boolean;
  plainFrames: number;
  maxEvents: number;
}

/** Decode every channel a header names. */
export function decodeProgram(
  rom: ProgramBytes,
  header: ProgramLocation,
  options: ProgramOptions,
): DecodedProgram {
  const state: ProgramState = { tempo: DEFAULT_TEMPO, pan: 0xff };
  const specs = readSoundHeader(rom, header);
  const channels: DecodedChannel[] = [];
  let seconds = 0;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const hardware = ((spec.number - 1) % 4) + 1;
    const reader = new ChannelReader(rom, spec, state, {
      bank: header.bank,
      frequencyOffset: options.frequencyOffset,
      // The noise channel keeps the default frame tempo whatever the cry asks
      // for; only the tone channels are stretched by the length byte.
      frameTicks: hardware === 4 ? FRAME_TICKS : options.frameTicks,
      allowLoops: options.allowLoops,
      plainFrames: options.plainFrames,
    });
    const decoded = decodeChannel(reader, spec, options.maxEvents);
    channels.push(decoded);
    const channelSeconds = decoded.totalTicks / TICKS_PER_SECOND;
    if (channelSeconds > seconds) seconds = channelSeconds;
  }
  return { channels: channels, state: state, seconds: seconds };
}

/* ------------------------------------------------------------------------ */
/* Cries                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * One species' row in CryData: three bytes, indexed by INTERNAL species index.
 *
 * `index` is 1-based, matching the manifest's constants.speciesOrder, because
 * that is the order the table is laid out in -- not Pokedex order.
 */
export function readCryEntry(
  rom: ProgramBytes,
  cryData: ProgramLocation,
  index: number,
): CryEntry {
  const base = cryData.address + (index - 1) * 3;
  return {
    cryId: rom.byte(cryData.bank, base),
    pitch: rom.byte(cryData.bank, base + 1),
    length: rom.byte(cryData.bank, base + 2),
  };
}

/** Decode one species' cry: the header its CryData row names, with its modifiers. */
export function decodeCry(
  rom: ProgramBytes,
  cryData: ProgramLocation,
  header: ProgramLocation,
  entry: CryEntry,
): DecodedProgram {
  return decodeProgram(rom, header, {
    frequencyOffset: entry.pitch,
    frameTicks: 0x80 + entry.length,
    // A cry is a one-shot; an infinite loop in one ends the channel instead.
    allowLoops: false,
    plainFrames: 0,
    maxEvents: 512,
  });
}
