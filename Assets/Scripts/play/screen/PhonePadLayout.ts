// The pad drawn on your phone, in the glasses.
//
// The Spectacles App's controller screen is the app's own: a dotted rectangle
// and nothing else. A lens is given the touches on it, its size in centimetres,
// the phone's pose in the room and the phone's haptics -- and no way at all to
// draw on it. So the buttons cannot go on the phone's screen; they go in front
// of it, on a quad the glasses hang at the phone's own position, at the size
// the phone says its touch surface is. You look down at your phone and a Game
// Boy pad is lying on it.
//
// This file is the picture and the rule behind it, and nothing else -- no
// scene objects, no controller -- so both can be tested without either.
//
// The rule is the source's own (see MotionControllerSource), which reads the
// pad like this:
//
//     +-----------------------------+
//     |              UP             |     the middle           -> A / B
//     |                             |     a bottom corner      -> START / SELECT
//     |    LEFT    ( A / B )  RIGHT |     anywhere else, held  -> a direction
//     |                             |
//     | [START]     DOWN   [SELECT] |
//     +-----------------------------+
//
// Normalized touch coordinates put (0,0) at the TOP-left, so y grows downward.
//
// START and SELECT sit in the bottom corners because a playtest on the glasses
// (7 September) found the previous rule -- a SECOND finger anywhere while the
// first was still down -- unguessable and undrawable: with no way out of the
// nickname screen, the run ended there. A corner is a place you can see, aim
// at and feel the edge of the phone next to, and the corners were the one part
// of the pad the dominant-axis rule had no use for.

import type { GbCanvas, GbFont } from "./GbCanvas";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "./GbCanvas";

/** Normalized radius of the centre button. Outside it, a touch is a direction. */
export const DEAD_ZONE: number = 0.18;

export const ZONE_NONE: string = "";
export const ZONE_CENTRE: string = "centre";
export const ZONE_START: string = "start";
export const ZONE_SELECT: string = "select";

/**
 * The bottom corners, normalized. Wide enough for the LONGER of the two labels
 * at the font's eight pixels a character, which is what fixes the width: a
 * button you cannot label is the gesture this replaced.
 */
export const CORNER_WIDTH: number = 0.3;
export const CORNER_HEIGHT: number = 0.2;

/** True inside one of the two bottom corner buttons. */
export function inCorner(x: number, y: number, left: boolean): boolean {
  if (y < 1 - CORNER_HEIGHT) {
    return false;
  }
  return left ? x <= CORNER_WIDTH : x >= 1 - CORNER_WIDTH;
}

/**
 * Which zone a normalized touch is in: "up", "down", "left", "right",
 * "centre", "start", "select", or "" for a point that is not on the pad at all.
 *
 * The four directions are never diagonal, because a Gen 1 character cannot walk
 * that way, and they go by the DOMINANT axis, so a thumb sliding along the edge
 * does not flicker between two directions. The corners are tested FIRST: they
 * are carved out of the wedges, and a rule that let a direction win inside a
 * drawn button would make the button a lie.
 */
export function zoneAt(x: number, y: number): string {
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return ZONE_NONE;
  }
  if (inCorner(x, y, true)) {
    return ZONE_START;
  }
  if (inCorner(x, y, false)) {
    return ZONE_SELECT;
  }
  const dx = x - 0.5;
  const dy = y - 0.5;
  if (dx * dx + dy * dy < DEAD_ZONE * DEAD_ZONE) {
    return ZONE_CENTRE;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  return dy < 0 ? "up" : "down";
}

/** Shades: 0 lightest, 3 darkest, as everywhere else in this canvas. */
const SHADE_PAPER: number = 0;
const SHADE_ZONE: number = 1;
const SHADE_ACTIVE: number = 2;
const SHADE_INK: number = 3;

/**
 * Draws the pad, with `active` lit.
 *
 * In CANVAS space, which is normalized space scaled up: the picture is
 * stretched onto the phone's own touch surface, so a circle here lands exactly
 * where the circle in `zoneAt` is, whatever shape that surface has.
 */
export function paintPhonePad(canvas: GbCanvas, font: GbFont, active: string): void {
  canvas.clear(SHADE_PAPER);
  const w = SCREEN_WIDTH;
  const h = SCREEN_HEIGHT;

  // The four directions, as the quadrants the rule actually uses.
  fillZone(canvas, 0, 0, w, h, "up", active);
  fillZone(canvas, 0, 0, w, h, "down", active);
  fillZone(canvas, 0, 0, w, h, "left", active);
  fillZone(canvas, 0, 0, w, h, "right", active);

  // The seams between the four wedges, and an arrow in each: a pad with nothing
  // lit still has to say where its buttons are, or the first press of every
  // session is a guess. Drawn before the border and the button, which own their
  // own pixels.
  diagonals(canvas, w, h, SHADE_ZONE);
  const inset = 0.12;
  arrow(canvas, w / 2, h * inset, w * 0.05, "up", SHADE_INK);
  arrow(canvas, w / 2, h * (1 - inset), w * 0.05, "down", SHADE_INK);
  arrow(canvas, w * inset, h / 2, w * 0.05, "left", SHADE_INK);
  arrow(canvas, w * (1 - inset), h / 2, w * 0.05, "right", SHADE_INK);

  // The centre button, the same circle zoneAt tests.
  const radius = DEAD_ZONE * (w < h ? w : h);
  fillCircle(canvas, w / 2, h / 2, radius,
             active === ZONE_CENTRE ? SHADE_ACTIVE : SHADE_ZONE);
  outlineCircle(canvas, w / 2, h / 2, radius, SHADE_INK);

  // The two corner buttons, drawn over whatever wedge was lit: they are cut out
  // of the wedges, so the picture has to cut them out too.
  const startRect = cornerRect(ZONE_START, w, h);
  const selectRect = cornerRect(ZONE_SELECT, w, h);
  fillRect(canvas, startRect, active === ZONE_START ? SHADE_ACTIVE : SHADE_ZONE);
  fillRect(canvas, selectRect, active === ZONE_SELECT ? SHADE_ACTIVE : SHADE_ZONE);
  frame(canvas, startRect[0], startRect[1], startRect[2], startRect[3], SHADE_INK);
  frame(canvas, selectRect[0], selectRect[1], selectRect[2], selectRect[3], SHADE_INK);

  // A border, so the pad's edge is visible against the phone under it.
  frame(canvas, 0, 0, w, h, SHADE_INK);

  if (!font) {
    return;
  }
  // Labels. The centre carries both of its own, because a tap and a hold are
  // the same place and that is the one thing the picture cannot show.
  font.text(canvas, "A", w / 2 - 12, h / 2 - 4);
  font.text(canvas, "B", w / 2 + 6, h / 2 - 4);
  font.text(canvas, "HOLD B", w / 2 - 24, h / 2 + 10);
  label(canvas, font, startRect, "START");
  label(canvas, font, selectRect, "SELECT");
}

/**
 * A corner button's rectangle, in canvas pixels: [x, y, w, h].
 *
 * The same rectangle `inCorner` tests, scaled, so what is drawn and what is hit
 * cannot drift apart.
 */
export function cornerRect(zone: string, w: number, h: number): number[] {
  const cw = Math.round(CORNER_WIDTH * w);
  const ch = Math.round(CORNER_HEIGHT * h);
  const x = zone === ZONE_START ? 0 : w - cw;
  return [x, h - ch, cw, ch];
}

/** Centres a label in a rectangle at the font's eight pixels a character. */
function label(canvas: GbCanvas, font: GbFont, rect: number[], text: string): void {
  const [x, y, w, h] = rect;
  font.text(canvas, text,
            Math.round(x + (w - text.length * 8) / 2),
            Math.round(y + (h - 8) / 2));
}

function fillRect(canvas: GbCanvas, rect: number[], shade: number): void {
  canvas.fillRect(rect[0], rect[1], rect[2], rect[3], shade);
}

/** The rectangle a direction's label sits in. Exported for the test. */
export function zoneRect(zone: string, w: number, h: number): number[] {
  const midX = w / 2;
  const midY = h / 2;
  if (zone === "up") return [0, 0, w, midY];
  if (zone === "down") return [0, midY, w, h - midY];
  if (zone === "left") return [0, 0, midX, h];
  if (zone === "right") return [midX, 0, w - midX, h];
  return [0, 0, w, h];
}

function fillZone(canvas: GbCanvas, x: number, y: number, w: number, h: number,
                  zone: string, active: string): void {
  if (zone !== active) {
    return;
  }
  // Only the LIT zone is filled: an unlit pad is paper, so the phone stays
  // readable under it and the eye goes to the one thing that changed.
  const rect = zoneRect(zone, w, h);
  fillTriangleZone(canvas, zone, rect, SHADE_ACTIVE);
}

/**
 * The wedge a direction owns: the dominant-axis rule cuts the pad into four
 * triangles meeting in the middle, not four rectangles, and drawing rectangles
 * would promise a shape the rule does not keep.
 */
function fillTriangleZone(canvas: GbCanvas, zone: string, rect: number[],
                          shade: number): void {
  const [rx, ry, rw, rh] = rect;
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const w = zone === "left" || zone === "right" ? rw * 2 : rw;
  const h = zone === "up" || zone === "down" ? rh * 2 : rh;
  const midX = zone === "right" ? rx : zone === "left" ? rx + rw : cx;
  const midY = zone === "down" ? ry : zone === "up" ? ry + rh : cy;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const dx = x - midX;
      const dy = y - midY;
      const inWedge = zone === "left" || zone === "right"
        ? Math.abs(dx) >= Math.abs(dy) * (w / h)
        : Math.abs(dy) >= Math.abs(dx) * (h / w);
      if (inWedge) {
        canvas.fillRect(x, y, 1, 1, shade);
      }
    }
  }
}

function fillCircle(canvas: GbCanvas, cx: number, cy: number, radius: number,
                    shade: number): void {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        canvas.fillRect(x, y, 1, 1, shade);
      }
    }
  }
}

function outlineCircle(canvas: GbCanvas, cx: number, cy: number, radius: number,
                       shade: number): void {
  const steps = Math.ceil(radius * 8);
  for (let i = 0; i < steps; i++) {
    const angle = i / steps * Math.PI * 2;
    canvas.fillRect(Math.round(cx + Math.cos(angle) * radius),
                    Math.round(cy + Math.sin(angle) * radius), 1, 1, shade);
  }
}

/** The two corner-to-corner seams the dominant-axis rule actually cuts along. */
function diagonals(canvas: GbCanvas, w: number, h: number, shade: number): void {
  const steps = w > h ? w : h;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    canvas.fillRect(Math.round(t * (w - 1)), Math.round(t * (h - 1)), 1, 1, shade);
    canvas.fillRect(Math.round(t * (w - 1)), Math.round((1 - t) * (h - 1)), 1, 1, shade);
  }
}

/** A solid triangle pointing the way its zone walks. */
function arrow(canvas: GbCanvas, cx: number, cy: number, size: number,
               direction: string, shade: number): void {
  for (let i = 0; i <= size; i++) {
    const span = size - i;
    if (direction === "up" || direction === "down") {
      const y = direction === "up" ? cy + i : cy - i;
      canvas.fillRect(Math.round(cx - span), Math.round(y), Math.round(span * 2) + 1, 1, shade);
    } else {
      const x = direction === "left" ? cx + i : cx - i;
      canvas.fillRect(Math.round(x), Math.round(cy - span), 1, Math.round(span * 2) + 1, shade);
    }
  }
}

function frame(canvas: GbCanvas, x: number, y: number, w: number, h: number,
               shade: number): void {
  canvas.fillRect(x, y, w, 1, shade);
  canvas.fillRect(x, y + h - 1, w, 1, shade);
  canvas.fillRect(x, y, 1, h, shade);
  canvas.fillRect(x + w - 1, y, 1, h, shade);
}
