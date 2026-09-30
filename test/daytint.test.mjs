// The hour the world is lit at, and how much colour it carries.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/daytint.test.mjs [--selftest]
//
// Both are multiplies inside the palette texture, which is built once per map,
// so neither costs a frame. What they must not do is change the world into
// something unreadable, which is what this checks.

const D = await import("../Assets/Scripts/world/DayTint.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

console.log("\n== the tint only ever takes light away ==");
{
  // A tint that ADDS light makes a night scene glow. Multiplying can only
  // subtract, which is what evening actually does.
  for (let rung = 0; rung < 3; rung++) {
    const t = D.tintFor(rung, 12);
    check("rung " + rung + " never brightens a channel",
          t.every((v) => v > 0 && v <= 1), JSON.stringify(t));
  }
  const day = D.tintFor(D.TIME_DAY, 12);
  check("DAY leaves the world exactly as it was",
        day[0] === 1 && day[1] === 1 && day[2] === 1, JSON.stringify(day));

  const dusk = D.tintFor(D.TIME_DUSK, 12);
  check("dusk keeps the reds and drops the blues", dusk[0] > dusk[2], JSON.stringify(dusk));
  const night = D.tintFor(D.TIME_NIGHT, 12);
  check("night does the opposite", night[2] > night[0], JSON.stringify(night));
  check("and night is darker overall than dusk",
        night[0] + night[1] + night[2] < dusk[0] + dusk[1] + dusk[2]);
}

console.log("\n== SYNC follows the wearer's clock ==");
{
  const at = (h) => JSON.stringify(D.tintFor(D.TIME_SYNC, h));
  check("noon is day", at(12) === JSON.stringify(D.tintFor(D.TIME_DAY, 0)));
  check("nine in the morning is day", at(9) === JSON.stringify(D.tintFor(D.TIME_DAY, 0)));
  check("seven in the evening is dusk", at(19) === JSON.stringify(D.tintFor(D.TIME_DUSK, 0)));
  check("midnight is night", at(0) === JSON.stringify(D.tintFor(D.TIME_NIGHT, 0)));
  check("three in the morning is night", at(3) === JSON.stringify(D.tintFor(D.TIME_NIGHT, 0)));
  check("seven in the morning is dusk, not day", at(7) === JSON.stringify(D.tintFor(D.TIME_DUSK, 0)));

  // Every hour must answer something, and nothing may throw.
  let bad = "";
  for (let h = -5; h < 30 && !bad; h++) {
    const t = D.tintFor(D.TIME_SYNC, h);
    if (!t || t.length !== 3 || t.some((v) => !(v > 0))) bad = "hour " + h + ": " + JSON.stringify(t);
  }
  check("every hour, even a nonsense one, gives a tint", bad === "", bad);
  check("a rung out of range falls back to day",
        JSON.stringify(D.tintFor(99, 12)) === JSON.stringify(D.tintFor(D.TIME_DAY, 0)));
}

console.log("\n== the grade ==");
{
  const grey = [128, 128, 128];
  const green = [60, 180, 90];
  const white = [255, 255, 255];
  const day = D.tintFor(D.TIME_DAY, 12);

  check("a grey stays grey however saturated",
        JSON.stringify(D.gradeColour(grey, day, 1.5)) === JSON.stringify(grey));
  check("saturation 1 changes nothing",
        JSON.stringify(D.gradeColour(green, day, 1)) === JSON.stringify(green));

  const lifted = D.gradeColour(green, day, 1.4);
  const spread = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  check("more saturation is further from grey", spread(lifted) > spread(green),
        JSON.stringify(green) + " -> " + JSON.stringify(lifted));

  // Nothing may leave the byte range, at any setting, for any colour.
  let bad = "";
  const samples = [grey, green, white, [0, 0, 0], [255, 0, 0], [10, 240, 12]];
  for (const s of samples) {
    for (const level of D.SATURATION_LEVELS) {
      for (let rung = 0; rung < 3 && !bad; rung++) {
        const out = D.gradeColour(s, D.tintFor(rung, 12), level);
        if (out.some((v) => v < 0 || v > 255 || Math.floor(v) !== v)) {
          bad = JSON.stringify(s) + " @" + level + " rung " + rung + " -> " + JSON.stringify(out);
        }
      }
    }
  }
  check("every colour at every setting stays a byte", bad === "", bad);

  // Saturation runs BEFORE the tint. The other order saturates the tint's own
  // cast and turns a mild evening into an orange filter.
  const duskLifted = D.gradeColour(grey, D.tintFor(D.TIME_DUSK, 12), 1.5);
  check("a grey at dusk carries the tint but gains no colour of its own",
        duskLifted[0] > duskLifted[2], JSON.stringify(duskLifted));
  const wrongOrder = D.gradeColour(D.gradeColour(grey, D.tintFor(D.TIME_DUSK, 12), 1), day, 1.5);
  check("and is milder than saturating the tint would have made it",
        (duskLifted[0] - duskLifted[2]) < (wrongOrder[0] - wrongOrder[2]),
        JSON.stringify(duskLifted) + " vs " + JSON.stringify(wrongOrder));
}

console.log("\n== the ladders line up ==");
{
  check("four times of day", D.TIME_LABELS.length === 4);
  check("SYNC is the last", D.TIME_SYNC === D.TIME_LABELS.length - 1);
  check("a label for every saturation level",
        D.SATURATION_LABELS.length === D.SATURATION_LEVELS.length);
  check("and the first one is untouched", D.SATURATION_LEVELS[0] === 1);
  let rising = true;
  for (let i = 1; i < D.SATURATION_LEVELS.length; i++) {
    if (D.SATURATION_LEVELS[i] <= D.SATURATION_LEVELS[i - 1]) rising = false;
  }
  check("the ladder climbs", rising);
}

if (process.argv.indexOf("--selftest") >= 0) {
  console.log("\n== Selftest ==");
  const bright = D.gradeColour([200, 200, 200], [2, 2, 2], 1);
  check("a tint that brightened would be caught by the clamp", bright[0] === 255);
}

console.log("\nDAYTINT  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
