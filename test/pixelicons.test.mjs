// The step icons of the first run: present, twelve by twelve, drawn where asked.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/pixelicons.test.mjs

globalThis.print = () => {};

const { ICON_NAMES, ICON_SIZE, hasIcon, drawIcon, drawSteps }
  = await import("../Assets/Scripts/play/screen/PixelIcons.ts");
const { GbCanvas, SCREEN_WIDTH } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

function inkIn(canvas, x, y, w, h) {
  let n = 0;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (canvas.shadeAt(xx, yy) === 3) n++;
    }
  }
  return n;
}

console.log("=== every icon ===");
for (const name of ICON_NAMES) {
  check(name + " exists", hasIcon(name));
  const canvas = new GbCanvas();
  canvas.clear(0);
  drawIcon(canvas, name, 20, 30, 3);
  const inside = inkIn(canvas, 20, 30, ICON_SIZE, ICON_SIZE);
  const total = inkIn(canvas, 0, 0, SCREEN_WIDTH, 144);
  check(name + " has ink", inside > 12, inside);
  check(name + " stays in its box", inside === total, total - inside);
}
check("an unknown icon draws nothing", (() => { const c = new GbCanvas(); c.clear(0); drawIcon(c, "nope", 0, 0, 3); return inkIn(c, 0, 0, SCREEN_WIDTH, 144) === 0; })());
check("the four steps have icons", ["cartridge", "site", "keyboard", "plate"].every(hasIcon));

console.log("=== the step dots ===");
{
  const c = new GbCanvas();
  c.clear(0);
  drawSteps(c, 128, 6, 2, 4, 3);
  const filled = inkIn(c, 128, 6, 4, 4) + inkIn(c, 135, 6, 4, 4);
  const hollow = inkIn(c, 142, 6, 4, 4) + inkIn(c, 149, 6, 4, 4);
  check("two are filled", filled === 32, filled);
  check("two are hollow", hollow === 24, hollow);
  check("nothing beyond the fourth", inkIn(c, 156, 6, 4, 4) === 0);
}

console.log("\nPIXELICONS  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
