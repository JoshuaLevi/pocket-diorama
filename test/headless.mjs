// The lens without a scene: the same Overworld, PlayLoop and PlayHost the
// headset runs, driven frame by frame from Node.
//
// This is what a playtest drives -- an agent, the PyBoy oracle's comparison,
// a scenario in a test -- and it mirrors PokemonAR.onUpdate's ORDER, because
// the order is where the lens's behaviour lives: a page is acknowledged before
// a script is stepped, a running script owns the frame, the world ticks only
// while a scripted walk is in progress, warps are taken the frame they land.
// Battles are not run here (they have their own harness); a battle that
// starts is recorded and ends at once as a win.

const P = "../Assets/Scripts/play/";
const { Overworld } = await import(P + "Overworld.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const { ANSWER_PENDING, ANSWER_YES, ANSWER_NO } = await import(P + "script/Host.ts");
const { DONE, RUNNING, SUSPENDED } = await import(P + "script/ScriptVM.ts");
const { ScriptedInputSource } = await import(P + "InputSource.ts");
const PlayState = await import(P + "PlayState.ts");
const { NpcMotion } = await import(P + "NpcMotion.ts");
const { NpcWander, isWanderer } = await import(P + "NpcWander.ts");
const { isObjectHidden } = await import("../Assets/Scripts/world/WorldData.ts");
const { EMOTE_FRAMES } = await import("../Assets/Scripts/world/EmoteBubble.ts");
const { DexEntryController } = await import(P + "screen/DexEntryScreen.ts");
const { PictureController } = await import(P + "screen/PictureScreen.ts");
const { screenOf } = await import("./headlessscreen.mjs");

export const FRAME = 1 / 60;

export class HeadlessLens {
  /**
   * `options.state` resumes a save; otherwise a new game at the map and cell
   * given (or the bundle's Pallet Town start), with the intro script running
   * exactly as the lens runs it after NEW GAME.
   */
  constructor(bundle, options) {
    const o = options || {};
    this.bundle = bundle;
    this.pages = [];
    this.rawPages = [];
    this.lines = [];
    this.events = [];
    this.pageWaiting = false;
    this.pageAcked = false;
    this.answerWanted = false;
    this.answerGiven = ANSWER_PENDING;
    this.namingOpen = false;
    this.namingDone = false;
    /** A push_screen DexEntryMenu the VM is suspended on, or null. */
    this.dexEntryController = null;
    this.walkPending = false;
    /** The frame a raised emote comes down on; 0 when none is up. */
    this.emoteUntil = 0;
    this.frameCount = 0;
    this.battles = [];
    /**
     * Every text_sound the scripts asked for, in order.
     *
     * Its own list rather than another `events` entry: a jingle is a detail of
     * a conversation -- where a cartridge text block puts `sound_get_item_1`
     * between two pages -- and a suite reading it wants only the sounds.
     */
    this.sounds = [];
    /** Every music change a script asked for, in order. */
    this.music = [];
    this.random = o.random ? o.random : () => 0.5;
    // Which row a choice list comes back with; -1 (or absent) is a cancel.
    this.choiceAnswer = o.choice;
    // Wanderers, as the lens runs them. `wanderers: false` pins every NPC to
    // its shipped cell, for a scenario that must not depend on random steps.
    this.wanderers = o.wanderers !== false;
    // `noWild: true` keeps wild Pokemon away, as the oracle's Repel does.
    this.noWild = o.noWild === true;
    this.npcMotion = new NpcMotion();
    this.wander = new NpcWander(this.random);

    const mapId = o.mapId ? o.mapId : "PALLET_TOWN";
    const cellX = o.cellX === undefined ? 5 : o.cellX;
    const cellY = o.cellY === undefined ? 6 : o.cellY;
    if (o.state) {
      this.play = o.state;
    } else {
      this.play = PlayState.newPlayState(bundle.romSha1);
      this.play.mapId = mapId;
      this.play.cellX = cellX;
      this.play.cellY = cellY;
    }
    this.input = new ScriptedInputSource();
    this.overworld = new Overworld(bundle, this.play.mapId, this.play.cellX, this.play.cellY, this.random);
    if (this.play.facing) {
      this.overworld.facing = this.play.facing;
    }
    this.overworld.surfing = this.play.surfing === true;
    this.overworld.steps = this.play.steps;
    this.loop = new PlayLoop(bundle, this.play, this.services());
    this.loop.attach(this.overworld);
    this.loop.bindWorld(this.overworld);
    this.overworld.lastMapId = this.play.lastMapId ? this.play.lastMapId : "";
    this.loop.startIntroIfNeeded();
    this.loop.stepped(this.overworld.map.def, this.overworld.cellX, this.overworld.cellY);
  }

  services() {
    const self = this;
    return {
      showLines: (lines) => {
        self.pages.push(lines.join(" "));
        self.rawPages.push(lines.slice());
        // A scrolled box shows its previous bottom line again on top; the
        // stream of lines, like the oracle's, has it once.
        for (let i = 0; i < lines.length; i++) {
          if (i === 0 && self.lines.length > 0 && self.lines[self.lines.length - 1] === lines[0] && lines.length > 1) continue;
          self.lines.push(lines[i]);
        }
        self.events.push("page:" + lines.join(" | "));
        self.pageWaiting = true;
        self.pageAcked = false;
      },
      pageAcknowledged: () => self.pageAcked,
      closeBox: () => {
        self.pageWaiting = false;
        self.answerWanted = false;
        self.answerGiven = ANSWER_PENDING;
      },
      requestAnswer: () => { self.answerWanted = true; self.answerGiven = ANSWER_PENDING; },
      answer: () => self.answerGiven,
      currentMap: () => self.overworld.map.def,
      facePlayer: () => {},
      // Recorded: a scene that turns an NPC -- JIGGLYPUFF spinning to her own
      // song, the rival turning to face you -- has nothing else to show for it.
      faceNpc: (npc, direction) => { self.events.push("faceNpc:" + npc + ":" + direction); },
      npcPose: (npc) => self.npcMotion.pose(npc),
      // No body to draw it over here, but the sixty frames are real: a script
      // that waited under the mark has to wait the same length headless, or
      // the walk that follows it starts on a different frame from the lens.
      emote: (npc, kind) => {
        if (self.emoteUntil === 0) {
          self.events.push("emote:" + npc + ":" + kind);
          self.emoteUntil = self.frameCount + EMOTE_FRAMES;
          return RUNNING;
        }
        if (self.frameCount < self.emoteUntil) { return RUNNING; }
        self.emoteUntil = 0;
        return DONE;
      },
      // The loop has written the toggle; the bodies follow it, as in the lens.
      setNpcRevealed: () => { self.overworld.setReveals(self.loop.reveals()); },
      moveNpc: (npc, path) => self.requestNpcWalk(npc, path),
      movePlayer: (direction, steps) => {
        if (!self.walkPending) {
          self.overworld.walkScripted(direction, steps);
          self.walkPending = true;
          return RUNNING;
        }
        if (self.overworld.isWalkingScripted()) { return RUNNING; }
        self.walkPending = false;
        return DONE;
      },
      facePlayerDir: (direction) => { self.overworld.facing = direction; },
      walkNpc: (npc, direction, steps) => {
        const path = [];
        for (let i = 0; i < steps; i++) path.push(direction);
        return self.requestNpcWalk(npc, path);
      },
      placeNpc: (npc, x, y, facing) => {
        self.npcMotion.place(npc, x, y, facing);
        self.overworld.map.moveObject(npc, x, y);
      },
      moveNpcTo: (npc, x, y) => {
        const shipped = self.shippedCell(npc);
        if (!shipped) return DONE;
        const pose = self.npcMotion.pose(npc);
        return self.requestNpcWalk(npc, self.npcMotion.pathTo(pose ? pose.x : shipped[0], pose ? pose.y : shipped[1], x, y));
      },
      warp: (mapId, warpIndex) => {
        self.overworld.takeWarp({ destMap: mapId, destWarp: warpIndex });
        self.events.push("warp:" + mapId);
      },
      warpTo: (mapId, x, y, facing) => {
        self.overworld.enterMapAt(mapId, x, y, facing);
        self.events.push("warpTo:" + mapId + ":" + x + "," + y);
      },
      openShop: (stock) => self.events.push("shop:" + stock.join(",")),
      shopOpen: () => false,
      // Recorded, not driven: the headless harness has no menu panel, so a PC
      // opens, is noted and logs off at once. pc.test.mjs drives the screen.
      openPc: (kind) => self.events.push("pc:" + kind),
      // A choice list (ChoiceController) with nobody to press the buttons:
      // it answers straight away with whatever the scenario asked for, and
      // -1 -- a cancel -- when it asked for nothing.
      openChoice: (title, labels, notes) => {
        self.events.push("choice:" + title.split("\n")[0] + ":" + labels.join(","));
        // `choiceAnswers` is a queue for a conversation that opens its list
        // more than once (the Badge House loops until CANCEL); `choiceAnswer`
        // is the one standing answer every older scenario uses.
        if (Array.isArray(self.choiceAnswers) && self.choiceAnswers.length > 0) {
          self.choicePick = self.choiceAnswers.shift();
        } else {
          self.choicePick = self.choiceAnswer === undefined ? -1 : self.choiceAnswer;
        }
      },
      choiceOpen: () => false,
      choicePicked: () => (self.choicePick === undefined ? -1 : self.choicePick),
      // Recorded only: PlayLoop's wrapper has already changed the world.
      overrideWarp: (x, y, map, warp) => {
        self.events.push("warpOverride:" + x + "," + y + ">" + map + "#" + warp);
      },
      // Recorded only: there is no world here to jolt, and the floor the car
      // arrives on must not depend on whether anybody watched it travel.
      shakeWorld: (seconds) => self.events.push("shake:" + seconds),
      pcOpen: () => false,
      // Recorded, not driven: the machine is a whole screen and slots.test.mjs
      // drives one directly. Here it opens, is noted, and the player walks off.
      openSlots: (chance) => self.events.push("slots:" + chance),
      slotsOpen: () => false,
      beginTrainerBattle: (t, p) => { self.battles.push(t + "#" + p); self.events.push("battle:" + t + "#" + p); },
      beginStaticBattle: (s, l) => { self.battles.push(s + "@" + l); self.events.push("static:" + s + "@" + l); },
      battleOver: () => true,
      battleWon: () => true,
      battleCaught: () => self.caughtIt === true,
      playCry: (s) => self.events.push("cry:" + s),
      fade: () => DONE,
      // Recorded: a jingle that plays to its end (the arrow tiles, the healing
      // machine) is otherwise invisible to a test.
      playOnce: (track) => { self.sounds.push("once:" + track); return DONE; },
      // Recorded like the jingles: a cutscene that is supposed to run in
      // silence (Bill's cell separator, the Cerulean rival's arrival) can only
      // be checked by what it did to the music.
      playMusic: (track) => self.music.push(track),
      stopMusic: () => self.music.push("stop"),
      playDefaultMusic: () => self.music.push("default"),
      textSound: (name) => self.sounds.push(name),
      frames: () => self.frameCount,
      playerFacing: () => self.overworld.facing,
      playerCell: () => [self.overworld.cellX, self.overworld.cellY],
      blocksChanged: () => {},
      cutTreeAhead: () => self.overworld.cutAhead(),
      startSurf: () => self.overworld.startSurf(),
      activateStrength: () => { self.overworld.strengthActive = true; },
      flyTo: (mapId) => self.overworld.flyTo(mapId),
      lightArea: () => self.overworld.lightArea(),
      // Counted, not drawn: a slide is a run of redraws, and that run is the
      // only trace of it a world without a mesh can leave.
      redrawTerrain: () => self.events.push("redraw"),
      introStage: () => {},
      // A Pokemon's nickname screen: the cartridge opens a keyboard that
      // takes START to leave; until then no box, no lines. Mirrored as a
      // mode so a `talk` ends where the ROM's does. The intro's own naming
      // is answered at once, as before.
      nameEntry: (who) => {
        if (String(who).indexOf("party:") !== 0) return DONE;
        if (!self.namingOpen && !self.namingDone) { self.namingOpen = true; return SUSPENDED; }
        if (self.namingOpen) return SUSPENDED;
        self.namingDone = false;
        // What the lens's applyNamingResult does with the typed name: a test
        // sets `typedName` before closing the screen; "" leaves the old name.
        if (self.typedName) {
          const party = self.play.party;
          const asked = parseInt(String(who).substring("party:".length), 10);
          const index = isNaN(asked) ? party.length - 1 : asked;
          if (index >= 0 && index < party.length) party[index].name = self.typedName;
          self.typedName = "";
        }
        return DONE;
      },
      // push_screen DexEntryMenu: the real DexEntryController, not a
      // simplified stand-in, because how many presses close it is the one
      // thing this join has to get right -- the same widget PokemonAR.ts
      // drives, just never painted.
      dexEntry: (species) => {
        if (!self.dexEntryController) {
          if (!self.bundle.species || !self.bundle.species[species]) return DONE;
          self.dexEntryController = new DexEntryController(self.bundle, species);
          self.events.push("dex:" + species);
          return SUSPENDED;
        }
        if (self.dexEntryController.isOpen()) return SUSPENDED;
        self.dexEntryController = null;
        return DONE;
      },
      // push_screen Picture: the real PictureController, never painted --
      // how many presses close it is what a talk has to get right.
      picture: (key, pages) => {
        if (!self.pictureController) {
          self.pictureController = new PictureController(self.bundle, key, pages);
          self.events.push("picture:" + key);
          for (const lines of pages) { self.rawPages.push(lines); }
          return SUSPENDED;
        }
        if (self.pictureController.isOpen()) return SUSPENDED;
        self.pictureController = null;
        return DONE;
      },
      random: () => self.random(),
    };
  }

  /** The shipped cell of a visible NPC on this map, or null: what the lens's requestNpcWalk asks. */
  shippedCell(npc) {
    const map = this.overworld.map;
    for (const object of map.def.objects) {
      if (object.name === npc && !isObjectHidden(map.def.id, object, this.loop.reveals())) return [object.x, object.y];
    }
    return null;
  }

  requestNpcWalk(npc, path) {
    const shipped = this.shippedCell(npc);
    if (!shipped) return DONE;
    return this.npcMotion.request(npc, shipped[0], shipped[1], path);
  }

  /** Scripted NPC walks and the wanderers' random steps; the bodies follow in the collision map. */
  tickNpcs(dt) {
    const map = this.overworld.map;
    if (this.wanderers) {
      const list = [];
      for (const object of map.def.objects) {
        if (!isWanderer(object) || isObjectHidden(map.def.id, object, this.loop.reveals())) continue;
        const pose = this.npcMotion.pose(object.name);
        list.push({ name: object.name, x: pose ? pose.x : object.x, y: pose ? pose.y : object.y, range: object.range });
      }
      if (list.length > 0) {
        const px = this.overworld.cellX, py = this.overworld.cellY;
        const canStep = (x, y) => map.inBounds(x, y) && map.isWalkable(x, y) && map.warpAt(x, y) === null &&
          map.objectAt(x, y) === null && !(x === px && y === py);
        const frozen = this.loop.isBusy() || this.pageWaiting;
        this.wander.tick(dt, list, this.npcMotion, canStep, frozen);
      }
    }
    this.npcMotion.update(dt);
    for (const name of this.npcMotion.names()) {
      const pose = this.npcMotion.pose(name);
      if (pose) map.moveObject(name, pose.x, pose.y);
    }
  }

  /** One frame, in the lens's order. */
  frame(dt) {
    const step = dt === undefined ? FRAME : dt;
    this.frameCount++;
    this.input.update();
    this.tickNpcs(step);
    const pressedA = this.input.pressedA();
    if (this.namingOpen && this.input.pressedStart()) {
      this.namingOpen = false;
      this.namingDone = true;
    }
    if (this.dexEntryController && pressedA) {
      this.dexEntryController.step(true);
    }
    if (this.pictureController && pressedA) {
      this.pictureController.step(true);
    }
    if (this.pageWaiting) {
      // The cartridge ignores A and B until the page it is printing is
      // complete (tools/oracle, 6 sep): see PlayHost.textReady().
      const textReady = this.loop.textReady();
      if (this.answerWanted) {
        if (pressedA && textReady) this.answerGiven = ANSWER_YES;
        else if (this.input.pressedB() && textReady) this.answerGiven = ANSWER_NO;
      } else if ((pressedA || this.input.pressedB()) && textReady) {
        // A or B turns a page, as on the cartridge.
        this.pageAcked = true;
      }
    }
    if (this.loop.isBusy()) {
      this.loop.update();
      if (this.overworld.isWalkingScripted() || this.overworld.isMoving()) {
        this.overworld.encountersEnabled = false;
        const walked = this.overworld.update(step, this.input);
        const landing = this.loop.afterStep(this.overworld, walked, true);
        if (walked.mapChanged || landing.warped) {
          this.npcMotion.reset(); this.wander.reset();
          this.play.lastMapId = this.overworld.lastMapId;
        }
      }
      return;
    }
    this.pageAcked = false;
    // Talking: A on an idle overworld.
    if (pressedA && !this.pageWaiting) {
      // interact() takes the PLAYER's cell and looks ahead itself, as the lens
      // calls it; handing it the cell ahead talked to whatever stood beyond.
      const ahead = this.overworld.facingCell();
      const counter = this.overworld.map.isCounter(ahead[0], ahead[1]);
      const target = this.loop.interact(this.overworld.map.def, this.overworld.cellX,
                                        this.overworld.cellY, this.overworld.facing, counter,
                                        (object) => this.overworld.map.objectCell(object));
      if (target) {
        this.events.push("talk:" + (target.name || target.kind));
      }
    }
    this.overworld.encountersEnabled = this.noWild ? false : this.loop.encountersAllowed();
    const result = this.overworld.update(step, this.input);
    const outcome = this.loop.afterStep(this.overworld, result, false);
    if (result.mapChanged || outcome.warped) {
      this.npcMotion.reset(); this.wander.reset();
      this.play.lastMapId = this.overworld.lastMapId;
      this.events.push("map:" + this.overworld.mapId);
    }
    if (result.landed) {
      this.loop.stepped(this.overworld.map.def, this.overworld.cellX, this.overworld.cellY);
    }
  }

  frames(n, dt) {
    for (let i = 0; i < n; i++) this.frame(dt);
  }

  /** The 144x160 GAME BOY-mode screen for right now (play/screen/OverworldCanvas.ts, headless).
   * `animPhase` (0..7) reproduces the cartridge's own water/flower animation
   * step, for tools/oracle/compare.mjs --screens; omitted, static tiles. */
  screen(animPhase) {
    return screenOf(this, animPhase);
  }

  /**
   * TEST-ONLY: places every named NPC at an exact cell and facing, bypassing
   * the lens's own wander/script motion entirely -- for a screens scenario
   * that pins NPCs where the ROM's own boot-time RNG already walked them
   * before the scenario's first action (PLAYTEST.md's "GAME BOY mode"
   * section). Never called by production code.
   */
  placeNpcs(list) {
    this.npcMotion.reset();
    for (const p of list) {
      this.npcMotion.face(p.name, p.x, p.y, p.facing);
      this.overworld.map.moveObject(p.name, p.x, p.y);
    }
  }

  /**
   * Holds a direction until `steps` steps have landed, then lets go. Timed
   * holds over-walked by one: a hold that outlived the last landing by a
   * frame started the next step. A wall ends it early, as it does the ROM's.
   */
  walk(direction, steps) {
    const start = this.overworld.steps;
    const limit = Math.ceil((0.11 + 0.26 * steps + 0.6) / FRAME);
    this.input.hold(direction);
    for (let i = 0; i < limit; i++) {
      this.frame();
      if (this.overworld.steps - start >= steps) break;
    }
    this.input.hold("");
    // Let a step in flight land.
    for (let i = 0; i < 20 && this.overworld.isMoving(); i++) this.frame();
    this.settle();
  }

  /**
   * Run frames until map and cell have been still for a second, as the
   * oracle does after every walk: a door exit walks the player one step out
   * on its own, and the next action must not land in the middle of it.
   */
  settle(maxFrames = 360) {
    let last = null, same = 0;
    for (let waited = 0; waited < maxFrames; waited += 8) {
      this.frames(8);
      const now = this.overworld.mapId + ":" + this.overworld.cellX + "," + this.overworld.cellY;
      same = now === last ? same + 1 : 0;
      last = now;
      if (same >= 8) return;
    }
  }

  face(direction) {
    // `face` means turn: facing that way already, a tap would be a step.
    if (this.overworld.facing === direction) { this.frames(10); return; }
    this.input.hold(direction);
    this.frames(2);
    this.input.hold("");
    this.frames(8);
  }

  press(button) {
    this.input.press(button);
    this.frames(12);
  }

  /** Presses A until no page is waiting or the wanted text has shown. */
  text(wanted, max) {
    for (let i = 0; i < (max || 60); i++) {
      if (wanted && this.pages.length > 0 && this.pages[this.pages.length - 1].indexOf(wanted) >= 0) {
        // The words are on screen, but the page holding them may still be
        // printing (letter by letter, at the option's speed) -- wait for it
        // to actually finish, the way the oracle's own text() gives the
        // ROM's page a second once the words appear, so the very next press
        // this action's caller makes is not thrown away on a page still
        // mid-print (tools/oracle, 6 sep).
        let waited = 0;
        while (!this.loop.textReady() && waited < 400) { this.frame(); waited++; }
        break;
      }
      // The first press may open a talk (a ball, a sign), as the oracle's
      // does; after that an idle lens means the text is not coming.
      if (i > 0 && !this.pageWaiting && !this.loop.isBusy()) break;
      this.press("a");
    }
  }

  /**
   * A press of A, then every page it produces; returns the pages shown.
   *
   * Like the oracle's talk(), this waits for a page to go stable before
   * turning it: a press thrown at a page still printing is ignored, same as
   * on the cartridge (tools/oracle, 6 sep), so pressing again immediately
   * would only waste iterations of `maxPages` against a page that has not
   * moved. 400 frames covers a full two-line page at the slowest option.
   */
  talk(maxPages) {
    const rawBefore = this.rawPages.length;
    this.press("a");
    for (let i = 0; i < (maxPages || 40); i++) {
      // A Pokedex data page opens before some talks (a starter ball, a zoo
      // sign): press through it -- one A a page, like the oracle's own
      // dex_page loop -- before looking for the next real page. It is not
      // read here (no letter-by-letter pace exists for a GbCanvas screen,
      // only for PlayHost's own message box), so no wait is needed either.
      while (this.dexEntryController) { this.press("a"); }
      // A picture with its caption is the same kind of screen.
      while (this.pictureController) { this.press("a"); }
      // Give a script time to walk or fade before its next page.
      let waited = 0;
      while (!this.pageWaiting && this.loop.isBusy() && waited < 90) { this.frame(); waited++; }
      if (!this.pageWaiting) break;
      waited = 0;
      while (!this.loop.textReady() && waited < 400) { this.frame(); waited++; }
      this.press("a");
    }
    for (let i = 0; i < 30 && this.loop.isBusy(); i++) this.frame();
    // Built fresh from whatever THIS call showed, deduped against only
    // itself -- like the oracle's own talk(), which starts a new lines_out
    // per call and never backdates a line to a call that did not read it.
    // A page already on screen when talk() started (an earlier action
    // pressed into it but, correctly, could not yet turn a page still
    // printing) is pressed through here, not re-attributed to whichever
    // action first showed it -- the oracle's talk() does the same: its own
    // first press turns that same page without ever having read it either.
    const out = [];
    for (const lines of this.rawPages.slice(rawBefore)) {
      for (const line of lines) {
        if (line && out.slice(-2).indexOf(line) < 0) out.push(line);
      }
    }
    return out;
  }

  /**
   * Presses A through whatever the loop is showing -- waiting for each page
   * to finish printing before pressing into it -- until the script lets go.
   * For unattended dialogue with no particular line to watch for, such as
   * mashing through the boot's intro speech; scenarios with a line to check
   * should use `talk`/`text` instead so a wrong line is still caught.
   */
  clearText(maxFrames) {
    const limit = maxFrames || 4000;
    let waited = 0;
    while (this.loop.isBusy() && waited < limit) {
      if (this.dexEntryController) {
        this.press("a");
        waited += 12;
        continue;
      }
      if (this.pageWaiting) {
        while (!this.loop.textReady() && waited < limit) { this.frame(); waited++; }
      }
      this.press("a");
      waited += 12;
    }
  }

  run(actions) {
    const out = [];
    for (const action of actions) {
      if ("talk" in action) {
        const pages = this.talk(action.max);
        const st = this.state();
        st.action = action;
        st.talkPages = pages;
        out.push(st);
        continue;
      }
      if ("walk" in action) this.walk(action.walk, action.n || 1);
      else if ("face" in action) this.face(action.face);
      else if ("press" in action) this.press(action.press);
      else if ("wait" in action) this.frames(action.wait);
      else if ("text" in action) this.text(action.text, action.max);
      const st = this.state();
      st.action = action;
      out.push(st);
    }
    return out;
  }

  state() {
    const p = this.play;
    const flags = Object.keys(p.flags).filter((k) => p.flags[k] === true).sort();
    return {
      map: this.overworld.mapId,
      x: this.overworld.cellX,
      y: this.overworld.cellY,
      facing: this.overworld.facing,
      player: p.playerName,
      rival: p.rivalName,
      party: p.party.map((m) => ({ species: m.species, level: m.level, hp: m.hp, maxHp: m.maxHp })),
      money: p.money,
      badges: p.badges.filter((b) => b).length,
      bag: p.bag.map((s) => [s.id, s.count]),
      flags: flags,
      pages: this.pages.slice(),
      busy: this.loop.isBusy(),
    };
  }
}
