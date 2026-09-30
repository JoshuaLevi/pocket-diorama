// The play area is a fixed square with the player in the middle of it, and it
// slides rather than shrinks at a map edge.
//
// Third playtest: "ik wil niet dat gehele routes en towns worden gerendered...
// dus dat de user gefocust in het midden blijft maar dat de wereld om hem
// beweegt." PlayArea.ts proves the rectangle arithmetic in node (59 checks).
// What node cannot see is whether the terrain the lens actually BUILDS is that
// rectangle, and whether the player the wearer actually walks stays inside it.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { PokemonHarness } from "./PokemonHarness";

/**
 * How far past the asked-for span the built window may reach.
 *
 * The view is built out of WHOLE chunks, so it overshoots to the next chunk
 * edge: the default rung asks for 20 and gets three chunks of seven, which is
 * 21, and the widest asks for 40 and gets seven of six, which is 42. Two tiles
 * covers both. See ChunkPlan.
 *
 * The span itself is NOT a constant here. It was, and the scenario then asserted
 * which rung the save happened to be on rather than the thing that is actually
 * claimed: that the window is what the ZOOM row asked for. A previous scenario
 * left the save on the widest rung and this one called a correct 40-tile window
 * a failure.
 */
const SLACK: number = 2;

@component
export class PlayAreaIsASquare extends Scenario {
  async run(): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();
    // On a route, and freshly built. The claim is about the window the terrain
    // builds for the rung it is on, so it has to be measured against a window
    // that was built since the rung was last read.
    await game.goToARoute();
    const start = game.state();

    const spanX = start.windowTilesX;
    const spanZ = start.windowTilesZ;
    const asked = start.zoomAsks;
    const where = start.mapId + " " + spanX + "x" + spanZ + ", ZOOM asks " + asked;

    game.assert("the game is in diorama mode, not on a flat Game Boy screen",
                start.playMode !== "gameboy", "playMode=" + start.playMode);
    game.assert("the window exists at all", spanX > 0 && spanZ > 0, where);
    // A map smaller than the window IS the window -- a bedroom cannot be twenty
    // tiles across -- so this is "the span it asked for, or the whole map".
    game.assert("the window is no wider than the ZOOM rung asks",
                spanX <= asked + SLACK, where);
    game.assert("nor deeper", spanZ <= asked + SLACK, where);

    game.assert("the player is inside their own play area",
                start.playerOffCentre <= spanX / 2,
                "off centre by " + start.playerOffCentre + " of " + (spanX / 2));

    // Now walk, and watch the window travel WITH the player rather than grow.
    // Far enough to cross a chunk boundary: the cover re-anchors in whole
    // chunks of seven tiles at this rung, and a step is two tiles.
    const took = await game.walkOnward(8);
    const after = game.state();
    game.assert("the player could walk at all", took > 0,
                "took " + took + " steps on " + after.mapId);

    game.assert("the window keeps its width while the player walks",
                after.windowTilesX === spanX,
                spanX + " became " + after.windowTilesX);
    game.assert("and its depth", after.windowTilesZ === spanZ,
                spanZ + " became " + after.windowTilesZ);
    game.assert("the player is still inside it",
                after.playerOffCentre <= spanX / 2,
                "off centre by " + after.playerOffCentre);

    // Whether the window MOVES depends on where the player is standing. A map
    // smaller than the window IS the window -- Red's bedroom is 16 tiles across
    // and the play area asks for 20 -- and such a window cannot slide, because
    // there is nowhere for it to slide to. Asserting movement there would be
    // asserting a bug. So the claim is split by which case this run met, and
    // both halves are real.
    const roomToSlide = after.windowTilesX < asked || after.windowTilesZ < asked;
    const moved = after.windowMinTileZ !== start.windowMinTileZ ||
                  after.windowMinTileX !== start.windowMinTileX;
    if (roomToSlide) {
      game.assert("a map smaller than the play area IS the play area, and holds still",
                  !moved, "it moved to " + after.windowMinTileX + "," + after.windowMinTileZ);
    } else {
      game.assert("on a map with room, the world moves under the player", moved,
                  "window still at " + after.windowMinTileX + "," + after.windowMinTileZ);
    }
  }
}
