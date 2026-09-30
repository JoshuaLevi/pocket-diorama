/** Renders a baked cry and streams it through an optional Audio Output asset. */

import { cryEvents } from "./CryBank";
import type { CryBankData } from "./CryBank";
import {
  ChipOutput,
  mixPulseInto,
  pulseSampleCount,
  renderPulse,
} from "./Pulse";

export const DEFAULT_CRY_SAMPLE_RATE = 44100;

/** Species id in, finished mono samples out. This is the integration-test seam. */
export function renderCry(
  bank: CryBankData,
  speciesId: string,
  sampleRate: number = DEFAULT_CRY_SAMPLE_RATE,
): Float32Array {
  if (sampleRate <= 0) {
    throw new Error("cry voice: sample rate must be positive");
  }
  const channels = cryEvents(bank, speciesId);
  let longest = 0;
  let longestSamples = -1;
  for (let i = 0; i < channels.length; i++) {
    const count = pulseSampleCount(channels[i], sampleRate);
    if (count > longestSamples) {
      longest = i;
      longestSamples = count;
    }
  }
  if (longestSamples <= 0) {
    throw new Error("cry voice: " + speciesId + " rendered no samples");
  }

  // Starting with the longest channel sizes the buffer once. The remaining
  // channels retain independent oscillator phase inside mixPulseInto.
  const mixed = renderPulse(channels[longest], sampleRate);
  for (let i = 0; i < channels.length; i++) {
    if (i !== longest) mixPulseInto(channels[i], sampleRate, mixed);
  }
  const output = new ChipOutput(sampleRate);
  output.processInto(mixed);
  return mixed;
}

/**
 * One replaceable cry voice.
 *
 * The AudioComponent must reference an Audio Output track. It is deliberately
 * optional: `play` still returns rendered samples and `tick` is a no-op when a
 * fresh project has no audio component wired.
 */
export class CryVoice {
  private readonly bank: CryBankData;
  private audio: AudioComponent;
  private provider: AudioOutputProvider;
  private sampleRate: number;
  private samples: Float32Array;
  private cursor: number;

  constructor(
    bank: CryBankData,
    audio: AudioComponent = null,
    sampleRate: number = DEFAULT_CRY_SAMPLE_RATE,
  ) {
    this.bank = bank;
    this.audio = null;
    this.provider = null;
    this.sampleRate = sampleRate;
    this.samples = null;
    this.cursor = 0;
    this.setAudioComponent(audio);
  }

  /** Attach or remove the component used to stream Audio Output frames. */
  setAudioComponent(audio: AudioComponent): void {
    this.audio = audio;
    this.provider = null;
    if (!audio || !audio.audioTrack || !audio.audioTrack.control) return;
    const candidate = audio.audioTrack.control as AudioOutputProvider;
    if (!candidate.getPreferredFrameSize || !candidate.enqueueAudioFrame) return;
    this.provider = candidate;
    if (candidate.sampleRate > 0) this.sampleRate = candidate.sampleRate;
  }

  /** Render a species immediately; the next ticks stream these samples. */
  play(speciesId: string): Float32Array {
    const rendered = renderCry(this.bank, speciesId, this.sampleRate);
    this.samples = rendered;
    this.cursor = 0;
    if (this.audio && this.provider && !this.audio.isPlaying()) this.audio.play(-1);
    return rendered;
  }

  /** Enqueue the output track's preferred amount of mono audio for this frame. */
  tick(): void {
    if (!this.provider) return;
    const count = this.provider.getPreferredFrameSize();
    if (count <= 0) return;
    const frame = new Float32Array(count);
    if (this.samples !== null) {
      const remaining = this.samples.length - this.cursor;
      const copy = remaining < count ? remaining : count;
      for (let i = 0; i < copy; i++) {
        frame[i] = this.samples[this.cursor + i];
      }
      this.cursor += copy;
      if (this.cursor >= this.samples.length) {
        this.samples = null;
        this.cursor = 0;
      }
    }
    this.provider.enqueueAudioFrame(frame, new vec3(count, 1, 1));
  }
}
