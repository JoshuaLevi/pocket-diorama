// A traded Pokemon above the badge ladder disobeys -- CheckForDisobedience.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/obedience.test.mjs Assets/Generated/kanto.json
//
// The Cascade Badge's own text says what it is for: "makes all POKeMON up to
// L30 obey! That includes even outsiders!" Until battle/Obedience.ts nothing
// read a Pokemon's otId, so no badge meant anything past its stat boost.
//
// The routine draws its random bytes in a fixed order, so a scripted random
// reproduces each branch exactly; the byte sequences below are read off the
// asm (core.asm:3830-3960) and each check names the branch it lands in.

import { readFileSync } from "node:fs";

globalThis.print = () => {};

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: obedience.test.mjs <bundle.json>");
  process.exit(2);
}

const P = "../Assets/Scripts/play/battle/";
const O = await import(P + "Obedience.ts");
const State = await import(P + "BattleState.ts");
const Stats = await import(P + "Stats.ts");
const Party = await import(P + "Party.ts");
const { ACTION_MOVE, STATUS_SLEEP, STATUS_NONE } = await import(P + "types.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

/** A random() that hands out these bytes in order, then zeros. */
function bytes(list) {
  let i = 0;
  const draws = { count: 0 };
  const f = () => { draws.count++; const b = i < list.length ? list[i++] : 0; return b / 256; };
  f.draws = draws;
  return f;
}

function mon(species, level, otId) {
  const m = Stats.makeWildMon(bundle, species, level, () => 0.5);
  m.otId = otId;
  m.otName = otId === 1234 ? "RED" : "TRAINER";
  return m;
}

const PLAYER = 1234;
const bits = (...badges) => badges.reduce((b, i) => b | (1 << i), 0);

console.log("== The ladder ==");
{
  check("no badges: level 10", O.obedienceLevel(0) === 10);
  check("the Boulder Badge alone changes nothing", O.obedienceLevel(bits(0)) === 10);
  check("CASCADEBADGE: 30", O.obedienceLevel(bits(0, 1)) === 30);
  check("RAINBOWBADGE: 50", O.obedienceLevel(bits(0, 1, 2, 3)) === 50);
  check("MARSHBADGE: 70", O.obedienceLevel(bits(5)) === 70);
  check("EARTHBADGE: everything", O.obedienceLevel(bits(7)) === 101);
  check("a higher badge wins over a lower one", O.obedienceLevel(bits(1, 3)) === 50);
}

console.log("== Who is traded ==");
{
  check("a Pokemon with another OT id is", O.isTraded(mon("PIDGEY", 5, 777), PLAYER) === true);
  check("your own is not", O.isTraded(mon("PIDGEY", 5, PLAYER), PLAYER) === false);
  check("nor is one nobody has claimed yet -- a catch from this session", O.isTraded(mon("PIDGEY", 5, 0), PLAYER) === false);
  check("and with no player id known, nobody is", O.isTraded(mon("PIDGEY", 5, 777), 0) === false);
}

console.log("== At or below the ladder: always obeys, no bytes drawn ==");
{
  const rng = bytes([255, 255, 255]);
  const roll = O.rollDisobedience(mon("PIDGEY", 30, 777), bits(1), rng, 0, false, -1);
  check("a level 30 traded Pokemon with the Cascade Badge obeys", roll.outcome === O.OBEY_USE);
  check("without a single random draw", rng.draws.count === 0, "" + rng.draws.count);
  const r2 = O.rollDisobedience(mon("PIDGEY", 31, 777), bits(1), bytes([0x10]), 0, false, -1);
  check("level 31 is above it and is rolled", r2 !== null);
}

console.log("== Above it, branch by branch (level 40, no badges: c=10, b=50) ==");
{
  // 1. swap(byte) < b, then < c -> obeys. swap(0x50) = 0x05 = 5 < 10.
  const r = O.rollDisobedience(mon("PIDGEY", 40, 777), 0, bytes([0x50]), 0, false, -1);
  check("first draw under c: obeys", r.outcome === O.OBEY_USE);
}
{
  // 1. swap(0x02)=0x20=32: 32 < 50 and 32 >= 10 -> on to 2.
  // 2. byte 5 < 50 and < 10 -> a random move. Known 4 moves, pick 2 (not 0,
  //    not the last).
  const m = mon("PIDGEY", 40, 777);
  m.moves = [
    { id: "GUST", pp: 35, maxPp: 35 }, { id: "SAND_ATTACK", pp: 15, maxPp: 15 },
    { id: "QUICK_ATTACK", pp: 30, maxPp: 30 }, { id: "WHIRLWIND", pp: 20, maxPp: 20 },
  ];
  const r = O.rollDisobedience(m, 0, bytes([0x02, 5, 2]), 0, false, -1);
  check("second draw under c: uses another move", r.outcome === O.OBEY_RANDOM && r.slot === 2,
        JSON.stringify(r));
  const last = O.rollDisobedience(m, 0, bytes([0x02, 5, 3, 1]), 0, false, -1);
  check("and never the last move (the cartridge's off-by-one)", last.slot === 1, JSON.stringify(last));
  const only = mon("PIDGEY", 40, 777);
  only.moves = [{ id: "GUST", pp: 35, maxPp: 35 }, { id: "", pp: 0, maxPp: 0 }, { id: "", pp: 0, maxPp: 0 }, { id: "", pp: 0, maxPp: 0 }];
  const r1 = O.rollDisobedience(only, 0, bytes([0x02, 5, 0]), 0, false, -1);
  check("knowing one move, it does nothing instead", r1.outcome === O.OBEY_NOTHING, JSON.stringify(r1));
  const rs = O.rollDisobedience(m, 0, bytes([0x02, 5, 0]), 0, true, -1);
  check("struggling, it does nothing instead", rs.outcome === O.OBEY_NOTHING);
  const rd = O.rollDisobedience(m, 0, bytes([0x02, 5, 0]), 0, false, 1);
  check("with a move disabled, it does nothing instead", rd.outcome === O.OBEY_NOTHING);
}
{
  // 1. 32 -> on. 2. byte 20 (< 50, >= 10) -> on. 3. swap(byte) - (d-c=30):
  //    swap(0x10)=1 -> 1-30 < 0 -> naps; then the sleep byte: swap(2*0x40)=swap(0x80)=8 &7 = 0 retry,
  //    swap(2*0x18)=swap(0x30)=3 -> 3 turns.
  const r = O.rollDisobedience(mon("PIDGEY", 40, 777), 0, bytes([0x02, 20, 0x10, 0x40, 0x18]), 0, false, -1);
  check("a short third draw: begins to nap", r.outcome === O.OBEY_NAP && r.textId === O.TEXT_BEGAN_TO_NAP,
        JSON.stringify(r));
  check("for one to seven turns, never zero", r.sleepTurns === 3, "" + r.sleepTurns);
}
{
  // 3. swap(0x0F)=0xF0=240: 240-30=210 >= 30 -> does nothing, byte & 3 picks the line.
  const lines = [O.TEXT_LOAFING, O.TEXT_WONT_OBEY, O.TEXT_TURNED_AWAY, O.TEXT_IGNORED_ORDERS];
  let ok = true;
  for (let k = 0; k < 4; k++) {
    const r = O.rollDisobedience(mon("PIDGEY", 40, 777), 0, bytes([0x02, 20, 0x0f, k]), 0, false, -1);
    if (r.outcome !== O.OBEY_NOTHING || r.textId !== lines[k]) { ok = false; }
  }
  check("a long third draw: one of the four idle lines, by the next byte & 3", ok);
}
{
  // 3. swap(0x03)=0x30=48: 48-30=18, 0 <= 18 < 30 -> won't obey and hits itself.
  const r = O.rollDisobedience(mon("PIDGEY", 40, 777), 0, bytes([0x02, 20, 0x03]), 0, false, -1);
  check("a middling third draw: won't obey, and the confusion hit", r.outcome === O.OBEY_HIT &&
        r.textId === O.TEXT_WONT_OBEY, JSON.stringify(r));
}

console.log("== In a battle ==");
// The foe's own move is chosen before the order is decided, so the battle
// draws bytes BEFORE the obedience roll and a scripted sequence would land on
// the wrong draw. A CONSTANT byte sidesteps that: 17 (swap 17) sits in the
// "not obeying, not a random move, naps" window for level 40 with no badges
// -- 17 >= c=10, 17 < b=50 twice, then 17 - 30 < 0 -- whatever draws precede
// it, and the nap length from it is swap(34)&7 = 2.
const constant = (byte) => () => byte / 256;
function oneTurn(lead, badgeBits, byte, playerId) {
  const wild = Stats.makeWildMon(bundle, "CATERPIE", 2, () => 0.5);
  const battle = State.startWildBattle(bundle, [lead], badgeBits, wild, constant(byte));
  if (playerId > 0) { battle.ctx.playerId = playerId; }
  const report = battle.takeTurn({ kind: ACTION_MOVE, moveIndex: 0, partyIndex: -1, item: "" });
  // The cartridge breaks its lines mid-sentence ("PIDGEY began\nto nap!"); the
  // checks read them as one line.
  return { battle: battle, report: report, log: battle.log.join(" | ").replace(/\s+/g, " "), wild: wild };
}
{
  const t = oneTurn(mon("PIDGEY", 40, 777), 0, 17, PLAYER);
  check("the turn is taken", t.report.ok === true, JSON.stringify(t.report));
  check("PIDGEY began to nap", t.log.indexOf("began to nap") >= 0, t.log);
  check("it is asleep, for the rolled two turns", t.battle.ctx.player.active.status === STATUS_SLEEP &&
        t.battle.ctx.player.active.sleepTurns === 2,
        t.battle.ctx.player.active.status + " " + t.battle.ctx.player.active.sleepTurns);
  check("and its move was not used", t.log.indexOf("PIDGEY used") < 0 && t.wild.hp === t.wild.maxHp, t.log);
}
{
  const t = oneTurn(mon("PIDGEY", 40, PLAYER), 0, 17, PLAYER);
  check("your own Pokemon at level 40 with no badges obeys", t.log.indexOf("PIDGEY used") >= 0 &&
        t.log.indexOf("nap") < 0, t.log);
}
{
  const t = oneTurn(mon("PIDGEY", 40, 777), 0, 17, 0);
  check("a battle with no player id checks nothing, as every test's does",
        t.log.indexOf("PIDGEY used") >= 0 && t.log.indexOf("nap") < 0, t.log);
}
{
  // With the Cascade Badge c=30, b=70: byte 34 (swap 34) is >= 30 and < 70
  // twice, then 34 - 10 = 24 >= 10 -> does nothing, and 34 & 3 = 2 turns away.
  const t = oneTurn(mon("PIDGEY", 40, 777), bits(1), 34, PLAYER);
  check("level 40 is still above the Cascade Badge's 30: it turned away",
        t.log.indexOf("turned away") >= 0 && t.log.indexOf("PIDGEY used") < 0, t.log);
  const t2 = oneTurn(mon("PIDGEY", 30, 777), bits(1), 34, PLAYER);
  check("and level 30 is not: the badge does what its text says",
        t2.log.indexOf("PIDGEY used") >= 0, t2.log);
}

console.log("\nOBEDIENCE " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
