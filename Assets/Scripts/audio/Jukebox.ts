/**
 * What is playing, and why.
 *
 * The Mixer knows how to turn programs into samples; this knows which program.
 * That is a policy question with a small number of rules, all of them the
 * cartridge's:
 *
 *   every map names a song, and walking into a building changes it
 *   a battle takes the music over, and giving it back is a separate act
 *   a fanfare INTERRUPTS the music and the music comes back when it ends
 *   an effect or a cry takes the channels it needs and gives them back
 *
 * Pure: no scene, no AudioComponent, no clock of its own. It is asked for
 * frames and answers with samples, so a test can render a minute of a map
 * change without a lens. AudioDriver is the part that touches the hardware.
 */

import type { AudioBanks } from "./AudioBank";
import { clickEvents } from "./Click";
import type { CryBankData } from "./CryBank";
import { cryEvents } from "./CryBank";
import { Mixer, eventVoice, programVoice } from "./Mixer";

/** Roles in the battle table, so callers do not spell them out. */
export const BATTLE_WILD: string = "wild";
export const BATTLE_TRAINER: string = "trainer";
export const BATTLE_GYM: string = "gym";
export const BATTLE_FINAL: string = "final";
export const BATTLE_WILD_WIN: string = "wildWin";
export const BATTLE_TRAINER_WIN: string = "trainerWin";
export const BATTLE_GYM_WIN: string = "gymWin";

/** The gym leaders and the Elite Four, who share a theme. */
const GYM_TRAINERS: string[] = [
  "OPP_BROCK", "OPP_MISTY", "OPP_LT_SURGE", "OPP_ERIKA", "OPP_KOGA",
  "OPP_BLAINE", "OPP_SABRINA", "OPP_GIOVANNI",
  "OPP_LORELEI", "OPP_BRUNO", "OPP_AGATHA", "OPP_LANCE",
];

/**
 * Which of the four battle themes an opponent gets.
 *
 * The cartridge decides this by trainer class, and the classes that matter are
 * the eight leaders, the four of the Elite Four, and the rival's last fight --
 * the Champion, who gets the theme the game keeps for him alone.
 */
export function battleRole(trainerId: string): string {
  if (!trainerId) {
    return BATTLE_WILD;
  }
  if (trainerId === "OPP_RIVAL3") {
    return BATTLE_FINAL;
  }
  return GYM_TRAINERS.indexOf(trainerId) >= 0 ? BATTLE_GYM : BATTLE_TRAINER;
}

/** The fanfare that follows a won battle of that role. */
export function victoryRole(role: string): string {
  if (role === BATTLE_GYM || role === BATTLE_FINAL) {
    return BATTLE_GYM_WIN;
  }
  if (role === BATTLE_TRAINER) {
    return BATTLE_TRAINER_WIN;
  }
  return BATTLE_WILD_WIN;
}

export class Jukebox {
  private readonly banks: AudioBanks;
  private readonly cries: CryBankData;
  private readonly mixer: Mixer;

  /** The song the map asks for, the song something else insists on, and a fanfare. */
  private mapLabel: string = "";
  private override: string = "";
  private fanfare: string = "";
  /** The label the music voice was actually started from. */
  private started: string = "";
  private muted: boolean = false;
  /** A script asked for silence; see silence(). */
  /** MUSIC_BIKE_RIDING or MUSIC_SURFING while the player is on one. */
  private ride: string = "";
  private silenced: boolean = false;
  /** Counts what could not be played, so a silent lens can say why. */
  private failures: number = 0;
  private lastFailure: string = "";

  constructor(banks: AudioBanks, cries: CryBankData, sampleRate: number) {
    this.banks = banks;
    this.cries = cries;
    this.mixer = new Mixer(sampleRate);
  }

  get sampleRate(): number {
    return this.mixer.sampleRate;
  }

  /** True when there are banks to play from at all. */
  get available(): boolean {
    return this.banks !== null && this.banks.playable;
  }

  /**
   * The song that should be sounding: a fanfare, else a battle, else how the
   * player is travelling, else the map.
   *
   * PlayDefaultMusicCommon (home/audio.asm:21-27) reads wWalkBikeSurfState
   * before it reads the map: on a bicycle or on the water the map's own song
   * is not playing at all. It is a layer of its own rather than an override
   * because a battle has to win over it and hand it back afterwards.
   */
  wanted(): string {
    if (this.fanfare !== "") return this.fanfare;
    if (this.silenced) return "";
    if (this.override !== "") return this.override;
    if (this.ride !== "") return this.ride;
    return this.mapLabel;
  }

  /** The song actually started, which lags `wanted()` by at most one fill. */
  playing(): string {
    return this.started;
  }

  /** How many programs could not be played, and the last one's name. */
  problems(): string {
    return this.failures === 0 ? "" : this.failures + " (" + this.lastFailure + ")";
  }

  /** The map changed: its own song takes over unless a battle has the music. */
  setMap(mapId: string): void {
    const label = this.banks ? this.banks.songForMap(mapId) : "";
    if (label !== this.mapLabel) {
      // Walking into a building is what ends a script's silence, on the
      // cartridge as here: the new map's music simply starts.
      this.silenced = false;
    }
    this.mapLabel = label;
  }

  /** Riding or surfing: the song that outranks the map. "" to walk again. */
  setRide(label: string): void {
    this.ride = label;
  }

  /** A battle, or anything else that insists. Pass "" to give the music back. */
  setOverride(label: string): void {
    this.override = label === null ? "" : label;
    if (this.override !== "") {
      this.silenced = false;
    }
  }

  /** The battle table's own label for a role, or "" if the bundle has none. */
  battleSong(role: string): string {
    return this.banks ? this.banks.battleSong(role) : "";
  }

  /**
   * A one-shot that interrupts the music: a victory, an item, a level up.
   *
   * It replaces the music rather than playing over it, which is what the
   * cartridge does -- there are four channels, and a fanfare wants them.
   */
  playFanfare(label: string): void {
    if (!label) {
      return;
    }
    this.fanfare = label;
    // Start it now rather than at the next fill, so `playing()` is true
    // immediately for anything watching.
    this.startWanted();
  }

  /**
   * Plays whatever a script asked for by name.
   *
   * The ported scripts name four things, and one of them is not a sound effect
   * at all: the Pokecenter's healing jingle is a short piece of MUSIC in the
   * cartridge (Music_PkmnHealed), which is why a table maps it rather than a
   * lookup failing quietly. Anything else is tried as an effect first and as a
   * fanfare second, so a name from either half of the ROM works.
   */
  playNamed(name: string): void {
    if (!name || !this.banks) {
      return;
    }
    const alias = name === "Pokecenter_Heal" ? "Music_PkmnHealed" : name;
    if (this.banks.sfx(alias) !== null) {
      this.playEffect(alias);
      return;
    }
    if (this.banks.music(alias) !== null) {
      this.playFanfare(alias);
      return;
    }
    this.note(name);
  }

  /**
   * Silence, until something asks for music again.
   *
   * A script's stop_music, and the one state `wanted()` cannot express as a
   * label: "nothing", as opposed to "the map's".
   */
  silence(): void {
    this.silenced = true;
    this.fanfare = "";
    this.override = "";
  }

  /** The map's own music again, whatever silenced or overrode it. */
  resume(): void {
    this.silenced = false;
    this.override = "";
  }

  /** A sound effect, by its key in the bundle's sfx table. */
  playEffect(key: string): void {
    if (!this.banks || !key) {
      return;
    }
    const header = this.banks.sfx(key);
    if (!header) {
      this.note(key);
      return;
    }
    try {
      this.mixer.setEffect(programVoice(this.banks, key, header,
                                        this.mixer.sampleRate, false));
    } catch (e) {
      this.note(key + ": " + e);
    }
  }

  /**
   * The Game Boy's own click for a pressed button: built in (Click.ts), so
   * it sounds on the setup pages, before any world has brought its banks.
   */
  playClick(): void {
    try {
      this.mixer.setEffect(eventVoice("click", clickEvents(), this.mixer.sampleRate));
    } catch (e) {
      this.note("click: " + e);
    }
  }

  /** A Pokemon's cry, from the baked bank rather than the sound banks. */
  playCry(species: string): void {
    if (!this.cries || !species) {
      return;
    }
    try {
      const channels = cryEvents(this.cries, species);
      if (channels.length === 0) {
        this.note("cry " + species);
        return;
      }
      this.mixer.setEffect(eventVoice("cry:" + species, channels,
                                      this.mixer.sampleRate));
    } catch (e) {
      this.note("cry " + species + ": " + e);
    }
  }

  /** Silence, and forget what was playing so the next map starts it afresh. */
  stop(): void {
    this.mapLabel = "";
    this.override = "";
    this.fanfare = "";
    this.started = "";
    this.silenced = false;
    this.mixer.setMusic(null);
    this.mixer.setEffect(null);
  }

  /** Silences the output without forgetting the state behind it. */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /**
   * Fills one frame of audio.
   *
   * The only place a voice is ever built, so the cost of starting a song lands
   * on an audio frame rather than in the middle of a map change.
   */
  fill(frame: Float32Array): void {
    if (this.muted) {
      for (let i = 0; i < frame.length; i++) {
        frame[i] = 0;
      }
      return;
    }
    // A fanfare that has run out gives the music back. The mixer drops a voice
    // the moment it finishes, so a null music voice with a fanfare set means
    // exactly that.
    if (this.fanfare !== "" && this.mixer.musicVoice() === null &&
        this.started === this.fanfare) {
      this.fanfare = "";
      this.started = "";
    }
    if (this.wanted() !== this.started) {
      this.startWanted();
    }
    this.mixer.fill(frame);
  }

  private startWanted(): void {
    const label = this.wanted();
    this.started = label;
    if (label === "" || !this.banks) {
      this.mixer.setMusic(null);
      return;
    }
    const header = this.banks.music(label);
    if (!header) {
      this.mixer.setMusic(null);
      this.note(label);
      return;
    }
    try {
      // A fanfare ENDS, so its loops are not followed; a song's are. Asking a
      // fanfare to loop would leave the map's music gone for good.
      const loops = label !== this.fanfare;
      this.mixer.setMusic(programVoice(this.banks, label, header,
                                       this.mixer.sampleRate, loops));
    } catch (e) {
      this.mixer.setMusic(null);
      this.note(label + ": " + e);
    }
  }

  private note(what: string): void {
    this.failures += 1;
    this.lastFailure = what;
  }

  /** Peak seen before the clamp, and samples clamped. For the gate. */
  peak(): number {
    return this.mixer.peak;
  }

  clamped(): number {
    return this.mixer.clamped;
  }
}
