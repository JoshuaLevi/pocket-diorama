/**
 * The Game Boy's wave channel: the bass line, and the one channel that plays a
 * shape rather than a square.
 *
 * Channel 3 reads a 32-entry table of four-bit samples out of its own RAM and
 * clocks through it. The gen 1 sound engine keeps ten such tables in the ROM
 * and a note names which one it wants, so the "instrument" is literally a
 * waveform: the same note through table 0 and table 9 is two different sounds.
 *
 * Two hardware facts shape everything below.
 *
 *   The period register means something DIFFERENT here than on the pulse
 *   channels. Channel 3 advances one of 32 samples every (2048 - x) * 2 clocks,
 *   so a full cycle takes 32 times that and the note comes out at
 *   65536 / (2048 - x) Hz -- an octave BELOW the same register on a pulse
 *   channel. That is not a quirk to correct; it is why this channel carries the
 *   bass, and reading it as a pulse would put the bass line an octave too high.
 *
 *   There is no envelope. Volume is two bits selecting full, half, quarter or
 *   silence, and it does not change while a note lasts. The decoder already
 *   turns those two bits into `waveLevel` (ChannelProgram's WAVE_LEVEL), so a
 *   fade byte on this channel means nothing and is not read.
 *
 * The output is UNIPOLAR, 0 to 1, like PulseChannel's -- ChipOutput at the
 * bottom of Pulse.ts is what centres the mix on zero.
 */

import type { ProgramEvent } from "./ChannelProgram";
import { snapTicks } from "./ChannelProgram";

/** Samples in one pass of the table. */
export const WAVE_STEPS: number = 32;

/**
 * A wave-channel note's frequency, in Hz, from its period register.
 *
 * Half the pulse channels' `registerToHz` for the same register. See the header.
 */
export function waveRegisterToHz(register: number): number {
  return 65536 / (2048 - Math.min(register, 2047));
}

/** Looks a wave instrument's samples up. Implemented by AudioBanks. */
export interface WaveTables {
  waveSamples(engine: number, instrument: number): Uint8Array;
}

/**
 * One wave channel's per-sample state.
 *
 * Holds the phase across samples, and the table the current note is playing,
 * so the lookup happens once a note rather than once a sample.
 */
export class WaveChannel {
  private readonly rate: number;
  private readonly tables: WaveTables;
  private readonly engine: number;
  private phase: number;
  private samples: Uint8Array;
  private loaded: number;

  constructor(sampleRate: number, tables: WaveTables, engine: number) {
    this.rate = sampleRate;
    this.tables = tables;
    this.engine = engine;
    this.phase = 0;
    this.samples = new Uint8Array(0);
    this.loaded = -1;
  }

  /** Start of a new event: the table is fetched and the phase restarts. */
  reset(event: ProgramEvent): void {
    this.phase = 0;
    if (event.waveInstrument === this.loaded) {
      return;
    }
    this.loaded = event.waveInstrument;
    this.samples = this.tables ? this.tables.waveSamples(this.engine, event.waveInstrument)
                               : new Uint8Array(0);
  }

  /**
   * One sample of `event`, `elapsed` seconds in. Advances the phase, so it must
   * be called once per sample and in order.
   */
  sample(event: ProgramEvent, elapsed: number): number {
    if (event.kind !== "tone" || this.samples.length === 0) {
      return 0;
    }
    const level = event.waveLevel;
    if (!(level > 0)) {
      return 0;
    }

    // The same three modulations the pulse channels take, on the same register.
    // A wave note has no sweep -- the hardware sweep unit is channel 1's alone.
    let register = event.register;
    const frame = Math.floor(elapsed * 60);
    if (event.slide !== null) {
      const amount = Math.min(1, frame / event.slide.frames);
      register = register + (event.slide.target - register) * amount;
    } else if (event.vibrato !== null && frame >= event.vibrato.delay) {
      const vibrato = event.vibrato;
      const toggles = Math.floor((frame - vibrato.delay + 1) / (vibrato.rate + 1));
      if (toggles > 0) {
        const low = register & 0xff;
        const high = register & 0x700;
        if ((toggles & 1) !== 0) {
          register = high + Math.min(0xff, low + vibrato.above);
        } else {
          register = high + Math.max(0, low - vibrato.below);
        }
      }
    }

    const frequency = waveRegisterToHz(register);
    const phase = this.phase;
    this.phase = (phase + frequency / this.rate) % 1;
    const step = Math.floor(phase * WAVE_STEPS) % WAVE_STEPS;
    const nibble = this.samples[step % this.samples.length];
    return (nibble / 15) * level;
  }
}

/** Add one wave channel's events into an existing mix buffer. */
export function mixWaveInto(
  events: ProgramEvent[],
  sampleRate: number,
  tables: WaveTables,
  engine: number,
  out: Float32Array,
): void {
  const channel = new WaveChannel(sampleRate, tables, engine);
  for (let e = 0; e < events.length; e++) {
    const event = events[e];
    const start = snapTicks(event.startTicks, sampleRate);
    const end = snapTicks(event.startTicks + event.ticks, sampleRate);
    channel.reset(event);
    for (let i = start; i < end && i < out.length; i++) {
      if (i < 0) continue;
      out[i] += channel.sample(event, (i - start) / sampleRate);
    }
  }
}
