// The same cells drive painting, ray hit-testing and SIK colliders.
import { CODE_ALPHABET, CODE_LENGTH, isValidCode } from "./CodeEntry";
import { GbCanvas } from "./GbCanvas";
import { drawCentred, drawText, textWidth } from "./TinyFont";

export const KEYBOARD_WIDTH_CM: number = 72;
export const KEYBOARD_AHEAD_CM: number = 160;
export const KEYBOARD_CM_PER_PIXEL: number = KEYBOARD_WIDTH_CM / 160;

export interface CodeKey {
  row: number;
  column: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 6.3 cm keys with 2.7 cm gaps; approximately 2.25 and 0.97 degrees at 160 cm. */
export function codeKeys(): CodeKey[] {
  const keys: CodeKey[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 8; column++) {
      keys.push({row, column, label: CODE_ALPHABET.charAt(row * 8 + column),
        x: 3 + column * 20, y: 38 + row * 20, width: 14, height: 14});
    }
  }
  keys.push({row: 4, column: 0, label: "DELETE", x: 3, y: 118, width: 54, height: 16});
  keys.push({row: 4, column: 1, label: "LOAD WORLD", x: 63, y: 118, width: 94, height: 16});
  return keys;
}

export function keyEnabled(key: CodeKey, code: string): boolean {
  if (key.row < 4) return code.length < CODE_LENGTH;
  return key.column === 0 ? code.length > 0 : isValidCode(code);
}

export function keyAtPixel(keys: CodeKey[], x: number, y: number): number {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (x >= k.x && x < k.x + k.width && y >= k.y && y < k.y + k.height) return i;
  }
  return -1;
}

/** Only release over the originally pressed key commits; hold/repeat is not text input. */
export class CodeKeyGesture {
  private armed: number = -1;
  begin(key: number): void { if (this.armed < 0) this.armed = key; }
  cancel(): void { this.armed = -1; }
  active(): boolean { return this.armed >= 0; }
  end(key: number): number {
    const result = this.armed >= 0 && this.armed === key ? key : -1;
    this.armed = -1;
    return result;
  }
}

export function paintCodeKeyboard(canvas: GbCanvas, keys: CodeKey[], code: string,
                                  hover: number, pressed: number, cursor: number[]): void {
  canvas.clear(0);
  drawCentred(canvas, "WORLD CODE", 3, 3, 1);
  drawCentred(canvas, "POINT + PINCH A LETTER", 13, 3, 1);
  for (let i = 0; i < CODE_LENGTH; i++) {
    const x = 25 + i * 19;
    canvas.fillRect(x, 23, 15, 12, 1);
    if (i === code.length) canvas.fillRect(x, 33, 15, 2, 3);
    if (i < code.length) drawText(canvas, code.charAt(i), x + 5, 25, 3, 1);
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const enabled = keyEnabled(k, code);
    const pointed = enabled && (i === hover || i === pressed);
    const selected = cursor && cursor[0] === k.row && cursor[1] === k.column;
    canvas.fillRect(k.x, k.y, k.width, k.height, enabled ? 1 : 0);
    if (selected && enabled) {
      canvas.fillRect(k.x, k.y + k.height - 1, k.width, 1, 3);
    }
    if (pointed) {
      // Light inner face, thick dark border: visible on an additive display.
      canvas.fillRect(k.x - 1, k.y - 1, k.width + 2, k.height + 2, 3);
      canvas.fillRect(k.x + 1, k.y + 1, k.width - 2, k.height - 2, i === pressed ? 1 : 0);
    }
    drawText(canvas, k.label, k.x + Math.round((k.width - textWidth(k.label, 1)) / 2),
             k.y + Math.round((k.height - 7) / 2), enabled ? 3 : 1, 1);
  }
  drawCentred(canvas, code.length === CODE_LENGTH ? "CHECK CODE, THEN LOAD" : "6 CHARACTERS FROM SITE", 136, 3, 1);
}
