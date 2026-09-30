// The jolt a lift gives the world.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/worldshake.test.mjs [--selftest]
//
// ShakeElevator scrolls the screen two pixels up and back for about a second,
// which is the only thing in Red that says a lift travelled. Four claims:
//
//   1. Nothing shakes until asked, and the offset is exactly zero then -- the
//      world sits ON its ground, not a rounding error above it.
//   2. A jolt is a square wave: whole jumps and jumps back, at SHAKE_HZ.
//   3. It fades: the last jumps are smaller than the first, and it ends.
//   4. It never exceeds SHAKE_TILES, in either direction.

globalThis.print = () => {};
const SELFTEST = process.argv.includes("--selftest");

const { WorldShake, SHAKE_TILES, SHAKE_HZ, ELEVATOR_SHAKE_SECONDS }
  = await import("../Assets/Scripts/play/WorldShake.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

function run(seconds, fps) {
  const s = new WorldShake();
  s.start(seconds);
  const dt = 1 / fps;
  const out = [];
  for (let t = 0; t < seconds + 0.2; t += dt) {
    out.push(s.offset());
    s.step(dt);
  }
  return { frames: out, shake: s };
}

console.log("=== still until asked ===");
{
  const s = new WorldShake();
  check("no offset before a start", s.offset() === 0 && !s.running());
  s.step(1 / 60);
  check("stepping a still world leaves it still", s.offset() === 0);
  s.start(0);
  check("a jolt of no length is no jolt", s.offset() === 0 && !s.running());
}

console.log("=== a lift's jolt ===");
{
  const { frames, shake } = run(ELEVATOR_SHAKE_SECONDS, 60);
  check("it starts at full size, upward", Math.abs(frames[0] - SHAKE_TILES) < 1e-9, "" + frames[0]);
  let worst = 0;
  let signChanges = 0;
  for (let i = 1; i < frames.length; i++) {
    worst = Math.max(worst, Math.abs(frames[i]));
    if (frames[i] !== 0 && frames[i - 1] !== 0 && Math.sign(frames[i]) !== Math.sign(frames[i - 1])) {
      signChanges++;
    }
  }
  check("it never exceeds SHAKE_TILES", worst <= SHAKE_TILES + 1e-9, "" + worst);
  // Two sign changes per cycle, SHAKE_HZ cycles a second, for the whole second.
  const expected = Math.round(2 * SHAKE_HZ * ELEVATOR_SHAKE_SECONDS);
  check("it jumps at SHAKE_HZ", Math.abs(signChanges - expected) <= 2, signChanges + " vs " + expected);
  const early = Math.abs(frames[Math.floor(frames.length * 0.1)]);
  const late = Math.abs(frames[Math.floor(frames.length * 0.6)]);
  check("it fades", late < early && late > 0, early + " -> " + late);
  check("it ends", !shake.running() && frames[frames.length - 1] === 0);
}

console.log("=== a square wave, not a wobble ===");
{
  const { frames } = run(0.5, 240);
  // Within one half-cycle every sample has the same sign: no easing through zero.
  const half = Math.floor(240 / (SHAKE_HZ * 2));
  let eased = false;
  for (let i = 1; i < half - 1; i++) {
    if (Math.sign(frames[i]) !== Math.sign(frames[0])) { eased = true; }
  }
  check("the first half-cycle holds its sign", !eased);
}

if (SELFTEST) {
  // "It never exceeds SHAKE_TILES" would pass for a shake that did nothing at
  // all; the claim that it starts at full size is what makes it bite.
  const { frames } = run(1, 60);
  check("SELFTEST the jolt is not zero", frames.some((f) => f !== 0));
  // And a jolt asked for twice restarts rather than stacking.
  const s = new WorldShake();
  s.start(1);
  s.step(0.9);
  s.start(1);
  check("SELFTEST a restart is full size again", Math.abs(Math.abs(s.offset()) - SHAKE_TILES) < 1e-9, "" + s.offset());
}

console.log("\nWORLDSHAKE  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
