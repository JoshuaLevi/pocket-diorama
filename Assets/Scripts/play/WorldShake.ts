// The shake a lift gives the world.
//
// Picking a floor in Red does not move the car: both of its warps are
// rewritten and the doors open somewhere else (script/Elevators.ts). What
// tells the player they have travelled is `ShakeElevator` -- the screen jolts
// up and down a couple of pixels for about a second with the lift's own sound
// under it -- and without that the lens simply cut to another floor, which is
// the "liften schudden niet" of the 20 September audit.
//
// On a table the screen is the model, so the model jolts. NOT the plate it
// stands on and not the menus: the wearer's own hands put the plate where it
// is, and a panel of text that jumps is a different thing from a world that
// does. PokemonAR hangs the world, the player and the cast off one node and
// offsets that.
//
// Pure arithmetic over seconds, so test/worldshake.test.mjs can state what a
// jolt looks like without a scene.

/** How long a lift jolts for, in seconds. */
export const ELEVATOR_SHAKE_SECONDS: number = 1.0;

/** Jolts a second. Ten is what a two-pixel scroll at three frames apart is. */
export const SHAKE_HZ: number = 10;

/**
 * How far the world jumps, in tiles, at the start of a jolt.
 *
 * The cartridge shifts the screen by two of its own pixels, and a Game Boy
 * tile is eight of them: a quarter of a tile, which is 0.9 cm on the default
 * 70 cm plate. Enough to feel, small enough that nothing reads as broken.
 */
export const SHAKE_TILES: number = 0.25;

/**
 * A jolt that fades out.
 *
 * `offset()` is a SQUARE wave, not a sine: the hardware scrolls by whole
 * pixels and jumps back, and eased motion reads as a wobble rather than as a
 * machine starting.
 */
export class WorldShake {
  private left: number = 0;
  private total: number = 0;

  /** Starts, or restarts, a jolt of `seconds`. */
  start(seconds: number): void {
    const s = seconds > 0 ? seconds : 0;
    this.total = s;
    this.left = s;
  }

  step(dt: number): void {
    if (this.left <= 0) {
      return;
    }
    this.left -= dt > 0 ? dt : 0;
    if (this.left < 0) {
      this.left = 0;
    }
  }

  running(): boolean {
    return this.left > 0;
  }

  /** The vertical offset this frame, in tiles. Zero when nothing is shaking. */
  offset(): number {
    if (this.left <= 0 || this.total <= 0) {
      return 0;
    }
    const elapsed = this.total - this.left;
    const decay = this.left / this.total;
    const phase = Math.floor(elapsed * SHAKE_HZ * 2) % 2;
    return (phase === 0 ? 1 : -1) * SHAKE_TILES * decay;
  }
}
