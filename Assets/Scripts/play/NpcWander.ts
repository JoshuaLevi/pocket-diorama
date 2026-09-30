// NPCs with WALK movement wander, as the cartridge's do.
//
// engine/overworld/movement.asm UpdateNPCSprite, as the reference reads it: a
// WALK sprite counts down a random delay of 30 to 180 frames, picks a random
// direction from its range (ANY_DIR, UP_DOWN, LEFT_RIGHT), turns to face it,
// and half the time stops there; otherwise it steps one cell if that cell is
// walkable, free of every other body, and not a warp -- a wanderer must never
// leave the map through a door. It never moves while a box is up or a script
// runs, which is why the caller passes `frozen`.
//
// Pure: it decides, and NpcMotion walks. The lens and the headless harness
// drive it with the same call, so a wanderer that blocks the player in one
// blocks in the other -- up to the random numbers, which are the caller's.

import type { NpcMotion } from "./NpcMotion";

/** Frames at sixty a second, as the cartridge counts them. */
const DELAY_MIN_FRAMES: number = 30;
const DELAY_MAX_FRAMES: number = 180;
const FRAME_SECONDS: number = 1 / 60;
/** Half the decisions are a turn without a step. */
const TURN_ONLY_CHANCE: number = 0.5;

const ROAM: any = {
  ANY_DIR: ["up", "down", "left", "right"],
  UP_DOWN: ["up", "down"],
  LEFT_RIGHT: ["left", "right"],
};

export interface Wanderer {
  name: string;
  /** Where it stands now (its shipped cell until it has moved). */
  x: number;
  y: number;
  range: string;
}

/** What the wanderer may step onto: walkable, unoccupied, not a warp, in the map. */
export type CanStep = (x: number, y: number) => boolean;

export function isWanderer(object: any): boolean {
  return !!object && object.movement === "WALK";
}

export function roamDirections(range: string): string[] {
  return ROAM[range] ? ROAM[range] : ROAM.ANY_DIR;
}

export class NpcWander {
  /** name -> seconds until the next decision. */
  private timers: any = {};
  private random: () => number;

  constructor(random: () => number) {
    this.random = random ? random : Math.random;
  }

  /** A new map: every timer starts afresh. */
  reset(): void {
    this.timers = {};
  }

  private randomDelay(): number {
    const frames = DELAY_MIN_FRAMES +
      Math.floor(this.random() * (DELAY_MAX_FRAMES - DELAY_MIN_FRAMES + 1));
    return frames * FRAME_SECONDS;
  }

  /**
   * One frame for every wanderer. Returns the names that started a step this
   * frame, so the caller can move the body in its collision map when it lands.
   */
  tick(dt: number, wanderers: Wanderer[], motion: NpcMotion, canStep: CanStep,
       frozen: boolean): string[] {
    const stepped: string[] = [];
    for (let i = 0; i < wanderers.length; i++) {
      const w = wanderers[i];
      if (this.timers[w.name] === undefined) {
        this.timers[w.name] = this.randomDelay();
      }
      if (frozen || motion.isMoving(w.name)) {
        continue;
      }
      this.timers[w.name] -= dt;
      if (this.timers[w.name] > 0) {
        continue;
      }
      this.timers[w.name] = this.randomDelay();
      const dirs = roamDirections(w.range);
      const direction = dirs[Math.floor(this.random() * dirs.length) % dirs.length];
      motion.face(w.name, w.x, w.y, direction);
      if (this.random() < TURN_ONLY_CHANCE) {
        continue;
      }
      const tx = w.x + (direction === "left" ? -1 : direction === "right" ? 1 : 0);
      const ty = w.y + (direction === "up" ? -1 : direction === "down" ? 1 : 0);
      if (!canStep(tx, ty)) {
        continue;
      }
      motion.request(w.name, w.x, w.y, [direction]);
      stepped.push(w.name);
    }
    return stepped;
  }
}
