// Where the graphics page hangs: beside the world, never over its middle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/sidepanel.test.mjs [--selftest]
//
// The OPTION page is painted on the Game Boy screen, which hangs on the line
// of sight 58 cm out and is 22.6 degrees wide -- wider than the display's own
// comfortable half-field is deep. So while you change TILT or COLOUR you are
// looking at the page and not at the thing the page is changing: "het menu zit
// heel erg in je face als je met de graphics settings bezig bent".
//
// This holds the geometry of the fix. It is a claim about what the wearer can
// see through a 30-degree window, so a comment cannot hold it and a screenshot
// cannot either: the awkward cases -- the world behind him, no world at all,
// the world he is standing inside -- never show up in the one screenshot
// anybody takes.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

// Enough of the Lens runtime for the two view modules to load. Neither pure
// function touches any of it; the class bodies that do are never called here.
class V3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  distance(o) {
    const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
globalThis.vec3 = V3;
globalThis.quat = { angleAxis: (a, axis) => ({ angle: a, axis: axis, multiply: (o) => o }) };

const S = await import("../Assets/Scripts/play/screen/SidePanelPlacement.ts");
const {
  sidePanelSpot, sidePanelHalfDegrees, sideGlyphDegrees,
  SIDE_LEFT, SIDE_RIGHT, SIDE_NONE,
  SIDE_REACH_CM, SIDE_WIDTH_CM, SIDE_GAP_DEGREES, SIDE_MAX_OFFSET_DEGREES,
  SIDE_BEHIND_DEGREES, SIDE_NEAR_CM,
} = S;
const { faceEyeAngles, flatHeading } =
  await import("../Assets/Scripts/play/screen/PanelAnchor.ts");
const { DISPLAY_HALF_FOV_DEGREES } =
  await import("../Assets/Scripts/play/screen/MessagePanelView.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

const DEG = 180 / Math.PI;
const EYE = [0, 0, 0];
const AHEAD = [0, 0, -1];
const UP = [0, 1, 0];
/** A table: 105 cm out, 38 cm below the eye, which is where the lens parks it. */
const TABLE = [0, -38, -105];
/** Half of the 70 cm plate the lens draws at the standard scale. */
const PLATE_HALF_CM = 35;
const PANEL_HALF_CM = SIDE_WIDTH_CM / 2;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function length(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
/** The horizontal unit direction of a vector, as [x, z]. */
function flat(v) {
  const l = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
  return [v[0] / l, v[2] / l];
}
/** The angle between two directions, seen from above, in degrees. */
function bearingBetween(a, b) {
  const A = flat(a);
  const B = flat(b);
  let c = A[0] * B[0] + A[1] * B[1];
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  return Math.acos(c) * DEG;
}
/** How far a direction lies to the wearer's right, signed. */
function lateral(v, look) {
  const f = flat(look);
  return v[0] * -f[1] + v[2] * f[0];
}
/** The signed angle from the wearer's heading to a direction: + is to the right. */
function turnDegrees(v, look) {
  const f = flat(look);
  const forward = v[0] * f[0] + v[2] * f[1];
  return Math.atan2(lateral(v, look), forward) * DEG;
}
function spot(look, anchor, plateHalfCm) {
  return sidePanelSpot(EYE, look, UP, anchor,
                       plateHalfCm === undefined ? PLATE_HALF_CM : plateHalfCm,
                       PANEL_HALF_CM, SIDE_REACH_CM);
}

console.log("=== the page's own size, before anything is placed ===");
{
  const halfDeg = sidePanelHalfDegrees(PANEL_HALF_CM, SIDE_REACH_CM);
  console.log("  the page is " + (halfDeg * 2).toFixed(1) + " deg wide, one glyph " +
              sideGlyphDegrees(SIDE_WIDTH_CM, SIDE_REACH_CM).toFixed(2) + " deg");
  // The message panel's own rule, from test/messagepanel.test.mjs: a glyph
  // under a degree across cannot be read on the glasses. The side page is
  // smaller than the Game Boy screen and has to answer to it too.
  check("one glyph on the side page is big enough to read",
        sideGlyphDegrees(SIDE_WIDTH_CM, SIDE_REACH_CM) > 1.0,
        sideGlyphDegrees(SIDE_WIDTH_CM, SIDE_REACH_CM).toFixed(2) + " deg");
  // The cap is the display's own half-field, and it is stated in two files.
  // If either moves, this fails rather than the glasses.
  check("the page never goes further out than the display's own half-field",
        SIDE_MAX_OFFSET_DEGREES === DISPLAY_HALF_FOV_DEGREES,
        SIDE_MAX_OFFSET_DEGREES + " vs " + DISPLAY_HALF_FOV_DEGREES);
  // If the page's own half-width plus the gap ever exceeded the cap, the
  // clamp would push it back over the world's middle -- the very thing it
  // exists to clear.
  check("...and it is still wide enough to clear the middle of the view",
        halfDeg + SIDE_GAP_DEGREES <= SIDE_MAX_OFFSET_DEGREES,
        (halfDeg + SIDE_GAP_DEGREES).toFixed(1) + " vs " + SIDE_MAX_OFFSET_DEGREES);
}

console.log("=== a table in front of the wearer ===");
{
  const s = spot(AHEAD, TABLE);
  check("the page goes beside the world", s.beside);
  check("on the right when the wearer is looking straight at it", s.side === SIDE_RIGHT);
  const toPanel = sub(s.at, EYE);
  const toWorld = sub(TABLE, EYE);
  console.log("  the page sits " + s.offsetDegrees.toFixed(1) +
              " deg to the side, at " + s.at[0].toFixed(0) + "," +
              s.at[1].toFixed(0) + "," + s.at[2].toFixed(0));
  check("it hangs at the reading distance", Math.abs(length(toPanel) - SIDE_REACH_CM) < 0.01,
        length(toPanel).toFixed(2));
  check("the offset it reports is the angle it actually took",
        Math.abs(bearingBetween(toPanel, toWorld) - s.offsetDegrees) < 0.01,
        bearingBetween(toPanel, toWorld).toFixed(2) + " vs " + s.offsetDegrees.toFixed(2));
  // The whole point. Today the page straddles the line to the world; now its
  // near edge is clear of it.
  const halfDeg = sidePanelHalfDegrees(PANEL_HALF_CM, SIDE_REACH_CM);
  check("the page no longer covers the middle of the view",
        s.offsetDegrees - halfDeg > 0,
        "near edge " + (s.offsetDegrees - halfDeg).toFixed(1) + " deg off the world");
  // ...and the world's middle and the page are both inside one 30-degree
  // window: look halfway between them and you see the setting and the thing
  // it changes at once, which is the whole reason the page moved.
  check("the world's middle and the page fit in one look",
        s.offsetDegrees / 2 + halfDeg <= DISPLAY_HALF_FOV_DEGREES + 4 &&
        s.offsetDegrees / 2 <= DISPLAY_HALF_FOV_DEGREES,
        "half the offset is " + (s.offsetDegrees / 2).toFixed(1) + " deg");
  // It sits at the world's own height in the view rather than at eye level:
  // this game is played looking down at a table.
  const worldPitch = Math.atan2(TABLE[1], Math.sqrt(TABLE[0] * TABLE[0] + TABLE[2] * TABLE[2]));
  const panelPitch = Math.atan2(toPanel[1], Math.sqrt(toPanel[0] * toPanel[0] + toPanel[2] * toPanel[2]));
  check("it is level with the world, not with the eye",
        Math.abs(panelPitch - worldPitch) < 1e-6,
        (panelPitch * DEG).toFixed(1) + " vs " + (worldPitch * DEG).toFixed(1) + " deg");
  check("which puts it below the eye, over the table", s.at[1] < -5, s.at[1].toFixed(1));
}

console.log("=== a table-sized plate is capped by the display, a tiny one is not ===");
{
  // 70 cm of world at 105 cm subtends 37 degrees. Clearing it outright would
  // put the page past the edge of the display, so the display wins and the
  // page overlaps the world's RIM -- never its middle.
  const table = spot(AHEAD, TABLE);
  check("a table-sized plate takes the cap",
        Math.abs(table.offsetDegrees - SIDE_MAX_OFFSET_DEGREES) < 1e-9,
        table.offsetDegrees.toFixed(2));
  // A plate small enough to clear inside the cap does clear it: the rule is
  // "clear the plate, up to the display's limit", not "always 15 degrees".
  const small = spot(AHEAD, TABLE, 1);
  const halfDeg = sidePanelHalfDegrees(PANEL_HALF_CM, SIDE_REACH_CM);
  check("a tiny plate tucks the page in closer",
        small.offsetDegrees < table.offsetDegrees,
        small.offsetDegrees.toFixed(2) + " vs " + table.offsetDegrees.toFixed(2));
  check("...but never nearer than its own half-width and a gap",
        small.offsetDegrees >= halfDeg + SIDE_GAP_DEGREES - 1e-9,
        small.offsetDegrees.toFixed(2) + " vs " + (halfDeg + SIDE_GAP_DEGREES).toFixed(2));
  // A world the wearer is standing inside -- SELECT's life-size staging --
  // cannot be cleared at all, and must not throw the page out of the display
  // trying.
  const lifeSize = spot(AHEAD, TABLE, 400);
  check("a life-size world still takes the cap and no more",
        lifeSize.beside && Math.abs(lifeSize.offsetDegrees - SIDE_MAX_OFFSET_DEGREES) < 1e-9,
        lifeSize.offsetDegrees.toFixed(2));
}

console.log("=== the page takes the side of the world the wearer is not using ===");
{
  // The wearer has turned 30 degrees to the left of the world, so the world
  // sits to his right and the left of his view is empty. The page goes there.
  const look = [Math.sin(-30 / DEG), 0, -Math.cos(-30 / DEG)];
  const s = spot(look, TABLE);
  check("the world is on the wearer's right to begin with",
        turnDegrees(sub(TABLE, EYE), look) > 20,
        turnDegrees(sub(TABLE, EYE), look).toFixed(1));
  check("so the page goes to the world's left", s.side === SIDE_LEFT);
  check("which is towards the wearer, not away from him",
        Math.abs(turnDegrees(sub(s.at, EYE), look)) <
        Math.abs(turnDegrees(sub(TABLE, EYE), look)),
        turnDegrees(sub(s.at, EYE), look).toFixed(1) + " vs " +
        turnDegrees(sub(TABLE, EYE), look).toFixed(1));
  // ...and the mirror image, so this is a rule and not an accident of sign.
  const other = [Math.sin(30 / DEG), 0, -Math.cos(30 / DEG)];
  const t = spot(other, TABLE);
  check("turned the other way, the page takes the other side", t.side === SIDE_RIGHT);
  check("and lands the mirror image of the first",
        Math.abs(t.at[0] + s.at[0]) < 1e-6 && Math.abs(t.at[2] - s.at[2]) < 1e-6,
        t.at[0].toFixed(2) + " vs " + s.at[0].toFixed(2));
}

console.log("=== the awkward cases ===");
{
  // No world yet. The lens draws the page before the placer has found a
  // surface -- OPTION is reachable from the moment the world loads -- and a
  // page hung beside a world that is not there is a page in the floor.
  const none = sidePanelSpot(EYE, AHEAD, UP, null, PLATE_HALF_CM, PANEL_HALF_CM, SIDE_REACH_CM);
  check("no world placed: nothing to sit beside", !none.beside);
  check("...and no point is offered", none.at.length === 0);
  check("...and no side", none.side === SIDE_NONE);

  // The world is behind him. He turned his chair, or walked away from the
  // table. A page beside a world he cannot see is a page he cannot see.
  const behind = spot([0, 0, 1], TABLE);
  check("the world behind him: the page comes back to the line of sight", !behind.beside);
  const overShoulder = spot([Math.sin(100 / DEG), 0, -Math.cos(100 / DEG)], TABLE);
  check("...and so does one well over his shoulder", !overShoulder.beside);
  const justInside = spot([Math.sin((SIDE_BEHIND_DEGREES - 5) / DEG), 0,
                           -Math.cos((SIDE_BEHIND_DEGREES - 5) / DEG)], TABLE);
  check("...but a world merely off to one side still gets a page beside it",
        justInside.beside);

  // Standing on top of the world. The life-size staging puts the wearer
  // inside the map, where "beside" has no meaning: every direction is world.
  const under = spot(AHEAD, [0, -160, -5]);
  check("standing in the world: back to the line of sight", !under.beside,
        "at " + JSON.stringify(under.at));
  check("...and the floor is what decides it", SIDE_NEAR_CM > 0);

  // Looking straight down at the table. The flattened look vector is zero
  // here, so the heading has to come from somewhere else -- and the answer
  // must be the direction he is FACING, not the one behind him.
  const down = sidePanelSpot(EYE, [0, -1, 0], [0, 0, -1], TABLE,
                             PLATE_HALF_CM, PANEL_HALF_CM, SIDE_REACH_CM);
  check("looking straight down still puts the page beside the world", down.beside);
  check("...in front of him, not behind him", down.at[2] < 0,
        "z " + down.at[2].toFixed(1));
}

console.log("=== which way it faces ===");
{
  const s = spot(AHEAD, TABLE);
  check("it reports a facing", s.face.length === 2);
  // PanelAnchor turns [yaw, pitch] into a rotation as yaw about the world's
  // up and then pitch about the panel's own right, which sends the quad's
  // own +Z -- its face -- to this vector. It has to point at the eye.
  const yaw = s.face[0];
  const pitch = s.face[1];
  const normal = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const toEye = sub(EYE, s.at);
  const l = length(toEye);
  check("the page faces the eye",
        Math.abs(normal[0] - toEye[0] / l) < 1e-9 &&
        Math.abs(normal[1] - toEye[1] / l) < 1e-9 &&
        Math.abs(normal[2] - toEye[2] / l) < 1e-9,
        JSON.stringify(normal) + " vs " + JSON.stringify(toEye.map((v) => v / l)));
  // It looks back and up at the wearer from the table, so its pitch is
  // positive: it is tilted towards him.
  check("...which means tilted back towards him", pitch > 0, (pitch * DEG).toFixed(1));
  check("a degenerate facing is reported as none rather than as zero",
        faceEyeAngles([1, 2, 3], [1, 2, 3]).length === 0);
}

console.log("=== the heading the two surfaces share ===");
{
  // flatHeading is PanelAnchor's own rule, pulled out so the side page and
  // the line of sight cannot disagree about which way "in front" is.
  const level = flatHeading([0, 0, -1], [0, 1, 0]);
  check("a level look is its own heading",
        Math.abs(level[0]) < 1e-9 && Math.abs(level[1] + 1) < 1e-9, JSON.stringify(level));
  // Straight down: the head is pitched forward, so the up vector has fallen
  // FORWARD and is the heading. Taking its negative -- which is right when
  // looking up -- points the page at the back of the room.
  const down = flatHeading([0, -1, 0], [0, 0, -1]);
  check("looking straight down keeps the heading in front of him",
        Math.abs(down[0]) < 1e-9 && Math.abs(down[1] + 1) < 1e-9, JSON.stringify(down));
  const up = flatHeading([0, 1, 0], [0, 0, 1]);
  check("looking straight up does too",
        Math.abs(up[0]) < 1e-9 && Math.abs(up[1] + 1) < 1e-9, JSON.stringify(up));
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // The placement that shipped: the page dead on the line of sight, 26 cm
  // wide at 58 cm. Every claim above has to fail against it, or the claims
  // are not measuring anything.
  const halfOfTheOldPage = Math.atan2(13, 58) * DEG;
  check("SELFTEST the old page covers the middle of the view",
        !(0 - halfOfTheOldPage > 0));
  // A rule that always answered "to the right" would pass the straight-ahead
  // case and fail the turned one.
  const turned = spot([Math.sin(-30 / DEG), 0, -Math.cos(-30 / DEG)], TABLE);
  check("SELFTEST the side is not simply always the right", turned.side !== SIDE_RIGHT);
  // A cap of zero would put the page back on the world's middle; the test
  // that says it does not has to notice.
  const flatSpot = sidePanelSpot(EYE, AHEAD, UP, TABLE, PLATE_HALF_CM, PANEL_HALF_CM, SIDE_REACH_CM);
  check("SELFTEST the offset is a real angle, not zero", flatSpot.offsetDegrees > 5);
}

console.log((fail === 0 ? "SIDEPANEL OK" : "SIDEPANEL FAIL") +
            "  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
