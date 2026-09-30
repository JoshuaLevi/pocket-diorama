/**
 * Gen 1 text decoding.
 *
 * The cart stores text in a bespoke character encoding, not ASCII: byte 0x80
 * is "A", 0x50 terminates a string, and a scattering of bytes are control
 * codes. The byte-to-glyph table lives in the manifest as `charmap` (keys are
 * decimal strings, values are the glyph or a `<TOKEN>` name), so the mapping
 * ships with us and the cart supplies only the bytes.
 *
 * Ports `decode_text` / `read_string` from gen1recomp/tools/rom_data.py and
 * `_text_glyph` / `_decode_text_commands` from build_rom_data.py.
 */

import type { Rom } from "./Rom";
import type { RomSymbol } from "./Symbols";

/** Byte that ends a string. */
export const TEXT_TERMINATOR = 0x50;

/** Manifest byte-to-glyph table: decimal byte value -> glyph or `<TOKEN>`. */
export interface Charmap {
  [code: string]: string;
}

/**
 * Glyphs the text-command decoder renders differently from the plain string
 * decoder. Matches TEXT_GLYPH_OVERRIDES in build_rom_data.py.
 */
export const TEXT_GLYPH_OVERRIDES: { [code: string]: string } = {
  "75": "{_CONT}",
  "76": "{SCROLL}",
  "109": "{COLON}",
  "240": "¥",
};

function hex2Upper(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function unknownByte(value: number): string {
  return "{BYTE:" + hex2Upper(value) + "}";
}

function lookup(charmap: Charmap, value: number): string {
  const glyph = charmap[String(value)];
  return glyph === undefined ? unknownByte(value) : glyph;
}

/**
 * Decode a run of raw text bytes, stopping at `stop` (0x50 by default).
 *
 * Bytes with no charmap entry come out as `{BYTE:XX}` rather than being
 * dropped, so an unexpected encoding shows up in the diff instead of silently
 * shortening a line.
 */
export function decodeText(
  raw: ArrayLike<number>,
  charmap: Charmap,
  stop: number = TEXT_TERMINATOR,
): string {
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (value === stop) {
      break;
    }
    parts.push(lookup(charmap, value));
  }
  return parts.join("");
}

/** A decoded string plus how many ROM bytes it consumed, terminator included. */
export interface ReadStringResult {
  text: string;
  length: number;
}

/**
 * Read and decode a terminated string straight from the ROM.
 *
 * Throws rather than truncating when no terminator turns up inside
 * `maxLength`, which is what catches a wrong address before it becomes pages
 * of garbage.
 */
export function readString(
  rom: Rom,
  bank: number,
  address: number,
  charmap: Charmap,
  stop: number = TEXT_TERMINATOR,
  maxLength: number = 4096,
): ReadStringResult {
  const parts: string[] = [];
  for (let i = 0; i < maxLength; i += 1) {
    const value = rom.byte(bank, address + i);
    if (value === stop) {
      return { text: parts.join(""), length: i + 1 };
    }
    parts.push(lookup(charmap, value));
  }
  throw new Error(
    `unterminated string at ${bank.toString(16).padStart(2, "0")}:` +
      `${address.toString(16).padStart(4, "0")} (limit ${maxLength})`,
  );
}

/**
 * Glyph for one byte inside a text-command stream.
 *
 * Differs from the plain decoder in two ways: a few bytes have explicit
 * overrides, and charmap entries written as `<TOKEN>` are re-bracketed to
 * `{TOKEN}` so every marker in decoded dialogue uses the same syntax.
 */
export function textGlyph(value: number, charmap: Charmap): string {
  const override = TEXT_GLYPH_OVERRIDES[String(value)];
  if (override !== undefined) {
    return override;
  }
  const glyph = lookup(charmap, value);
  if (
    glyph.length >= 2 &&
    glyph.charAt(0) === "<" &&
    glyph.charAt(glyph.length - 1) === ">"
  ) {
    return "{" + glyph.substring(1, glyph.length - 1) + "}";
  }
  return glyph;
}

/**
 * One runtime substitution in a text-command stream.
 *
 * `command` is the opcode that must appear at this point ($01, $02 or $09);
 * `token` is the placeholder written into the decoded text in its place, e.g.
 * `{RAM:wTrainerName}`. The manifest stores these as `[command, token]` pairs
 * under `text.dynamic`.
 */
export interface TextSubstitution {
  command: number;
  token: string;
}

/**
 * Normalise the manifest's `[command, token]` pairs into TextSubstitution.
 * Returns an empty list for a missing entry, which is the common case.
 */
export function parseSubstitutions(raw: unknown): TextSubstitution[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error("text substitutions must be an array of [command, token]");
  }
  const out: TextSubstitution[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const pair = raw[i];
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(
        `text substitution ${i} must be a [command, token] pair`,
      );
    }
    const command = Number(pair[0]);
    const token = pair[1];
    if (!Number.isInteger(command) || typeof token !== "string") {
      throw new Error(
        `text substitution ${i} must be [integer command, string token]`,
      );
    }
    out.push({ command: command, token: token });
  }
  return out;
}

/**
 * Decode a text-command stream starting at `symbol`.
 *
 * The stream is a tiny bytecode, not a string:
 *   $50            end of stream
 *   $00            inline text, itself terminated by $50 (or ended outright by
 *                  $57 / $58 / $5F)
 *   $01 / $02 / $09  splice in a runtime value; the operand bytes are skipped
 *                  and the matching entry from `substitutions` is emitted
 *
 * Every substitution must be consumed, in order, and the opcode must match the
 * one the manifest recorded. Both mismatches throw, because a silent
 * misalignment would produce dialogue that reads fine and names the wrong
 * character.
 */
export function decodeTextCommands(
  rom: Rom,
  symbol: RomSymbol,
  charmap: Charmap,
  substitutions: TextSubstitution[],
): string {
  let address = symbol.address;
  let pending = 0;
  const out: string[] = [];

  for (let step = 0; step < 4096; step += 1) {
    const command = rom.byte(symbol.bank, address);
    address += 1;

    if (command === 0x50) {
      if (pending < substitutions.length) {
        throw new Error(`${symbol.name}: unused dynamic text substitutions`);
      }
      return out.join("");
    }

    if (command === 0x00) {
      for (;;) {
        const value = rom.byte(symbol.bank, address);
        address += 1;
        if (value === 0x50) {
          break;
        }
        if (value === 0x57 || value === 0x58 || value === 0x5f) {
          if (pending < substitutions.length) {
            throw new Error(
              `${symbol.name}: unused dynamic text substitutions`,
            );
          }
          return out.join("");
        }
        out.push(textGlyph(value, charmap));
      }
      continue;
    }

    if (command === 0x01 || command === 0x02 || command === 0x09) {
      if (pending >= substitutions.length) {
        throw new Error(
          `${symbol.name}: missing substitution for command ` +
            `$${hex2Upper(command)}`,
        );
      }
      const substitution = substitutions[pending];
      pending += 1;
      if (command !== substitution.command) {
        throw new Error(
          `${symbol.name}: expected command $${hex2Upper(substitution.command)}, ` +
            `found $${hex2Upper(command)}`,
        );
      }
      out.push(substitution.token);
      address += command === 0x01 ? 2 : 3;
      continue;
    }

    throw new Error(
      `${symbol.name}: unsupported text command $${hex2Upper(command)}`,
    );
  }
  throw new Error(`${symbol.name}: text command stream is too long`);
}
