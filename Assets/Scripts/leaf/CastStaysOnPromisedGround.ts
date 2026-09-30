// Nobody standing on ground the terrain has promised blinks out while you walk.
//
// The 11 September recordings, at every chunk boundary: the row of chunks
// ahead is queued and built over a frame or two, and everyone standing on it
// vanished and came back ("personages glitchen"). test/npccull.test.mjs pins
// the rule -- a queued chunk is a chunk -- and this measures it on a real walk
// against the terrain the lens is actually drawing, sampled faster than a
// step, because a blink is a between-frames thing that no end-of-step reading
// can see.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { PokemonHarness } from "./PokemonHarness";

/** How far to walk: more than one chunk boundary at every ZOOM rung. */
const STEPS: number = 12;

/** How often the cast is read while walking. A step is 250 ms and more. */
const SAMPLE_MS: number = 50;

@component
export class CastStaysOnPromisedGround extends Scenario {
  async run(): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();
    const where = await game.goToARoute();
    await game.settleTerrain();
    const start = game.state();
    game.assert("the route has a cast to draw", start.castCount > 0,
                where + " has " + start.castCount + " bodies");

    let worst = 0;
    let samples = 0;
    let drawnEver = 0;
    let walking = true;
    // Read the cast WHILE the walk runs; the walk itself only polls for the
    // cell to change.
    const sampler = (async () => {
      while (walking) {
        await sleep(SAMPLE_MS);
        const s = game.state();
        samples++;
        if (s.castHiddenInsideCover > worst) {
          worst = s.castHiddenInsideCover;
        }
        const drawn = s.castCount - s.castHidden;
        if (drawn > drawnEver) {
          drawnEver = drawn;
        }
      }
    })();
    const moved = await game.walkOnward(STEPS);
    walking = false;
    await sampler;

    game.assert("the walk went somewhere", moved >= 4, moved + " steps");
    game.assert("someone was drawn during the walk", drawnEver > 0,
                "castCount " + start.castCount + ", never more than 0 drawn");
    game.assert("nobody standing on promised ground was hidden in " + samples + " samples",
                worst === 0, "worst " + worst + " hidden inside the cover at once");
  }
}
