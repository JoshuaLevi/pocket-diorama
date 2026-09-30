// Yellow's opening, run headless against a Yellow bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/yellow.test.mjs Assets/Generated/kanto.json [--selftest]
//
// What Yellow does differently is small and load-bearing: Oak catches a
// Pikachu before the walk to the lab, the rival takes the one Eevee on the
// table, Oak hands over the Pikachu, and the rival's later parties follow
// what his Eevee became. This suite reads the Yellow sets against the Yellow
// bundle (every text exists, every key is an object on the map), runs the
// scenes through the VM with the shared fakes, and checks the rival's party
// choice at every call site the story scripts share with Red.
//
// Against a Red or Blue bundle it says so and passes: there is nothing to
// read. --selftest hands the lab a wrong rival flag and expects a failure.

import { readFileSync } from "node:fs";
import { makeServices, DONE } from "./fakeservices.mjs";

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const SELFTEST = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: yellow.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.getTime = () => 0;

const P = "../Assets/Scripts/play/";
const { cartridgeVersion } = await import("../Assets/Scripts/world/Cartridge.ts");
const { ScriptVM } = await import(P + "script/ScriptVM.ts");
const { PlayHost } = await import(P + "script/Host.ts");
const { scriptsFor, talkScript, stepTriggersFor, yellowPortedMaps, pickStepTrigger, requiredRoutines } =
  await import(P + "script/MapScripts.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const version = cartridgeVersion(bundle.romSha1);
if (version !== "yellow") {
  console.log(`YELLOW SKIPPED: the bundle is ${version}, nothing of Yellow's to read`);
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail ? "\n          " + detail : ""));
}

function run(program, state, mapId, opts) {
  const services = makeServices(bundle, mapId, opts);
  const host = new PlayHost(bundle, state, services);
  const vm = new ScriptVM(host, state.flags);
  vm.start(program);
  let frames = 0;
  while (vm.isRunning() && frames < 800) {
    vm.update();
    frames++;
  }
  return { services, vm, frames, running: vm.isRunning() };
}

function fresh() {
  return PlayState.newPlayState(bundle.romSha1);
}

// ---------------------------------------------------------------------------
// 1. The Yellow sets read against the Yellow bundle
// ---------------------------------------------------------------------------
console.log("== Yellow's hand-written maps ==");
{
  const maps = yellowPortedMaps();
  check("Pallet Town and the lab are ported for Yellow",
        maps.indexOf("PALLET_TOWN") >= 0 && maps.indexOf("OAKS_LAB") >= 0, maps.join(","));
  const missingText = [];
  const badKey = [];
  const badOp = [];
  const walk = (rows, where) => {
    for (const c of rows || []) {
      if ((c.op === "show_text" || c.op === "ask") && typeof c.textId === "string" &&
          c.textId.charAt(0) === "_" && !bundle.text[labelFor(bundle, c.textId)]) {
        missingText.push(where + " " + c.textId);
      }
      if ((c.op === "hide_object" || c.op === "show_object") && c.map && c.npc) {
        const m = bundle.maps[c.map];
        if (!m || !m.objects.some((o) => o.name === c.npc)) { badKey.push(where + " " + c.map + ":" + c.npc); }
      }
      if (c.op === "call" && requiredRoutines().indexOf(c.routine) < 0) {
        badOp.push(where + " call " + c.routine);
      }
    }
  };
  const { textLabelFor: labelFor } = await import(P + "script/TextAliases.ts");
  for (const mapId of maps) {
    const set = scriptsFor(mapId, "yellow");
    const objects = bundle.maps[mapId].objects.map((o) => o.text)
      .concat((bundle.maps[mapId].signs || []).map((g) => g.text));
    for (const key of Object.keys(set.talk)) {
      if (objects.indexOf(key) < 0) { badKey.push(mapId + "." + key + " points at no object"); }
      walk(set.talk[key], mapId + "." + key);
    }
    for (const t of set.onStep) { walk(t.script, mapId + " step"); }
  }
  check("every text the Yellow sets name is in the bundle", missingText.length === 0, missingText.join("\n          "));
  check("every key and object they name exists on its map", badKey.length === 0, badKey.join("\n          "));
  check("every routine they call is on the host contract", badOp.length === 0, badOp.join(", "));
  check("Red's three balls are not on Yellow's table",
        !scriptsFor("OAKS_LAB", "yellow").talk.TEXT_OAKSLAB_CHARMANDER_POKE_BALL &&
        !!scriptsFor("OAKS_LAB", "yellow").talk.TEXT_OAKSLAB_EEVEE_POKE_BALL);
  check("Red still has its three balls", !!scriptsFor("OAKS_LAB").talk.TEXT_OAKSLAB_CHARMANDER_POKE_BALL);
}

// ---------------------------------------------------------------------------
// 2. Pallet Town: Oak stops you at the grass and catches a Pikachu
// ---------------------------------------------------------------------------
console.log("== Pallet Town ==");
{
  const oak = bundle.maps.PALLET_TOWN.objects.filter((o) => o.name === "PALLETTOWN_OAK")[0];
  check("Yellow's hidden Oak stands at (10,4)", oak && oak.x === 10 && oak.y === 4 && oak.hidden === true,
        JSON.stringify(oak));
  const triggers = stepTriggersFor("PALLET_TOWN", "yellow");
  const west = pickStepTrigger(triggers, 10, 0, {});
  const east = pickStepTrigger(triggers, 11, 0, {});
  const redRow = pickStepTrigger(triggers, 10, 1, {});
  check("the stop fires on row 0 in both columns and not on Red's row 1",
        west !== null && east !== null && redRow === null);
  check("Red's trigger still fires on row 1", pickStepTrigger(stepTriggersFor("PALLET_TOWN"), 10, 1, {}) !== null);
  for (const [label, trigger, x] of [["west", west, 10], ["east", east, 11]]) {
    const state = fresh();
    const r = run(trigger.script, state, "PALLET_TOWN", { cell: [x, 0] });
    const log = r.services.log;
    check(label + ": the scene runs to its end", !r.running, r.frames + " frames");
    const demoAt = log.indexOf("demo:PIKACHU:5:PROF.OAK");
    const closeAt = log.findIndex((l) => l.indexOf("text:") === 0 && l.indexOf("close!") >= 0);
    const whewAt = log.findIndex((l) => l.indexOf("text:") === 0 && l.indexOf("Whew") >= 0);
    check(label + ": Oak throws at a level-5 Pikachu between 'That was close' and 'Whew'",
          demoAt > closeAt && closeAt >= 0 && whewAt > demoAt,
          JSON.stringify(log.filter((l) => l.indexOf("demo") === 0 || l.indexOf("text:") === 0).slice(0, 8)));
    const moves = log.filter((l) => l.indexOf("move:PALLETTOWN_OAK:") === 0);
    check(label + ": Oak's walk to the lab begins with six steps down",
          moves.some((m) => m.indexOf("move:PALLETTOWN_OAK:down,down,down,down,down,down,left") === 0), JSON.stringify(moves));
    check(label + ": the escort ends in the lab with the one-ball speech",
          state.flags.EVENT_FOLLOWED_OAK_INTO_LAB === true && state.flags.EVENT_OAK_ASKED_TO_CHOOSE_MON === true);
    check(label + ": the escort plays the museum guy's tune for the walk",
          log.indexOf("music:Music_MuseumGuy") >= 0);
  }
  check("Oak's approach in the east column steps right once",
        JSON.stringify(east.script.filter((c) => c.op === "move" && c.npc === "PALLETTOWN_OAK")[0].path) ===
        JSON.stringify(["up", "up", "right", "up"]));
}

// ---------------------------------------------------------------------------
// 3. The lab: the rival takes the Eevee, Oak gives the Pikachu
// ---------------------------------------------------------------------------
console.log("== Oak's lab ==");
{
  const before = fresh();
  const r0 = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_EEVEE_POKE_BALL", "yellow"), before, "OAKS_LAB");
  check("before Oak has spoken the ball is just a ball",
        before.party.length === 0 && r0.services.log.some((l) => l.indexOf("text:") === 0 && /ball/i.test(l)),
        JSON.stringify(r0.services.log.slice(0, 3)));

  const state = fresh();
  state.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
  state.flags.EVENT_OAK_ASKED_TO_CHOOSE_MON = true;
  const r = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_EEVEE_POKE_BALL", "yellow"), state, "OAKS_LAB",
                { facing: "up", answer: 2 });
  const log = r.services.log;
  check("the scene runs to its end", !r.running, r.frames + " frames");
  check("the rival is startled first", log.indexOf("emote:OAKSLAB_RIVAL:shock") >= 0 || log.some((l) => l.indexOf("emote") === 0),
        JSON.stringify(log.slice(0, 4)));
  check("he walks down and right along the table, then onto your cell",
        log.indexOf("move:OAKSLAB_RIVAL:down,right,right") >= 0 && log.indexOf("move:OAKSLAB_RIVAL:right") >= 0,
        JSON.stringify(log.filter((l) => l.indexOf("move:") === 0)));
  check("the Eevee's ball leaves the table", r.services.revealed["OAKS_LAB:OAKSLAB_EEVEE_POKE_BALL"] === false);
  // The shove turned the player to face right, so the walk round the table
  // must not be decided by facing: from (9,4) left, down, left x3, up x2.
  const walks = log.filter((l) => l.indexOf("walk:") === 0);
  check("shoved off the table, you are walked round it to Oak",
        JSON.stringify(walks) === JSON.stringify(["walk:right:2", "walk:left:1", "walk:down:1", "walk:left:3", "walk:up:2"]),
        JSON.stringify(walks));
  check("and end up facing him", log.lastIndexOf("facePlayerDir:up") > log.lastIndexOf("walk:up:2"));
  check("his Eevee is set to become a Jolteon", state.rivalStarter === 1, String(state.rivalStarter));
  check("you get a Pikachu at level 5",
        state.party.length === 1 && state.party[0].species === "PIKACHU" && state.party[0].level === 5,
        JSON.stringify(state.party.map((m) => m.species + m.level)));
  check("the receive line names it", log.some((l) => l.indexOf("text:") === 0 && l.indexOf("PIKACHU") >= 0));
  check("the starter flags are Yellow's",
        state.flags.EVENT_GOT_STARTER === true && state.flags.EVENT_CHOSE_PIKACHU === true &&
        state.flags.EVENT_CHOSE_CHARMANDER !== true);
  check("the dex records it", state.dexOwned[bundle.species.PIKACHU.dex - 1] === true);

  const again = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_EEVEE_POKE_BALL", "yellow"), state, "OAKS_LAB");
  check("the ball's script does nothing a second time", state.party.length === 1 && again.frames < 5);
}

// ---------------------------------------------------------------------------
// 4. The first rival battle decides his Eevee, and every later party follows
// ---------------------------------------------------------------------------
console.log("== The rival ==");
function withPikachu(rivalStarter) {
  const state = fresh();
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_PIKACHU = true;
  state.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
  state.party.push(makeWildMon(bundle, "PIKACHU", 5, () => 0.5));
  if (rivalStarter) { state.rivalStarter = rivalStarter; }
  return state;
}
{
  const leaving = pickStepTrigger(stepTriggersFor("OAKS_LAB", "yellow"), 5, 6,
                                  { EVENT_GOT_STARTER: true, EVENT_FOLLOWED_OAK_INTO_LAB: true });
  check("heading for the door with Pikachu starts the rival scene", leaving !== null);
  for (const [won, expect] of [[true, 2], [false, 3]]) {
    const state = withPikachu(1);
    state.party[0].hp = 1;
    const r = run(leaving.script, state, "OAKS_LAB", { won: won });
    check((won ? "a win" : "a loss") + " fights the lab party, the lone Eevee",
          r.services.battlesFought.length === 1 && r.services.battlesFought[0] === "OPP_RIVAL1#1",
          JSON.stringify(r.services.battlesFought));
    check((won ? "a win" : "a loss") + " sets his Eevee to " + (won ? "FLAREON" : "VAPOREON"),
          state.rivalStarter === (SELFTEST ? 9 : expect) && state.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB === true,
          String(state.rivalStarter));
    const popsOut = bundle.text._OaksLabPikachuDislikesPokeballsText1.split("\n")[0].slice(0, 12);
    check("the party is healed and Pikachu pops out of its ball",
          r.services.log.indexOf("cry:PIKACHU") >= 0 && state.party[0].hp === state.party[0].maxHp &&
          r.services.log.some((l) => l.indexOf("text:" + popsOut) === 0),
          JSON.stringify(r.services.log.slice(-6)));
  }
  check("OPP_RIVAL1 has the Eevee in its first party",
        bundle.trainers.OPP_RIVAL1.parties[0].some((m) => m.species === "EEVEE"));

  // The shared story scripts call rival_battle CLASS#base; Yellow's parties
  // are picked by his Eevee's evolution, Route 22's first win upgrades it.
  const cases = [
    // [class#base, rivalStarter, expected party, won]
    ["OPP_RIVAL1#4", 2, 2, true],   // Route 22 first: fixed party 2, FLAREON -> JOLTEON on a win
    ["OPP_RIVAL1#7", 3, 3, true],   // Cerulean: fixed party 3
    ["OPP_RIVAL2#1", 1, 1, true],   // S.S. Anne: fixed party 1
    ["OPP_RIVAL2#4", 1, 2, true],   // Tower: 1 + JOLTEON
    ["OPP_RIVAL2#4", 3, 4, true],   // Tower: 1 + VAPOREON
    ["OPP_RIVAL2#7", 2, 6, true],   // Silph: 4 + FLAREON
    ["OPP_RIVAL2#10", 1, 8, true],  // Route 22 second: 7 + JOLTEON
    ["OPP_RIVAL3#1", 3, 3, true],   // Champion: VAPOREON
  ];
  for (const [arg, starter, party, won] of cases) {
    const state = withPikachu(starter);
    const r = run([{ op: "call", routine: "rival_battle", argument: arg }], state, "ROUTE_22", { won: won });
    const cls = arg.split("#")[0];
    check(arg + " with rivalStarter " + starter + " fights party " + party,
          r.services.battlesFought[0] === cls + "#" + party, JSON.stringify(r.services.battlesFought));
    check(arg + " names a party the bundle has",
          bundle.trainers[cls].parties.length >= party, bundle.trainers[cls].parties.length + " parties");
  }
  const upgraded = withPikachu(2);
  run([{ op: "call", routine: "rival_battle", argument: "OPP_RIVAL1#4" }], upgraded, "ROUTE_22", { won: true });
  check("a Route 22 win turns FLAREON back to JOLTEON", upgraded.rivalStarter === 1, String(upgraded.rivalStarter));
  const lost = withPikachu(2);
  run([{ op: "call", routine: "rival_battle", argument: "OPP_RIVAL1#4" }], lost, "ROUTE_22", { won: false });
  check("a Route 22 loss leaves FLAREON", lost.rivalStarter === 2, String(lost.rivalStarter));
  const jolt = withPikachu(1);
  run([{ op: "call", routine: "rival_battle", argument: "OPP_RIVAL1#4" }], jolt, "ROUTE_22", { won: true });
  check("a Route 22 win with JOLTEON changes nothing", jolt.rivalStarter === 1);
  const finalParty = bundle.trainers.OPP_RIVAL3.parties;
  check("the Champion's three parties end in JOLTEON, FLAREON, VAPOREON",
        finalParty[0].some((m) => m.species === "JOLTEON") && finalParty[1].some((m) => m.species === "FLAREON") &&
        finalParty[2].some((m) => m.species === "VAPOREON"));
}

// ---------------------------------------------------------------------------
// 5. Oak at the desk, Yellow's branches
// ---------------------------------------------------------------------------
console.log("== Oak at the desk ==");
{
  const s1 = withPikachu(1);
  const r1 = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_OAK1", "yellow"), s1, "OAKS_LAB");
  check("with the Pikachu and no battle yet, Oak says it can fight",
        r1.services.log.some((l) => l.indexOf("text:") === 0 && /fight/i.test(l)),
        JSON.stringify(r1.services.log.filter((l) => l.indexOf("text:") === 0)));

  const s2 = withPikachu(1);
  s2.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB = true;
  const r2 = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_OAK1", "yellow"), s2, "OAKS_LAB");
  check("after the battle and before the parcel, talk to it",
        r2.services.log.some((l) => l.indexOf("text:") === 0 && /talk/i.test(l)),
        JSON.stringify(r2.services.log.filter((l) => l.indexOf("text:") === 0)));

  const s3 = withPikachu(1);
  s3.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB = true;
  s3.bag.push({ id: "OAKS_PARCEL", count: 1 });
  const r3 = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_OAK1", "yellow"), s3, "OAKS_LAB");
  check("the parcel runs the Pokedex scene to its end", !r3.running && s3.flags.EVENT_GOT_POKEDEX === true,
        r3.frames + " frames");
  check("the parcel is taken", !s3.bag.some((b) => b.id === "OAKS_PARCEL"));
  check("the rival brags on arrival rather than asking why he was called",
        r3.services.log.some((l) => l.indexOf("text:") === 0 && /stronger/i.test(l)));
  check("Yellow's tutorial old man appears on the sleeper's cell",
        r3.services.revealed["VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN_SLEEPY"] === false &&
        r3.services.revealed["VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN2"] === true,
        JSON.stringify(r3.services.revealed));
  check("Route 22's first ambush is armed",
        s3.flags.EVENT_1ST_ROUTE22_RIVAL_BATTLE === true && s3.flags.EVENT_ROUTE22_RIVAL_WANTS_BATTLE === true);

  s3.flags.EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE = true;
  const r4 = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_OAK1", "yellow"), s3, "OAKS_LAB");
  check("after Route 22 he hands over five Poke Balls once",
        s3.bag.some((b) => b.id === "POKE_BALL" && b.count === 5) && s3.flags.EVENT_GOT_POKEBALLS_FROM_OAK === true,
        JSON.stringify(s3.bag));
  const r5 = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_OAK1", "yellow"), s3, "OAKS_LAB");
  check("and with balls in the bag he says come and see me",
        r5.services.log.some((l) => l.indexOf("text:") === 0 && /see me/i.test(l)),
        JSON.stringify(r5.services.log.filter((l) => l.indexOf("text:") === 0)));
}

// ---------------------------------------------------------------------------
// 6. Viridian's two old men, and the renamed lines
// ---------------------------------------------------------------------------
console.log("== Viridian City ==");
{
  const { textLabelFor, yellowTextAliases } = await import(P + "script/TextAliases.ts");
  const aliases = yellowTextAliases();
  const badAlias = Object.keys(aliases).filter((k) => !bundle.text[aliases[k]] || bundle.text[k]);
  check("every alias names a Yellow label for a line Yellow lacks under Red's name",
        Object.keys(aliases).length >= 20 && badAlias.length === 0, badAlias.join(", "));
  check("a Red label resolves to Yellow's words",
        textLabelFor(bundle, "_CeruleanCityCooltrainerF1SlowbroPunchText") === "_CeruleanCityCooltrainerF1ElectrodePunchText" &&
        textLabelFor(bundle, "_OaksLabGirlText") === "_OaksLabGirlText");

  const lesson = pickStepTrigger(stepTriggersFor("VIRIDIAN_CITY", "yellow"), 19, 9,
                                 { EVENT_GOT_POKEDEX: true });
  check("with the Pokedex, the gap beside the old man starts the lesson",
        lesson !== null && lesson.talk === "TEXT_VIRIDIANCITY_OLD_MAN2" && lesson.turnPlayer === "left");
  check("without it the sleeper still turns you back",
        pickStepTrigger(stepTriggersFor("VIRIDIAN_CITY", "yellow"), 19, 9, {}) !== null &&
        pickStepTrigger(stepTriggersFor("VIRIDIAN_CITY", "yellow"), 19, 9, {}).talk === "");
  check("once the lesson is done the gap is just a gap",
        pickStepTrigger(stepTriggersFor("VIRIDIAN_CITY", "yellow"), 19, 9,
                        { EVENT_GOT_POKEDEX: true, EVENT_COMPLETED_CATCH_TRAINING: true }) === null);

  const s1 = withPikachu(1);
  s1.flags.EVENT_GOT_POKEDEX = true;
  const r1 = run(talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_OLD_MAN2", "yellow"), s1, "VIRIDIAN_CITY", { facing: "left" });
  const log1 = r1.services.log;
  check("the tutorial man apologises, throws at a RATTATA and misses",
        log1.indexOf("demo:RATTATA:5:OLD MAN:fails") >= 0 &&
        log1.some((l) => l.indexOf("text:") === 0 && /coffee/i.test(l)) &&
        log1.some((l) => l.indexOf("text:") === 0 && /losing/i.test(l)),
        JSON.stringify(log1.filter((l) => l.indexOf("text:") === 0 || l.indexOf("demo") === 0)));
  check("then walks down the corridor and is gone",
        log1.indexOf("move:VIRIDIANCITY_OLD_MAN2:down,down,down,down,down,down") >= 0 &&
        r1.services.revealed["VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN2"] === false &&
        s1.flags.EVENT_COMPLETED_CATCH_TRAINING === true);
  const r2 = run(talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_OLD_MAN2", "yellow"), s1, "VIRIDIAN_CITY");
  check("spoken to again he only says he is losing his touch",
        r2.services.log.filter((l) => l.indexOf("demo") === 0).length === 0 &&
        r2.services.log.some((l) => l.indexOf("text:") === 0 && /losing/i.test(l)));

  const s2 = withPikachu(1);
  s2.flags.EVENT_GOT_POKEDEX = true;
  const r3 = run(talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_OLD_MAN2", "yellow"), s2, "VIRIDIAN_CITY", { facing: "up" });
  check("spoken to from elsewhere he steps right once instead",
        r3.services.log.indexOf("move:VIRIDIANCITY_OLD_MAN2:right") >= 0);

  const mart = scriptsFor("VIRIDIAN_MART", "yellow").onEnter;
  const s3 = withPikachu(1);
  s3.flags.EVENT_GOT_OAKS_PARCEL = true;
  s3.flags.EVENT_COMPLETED_CATCH_TRAINING = true;
  const r4 = run(mart, s3, "VIRIDIAN_MART");
  check("the mart brings Red's walker out once parcel and lesson are done",
        r4.services.revealed["VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN"] === true &&
        r4.services.revealed["VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN2"] === false &&
        s3.flags.EVENT_SPAWNED_OLD_MAN_1 === true);
  const s4 = withPikachu(1);
  s4.flags.EVENT_GOT_OAKS_PARCEL = true;
  const r5 = run(mart, s4, "VIRIDIAN_MART");
  check("and not before the lesson", Object.keys(r5.services.revealed).length === 0);

  const s5 = withPikachu(1);
  const r6 = run(talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_OLD_MAN", "yellow"), s5, "VIRIDIAN_CITY", { answer: 1 });
  check("the walker offers the lesson again, Red's way, with the ball holding",
        r6.services.log.indexOf("demo:WEEDLE:5:OLD MAN") >= 0 && s5.flags.EVENT_COMPLETED_CATCH_TRAINING_AGAIN === true,
        JSON.stringify(r6.services.log.filter((l) => l.indexOf("demo") === 0)));
  const clerk = talkScript("GAME_CORNER", "TEXT_GAMECORNER_CLERK", "yellow");
  check("the Game Corner's coin clerk answers to Yellow's key", clerk !== null &&
        talkScript("GAME_CORNER", "TEXT_GAMECORNER_CLERK1", "yellow") === null &&
        talkScript("GAME_CORNER", "TEXT_GAMECORNER_CLERK1") !== null);
}

// The LIFT KEY: Yellow's hideout has one grunt by the lift, ROCKET, where Red
// has ROCKET3, and until 20 September nothing scripted him -- so the key's
// ball stayed hidden and the lift said "appears to need a key" for good.
console.log("== The hideout's LIFT KEY ==");
{
  const grunt = talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_ROCKET", "yellow");
  check("Yellow's grunt by the lift has a script", grunt !== null);
  check("and Red's key is not Yellow's", talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_ROCKET3", "yellow") === null &&
        talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_ROCKET3") !== null);
  const texts = (grunt || []).filter((c) => c.op === "show_text").map((c) => c.textId);
  check("every line he says is in Yellow's text", texts.length === 3 && texts.every((t) => typeof bundle.text[t] === "string"),
        texts.filter((t) => typeof bundle.text[t] !== "string").join(","));
  const object = bundle.maps.ROCKET_HIDEOUT_B4F.objects.filter((o) => o.name === "ROCKETHIDEOUTB4F_ROCKET")[0];
  check("he is the object Yellow's map has", !!object && (grunt || []).some((c) => c.op === "beat_trainer" && c.npc === object.name));
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_2 = true;
  const r = run(grunt, state, "ROCKET_HIDEOUT_B4F");
  check("beaten, his next talk drops the key", state.flags.EVENT_ROCKET_DROPPED_LIFT_KEY === true &&
        r.services.log.indexOf("reveal:ROCKETHIDEOUTB4F_LIFT_KEY:true") >= 0, JSON.stringify(r.services.log));
  check("Giovanni and the door's sound came along", talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_GIOVANNI", "yellow") !== null &&
        scriptsFor("ROCKET_HIDEOUT_B4F", "yellow").onEnter.length > 0);
  check("and Jessie and James still speak from the transcription",
        talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE", "yellow") !== null);
}

// Melanie: until 20 September her pointer resolved to nothing and she was
// mute. PIKACHU in the party stands in for the happiness the lens does not keep.
console.log("== Melanie's BULBASAUR ==");
{
  const melanie = talkScript("CERULEAN_MELANIES_HOUSE", "TEXT_CERULEANMELANIESHOUSE_MELANIE", "yellow");
  check("Melanie has a script under Yellow, and only there", melanie !== null &&
        talkScript("CERULEAN_MELANIES_HOUSE", "TEXT_CERULEANMELANIESHOUSE_MELANIE") === null);
  const lines = (melanie || []).filter((c) => c.op === "show_text" || c.op === "ask").map((c) => c.textId);
  check("every line she says is in Yellow's text", lines.length === 5 && lines.every((t) => typeof bundle.text[t] === "string"),
        lines.filter((t) => typeof bundle.text[t] !== "string").join(","));
  const { makeWildMon } = await import(P + "battle/Stats.ts");
  const alone = fresh();
  alone.party = [makeWildMon(bundle, "PIDGEY", 8, () => 0.5)];
  const r1 = run(melanie, alone, "CERULEAN_MELANIES_HOUSE");
  check("without PIKACHU along she only tells her story", alone.party.length === 1 &&
        r1.services.log.filter((l) => l === "ask").length === 0, JSON.stringify(r1.services.log));
  const together = fresh();
  together.party = [makeWildMon(bundle, "PIKACHU", 12, () => 0.5)];
  const r2 = run(melanie, together, "CERULEAN_MELANIES_HOUSE");
  check("with him she offers it, and yes takes the BULBASAUR at level 10",
        together.party.length === 2 && together.party[1].species === "BULBASAUR" && together.party[1].level === 10 &&
        together.flags.EVENT_GOT_BULBASAUR_IN_CERULEAN === true &&
        r2.services.log.indexOf("reveal:CERULEANMELANIESHOUSE_BULBASAUR:false") >= 0, JSON.stringify(r2.services.log));
  const r3 = run(melanie, together, "CERULEAN_MELANIES_HOUSE");
  check("and afterwards she asks how it is doing", r3.services.log.join(" ").indexOf("doing well") >= 0 &&
        together.party.length === 2, JSON.stringify(r3.services.log));
  check("the other three in her house still speak from the transcription",
        talkScript("CERULEAN_MELANIES_HOUSE", "TEXT_CERULEANMELANIESHOUSE_ODDISH", "yellow") !== null);
}

// ---------------------------------------------------------------------------
// 7. The title: Yellow's own, composed from its tilemaps
// ---------------------------------------------------------------------------
console.log("== The title ==");
{
  const { GbCanvas, imageFromPacked } = await import(P + "screen/GbCanvas.ts");
  const { TitleController, titleMonsFor } = await import(P + "screen/TitleScreen.ts");
  const screen = bundle.title.screen;
  check("the bundle carries the composed title screen", !!screen && screen.width === 160 && screen.height === 144,
        screen ? screen.width + "x" + screen.height : "none");
  const art = {
    logo: imageFromPacked(bundle.title.logo), version: imageFromPacked(bundle.title.version),
    player: imageFromPacked(bundle.title.player), copyright: imageFromPacked(bundle.title.copyright),
    gamefreakInc: imageFromPacked(bundle.title.gamefreakInc), screen: imageFromPacked(screen),
  };
  const ink = (c, x, y, w, h) => { let n = 0; for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) if (c.shadeAt(px, py) === 3) n++; return n; };
  const t = new TitleController(art, (sp) => imageFromPacked(bundle.species[sp].front), () => 0.5, titleMonsFor(bundle.romSha1));
  const c = new GbCanvas();
  for (let f = 0; f < 120; f++) t.step(false, false, 1 / 60);
  t.paint(c);
  check("the logo sits in rows 1-7 once the bounce is over", ink(c, 16, 8, 128, 56) > 800, String(ink(c, 16, 8, 128, 56)));
  check("Pikachu stands at (4,8), 12 by 9 tiles", ink(c, 32, 64, 96, 72) > 600, String(ink(c, 32, 64, 96, 72)));
  check("his eyes are open", ink(c, 56, 80, 16, 16) > 8 && ink(c, 88, 80, 16, 16) > 8,
        ink(c, 56, 80, 16, 16) + "/" + ink(c, 88, 80, 16, 16));
  check("the Pika bubble is at (6,4)", ink(c, 48, 32, 56, 32) > 60, String(ink(c, 48, 32, 56, 32)));
  check("the copyright row is at (2,17)", ink(c, 16, 136, 128, 8) > 60 && ink(c, 0, 136, 16, 8) === 0,
        String(ink(c, 16, 136, 128, 8)));
  check("no trainer where Red's would stand", ink(c, 140, 80, 20, 50) < 20, String(ink(c, 140, 80, 20, 50)));
  const early = new GbCanvas();
  const t2 = new TitleController(art, (sp) => imageFromPacked(bundle.species[sp].front), () => 0.5, titleMonsFor(bundle.romSha1));
  t2.paint(early);
  check("the logo drops in from above, the copyright already in place",
        ink(early, 16, 8, 128, 8) === 0 && ink(early, 16, 136, 128, 8) > 60,
        ink(early, 16, 8, 128, 8) + "/" + ink(early, 16, 136, 128, 8));
  check("and Pikachu is not there until it has landed", ink(early, 32, 64, 96, 72) === 0, String(ink(early, 32, 64, 96, 72)));
}

// ---------------------------------------------------------------------------
// 8. The intro shows a Pikachu
// ---------------------------------------------------------------------------
{
  const { introScript, introSpecies } = await import(P + "script/MapScripts.ts");
  const red = introScript();
  const yel = introScript("yellow");
  check("Red's intro cries NIDORINO, Yellow's PIKACHU",
        red.some((c) => c.op === "cry" && c.species === "NIDORINO") &&
        yel.some((c) => c.op === "cry" && c.species === "PIKACHU") &&
        !yel.some((c) => c.op === "cry" && c.species === "NIDORINO") &&
        introSpecies("yellow") === "PIKACHU" && introSpecies() === "NIDORINO");
  check("and the rest of the intro is the same", red.length === yel.length &&
        red.every((c, i) => c.op === yel[i].op));
  check("the bundle names PIKACHU as the demo species", bundle.field && bundle.field.oakSpeech &&
        bundle.field.oakSpeech.demoSpecies === "PIKACHU", JSON.stringify(bundle.field && bundle.field.oakSpeech));
}

const verdict = fail === 0 ? "OK" : "FAILED";
console.log(`YELLOW ${pass} PASS  ${fail} FAIL  ${verdict}`);
if (SELFTEST) {
  if (fail === 0) { console.log("SELFTEST FAILED: the planted fault went unnoticed"); process.exit(1); }
  console.log("SELFTEST OK: the planted fault was caught");
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
