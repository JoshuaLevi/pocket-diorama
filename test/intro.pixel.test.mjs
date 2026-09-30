// The intro's pixel gate: every measured beat, rendered by this project's
// own modules and compared shade-for-shade against PyBoy's recorded frame.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/intro.pixel.test.mjs Assets/Generated/kanto.json
//
// Without tools/oracle/state/intro/frames (gitignored, ROM-derived) this
// prints INTRO PIXEL: SKIP and exits 0 -- it never reports PASS with
// nothing to compare against, and it never fabricates a match either: a
// beat that differs is reported with its own differing-pixel count and
// first differing tile, and a lens.png sits next to the recorded PNG under
// tools/oracle/state/intro-lens/ so a person can look at the two side by
// side. The recorded frame is right by definition (task instructions); a
// beat this file cannot yet make match is a finding, not a rounding error,
// and is written up in the header comments of play/screen/IntroScreen.ts
// and play/screen/NamingScreen.ts as each fix landed.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { readShadePng } from "./pngread.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("usage: intro.pixel.test.mjs <world-bundle.json>");
  process.exit(2);
}
globalThis.print = () => {};

const FRAMES_DIR = "tools/oracle/state/intro/frames";
if (!existsSync(FRAMES_DIR)) {
  console.log("INTRO PIXEL: SKIP (no recorded frames)");
  process.exit(0);
}

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

const canvasMod = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, GbFont, imageFromPacked, SCREEN_WIDTH, SCREEN_HEIGHT } = canvasMod;
const introMod = await import("../Assets/Scripts/play/screen/IntroScreen.ts");
const {
  IntroStage, ACK_TEXT_ID_PLAYER, ACK_TEXT_ID_RIVAL,
  RED_SPRITE_OBP0,
} = introMod;
const worldDataMod = await import("../Assets/Scripts/world/WorldData.ts");
const { unpackShades, unpackMask } = worldDataMod;
const textBoxMod = await import("../Assets/Scripts/play/screen/CanvasTextBox.ts");
const { CanvasTextBox } = textBoxMod;
const namingMod = await import("../Assets/Scripts/play/screen/NamingScreen.ts");
const { NamingController, NAME_MAX_LENGTH } = namingMod;
const dialogueMod = await import("../Assets/Scripts/play/script/Dialogue.ts");
const { paginate } = dialogueMod;
const stateMod = await import("../Assets/Scripts/play/PlayState.ts");
const { TEXT_SPEED_MEDIUM } = stateMod;

const font = new GbFont(bundle);
const introArt = {
  oak: imageFromPacked(bundle.introArt.oak),
  rival: imageFromPacked(bundle.introArt.rival),
  player: imageFromPacked(bundle.introArt.player),
  shrink1: imageFromPacked(bundle.introArt.shrink1),
  shrink2: imageFromPacked(bundle.introArt.shrink2),
};
const nidorinoFront = imageFromPacked(bundle.species.NIDORINO.front);

/**
 * SPRITE_RED's frame 0 (facing down -- SpriteBillboard.ts's own FRAME_DOWN,
 * the topmost 16-row band of bundle.sprites.SPRITE_RED's row-major sheet),
 * sliced out and remapped through RED_SPRITE_OBP0 -- the two steps
 * IntroStage's own header FINDINGS says its caller must do before handing
 * the frame to the constructor (this file never reads a bundle otherwise).
 */
function redDownSpriteFrame() {
  const sprite = bundle.sprites.SPRITE_RED;
  const frameSize = 16;
  const pixelCount = sprite.width * sprite.height;
  const rawShades = unpackShades(sprite.shades, pixelCount);
  const rawAlpha = unpackMask(sprite.alpha, pixelCount);
  const shades = new Uint8Array(frameSize * frameSize);
  const alpha = new Uint8Array(frameSize * frameSize);
  for (let y = 0; y < frameSize; y++) {
    for (let x = 0; x < frameSize; x++) {
      const si = y * sprite.width + x; // frame 0 is rows 0..15 of the sheet
      const di = y * frameSize + x;
      alpha[di] = rawAlpha[si];
      shades[di] = RED_SPRITE_OBP0[rawShades[si]];
    }
  }
  return { width: frameSize, height: frameSize, shades, alpha };
}
const redDownSprite = redDownSpriteFrame();

function pagesOf(textId) {
  const body = bundle.text[textId];
  if (typeof body !== "string") {
    throw new Error("no text body for " + textId);
  }
  return paginate(body).map((p) => p.lines);
}

/** Types out `box`'s pages until page `targetIndex` is showing and ready. */
function advanceTo(box, targetIndex) {
  while (box.pageIndex() < targetIndex) {
    if (box.ready()) {
      box.ack();
    } else {
      box.step(1);
    }
  }
  while (!box.ready()) {
    box.step(1);
  }
}

/**
 * BGP maps colour numbers (canvas.pixels' own values) to shades: bits 1-0 =
 * colour 0, bits 3-2 = colour 1, bits 5-4 = colour 2, bits 7-6 = colour 3
 * (the task's own framing, and GbScreenView.upload's paletteForRow contract
 * this mirrors). Row-major, top row first, matching pngread.mjs's own
 * orientation -- NOT GbCanvas.toRgba's bottom-up upload order.
 */
function renderShades(canvas, bgp) {
  const out = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let i = 0; i < out.length; i++) {
    const colour = canvas.pixels[i] & 3;
    out[i] = (bgp >> (colour * 2)) & 3;
  }
  return out;
}

const SHADE_TO_GRAY = [255, 153, 85, 0];
const LENS_DIR = "tools/oracle/state/intro-lens";

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** The write side of pngread.mjs's own format: 8-bit grayscale, filter 0. */
function writeShadePng(path, width, height, shades) {
  const stride = width;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = SHADE_TO_GRAY[shades[y * stride + x]];
    }
  }
  const idat = deflateSync(raw);
  const chunks = [];
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type, body) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typeAndBody = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(crc32(typeAndBody), 0);
    return Buffer.concat([len, typeAndBody, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)));
  writeFileSync(path, Buffer.concat(chunks));
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) | 0;
}

let same = 0;
let differ = 0;
const beatsDiffering = [];

/**
 * Compares `shades` (this file's own render) against `recordedFile`, masking
 * only the blink-arrow tile (row 16, col 18 -- $EE, on its own free-running
 * cycle unrelated to any of this file's own frame counts; see
 * CanvasTextBox.ts's own ARROW_COL for where "col 18, not the task's 19"
 * comes from).
 */
function compareBeat(name, recordedFile, shades, note) {
  const recorded = readShadePng(FRAMES_DIR + "/" + recordedFile);
  if (recorded.width !== SCREEN_WIDTH || recorded.height !== SCREEN_HEIGHT) {
    throw new Error(recordedFile + ": expected 160x144, got " +
      recorded.width + "x" + recorded.height);
  }
  let diffCount = 0;
  let first = null;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const arrowTile = y >= 128 && y < 136 && x >= 144 && x < 152;
      if (arrowTile) {
        continue;
      }
      const i = y * SCREEN_WIDTH + x;
      if (shades[i] !== recorded.shades[i]) {
        diffCount++;
        if (first === null) {
          first = { tileRow: Math.floor(y / 8), tileCol: Math.floor(x / 8) };
        }
      }
    }
  }
  mkdirSync(LENS_DIR, { recursive: true });
  writeShadePng(LENS_DIR + "/" + recordedFile, SCREEN_WIDTH, SCREEN_HEIGHT, shades);
  if (diffCount === 0) {
    same++;
    console.log("  same   " + name + "  (" + recordedFile + ")" + (note ? "  -- " + note : ""));
  } else {
    differ++;
    beatsDiffering.push(name);
    console.log("  DIFFER " + name + "  (" + recordedFile + ")  " + diffCount +
      " differing pixels, first at tile (row " + first.tileRow + ", col " + first.tileCol + ")" +
      (note ? "  -- " + note : ""));
  }
}

// -------------------------------------------------------------- the beats

console.log("=== intro beats ===");

// 04: Oak's fade-in, settled.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  const canvas = new GbCanvas();
  stage.show("oak");
  stage.step(200); // well past the ramp's own total (70 frames)
  stage.paint(canvas);
  compareBeat("04 oak settled", "04-oak_portrait_fadein.png", renderShades(canvas, stage.bgp()));
}

// 05: OakSpeechText1 page 1, fully printed, Oak still up.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  stage.show("oak");
  stage.step(200);
  const box = new CanvasTextBox(TEXT_SPEED_MEDIUM);
  box.show(pagesOf("_OakSpeechText1"));
  advanceTo(box, 0);
  const canvas = new GbCanvas();
  stage.paint(canvas);
  box.paint(canvas, font);
  compareBeat("05 p1 fully printed", "05-oak_speech_text1_p1.png", renderShades(canvas, stage.bgp()));
}

// 10: Nidorino's slide, its own last recorded frame (f0064, settled) --
// also the exact frame OakSpeechText2A's own box opens (INTRO.md's beat
// table: nidorino_appears's end frame and oak_speech_text2a_p1's start
// frame are both 2237); the recorded tilemap confirms the box border is
// already drawn with a blank interior (0 characters typed), the state
// CanvasTextBox is in immediately after show(), before any step().
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  stage.show("nidorino");
  stage.step(64);
  const box = new CanvasTextBox(TEXT_SPEED_MEDIUM);
  box.show(pagesOf("_OakSpeechText2A"));
  const canvas = new GbCanvas();
  stage.paint(canvas);
  box.paint(canvas, font);
  compareBeat("10 nidorino settled", "10-nidorino_appears-f0064.png", renderShades(canvas, stage.bgp()));
}

// 12: OakSpeechText2A page 1, Nidorino still up (no new intro_stage between the cry and this text).
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  stage.show("nidorino");
  stage.step(64);
  const box = new CanvasTextBox(TEXT_SPEED_MEDIUM);
  box.show(pagesOf("_OakSpeechText2A"));
  advanceTo(box, 0);
  const canvas = new GbCanvas();
  stage.paint(canvas);
  box.paint(canvas, font);
  compareBeat("12 p1 printed", "12-oak_speech_text2a_p1.png", renderShades(canvas, stage.bgp()));
}

// 23: the player's own first slide, its last recorded frame (f0066, settled).
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  stage.show("player");
  stage.step(14);
  const canvas = new GbCanvas();
  stage.paint(canvas);
  compareBeat("23 slide end", "23-player_portrait_slide-f0066.png", renderShades(canvas, stage.bgp()));
}

// 24: IntroducePlayerText, player still up.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  stage.show("player");
  stage.step(14);
  const box = new CanvasTextBox(TEXT_SPEED_MEDIUM);
  box.show(pagesOf("_IntroducePlayerText"));
  advanceTo(box, 0);
  const canvas = new GbCanvas();
  stage.paint(canvas);
  box.paint(canvas, font);
  // The recorder's own beat-end frame (24-introduce_player_text_p1.png,
  // frame 3070) is a real but unhelpful reference: collect_pages()'s own
  // automatic A-press starts closing the box that exact frame, so BGP has
  // already dropped to $00 (screen blank) even though the tile IDs
  // underneath still read as the fully typed page. 24-introduce_player_
  // text_printed.png (frame 3023, written by tools/oracle/state/intro/
  // _probe_player_text_printed.py, a replay that never presses A for this
  // box so the natural ready/blink state is left alone to sample) is the
  // readable page instead: fully typed, BGP back to normal, page-advance
  // arrow visible. The original file is kept on disk, just no longer the
  // comparison target.
  compareBeat("24 printed", "24-introduce_player_text_printed.png", renderShades(canvas, stage.bgp()));
}

// 90: the name list, portrait slid open, the question still up underneath it.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  stage.show("player");
  stage.step(14);
  const box = new CanvasTextBox(TEXT_SPEED_MEDIUM);
  box.show(pagesOf("_IntroducePlayerText"));
  advanceTo(box, 0);
  stage.slideListOpen();
  stage.step(200); // past LIST_SLIDE_FRAMES
  const nc = new NamingController("YOUR NAME?", ["RED", "ASH", "JACK"], NAME_MAX_LENGTH);
  const canvas = new GbCanvas();
  stage.paint(canvas);
  box.paint(canvas, font);
  nc.paintPresets(canvas, font); // its own rectangle only -- see NamingScreen.ts
  compareBeat("90-player_name_presets", "90-player_name_presets.png", renderShades(canvas, stage.bgp()));
}

// 25: the letter grid, freshly opened.
{
  const nc = new NamingController("YOUR NAME?", [], NAME_MAX_LENGTH); // no presets: straight to the grid
  const canvas = new GbCanvas();
  nc.paint(canvas, font);
  // Code 240 (the yen sign, row 13's last symbol) is fixed -- see font.ts's
  // stampEdTile and bundle.test.mjs's own byte-for-byte check. The 4
  // pixels still differing here (row 13, col 14, the "." two slots
  // earlier) are NOT a font-sheet bug: the ROM's own VRAM at this exact
  // grid cell is code $F2 (ink at local x2-3, ROM bytes "00 00 00 00 00
  // 30 30 00"), which bundle.font already decodes correctly (checked
  // directly against the same ROM bytes) -- but NamingScreen.ts's
  // GRID_UPPER/GRID_LOWER row-13 arrays spell this cell as a plain ASCII
  // "." (Assets/Scripts/play/screen/NamingScreen.ts, both arrays'
  // 7th-from-last entry), and GbFont.text()'s single-character lookup
  // resolves "." to the manifest's ONE ASCII-period charmap entry, code
  // $E8 (the ordinary dialogue period, ink at local x1-2 -- one pixel
  // off, which is why this reads as a shift rather than a different
  // glyph). The manifest already carries the grid's own code under its
  // own charmap seq, the full-width "．" (U+FF0E, code 242/$F2) -- not
  // mine to wire in: NamingScreen.ts is another agent's file. See this
  // run's own report for the precise one-character fix needed there.
  compareBeat("25-your_name_list", "25-your_name_list.png", renderShades(canvas, 0xe4),
    "known: NamingScreen.ts's row-13 grid data spells its 7th symbol as ASCII \".\" (-> charmap code $E8, the ordinary dialogue period) instead of the full-width \"．\" U+FF0E (-> code $F2, what the ROM actually shows there) -- not a font.ts/bundle.font bug, see the comment above");
}

// 27: the rival's own reveal, settled -- see the correction in IntroScreen.ts.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  const canvas = new GbCanvas();
  stage.show("rival");
  stage.step(200);
  stage.paint(canvas);
  compareBeat("27 rival", "27-rival_portrait.png", renderShades(canvas, stage.bgp()));
}

// 36: the player's second appearance, settled.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  const canvas = new GbCanvas();
  stage.showPlayerAgain();
  stage.step(200);
  stage.paint(canvas);
  compareBeat("36 player again settled", "36-player_portrait_again.png", renderShades(canvas, stage.bgp()));
}

// 44 and the shrink: OakSpeechText3's own last page, the player up until the shrink starts.
{
  function setupPage8() {
    const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
    stage.showPlayerAgain();
    stage.step(200);
    const box = new CanvasTextBox(TEXT_SPEED_MEDIUM);
    const pages = pagesOf("_OakSpeechText3");
    box.show(pages);
    advanceTo(box, pages.length - 1);
    return { stage, box };
  }
  const before = setupPage8();
  const canvasBefore = new GbCanvas();
  before.stage.paint(canvasBefore);
  before.box.paint(canvasBefore, font);
  // "Before the shrink starts" is NOT the shrink's own offset 0 -- proven by
  // diffing 45-shrink-f0000.png directly against 36-player_portrait_again.png
  // (the same static, unchanging picture, confirmed pixel-identical there):
  // they already differ by 3 pixels, top-right corner of the picture's
  // second tile. record_intro.py's own find_shrink_window() defines
  // shrink_start as the FIRST frame that differs from the page's opening
  // frame, so "f0000" (written at exactly shrink_start) is, by
  // construction, already one step INTO the shrink, not before it --
  // bundle.introArt.player itself is correct (0 diff against the truly
  // static reference). 45-shrink-before.png (frame shrink_start-1, written
  // by tools/oracle/state/intro/_probe_shrink_before.py, which replays the
  // same deterministic path main() takes and confirms the same shrink_start,
  // 4875, INTRO.md's own beat table) is the real "before" reference; kept
  // 44-oak_speech_text3_p8.png (frame 5010, past "gone") and
  // 45-shrink-f0000.png as they were, still useful for other checks.
  compareBeat("44 p8 before shrink starts", "45-shrink-before.png",
    renderShades(canvasBefore, before.stage.bgp()));

  for (const offset of [0, 60, 100]) {
    const at = setupPage8();
    at.stage.startShrink();
    at.stage.step(offset);
    const canvas = new GbCanvas();
    at.stage.paint(canvas);
    at.box.paint(canvas, font);
    const file = "45-shrink-f" + String(offset).padStart(4, "0") + ".png";
    let note;
    if (offset === 0) {
      // See the comment above: 45-shrink-f0000.png is shrink_start itself,
      // already 3 pixels into a continuous, tile-by-tile hardware redraw
      // that this file's 3-static-image model (player/shrink1/shrink2)
      // only ever approximates at two extracted snapshots -- proven not a
      // bundle.introArt.player bug (0 diff at shrink_start-1, above) and
      // not fixable by picking a different one of the three images
      // (bundle.introArt.shrink1 itself differs from this exact frame by
      // 707 pixels, i.e. it is nowhere near this early). No fourth
      // in-between asset exists to render this one transitional frame
      // exactly.
      note = "known: 45-shrink-f0000.png (shrink_start) is already 3px into the real per-frame tile shrink that only shrink1/shrink2's two static snapshots approximate -- see the comment above compareBeat(\"44 p8 before shrink starts\", ...) a few lines up";
    } else if (offset >= 120) {
      // SPRITE_RED itself is exact for 72-119 (offset 100 below proves it,
      // 0 diff) -- past 120 a BGP fade this file's flat shrink-mode bgp()
      // does not reproduce takes over (measured: BGP steps $E4 -> $90 ->
      // ... through offset 134). See IntroScreen.ts header FINDINGS.
      note = "known: SPRITE_RED stops matching exactly past shrink offset ~120, where a BGP fade this file's shrink-mode bgp() does not reproduce takes over (see IntroScreen.ts header)";
    }
    compareBeat("shrink offset " + offset, file, renderShades(canvas, at.stage.bgp()), note);
  }
}

// 46: the white hold, mid-hold.
{
  const stage = new IntroStage(introArt, nidorinoFront, redDownSprite);
  const canvas = new GbCanvas();
  stage.startWhiteHold();
  stage.step(30);
  stage.paint(canvas); // draws nothing; bgp() alone makes the screen white
  compareBeat("46 white", "46-fade_to_white-f0000.png", renderShades(canvas, stage.bgp()));
}

console.log("");
console.log("PIXEL " + same + " same, " + differ + " differ");
if (differ > 0) {
  console.log("differing: " + beatsDiffering.join(", "));
}
console.log("lens.png files written under " + LENS_DIR + "/");
process.exit(differ === 0 ? 0 : 1);
