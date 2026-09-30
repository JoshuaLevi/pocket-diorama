// Where the diorama has to stand for a fight to be worth watching.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battleframing.test.mjs [--selftest]
//
// The number this exists to prevent: in the 8 September preview the two
// Pokemon stood 112 cm from the eye at 6.7 cm tall -- three and a half degrees,
// a 2 cm object at arm's length. They read as specks on a table.
//
// So this does not check the transform's fields. It APPLIES the transform to
// the two cells and asks what the wearer would see: how far away, how far
// apart across the view, which one is on the left. A transform can be wrong in
// four ways at once and still have plausible-looking numbers in it.

const F = await import("../Assets/Scripts/play/BattleFraming.ts");
const A = await import("../Assets/Scripts/play/DioramaAnchor.ts");
const { readFileSync } = await import("node:fs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);

/** Puts a cell where the framing says it goes, in world space. */
function worldOf(cell, w, h, groundY, framing) {
  const local = F.cellLocal(cell, w, h);
  const lx = local[0] * framing.scale;
  const ly = groundY * framing.scale;
  const lz = local[1] * framing.scale;
  const c = Math.cos(framing.yaw);
  const s = Math.sin(framing.yaw);
  return [
    framing.position[0] + lx * c + lz * s,
    framing.position[1] + ly,
    framing.position[2] - lx * s + lz * c,
  ];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The wearer's own axes, from a flat forward. */
function viewAxes(forward) {
  const l = Math.sqrt(forward[0] * forward[0] + forward[2] * forward[2]);
  const f = [forward[0] / l, 0, forward[2] / l];
  // Right-handed, +Y up: right = up x forward.
  return { forward: f, right: [-f[2], 0, f[0]] };
}

const W = 20;
const H = 18;
const GROUND = 0;

/** The arena BattleArena would hand over: three cells apart along a facing. */
function arena(facing) {
  const mine = [8, 9];
  if (facing === "up") return [mine, [8, 6]];
  if (facing === "down") return [mine, [8, 12]];
  if (facing === "left") return [mine, [5, 9]];
  return [mine, [11, 9]];
}

console.log("\n== what the wearer would actually see ==");
for (const facing of ["up", "down", "left", "right"]) {
  for (const heading of [[0, 0, -1], [1, 0, 0], [0.7, 0, 0.7], [-1, 0, 0]]) {
    const [mine, theirs] = arena(facing);
    const eye = [12, 160, -30];
    const framing = F.frameBattle(mine, theirs, W, H, GROUND, eye, heading);
    const a = worldOf(mine, W, H, GROUND, framing);
    const b = worldOf(theirs, W, H, GROUND, framing);
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const axes = viewAxes(heading);

    const away = len(sub(middle, eye));
    if (!near(away, F.VIEW_DISTANCE_CM, 0.05)) {
      check("the pair sits " + F.VIEW_DISTANCE_CM + " cm away (" + facing + ", heading " +
            heading.join(",") + ")", false, "it is " + away.toFixed(1) + " cm");
      continue;
    }
    // Apparent separation: the part of the gap that runs across the view.
    const gap = sub(b, a);
    const across = Math.abs(dot(gap, axes.right));
    if (!near(across, F.VIEW_GAP_CM, 0.05)) {
      check("the pair looks " + F.VIEW_GAP_CM + " cm apart (" + facing + ")", false,
            "it is " + across.toFixed(1) + " cm");
      continue;
    }
    // Yours on the left, theirs on the right: the cartridge's own arrangement.
    if (dot(sub(a, middle), axes.right) >= 0) {
      check("your own Pokemon is on the left (" + facing + ")", false,
            "it is on the right");
      continue;
    }
    // And theirs further away than yours -- the "three-quarter", not "side on".
    if (len(sub(b, eye)) <= len(sub(a, eye))) {
      check("theirs stands further off than yours (" + facing + ")", false,
            "yours " + len(sub(a, eye)).toFixed(1) + " theirs " + len(sub(b, eye)).toFixed(1));
      continue;
    }
  }
}
check("every facing, from every heading, frames the same shot", fail === 0);

console.log("\n== the shot itself ==");
{
  const [mine, theirs] = arena("up");
  const eye = [0, 150, 0];
  const framing = F.frameBattle(mine, theirs, W, H, GROUND, eye, [0, 0, -1]);
  const a = worldOf(mine, W, H, GROUND, framing);
  const b = worldOf(theirs, W, H, GROUND, framing);
  const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

  // Below the line of sight, so you look DOWN at the fight.
  const down = eye[1] - middle[1];
  const expected = F.VIEW_DISTANCE_CM * Math.sin(F.VIEW_DROP_DEGREES * Math.PI / 180);
  check("the fight sits below the line of sight", near(down, expected, 0.05),
        down.toFixed(1) + " cm, wanted " + expected.toFixed(1));

  // The scale has to be a real magnification of the tabletop, not a nudge.
  check("the world is scaled up for the shot", framing.scale > 4,
        "scale " + framing.scale.toFixed(2));

  // A Pokemon is about 1.9 units tall, so check it reads at a sensible angle.
  //
  // The floor is 6 degrees, not the 8 it started as, and the reason is a
  // genuine trade rather than a moved goalpost: the town is on the SAME scale
  // as the Pokemon, so every degree given to a Charmander is a degree given to
  // the houses next to it. At 8 degrees the houses were half a metre across and
  // standing in the room. 6 is still nearly twice the 3.5 degrees the plain
  // tabletop gave, which is what this test exists to keep us above.
  const monCm = 1.9 * framing.scale;
  const degrees = 2 * Math.atan2(monCm / 2, F.VIEW_DISTANCE_CM) * 180 / Math.PI;
  check("a Pokemon subtends more than 6 degrees", degrees > 6,
        degrees.toFixed(1) + " deg (" + monCm.toFixed(1) + " cm at " + F.VIEW_DISTANCE_CM + " cm)");
  check("and comfortably more than the tabletop's 3.5", degrees > 3.5 * 1.5,
        degrees.toFixed(1) + " deg");
  check("and less than 30, so both still fit", degrees < 30, degrees.toFixed(1) + " deg");
}

console.log("\n== the fight happens where the world already is ==");
{
  // Two playtests, the same mistake from opposite ends. First the fight hung
  // ABOVE the table -- it was staged 30 cm below the eye and a table is 45 to
  // 90 below. Then, once it was dropped to the table, it arrived TOO CLOSE:
  // "veel dichter bij mij, wat niet comfortabel was". A shot that insists on
  // 65 cm has to travel to 65 cm however far away the wearer put the world.
  //
  // So the placement wins. The world is turned and scaled, and not moved.
  const [mine, theirs] = arena("up");
  const eye = [0, 150, 0];
  const heading = [0, 0, -1];
  const middleOf = (f, g) => {
    const a = worldOf(mine, W, H, g, f);
    const b = worldOf(theirs, W, H, g, f);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  };
  const loose = F.frameBattle(mine, theirs, W, H, GROUND, eye, heading);
  const wantedAngle =
    2 * Math.atan2(1.9 * loose.scale / 2, F.VIEW_DISTANCE_CM) * 180 / Math.PI;

  // A table in front of the wearer, a table further off, and a world held
  // close: three placements, three fights, each one where it was put.
  const places = [
    ["on a table 45 cm down, 60 out", [0, 105, -60]],
    ["on a low table further off", [0, 90, -110]],
    ["held out at arm's length", [0, 130, -45]],
    ["off to one side", [70, 110, -50]],
  ];
  for (const [what, rest] of places) {
    const f = F.frameBattle(mine, theirs, W, H, GROUND, eye, heading, rest);
    const middle = middleOf(f, GROUND);
    check("the fight " + what + " happens there",
          near(middle[0], rest[0], 0.05) && near(middle[1], rest[1], 0.05) &&
          near(middle[2], rest[2], 0.05),
          "the pair is at " + middle.map((v) => v.toFixed(1)).join(",") +
          ", the world at " + rest.join(","));
    // ...and looks the same size from wherever that is. This is the whole
    // reason the scale is not simply left alone: a fight twice as far away
    // has to be twice as big to read as the same shot.
    const awayCm = len(sub(middle, eye));
    const angle = 2 * Math.atan2(1.9 * f.scale / 2, awayCm) * 180 / Math.PI;
    check("...and a Pokemon looks the same size from " + awayCm.toFixed(0) + " cm",
          near(angle, wantedAngle, 0.2), angle.toFixed(1) + " deg, wanted " +
          wantedAngle.toFixed(1));
  }

  // The one placement that IS overruled: a world dropped at the wearer's nose.
  // A fight inside their head is not a placement, it is a mistake.
  const nose = F.frameBattle(mine, theirs, W, H, GROUND, eye, heading, [0, 150, -3]);
  const noseMiddle = middleOf(nose, GROUND);
  check("a world at the wearer's nose is pushed out to the guard",
        len(sub(noseMiddle, eye)) >= F.MIN_REACH_CM - 0.05,
        len(sub(noseMiddle, eye)).toFixed(1) + " cm");
  check("...and no further than the guard", len(sub(noseMiddle, eye)) < F.MIN_REACH_CM + 1);

  // And with no placement known, the old shot exactly.
  const f0 = F.frameBattle(mine, theirs, W, H, GROUND, eye, heading, null);
  check("with no placement known, nothing changes",
        near(f0.scale, loose.scale) && near(f0.position[1], loose.position[1]));

  // The bug this replaces, stated: the old shot ignored the table entirely.
  const wasAt = middleOf(loose, GROUND)[1];
  check("which is the bug: the old shot floated above a 45 cm table",
        wasAt > eye[1] - 45 + 10,
        "it hung at " + wasAt.toFixed(1) + ", the table at " + (eye[1] - 45));
}

console.log("\n== a fight on a big map: on the world, not on the root ==");
{
  // The third playtest, in Joshua's words: "een gevecht gebeurt heel ergens
  // anders dan op de exacte locatie van waar de game zich hoort af te spelen."
  //
  // A scrolling diorama has TWO world positions and only one of them is the
  // world. The map scrolls by moving the ROOT --
  //
  //     root = anchor - R(yaw) * (playerLocal * scale)
  //
  // -- so that the player's own cell always lands on the anchor. playerLocal
  // is that cell in map-centred units, so it ranges over the whole map, and
  // the root is pushed wherever that sum needs it. On a route it is metres
  // from anything the wearer can see. The anchor is the middle of the play
  // area; the root is bookkeeping.
  //
  // Route 17 is the worst of them and it is not a corner case: 10 x 72 tiles,
  // and the plate holds ZOOM_REFERENCE_TILES = 20 across its 70 cm, so
  // 3.5 cm a tile.
  const W = 10;
  const H = 72;
  const SCALE = 70 / 20;
  const cell = [5, 65];          // two thirds down the route
  const yaw = 0.6;               // a wearer sitting at an angle to the table
  const anchor = [0, 105, -60];  // the table: 45 cm below a 150 cm eye, 60 out
  const eye = [0, 150, 0];
  const heading = [0, 0, -1];
  const GROUND_LOCAL = 0;

  // The scroll, exactly as the lens runs it.
  const local = A.playerOffsetLocal(cell, W, H, SCALE);
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const spun = [local[0] * c + local[2] * sn, local[1], -local[0] * sn + local[2] * c];
  const root = [anchor[0] - spun[0], anchor[1] - spun[1], anchor[2] - spun[2]];

  // The premise, measured rather than asserted: this is how far apart the two
  // answers are on a real map. If this number ever collapses the rest of this
  // section proves nothing, so it is checked first.
  const drift = len(sub(root, anchor));
  check("the root sits metres from the world on Route 17", drift > 300,
        "only " + drift.toFixed(1) + " cm apart");

  // The reconstruction the lens falls back on when it has no anchor: the same
  // sum run backwards. It has to land back on the anchor exactly, or the
  // fallback is its own version of this bug.
  const rebuilt = [root[0] + spun[0], root[1] + spun[1], root[2] + spun[2]];
  check("the scroll runs backwards to the anchor exactly",
        near(rebuilt[0], anchor[0], 1e-9) && near(rebuilt[1], anchor[1], 1e-9) &&
        near(rebuilt[2], anchor[2], 1e-9),
        "it came back to " + rebuilt.map((v) => v.toFixed(4)).join(","));

  // The fight itself: the player's cell and the one three tiles ahead of it.
  const mine = cell;
  const theirs = [cell[0], cell[1] - 3];
  const middleOf = (rest) => {
    const f = F.frameBattle(mine, theirs, W, H, GROUND_LOCAL, eye, heading, rest);
    const a = worldOf(mine, W, H, GROUND_LOCAL, f);
    const b = worldOf(theirs, W, H, GROUND_LOCAL, f);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  };

  // Tolerance: frameBattle solves for the root that puts the pair's middle on
  // the rest point, so the two agree by algebra and the only error is double
  // rounding on numbers of order 300 cm -- about 1e-13. Half a millimetre is
  // a thousandfold margin, and it is the same 0.05 the placement checks above
  // already use.
  const TOL = 0.05;
  const onAnchor = middleOf(anchor);
  check("the fight is staged where the world is",
        near(onAnchor[0], anchor[0], TOL) && near(onAnchor[1], anchor[1], TOL) &&
        near(onAnchor[2], anchor[2], TOL),
        "it happened at " + onAnchor.map((v) => v.toFixed(1)).join(","));
  check("...and not on the root, " + drift.toFixed(0) + " cm away",
        len(sub(onAnchor, root)) > 300,
        "it is " + len(sub(onAnchor, root)).toFixed(1) + " cm from the root");

  // The bug, stated: staging on the root is what shipped, and this is where it
  // put the fight.
  const onRoot = middleOf(root);
  check("which is the bug: a fight staged on the root happens metres away",
        len(sub(onRoot, anchor)) > 300,
        "it was only " + len(sub(onRoot, anchor)).toFixed(1) + " cm off");

  // And it is not one unlucky cell. Every cell on the route scrolls the root
  // somewhere else -- that is what makes the root useless -- while the anchor
  // stays put, so the fight has to stay put with it. Walk the whole route and
  // watch both numbers.
  let worst = 0;
  let leastDrift = Infinity;
  for (let ty = 1; ty < H - 1; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const here = [tx, ty];
      const ahead = [tx, ty - 1];
      const f = F.frameBattle(here, ahead, W, H, GROUND_LOCAL, eye, heading, anchor);
      const a = worldOf(here, W, H, GROUND_LOCAL, f);
      const b = worldOf(ahead, W, H, GROUND_LOCAL, f);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const off = len(sub(m, anchor));
      if (off > worst) worst = off;
      // Where the root would have put it, from this cell.
      const l = A.playerOffsetLocal(here, W, H, SCALE);
      const sp = [l[0] * c + l[2] * sn, l[1], -l[0] * sn + l[2] * c];
      const r = [anchor[0] - sp[0], anchor[1] - sp[1], anchor[2] - sp[2]];
      const d = len(sub(r, anchor));
      if (d < leastDrift) leastDrift = d;
    }
  }
  check("every cell on the route stages its fight on the same spot", worst <= TOL,
        "worst was " + worst.toFixed(3) + " cm");
  check("while the root wanders the whole route", leastDrift < 20,
        "the root never came within " + leastDrift.toFixed(1) + " cm of the anchor");

  // No world placed yet: there is no anchor to stage on, and the honest answer
  // is to say so rather than to hand over a root. frameBattle reads null as
  // "no placement known" and puts the shot in front of the wearer.
  const nowhere = F.frameBattle(mine, theirs, W, H, GROUND_LOCAL, eye, heading, null);
  check("with no world placed the shot still frames",
        nowhere.position.every((v) => isFinite(v)) && nowhere.scale > 0);
}

console.log("\n== the lens is wired to the world, not to the root ==");
{
  const lens = readFileSync(new URL("../Assets/Scripts/PokemonAR.ts", import.meta.url), "utf8");
  const stage = readFileSync(new URL("../Assets/Scripts/play/BattleStage.ts", import.meta.url), "utf8");

  // Sliced rather than pattern-matched across the whole file: what matters is
  // what THIS function hands to frameBattle, and a regex with a character
  // budget would quietly stop biting the next time the comment above the call
  // grows.
  const body = (name) => {
    const from = lens.indexOf("private " + name + "(");
    if (from < 0) return "";
    const end = lens.indexOf("\n  }\n", from);
    return end < 0 ? lens.slice(from) : lens.slice(from, end);
  };
  const shot = body("frameBattleShot");
  check("frameBattleShot exists to be checked", shot.length > 0);
  check("the fight's rest point is the diorama's centre",
        shot.indexOf("this.dioramaCentre()") >= 0);
  check("and the root's own transform is not offered as one",
        shot.indexOf("restingAt") < 0 && /^\s*restingAt\(\)/m.test(stage) === false);
  check("the centre is the anchor, which is what the scroll aims at",
        /dioramaCentre\(\)\s*:\s*number\[\][\s\S]{0,400}?this\.dioramaAnchor/.test(lens));
  check("and it falls back on the scroll's own offset, run backwards",
        /dioramaCentre\(\)\s*:\s*number\[\][\s\S]{0,900}?playerOffsetLocal\(/.test(lens));
  check("the scroll and the centre share one formula",
        /applyDioramaScroll\(\)[\s\S]{0,900}?playerOffsetLocal\(/.test(lens));
}

console.log("\n== the awkward inputs ==");
{
  const [mine, theirs] = arena("up");
  // Looking straight down at the table: the heading has no horizontal part.
  const f = F.frameBattle(mine, theirs, W, H, GROUND, [0, 150, 0], [0, -1, 0]);
  const ok = f.position.every((v) => isFinite(v)) && isFinite(f.yaw) && f.scale > 0;
  check("a wearer looking straight down still gets a framing", ok, JSON.stringify(f));

  // Two Pokemon on the same cell: BattleArena should never, but a divide by
  // zero here would put the world at infinity.
  const same = F.frameBattle([8, 9], [8, 9], W, H, GROUND, [0, 150, 0], [0, 0, -1]);
  check("a zero-length arena does not divide by zero",
        same.position.every((v) => isFinite(v)) && same.scale > 0, JSON.stringify(same));

  // A fight on an upper floor is metres above the mesh origin.
  const high = F.frameBattle(mine, theirs, W, H, 12, [0, 150, 0], [0, 0, -1]);
  const a = worldOf(mine, W, H, 12, high);
  const b = worldOf(theirs, W, H, 12, high);
  const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  check("a fight above the ground is still framed at the right distance",
        near(len(sub(middle, [0, 150, 0])), F.VIEW_DISTANCE_CM, 0.05));
}

if (process.argv.indexOf("--selftest") >= 0) {
  console.log("\n== Selftest: the checks must reject the shot we had ==");
  // The 8 September preview: 112 cm away at scale 3.5.
  const monCm = 1.9 * 3.5;
  const degrees = 2 * Math.atan2(monCm / 2, 112) * 180 / Math.PI;
  check("the old framing would fail the 8-degree check", degrees < 8,
        degrees.toFixed(1) + " deg -- this is what a speck looks like");
  // And a side-on shot would put them level, not one behind the other.
  check("AXIS_DEGREES is a three-quarter, not a side-on or a straight-on",
        F.AXIS_DEGREES > 15 && F.AXIS_DEGREES < 75, "" + F.AXIS_DEGREES);

  // And the big-map section has to be able to fail. Its whole load is carried
  // by one predicate -- "the pair's middle landed on the anchor" -- so feed it
  // the wrong staging point and check the predicate says no. A check that
  // cannot distinguish the shipped bug from the fix is decoration.
  {
    const W = 10;
    const H = 72;
    const SCALE = 70 / 20;
    const cell = [5, 65];
    const yaw = 0.6;
    const anchor = [0, 105, -60];
    const local = A.playerOffsetLocal(cell, W, H, SCALE);
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const spun = [local[0] * c + local[2] * sn, local[1], -local[0] * sn + local[2] * c];
    const root = [anchor[0] - spun[0], anchor[1] - spun[1], anchor[2] - spun[2]];
    const mine = cell;
    const theirs = [cell[0], cell[1] - 3];
    const f = F.frameBattle(mine, theirs, W, H, 0, [0, 150, 0], [0, 0, -1], root);
    const a = worldOf(mine, W, H, 0, f);
    const b = worldOf(theirs, W, H, 0, f);
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const missed = len(sub(middle, anchor));
    check("[selftest] staging on the root is rejected by the same check", missed > 0.05,
          "the check would have passed a fight " + missed.toFixed(1) + " cm off");
    check("[selftest] a zero scroll offset would make the section vacuous",
          len(sub(root, anchor)) > 300);
  }
}

console.log("\nBATTLEFRAMING  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
