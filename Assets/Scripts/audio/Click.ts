// The Game Boy's own click: a button answering a press before there is a
// world.
//
// The cartridge's menu sound (Press_AB) lives in the sound banks, and the
// banks arrive with the world bundle -- so on the setup pages, where a
// wearer presses A for the first time, there was nothing to play. This is a
// tone the pulse channel can make from nothing: one short high blip, three
// frames long, decaying, the kind of sound a DMG makes when a menu moves.
// It is decoded events, the form the baked cries take, so it goes through
// the same Voice as a cry and needs no bank.

import type { ProgramEvent } from "./ChannelProgram";
import { registerToHz, FRAME_TICKS, TICKS_PER_SECOND } from "./ChannelProgram";

/** How long the click sounds, in frames of a sixtieth. */
export const CLICK_FRAMES: number = 3;
/** The pulse channel's 11-bit period register: about 1.57 kHz, G6. */
export const CLICK_REGISTER: number = 1964;
/** Envelope: starts at this volume and steps down once per envelope period. */
export const CLICK_VOLUME: number = 8;
export const CLICK_FADE: number = 1;
/** Duty index 2: the 50% square, the plainest of the four. */
export const CLICK_DUTY: number = 2;

export function clickEvents(): ProgramEvent[][] {
  const ticks = CLICK_FRAMES * FRAME_TICKS;
  const tone: ProgramEvent = {
    kind: "tone",
    startTicks: 0,
    ticks: ticks,
    seconds: ticks / TICKS_PER_SECOND,
    register: CLICK_REGISTER,
    frequencyHz: registerToHz(CLICK_REGISTER),
    volume: CLICK_VOLUME,
    fade: CLICK_FADE,
    duty: CLICK_DUTY,
    dutyCycle: null,
    noiseParameter: 0,
    waveInstrument: 0,
    waveLevel: 0,
    vibrato: null,
    slide: null,
    sweep: null,
    at: 0,
  };
  return [[tone]];
}
