// The hand as a joystick, and the frame it and a route put on the ground.
//
//   node --experimental-strip-types --import ./test/register.mjs test/stick.test.mjs
//
// Claims: the direction is the dominant axis outside a dead zone; the source
// presses it in the wearer's frame, undoing the view's turns; the router lets
// a held stick outrank a route and drops the route; a route knows where it
// ends; the marker's frame is a frame.

globalThis.print = () => {};

const { StickSource, stickDirection, STICK_DEADZONE_CELLS } = await import("../Assets/Scripts/play/StickSource.ts");
const { RouteSource } = await import("../Assets/Scripts/play/RouteSource.ts");
const { InputRouter, ScriptedInputSource } = await import("../Assets/Scripts/play/InputSource.ts");
const { frameVertices, MARKER_BAND } = await import("../Assets/Scripts/play/CellMarker.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}
const held = (pad) => (pad.up ? "up" : pad.down ? "down" : pad.left ? "left" : pad.right ? "right" : "");

console.log("=== the direction ===");
check("east", stickDirection(2, 0.3) === "right");
check("west", stickDirection(-1.5, 0.2) === "left");
check("south is +z", stickDirection(0.1, 1.2) === "down");
check("north is -z", stickDirection(-0.2, -3) === "up");
check("the dead zone holds nothing", stickDirection(0.3, -0.3) === "" && STICK_DEADZONE_CELLS > 0.3);
check("just past the dead zone holds", stickDirection(STICK_DEADZONE_CELLS + 0.01, 0) === "right");
check("a tie goes sideways", stickDirection(1, 1) === "right" && stickDirection(-1, -1) === "left");

console.log("=== the source ===");
{
  const s = new StickSource();
  check("idle at first", !s.isActive() && !s.isConnected() && held(s.dpad()) === "");
  check("aim answers with the direction", s.aim(3, 0) === "right" && s.isActive() && s.isConnected());
  check("and presses it", held(s.dpad()) === "right");
  s.setViewTurns(1);
  check("with the view turned once the press is turned back", held(s.dpad()) === "up", held(s.dpad()));
  s.setViewTurns(2);
  check("half a turn reverses it", held(s.dpad()) === "left");
  s.setViewTurns(0);
  check("aiming inside the dead zone lets go", s.aim(0.1, 0.1) === "" && !s.isActive() && held(s.dpad()) === "");
  s.aim(0, 2);
  s.release();
  check("release lets go", !s.isActive() && held(s.dpad()) === "" && s.heldDirection() === "");
  check("but it stays connected once used", s.isConnected());
}

console.log("=== the router ===");
{
  const thumb = new ScriptedInputSource();
  const router = new InputRouter([thumb]);
  const route = new RouteSource();
  const stick = new StickSource();
  router.setRoute(route);
  router.setStick(stick);
  route.setRoute([[5, 6], [6, 6]]);
  route.observe(4, 6, 1 / 60);
  router.update();
  check("a route walks by itself", route.isActive() && held(router.dpad()) !== "", held(router.dpad()));
  stick.aim(0, -2);
  router.update();
  check("a held stick outranks it and drops it", held(router.dpad()) === "up" && !route.isActive());
  stick.release();
  router.update();
  check("with the stick let go the thumb is back", held(router.dpad()) === "");
}

console.log("=== the destination ===");
{
  const route = new RouteSource();
  check("nowhere when idle", route.destination() === null);
  route.setRoute([[5, 6], [6, 6], [7, 6]]);
  check("the last cell of the route", JSON.stringify(route.destination()) === "[7,6]");
  route.setRoute([[5, 6]], "", [5, 5]);
  check("the person it will face wins", JSON.stringify(route.destination()) === "[5,5]");
  route.cancel();
  check("gone with the route", route.destination() === null);
}

console.log("=== the frame ===");
{
  const v = frameVertices(1, MARKER_BAND);
  check("four strips of four corners", v.length === 4 * 4 * 5);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < v.length; i += 5) {
    minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
    minZ = Math.min(minZ, v[i + 2]); maxZ = Math.max(maxZ, v[i + 2]);
  }
  check("it spans the cell", minX === -1 && maxX === 1 && minZ === -1 && maxZ === 1);
  check("it lies flat", v.every((_, i) => i % 5 !== 1 || v[i] === 0));
  check("the band is thin", MARKER_BAND > 0 && MARKER_BAND < 0.5);
}

console.log("\nSTICK  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
