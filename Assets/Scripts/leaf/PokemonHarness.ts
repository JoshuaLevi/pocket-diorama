// Reaching the game from a LEAF scenario, and waiting for it to answer.
//
// The lens is one script component on one scene object, "PokemonAR". It is a
// game rather than a panel of buttons, so a scenario does not tap interactables:
// it presses the same D-pad, A, B and START that a controller does, through the
// scripted input source the router already falls back to, and reads the game's
// state back out of testState().
//
// Everything here waits on a CONDITION rather than on a duration. The preview
// runs at roughly 3.5 fps on a 3662-quad map (docs/GETTING-STARTED.md), which is
// twenty times slower than the glasses, so any sleep long enough to be safe here
// is long enough to make a nine-scenario suite unbearable, and any sleep short
// enough to be quick is a flake waiting for a slower machine.

import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { findSceneObjectByName } from "Leaf.lspkg/Utils/common/Utils";
import { ROW_MODE, ROW_ZOOM, VIEW_ROWS } from "../play/screen/ViewOptions";
import { ZOOM_TILES_ACROSS } from "../world/PlayArea";

/** How long any wait may take before it is called a failure, in milliseconds. */
const WAIT_LIMIT_MS: number = 20000;

/** How long one poll waits before looking again. */
const POLL_MS: number = 100;

export class PokemonHarness {
  private game: any = null;

  /** The PokemonAR script component, found once and held. */
  private lens(): any {
    if (this.game) {
      return this.game;
    }
    const object = findSceneObjectByName("PokemonAR");
    if (!object) {
      throw new Error("no scene object named PokemonAR; the lens is not in this scene");
    }
    // `any`, deliberately: the component's own methods are what this reaches
    // for, and ScriptComponent's declared type knows nothing about them.
    const script: any = object.getComponent("Component.ScriptComponent");
    if (!script) {
      throw new Error("PokemonAR carries no ScriptComponent");
    }
    if (typeof script.testState !== "function") {
      throw new Error("PokemonAR has no testState(); the test seam is missing");
    }
    this.game = script;
    return script;
  }

  /**
   * An assertion that says what it was about when it fails.
   *
   * LEAF's own expect() reports "Expected true, received false" and nothing
   * else, which in a scenario with eight checks tells you only that one of them
   * went. This is the same shape the project's node suites use -- a name, a
   * condition and the measured value -- because a failing test whose message you
   * have to reproduce is barely better than no test.
   */
  assert(label: string, ok: boolean, detail: string): void {
    if (!ok) {
      throw new Error(label + (detail ? "  --  " + detail : ""));
    }
  }

  /** Everything the lens will say about itself. See PokemonAR.testState. */
  state(): any {
    return this.lens().testState();
  }

  /** One frame of a button, the way a real press arrives. */
  async press(button: string): Promise<void> {
    if (button !== "a" && button !== "b" && button !== "start" && button !== "select") {
      throw new Error("no such button: " + button);
    }
    this.lens().testInput().press(button);
    await sleep(POLL_MS);
  }

  /**
   * Walks up to `steps` tiles, and stops early at a wall.
   *
   * Returns how many steps actually happened. A blocked step is not a failure --
   * Red's bedroom is furniture and walls, and a scenario that treated a wall as
   * a broken lens would fail everywhere the player is somewhere small. The
   * CALLER decides whether it got far enough, because only the caller knows what
   * it was trying to measure.
   */
  async walk(direction: string, steps: number): Promise<number> {
    const input = this.lens().testInput();
    let taken = 0;
    for (let i = 0; i < steps; i++) {
      const from = this.state();
      input.hold(direction);
      let moved = false;
      // Forty polls, not twenty. The preview runs at roughly 3.5 fps on a
      // 3662-quad map, so two seconds is about seven frames and a step that
      // takes eight reads as a wall.
      for (let frame = 0; frame < 40; frame++) {
        await sleep(POLL_MS);
        const now = this.state();
        if (now.cellX !== from.cellX || now.cellY !== from.cellY ||
            now.mapId !== from.mapId || now.phase !== from.phase) {
          moved = true;
          break;
        }
      }
      if (!moved) {
        break;
      }
      taken++;
    }
    input.hold("");
    await sleep(POLL_MS);
    return taken;
  }

  /**
   * Wanders until the map changes, or gives up and says where it is stuck.
   *
   * Some claims can only be measured on a map with room in it -- a window that
   * is bigger than the map cannot slide, and terrain that is built once cannot
   * be rebuilt -- and a new game starts in Red's bedroom, which is neither. A
   * scenario that measured there would pass by doing nothing, which is the one
   * result worse than failing.
   *
   * It sweeps the four directions in rotation rather than choosing randomly: a
   * scenario has to give the same answer twice or it is not evidence.
   */
  async walkUntilMapChanges(rounds: number): Promise<string> {
    const from = this.state().mapId;
    const ways = ["down", "left", "up", "right"];
    for (let round = 0; round < rounds; round++) {
      for (let w = 0; w < ways.length; w++) {
        // To the WALL, and starting from a different direction each round.
        // Four steps one way and four back is not exploring, it is pacing: the
        // first version of this rocked on the spot for a hundred and twenty
        // steps and reported that Red's bedroom has no door.
        await this.walk(ways[(w + round) % ways.length], 16);
        const now = this.state();
        if (now.mapId !== from) {
          // Warps land the player mid-step; let the new map finish building.
          await this.until("the new map to build its window",
                           (s: any) => s.windowTilesX > 0);
          return this.state().mapId;
        }
      }
    }
    throw new Error("wandered " + rounds + " rounds and never left " + from);
  }

  /**
   * Puts the player on a map with room to walk, and says which one.
   *
   * ROUTE_1 is the map every complaint in the third playtest was made about --
   * "op routes kan ik vaak niet begrijpen waar ik overheen kan lopen", "aan het
   * einde van dat blok duurt het ff" -- so it is where the claims about routes
   * are measured.
   */
  /** Warps as a warp tile would; false if the bundle has no such map. */
  warpTo(mapId: string, cellX: number, cellY: number): boolean {
    return this.lens().testWarp(mapId, cellX, cellY);
  }

  /** The world point over a cell of the current map, for a hand to pinch. */
  cellWorldPosition(cellX: number, cellY: number): vec3 {
    return this.lens().testCellWorldPosition(cellX, cellY);
  }

  /**
   * The tap a pinch produces, at a world point: what DioramaHands hands the
   * lens on release. Not the hand itself -- LEAF's hand rig moves SIK's hand
   * mesh, but in this preview the mesh's keypoints stay where tracking left
   * them (measured 19 September: the index tip read 0,-62,-5 with the hand
   * placed over the town), so the lens saw no hand. The preview agent's
   * puppet pins tracking and does reach it; that path is exercised by hand.
   */
  async pinchAt(point: vec3): Promise<void> {
    this.lens().testPinchAt(point);
    await sleep(POLL_MS);
  }

  /** Reveals or hides a map object as a script's show_object would. */
  reveal(mapId: string, npc: string, visible: boolean): boolean {
    return this.lens().testReveal(mapId, npc, visible);
  }

  async goToARoute(): Promise<string> {
    const ok = this.lens().testWarp("ROUTE_1", 5, 10);
    if (!ok) {
      throw new Error("could not warp to ROUTE_1; the bundle may not carry it");
    }
    const now = await this.until("ROUTE_1 to build its window",
                                 (s: any) => s.mapId === "ROUTE_1" && s.windowTilesX > 0);
    return now.mapId;
  }

  /**
   * Waits until the terrain has stopped building, and answers the count.
   *
   * The terrain builds at most `buildsPerFrame` chunks a frame, so a queue
   * raised by one step drains over several. Reading the counter immediately
   * after a step therefore charges that step with the tail of the one before it,
   * which is a property of the measurement and not of the lens: the first
   * version of this scenario reported a worst step of seven chunks where the
   * simulation had measured three, and the difference was entirely leakage.
   */
  async settleTerrain(): Promise<number> {
    let last = this.state().chunkBuilds;
    let still = 0;
    for (let i = 0; i < 60 && still < 3; i++) {
      await sleep(POLL_MS);
      const now = this.state().chunkBuilds;
      still = now === last ? still + 1 : 0;
      last = now;
    }
    return last;
  }

  /**
   * Walks `steps` tiles that actually go somewhere, and returns how many.
   *
   * Straight on by preference, and never straight back: a walk that tries down,
   * then up, then left, then right ends roughly where it started, and every
   * claim about a world that MOVES under the player then fails against a walk
   * that went nowhere. It has caused that twice, in two different scenarios,
   * which is why it lives here now instead of in either of them.
   */
  async walkOnward(steps: number): Promise<number> {
    const ways = ["down", "right", "up", "left"];
    const opposite = ["up", "left", "down", "right"];
    let lastWay = -1;
    let taken = 0;
    for (let i = 0; i < steps; i++) {
      let got = 0;
      for (let w = 0; w < ways.length && got === 0; w++) {
        const pick = ((lastWay >= 0 ? lastWay : i) + w) % ways.length;
        if (lastWay >= 0 && ways[pick] === opposite[lastWay]) {
          continue;
        }
        got = await this.walk(ways[pick], 1);
        if (got > 0) {
          lastWay = pick;
        }
      }
      if (got === 0) {
        break;
      }
      taken += got;
    }
    return taken;
  }

  /**
   * Polls until `done` is true of the lens's state, or gives up loudly.
   *
   * The message is the thing being waited FOR, so a timeout reads as "waited for
   * the title screen" rather than as "timed out", which is the difference
   * between a report you can act on and one you have to reproduce.
   */
  async until(what: string, done: (state: any) => boolean): Promise<any> {
    let waited = 0;
    while (waited < WAIT_LIMIT_MS) {
      const now = this.state();
      if (done(now)) {
        return now;
      }
      await sleep(POLL_MS);
      waited += POLL_MS;
    }
    const last = this.state();
    throw new Error("waited " + (WAIT_LIMIT_MS / 1000) + "s for " + what +
                    "; phase=" + last.phase +
                    " wizard=" + last.wizard +
                    " boot=" + last.bootPhase +
                    " world=" + last.worldLoaded +
                    " mode=" + last.playMode +
                    " map=" + last.mapId + " at " + last.cellX + "," + last.cellY);
  }

  /**
   * Gets from wherever the lens is to the overworld, pressing what a player
   * presses: through the wizard, through the title, through the boot menu and
   * through whatever text the intro puts up.
   *
   * A and only A. START opens the boot menu from the title but is inert on the
   * wizard's first two pages, and B goes backwards; a single button that always
   * means "yes, go on" is the one that cannot walk the game into a corner.
   *
   * The press budget is large because the preview runs at roughly 3.5 fps on a
   * 3662-quad map and Oak's speech is six pages of text. It is a budget rather
   * than a sleep so a fast machine is not punished for being fast.
   */
  async untilOverworld(): Promise<any> {
    await this.dismissWizard();
    // A, and START only when A has stopped achieving anything.
    //
    // Both buttons are needed -- A answers text and types a letter on the naming
    // grid, and START is the only thing that CONFIRMS a name, so A alone never
    // gets a new game out of the bedroom. But START at the TITLE opens the boot
    // menu, where one of the rows is PLAY MODE, and a harness that sends START
    // on a fixed cadence toggles the whole game into GAME BOY mode: a flat
    // screen, no terrain, and a window of -1 that reads as a slow frame. That is
    // how this loop came to be adaptive rather than rhythmic.
    let stuck = 0;
    let last = "";
    for (let i = 0; i < 240; i++) {
      const now = this.state();
      const here = now.phase + "|" + now.bootPhase + "|" + now.mapId +
                   "|" + now.cellX + "," + now.cellY;
      stuck = here === last ? stuck + 1 : 0;
      last = here;
      if (now.phase === "overworld") {
        // GAME BOY mode draws a flat screen and builds no terrain, so waiting
        // for a window there waits forever. Say so instead. It STICKS, too: the
        // mode lives in the save, so one stray toggle poisons every later run
        // until the save is cleared.
        // A save can carry GAME BOY mode, which draws a flat screen and builds
        // no terrain at all. The OPTION page can now bring it back; before that
        // row existed this was a dead end and the scenario simply hung.
        await this.ensureDioramaMode();
        // Being in the overworld and having a world DRAWN are two different
        // moments: the phase flips when the Overworld is constructed, and the
        // terrain window is built a frame or more later. A scenario that reads
        // the window on the first of those moments reads -1.
        return this.until("the terrain to build its window",
                          (s: any) => s.phase === "overworld" && s.windowTilesX > 0);
      }
      if (stuck >= 8) {
        await this.press("start");
        stuck = 0;
      } else {
        await this.press("a");
      }
    }
    return this.until("the overworld",
                      (s: any) => s.phase === "overworld" && s.windowTilesX > 0);
  }

  /**
   * Clicks through the first-run wizard, the way a wearer does.
   *
   * A and only A: the PLACE page steps to PAD on A and re-aims the diorama on B,
   * the PAD page steps to READY on A and back on B, and READY finishes on A or
   * START. START is inert on the first two, so a scenario that presses START at
   * the wizard waits forever -- which is exactly how this method came to exist.
   */
  async dismissWizard(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const now = this.state();
      if (now.phase !== "wizard") {
        return;
      }
      await this.press("a");
    }
    const last = this.state();
    throw new Error("pressed A twenty times and the wizard stayed on " + last.wizard);
  }

  /**
   * Opens the START menu and puts the cursor on a row, by its LABEL.
   *
   * By label and not by counting: the menu grows as the story does -- POKeMON,
   * ITEM, SAVE, OPTION, EXIT early on, with the Pokedex and the player's own
   * name arriving later -- so a scenario that counted presses would break on the
   * day the player earns a row, and it would break by walking into whatever row
   * had taken the place it counted to.
   */
  async chooseFromMenu(label: string): Promise<void> {
    if (!this.state().menuOpen) {
      await this.press("start");
      await this.until("the START menu", (s: any) => s.menuOpen === true);
    }
    const rows = this.state().menuRows;
    let want = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === label) {
        want = i;
      }
    }
    if (want < 0) {
      throw new Error("no row called " + label + " in the menu; it has " + rows.join(", "));
    }
    for (let guard = 0; guard < rows.length * 2; guard++) {
      const at = this.state().menuCursor;
      if (at === want) {
        await this.press("a");
        return;
      }
      await this.hold(at < want ? "down" : "up");
    }
    throw new Error("could not walk the menu cursor to " + label +
                    "; it stopped at " + this.state().menuCursor + " of " + rows.length);
  }

  /** Puts the OPTION page's cursor on a row index, then leaves it there. */
  async toViewRow(row: number): Promise<void> {
    if (!this.state().viewPageOpen) {
      await this.chooseFromMenu("OPTION");
      await this.until("the OPTION page", (s: any) => s.viewPageOpen === true);
    }
    // Down, always, because the page WRAPS.
    //
    // This used to press `at < row ? "down" : "up"`, which reads like binary
    // search and is not: the cursor walks ROW_ORDER, and ROW_ORDER is not the
    // order the rows are NUMBERED in -- the graphics rows come first as one
    // unbroken run, so TIME is row 6 and sits third. Comparing the numbers can
    // therefore oscillate: aiming for SPEED from TIME steps up to ZOOM, whose
    // number is lower, which steps down to TIME again, until the guard throws.
    // It happened to work for ROW_MODE, the only row the harness asked for.
    //
    // One direction cannot oscillate, and the page wraps, so every row is at
    // most VIEW_ROWS presses away.
    for (let guard = 0; guard <= VIEW_ROWS; guard++) {
      if (this.state().viewCursor === row) {
        return;
      }
      await this.hold("down");
    }
    throw new Error("could not reach view row " + row +
                    "; the cursor stopped at " + this.state().viewCursor);
  }

  /**
   * Puts the game back into diorama mode if a save has it on a flat screen.
   *
   * This exists because the mode is written into the SAVE and, until the OPTION
   * page gained a row for it, could not be changed once a game had started: one
   * stray press on the boot page put a playthrough on a flat screen for good.
   * The harness hit that, which is how the row came to exist.
   */
  async ensureDioramaMode(): Promise<void> {
    if (this.state().playMode !== "gameboy") {
      return;
    }
    await this.toViewRow(ROW_MODE);
    await this.hold("right");             // two values, so either way flips it
    await this.press("b");                // close the page
    await this.until("the world to come back", (s: any) => s.playMode !== "gameboy");
  }

  /**
   * Walks the ZOOM row to a rung, and proves it landed.
   *
   * Every scenario that asserts anything about the WINDOW has to call this,
   * because the rung lives in the SAVE. testState's own note says why: "a
   * scenario that assumed the default rung was really asserting which rung the
   * save happened to be on." That is not hypothetical -- StandsInAPlace poses
   * interiors at rung 0 to frame a small room, and the rung it leaves behind is
   * the rung the next scenario starts on.
   *
   * The row is a ladder that WRAPS, so pressing right enough times reaches
   * every rung from wherever the save left it, and zoomAsks answers in tiles --
   * which makes this the one view setting a scenario can verify rather than
   * hope about.
   */
  async useZoom(rung: number): Promise<void> {
    const want = ZOOM_TILES_ACROSS[rung];
    if (this.state().zoomAsks === want) {
      return;
    }
    await this.toViewRow(ROW_ZOOM);
    for (let guard = 0; guard <= ZOOM_TILES_ACROSS.length; guard++) {
      if (this.state().zoomAsks === want) {
        await this.press("b");
        await this.until("the OPTION page to close",
                         (s: any) => s.viewPageOpen === false);
        return;
      }
      await this.hold("right");
    }
    throw new Error("could not reach ZOOM " + want +
                    "; the row stopped at " + this.state().zoomAsks);
  }

  /** One press of a direction, held for a frame and let go. */
  async hold(direction: string): Promise<void> {
    const input = this.lens().testInput();
    input.hold(direction);
    await sleep(POLL_MS);
    input.hold("");
    await sleep(POLL_MS);
  }

  /** Presses A until the game leaves the state it is in, for text and menus. */
  async pressThrough(what: string, done: (state: any) => boolean): Promise<any> {
    for (let i = 0; i < 60; i++) {
      const now = this.state();
      if (done(now)) {
        return now;
      }
      await this.press("a");
    }
    throw new Error("pressed A sixty times and never reached " + what);
  }
}
