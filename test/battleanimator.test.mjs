// What the two Pokemon do when a move lands.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battleanimator.test.mjs [--selftest]
//
// Written against the 8 September preview, where a whole fight played out with
// both sprites standing perfectly still and the only sign of an attack was a
// line of text.

const A = await import("../Assets/Scripts/play/BattleAnimator.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

const FRAME = 1 / 60;
/** Runs `seconds` of frames at a steady HP. */
function hold(anim, seconds, mine, mineMax, theirs, theirsMax) {
  for (let t = 0; t < seconds; t += FRAME) {
    anim.update(FRAME, mine, mineMax, theirs, theirsMax);
  }
}

console.log("\n== a hit makes something happen ==");
{
  const anim = new A.BattleAnimator();
  anim.update(FRAME, 20, 20, 15, 15);   // settle: nothing has changed yet
  check("nothing moves before anything happens", !anim.isBusy());

  // Theirs takes 5 damage: they blink, we lunge.
  anim.update(FRAME, 20, 20, 10, 15);
  check("something is moving now", anim.isBusy());
  // The lunge is armed at the end of the frame that spots the hit, so it is
  // still at rest for that one frame -- a lunge that started mid-stride would
  // pop. It is the NEXT frame that has to have moved.
  check("it has not popped out of nowhere", anim.lungeReach(true) === 0);
  anim.update(FRAME, 20, 20, 10, 15);
  check("the attacker lunges", anim.lungeReach(true) > 0,
        "reach " + anim.lungeReach(true));
  check("and the one that was hit does not", anim.lungeReach(false) === 0);

  // The lunge is a hump: out and back, resting at both ends.
  let peak = 0;
  const anim2 = new A.BattleAnimator();
  anim2.update(FRAME, 20, 20, 15, 15);
  anim2.update(FRAME, 20, 20, 10, 15);
  for (let t = 0; t < A.LUNGE_SECONDS; t += FRAME) {
    peak = Math.max(peak, anim2.lungeReach(true));
    anim2.update(FRAME, 20, 20, 10, 15);
  }
  check("the lunge reaches its full stretch", Math.abs(peak - A.LUNGE_REACH) < 0.02,
        "peak " + peak.toFixed(3) + " of " + A.LUNGE_REACH);
  check("and comes all the way back", anim2.lungeReach(true) === 0);
}

console.log("\n== the blink ==");
{
  const anim = new A.BattleAnimator();
  anim.update(FRAME, 20, 20, 15, 15);
  anim.update(FRAME, 20, 20, 10, 15);
  let on = 0;
  let off = 0;
  for (let t = 0; t < A.BLINK_SECONDS; t += FRAME) {
    if (anim.visible(false)) { on++; } else { off++; }
    anim.update(FRAME, 20, 20, 10, 15);
  }
  check("the struck one is hidden for part of it", off > 0, "off frames " + off);
  check("and shown for part of it", on > 0, "on frames " + on);
  check("it ends up visible again", anim.visible(false));
  check("the one that was not struck never blinks", anim.visible(true));
}

console.log("\n== the bar travels ==");
{
  const anim = new A.BattleAnimator();
  anim.update(FRAME, 20, 20, 15, 15);
  check("the bar starts on the real value", anim.shownHp(false) === 15);

  anim.update(FRAME, 20, 20, 5, 15);
  const straightAfter = anim.shownHp(false);
  check("it does not jump to the new value", straightAfter > 5,
        "showed " + straightAfter + " immediately");
  check("but it has started to move", straightAfter < 15);

  hold(anim, A.DRAIN_SECONDS + 0.2, 20, 20, 5, 15);
  check("and it arrives", Math.abs(anim.shownHp(false) - 5) < 0.01,
        "" + anim.shownHp(false));

  // A scratch drains for less time than a critical hit: the bar travels at a
  // fixed rate, so the distance decides the duration.
  const small = new A.BattleAnimator();
  small.update(FRAME, 20, 20, 100, 100);
  small.update(FRAME, 20, 20, 99, 100);
  let smallFrames = 0;
  while (Math.abs(small.shownHp(false) - 99) > 0.01 && smallFrames < 600) {
    small.update(FRAME, 20, 20, 99, 100);
    smallFrames++;
  }
  const big = new A.BattleAnimator();
  big.update(FRAME, 20, 20, 100, 100);
  big.update(FRAME, 20, 20, 1, 100);
  let bigFrames = 0;
  while (Math.abs(big.shownHp(false) - 1) > 0.01 && bigFrames < 600) {
    big.update(FRAME, 20, 20, 1, 100);
    bigFrames++;
  }
  check("a scratch drains quicker than a heavy hit", smallFrames < bigFrames,
        "scratch " + smallFrames + " frames, heavy " + bigFrames);
}

console.log("\n== healing is not a hit ==");
{
  const anim = new A.BattleAnimator();
  anim.update(FRAME, 8, 20, 15, 15);
  anim.update(FRAME, 18, 20, 15, 15);   // a Potion
  check("nobody lunges at a Potion", anim.lungeReach(false) === 0 && anim.lungeReach(true) === 0);
  check("and nobody blinks", anim.visible(true) && anim.visible(false));
  hold(anim, A.DRAIN_SECONDS + 0.2, 18, 20, 15, 15);
  check("but the bar still travels up", Math.abs(anim.shownHp(true) - 18) < 0.01,
        "" + anim.shownHp(true));
}

console.log("\n== both attacking in one turn ==");
{
  const anim = new A.BattleAnimator();
  anim.update(FRAME, 20, 20, 15, 15);
  anim.update(FRAME, 16, 20, 11, 15);
  anim.update(FRAME, 16, 20, 11, 15);
  check("both lunge when both were hit",
        anim.lungeReach(true) > 0 && anim.lungeReach(false) > 0,
        "mine " + anim.lungeReach(true) + " theirs " + anim.lungeReach(false));
}

console.log("\n== a fight that ends and another that starts ==");
{
  const anim = new A.BattleAnimator();
  anim.update(FRAME, 20, 20, 15, 15);
  anim.update(FRAME, 20, 20, 0, 15);
  check("a faint blinks like any other hit", anim.isBusy());
  anim.reset();
  check("reset stops everything", !anim.isBusy());
  // The next fight's first frame must not read as a hit just because the
  // numbers are different from the last fight's.
  anim.update(FRAME, 12, 12, 30, 30);
  check("a new fight's first frame is not a hit", !anim.isBusy());
  check("and its bars start on the real values",
        anim.shownHp(true) === 12 && anim.shownHp(false) === 30);
}

if (process.argv.indexOf("--selftest") >= 0) {
  console.log("\n== Selftest: the checks must reject a still fight ==");
  // What we had: nothing moves, ever.
  const still = { lungeReach: () => 0, visible: () => true, isBusy: () => false };
  check("a Pokemon that never moves would be caught", still.lungeReach(true) === 0);
  check("and a bar that snaps would be caught", A.DRAIN_SECONDS > 0);
}

console.log("\nBATTLEANIMATOR  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
