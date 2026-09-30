// Dialogue resolution against the real cartridge, and the VM's control flow.
import { readFileSync } from "node:fs";
globalThis.print = (...a) => console.log("  [lens]", ...a);

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: script.test.mjs <bundle.json>"); process.exit(2); }
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
// Every lookup below reads the view the lens would run for THIS bundle: Red's
// tables for Red and Blue, Yellow's overlay and hand ports for Yellow. So a
// Yellow bundle finds Yellow's gaps -- a Red script still in service under it
// naming a line the cartridge does not have -- rather than Red's fixtures.
const { cartridgeVersion } = await import("../Assets/Scripts/world/Cartridge.ts");
const version = cartridgeVersion(bundle.romSha1);
const { portedMaps: redPortedMaps, yellowPortedMaps } =
  await import("../Assets/Scripts/play/script/MapScripts.ts");
/** The hand-written maps in service for this bundle. */
function viewMaps() {
  const out = redPortedMaps().slice();
  if (version === "yellow") {
    for (const m of yellowPortedMaps()) if (out.indexOf(m) < 0) out.push(m);
  }
  return out;
}
/** The transcribed table in service for this bundle: Red's, or Red's under Yellow's overlay. */
function viewTranscribed(ported) {
  const table = JSON.parse(JSON.stringify(ported.transcribedAll()));
  if (version !== "yellow") return table;
  const over = ported.transcribedYellowOverlay();
  for (const m of Object.keys(over)) {
    table[m] = table[m] || { talk: {} };
    for (const k of Object.keys(over[m].talk)) {
      if (over[m].talk[k] === null) delete table[m].talk[k];
      else table[m].talk[k] = over[m].talk[k];
    }
    if (Object.keys(table[m].talk).length === 0) delete table[m];
  }
  return table;
}

const { dialogueFor, paginate, facingTarget, resolveText } =
  await import("../Assets/Scripts/play/script/Dialogue.ts");
const { ScriptVM, DONE, RUNNING, SUSPENDED } =
  await import("../Assets/Scripts/play/script/ScriptVM.ts");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -- " + detail : ""));
  ok ? pass++ : fail++;
}

console.log("\n== Dialogue, from the cartridge ==");
{
  const map = bundle.maps.PALLET_TOWN;
  const girl = map.objects.find((o) => o.name === "PALLETTOWN_GIRL");
  const body = resolveText(bundle, map, girl.text);
  check("the girl in Pallet Town has words", typeof body === "string" && body.length > 0,
        body ? JSON.stringify(body.slice(0, 40)) : "none");
  const d = dialogueFor(bundle, map, girl.text);
  check("they page into a two-line box", d.pages.length > 0 && d.pages.every((p) => p.lines.length <= 2),
        `${d.pages.length} pages`);
  console.log("        " + d.pages.map((p) => p.lines.join(" / ")).join("  |  "));

  const oak = map.objects.find((o) => o.name === "PALLETTOWN_OAK");
  check("Oak is hidden until an event reveals him", oak.hidden === true);

  // A sign is read by facing into it.
  const sign = map.signs[0];
  const target = facingTarget(map, sign.x, sign.y + 1, "up", null);
  check("facing a sign finds it", target && target.kind === "sign", target ? target.name : "nothing");
  check("standing on a target does not find it",
        facingTarget(map, sign.x, sign.y, "up", null) === null ||
        facingTarget(map, sign.x, sign.y, "up", null).textId !== sign.text);

  // Hidden objects cannot be talked to.
  const atOak = facingTarget(map, oak.x, oak.y + 1, "up", null);
  check("a hidden NPC cannot be talked to", atOak === null || atOak.name !== oak.name);

  // The reveal override is the only route from a script's `show` op to a
  // talkable NPC; without it Oak is visible, solid and unaddressable forever.
  const reveal = {};
  reveal[map.id + ":" + oak.name] = true;
  const shownOak = facingTarget(map, oak.x, oak.y + 1, "up", reveal);
  check("and can be once a script reveals it",
        shownOak !== null && shownOak.name === oak.name,
        shownOak ? shownOak.name : "still null");
  const rehidden = {};
  rehidden[map.id + ":" + oak.name] = false;
  check("an override can hide a visible one too",
        facingTarget(map, oak.x, oak.y + 1, "up", rehidden) === null);

  // A wanderer is talked to where she STANDS. Both of Pallet Town's NPCs are
  // WALK sprites; the girl one cell off her shipped cell was mute, and her
  // empty shipped cell still answered (the 29 September LEAF run). The caller
  // says where each object stands now; without that, the shipped cell.
  const walker = map.objects.find((o) => o.name === "PALLETTOWN_GIRL");
  const standing = {};
  standing[walker.name] = [walker.x + 1, walker.y];
  const cellOf = (o) => standing[o.name] ? standing[o.name] : [o.x, o.y];
  const there = facingTarget(map, walker.x + 2, walker.y, "left", null, false, cellOf);
  check("a wanderer who moved is found where she stands",
        there !== null && there.name === walker.name && there.x === walker.x + 1 && there.y === walker.y,
        there ? JSON.stringify(there) : "nothing");
  const shipped = facingTarget(map, walker.x, walker.y + 1, "up", null, false, cellOf);
  check("and not on the cell she shipped on", shipped === null || shipped.name !== walker.name,
        shipped ? shipped.name : "");
  const still = facingTarget(map, walker.x, walker.y + 1, "up", null, false);
  check("without a caller's word she stands where she shipped", still !== null && still.name === walker.name);
}

console.log("\n== Pagination ==");
{
  check("a form feed starts a page", paginate("one\ftwo").length === 2);
  check("two lines fill a page", paginate("a\nb\nc\nd").length === 2);
  check("a scroll behaves as a line break", paginate("a\vb").length === 1);
  // Measured on the cartridge: a three-line text shows lines 1-2, then
  // scrolls to lines 2-3 ("give a nickname / to CHARMANDER?").
  check("a scroll on a full box carries its last line", JSON.stringify(paginate("a\nb\vc").map((p) => p.lines)) === JSON.stringify([["a", "b"], ["b", "c"]]),
        JSON.stringify(paginate("a\nb\vc").map((p) => p.lines)));
  check("two scrolls carry twice", JSON.stringify(paginate("a\nb\vc\vd").map((p) => p.lines)) === JSON.stringify([["a", "b"], ["b", "c"], ["c", "d"]]),
        JSON.stringify(paginate("a\nb\vc\vd").map((p) => p.lines)));
  check("a form feed after a scroll starts clean", JSON.stringify(paginate("a\nb\vc\fd").map((p) => p.lines)) === JSON.stringify([["a", "b"], ["b", "c"], ["d"]]),
        JSON.stringify(paginate("a\nb\vc\fd").map((p) => p.lines)));
  // The Safari PA line and eleven others open with a form feed; the first
  // page used to be a blank box that wanted a keypress.
  check("a body that opens with a form feed has no blank first page",
        paginate("\fWe will call").length === 1 && paginate("\fWe will call")[0].lines[0] === "We will call");
  check("no page ever exceeds two lines",
        paginate("a\nb\nc\nd\ne\nf").every((p) => p.lines.length <= 2));
}

console.log("\n== The VM ==");
{
  const shown = [];
  let frame = 0;
  const flags = {};
  const host = {
    showText: (id) => { shown.push(id); return DONE; },
    ask: (id, flag) => { flags[flag] = true; return DONE; },
    giveItem: (i, n) => shown.push(`give:${i}x${n}`),
    takeItem: () => {},
    hasItem: () => true,
    moveNpc: () => DONE, playerFacing: () => "up",
    faceNpc: () => {},
    facePlayer: () => shown.push("face"),
    showNpc: (m, n, v) => shown.push(`show:${n}:${v}`),
    battleWon: () => true, movePlayer: () => DONE, facePlayerDir: () => {},
    npcPose: () => null, emote: () => DONE,
    walkNpc: () => DONE, moveNpcTo: () => DONE, playMusic: () => {},
    stopMusic: () => {}, playDefaultMusic: () => {}, textSound: () => {},
    givePokemon: () => 0, giveLanded: () => true,

    startTrainerBattle: () => DONE,
    warp: (m) => shown.push(`warp:${m}`), warpTo: (m) => shown.push(`warpTo:${m}`),
    healParty: () => shown.push("heal"),
    playCry: () => {},
    fade: () => DONE, playOnce: () => DONE, call: () => DONE,
    frames: () => frame,
  };

  const vm = new ScriptVM(host, flags);
  vm.start([
    { op: "text", textId: "HELLO" },
    { op: "setFlag", flag: "MET_OAK" },
    { op: "ifFlag", flag: "MET_OAK", then: 4 },
    { op: "text", textId: "SHOULD_BE_SKIPPED" },
    { op: "give", item: "POTION", count: 2 },
    { op: "end" },
  ]);
  vm.update();
  check("the script ran to its end", !vm.isRunning());
  check("the branch was taken", shown.indexOf("SHOULD_BE_SKIPPED") < 0, shown.join(", "));
  check("the flag was set", vm.getFlag("MET_OAK") === true);
  check("the item was given", shown.indexOf("give:POTIONx2") >= 0);

  // walk_npc carries the step count TrainerWalkUpToPlayer computed, and for a
  // trainer who is already adjacent that count is zero. Zero must reach the
  // host as zero: the night of 17 September found the Pewter Gym trainer
  // standing on the player's tile because a falsy zero had become "one step".
  const walked = [];
  const walkHost = Object.assign({}, host, {
    walkNpc: (npc, direction, steps) => { walked.push(npc + ":" + direction + ":" + steps); return DONE; },
  });
  const walker = new ScriptVM(walkHost, {});
  walker.start([
    { op: "walk_npc", npc: "JR", direction: "right", steps: 0 },
    { op: "walk_npc", npc: "JR", direction: "right", steps: 2 },
    { op: "walk_npc", npc: "JR", direction: "right" },
    { op: "end" },
  ]);
  walker.update();
  check("a zero-step walk stays a zero-step walk",
        walked[0] === "JR:right:0", walked.join(", "));
  check("a counted walk keeps its count, and no count means one",
        walked[1] === "JR:right:2" && walked[2] === "JR:right:1", walked.join(", "));

  // A script that blocks must not spin.
  let calls = 0;
  const slowHost = Object.assign({}, host, {
    showText: () => { calls++; return calls > 3 ? DONE : RUNNING; },
  });
  const vm2 = new ScriptVM(slowHost, {});
  vm2.start([{ op: "text", textId: "SLOW" }, { op: "end" }]);
  vm2.update(); check("a blocking command suspends the script", vm2.isRunning(), `${calls} call(s)`);
  vm2.update(); vm2.update(); vm2.update();
  check("and resumes when it finishes", !vm2.isRunning(), `${calls} calls`);

  // A runaway script must stop rather than freeze the lens.
  const vm3 = new ScriptVM(host, {});
  vm3.start([{ op: "jump", to: 0 }]);
  vm3.update();
  check("an endless script is stopped, not spun on", !vm3.isRunning());

  // wait counts frames rather than keeping its own clock.
  const vm4 = new ScriptVM(host, {});
  vm4.start([{ op: "wait", frames: 5 }, { op: "end" }]);
  vm4.update(); check("wait blocks", vm4.isRunning());
  frame = 10; vm4.update();
  check("wait releases once the frames have passed", !vm4.isRunning());
}

console.log("\n== A question sets the condition ==");
{
  // The reference writes `ask` followed straight by a jump, and so do all ten
  // transcribed questions. The VM used to leave the condition alone after an
  // ask, so every one of them branched on the PREVIOUS check -- false at the top
  // of a script -- and the answer was read and ignored.
  const program = [
    { op: "ask", textId: "WANT_IT" },
    { op: "jump_if_false", to: "no" },
    { op: "text", textId: "YES_LINE" },
    { op: "jump", to: "end" },
    { op: "label", name: "no" },
    { op: "text", textId: "NO_LINE" },
  ];
  const drive = (answer) => {
    const shown = [];
    const flags = {};
    const host = {
      showText: (id) => { shown.push(id); return DONE; },
      ask: (id, flag) => { flags[flag] = answer; return DONE; },
      facePlayer: () => {},
    };
    const vm = new ScriptVM(host, flags);
    vm.start(program);
    for (let i = 0; i < 20 && vm.isRunning(); i++) { vm.update(); }
    return { shown, flags };
  };
  const yes = drive(true);
  check("yes takes the yes branch", yes.shown.join(",") === "YES_LINE", yes.shown.join(","));
  const no = drive(false);
  check("no takes the no branch", no.shown.join(",") === "NO_LINE", no.shown.join(","));
  check("an ask without a flag leaves nothing behind in the flag store",
        Object.keys(yes.flags).length === 0 && Object.keys(no.flags).length === 0,
        JSON.stringify(yes.flags));
  const named = [{ op: "ask", textId: "Q", flag: "KEEP_ME" }, { op: "jump_if_false", to: "end" }];
  const flags = {};
  const vm = new ScriptVM({ showText: () => DONE, ask: (id, flag) => { flags[flag] = true; return DONE; } }, flags);
  vm.start(named);
  for (let i = 0; i < 5 && vm.isRunning(); i++) { vm.update(); }
  check("an ask with its own flag keeps it", flags.KEEP_ME === true);
}

console.log("\n== A new program starts with a fresh condition ==");
{
  const shown = [];
  const host = { showText: (id) => { shown.push(id); return DONE; }, facePlayer: () => {} };
  const flags = { SET_ONE: true };
  const vm = new ScriptVM(host, flags);
  vm.start([{ op: "check_flag", flag: "SET_ONE" }]);
  for (let i = 0; i < 5 && vm.isRunning(); i++) { vm.update(); }
  vm.start([{ op: "jump_if_true", to: "end" }, { op: "text", textId: "FRESH" }]);
  for (let i = 0; i < 5 && vm.isRunning(); i++) { vm.update(); }
  check("the previous script's condition does not leak into the next", shown.join(",") === "FRESH", shown.join(","));
}

console.log("\n== Every ball on the ground has a well-formed pickup ==");
{
  const { itemBallScript, FOUND_ITEM_TEXT, NO_ROOM_FOR_ITEM_TEXT } = await import("../Assets/Scripts/play/script/ItemBall.ts");
  const { itemIdOf } = await import("../Assets/Scripts/world/WorldData.ts");
  const { KNOWN_OPS } = await import("../Assets/Scripts/play/script/ScriptVM.ts");
  const { talkScript } = await import("../Assets/Scripts/play/script/MapScripts.ts");
  let balls = 0;
  const bad = [];
  for (const mapId of Object.keys(bundle.maps)) {
    for (const o of bundle.maps[mapId].objects) {
      const item = itemIdOf(o);
      if (!item) { continue; }
      balls++;
      if (!bundle.items[item]) { bad.push(mapId + ":" + o.name + " unknown item " + item); }
      if (talkScript(mapId, o.text, version)) { bad.push(mapId + ":" + o.name + " shadowed by a talk script"); }
      const script = itemBallScript(mapId, o.name, item);
      const labels = script.filter((c) => c.op === "label").map((c) => c.name);
      for (const c of script) {
        if (KNOWN_OPS.indexOf(c.op) < 0) { bad.push(mapId + ":" + o.name + " unknown op " + c.op); }
        if (typeof c.to === "string" && c.to !== "end" && labels.indexOf(c.to) < 0) { bad.push(mapId + ":" + o.name + " bad jump " + c.to); }
      }
    }
  }
  check("there are a hundred-odd balls", balls >= 100, "" + balls);
  check("every pickup is well-formed, unshadowed, and names a real item", bad.length === 0, bad.slice(0, 5).join("; "));
  check("the found and no-room lines exist in the cartridge",
        !!bundle.text[FOUND_ITEM_TEXT] && !!bundle.text[NO_ROOM_FOR_ITEM_TEXT]);
}

console.log("\n== Every step trigger is well-formed ==");
{
  const { stepTriggersFor, requiredRoutines: routines } = await import("../Assets/Scripts/play/script/MapScripts.ts");
  const { KNOWN_OPS } = await import("../Assets/Scripts/play/script/ScriptVM.ts");
  const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
  const bad = [];
  let total = 0;
  for (const mapId of Object.keys(bundle.maps)) {
    const triggers = stepTriggersFor(mapId, version);
    if (triggers.length === 0) { continue; }
    const def = bundle.maps[mapId];
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    for (const t of triggers) {
      total++;
      const where = mapId + " " + t.x + "," + t.y;
      if (t.x !== -1 && t.y !== -1 && !map.canEnter(t.x, t.y)) { bad.push(where + ": cell is not enterable"); }
      if ((t.script.length > 0) === (t.talk !== "")) { bad.push(where + ": exactly one of script/talk"); }
      if (t.talk && !def.objects.some((o) => o.text === t.talk) && !(def.signs || []).some((g) => g.text === t.talk)) { bad.push(where + ": talk key " + t.talk + " is not on the map"); }
      for (const f of t.ifAll.concat(t.unless)) { if (f.indexOf("EVENT_") !== 0) { bad.push(where + ": flag " + f); } }
      const labels = t.script.filter((c) => c.op === "label").map((c) => c.name);
      for (const c of t.script) {
        if (KNOWN_OPS.indexOf(c.op) < 0) { bad.push(where + ": unknown op " + c.op); }
        if (typeof c.to === "string" && c.to !== "end" && labels.indexOf(c.to) < 0) { bad.push(where + ": bad jump " + c.to); }
        if ((c.op === "show_text" || c.op === "text" || c.op === "ask") && typeof c.textId === "string" && c.textId.charAt(0) === "_" && !bundle.text[c.textId]) { bad.push(where + ": no such text " + c.textId); }
        if (c.op === "call" && routines().indexOf(c.routine) < 0) { bad.push(where + ": routine " + c.routine + " not in the contract"); }
      }
    }
  }
  check("there are step triggers", total >= 10, "" + total);
  check("every trigger sits on an enterable cell, names one program, real flags, real lines and known ops",
        bad.length === 0, bad.slice(0, 6).join("; "));
}

console.log("\n== A refused gift stops the script ==");
{
  // Nine transcribed scripts give an item and set a flag with nothing in
  // between. The reference halts on a full bag; the VM used to carry on and
  // burn the gift.
  const shown = [];
  const flags = {};
  let room = false;
  const host = {
    showText: (id) => { shown.push(id); return DONE; },
    facePlayer: () => {},
    giveItem: () => room,
  };
  const program = [
    { op: "give_item", item: "HM_CUT", count: 1, noRoom: "_SSAnneCaptainsRoomCaptainHM01NoRoomText" },
    { op: "set_flag", flag: "EVENT_GOT_HM01" },
    { op: "text", textId: "THANKS" },
  ];
  const vm = new ScriptVM(host, flags);
  vm.start(program);
  for (let i = 0; i < 10 && vm.isRunning(); i++) { vm.update(); }
  check("a full bag shows the script's own no-room line and nothing after it",
        shown.join(",") === "_SSAnneCaptainsRoomCaptainHM01NoRoomText" && flags.EVENT_GOT_HM01 !== true && !vm.isRunning(), shown.join(","));
  room = true;
  const vm2 = new ScriptVM(host, flags);
  shown.length = 0;
  vm2.start(program);
  for (let i = 0; i < 10 && vm2.isRunning(); i++) { vm2.update(); }
  check("with room the gift lands, the flag follows and the thanks are said", shown.join(",") === "THANKS" && flags.EVENT_GOT_HM01 === true, shown.join(","));
  const vm3 = new ScriptVM({ showText: (id) => { shown.push(id); return DONE; }, facePlayer: () => {}, giveItem: () => false }, {});
  shown.length = 0;
  vm3.start([{ op: "give_item", item: "POTION" }, { op: "text", textId: "AFTER" }]);
  for (let i = 0; i < 10 && vm3.isRunning(); i++) { vm3.update(); }
  check("without a line of its own the cartridge's general one is used", shown.join(",") === "_NoMoreRoomForItemText", shown.join(","));
}

console.log("\n== A trainer battle names its roster ==");
{
  // OPP_LASS has eighteen rosters. The party index used to be dropped between
  // the reference and the host, and every scripted battle fought roster 1.
  const fought = [];
  const host = {
    showText: () => DONE, facePlayer: () => {},
    startTrainerBattle: (t, p) => { fought.push(t + "#" + p); return DONE; },
  };
  const vm = new ScriptVM(host, {});
  vm.start([{ op: "start_battle", trainer: "OPP_LASS", party: 17 }, { op: "start_battle", trainer: "OPP_BROCK" }]);
  for (let i = 0; i < 10 && vm.isRunning(); i++) { vm.update(); }
  check("the party index reaches the host", fought[0] === "OPP_LASS#17", fought.join(","));
  check("and defaults to the first roster", fought[1] === "OPP_BROCK#1", fought.join(","));
}

console.log("\n== The assembly shape the ports use ==");
{
  const shown = [];
  const flags = { EVENT_GOT_STARTER: true };
  const host = {
    showText: (id) => { shown.push(id); return DONE; },
    ask: () => DONE, giveItem: () => {}, takeItem: () => {}, hasItem: () => false,
    moveNpc: () => DONE, faceNpc: () => {}, facePlayer: () => shown.push("face"),
    showNpc: () => {}, startTrainerBattle: () => DONE, warp: () => {}, warpTo: () => {},
    battleWon: () => true, movePlayer: () => DONE, facePlayerDir: () => {},
    npcPose: () => null, emote: () => DONE,
    walkNpc: () => DONE, moveNpcTo: () => DONE, playMusic: () => {},
    stopMusic: () => {}, playDefaultMusic: () => {}, textSound: () => {},
    givePokemon: () => 0, giveLanded: () => true,

    healParty: () => {}, playCry: () => {}, frames: () => 0,
    fade: () => DONE, playOnce: () => DONE, call: () => DONE,
  };
  // Pallet Town's Oak, transcribed from the reference port: he says one thing
  // before you have a starter and another after.
  const oak = [
    { op: "face_player" },
    { op: "check_flag", flag: "EVENT_GOT_STARTER" },
    { op: "jump_if_true", to: 5 },
    { op: "show_text", textId: "_PalletTownOakHeyWaitDontGoOutText" },
    { op: "jump", to: "end" },
    { op: "show_text", textId: "_PalletTownOakItsUnsafeText" },
  ];
  const vm = new ScriptVM(host, flags);
  vm.start(oak); vm.update();
  check("Oak turns to face you", shown.indexOf("face") === 0);
  check("with a starter he says it is unsafe",
        shown.indexOf("_PalletTownOakItsUnsafeText") >= 0, shown.join(", "));
  check("and not the other line",
        shown.indexOf("_PalletTownOakHeyWaitDontGoOutText") < 0);

  const shown2 = [];
  const host2 = Object.assign({}, host, { showText: (id) => { shown2.push(id); return DONE; } });
  const vm2 = new ScriptVM(host2, {});
  vm2.start(oak); vm2.update();
  check("without one he tells you to wait",
        shown2.indexOf("_PalletTownOakHeyWaitDontGoOutText") >= 0, shown2.join(", "));
  check("jump to end stops the script", !vm2.isRunning());
}

console.log("\n== The ported maps ==");
{
  const { KNOWN_OPS } = await import("../Assets/Scripts/play/script/ScriptVM.ts");
  const { talkScript, portedMaps } = await import("../Assets/Scripts/play/script/MapScripts.ts");
  console.log("        ported: " + viewMaps().join(", ") + (version === "yellow" ? "  (Yellow view)" : ""));

  // Every text id a ported script talks about must exist on that map, or the
  // script is wired to something that is not there.
  let dangling = [];
  const dead = [];
  for (const mapId of viewMaps()) {
    const map = bundle.maps[mapId];
    if (!map) { dangling.push(`${mapId}: not in bundle`); continue; }
    const ids = [];
    for (const o of map.objects) if (o.text) ids.push(o.text);
    for (const g of map.signs || []) if (g.text) ids.push(g.text);
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk)) {
      if (ids.indexOf(key) < 0) {
        // A Red set still in service under Yellow may key an NPC Yellow does
        // not have (the hideout's third Rocket, replaced by Jessie and
        // James). Nothing can ever talk to that key, so it is dead rather
        // than wrong; it is named so the port can be finished, not failed.
        if (version === "yellow" && yellowPortedMaps().indexOf(mapId) < 0) { dead.push(`${mapId}.${key}`); }
        else dangling.push(`${mapId}.${key}`);
      }
    }
  }
  check("every ported script is wired to a real object", dangling.length === 0, dangling.join("; "));
  if (dead.length > 0) console.log("        dead under " + version + " (no such object): " + dead.join(", "));

  // And every text label a script shows must exist in the text table -- under
  // the name the script uses, or the name this cartridge spells it with.
  const { textLabelFor } = await import("../Assets/Scripts/play/script/TextAliases.ts");
  let missingText = [];
  for (const mapId of viewMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk)) {
      if (dead.indexOf(`${mapId}.${key}`) >= 0) continue;
      for (const cmd of set.talk[key]) {
        if (cmd.op === "show_text" && cmd.textId && cmd.textId.startsWith("_")) {
          if (bundle.text[textLabelFor(bundle, cmd.textId)] === undefined) missingText.push(cmd.textId);
        }
      }
    }
  }
  check("every line a script shows exists in the cartridge", missingText.length === 0,
        missingText.join(", "));

  // No ported script may use an op the VM does not implement. An unknown op is
  // skipped at runtime with a print, which means a script carries on past a
  // hide_object that never happened -- a working script with a wrong world.
  const unknownOps = [];
  const scanOps = (label, prog) => {
    prog.forEach((cmd, i) => {
      if (KNOWN_OPS.indexOf(cmd.op) < 0) unknownOps.push(`${label}[${i}] ${cmd.op}`);
    });
  };
  for (const mapId of viewMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk)) scanOps(`${mapId}.${key}`, set.talk[key]);
  }
  scanOps("OAK_SPEECH", (await import("../Assets/Scripts/play/script/MapScripts.ts")).OAK_SPEECH);
  check("every op a ported script uses is implemented",
        unknownOps.length === 0, unknownOps.join("; "));

  // A named jump must name a label that exists in its own program.
  const badLabels = [];
  const scanLabels = (label, prog) => {
    const names = prog.filter((c) => c.op === "label").map((c) => c.name);
    prog.forEach((cmd, i) => {
      if (typeof cmd.to === "string" && cmd.to !== "end" && names.indexOf(cmd.to) < 0)
        badLabels.push(`${label}[${i}] -> ${cmd.to}`);
    });
  };
  for (const mapId of viewMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk)) scanLabels(`${mapId}.${key}`, set.talk[key]);
  }
  check("every named jump has a label to land on", badLabels.length === 0,
        badLabels.join("; "));

  // Jump targets must be inside the program.
  let badJumps = [];
  for (const mapId of viewMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk)) {
      const prog = set.talk[key];
      prog.forEach((cmd, i) => {
        if (typeof cmd.to === "number" && (cmd.to < 0 || cmd.to >= prog.length))
          badJumps.push(`${mapId}.${key}[${i}] -> ${cmd.to}`);
      });
    }
  }
  check("no jump leaves its program", badJumps.length === 0, badJumps.join("; "));

  // The transcribed maps get every structural check the hand-written ones do.
  // They were machine-translated from a reference whose jump targets are
  // one-based and whose arguments are positional, so "it parsed" is not evidence
  // of anything: a mistranslated target lands inside the program and runs the
  // wrong command.
  const T = viewTranscribed(await import("../Assets/Scripts/play/script/PortedMaps.ts"));
  const tMaps = Object.keys(T);
  const tBad = [];
  let tScripts = 0;
  for (const mapId of tMaps) {
    const map = bundle.maps[mapId];
    if (!map) { tBad.push(`${mapId}: not in bundle`); continue; }
    const ids = new Set();
    for (const o of map.objects) if (o.text) ids.add(o.text);
    for (const g of map.signs || []) if (g.text) ids.add(g.text);
    for (const key of Object.keys(T[mapId].talk)) {
      tScripts++;
      const prog = T[mapId].talk[key];
      if (!ids.has(key)) tBad.push(`${mapId}.${key}: no object points at it`);
      const names = prog.filter((c) => c.op === "label").map((c) => c.name);
      prog.forEach((cmd, i) => {
        const where = `${mapId}.${key}[${i}]`;
        if (KNOWN_OPS.indexOf(cmd.op) < 0) tBad.push(`${where}: unknown op ${cmd.op}`);
        if (typeof cmd.to === "number" && (cmd.to < 0 || cmd.to >= prog.length))
          tBad.push(`${where}: jump ${cmd.to} outside a ${prog.length}-command script`);
        if (typeof cmd.to === "string" && cmd.to !== "end" && names.indexOf(cmd.to) < 0)
          tBad.push(`${where}: no label ${cmd.to}`);
        if ((cmd.op === "show_text" || cmd.op === "ask") && typeof cmd.textId === "string" &&
            cmd.textId.startsWith("_") && bundle.text[cmd.textId] === undefined)
          tBad.push(`${where}: no text ${cmd.textId}`);
        if (cmd.op === "warp") {
          // A transcribed warp names a CELL. Reading its x as a warp index --
          // which the first version of the transcriber did -- lands the player
          // on whatever warp happens to sit at that number, and only one of the
          // nine was out of range enough to notice.
          const dest = bundle.maps[cmd.map];
          if (!dest) tBad.push(`${where}: no map ${cmd.map}`);
          else if (typeof cmd.x === "number" &&
                   (cmd.x < 0 || cmd.x >= dest.width * 2 ||
                    cmd.y < 0 || cmd.y >= dest.height * 2))
            tBad.push(`${where}: cell ${cmd.x},${cmd.y} outside ${cmd.map}`);
        }
        if ((cmd.op === "hide_object" || cmd.op === "show_object" ||
             cmd.op === "face_object" || cmd.op === "walk_npc" || cmd.op === "move_npc_to")) {
          const onMap = bundle.maps[cmd.map || mapId];
          if (!onMap) tBad.push(`${where}: no map ${cmd.map}`);
          else if (typeof cmd.npc === "string" &&
                   !onMap.objects.some((o) => o.name === cmd.npc))
            tBad.push(`${where}: ${cmd.map || mapId} has no ${cmd.npc}`);
        }
        if (cmd.op === "start_battle" && cmd.trainer &&
            (!bundle.trainers || !bundle.trainers[cmd.trainer]))
          tBad.push(`${where}: no roster for ${cmd.trainer}`);
        if ((cmd.op === "give_pokemon" || cmd.op === "mark_seen" || cmd.op === "play_cry") &&
            cmd.species && !bundle.species[cmd.species])
          tBad.push(`${where}: no species ${cmd.species}`);
      });
    }
  }
  check(`every transcribed script resolves (${tMaps.length} maps, ${tScripts} scripts)`,
        tBad.length === 0, tBad.slice(0, 8).join("; ") +
        (tBad.length > 8 ? ` ... and ${tBad.length - 8} more` : ""));
  check("the transcription actually produced something",
        tMaps.length >= 40 && tScripts >= 70, `${tMaps.length} maps, ${tScripts} scripts`);

  // A warp must name a map this bundle has and a warp index that exists on it.
  // destWarp is 1-based; a 0 lands on index -1 and drops the player on cell
  // (0,0), which is usually inside a wall.
  const badWarps = [];
  const scanWarps = (label, prog) => {
    prog.forEach((cmd, i) => {
      if (cmd.op !== "warp") return;
      const dest = bundle.maps[cmd.map];
      if (!dest) { badWarps.push(`${label}[${i}] -> no map ${cmd.map}`); return; }
      if (typeof cmd.x === "number" && typeof cmd.y === "number") {
        // A warp by cell, as the cartridge's scripted warps are: it must land
        // inside the map. Width and height are in blocks of two cells.
        if (!(cmd.x >= 0 && cmd.y >= 0 && cmd.x < dest.width * 2 && cmd.y < dest.height * 2))
          badWarps.push(`${label}[${i}] -> ${cmd.map} cell ${cmd.x},${cmd.y} outside ${dest.width * 2}x${dest.height * 2}`);
        return;
      }
      if (!(cmd.warp >= 1 && cmd.warp <= dest.warps.length))
        badWarps.push(`${label}[${i}] -> ${cmd.map} warp ${cmd.warp} of ${dest.warps.length}`);
    });
  };
  for (const mapId of viewMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk)) scanWarps(`${mapId}.${key}`, set.talk[key]);
  }
  scanWarps("OAK_SPEECH", (await import("../Assets/Scripts/play/script/MapScripts.ts")).OAK_SPEECH);
  check("every warp names a map and a warp that exist", badWarps.length === 0,
        badWarps.join("; "));

  // Victories.ts is transcribed from gen1recomp's victories.lua and names text
  // labels, maps and objects that live in the cartridge. A re-bake that dropped
  // one would show up as a leader who hands over nothing, silently.
  const { victoryFor, victoryKeys } =
    await import("../Assets/Scripts/play/battle/Victories.ts");
  const vBad = [];
  for (const key of victoryKeys()) {
    const hash = key.indexOf("#");
    const win = victoryFor(key.substring(0, hash), Number(key.substring(hash + 1)));
    for (const field of ["dialogue", "tmPre", "tmDialogue"]) {
      for (const label of win[field]) {
        if (bundle.text[label] === undefined) vBad.push(`${key}.${field}: ${label}`);
      }
    }
    if (win.noRoom && bundle.text[win.noRoom] === undefined)
      vBad.push(`${key}.noRoom: ${win.noRoom}`);
    for (const pair of win.hide) {
      const map = bundle.maps[pair[0]];
      if (!map) { vBad.push(`${key}.hide: no map ${pair[0]}`); continue; }
      if (!map.objects.some((o) => o.name === pair[1]))
        vBad.push(`${key}.hide: ${pair[0]} has no ${pair[1]}`);
    }
  }
  check(`every victory reward resolves (${victoryKeys().length} bosses)`,
        vBad.length === 0, vBad.join("; "));
  check("and Brock's reward is the TM item, not the flag name",
        victoryFor("OPP_BROCK", 1).item === "TM_BIDE" &&
        victoryFor("OPP_BROCK", 1).gotFlag === "EVENT_GOT_TM34",
        JSON.stringify(victoryFor("OPP_BROCK", 1)));

  // Run Pallet Town's Oak both ways against the real text.
  const seen = [];
  const mkHost = (out) => ({
    playerFacing: () => "up",  // a starter ball answers only when faced from below
    showText: (id) => { out.push(bundle.text[id] ? bundle.text[id].split("\n")[0] : id); return DONE; },
    ask: () => DONE, giveItem: () => {}, takeItem: () => {}, hasItem: () => false,
    moveNpc: () => DONE, faceNpc: () => {}, facePlayer: () => {}, showNpc: () => {},
    startTrainerBattle: () => DONE, warp: () => {}, warpTo: () => {}, healParty: () => out.push("healed"),
    battleWon: () => true, movePlayer: () => DONE, facePlayerDir: () => {},
    npcPose: () => null, emote: () => DONE,
    walkNpc: () => DONE, moveNpcTo: () => DONE, playMusic: () => {},
    stopMusic: () => {}, playDefaultMusic: () => {}, textSound: () => {},
    givePokemon: () => 0, giveLanded: () => true,
    markSeen: () => {}, pushScreen: () => DONE,

    playCry: () => {}, fade: () => DONE, playOnce: () => DONE,
    call: (r) => { out.push("call:" + r); return DONE; }, frames: () => 0,
  });
  const vmA = new ScriptVM(mkHost(seen), {});
  vmA.start(talkScript("PALLET_TOWN", "TEXT_PALLETTOWN_OAK", version)); vmA.update();
  check("Oak's pre-starter line comes from the cartridge",
        seen.length === 1 && seen[0].indexOf("Hey") >= 0, JSON.stringify(seen));

  const seen2 = [];
  const vmB = new ScriptVM(mkHost(seen2), { EVENT_GOT_STARTER: true });
  vmB.start(talkScript("PALLET_TOWN", "TEXT_PALLETTOWN_OAK", version)); vmB.update();
  check("and his post-starter line differs", seen2.length === 1 && seen2[0] !== seen[0],
        JSON.stringify(seen2));

  const seen3 = [];
  const vmC = new ScriptVM(mkHost(seen3), { EVENT_GOT_STARTER: true });
  vmC.start(talkScript("REDS_HOUSE_1F", "TEXT_REDSHOUSE1F_MOM", version)); vmC.update();
  check("Mom heals you once you have a starter", seen3.indexOf("healed") >= 0,
        JSON.stringify(seen3));

  // -- the first badge -------------------------------------------------------
  //
  // The structural checks above pass on a script whose BRANCHES are all wrong:
  // every id can exist and every jump land inside the program while the gym
  // still hands out two badges or none. These run the branches.

  const run = (mapId, textId, flags, host) => {
    const out = [];
    const h = host ? host(out) : mkHost(out);
    const vm = new ScriptVM(h, flags);
    vm.start(talkScript(mapId, textId, version));
    for (let i = 0; i < 200 && vm.isRunning(); i++) vm.update();
    return { out, running: vm.isRunning(), flags };
  };
  const battleHost = (out) => {
    const h = mkHost(out);
    h.startTrainerBattle = (t) => { out.push("battle:" + t); return DONE; };
    h.giveItem = (i) => out.push("give:" + i);
    // Recorded so the jingle's PLACE can be asserted and not just its presence.
    h.textSound = (n) => out.push("sound:" + n);
    return h;
  };

  const brockFirst = run("PEWTER_GYM", "TEXT_PEWTERGYM_BROCK", {}, battleHost);
  check("Brock fights before he hands anything over",
        brockFirst.out.indexOf("battle:OPP_BROCK") > 0, JSON.stringify(brockFirst.out));
  // The badge and EVENT_BEAT_BROCK are NOT the script's job any more: they come
  // from Victories.ts when the battle is won, which this stub host does not do.
  // playloop.test.mjs owns those, driving the real PlayHost. What the SCRIPT
  // still owes is the offer of the TM through the routine that can refuse it.
  check("and the badge lines are shown between the battle and the TM",
        brockFirst.out.some((l) => l.indexOf("I took") >= 0) &&
        brockFirst.out.indexOf("call:give_tm") > 0,
        JSON.stringify(brockFirst.out));
  check("the TM is offered through the host routine, not given blind",
        brockFirst.out.indexOf("call:give_tm") >= 0, JSON.stringify(brockFirst.out));
  // PewterGymBrockReceivedBoulderBadgeText is ONE text: the badge line, then
  // sound_level_up, then the badge information. The jingle rings between the
  // two pages, not in front of them.
  const badgeAt = brockFirst.out.findIndex((l) => l.indexOf("I took") >= 0);
  const infoAt = brockFirst.out.findIndex((l) => l.indexOf("That's an official") >= 0);
  const levelUpAt = brockFirst.out.indexOf("sound:Level_Up");
  check("the badge jingle rings between the badge line and its explanation",
        badgeAt >= 0 && levelUpAt === badgeAt + 1 && infoAt === levelUpAt + 1,
        JSON.stringify(brockFirst.out));
  // The TM's own jingle is not in this run: the stub's give_tm never sets
  // gotFlag, so the script takes the no-room branch. What IS asserted is that
  // the badge does not ring the item jingle, which is what it used to do.
  check("and it is the cartridge's sound_level_up, not the item jingle",
        levelUpAt >= 0 && brockFirst.out.indexOf("sound:Get_Item1") < 0,
        JSON.stringify(brockFirst.out));
  // PewterGymScriptReceiveTM34 ends after the TM lines. The advice belongs to
  // PewterGymBrockText's beaten-and-has-TM branch and to nothing else, so
  // saying it here printed a page too many at the moment of winning -- and
  // then the same page again on the very next talk.
  check("and he does not give the advice at the moment of victory",
        !brockFirst.out.some((l) => l.indexOf("There are all") >= 0),
        JSON.stringify(brockFirst.out));

  const brockAgain = run("PEWTER_GYM", "TEXT_PEWTERGYM_BROCK",
                         { EVENT_BEAT_BROCK: true, EVENT_GOT_TM34: true }, battleHost);
  check("a beaten Brock does not fight again",
        brockAgain.out.indexOf("battle:OPP_BROCK") < 0, JSON.stringify(brockAgain.out));
  check("and THAT is where the advice is said",
        brockAgain.out.some((l) => l.indexOf("There are all") >= 0),
        JSON.stringify(brockAgain.out));
  check("and does not hand out a second badge",
        brockAgain.out.indexOf("give:BOULDERBADGE") < 0, JSON.stringify(brockAgain.out));

  // The retry the routine exists for: beaten, but the bag was full at the time.
  const brockOwesTm = run("PEWTER_GYM", "TEXT_PEWTERGYM_BROCK",
                          { EVENT_BEAT_BROCK: true }, battleHost);
  check("a TM refused for want of room is still owed",
        brockOwesTm.out.indexOf("call:give_tm") >= 0, JSON.stringify(brockOwesTm.out));

  // -- the starter -----------------------------------------------------------
  //
  // Red's lab. Yellow's has one ball and its own suite (test/yellow.test.mjs),
  // so under a Yellow bundle these scenes are not run rather than run wrong.
  if (version === "yellow") {
    console.log("        (Red's starter scenes skipped: the bundle is Yellow)");
  } else {

    const ballEarly = run("OAKS_LAB", "TEXT_OAKSLAB_CHARMANDER_POKE_BALL", {});
    // mkHost keeps only the first line of a message, so match on that line.
    //
    // This assertion had the two lines the wrong way round until the reference
    // said otherwise: "Those are POKe BALLs" is the line BEFORE Oak walks you in,
    // and "This POKeMON is really energetic!" comes AFTER you say yes. Both exist
    // on this map, so nothing structural could catch the swap.
    check("a ball before Oak walks you in says only what they are",
          ballEarly.out.length === 1 && ballEarly.out[0].indexOf("Those are POK") === 0,
          JSON.stringify(ballEarly.out));

    const ballTaken = run("OAKS_LAB", "TEXT_OAKSLAB_SQUIRTLE_POKE_BALL",
                          { EVENT_GOT_STARTER: true, EVENT_FOLLOWED_OAK_INTO_LAB: true });
    check("and after a starter is chosen, that it is Oak's last",
          ballTaken.out.length === 1 && ballTaken.out[0].indexOf("PROF.OAK") >= 0,
          JSON.stringify(ballTaken.out));

    // ask() answers yes in mkHost, so the offer must reach give_starter.
    const yesHost = (out) => {
      const h = mkHost(out);
      h.ask = (id, flag) => { out.push("ask"); return DONE; };
      return h;
    };
    // The starter is handed over by give_pokemon now, not by a routine: the
    // reference does it inline, and the rival takes his in the same script.
    // playloop.test.mjs owns the party assertion; this checks the SCRIPT reaches
    // the handover at all.
    const ballYes = run("OAKS_LAB", "TEXT_OAKSLAB_BULBASAUR_POKE_BALL",
                        { EVENT_FOLLOWED_OAK_INTO_LAB: true, SCRATCH_TOOK_STARTER: true },
                        yesHost);
    check("saying yes reaches the handover and the rival's answer",
          ballYes.out.some((l) => l.indexOf("energetic") >= 0 ||
                                  l.indexOf("This POK") >= 0) &&
          ballYes.out.some((l) => l.indexOf("{RIVAL}") >= 0 || l.indexOf("take") >= 0),
          JSON.stringify(ballYes.out));

    const ballNo = run("OAKS_LAB", "TEXT_OAKSLAB_BULBASAUR_POKE_BALL",
                       { EVENT_FOLLOWED_OAK_INTO_LAB: true }, yesHost);
    check("saying no hands over nothing",
          ballNo.out.length <= 1, JSON.stringify(ballNo.out));

    const rivalEarly = run("OAKS_LAB", "TEXT_OAKSLAB_RIVAL", {});
    check("the rival will not fight you before you have a Pokemon",
          rivalEarly.out.indexOf("call:rival_first_battle") < 0, JSON.stringify(rivalEarly.out));
    const rivalReady = run("OAKS_LAB", "TEXT_OAKSLAB_RIVAL", { EVENT_GOT_STARTER: true });
    check("and does once you do",
          rivalReady.out.indexOf("call:rival_first_battle") >= 0, JSON.stringify(rivalReady.out));

  }

  // -- the intro -------------------------------------------------------------
  //
  // OAK_SPEECH belongs to no map, so the three structural checks above skip it.
  // It gets the same three here plus a run to the end.

  const { OAK_SPEECH } = await import("../Assets/Scripts/play/script/MapScripts.ts");
  const introMissing = OAK_SPEECH
    .filter((c) => c.op === "show_text" && c.textId && bundle.text[c.textId] === undefined)
    .map((c) => c.textId);
  check("every line the intro shows exists in the cartridge",
        introMissing.length === 0, introMissing.join(", "));
  const introBadJump = OAK_SPEECH
    .filter((c) => typeof c.to === "number" && (c.to < 0 || c.to >= OAK_SPEECH.length));
  check("no jump leaves the intro", introBadJump.length === 0);
  check("the intro warps into a map the cartridge has",
        OAK_SPEECH.some((c) => c.op === "warp" && bundle.maps[c.map] !== undefined),
        JSON.stringify(OAK_SPEECH.filter((c) => c.op === "warp")));

  // Every routine the data names must be on the contract list, and every entry
  // on the list must be reachable from the data. A `call` to a routine nobody
  // implements is a hole a DONE-returning host swallows in silence.
  const { requiredRoutines } = await import("../Assets/Scripts/play/script/MapScripts.ts");
  const used = [];
  for (const mapId of viewMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, version);
    for (const key of Object.keys(set.talk))
      for (const cmd of set.talk[key])
        if (cmd.op === "call" && used.indexOf(cmd.routine) < 0) used.push(cmd.routine);
  }
  for (const cmd of OAK_SPEECH)
    if (cmd.op === "call" && used.indexOf(cmd.routine) < 0) used.push(cmd.routine);
  // Yellow's own maps are part of the same build, so what they call counts.
  for (const mapId of yellowPortedMaps()) {
    const set = (await import("../Assets/Scripts/play/script/MapScripts.ts")).scriptsFor(mapId, "yellow");
    for (const key of Object.keys(set.talk))
      for (const cmd of set.talk[key])
        if (cmd.op === "call" && used.indexOf(cmd.routine) < 0) used.push(cmd.routine);
  }
  const { stepTriggersFor, faceTriggersFor, allScriptedMaps, talkScript: talkOf } = await import("../Assets/Scripts/play/script/MapScripts.ts");
  for (const mapId of Object.keys(bundle.maps)) {
    for (const version of ["red", "yellow"]) {
      // Face triggers too: Bill's PC calls its list from one, and until 20
      // September nothing here looked at what a face trigger calls.
      for (const t of stepTriggersFor(mapId, version).concat(faceTriggersFor(mapId, version))) {
        const program = t.script.length > 0 ? t.script : (talkOf(mapId, t.talk, version) || []);
        for (const cmd of program) {
          if (cmd.op === "call" && used.indexOf(cmd.routine) < 0) used.push(cmd.routine);
        }
      }
    }
  }
  // The wall boards are scripts too, made per cell by Bookshelves.ts rather
  // than written into a map's table: what they call counts as used.
  const { wallScript, WALL_OBJECTS } = await import("../Assets/Scripts/play/script/Bookshelves.ts");
  for (const w of WALL_OBJECTS) {
    const program = wallScript(w.map, w.x, w.y, "up", 0) || [];
    for (const cmd of program) {
      if (cmd.op === "call" && used.indexOf(cmd.routine) < 0) used.push(cmd.routine);
    }
  }
  const listed = requiredRoutines();
  check("every routine the scripts call is on the host contract",
        used.every((r) => listed.indexOf(r) >= 0),
        "missing from requiredRoutines(): " + used.filter((r) => listed.indexOf(r) < 0).join(", "));
  check("and the contract lists nothing the scripts never call",
        listed.every((r) => used.indexOf(r) >= 0),
        "listed but unused: " + listed.filter((r) => used.indexOf(r) < 0).join(", "));

  const introOut = [];
  const introHost = mkHost(introOut);
  introHost.warp = (m) => introOut.push("warp:" + m);
  introHost.warpTo = (m, x, y, f) => introOut.push("warpTo:" + m + ":" + x + "," + y + ":" + f);
  const introFlags = {};
  const introVm = new ScriptVM(introHost, introFlags);
  introVm.start(OAK_SPEECH);
  for (let i = 0; i < 200 && introVm.isRunning(); i++) introVm.update();
  check("the intro runs to its end", !introVm.isRunning());
  check("it asks for both names",
        introOut.filter((l) => l === "call:name_entry").length === 2,
        JSON.stringify(introOut));
  // The cartridge starts a new game at (3,6) facing up, measured in PyBoy.
  check("and leaves the player in the bedroom where the cartridge does",
        introOut.some((l) => l.indexOf("warpTo:REDS_HOUSE_2F:3,6") === 0 || l === "warpTo:REDS_HOUSE_2F:3,6:up"),
        JSON.stringify(introOut.filter((l) => l.indexOf("warp") === 0)));
}

console.log("\n== The four shared labels that are plain text ==");
{
  // home/overworld_text.asm holds three of these and Route5Gate.asm the fourth,
  // each `text_far X / text_end` -- so the pointer says asm and the words are
  // nonetheless right there. 47 pointers in Kanto; every one was silent.
  const shared = { PokeCenterSignText: 0, MartSignText: 0, BoulderText: 0,
                   SaffronGateGuardGeeImThirstyText: 0 };
  let silent = 0;
  for (const [label, entries] of Object.entries(bundle.textPointers)) {
    const map = Object.values(bundle.maps).find((m) => m.label === label);
    if (!map) continue;
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.text || !(entry.label in shared)) continue;
      shared[entry.label]++;
      if (!resolveText(bundle, map, id)) silent++;
    }
  }
  check("the Pokecenter and Mart signs now read", shared.PokeCenterSignText === 11 && shared.MartSignText === 8,
        JSON.stringify(shared));
  check("and so do the boulders and the thirsty guard",
        shared.BoulderText === 25 && shared.SaffronGateGuardGeeImThirstyText === 3, JSON.stringify(shared));
  check("none of the 47 is silent any more", silent === 0, silent + " still silent");

  // The line NOT to cross: a shared label whose script branches must stay
  // unresolved, or it prints its question and drops the answer.
  // (PokemonMansion2F's own pointer carries a text body as well as `asm`, so it
  // resolves by the ordinary path and prints the question without the choice.
  // That is the extraction's doing, it predates this list, and it belongs to
  // milestone 8 with the rest of the Mansion. 3F and B1F are the honest case.)
  const mansion = Object.values(bundle.maps).find((m) => m.label === "PokemonMansion3F");
  if (mansion) {
    const switchId = Object.keys(bundle.textPointers.PokemonMansion3F)
      .find((id) => bundle.textPointers.PokemonMansion3F[id].label === "PokemonMansion2FSwitchText");
    check("the mansion switch stays a script, question and all",
          switchId !== undefined && resolveText(bundle, mansion, switchId) === null);
  }
  const ball = Object.values(bundle.maps).find((m) => m.label === "Route4");
  const pickId = Object.keys(bundle.textPointers.Route4)
    .find((id) => bundle.textPointers.Route4[id].label === "PickUpItemText");
  check("and a Poke Ball on the floor still belongs to ItemBall",
        pickId !== undefined && resolveText(bundle, ball, pickId) === null);
}

console.log(`\n${fail === 0 ? "SCRIPT OK" : "SCRIPT FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
