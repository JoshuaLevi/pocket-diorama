/**
 * One Game Boy pulse channel, rendered to a float buffer.
 *
 * The DMG's two pulse channels are a duty-cycled square wave with an 11-bit
 * period register, a 4-bit volume with a linear envelope, and -- on channel 1
 * only -- a hardware frequency sweep. Everything here is that, plus the three
 * software modulations the Gen 1 sound engine layers on top (vibrato, pitch
 * slide, and a four-frame duty rotation).
 *
 * The channel's own output is UNIPOLAR, 0 to 1: the hardware DAC has no
 * negative side. Turning that into something a speaker can take is the output
 * stage at the bottom of this file, which is where the DC offset goes and
 * where the only clamp lives. Keeping the two apart is what lets the test
 * measure how close the mix comes to clipping instead of assuming it does not.
 *
 * Ported from gen1recomp's src/core/ChipSynth.lua (MIT). Lens Studio
 * TypeScript restrictions apply: no Record/Map/Set, no export enum.
 */

import type { ProgramEvent, Sweep } from "./ChannelProgram";
import { snapTicks } from "./ChannelProgram";

/* ------------------------------------------------------------------------ */
/* Hardware constants                                                        */
/* ------------------------------------------------------------------------ */

/** The four DMG duty patterns, eight steps each: 12.5%, 25%, 50%, 75%. */
export const DUTY_PATTERNS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

const GB_CLOCK = 4194304;

/** Envelope steps run at 64 Hz, so a fade of N is one step every N/64 s. */
const ENVELOPE_HZ = 64;

/** The sweep unit ticks at 128 Hz. */
const SWEEP_HZ = 128;

/**
 * Volume after `elapsed` seconds of a linear envelope.
 *
 * Positive fade decays towards silence, negative fade grows towards 15, and
 * both saturate rather than wrapping.
 */
export function envelopeVolume(
  volume: number,
  fade: number,
  elapsed: number,
): number {
  if (fade === 0) return volume;
  const steps = Math.floor(elapsed / (Math.abs(fade) / ENVELOPE_HZ));
  if (fade > 0) return Math.max(0, volume - steps);
  return Math.min(15, volume + steps);
}

function sweepStep(register: number, sweep: Sweep): number {
  const delta = Math.floor(register / Math.pow(2, sweep.shift));
  if (sweep.subtract) return register - delta;
  return register + delta;
}

/* ------------------------------------------------------------------------ */
/* The channel                                                               */
/* ------------------------------------------------------------------------ */

/**
 * A pulse channel's per-sample state.
 *
 * One instance renders a whole channel: it holds the phase accumulator across
 * samples and the sweep's running register across the samples of one note.
 */
export class PulseChannel {
  private readonly rate: number;
  private phase: number;

  /** Sweep iterations already applied, and the register they produced. */
  private sweepDone: number;
  private sweepRegister: number;
  private sweepNext: number;
  /** Iteration at which the sweep overflowed and silenced the channel. */
  private sweepDead: number;

  constructor(sampleRate: number) {
    this.rate = sampleRate;
    this.phase = 0;
    this.sweepDone = 0;
    this.sweepRegister = 0;
    this.sweepNext = 0;
    this.sweepDead = -1;
  }

  /** Start of a new event: the phase restarts, as it does on the hardware. */
  reset(event: ProgramEvent): void {
    this.phase = 0;
    this.sweepDone = 0;
    this.sweepRegister = event.register;
    this.sweepDead = -1;
    if (event.sweep !== null && event.sweep.shift !== 0) {
      this.sweepNext = sweepStep(event.register, event.sweep);
      if (this.sweepNext > 0x7ff || this.sweepNext < 0) this.sweepDead = 0;
    }
  }

  /**
   * The swept period after `elapsed` seconds, or -1 once the sweep has
   * overflowed and cut the channel.
   *
   * The reference recomputes the whole iteration chain from the note's
   * starting register on every sample, which is quadratic in the note length.
   * This walks the same chain once and remembers where it got to. The
   * iteration count only ever rises, so the sequence of registers visited --
   * and the iteration at which it overflows -- is identical either way.
   */
  private swept(register: number, sweep: Sweep, elapsed: number): number {
    if (sweep.shift === 0) return register;
    if (this.sweepDead === 0) return -1;
    if (sweep.pace === 0) return register;
    const wanted = Math.floor((elapsed * SWEEP_HZ) / sweep.pace);
    if (this.sweepDead >= 0 && wanted >= this.sweepDead) return -1;
    while (this.sweepDone < wanted) {
      this.sweepRegister = this.sweepNext;
      this.sweepNext = sweepStep(this.sweepRegister, sweep);
      this.sweepDone += 1;
      if (this.sweepNext > 0x7ff || this.sweepNext < 0) {
        this.sweepDead = this.sweepDone + 1;
        if (wanted >= this.sweepDead) return -1;
        break;
      }
    }
    return this.sweepRegister;
  }

  /**
   * One sample of `event`, `elapsed` seconds in.
   *
   * Returns the channel's DAC output in 0..1. Advances the phase, so it must
   * be called once per sample and in order.
   */
  sample(event: ProgramEvent, elapsed: number): number {
    if (event.kind !== "tone") return 0;

    const volume = envelopeVolume(event.volume, event.fade, elapsed);
    const frame = Math.floor(elapsed * 60);

    let register = event.register;
    if (event.sweep !== null) {
      register = this.swept(register, event.sweep, elapsed);
      if (register < 0) return 0;
    } else if (event.slide !== null) {
      const amount = Math.min(1, frame / event.slide.frames);
      register = register + (event.slide.target - register) * amount;
    } else if (event.vibrato !== null && frame >= event.vibrato.delay) {
      const vibrato = event.vibrato;
      const toggles = Math.floor((frame - vibrato.delay + 1) / (vibrato.rate + 1));
      if (toggles > 0) {
        // The wobble is applied to the low byte alone and clamps there, so a
        // deep vibrato flattens out rather than carrying into the high bits.
        const low = register & 0xff;
        const high = register & 0x700;
        if ((toggles & 1) !== 0) {
          register = high + Math.min(0xff, low + vibrato.above);
        } else {
          register = high + Math.max(0, low - vibrato.below);
        }
      }
    }

    const frequency = 131072 / (2048 - Math.min(register, 2047));
    const phase = this.phase;
    this.phase = (phase + frequency / this.rate) % 1;

    let duty = event.duty;
    if (event.dutyCycle !== null) duty = event.dutyCycle[frame % 4];
    const pattern = DUTY_PATTERNS[duty] || DUTY_PATTERNS[2];
    const step = Math.floor(phase * 8) % 8;
    if (pattern[step] === 0) return 0;
    return volume / 15;
  }
}

/* ------------------------------------------------------------------------ */
/* Rendering a decoded channel                                               */
/* ------------------------------------------------------------------------ */

/** Samples a decoded event list occupies at a given rate. */
export function pulseSampleCount(
  events: ProgramEvent[],
  sampleRate: number,
): number {
  if (events.length === 0) return 0;
  const last = events[events.length - 1];
  return snapTicks(last.startTicks + last.ticks, sampleRate);
}

function renderInto(
  events: ProgramEvent[],
  sampleRate: number,
  out: Float32Array,
  add: boolean,
): void {
  const channel = new PulseChannel(sampleRate);
  for (let e = 0; e < events.length; e++) {
    const event = events[e];
    if (event.kind === "noise") {
      throw new Error(
        "Pulse.ts was handed a noise event at " + event.at +
        "; the noise channel needs its own renderer",
      );
    }
    const start = snapTicks(event.startTicks, sampleRate);
    const end = snapTicks(event.startTicks + event.ticks, sampleRate);
    channel.reset(event);
    for (let i = start; i < end && i < out.length; i++) {
      const value = channel.sample(event, (i - start) / sampleRate);
      if (add) out[i] += value; else out[i] = value;
    }
  }
}

/** Render one pulse channel's events into a fresh buffer. */
export function renderPulse(
  events: ProgramEvent[],
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(pulseSampleCount(events, sampleRate));
  renderInto(events, sampleRate, out, false);
  return out;
}

/** Add one pulse channel's events into an existing mix buffer. */
export function mixPulseInto(
  events: ProgramEvent[],
  sampleRate: number,
  out: Float32Array,
): void {
  renderInto(events, sampleRate, out, true);
}

/* ------------------------------------------------------------------------ */
/* Output stage                                                              */
/* ------------------------------------------------------------------------ */

/**
 * The analogue tail of the DMG: a DC-blocking high pass, a gentle low pass,
 * and the mixer's halving.
 *
 * This is what turns four unipolar channels into a signal centred on zero.
 * It belongs in Mixer.ts once that exists; it lives here so this prototype can
 * measure a real output buffer rather than a channel's raw DAC values.
 *
 * `peak` is the largest magnitude seen BEFORE the clamp, so a caller can tell
 * a mix that fits from one that only fits because it was clipped.
 */
export class ChipOutput {
  private readonly charge: number;
  private cap: number;
  private lp: number;
  peak: number;
  clamped: number;

  constructor(sampleRate: number) {
    this.charge = Math.pow(0.999958, GB_CLOCK / sampleRate);
    this.cap = 0;
    this.lp = 0;
    this.peak = 0;
    this.clamped = 0;
  }

  process(input: number): number {
    const hp = input - this.cap;
    this.cap = input - hp * this.charge;
    this.lp = this.lp + 0.8 * (hp - this.lp);
    const value = this.lp * 0.5;
    const magnitude = Math.abs(value);
    if (magnitude > this.peak) this.peak = magnitude;
    if (value > 1) { this.clamped += 1; return 1; }
    if (value < -1) { this.clamped += 1; return -1; }
    return value;
  }

  /** Run a whole buffer through, in place. */
  processInto(buffer: Float32Array): void {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = this.process(buffer[i]);
    }
  }
}
