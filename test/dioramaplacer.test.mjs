// Which way the world is turned when it is put down.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/dioramaplacer.test.mjs [--selftest]
//
// One function, and it is worth a suite of its own because getting it wrong is
// invisible in the preview and obvious in a chair. The lens had no heading at
// all until 9 September: the model always faced world -Z, which is exactly
// where a Lens Studio camera looks when it has no rotation of its own. So the
// preview -- where the camera starts at the origin looking down -Z -- showed a
// town facing the viewer, and every real wearer got a town facing wherever
// they happened to have started the lens.
//
// That is not only a look. UP on the d-pad is NORTH on the map, so a town
// turned ninety degrees is a d-pad turned ninety degrees: press up, walk
// sideways. "Zeker met controls kan dit verwarrend zijn."

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { DioramaPlacer, PLACE_SEARCHING, PLACE_IN_FRONT, PLACE_ON_SURFACE } =
  await import("../Assets/Scripts/play/DioramaPlacer.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/**
 * Where the map's NORTH ends up, for a given yaw.
 *
 * The map's +Z is south -- a cell's z grows with its row number and row
 * numbers grow downwards on a Gen 1 map -- so north is the model's -Z, turned
 * about the world's up axis by yaw.
 */
function northAfter(yaw) {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

console.log("=== north points away from the wearer ===");
{
  // Eight headings round the compass. For each, north must end up along the
  // wearer's own line of sight: dot(north, look) == 1.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const look = [Math.sin(angle), Math.cos(angle)];
    const yaw = DioramaPlacer.yawFacing(look[0], look[1]);
    const north = northAfter(yaw);
    const dot = north[0] * look[0] + north[1] * look[1];
    check("looking " + (angle * 180 / Math.PI).toFixed(0) + " deg puts north away from you",
          near(dot, 1, 1e-6), "dot " + dot.toFixed(4));
  }
}

console.log("=== and the old behaviour is the one special case ===");
{
  // A camera with no rotation looks down world -Z. That is the ONLY heading
  // the lens used to get right, which is why the preview never showed this.
  check("a wearer facing world -Z gets the yaw the lens always had",
        near(DioramaPlacer.yawFacing(0, -1), 0), DioramaPlacer.yawFacing(0, -1));
  // ...and a quarter turn is a quarter turn, not a mirror of one.
  const right = DioramaPlacer.yawFacing(1, 0);
  check("facing world +X turns the model a quarter", near(Math.abs(right), Math.PI / 2),
        (right * 180 / Math.PI).toFixed(1) + " deg");
  const north = northAfter(right);
  check("...the right way round", near(north[0], 1, 1e-6) && near(north[1], 0, 1e-6),
        north.map((v) => v.toFixed(3)).join(","));
}

console.log("=== the inputs that have no answer ===");
{
  // Looking straight up or straight down: the heading has no horizontal part
  // at all, and any answer is as good as another. It must not be NaN, which
  // would put the whole model at an undefined rotation and draw nothing.
  const flat = DioramaPlacer.yawFacing(0, 0);
  check("a wearer looking straight down still gets a heading", isFinite(flat), flat);
  check("...and it is the one the model already had", flat === 0);
  // Length is irrelevant: only the direction is read.
  check("the vector need not be normalised",
        near(DioramaPlacer.yawFacing(0, -12), DioramaPlacer.yawFacing(0, -1)));
  check("a tiny vector is treated as no vector",
        DioramaPlacer.yawFacing(1e-9, -1e-9) === 0);
}

console.log("=== what it says it is doing ===");
{
  // The placement step the playtest could not see. A lens that silently probes
  // and silently relocates has no placement step from the wearer's side.
  const placer = new DioramaPlacer(null, null);
  check("with no surface tracking it says it is in front of you",
        placer.state() === PLACE_IN_FRONT, placer.state());
  check("and the three states are distinct",
        PLACE_SEARCHING !== PLACE_IN_FRONT && PLACE_IN_FRONT !== PLACE_ON_SURFACE &&
        PLACE_SEARCHING !== PLACE_ON_SURFACE);
  // replace() is what OPTION -> PLACE calls. With no camera it must not throw:
  // the preview has none in some probe runs, and a throw here kills the frame.
  placer.replace();
  check("re-placing without a camera does not throw", placer.isPlaced() === false);
  check("and it says it is in front of you again", placer.state() === PLACE_IN_FRONT);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // The bug this file exists for: a yaw of zero, whatever the wearer is doing.
  let wrong = 0;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const look = [Math.sin(angle), Math.cos(angle)];
    const north = northAfter(0);
    if (north[0] * look[0] + north[1] * look[1] < 0.999) {
      wrong++;
    }
  }
  check("SELFTEST always-zero fails seven of the eight headings", wrong === 7, wrong);
}

console.log("\nDIORAMAPLACER  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
