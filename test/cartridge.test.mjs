// A bundle names its cartridge by SHA-1, and the lens reads the family off it.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/cartridge.test.mjs [--selftest]
//
// Red and Blue are one script family; Yellow is the other. An unknown or
// empty hash reads as Red, because Red is what every script was ported from
// and what a test that pins no cartridge should get.
//
// --selftest asks for Yellow under Blue's hash and checks the suite notices.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { cartridgeVersion, isYellow, RED_ROM_SHA1, BLUE_ROM_SHA1, YELLOW_ROM_SHA1 } =
  await import("../Assets/Scripts/world/Cartridge.ts");
const title = await import("../Assets/Scripts/play/screen/TitleScreen.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail ? " -- " + detail : ""));
}

const yellowUnderBlue = SELFTEST ? BLUE_ROM_SHA1 : YELLOW_ROM_SHA1;

check("Red's hash is red", cartridgeVersion(RED_ROM_SHA1) === "red");
check("Blue's hash is blue", cartridgeVersion(BLUE_ROM_SHA1) === "blue");
check("Yellow's hash is yellow", cartridgeVersion(yellowUnderBlue) === "yellow",
      cartridgeVersion(yellowUnderBlue));
check("case does not matter", cartridgeVersion(YELLOW_ROM_SHA1.toUpperCase()) === "yellow");
check("an empty hash reads as Red", cartridgeVersion("") === "red");
check("a null hash reads as Red", cartridgeVersion(null) === "red");
check("an unknown hash reads as Red", cartridgeVersion("0".repeat(40)) === "red");
check("isYellow agrees", isYellow(YELLOW_ROM_SHA1) && !isYellow(BLUE_ROM_SHA1) && !isYellow(""));
check("the title screen still knows Blue's hash", title.BLUE_ROM_SHA1 === BLUE_ROM_SHA1);
check("Blue's title cycles Blue's list", title.titleMonsFor(BLUE_ROM_SHA1)[0] === "SQUIRTLE");
check("Yellow's title takes Red's list for now", title.titleMonsFor(YELLOW_ROM_SHA1)[0] === "CHARMANDER");

// -- the script tables read the version -------------------------------------
//
// The transcriber writes Yellow as an overlay on Red's table: a script Yellow
// says differently, a script only Yellow has, or a null where Red has one and
// Yellow has none. The lookup must honour all three, and Red must never see
// the overlay.
const ported = await import("../Assets/Scripts/play/script/PortedMaps.ts");
const maps = await import("../Assets/Scripts/play/script/MapScripts.ts");
const overlay = ported.transcribedYellowOverlay();
const overlayMaps = Object.keys(overlay);
check("the Yellow overlay is not empty (regenerate with --yellow)", overlayMaps.length >= 8,
      overlayMaps.length + " maps");
const jessie = ported.transcribedScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE", "yellow");
check("Yellow has Jessie in the hideout", jessie !== null && jessie.length > 0);
check("Red has no Jessie", ported.transcribedScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE") === null);
check("Red keeps its default when the version is omitted",
      ported.transcribedScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE", "red") === null);
const nulls = [];
for (const m of overlayMaps) {
  for (const k of Object.keys(overlay[m].talk)) {
    if (overlay[m].talk[k] === null) { nulls.push([m, k]); }
  }
}
check("some scripts exist in Red only", nulls.length >= 3, nulls.length + " nulls");
for (const [m, k] of nulls) {
  check(`a null hides Red's ${m}.${k} from Yellow`,
        ported.transcribedScript(m, k) !== null && ported.transcribedScript(m, k, "yellow") === null);
}
check("Yellow's map list carries the overlay's maps",
      overlayMaps.every((m) => ported.transcribedMaps("yellow").indexOf(m) >= 0));
check("Blue reads Red's table", ported.transcribedScript("ROUTE_1", "TEXT_ROUTE1_YOUNGSTER1", "blue") !== null &&
      ported.transcribedScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE", "blue") === null);
check("talkScript threads the version through",
      maps.talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE", "yellow") !== null &&
      maps.talkScript("ROCKET_HIDEOUT_B4F", "TEXT_ROCKETHIDEOUTB4F_JESSIE") === null);

const verdict = fail === 0 ? "OK" : "FAILED";
console.log(`CARTRIDGE ${pass} PASS  ${fail} FAIL  ${verdict}`);
if (SELFTEST) {
  if (fail === 0) { console.log("SELFTEST FAILED: the wrong hash went unnoticed"); process.exit(1); }
  console.log("SELFTEST OK: the planted fault was caught");
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
