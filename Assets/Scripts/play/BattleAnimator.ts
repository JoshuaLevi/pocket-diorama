// What the two Pokemon DO when a move lands.
//
// Until now: nothing. The 8 September preview plays a whole fight with both
// sprites standing perfectly still -- "de pokemons doen ook niks bij bijv
// attacks" -- so the only sign that anything happened is a line of text.
//
// The cartridge's own answer is three things at once, and none of them needs
// art we do not have:
//
//   the attacker LUNGES at the defender and comes back
//   the defender BLINKS -- Gen 1 literally hides and shows the sprite
//   the bar DRAINS rather than jumping to its new length
//
// Driven by the HP itself rather than by a message from the engine. That was a
// deliberate choice: every source of damage moves HP -- moves, recoil, poison,
// confusion, a Potion going the other way -- so reading HP catches all of them
// with no protocol to keep in step, and it cannot get out of step with the
// oracle scenarios because the engine is not told about it at all.
//
// The one thing it cannot know is WHO swung, so it infers: the side that did
// not lose HP is the one that did something. When both lost HP in the same
// turn, both lunge, which is what a turn where both attacked looks like anyway.
//
// Pure: numbers in, offsets out. No scene, no sprites.

/** Seconds a lunge takes, out and back. */
export const LUNGE_SECONDS: number = 0.28;
/** How far along the line to the other one the attacker travels, 0..1. */
export const LUNGE_REACH: number = 0.28;
/** Seconds the struck one blinks for. */
export const BLINK_SECONDS: number = 0.42;
/** Blinks per second while it is blinking. Gen 1's own is fast. */
export const BLINK_RATE: number = 12;
/** Seconds a full bar takes to drain. A scratch drains proportionally less. */
export const DRAIN_SECONDS: number = 0.7;

/** One side's animation state. Two of these make a battle. */
class Side {
  /** HP the bar is showing, which chases the real one. */
  shown: number = -1;
  /** Seconds left of this side's lunge, and of its blink. */
  lunge: number = 0;
  blink: number = 0;
}

export class BattleAnimator {
  private mine: Side = new Side();
  private theirs: Side = new Side();
  private lastMine: number = -1;
  private lastTheirs: number = -1;

  /** Forgets everything, for the start of a fight or a switch. */
  reset(): void {
    this.mine = new Side();
    this.theirs = new Side();
    this.lastMine = -1;
    this.lastTheirs = -1;
  }

  /**
   * One frame. `dt` is real seconds; the animation does not follow the game's
   * speed setting, because a 4x world should not make a hit unreadable.
   */
  update(dt: number, mineHp: number, mineMax: number,
         theirsHp: number, theirsMax: number): void {
    const mineHit = this.step(this.mine, dt, mineHp, mineMax, this.lastMine);
    const theirsHit = this.step(this.theirs, dt, theirsHp, theirsMax, this.lastTheirs);
    // Whoever did not just lose HP is the one that swung. Both losing means
    // both swung, and both lunging is what that turn looked like.
    if (mineHit) {
      this.theirs.lunge = LUNGE_SECONDS;
    }
    if (theirsHit) {
      this.mine.lunge = LUNGE_SECONDS;
    }
    this.lastMine = mineHp;
    this.lastTheirs = theirsHp;
  }

  /** Advances one side. Returns whether it was struck this frame. */
  private step(side: Side, dt: number, hp: number, maxHp: number, last: number): boolean {
    if (side.shown < 0) {
      side.shown = hp;
    }
    let struck = false;
    if (last >= 0 && hp < last) {
      struck = true;
      side.blink = BLINK_SECONDS;
    }
    if (last >= 0 && hp > last) {
      // Healed. No blink and no lunge -- a Potion is not a hit -- but the bar
      // still travels rather than jumping.
      side.blink = 0;
    }
    if (side.lunge > 0) {
      side.lunge -= dt;
      if (side.lunge < 0) {
        side.lunge = 0;
      }
    }
    if (side.blink > 0) {
      side.blink -= dt;
      if (side.blink < 0) {
        side.blink = 0;
      }
    }
    // The bar travels at a fixed rate for a FULL bar, so a scratch takes a
    // moment and a critical hit takes the whole drain. A bar that always took
    // the same time would make every hit look equally bad.
    const perSecond = (maxHp > 0 ? maxHp : 1) / DRAIN_SECONDS;
    const step = perSecond * dt;
    if (side.shown > hp) {
      side.shown = side.shown - step < hp ? hp : side.shown - step;
    } else if (side.shown < hp) {
      side.shown = side.shown + step > hp ? hp : side.shown + step;
    }
    return struck;
  }

  /** The HP the bar should draw: the travelling one, never below zero. */
  shownHp(isMine: boolean): number {
    const side = isMine ? this.mine : this.theirs;
    if (side.shown < 0) {
      return 0;
    }
    return side.shown;
  }

  /**
   * How far this side has lunged, 0 at rest and LUNGE_REACH at full stretch.
   *
   * Out and back on a single hump, so it leaves and arrives at rest with no
   * jump at either end -- a lunge that snaps back reads as a glitch.
   */
  lungeReach(isMine: boolean): number {
    const side = isMine ? this.mine : this.theirs;
    if (side.lunge <= 0) {
      return 0;
    }
    const through = 1 - side.lunge / LUNGE_SECONDS;
    return Math.sin(through * Math.PI) * LUNGE_REACH;
  }

  /** Whether this side's sprite is drawn this frame. False on a blink's off beat. */
  visible(isMine: boolean): boolean {
    const side = isMine ? this.mine : this.theirs;
    if (side.blink <= 0) {
      return true;
    }
    const through = BLINK_SECONDS - side.blink;
    return Math.floor(through * BLINK_RATE) % 2 === 0;
  }

  /** Whether anything is moving, so a caller can skip work when nothing is. */
  isBusy(): boolean {
    return this.mine.lunge > 0 || this.theirs.lunge > 0 ||
           this.mine.blink > 0 || this.theirs.blink > 0;
  }
}
