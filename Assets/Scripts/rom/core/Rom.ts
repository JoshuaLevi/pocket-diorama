/**
 * Banked read access to a Gen 1 Game Boy ROM image.
 *
 * A direct port of `RomImage` in gen1recomp/tools/rom_data.py. Behaviour,
 * including which reads throw and which silently clamp, is deliberately
 * identical so the TypeScript extractor fails in exactly the same places as
 * the Python reference.
 *
 * Gen 1 banking, as the CPU sees it:
 *   bank 0  -> $0000-$3FFF, mapped straight onto file offsets $0000-$3FFF
 *   bank N  -> $4000-$7FFF, a window onto file offsets N*$4000 .. N*$4000+$3FFF
 *
 * So a CPU address is only meaningful together with the bank it was read in,
 * and an address outside the window for its bank is a bug, not something to
 * silently wrap. `offset()` throws on those, exactly like the reference.
 */

import { sha1 } from "./sha1";

export const ROM_BANK_SIZE = 0x4000;

/** The only Pokemon Red revision this project decodes. */
export const CANONICAL_RED_SHA1 = "ea9bcae617fdf159b045185467ae58b2e4a48b9a";

/** Exact size of a canonical Gen 1 cart image, in bytes. */
export const GEN1_ROM_SIZE = 0x100000;

/** Anything carrying a bank/address pair: a symbol, or a hand-built literal. */
export interface RomLocation {
  bank: number;
  address: number;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, "0");
}

export class Rom {
  private readonly data: Uint8Array;
  private cachedSha1: string | null;

  constructor(data: Uint8Array) {
    if (!(data instanceof Uint8Array)) {
      throw new Error("Rom expects a Uint8Array of the raw cart image");
    }
    if (data.length === 0) {
      throw new Error("Rom image is empty");
    }
    this.data = data;
    this.cachedSha1 = null;
  }

  /** Size of the cart image in bytes. */
  get length(): number {
    return this.data.length;
  }

  /**
   * SHA-1 of the whole image as lowercase hex. Computed on first call and
   * cached; hashing 1 MiB is not free, so nothing in this class does it
   * implicitly.
   */
  sha1(): string {
    if (this.cachedSha1 === null) {
      this.cachedSha1 = sha1(this.data);
    }
    return this.cachedSha1;
  }

  /**
   * File offset of a banked CPU address.
   *
   * Throws when the address does not belong to the window for its bank, which
   * is what catches a wrong symbol or an off-by-one bank far earlier than a
   * garbled decode would.
   */
  static offset(bank: number, address: number): number {
    if (bank === 0) {
      if (!(address >= 0 && address < ROM_BANK_SIZE)) {
        throw new Error(`ROM0 address out of range: $${hex4(address)}`);
      }
      return address;
    }
    if (!(address >= ROM_BANK_SIZE && address < ROM_BANK_SIZE * 2)) {
      throw new Error(
        `bank ${hex2(bank)} address out of range: $${hex4(address)}`,
      );
    }
    return bank * ROM_BANK_SIZE + (address - ROM_BANK_SIZE);
  }

  /** Instance form of {@link Rom.offset}, for symmetry with the reference. */
  offsetOf(bank: number, address: number): number {
    return Rom.offset(bank, address);
  }

  /** File offset of a symbol's location. */
  at(location: RomLocation): number {
    return Rom.offset(location.bank, location.address);
  }

  /** One byte at a banked address. */
  byte(bank: number, address: number): number {
    const position = Rom.offset(bank, address);
    if (position >= this.data.length) {
      throw new Error(
        `read past end of ROM at ${hex2(bank)}:${hex4(address)} ` +
          `(offset ${position}, size ${this.data.length})`,
      );
    }
    return this.data[position];
  }

  /** Little-endian 16-bit word at a banked address. */
  word(bank: number, address: number): number {
    const position = Rom.offset(bank, address);
    if (position + 1 >= this.data.length) {
      throw new Error(
        `read past end of ROM at ${hex2(bank)}:${hex4(address)} ` +
          `(offset ${position}, size ${this.data.length})`,
      );
    }
    return this.data[position] | (this.data[position + 1] << 8);
  }

  /**
   * `length` bytes starting at a banked address, as a fresh copy.
   *
   * Only the start address is validated. A run that reaches past the end of
   * the bank window, or past the end of the file, is clamped rather than
   * rejected -- the reference slices a Python bytes object here, and pic
   * decompression relies on asking for "the rest of the bank" and getting
   * however much exists.
   */
  bytes(bank: number, address: number, length: number): Uint8Array {
    if (length < 0) {
      throw new Error(`negative read length ${length}`);
    }
    const position = Rom.offset(bank, address);
    return this.data.slice(position, position + length);
  }

  /**
   * Bytes from a banked address up to but not including `terminator`.
   *
   * Port of `_read_terminated` in build_rom_data.py: it throws rather than
   * returning a truncated list when `limit` bytes go by without a terminator.
   */
  readTerminated(
    bank: number,
    address: number,
    terminator: number,
    limit: number = 256,
  ): number[] {
    const out: number[] = [];
    for (let offset = 0; offset < limit; offset += 1) {
      const value = this.byte(bank, address + offset);
      if (value === terminator) {
        return out;
      }
      out.push(value);
    }
    throw new Error(
      `unterminated byte list at ${hex2(bank)}:${hex4(address)}`,
    );
  }
}

/**
 * Wrap a cart image and reject anything that is not the expected revision.
 *
 * Pass the manifest's `romSha1`. Refusing an unknown revision is the whole
 * safety story for this project: every address in the manifest is only valid
 * for one exact build, and a Virtual Console or revision-1 dump would decode
 * into plausible-looking garbage instead of failing.
 */
export function openRom(
  data: Uint8Array,
  expectedSha1?: string | null,
): Rom {
  const rom = new Rom(data);
  if (expectedSha1 !== undefined && expectedSha1 !== null && expectedSha1 !== "") {
    const actual = rom.sha1();
    if (actual !== expectedSha1.toLowerCase()) {
      throw new Error(
        `unsupported ROM SHA-1 ${actual}; expected ${expectedSha1.toLowerCase()}`,
      );
    }
  }
  return rom;
}
