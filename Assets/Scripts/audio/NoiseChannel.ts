/**
 * The Game Boy's noise channel: the drums.
 *
 * Channel 4 is a shift register clocked at a programmable rate, and its output
 * is one bit. Everything percussive in Pokemon is that bit, shaped by an
 * envelope: NR43's divisor and shift set how fast the register runs (the
 * "colour" of the noise, from a hiss down to a rattle), and its width bit
 * shortens the sequence from 32767 steps to 127, which stops sounding like
 * noise and starts sounding like a pitched buzz.
 *
 * The part that is NOT hardware is the drum kit. A note on a music channel's
 * noise track does not carry a polynomial byte; it carries an INSTRUMENT INDEX,
 * and the engine runs a tiny program from a per-engine table to produce the
 * sound -- measured in Red at 02:4003 and following, three bytes a table entry,
 * each pointing at a stream like `20 C1 33 FF`: a length, a volume and fade,
 * a polynomial byte, end. Those streams are ordinary channel programs, so the
 * kit is decoded by the ordinary decoder and not by anything in this file.
 *
 * Each of the three engines has its own kit, and the same index is a different
 * drum in each. A song in bank 31 played on bank 2's kit is percussion from
 * another song, all the way through.
 *
 * The output is UNIPOLAR, 0 to 1, like the other channels.
 */

import type { ProgramBytes, ProgramEvent, ProgramLocation } from "./ChannelProgram";
import { ChannelReader, FRAME_TICKS, decodeChannel, snapTicks } from "./ChannelProgram";
import { envelopeVolume } from "./Pulse";

/** The divisor NR43's low three bits select. Code 0 means a half. */
const DIVISORS: number[] = [0.5, 1, 2, 3, 4, 5, 6, 7];

/**
 * The most LFSR steps one output sample may take.
 *
 * The register can run at 524288 Hz, about twelve steps per sample at 44.1 kHz,
 * so this is headroom rather than a limit in practice. It exists because the
 * shift and divisor come out of ROM: a malformed byte must cost a bounded
 * amount of work, not a frozen frame.
 */
const MAX_STEPS_PER_SAMPLE: number = 64;

/** The rate NR43 asks for, in steps a second. */
export function noiseStepHz(parameter: number): number {
  const shift = (parameter >> 4) & 0x0f;
  const divisor = DIVISORS[parameter & 7];
  // Shifts of 14 and 15 are not used by the hardware; treat them as the slowest
  // legal rate rather than as a frequency of zero.
  const clamped = shift > 13 ? 13 : shift;
  return 524288 / divisor / Math.pow(2, clamped + 1);
}

/** True when NR43 asks for the short, buzzy, 127-step sequence. */
export function noiseIsShort(parameter: number): boolean {
  return (parameter & 8) !== 0;
}

/**
 * One noise channel's per-sample state: the shift register and its phase.
 */
export class NoiseChannel {
  private readonly rate: number;
  private lfsr: number;
  private phase: number;

  constructor(sampleRate: number) {
    this.rate = sampleRate;
    this.lfsr = 0x7fff;
    this.phase = 0;
  }

  /** Start of a new event. The hardware refills the register with ones. */
  reset(): void {
    this.lfsr = 0x7fff;
    this.phase = 0;
  }

  private step(short: boolean): void {
    const feedback = (this.lfsr & 1) ^ ((this.lfsr >> 1) & 1);
    this.lfsr = (this.lfsr >> 1) | (feedback << 14);
    if (short) {
      // Seven-bit mode feeds bit 6 as well, which is what makes it buzz.
      this.lfsr = (this.lfsr & ~0x40) | (feedback << 6);
    }
  }

  /**
   * One sample of `event`, `elapsed` seconds in. Advances the register, so it
   * must be called once per sample and in order.
   */
  sample(event: ProgramEvent, elapsed: number): number {
    if (event.kind !== "noise") {
      return 0;
    }
    const volume = envelopeVolume(event.volume, event.fade, elapsed);
    if (volume <= 0) {
      // Still clock the register: a silent tail leaves it where the next note
      // would find it on the hardware.
      this.advance(event);
      return 0;
    }
    this.advance(event);
    // The DAC reads the INVERTED low bit, so a register of all ones is silence
    // rather than a click.
    const bit = (~this.lfsr) & 1;
    return bit === 0 ? 0 : volume / 15;
  }

  private advance(event: ProgramEvent): void {
    const short = noiseIsShort(event.noiseParameter);
    const perSample = noiseStepHz(event.noiseParameter) / this.rate;
    this.phase += perSample;
    let steps = Math.floor(this.phase);
    this.phase -= steps;
    if (steps > MAX_STEPS_PER_SAMPLE) {
      steps = MAX_STEPS_PER_SAMPLE;
    }
    for (let i = 0; i < steps; i++) {
      this.step(short);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* The drum kit                                                              */
/* ------------------------------------------------------------------------ */

/** Where a drum's program lives. Implemented by AudioBanks. */
export interface DrumSource extends ProgramBytes {
  noiseInstrument(engine: number, index: number): ProgramLocation;
}

/**
 * The decoded drums of one engine, fetched once each.
 *
 * A song plays the same handful of drums thousands of times, and each is a
 * four-byte program; decoding one per note would be waste with a name.
 */
export class DrumKit {
  private readonly source: DrumSource;
  private readonly engine: number;
  private readonly cache: any;

  constructor(source: DrumSource, engine: number) {
    this.source = source;
    this.engine = engine;
    this.cache = Object.create(null);
  }

  /**
   * The events one drum makes, starting at tick zero.
   *
   * Empty when the instrument is not in the kit -- a song naming a drum this
   * engine does not have loses that drum, not its whole percussion track.
   */
  events(instrument: number): ProgramEvent[] {
    const key = String(instrument);
    const held = this.cache[key];
    if (held) {
      return held;
    }
    let decoded: ProgramEvent[] = [];
    try {
      const header = this.source.noiseInstrument(this.engine, instrument);
      if (header) {
        decoded = this.decode(header);
      }
    } catch (e) {
      print("[DrumKit] instrument " + instrument + " failed: " + e);
      decoded = [];
    }
    this.cache[key] = decoded;
    return decoded;
  }

  private decode(header: ProgramLocation): ProgramEvent[] {
    // The table entry IS a one-channel sound header: a channel byte naming
    // channel 8 -- an sfx channel, so the decoder reads explicit volume and
    // polynomial bytes rather than note-table pitches -- and a pointer.
    const descriptor = this.source.byte(header.bank, header.address);
    const spec = {
      number: (descriptor & 0x0f) + 1,
      hardware: 4,
      address: this.source.word(header.bank, header.address + 1),
    };
    const reader = new ChannelReader(this.source, spec, { tempo: 0x100, pan: 0xff }, {
      bank: header.bank,
      frequencyOffset: 0,
      frameTicks: FRAME_TICKS,
      // A drum is a one-shot. An infinite loop in one ends the channel.
      allowLoops: false,
      plainFrames: 0,
    });
    return decodeChannel(reader, spec, 32).events;
  }
}

/**
 * Mixes a music channel's noise track, drum programs and all.
 *
 * A music note names an instrument and a LENGTH; the drum's own program says
 * what it sounds like. The program is played from the note's start and cut off
 * at its end, which is what the hardware does when the next note retriggers the
 * channel. `sfx` events already carry their own polynomial byte and are played
 * as they are.
 */
export function mixNoiseInto(
  events: ProgramEvent[],
  sampleRate: number,
  kit: DrumKit,
  out: Float32Array,
  fromMusic: boolean,
): void {
  const channel = new NoiseChannel(sampleRate);
  for (let e = 0; e < events.length; e++) {
    const event = events[e];
    if (event.kind !== "noise") {
      continue;
    }
    const start = snapTicks(event.startTicks, sampleRate);
    const end = snapTicks(event.startTicks + event.ticks, sampleRate);
    const parts = fromMusic && kit ? kit.events(event.noiseParameter) : null;
    if (!parts || parts.length === 0) {
      channel.reset();
      for (let i = start; i < end && i < out.length; i++) {
        if (i >= 0) out[i] += channel.sample(event, (i - start) / sampleRate);
      }
      continue;
    }
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      const partStart = start + snapTicks(part.startTicks, sampleRate);
      let partEnd = start + snapTicks(part.startTicks + part.ticks, sampleRate);
      if (partEnd > end) partEnd = end;
      channel.reset();
      for (let i = partStart; i < partEnd && i < out.length; i++) {
        if (i >= 0) out[i] += channel.sample(part, (i - partStart) / sampleRate);
      }
    }
  }
}
