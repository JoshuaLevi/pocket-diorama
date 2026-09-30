// Scripted NPC walks as pure state, driven the way the host polls them.
//
//   node --experimental-strip-types --import ./test/register.mjs test/npcmotion.test.mjs [--selftest]

globalThis.print = () => {};
const selftest = process.argv.indexOf("--selftest") >= 0;
const { NpcMotion, NPC_STEP_SECONDS } = await import("../Assets/Scripts/play/NpcMotion.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}
const DONE = 0, RUNNING = 1;

console.log("\n== A walk of three ==");
{
  const m = new NpcMotion();
  check("the first request starts the walk and is not done", m.request("RIVAL", 25, 5, ["right", "right", "right"]) === RUNNING);
  check("the pose is already the first target cell, drawn at the start", JSON.stringify(m.pose("RIVAL")) === JSON.stringify({ x: 26, y: 5, visualX: 25, visualY: 5, facing: "right", walking: true }), JSON.stringify(m.pose("RIVAL")));
  m.update(NPC_STEP_SECONDS / 2);
  const mid = m.pose("RIVAL");
  check("half a step later it is drawn halfway", Math.abs(mid.visualX - 25.5) < 1e-6 && mid.walking, JSON.stringify(mid));
  check("and the request is still running", m.request("RIVAL", 25, 5, ["right"]) === RUNNING);
  let polls = 0;
  let answer = RUNNING;
  for (let i = 0; i < 40 && answer === RUNNING; i++) { m.update(0.05); answer = m.request("RIVAL", 25, 5, ["right", "right", "right"]); polls++; }
  check("it lands three cells on and answers DONE once", answer === DONE && m.pose("RIVAL").x === 28 && !m.pose("RIVAL").walking, JSON.stringify(m.pose("RIVAL")));
  check("about three step-times passed", polls >= 14 && polls <= 18, "" + polls);
  check("a new request starts from where it stands, not the shipped cell",
        m.request("RIVAL", 25, 5, ["down"]) === RUNNING && m.pose("RIVAL").x === 28 && m.pose("RIVAL").y === 6);
}

console.log("\n== Paths and turns ==");
{
  const m = new NpcMotion();
  check("pathTo walks across then down", m.pathTo(25, 5, 29, 7).join(",") === "right,right,right,right,down,down");
  check("pathTo to the same cell is empty", m.pathTo(3, 3, 3, 3).length === 0);
  check("an empty path is DONE at once", m.request("OAK", 5, 5, []) === DONE && m.pose("OAK") === null);
  m.face("OAK", 5, 5, "left");
  check("facing an untouched NPC gives it a pose where it ships", JSON.stringify(m.pose("OAK")) === JSON.stringify({ x: 5, y: 5, visualX: 5, visualY: 5, facing: "left", walking: false }));
  m.request("OAK", 5, 5, ["up"]);
  for (let i = 0; i < 10; i++) { m.update(0.05); }
  m.request("OAK", 5, 5, ["up"]);
  m.face("OAK", 5, 5, "right");
  check("facing after a walk keeps the walked-to cell", m.pose("OAK").x === 5 && m.pose("OAK").y === 4 && m.pose("OAK").facing === "right", JSON.stringify(m.pose("OAK")));
  check("names lists who has moved or turned", m.names().join(",") === "OAK");
  m.reset();
  check("reset forgets everyone", m.names().length === 0 && m.pose("OAK") === null);
}

if (selftest) {
  console.log("\n-- selftest --");
  // A motion that never advances must be caught by the landing check above.
  const m = new NpcMotion();
  m.request("X", 0, 0, ["right"]);
  let answer = RUNNING;
  for (let i = 0; i < 40 && answer === RUNNING; i++) { answer = m.request("X", 0, 0, ["right"]); }
  check("[selftest] without update() a walk never lands", answer === RUNNING);
}

console.log(`\n${fail === 0 ? "NPCMOTION OK" : "NPCMOTION FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
