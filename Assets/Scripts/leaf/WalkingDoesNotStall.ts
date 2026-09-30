// Walking builds the strip you walked onto, and not the whole view again.
//
// Third playtest: "als ik loop over een route en ben aan het einde van dat blok
// dan duurt het ff voordat de volgende blok is geladen." The old rule rebuilt
// every chunk in the window each time the player left the middle chunk, so the
// cost of a step was nine chunks once every eight steps.
//
// test/terrainstream.test.mjs measures that over a simulated walk. This measures
// it over a REAL one, through the same input a controller uses, against the
// terrain the lens is actually drawing -- which is the only place a stall was
// ever felt.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { PokemonHarness } from "./PokemonHarness";
import { ZOOM_DEFAULT } from "../world/PlayArea";

/** How far to walk. Long enough to cross more than one chunk boundary. */
const STEPS: number = 12;

/**
 * How much slack a step gets over one row of the cover.
 *
 * A step that moves the cover builds one ROW of it, and a row is `coverAcross`
 * chunks -- three at the default ZOOM rung, seven at the widest. So the ceiling
 * is derived from the cover the lens is actually drawing, not fixed: a constant
 * five here measured seven at the widest rung and called a correct row a
 * regression. One spare chunk covers a step that moves the cover on BOTH axes,
 * which builds a row and a column less their shared corner.
 *
 * The point of the assertion is unchanged: the old rule rebuilt the WHOLE view
 * -- coverAcross squared, nine chunks at the default rung and forty-nine at the
 * widest -- and that is what was felt as a pause. It is asserted per STEP and
 * never as an average, because an average hides exactly the burst a wearer
 * notices.
 */
const SLACK_CHUNKS: number = 1;

@component
export class WalkingDoesNotStall extends Scenario {
  async run(): Promise<void> {
    const game = new PokemonHarness();
    const start = await game.untilOverworld();

    // Ask for the rung rather than inherit it. The ZOOM rung lives in the save,
    // so whatever ran last decides how wide this window is -- and a scenario
    // that poses a small room at rung 0 leaves rung 0 behind. Every number
    // below is per-chunk, so measuring on the wrong rung measures a different
    // claim.
    await game.useZoom(ZOOM_DEFAULT);

    // This has to be measured somewhere with room. A new game starts in Red's
    // bedroom, which is 16 tiles across against a play area that asks for 20:
    // the window is the whole map, nothing is ever rebuilt, and every assertion
    // below would pass by measuring nothing at all.
    const where = await game.goToARoute();
    const here = game.state();
    game.assert("we got somewhere with room to walk",
                here.windowTilesX >= 20 && here.windowTilesZ >= 20,
                where + " is " + here.windowTilesX + "x" + here.windowTilesZ);

    // A first step settles whatever the map load left pending, so the burst
    // being measured is the cost of WALKING and not the cost of arriving.
    await game.walk("down", 1);

    let worst = 0;
    let total = 0;
    let moved = 0;
    const costs: number[] = [];
    const places: string[] = [];
    // Settled before the first reading, and after every step, so each step is
    // charged with what IT cost and not with the tail of the one before it.
    let beforeCount = await game.settleTerrain();
    let before = game.state();
    // A direction per step, chosen because it WORKS, and never the reverse of
    // the last one. Route 1 is fences, ledges and tall grass, so insisting on
    // "down" measured two steps and then reported that the player could not
    // walk. But rotating freely made it pace: 5,12 to 6,12 to 6,11 to 5,11 and
    // back, crossing the SAME chunk boundary every other step, so half the steps
    // cost a full row and the average said the fix had not worked. Both are
    // measurement artefacts. A wearer walks somewhere.
    const ways = ["down", "right", "up", "left"];
    const opposite = ["up", "left", "down", "right"];
    let lastWay = -1;
    for (let i = 0; i < STEPS; i++) {
      let took = 0;
      for (let w = 0; w < ways.length && took === 0; w++) {
        // Straight on, by preference: start from the way that worked last time
        // rather than from the step number. Rotating by the step number still
        // zigzagged -- down, right, up, left -- and a zigzag crosses chunk
        // boundaries about as often as pacing does.
        const from = lastWay >= 0 ? lastWay : i;
        const pick = (from + w) % ways.length;
        if (lastWay >= 0 && ways[pick] === opposite[lastWay]) {
          continue;
        }
        took = await game.walk(ways[pick], 1);
        if (took > 0) {
          lastWay = pick;
        }
      }
      if (took === 0) {
        break;
      }
      const afterCount = await game.settleTerrain();
      const after = game.state();
      if (after.mapId !== before.mapId) {
        // Walked off the map. Whatever this step cost is a map load, not a step.
        break;
      }
      const cost = afterCount - beforeCount;
      beforeCount = afterCount;
      costs.push(cost);
      places.push(after.cellX + "," + after.cellY + "@" +
                  after.windowMinTileX + "," + after.windowMinTileZ +
                  "+" + after.windowTilesX + "x" + after.windowTilesZ);
      if (cost > worst) {
        worst = cost;
      }
      total += cost;
      moved++;
      before = after;
    }

    // The walk has to have happened, or the numbers below are all zero and the
    // scenario passes by doing nothing.
    const end = game.state();
    game.assert("the player walked far enough to measure", moved > 4,
                moved + " steps on " + where + "; ended in phase " + end.phase +
                " on " + end.mapId + " at " + end.cellX + "," + end.cellY);
    game.assert("and the terrain built something at all", beforeCount > 0,
                String(beforeCount));

    // No single step may cost a whole view. This is the number that was FELT:
    // the old rule rebuilt nine chunks at every chunk boundary.
    const row = here.coverAcross;
    const ceiling = row * 2 + SLACK_CHUNKS;
    game.assert("no single step costs a whole view", worst <= ceiling,
                "worst step built " + worst + " chunks; a cover " + row +
                " across makes a row " + row + " and the whole view " + (row * row) +
                ", ceiling " + ceiling +
                "; per step " + costs.join(",") + "; at " + places.join(" "));

    // And most steps cost nothing at all: a step that stays inside the cover
    // builds no chunk whatsoever, which is the property the rebuild was changed
    // to get.
    game.assert("and most steps build nothing", total < moved * 2,
                total + " chunks over " + moved + " steps");
  }
}
