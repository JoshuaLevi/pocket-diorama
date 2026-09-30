// The PC, played headlessly: the bedroom terminal's items and a Center's boxes.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/pc.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The box has been in the save since PLAY_STATE_VERSION 2 and there was no way
// to get a Pokemon back out of it: the PC tile did nothing at all. This drives
// PcController the way a player does -- d-pad, A, B -- against the real item
// table and the real PC lines, and checks the two screens against what the
// cartridge actually showed on 7 September:
//
//   REDS_HOUSE_2F (0,1) from (0,2): straight into WITHDRAW ITEM / DEPOSIT ITEM
//   / TOSS ITEM / LOG OFF, and TOSS ITEM lists the PC's store, not the bag.
//   VIRIDIAN_POKECENTER (13,3) from (13,4): SOMEONE's PC / RED's PC / LOG OFF,
//   then WITHDRAW / DEPOSIT / RELEASE / CHANGE BOX / SEE YA!.

import { readFileSync } from "node:fs";
import { makeServices } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: pc.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const Pc = await import(P + "PcController.ts");
const PcItems = await import(P + "PcItems.ts");
const PlayState = await import(P + "PlayState.ts");
const Storage = await import(P + "Storage.ts");
const Stats = await import(P + "battle/Stats.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const { ScriptVM, DONE } = await import(P + "script/ScriptVM.ts");
const { PlayHost } = await import(P + "script/Host.ts");
const { emptyDPad } = await import(P + "InputSource.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

const NONE = emptyDPad();
const DT = 0.016;
function padOf(dir) {
  const p = emptyDPad();
  p[dir] = true;
  return p;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const mon = (species, level, seed) => Stats.makeWildMon(bundle, species, level, seeded(seed));

/** A driver that presses like a person: one edge per call, idle frames between. */
function player(pc) {
  const step = (p, a, b) => pc.step(p || NONE, !!a, !!b, DT);
  const seen = [];
  return {
    seen,
    a: () => step(NONE, true, false),
    b: () => step(NONE, false, true),
    tap: (dir) => {
      const r = step(padOf(dir), false, false);
      for (let i = 0; i < 40; i++) { step(NONE, false, false); }
      return r;
    },
    idle: (n) => { for (let i = 0; i < (n || 1); i++) { step(NONE, false, false); } },
    /** Press A through every page of a message until a menu is up again. */
    read: () => {
      let n = 0;
      while (pc.rows().length === 0 && n < 20) {
        seen.push(pc.lines() ? pc.lines().join(" ") : "");
        step(NONE, true, false);
        n++;
      }
    },
    /** Press A through a question's early pages until YES / NO is up. */
    untilAsking: () => {
      let n = 0;
      while (!pc.asking() && n < 10) { step(NONE, true, false); n++; }
    },
    /** Move the cursor to `row` of the open list. */
    to: (row) => {
      for (let i = 0; i < 30 && pc.cursorRow() >= 0; i++) {
        if (pc.cursorRow() === row) { return; }
        if (pc.cursorRow() < row) { step(padOf("down"), false, false); }
        else { step(padOf("up"), false, false); }
        for (let k = 0; k < 40; k++) { step(NONE, false, false); }
      }
    },
  };
}

/** The rows the panel would draw, trimmed. */
const rows = (pc) => pc.rows().map((r) => r.trim());
/** The message on screen, as one string. */
const said = (pc) => (pc.lines() ? pc.lines().join(" ") : "");
const bagCount = (s, id) => PcItems.bagItemCount(s, id);
const pcCount = (s, id) => PcItems.pcItemCount(s, id);

/** A fresh save with the intro behind it. */
function freshState() {
  const s = PlayState.newPlayState("t");
  s.flags.EVENT_INTRO_DONE = true;
  return s;
}

/** The real thing, unless a selftest hands over a doctored one. */
const realPc = (state, kind) => new Pc.PcController(bundle, state, kind);

/** Open a terminal and read the "turned on the PC" line out of the way. */
function openPc(state, kind, make) {
  const pc = (make || realPc)(state, kind);
  const p = player(pc);
  p.read();
  return { pc, p };
}

// ---------------------------------------------------------------------------
// The tile: which cell opens which terminal
// ---------------------------------------------------------------------------

function loopOn(state, mapId) {
  const services = makeServices(bundle, mapId, {});
  const loop = new PlayLoop(bundle, state, services);
  return { loop, services, map: bundle.maps[mapId] };
}

function testTiles() {
  console.log("\n-- the PC tile --");
  {
    const state = freshState();
    const { loop, services, map } = loopOn(state, "REDS_HOUSE_2F");
    const hit = loop.interact(map, 0, 2, "up", false);
    for (let i = 0; i < 5; i++) { loop.update(); }
    check("the bedroom PC opens from (0,2) facing up", hit !== null && hit.kind === "cell", JSON.stringify(hit));
    check("and it is the item terminal",
          services.log.indexOf("pc:" + Pc.PC_KIND_HOME) >= 0, services.log.join(" | "));
  }
  {
    const state = freshState();
    const { loop, services, map } = loopOn(state, "REDS_HOUSE_2F");
    const hit = loop.interact(map, 0, 2, "left", false);
    for (let i = 0; i < 5; i++) { loop.update(); }
    check("facing away from it opens nothing",
          hit === null && services.log.every((l) => l.indexOf("pc:") !== 0), services.log.join(" | "));
  }
  {
    const state = freshState();
    const { loop, services, map } = loopOn(state, "VIRIDIAN_POKECENTER");
    const hit = loop.interact(map, 13, 4, "up", false);
    for (let i = 0; i < 5; i++) { loop.update(); }
    check("a Pokemon Center's PC opens from (13,4) facing up", hit !== null, JSON.stringify(hit));
    check("and it is the full terminal",
          services.log.indexOf("pc:" + Pc.PC_KIND_FULL) >= 0, services.log.join(" | "));
  }
  {
    // Every Center in the cartridge puts its PC on the same cell; the manifest
    // is the source, so a build that loses the table fails here.
    const table = bundle.field.hiddenExtras.pcTiles;
    const centers = Object.keys(table).filter((m) => m.indexOf("POKECENTER") >= 0);
    check("every Pokemon Center has a PC tile at (13,3) faced from below",
          centers.length >= 10 && centers.every((m) =>
            table[m].some((t) => t.x === 13 && t.y === 3 && t.facing === "up")),
          centers.length + " centers");
    check("Red's bedroom has one at (0,1)",
          table.REDS_HOUSE_2F && table.REDS_HOUSE_2F.some((t) => t.x === 0 && t.y === 1));
  }
}

// ---------------------------------------------------------------------------
// The bedroom terminal: the item PC, measured
// ---------------------------------------------------------------------------

function testBedroom() {
  console.log("\n-- the bedroom terminal --");
  const state = freshState();
  const { pc, p } = openPc(state, Pc.PC_KIND_HOME);
  check("it opens on the cartridge's line",
        p.seen.some((l) => l.indexOf("RED turned on") >= 0), p.seen.join(" / "));
  check("the menu is the cartridge's four rows",
        rows(pc).join("|") === "WITHDRAW ITEM|DEPOSIT ITEM|TOSS ITEM|LOG OFF", rows(pc).join("|"));
  check("under \"What do you want to do?\"",
        said(pc).indexOf("What do you want") >= 0, said(pc));

  // WITHDRAW ITEM -> the PC's list -> the quantity -> the line
  p.a();
  check("WITHDRAW ITEM lists the PC's POTION",
        rows(pc).join("|") === "POTION            × 1|CANCEL".replace(/ +/g, " ") ||
        rows(pc)[0].indexOf("POTION") === 0, rows(pc).join("|"));
  check("under \"What do you want to withdraw?\"",
        said(pc).indexOf("to withdraw") >= 0, said(pc));
  p.a();
  check("choosing it asks how many", said(pc).indexOf("How many") >= 0, said(pc));
  check("and the quantity starts at one", rows(pc)[0] === "×01", rows(pc).join("|"));
  p.a();
  check("the POTION is withdrawn", bagCount(state, "POTION") === 1 && pcCount(state, "POTION") === 0,
        "bag=" + bagCount(state, "POTION") + " pc=" + pcCount(state, "POTION"));
  check("and it says so in the cartridge's words", said(pc).indexOf("Withdrew") >= 0, said(pc));
  p.read();
  check("an emptied store drops back to the item menu",
        rows(pc).join("|") === "WITHDRAW ITEM|DEPOSIT ITEM|TOSS ITEM|LOG OFF", rows(pc).join("|"));

  // DEPOSIT ITEM puts it back
  p.to(1);
  p.a();
  check("DEPOSIT ITEM lists the BAG", rows(pc)[0].indexOf("POTION") === 0, rows(pc).join("|"));
  check("under \"What do you want to deposit?\"", said(pc).indexOf("to deposit") >= 0, said(pc));
  p.a();
  p.a();
  check("the POTION goes back into the PC",
        pcCount(state, "POTION") === 1 && bagCount(state, "POTION") === 0);
  check("and it says so", said(pc).indexOf("stored via PC") >= 0, said(pc));
  p.read();

  // LOG OFF closes the bedroom terminal outright
  p.to(3);
  p.a();
  check("LOG OFF closes the bedroom terminal", !pc.isOpen());
}

function testTossReadsTheStore(make) {
  console.log("\n-- TOSS ITEM reads the PC, not the bag --");
  // The one thing about this screen that could not be guessed from the labels.
  const state = freshState();
  PlayState.giveItem(state, "ESCAPE_ROPE", 3);
  const { pc, p } = openPc(state, Pc.PC_KIND_HOME, make);
  p.to(2);
  p.a();
  const listed = rows(pc).filter((r) => r !== "CANCEL").map((r) => r.split(/\s+/)[0]);
  check("TOSS ITEM lists what the PC holds", listed.join(",") === "POTION", listed.join(","));
  check("and not what the bag holds", listed.indexOf("ESCAPE_ROPE") < 0 && listed.indexOf("ESCAPE") < 0,
        listed.join(","));
  check("under \"What do you want to toss away?\"", said(pc).indexOf("toss away") >= 0, said(pc));
  p.a();
  p.a();
  check("it asks before throwing anything away", pc.asking() && said(pc).indexOf("OK to toss") >= 0, said(pc));
  p.to(1);
  p.a();
  check("NO keeps the POTION", pcCount(state, "POTION") === 1);
  p.a();
  p.a();
  p.to(0);
  p.a();
  p.read();
  check("YES throws it away", pcCount(state, "POTION") === 0);
}

function testKeyItems(make) {
  console.log("\n-- key items --");
  const state = freshState();
  state.pcItems = [{ id: "BICYCLE", count: 1 }];
  const { pc, p } = openPc(state, Pc.PC_KIND_HOME, make);
  p.to(2);
  p.a();
  p.a();
  check("a key item cannot be tossed", said(pc).indexOf("too impor") >= 0, said(pc));
  p.read();
  check("and it is still there", pcCount(state, "BICYCLE") === 1);

  // ... but it may be deposited: the cartridge only guards the throwing away.
  const other = freshState();
  PlayState.giveItem(other, "BICYCLE", 1);
  const second = openPc(other, Pc.PC_KIND_HOME, make);
  second.p.to(1);                // DEPOSIT ITEM
  second.p.a();
  second.p.to(0);                // the BICYCLE, not CANCEL
  second.p.a();
  second.p.a();                  // one of them
  second.p.read();
  check("a key item may still be deposited", pcCount(other, "BICYCLE") === 1 && bagItemGone(other, "BICYCLE"),
        JSON.stringify(other.bag) + " / " + JSON.stringify(other.pcItems));
}

function bagItemGone(state, id) {
  return PcItems.bagItemCount(state, id) === 0;
}

// ---------------------------------------------------------------------------
// A Pokemon Center: the box
// ---------------------------------------------------------------------------

function testCenterMenu() {
  console.log("\n-- a Center's terminal --");
  const state = freshState();
  const { pc, p } = openPc(state, Pc.PC_KIND_FULL);
  check("the top menu is the cartridge's three rows",
        rows(pc).join("|") === "SOMEONE's PC|RED's PC|LOG OFF", rows(pc).join("|"));
  check("with no message under it", pc.lines() === null, said(pc));

  state.flags.EVENT_GOT_POKEDEX = true;
  check("the Pokedex adds PROF.OAK's PC",
        rows(pc).join("|") === "SOMEONE's PC|RED's PC|PROF.OAK's PC|LOG OFF", rows(pc).join("|"));
  state.flags.EVENT_GOT_POKEDEX = false;
  state.flags.EVENT_MET_BILL = true;
  check("meeting BILL renames the box's entry",
        rows(pc)[0] === "BILL's PC", rows(pc).join("|"));
  state.flags.EVENT_MET_BILL = false;

  p.a();
  check("SOMEONE's PC says what it accessed",
        said(pc).indexOf("Accessed someone") >= 0, said(pc));
  p.read();
  check("and opens the box menu",
        rows(pc).join("|") === "WITHDRAW|DEPOSIT|RELEASE|CHANGE BOX|SEE YA!", rows(pc).join("|"));
  check("under \"What?\" beside the box number",
        said(pc).indexOf("What?") >= 0 && said(pc).indexOf("BOX No. 1") >= 0, said(pc));

  // The two refusals the cartridge showed, in the same order.
  p.a();
  check("an empty box has no POKeMON to take out",
        said(pc).indexOf("no POK") >= 0, said(pc));
  p.read();
  state.party = [mon("CHARMANDER", 6, 1)];
  p.to(1);
  p.a();
  p.a();
  check("and the last party member cannot be deposited",
        said(pc).indexOf("can't deposit") >= 0, said(pc));
  p.read();
  check("nothing moved", state.party.length === 1 && Storage.currentBox(state).length === 0);
}

function testDepositAndWithdraw(make) {
  console.log("\n-- depositing and withdrawing by hand --");
  const state = freshState();
  state.party = [mon("CHARMANDER", 6, 1), mon("PIDGEY", 4, 2)];
  const { pc, p } = openPc(state, Pc.PC_KIND_FULL, make);
  p.a();
  p.read();                      // SOMEONE's PC -> the box menu
  p.to(1);
  p.a();                         // DEPOSIT
  check("the deposit list is the party", rows(pc)[0].indexOf("CHARMANDER") === 0, rows(pc).join("|"));
  check("under \"Deposit which POKeMON?\"", said(pc).indexOf("Deposit which") >= 0, said(pc));
  p.to(1);
  p.a();                         // the PIDGEY
  check("it says which box it went to",
        said(pc).indexOf("stored in Box 1") >= 0, said(pc));
  check("the party is down to one and the box holds it",
        state.party.length === 1 && Storage.currentBox(state).length === 1 &&
        Storage.currentBox(state)[0].species === "PIDGEY",
        state.party.length + "/" + Storage.currentBox(state).length);
  p.read();
  check("a deposit leaves the list up, ready for another",
        rows(pc)[0].indexOf("CHARMANDER") === 0, rows(pc).join("|"));

  // ... and back out again
  p.b();                         // out of the deposit list
  p.to(0);
  p.a();                         // WITHDRAW
  check("the withdraw list is the box", rows(pc)[0].indexOf("PIDGEY") === 0, rows(pc).join("|"));
  p.a();
  check("it says the cartridge's line", said(pc).indexOf("taken out") >= 0, said(pc));
  check("the party has it back", state.party.length === 2 && Storage.currentBox(state).length === 0,
        state.party.length + "/" + Storage.currentBox(state).length);
  p.read();
  check("an emptied box drops back to the box menu",
        rows(pc).join("|") === "WITHDRAW|DEPOSIT|RELEASE|CHANGE BOX|SEE YA!", rows(pc).join("|"));
}

function testRelease() {
  console.log("\n-- RELEASE --");
  const state = freshState();
  state.party = [mon("CHARMANDER", 6, 1)];
  Storage.depositToBox(state, mon("RATTATA", 3, 3));
  const { pc, p } = openPc(state, Pc.PC_KIND_FULL);
  p.a();
  p.read();
  p.to(2);
  p.a();                         // RELEASE
  check("the release list is the box", rows(pc)[0].indexOf("RATTATA") === 0, rows(pc).join("|"));
  check("under \"Release which POKeMON?\"", said(pc).indexOf("Release which") >= 0, said(pc));
  p.a();
  p.untilAsking();
  check("it warns first", pc.asking() && said(pc).indexOf("gone forever") >= 0, said(pc));
  p.to(1);
  p.a();                         // NO
  check("NO keeps it", Storage.currentBox(state).length === 1 && rows(pc)[0].indexOf("RATTATA") === 0,
        rows(pc).join("|"));
  p.a();                         // the RATTATA again
  p.untilAsking();
  p.to(0);
  p.a();                         // YES
  check("YES lets it go", said(pc).indexOf("released outside") >= 0, said(pc));
  p.read();
  check("the box is empty", Storage.currentBox(state).length === 0);
}

function testChangeBox() {
  console.log("\n-- CHANGE BOX --");
  const state = freshState();
  check("the save carries the cartridge's twelve boxes",
        state.boxes.length === 12 && PlayState.BOX_COUNT === 12, state.boxes.length + "");
  state.party = [mon("CHARMANDER", 6, 1), mon("PIDGEY", 4, 2)];
  const { pc, p } = openPc(state, Pc.PC_KIND_FULL);
  p.a();
  p.read();
  p.to(3);
  p.a();                         // CHANGE BOX
  p.untilAsking();
  check("it warns that the data is saved", pc.asking() && said(pc).indexOf("okay") >= 0, said(pc));
  p.to(0);
  p.a();                         // YES
  p.read();
  check("then offers the twelve boxes", rows(pc)[0].indexOf("BOX 1") === 0 && pc.rows().length === 6,
        rows(pc).join("|"));
  p.to(1);
  p.a();
  check("choosing the second one switches to it", state.currentBox === 1);
  p.to(1);
  p.a();                         // DEPOSIT
  p.to(1);
  p.a();
  check("and a deposit lands in box 2",
        state.boxes[1].length === 1 && state.boxes[0].length === 0 && said(pc).indexOf("Box 2") >= 0,
        said(pc));
}

function testOaksPc() {
  console.log("\n-- PROF.OAK's PC --");
  check("a fresh dex is rated in the lowest band",
        Pc.ratingLabel(0) === "_DexRatingText_Own0To9", Pc.ratingLabel(0));
  check("and a full one in the highest",
        Pc.ratingLabel(151) === "_DexRatingText_Own150To151", Pc.ratingLabel(151));
  check("every band the cartridge ships has a line",
        [0, 9, 10, 45, 99, 100, 149, 150, 151].every((n) => bundle.text[Pc.ratingLabel(n)] !== undefined));

  const state = freshState();
  state.flags.EVENT_GOT_POKEDEX = true;
  for (let i = 0; i < 12; i++) { state.dexOwned[i] = true; }
  const { pc, p } = openPc(state, Pc.PC_KIND_FULL);
  p.to(2);
  p.a();
  check("it says what it accessed", said(pc).indexOf("Accessed PROF") >= 0, said(pc));
  p.read();
  check("then asks", pc.asking() && said(pc).indexOf("rated") >= 0, said(pc));
  p.a();                         // YES
  p.read();
  const heard = p.seen.join(" ");
  check("the rating names the band for twelve owned",
        heard.indexOf("right track") >= 0, heard);
  check("and it closes the link", heard.indexOf("Closed link") >= 0, heard);
  check("back at the top menu", rows(pc)[0] === "SOMEONE's PC", rows(pc).join("|"));
}

// ---------------------------------------------------------------------------
// The save
// ---------------------------------------------------------------------------

function testSave() {
  console.log("\n-- the save --");
  const fresh = PlayState.newPlayState("t");
  check("a new game's PC holds one POTION",
        fresh.pcItems.length === 1 && fresh.pcItems[0].id === "POTION" && fresh.pcItems[0].count === 1,
        JSON.stringify(fresh.pcItems));
  const old = PlayState.newPlayState("t");
  old.version = 5;
  delete old.pcItems;
  old.boxes = [[]];
  const migrated = PlayState.migratePlayState(JSON.parse(JSON.stringify(old)), "t");
  check("a v5 save migrates with the POTION still in the PC",
        migrated.pcItems.length === 1 && migrated.pcItems[0].id === "POTION",
        JSON.stringify(migrated.pcItems));
  check("and gains the other eleven boxes", migrated.boxes.length === 12);
  check("the version says so", migrated.version === PlayState.PLAY_STATE_VERSION && PlayState.PLAY_STATE_VERSION === 13);
}

// ---------------------------------------------------------------------------
// The script waits for the screen, like the mart's clerk
// ---------------------------------------------------------------------------

function testScriptSuspends() {
  console.log("\n-- open_pc suspends the script --");
  const state = freshState();
  const services = makeServices(bundle, "REDS_HOUSE_2F", { pcOpenFrames: 6 });
  const host = new PlayHost(bundle, state, services);
  const vm = new ScriptVM(host, state.flags);
  vm.start([{ op: "open_pc", kind: Pc.PC_KIND_HOME }, { op: "show_text", textId: "AFTER" }]);
  let frames = 0;
  let firstAfter = -1;
  while (vm.isRunning() && frames < 60) {
    vm.update();
    frames++;
    if (firstAfter < 0 && services.log.some((l) => l.indexOf("text:AFTER") === 0)) { firstAfter = frames; }
  }
  check("the PC is handed the screen", services.log.indexOf("pc:" + Pc.PC_KIND_HOME) >= 0,
        services.log.join(" | "));
  check("and the script waits until it closes",
        firstAfter > 5 && !vm.isRunning(), "after at frame " + firstAfter + ", running=" + vm.isRunning());
}

testTiles();
testBedroom();
testTossReadsTheStore();
testKeyItems();
testCenterMenu();
testDepositAndWithdraw();
testRelease();
testChangeBox();
testOaksPc();
testSave();
testScriptSuspends();

if (selftest) {
  console.log("\n-- selftest --");
  // A mutation must be caught by an ASSERTION, not by blowing up: a throw
  // would make every one of these pass for the wrong reason.
  let threw = "";
  const failsWith = (fn) => {
    quiet = true; quietFails = 0; threw = "";
    try { fn(); } catch (e) { threw = String(e && e.message ? e.message : e); }
    quiet = false;
    return threw === "" ? quietFails : -1;
  };

  // A TOSS list that reads the bag: the one thing about this screen that could
  // not be guessed from the labels, so the check that pins it must be able to
  // go red. Overriding the private listRows is deliberate -- the seam is inside
  // the controller, and a module import cannot be swapped in ESM.
  check("[selftest] a TOSS list that reads the bag is caught",
        failsWith(() => testTossReadsTheStore((state, kind) => {
          const pc = new Pc.PcController(bundle, state, kind);
          pc.listRows = function () {
            const out = [];
            for (let i = 0; i < state.bag.length; i++) {
              out.push(state.bag[i].id + " × " + state.bag[i].count);
            }
            out.push("CANCEL");
            return out;
          };
          return pc;
        })) > 0, threw);

  // An item table that has forgotten which items are key items.
  const softBundle = Object.assign({}, bundle, {
    items: Object.assign({}, bundle.items, {
      BICYCLE: Object.assign({}, bundle.items.BICYCLE, { keyItem: false }),
    }),
  });
  check("[selftest] a PC that throws away key items is caught",
        failsWith(() => testKeyItems((state, kind) =>
          new Pc.PcController(softBundle, state, kind))) > 0, threw);

  // A withdrawal that copies instead of moving.
  check("[selftest] a withdrawal that leaves the Pokemon in the box is caught",
        failsWith(() => testDepositAndWithdraw((state, kind) => {
          const pc = new Pc.PcController(bundle, state, kind);
          const real = pc.chooseMon;
          pc.chooseMon = function (index) {
            const box = Storage.currentBox(state);
            if (this.job === "withdrawMon" && index >= 0 && index < box.length) {
              state.party.push(box[index]);
              this.say("_MonIsTakenOutText", box[index].name, -1, () => { this.backToBoxList("withdrawMon"); });
              return;
            }
            return real.call(this, index);
          };
          return pc;
        })) > 0, threw);

  // The unmutated screens pass the quiet run.
  check("[selftest] the real PC passes the quiet run",
        failsWith(() => { testTossReadsTheStore(); testKeyItems(); testDepositAndWithdraw(); }) === 0);

  // An idle player moves nothing.
  const idleState = freshState();
  idleState.party = [mon("CHARMANDER", 6, 1), mon("PIDGEY", 4, 2)];
  const idle = new Pc.PcController(bundle, idleState, Pc.PC_KIND_FULL);
  for (let i = 0; i < 600; i++) { idle.step(NONE, false, false, DT); }
  check("[selftest] an idle player moves nothing",
        idleState.party.length === 2 && Storage.currentBox(idleState).length === 0 &&
        idleState.pcItems.length === 1 && idle.isOpen());
}

console.log(`\n${fail === 0 ? "PC OK" : "PC FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
