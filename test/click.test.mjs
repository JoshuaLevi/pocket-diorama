// The Game Boy's built-in click: well-formed, short, and a pulse tone.
//
//   node --experimental-strip-types --import ./test/register.mjs test/click.test.mjs

globalThis.print = () => {};

const { clickEvents, CLICK_FRAMES, CLICK_REGISTER, CLICK_VOLUME } = await import("../Assets/Scripts/audio/Click.ts");
const { registerToHz, FRAME_TICKS, TICKS_PER_SECOND } = await import("../Assets/Scripts/audio/ChannelProgram.ts");
const { eventVoice } = await import("../Assets/Scripts/audio/Mixer.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

console.log("=== the click ===");
const channels = clickEvents();
check("one pulse channel", channels.length === 1 && channels[0].length >= 1);
const tone = channels[0][0];
check("it is a tone", tone.kind === "tone" && tone.startTicks === 0);
check("it starts at once and is short", tone.ticks === CLICK_FRAMES * FRAME_TICKS && tone.seconds < 0.1, tone.seconds);
check("its seconds agree with its ticks", Math.abs(tone.seconds - tone.ticks / TICKS_PER_SECOND) < 1e-9);
check("a legal register", Number.isInteger(tone.register) && tone.register >= 0 && tone.register < 2048);
check("its frequency is the register's", Math.abs(tone.frequencyHz - registerToHz(CLICK_REGISTER)) < 1e-9);
check("high enough to read as a click, not a hum", tone.frequencyHz > 1000 && tone.frequencyHz < 4000, tone.frequencyHz);
check("a middling volume that decays", tone.volume === CLICK_VOLUME && tone.volume > 0 && tone.volume <= 15 && tone.fade > 0);
check("a plain duty, no modulation", tone.duty >= 0 && tone.duty <= 3 && tone.dutyCycle === null && tone.vibrato === null && tone.slide === null && tone.sweep === null);

console.log("=== through the mixer's voice ===");
{
  let voice = null;
  let error = null;
  try { voice = eventVoice("click", clickEvents(), 44100); } catch (e) { error = e; }
  check("the voice builds from the events", voice !== null && error === null, error && error.message);
}

console.log("\nCLICK  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
