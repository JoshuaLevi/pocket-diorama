// Stands somewhere with the flat Game Boy screen up, for a capture.
//
// The same extracted cartridge drives two renderings: the diorama, and a
// 160x144 Game Boy screen pinned in the room. Only the second one is hard to
// show, because it looks like a screenshot of a Game Boy unless you can see the
// room behind it -- which no headless test can produce and no glasses recording
// so far contains. This poses the lens for that picture.
//
// Like StandsInAPlace it is a POSE rather than a claim, and it leaves the lens
// standing there, because LEAF resets the scene BEFORE a run and not after. It
// still asserts the one thing that would waste the capture: that the mode
// actually took.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { ScenarioConfig } from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig";
import { PokemonHarness } from "./PokemonHarness";
import { ROW_MODE } from "../play/screen/ViewOptions";

/** A config value, or the fallback when the caller left it alone. */
function text(config: ScenarioConfig, key: string, fallback: string): string {
  if (!config) {
    return fallback;
  }
  const raw = config.get(key);
  return raw === undefined || raw === "" ? fallback : raw;
}

function count(config: ScenarioConfig, key: string, fallback: number): number {
  const raw = text(config, key, "");
  if (raw === "") {
    return fallback;
  }
  const value = Number(raw);
  return isNaN(value) ? fallback : Math.floor(value);
}

@component
export class PoseInGameBoyMode extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();

    const mapId = text(config, "map_id", "PALLET_TOWN");
    const cellX = count(config, "cell_x", 5);
    const cellY = count(config, "cell_y", 6);

    game.assert("the bundle carries " + mapId,
                game.warpTo(mapId, cellX, cellY),
                "testWarp refused " + mapId);
    await game.until(mapId + " to arrive", (s: any) => s.mapId === mapId);
    await game.settleTerrain();

    if (game.state().playMode !== "gameboy") {
      await game.toViewRow(ROW_MODE);
      await game.hold("right");           // two values, so either way flips it
      await game.press("b");              // close the page
    }
    const now = await game.until("the flat screen to come up",
                                 (s: any) => s.playMode === "gameboy");
    game.assert("the player is where he was sent",
                now.cellX === cellX && now.cellY === cellY,
                now.cellX + "," + now.cellY);
  }
}
