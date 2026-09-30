// The world's edge does not jump while you walk.
//
// Fourth playtest, 11 September: "de game glitched heel de tijd als er een
// nieuwe chunk moet worden geladen". The drawn world was a square of whole
// chunks centred on the player's CHUNK, so it stood still for three steps and
// jumped six tiles. test/viewclip.test.mjs pins the new rule -- the drawn
// world is the view, centred on the player, moved a tile a step -- and this
// reads it off the running lens: the window's width never changes, and the
// player is never more than a tile off its centre, at every sample of a walk
// across more than one chunk boundary.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { PokemonHarness } from "./PokemonHarness";
import { ZOOM_DEFAULT } from "../world/PlayArea";

/** More than one chunk boundary at every rung. */
const STEPS: number = 12;
/** Faster than a step, so a one-frame jump cannot hide between samples. */
const SAMPLE_MS: number = 50;
/**
 * How far off the window's centre the player may read. An even window has
 * no centre tile: the focus sits half a tile past the middle (PlayArea.
 * slideSpan), and a cell is two tiles, so one tile is the honest bound.
 */
const OFF_CENTRE_TILES: number = 1;

@component
export class TheEdgeHoldsStill extends Scenario {
  async run(): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();
    // Ask for the rung rather than inherit it -- the same fix walking-does-not-
    // stall needed, missed here because this one passed by luck for as long as
    // nothing else wrote a rung. The claim below is that the player stays a
    // tile from the window's CENTRE, and that is only true while the window is
    // narrower than the map: at the widest rung the window is the whole of
    // Route 1 and the player walks ten tiles off centre by design. So the rung
    // is not a detail here, it is the difference between the claim and its
    // opposite.
    await game.useZoom(ZOOM_DEFAULT);
    const where = await game.goToARoute();
    await game.settleTerrain();
    const start = game.state();
    game.assert("the window exists", start.windowTilesX > 0 && start.windowTilesZ > 0, where);

    let worstOff = 0;
    let widthChanged = 0;
    let samples = 0;
    let walking = true;
    const sampler = (async () => {
      while (walking) {
        await sleep(SAMPLE_MS);
        const s = game.state();
        samples++;
        if (s.playerOffCentre > worstOff) {
          worstOff = s.playerOffCentre;
        }
        if (s.windowTilesX !== start.windowTilesX || s.windowTilesZ !== start.windowTilesZ) {
          widthChanged++;
        }
      }
    })();
    const moved = await game.walkOnward(STEPS);
    walking = false;
    await sampler;

    game.assert("the walk crossed ground", moved >= 4, moved + " steps");
    game.assert("the window kept its size in every one of " + samples + " samples",
                widthChanged === 0, widthChanged + " samples differed from " +
                start.windowTilesX + "x" + start.windowTilesZ);
    // At a map edge the view slides rather than follows, and the player walks
    // off-centre by design; Route 1 from (5,10) has room on both sides for
    // twelve steps, so this bound is the one the cartridge itself keeps.
    game.assert("the player stayed within a tile of the window's centre",
                worstOff <= OFF_CENTRE_TILES, "worst " + worstOff + " tiles off centre");
  }
}
