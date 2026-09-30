/**
 * Four channels into one buffer, a frame at a time.
 *
 * Cries could be rendered whole and then played (CryVoice does exactly that)
 * because a cry ends. Music does not, so this pulls: each channel holds a
 * decoder mid-stream and is asked for the next event only when the note it is
 * playing runs out. Memory is one event a channel however long the song is, and
 * a track can start playing before its second bar has been decoded.
 *
 * What a VOICE is: one running program -- a song, a sound effect, a cry -- with
 * its own channels and its own clock. The mixer holds a few at once and adds
 * them together, and that is where the cartridge's one real mixing rule lives:
 * a sound effect does not play ALONGSIDE the music, it TAKES the music's
 * channels for as long as it lasts. Gen 1 numbers its channels 1-8 for this
 * reason; 5-8 are 1-4 again, and the engine silences the music channel whose
 * hardware an effect has claimed. Ignoring that gives you five voices on four
 * channels, which no Game Boy ever sounded like.
 *
 * Everything here is driven by the audio output's own frame requests, which is
 * to say by the wall clock. That is what keeps the music at its own tempo while
 * the game runs at 2X or 4X.
 */

import type { ProgramBytes, ProgramEvent, ProgramLocation } from "./ChannelProgram";
import {
  ChannelReader, DEFAULT_TEMPO, FRAME_TICKS, readSoundHeader, snapTicks,
} from "./ChannelProgram";
import { ChipOutput, PulseChannel } from "./Pulse";
import { WaveChannel } from "./WaveChannel";
import type { WaveTables } from "./WaveChannel";
import { DrumKit, NoiseChannel } from "./NoiseChannel";
import type { DrumSource } from "./NoiseChannel";

/** Everything a voice needs to look up while it plays. */
export interface AudioSource extends ProgramBytes, DrumSource, WaveTables {
  engineOf(bank: number): number;
}

/** Where a channel's events come from: a live decoder, or a finished list. */
interface EventSource {
  next(): ProgramEvent | null;
}

class ReaderSource implements EventSource {
  private readonly reader: ChannelReader;
  constructor(reader: ChannelReader) {
    this.reader = reader;
  }
  next(): ProgramEvent | null {
    return this.reader.next();
  }
}

class ListSource implements EventSource {
  private readonly events: ProgramEvent[];
  private at: number = 0;
  constructor(events: ProgramEvent[]) {
    this.events = events;
  }
  next(): ProgramEvent | null {
    if (this.at >= this.events.length) {
      return null;
    }
    const event = this.events[this.at];
    this.at += 1;
    return event;
  }
}

/**
 * One channel of one voice, mid-note.
 *
 * `cursor` is the voice's own sample clock, so a channel that has fallen behind
 * (a long rest) catches up by pulling events rather than by drifting.
 */
class VoiceChannel {
  readonly hardware: number;
  private readonly source: EventSource;
  private readonly rate: number;
  private readonly music: boolean;
  private readonly pulse: PulseChannel;
  private readonly wave: WaveChannel;
  private readonly noise: NoiseChannel;
  private readonly kit: DrumKit;

  private event: ProgramEvent = null;
  private startSample: number = 0;
  private endSample: number = 0;
  /** The drum program a music noise note is playing, and where it has got to. */
  private parts: ProgramEvent[] = null;
  private partAt: number = 0;
  private partStart: number = 0;
  private partEnd: number = 0;
  private ended: boolean = false;

  constructor(hardware: number, source: EventSource, rate: number, music: boolean,
              tables: WaveTables, engine: number, kit: DrumKit) {
    this.hardware = hardware;
    this.source = source;
    this.rate = rate;
    this.music = music;
    this.pulse = new PulseChannel(rate);
    this.wave = new WaveChannel(rate, tables, engine);
    this.noise = new NoiseChannel(rate);
    this.kit = kit;
  }

  get finished(): boolean {
    return this.ended && this.event === null;
  }

  /** Pulls events until one covers `at`, or the stream ends. */
  private seek(at: number): void {
    while (!this.ended && (this.event === null || at >= this.endSample)) {
      const next = this.source.next();
      if (next === null) {
        this.ended = true;
        this.event = null;
        return;
      }
      this.event = next;
      this.startSample = snapTicks(next.startTicks, this.rate);
      this.endSample = snapTicks(next.startTicks + next.ticks, this.rate);
      // A zero-length event would leave the loop spinning on the same sample.
      if (this.endSample <= this.startSample) {
        this.endSample = this.startSample + 1;
      }
      this.beginEvent();
    }
  }

  private beginEvent(): void {
    const event = this.event;
    this.parts = null;
    this.partAt = 0;
    if (this.hardware === 3) {
      this.wave.reset(event);
      return;
    }
    if (this.hardware === 4) {
      this.noise.reset();
      // A MUSIC note names a drum out of the engine's kit; an sfx note carries
      // its own polynomial byte and is played as it stands.
      if (this.music && this.kit && event.kind === "noise") {
        const parts = this.kit.events(event.noiseParameter);
        if (parts.length > 0) {
          this.parts = parts;
          this.partStart = this.startSample;
          this.partEnd = this.startSample + snapTicks(parts[0].ticks, this.rate);
        }
      }
      return;
    }
    this.pulse.reset(event);
  }

  /** This channel's output at absolute sample `at`, 0 to 1. */
  sample(at: number): number {
    this.seek(at);
    const event = this.event;
    if (event === null || at < this.startSample) {
      return 0;
    }
    if (this.hardware === 3) {
      return this.wave.sample(event, (at - this.startSample) / this.rate);
    }
    if (this.hardware === 4) {
      if (this.parts === null) {
        return this.noise.sample(event, (at - this.startSample) / this.rate);
      }
      while (at >= this.partEnd && this.partAt + 1 < this.parts.length) {
        this.partAt += 1;
        this.partStart = this.partEnd;
        this.partEnd = this.partStart + snapTicks(this.parts[this.partAt].ticks, this.rate);
        this.noise.reset();
      }
      if (at >= this.partEnd) {
        // The drum is shorter than the note it was played on: silence until the
        // next note, which is what the hardware does once the envelope is out.
        return 0;
      }
      return this.noise.sample(this.parts[this.partAt], (at - this.partStart) / this.rate);
    }
    return this.pulse.sample(event, (at - this.startSample) / this.rate);
  }
}

/**
 * One running program.
 *
 * `cursor` counts samples since the voice started, so two voices started at
 * different times stay independent.
 */
export class Voice {
  readonly name: string;
  /** True for a song: its noise track names drums, and it may loop. */
  readonly isMusic: boolean;
  private readonly channels: VoiceChannel[];
  private cursor: number = 0;

  constructor(name: string, channels: VoiceChannel[], isMusic: boolean) {
    this.name = name;
    this.channels = channels;
    this.isMusic = isMusic;
  }

  get finished(): boolean {
    for (let i = 0; i < this.channels.length; i++) {
      if (!this.channels[i].finished) {
        return false;
      }
    }
    return true;
  }

  /** The hardware channels this voice occupies, as flags 1-4 at index 0-3. */
  hardwareInUse(): boolean[] {
    const out = [false, false, false, false];
    for (let i = 0; i < this.channels.length; i++) {
      const at = this.channels[i].hardware - 1;
      if (at >= 0 && at < 4) out[at] = true;
    }
    return out;
  }

  /**
   * Adds `count` samples into `out`, skipping any hardware channel in `muted`.
   *
   * A muted channel is still ADVANCED -- it keeps decoding and keeps its place
   * -- because an effect that steals channel 1 for half a second must hand back
   * a melody that has moved on, not one that resumes where it was interrupted.
   */
  mix(out: Float32Array, count: number, muted: boolean[]): void {
    for (let i = 0; i < count; i++) {
      const at = this.cursor + i;
      for (let c = 0; c < this.channels.length; c++) {
        const channel = this.channels[c];
        const value = channel.sample(at);
        if (muted !== null && muted[channel.hardware - 1] === true) {
          continue;
        }
        out[i] += value;
      }
    }
    this.cursor += count;
  }

  /** Samples played so far. */
  get played(): number {
    return this.cursor;
  }
}

/* ------------------------------------------------------------------------ */
/* Building voices                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A voice for a program in the audio banks: a song, or a sound effect.
 *
 * `loops` is what separates the two in practice -- a song's infinite loop is
 * followed, a sound effect's is a reason to stop -- and it is passed rather
 * than guessed, because a fanfare is a song that ends and looks like both.
 */
export function programVoice(
  source: AudioSource, name: string, header: ProgramLocation,
  sampleRate: number, loops: boolean,
): Voice {
  const specs = readSoundHeader(source, header);
  const state = { tempo: DEFAULT_TEMPO, pan: 0xff };
  const engine = source.engineOf(header.bank);
  const kit = new DrumKit(source, engine);
  const channels: VoiceChannel[] = [];
  let music = false;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    // Channels 1-4 are the music interpreter's; 5-8 are the effect one's.
    if (spec.number <= 4) music = true;
  }
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const reader = new ChannelReader(source, spec, state, {
      bank: header.bank,
      frequencyOffset: 0,
      frameTicks: FRAME_TICKS,
      allowLoops: loops,
      plainFrames: 0,
    });
    channels.push(new VoiceChannel(spec.hardware, new ReaderSource(reader),
                                   sampleRate, spec.number <= 4,
                                   source, engine, kit));
  }
  return new Voice(name, channels, music && loops);
}

/** A voice for an already-decoded program: the baked cries. */
export function eventVoice(
  name: string, channels: ProgramEvent[][], sampleRate: number,
): Voice {
  const built: VoiceChannel[] = [];
  for (let i = 0; i < channels.length; i++) {
    // The cry bank drops the noise channel at bake time, so every channel here
    // is a tone one; channel 1 and 2 in the order the header named them.
    const hardware = i === 0 ? 1 : 2;
    built.push(new VoiceChannel(hardware, new ListSource(channels[i]),
                                sampleRate, false, null, 1, null));
  }
  return new Voice(name, built, false);
}

/* ------------------------------------------------------------------------ */
/* The mixer                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * How loud the sum of four unipolar channels is allowed to be.
 *
 * Measured rather than chosen: see test/music.test.mjs, which renders real
 * tracks and reports the peak BEFORE the clamp, so a number that only fits
 * because it was clipped fails instead of sounding bad.
 */
export const MASTER_GAIN: number = 0.45;

export class Mixer {
  private readonly rate: number;
  private readonly output: ChipOutput;
  private music: Voice = null;
  private effect: Voice = null;
  private scratch: Float32Array = null;

  constructor(sampleRate: number) {
    this.rate = sampleRate;
    this.output = new ChipOutput(sampleRate);
  }

  get sampleRate(): number {
    return this.rate;
  }

  setMusic(voice: Voice): void {
    this.music = voice;
  }

  setEffect(voice: Voice): void {
    this.effect = voice;
  }

  musicVoice(): Voice {
    return this.music;
  }

  effectVoice(): Voice {
    return this.effect;
  }

  /** True while anything at all is sounding. */
  get busy(): boolean {
    return this.music !== null || this.effect !== null;
  }

  /**
   * Fills `frame` with the next block of audio. Returns the peak seen before
   * the clamp, which is what a test measures headroom with.
   */
  fill(frame: Float32Array): number {
    const count = frame.length;
    if (this.scratch === null || this.scratch.length < count) {
      this.scratch = new Float32Array(count);
    }
    const mix = this.scratch;
    for (let i = 0; i < count; i++) {
      mix[i] = 0;
    }

    let muted: boolean[] = null;
    if (this.effect !== null) {
      muted = this.effect.hardwareInUse();
      this.effect.mix(mix, count, null);
      if (this.effect.finished) {
        this.effect = null;
      }
    }
    if (this.music !== null) {
      this.music.mix(mix, count, muted);
      if (this.music.finished) {
        this.music = null;
      }
    }

    const before = this.output.peak;
    for (let i = 0; i < count; i++) {
      frame[i] = this.output.process(mix[i] * MASTER_GAIN);
    }
    const peak = this.output.peak;
    this.output.peak = before > peak ? before : peak;
    return peak;
  }

  /** Samples clamped so far: zero is the only good answer. */
  get clamped(): number {
    return this.output.clamped;
  }

  /** The largest magnitude seen before the clamp. */
  get peak(): number {
    return this.output.peak;
  }
}
