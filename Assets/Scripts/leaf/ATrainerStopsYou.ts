// A trainer sees you, and he is on the plate when he does it.
//
// The rule itself is arithmetic and lives in test/trainersight.test.mjs, which
// checks all 295 of them without Lens Studio open. This is the half that
// arithmetic cannot reach: whether the player can SEE it happen.
//
// The failure this exists to catch is a specific one and it has happened here
// before. A body can be in exactly the right cell at exactly the right height
// and still be invisible -- drawn outside the built window, hidden behind
// another billboard, or standing on ground the terrain has promised and not
// yet made. When that happens to a trainer who ambushes you, the lens shows a
// message box from nobody and then a fight with nobody, which is far worse
// than no ambush at all.
//
// So: walk into a line of sight and, at the moment he has finished walking up,
// assert he is drawn, enabled, inside the window, and standing on the cell the
// cartridge puts him on -- beside the player, not on top of them.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { ScenarioConfig } from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig";
import { PokemonHarness } from "./PokemonHarness";
import { ZOOM_DEFAULT } from "../world/PlayArea";

/** ROUTE3_YOUNGSTER1 waits on (10,6) looking right, and reaches two cells. */
const TRAINER: string = "ROUTE3_YOUNGSTER1";
const MAP: string = "ROUTE_3";
const START_X: number = 13;
const START_Y: number = 6;
/** Where the player lands, in his line; and where he stops, beside them. */
const SEEN_X: number = 12;
const STOPS_X: number = 11;

/** The cast entry for a name, or null. */
function bodyOf(state: any, name: string): any {
  const cast = state.cast ? state.cast : [];
  for (let i = 0; i < cast.length; i++) {
    if (cast[i].name === name) {
      return cast[i];
    }
  }
  return null;
}

@component
export class ATrainerStopsYou extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();
    // The rung lives in the save, so a scenario that did not ask would be
    // asserting whichever one the last run left behind.
    await game.useZoom(ZOOM_DEFAULT);

    game.assert("the bundle carries " + MAP, game.warpTo(MAP, START_X, START_Y),
                "testWarp refused " + MAP);
    await game.until(MAP + " to build its window",
                     (s: any) => s.mapId === MAP && s.windowTilesX > 0);
    await game.settleTerrain();
    await game.settleTerrain();

    const before = game.state();
    game.assert("the player stands clear of his line",
                before.cellX === START_X && before.cellY === START_Y,
                before.cellX + "," + before.cellY);
    game.assert("and nobody is fighting yet", before.phase !== "battle", before.phase);
    const waiting = bodyOf(before, TRAINER);
    game.assert("the trainer is drawn where he shipped",
                waiting !== null && waiting.cellX === 10 && waiting.cellY === START_Y,
                JSON.stringify(waiting));

    // One step west is one step into his reach.
    await game.walk("left", 1);

    // The mark is sixty frames and the walk is a cell, so this is a wait and
    // not a read. What is waited FOR is his arrival, because that is the frame
    // the claim is about.
    const spotted = await game.until("the youngster to walk up to you",
                                     (s: any) => {
      const body = bodyOf(s, TRAINER);
      return body !== null && body.cellX === STOPS_X && body.cellY === START_Y;
    });

    const him = bodyOf(spotted, TRAINER);
    game.assert("he stopped BESIDE the player, not on them",
                spotted.cellX === SEEN_X && him.cellX === STOPS_X,
                "player " + spotted.cellX + "," + spotted.cellY +
                "  him " + him.cellX + "," + him.cellY);
    game.assert("and he is switched on", him.enabled === true, JSON.stringify(him));
    // The window is in TILES and a cell is two of them; a body whose cell sits
    // outside it is drawn into ground that was never built.
    const tileX = him.cellX * 2;
    const tileZ = him.cellY * 2;
    game.assert("he is inside the built window",
                tileX >= spotted.windowMinTileX && tileX <= spotted.windowMaxTileX &&
                tileZ >= spotted.windowMinTileZ && tileZ <= spotted.windowMaxTileZ,
                "he is at tile " + tileX + "," + tileZ + " and the window is " +
                spotted.windowMinTileX + ".." + spotted.windowMaxTileX + " by " +
                spotted.windowMinTileZ + ".." + spotted.windowMaxTileZ);
    game.assert("and nobody at all is hidden on promised ground",
                spotted.castHiddenInsideCover === 0,
                "" + spotted.castHiddenInsideCover + " of " + spotted.castCount);

    // The player is not turned round to look at him -- TrainerEngage does not
    // do it, so neither does this, and a lens that "helpfully" turned the
    // player would be the kind of small invention that ends up everywhere.
    game.assert("the player is still facing the way they walked",
                spotted.facing === "left", spotted.facing);
  }
}
