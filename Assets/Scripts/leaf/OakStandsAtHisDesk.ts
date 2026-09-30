// Oak, revealed, stands drawn on his own cell at floor height.
//
// 11 September: "ik zag professor oak niet in zijn lab". The log had him
// revealed, placed and enabled, so whatever hid him was in the drawing, not
// the data. This pins the data half in a running lens -- placed at (5,2) on the
// floor, enabled -- and leaves the lens standing in front of him so the preview
// can be captured from a low angle, which is where the report was made from.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { PokemonHarness } from "./PokemonHarness";

@component
export class OakStandsAtHisDesk extends Scenario {
  async run(): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();
    game.assert("the bundle carries Oak's lab", game.warpTo("OAKS_LAB", 5, 3), "testWarp refused");
    game.assert("Oak can be revealed", game.reveal("OAKS_LAB", "OAKSLAB_OAK1", true), "testReveal refused");
    const s = await game.until("Oak to be drawn", (st: any) =>
      st.mapId === "OAKS_LAB" &&
      st.cast.some((c: any) => c.name === "OAKSLAB_OAK1" && c.enabled));
    const oak = s.cast.filter((c: any) => c.name === "OAKSLAB_OAK1")[0];
    game.assert("Oak stands on his cell (5,2)", oak.cellX === 5 && oak.cellY === 2, JSON.stringify(oak));
    game.assert("on the floor, not inside the desk", oak.y >= 0 && oak.y <= 0.5, "y=" + oak.y);
    game.assert("Red faces him from (5,3)", s.cellX === 5 && s.cellY === 3, s.cellX + "," + s.cellY);
    game.assert("nobody in the lab is hidden on promised ground", s.castHiddenInsideCover === 0,
                "" + s.castHiddenInsideCover);
  }
}
