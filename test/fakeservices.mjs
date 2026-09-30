// A fake of everything outside PlayHost, shared by the suites that drive scripts.
//
// It answers instantly and records. What it does NOT fake is the bundle: the
// caller passes the real cartridge extraction, so a line that does not exist
// fails here rather than on a face.
//
// playloop/mart/trade/legendary each still carry their own older copy of this;
// new suites import this one.

export const DONE = 0;
const RUNNING = 1;
const ANSWER_YES = 1;

export function makeServices(bundle, mapId, opts) {
  const o = opts || {};
  const log = [];
  let answerValue = o.answer === undefined ? ANSWER_YES : o.answer;
  let battleRunning = false;
  const battlesFought = [];
  const staticBattles = [];
  let shopOpenValue = 0;
  let pcOpenValue = 0;
  // A real Overworld the field-move services act on. Null keeps the old
  // behaviour, so the suites written before field moves are untouched.
  let world = o.world ? o.world : null;
  let walkPending = false;
  let frame = 0;
  const revealed = {};
  const services = {
    log,
    revealed,
    battlesFought,
    staticBattles,
    setAnswer: (v) => { answerValue = v; },

    showLines: (lines) => log.push("text:" + lines.join(" ")),
    pageAcknowledged: () => true,
    closeBox: () => log.push("close"),
    answer: () => answerValue,
    requestAnswer: () => log.push("ask"),

    setWorld: (w) => { world = w; },
    currentMap: () => (world ? world.map.def : bundle.maps[mapId]),
    facePlayer: () => log.push("face"),
    faceNpc: (n, d) => log.push("faceNpc:" + n + ":" + d),
    // Nothing in this fake walks, so every NPC is still on its shipped cell.
    npcPose: () => null,
    // Recorded, not timed: this fake has no frame clock to wait on.
    emote: (n, k) => { log.push("emote:" + n + ":" + k); return DONE; },
    setNpcRevealed: (m, n, v) => { revealed[(m || mapId) + ":" + n] = v; log.push("reveal:" + n + ":" + v); },
    // Recorded: a cutscene's choreography is most of what a step trigger does,
    // and "he was placed before he was shown" is the kind of order only the log
    // can show. Nothing here walks -- npcPose stays null -- so the record IS
    // the behaviour as far as this fake is concerned.
    placeNpc: (n, x, y, f) => log.push("place:" + n + ":" + x + "," + y + ":" + f),
    moveNpc: (n, path) => { log.push("move:" + n + ":" + (path || []).join(",")); return DONE; },
    // Drives a real Overworld when one is set, exactly as the lens does: a
    // scripted walk is polled until the steps are taken. Without this the
    // surf dismount "finishes" without the player moving.
    movePlayer: (direction, steps) => {
      log.push("walk:" + direction + ":" + (steps || 1));
      if (!world) { return DONE; }
      if (!walkPending) {
        world.walkScripted(direction, steps || 1);
        walkPending = true;
        return RUNNING;
      }
      if (world.isWalkingScripted()) { return RUNNING; }
      walkPending = false;
      return DONE;
    },
    facePlayerDir: (d) => log.push("facePlayerDir:" + d),
    playerFacing: () => (o.facing ? o.facing : "down"),
    playerCell: () => (o.cell ? o.cell : [0, 0]),
    blocksChanged: (m) => log.push("blocks:" + m),
    walkNpc: () => DONE,
    moveNpcTo: () => DONE,
    playMusic: (t) => log.push("music:" + t),
    stopMusic: () => log.push("music:stop"),
    playDefaultMusic: () => log.push("music:default"),
    textSound: (n) => log.push("sound:" + n),
    warp: (m, w) => log.push("warp:" + m + ":" + w),
    warpTo: (m, x, y) => log.push("warpTo:" + m + ":" + x + "," + y),

    openShop: (stock) => { log.push("shop:" + stock.join(",")); shopOpenValue = o.shopOpenFrames ? o.shopOpenFrames : 0; },
    shopOpen: () => { if (shopOpenValue > 0) { shopOpenValue--; return true; } return false; },

    openPc: (kind) => { log.push("pc:" + kind); pcOpenValue = o.pcOpenFrames ? o.pcOpenFrames : 0; },
    // A choice list answers at once with o.choice, or a cancel.
    openChoice: (title, labels) => { log.push("choice:" + labels.join(",")); },
    choiceOpen: () => false,
    choicePicked: () => (o.choice === undefined ? -1 : o.choice),
    overrideWarp: (x, y, map, warp) => log.push("warpOverride:" + x + "," + y + ">" + map + "#" + warp),
    pcOpen: () => { if (pcOpenValue > 0) { pcOpenValue--; return true; } return false; },
    openSlots: (chance) => { log.push("slots:" + chance); },
    slotsOpen: () => false,

    beginTrainerBattle: (t, p) => {
      battlesFought.push(t + "#" + p);
      log.push("battle:" + t + "#" + p);
      battleRunning = !!o.battleHangs;
    },
    beginStaticBattle: (s, l) => {
      staticBattles.push(s + "@" + l);
      log.push("static:" + s + "@" + l);
      battleRunning = !!o.battleHangs;
    },
    // The catching demonstration: the old man's WEEDLE, or Oak's PIKACHU in
    // Yellow's Pallet Town. Over in the same frame, like the fake battles.
    beginDemoBattle: (species, level, thrower, catches) => {
      log.push("demo:" + species + ":" + level + ":" + thrower + (catches === false ? ":fails" : ""));
      battleRunning = !!o.battleHangs;
    },
    battleOver: () => !battleRunning,
    battleWon: () => (o.won === undefined ? true : o.won),
    battleCaught: () => o.caught === true,

    playCry: (s) => log.push("cry:" + s),
    fade: (d) => { log.push("fade:" + d); return DONE; },
    playOnce: (t) => { log.push("jingle:" + t); return DONE; },
    // Ticks per call so a script's `wait` can finish in a headless run.
    frames: () => frame++,

    cutTreeAhead: () => { log.push("cut"); return world ? world.cutAhead() : true; },
    startSurf: () => { log.push("surf"); if (world) { world.startSurf(); } },
    activateStrength: () => { log.push("strength"); if (world) { world.strengthActive = true; } },
    flyTo: (m) => { log.push("fly:" + m); if (world) { world.flyTo(m); } },
    lightArea: () => { log.push("flash"); if (world) { world.lightArea(); } },
    redrawTerrain: () => log.push("redraw"),

    introStage: (w) => log.push("stage:" + w),
    nameEntry: (w) => { log.push("name:" + w); return DONE; },
    dexEntry: (s) => { log.push("dex:" + s); return DONE; },
    // Half, unless the caller wants a scripted stream: a script that draws a
    // byte (le CHEF's main course, the woman with the SLOWBRO) has branches
    // only a chosen byte can reach.
    random: o.random ? o.random : () => 0.5,
  };
  return services;
}

/** The text lines the fake was shown, in order. */
export function shownText(services) {
  return services.log.filter((l) => l.indexOf("text:") === 0).map((l) => l.substring(5));
}
