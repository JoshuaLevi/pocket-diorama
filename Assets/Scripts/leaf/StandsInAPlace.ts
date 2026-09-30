// Parks the lens in a named place, and stands still there.
//
// The owner asked on 11 September for a picture of every town and every route
// as the CARTRIDGE draws it, beside the same place as THIS LENS draws it, so
// the visual revision has a before and an after rather than an opinion. The
// cartridge half is arithmetic over the bundle and is rendered by a tool in a
// second; this is the other half, and it exists because only a running lens can
// produce it.
//
// So this is less an assertion about the lens than a POSE for one. It warps,
// waits for the terrain to stop building, and returns -- leaving the preview
// standing exactly there, because LEAF resets the scene BEFORE a run and not
// after. The capture is taken by whoever asked for the run.
//
// It still asserts, though, and the assertions are the ones that would
// otherwise waste a capture: that the bundle carries the map at all, that the
// window got built, and that the terrain settled rather than being photographed
// mid-build. A screenshot of a half-built town is worse than no screenshot,
// because it looks like a finding.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { ScenarioConfig } from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig";
import { PokemonHarness } from "./PokemonHarness";
import { ZOOM_TILES_ACROSS } from "../world/PlayArea";

/** A config value, or the fallback when the caller left it alone. */
function text(config: ScenarioConfig, key: string, fallback: string): string {
  if (!config) {
    return fallback;
  }
  const raw = config.get(key);
  return raw === undefined || raw === "" ? fallback : raw;
}

/** The same, read as a number. Anything unparsable is the fallback. */
function count(config: ScenarioConfig, key: string, fallback: number): number {
  const raw = text(config, key, "");
  if (raw === "") {
    return fallback;
  }
  const value = Number(raw);
  return isNaN(value) ? fallback : Math.floor(value);
}

@component
export class StandsInAPlace extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();

    const mapId = text(config, "map_id", "PALLET_TOWN");
    const cellX = count(config, "cell_x", 5);
    const cellY = count(config, "cell_y", 5);
    const rung = count(config, "zoom", -1);

    if (rung >= 0 && rung < ZOOM_TILES_ACROSS.length) {
      await game.useZoom(rung);
    }

    game.assert("the bundle carries " + mapId,
                game.warpTo(mapId, cellX, cellY),
                "testWarp refused " + mapId + " at " + cellX + "," + cellY);

    const arrived = await game.until(mapId + " to build its window",
                                     (s: any) => s.mapId === mapId && s.windowTilesX > 0);
    game.assert("the player stands where he was sent",
                arrived.cellX === cellX && arrived.cellY === cellY,
                "asked " + cellX + "," + cellY +
                " and got " + arrived.cellX + "," + arrived.cellY);

    // Settle twice. The first settle drains the queue the warp raised; a single
    // one can return while the lookahead cover is still reaching for the column
    // the window just uncovered, and that is exactly the half-built edge a
    // capture must not catch.
    await game.settleTerrain();
    const builds = await game.settleTerrain();

    const still = game.state();
    game.assert("nobody in this place is hidden on promised ground",
                still.castHiddenInsideCover === 0,
                "" + still.castHiddenInsideCover + " of " + still.castCount);
    game.assert("the terrain built something to look at",
                builds > 0, "chunkBuilds=" + builds);
  }
}
