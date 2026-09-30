/**
 * The jukebox, connected to the headset's speakers.
 *
 * Everything Lens-specific about playing audio is here, and it is not much: an
 * AudioComponent whose track is an Audio Output asset hands out a preferred
 * frame size and takes a Float32Array back, once a frame, forever. The synth
 * fills that array. If the frames stop arriving the sound stops; if they arrive
 * late it stutters, which is why `underruns` is counted rather than assumed
 * away.
 *
 * Deliberately tolerant of having no audio component at all. A fresh clone of
 * this project has no Audio Output asset wired -- that is exactly how the lens
 * shipped for weeks with a finished cry synth nobody had ever heard -- and the
 * right answer to that is a lens that plays silently, not one that throws on
 * the first note.
 */

import type { Jukebox } from "./Jukebox";

/** What the Audio Output track's control offers. Structural, so tests can fake it. */
export interface AudioOutput {
  sampleRate: number;
  getPreferredFrameSize(): number;
  enqueueAudioFrame(samples: Float32Array, shape: any): void;
}

export class AudioDriver {
  private audio: AudioComponent = null;
  private provider: AudioOutput = null;
  private jukebox: Jukebox = null;
  private frame: Float32Array = null;
  private started: boolean = false;
  /** Frames the output asked for that we could not answer. */
  private underruns: number = 0;
  private frames: number = 0;

  /**
   * The output's own sample rate, or 0 when there is no output.
   *
   * The jukebox is built AFTER this is known: a synth running at the wrong rate
   * is not slightly wrong, it is a semitone or two out for the whole game.
   */
  attach(audio: AudioComponent): number {
    this.audio = null;
    this.provider = null;
    if (!audio) {
      return 0;
    }
    if (!audio.audioTrack) {
      // No track on the component. Rather than play silently, find the Audio
      // Output asset ourselves -- see outputAsset() for why this exists.
      const asset = AudioDriver.outputAsset();
      if (asset) {
        audio.audioTrack = asset as AudioTrackAsset;
        print("[AudioDriver] no track was wired; using GameAudioOutput.audioOutput");
      }
    }
    if (!audio.audioTrack || !audio.audioTrack.control) {
      return 0;
    }
    const candidate = audio.audioTrack.control as any;
    if (!candidate.getPreferredFrameSize || !candidate.enqueueAudioFrame) {
      return 0;
    }
    this.audio = audio;
    this.provider = candidate as AudioOutput;
    return candidate.sampleRate > 0 ? candidate.sampleRate : 0;
  }

  /**
   * The Audio Output asset, found by name instead of by wiring.
   *
   * Lens Studio 5.15's editor API does not expose AudioComponent.audioTrack at
   * all, so the 5.15 sibling project could not be wired the way the 5.23 one
   * was: it took a manual drag in the Inspector, once per project, and a lens
   * whose track was not dragged played the whole game in silence with a synth
   * that worked perfectly.
   *
   * requireAsset resolves BY NAME: from this file it searches Assets/Scripts/
   * audio, then Assets/Scripts, then Assets, where the asset is. The string has
   * to be a literal for the packager to know the lens needs the asset at all.
   *
   * Returns null wherever there is no requireAsset (a Node test) or no such
   * asset (a project that never had one), and the caller then does what it did
   * before: nothing, quietly.
   */
  private static outputAsset(): any {
    if (typeof requireAsset !== "function") {
      return null;
    }
    try {
      return requireAsset("GameAudioOutput.audioOutput");
    } catch (e) {
      print("[AudioDriver] no GameAudioOutput.audioOutput to fall back on: " + e);
      return null;
    }
  }

  setJukebox(jukebox: Jukebox): void {
    this.jukebox = jukebox;
  }

  get connected(): boolean {
    return this.provider !== null;
  }

  /**
   * Frames delivered, how many arrived empty, and whether the COMPONENT thinks
   * it is playing.
   *
   * The last one is the difference between two failures that look identical
   * from the room: frames streaming into a component that never started, and a
   * component playing correctly into a muted preview. Only the log can tell
   * them apart, and without isPlaying it could not.
   */
  report(): string {
    return "frames=" + this.frames + " underruns=" + this.underruns +
           " isPlaying=" + (this.audio ? this.audio.isPlaying() : false);
  }

  /**
   * One frame of audio. Call once a frame, before or after the game logic --
   * it takes no game time and must not be skipped by an early return, or the
   * music stops whenever a menu is open.
   */
  tick(): void {
    if (!this.provider || !this.jukebox) {
      return;
    }
    const count = this.provider.getPreferredFrameSize();
    if (count <= 0) {
      return;
    }
    if (this.frame === null || this.frame.length !== count) {
      this.frame = new Float32Array(count);
    }
    try {
      this.jukebox.fill(this.frame);
    } catch (e) {
      // A song that throws mid-decode must not take the lens with it. Silence
      // this frame, and the count says it happened.
      for (let i = 0; i < count; i++) {
        this.frame[i] = 0;
      }
      this.underruns += 1;
      print("[AudioDriver] fill failed: " + e);
    }
    if (!this.started && this.audio) {
      // Playing an Audio Output track means "start consuming frames"; it has no
      // end of its own, so -1 loops for as long as the lens runs.
      this.audio.play(-1);
      this.started = true;
    }
    this.provider.enqueueAudioFrame(this.frame, new vec3(count, 1, 1));
    this.frames += 1;
  }
}
