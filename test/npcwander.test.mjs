// Wanderers: the cartridge's WALK rule, headless.
//
//   node --experimental-strip-types --import ./test/register.mjs test/npcwander.test.mjs --selftest

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};
const { NpcWander, isWanderer, roamDirections } = await import("../Assets/Scripts/play/NpcWander.ts");
const { NpcMotion } = await import("../Assets/Scripts/play/NpcMotion.ts");

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const FRAME = 1 / 60;

console.log("=== the rule ===");
{
  check("WALK is a wanderer, STAY is not", isWanderer({ movement: "WALK" }) && !isWanderer({ movement: "STAY" }));
  check("UP_DOWN roams two ways", roamDirections("UP_DOWN").length === 2);
  check("an unknown range roams four", roamDirections("BOULDER_MOVEMENT_BYTE_2").length === 4);
}

console.log("=== decisions ===");
{
  const motion = new NpcMotion();
  const wander = new NpcWander(seeded(7));
  const girl = { name: "GIRL", x: 3, y: 8, range: "ANY_DIR" };
  let steps = 0, faced = 0;
  const canStep = () => true;
  for (let f = 0; f < 60 * 60; f++) {
    const moved = wander.tick(FRAME, [girl], motion, canStep, false);
    steps += moved.length;
    motion.update(FRAME);
    const pose = motion.pose("GIRL");
    if (pose && !pose.walking && moved.length === 0) faced++;
    if (moved.length) { const p = motion.pose("GIRL"); girl.x = p.x; girl.y = p.y; }
  }
  // 30..180 frames a decision, half of them steps: between ~10 and ~60 steps a minute.
  check("a free wanderer steps a plausible number of times a minute", steps >= 8 && steps <= 80, String(steps));
  check("it ends up somewhere else", girl.x !== 3 || girl.y !== 8);

  const frozen = new NpcWander(seeded(7));
  const m2 = new NpcMotion();
  let frozenSteps = 0;
  const g2 = { name: "GIRL", x: 3, y: 8, range: "ANY_DIR" };
  for (let f = 0; f < 60 * 60; f++) { frozenSteps += frozen.tick(FRAME, [g2], m2, canStep, true).length; m2.update(FRAME); }
  check("frozen, it never moves", frozenSteps === 0);

  const walled = new NpcWander(seeded(3));
  const m3 = new NpcMotion();
  let walledSteps = 0;
  const g3 = { name: "GIRL", x: 3, y: 8, range: "ANY_DIR" };
  for (let f = 0; f < 60 * 60; f++) { walledSteps += walled.tick(FRAME, [g3], m3, () => false, false).length; m3.update(FRAME); }
  check("with nowhere to go it only turns", walledSteps === 0);
  check("but it does turn", m3.pose("GIRL") !== null);

  const vertical = new NpcWander(seeded(11));
  const m4 = new NpcMotion();
  const g4 = { name: "GUARD", x: 5, y: 5, range: "UP_DOWN" };
  let sideways = false;
  for (let f = 0; f < 60 * 120; f++) {
    const moved = vertical.tick(FRAME, [g4], m4, () => true, false);
    m4.update(FRAME);
    if (moved.length) { const p = m4.pose("GUARD"); if (p.x !== 5) sideways = true; g4.x = p.x; g4.y = p.y; }
  }
  check("UP_DOWN never steps sideways", !sideways);

  // No decision while a step is in flight.
  const m5 = new NpcMotion();
  const w5 = new NpcWander(() => 0.99);
  const g5 = { name: "N", x: 0, y: 0, range: "ANY_DIR" };
  let decisions = 0;
  for (let f = 0; f < 200; f++) { decisions += w5.tick(FRAME, [g5], m5, () => true, false).length; m5.update(FRAME / 10); }
  check("a wanderer mid-step makes no second decision", decisions <= 1, String(decisions));
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail; const quiet = console.log; console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before; fail = before;
    if (noticed) pass++; else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }
  expectFailures("a wanderer that walks while frozen", () => {
    check("frozen detector", 5 === 0);
  });
  expectFailures("a wanderer that steps through walls", () => {
    check("wall detector", 3 === 0);
  });
}
console.log("");
console.log("NPCWANDER  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
