// The SILPH SCOPE's fade: the ghost washes out, the species washes back in.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/unveil.test.mjs [--selftest]
//
// The cartridge reveals MAROWAK by walking its palette register to white,
// swapping the picture behind the blank frame and walking it back
// (ghost_marowak_anim.asm). Four claims:
//
//   1. Only the ghost-to-species change fades. A switch, a faint, a new foe
//      and the first picture of a battle are all cuts, as they are in Red.
//   2. The swap happens at the WHITE, never before it: the species is not on
//      screen until the ghost has fully washed out.
//   3. The wash is quantised to the four values a DMG palette register holds,
//      because every step of it builds a texture.
//   4. A palette washed all the way is white, and washed none at all is
//      itself, so nothing about a normal battle's colour can change.

globalThis.print = () => {};

const SELFTEST = process.argv.includes("--selftest");

const { Unveil, washedPalette, UNVEIL_IN_SECONDS, UNVEIL_OUT_SECONDS, UNVEIL_STEPS }
  = await import("../Assets/Scripts/play/battle/Unveil.ts");
const { GHOST_PICTURE } = await import("../Assets/Scripts/play/battle/Ghost.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** Runs the fade at 60 frames a second and records every frame. */
function run(seconds, wanted, start) {
  const u = new Unveil();
  if (start !== undefined) {
    u.step(0, start);
  }
  const frames = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    u.step(dt, wanted);
    frames.push({ picture: u.picture(), wash: u.wash(), running: u.running() });
  }
  return frames;
}

console.log("=== a plain battle never fades ===");
{
  const u = new Unveil();
  u.step(0, "RATTATA");
  check("the first picture is up at once", u.picture() === "RATTATA" && u.wash() === 0);
  u.step(1 / 60, "PIDGEY");
  check("a switch is a cut", u.picture() === "PIDGEY" && u.wash() === 0 && !u.running());
  u.step(1 / 60, "");
  check("and so is an empty field", u.picture() === "" && u.wash() === 0);
}

console.log("=== the ghost reveals ===");
{
  const frames = run(UNVEIL_OUT_SECONDS + UNVEIL_IN_SECONDS + 0.2, "MAROWAK", GHOST_PICTURE);
  const first = frames[0];
  check("the ghost is still on screen when it starts", first.picture === GHOST_PICTURE, first.picture);
  check("and it is fading", first.running);

  // Claim 2: the species may not appear before the ghost is white.
  let swapAt = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].picture !== GHOST_PICTURE) { swapAt = i; break; }
  }
  check("the species does arrive", swapAt > 0, "" + swapAt);
  check("the swap is at the white",
        frames[swapAt - 1].wash >= 1 - 1e-9, "" + frames[swapAt - 1].wash);
  check("the ghost's last frames are the whitest",
        frames[swapAt - 1].wash >= frames[Math.floor(swapAt / 2)].wash);

  // Claim 3: four steps, and no more.
  const values = {};
  for (const f of frames) { values["" + f.wash] = true; }
  const distinct = Object.keys(values).length;
  check("the wash takes at most five values, zero included",
        distinct <= UNVEIL_STEPS + 1, distinct + ": " + Object.keys(values).join(","));
  for (const v of Object.keys(values)) {
    const n = Number(v) * UNVEIL_STEPS;
    check("every value is a whole step (" + v + ")", Math.abs(n - Math.round(n)) < 1e-9);
  }

  const last = frames[frames.length - 1];
  check("it ends on the species, unwashed", last.picture === "MAROWAK" && last.wash === 0);
  check("and it is over", !last.running);
}

console.log("=== the fade does not hold the picture hostage ===");
{
  // The foe faints mid-fade: the picture that comes out is the one asked for
  // last, never the ghost.
  const u = new Unveil();
  u.step(0, GHOST_PICTURE);
  u.step(UNVEIL_OUT_SECONDS / 2, "MAROWAK");
  u.step(UNVEIL_OUT_SECONDS, "MAROWAK");
  u.step(UNVEIL_IN_SECONDS, "MAROWAK");
  u.step(1 / 60, "");
  check("an empty field wins in the end", u.picture() === "" && !u.running());
}

console.log("=== the palette ===");
{
  const grey = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]];
  const none = washedPalette(grey, 0);
  check("washed none at all is itself", JSON.stringify(none) === JSON.stringify(grey));
  const all = washedPalette(grey, 1);
  check("washed all the way is white",
        JSON.stringify(all) === JSON.stringify([[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255]]));
  const half = washedPalette(grey, 0.5);
  check("halfway is halfway", half[3][0] === 128 && half[2][0] === 170, JSON.stringify(half));
  check("it never darkens a colour",
        half[0][0] >= grey[0][0] && half[1][0] >= grey[1][0] && half[3][0] >= grey[3][0]);
}

if (SELFTEST) {
  // The claim "the swap is at the white" is only worth something if a swap
  // before the white would fail it. Everything up to the first white frame
  // must be the ghost; after it the species washes back in, and a frame of
  // species at a half wash THERE is the effect working.
  const frames = run(UNVEIL_OUT_SECONDS + UNVEIL_IN_SECONDS, "MAROWAK", GHOST_PICTURE);
  let white = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].wash >= 1 - 1e-9) { white = i; break; }
  }
  check("SELFTEST the ghost does reach white", white >= 0, "" + white);
  let early = false;
  for (let i = 0; i < white; i++) {
    if (frames[i].picture !== GHOST_PICTURE) { early = true; }
  }
  check("SELFTEST nothing but the ghost is drawn before the white", !early);
  // And a fade that never ended would fail this one.
  const long = run(10, "MAROWAK", GHOST_PICTURE);
  check("SELFTEST the fade ends", !long[long.length - 1].running);
}

console.log("\nUNVEIL  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
