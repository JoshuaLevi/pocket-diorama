// Twelve-pixel icons for the setup pages, drawn with the built-in font's
// own means: fillRect on the canvas, nothing from the cartridge.
//
// One glyph per step of the first run -- the cartridge, the site, the
// keyboard, the plate -- so a page reads at a glance before its words do.
// Pure, like TinyFont: a table of rows, and a loop that paints them.

import type { GbCanvas } from "./GbCanvas";

export const ICON_SIZE: number = 12;

/** Row strings: '#' is ink, '.' is paper. Twelve rows of twelve. */
const ICONS: { [name: string]: string[] } = {
  cartridge: [
    "..########..",
    ".#........#.",
    ".#.######.#.",
    ".#.#....#.#.",
    ".#.#....#.#.",
    ".#.######.#.",
    ".#........#.",
    ".#........#.",
    ".#........#.",
    ".#........#.",
    ".#.#.#.#.##.",
    "..########..",
  ],
  site: [
    "............",
    ".##########.",
    ".#........#.",
    ".#.##..##.#.",
    ".#........#.",
    ".#.######.#.",
    ".#........#.",
    ".#.####...#.",
    ".#........#.",
    ".##########.",
    "....####....",
    "..########..",
  ],
  keyboard: [
    "............",
    "............",
    "############",
    "#.#.#.#.#.##",
    "############",
    "#.#.#.#.#.##",
    "############",
    "#..######..#",
    "############",
    "............",
    "............",
    "............",
  ],
  plate: [
    "............",
    ".....##.....",
    "...##..##...",
    ".##......##.",
    "#..........#",
    "#.##....##.#",
    "#.##....##.#",
    ".##......##.",
    "...##..##...",
    ".....##.....",
    "............",
    "............",
  ],
  glasses: [
    "............",
    "............",
    "............",
    ".####..####.",
    "#....##....#",
    "#....##....#",
    "#....##....#",
    ".####..####.",
    "............",
    "............",
    "............",
    "............",
  ],
  check: [
    "............",
    "............",
    "..........#.",
    ".........##.",
    "........##..",
    ".......##...",
    ".#....##....",
    ".##..##.....",
    "..####......",
    "...##.......",
    "............",
    "............",
  ],
};

export const ICON_NAMES: string[] = ["cartridge", "site", "keyboard", "plate", "glasses", "check"];

/** Whether an icon of that name exists; the test asks for every step's. */
export function hasIcon(name: string): boolean {
  return ICONS[name] !== undefined;
}

/** Paints the icon with its top-left corner at (x, y), in shade `ink`. */
export function drawIcon(canvas: GbCanvas, name: string, x: number, y: number, ink: number): void {
  const rows = ICONS[name];
  if (!rows || !canvas) {
    return;
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let start = -1;
    for (let c = 0; c <= row.length; c++) {
      const on = c < row.length && row.charAt(c) === "#";
      if (on && start < 0) {
        start = c;
      } else if (!on && start >= 0) {
        canvas.fillRect(x + start, y + r, c - start, 1, ink);
        start = -1;
      }
    }
  }
}

/**
 * The step dots of the first run: `total` squares, the first `done` filled.
 * Drawn small and at the top right so the title keeps its room.
 */
export function drawSteps(canvas: GbCanvas, x: number, y: number, done: number, total: number, ink: number): void {
  const size = 4;
  const gap = 3;
  for (let i = 0; i < total; i++) {
    const sx = x + i * (size + gap);
    if (i < done) {
      canvas.fillRect(sx, y, size, size, ink);
    } else {
      canvas.fillRect(sx, y, size, 1, ink);
      canvas.fillRect(sx, y + size - 1, size, 1, ink);
      canvas.fillRect(sx, y, 1, size, ink);
      canvas.fillRect(sx + size - 1, y, 1, size, ink);
    }
  }
}
