/**
 * Named CPU addresses, resolved from the bundled ROM manifest.
 *
 * Port of `SymbolTable` in gen1recomp/tools/rom_data.py, minus the RGBDS
 * `.sym` file reader: the Lens only ever sees the manifest form, where every
 * entry is `"SymbolName": [bank, address]`. The manifest carries no ROM bytes,
 * which is what lets it ship with us under MIT while the cart does not.
 */

import type { RomLocation } from "./Rom";

/** Manifest symbol table: name -> [bank, address]. */
export interface SymbolLocations {
  [name: string]: number[];
}

export interface RomSymbol extends RomLocation {
  bank: number;
  address: number;
  name: string;
}

interface SymbolsByName {
  [name: string]: RomSymbol;
}

interface NamesByLocation {
  [key: string]: string[];
}

function locationKey(bank: number, address: number): string {
  return bank + ":" + address;
}

export class Symbols {
  private readonly byName: SymbolsByName;
  private readonly byLocation: NamesByLocation;
  private readonly count: number;

  constructor(source: SymbolLocations) {
    if (source === null || typeof source !== "object") {
      throw new Error("Symbols expects the manifest 'symbols' object");
    }
    // Null-prototype maps so a symbol literally named "constructor" or
    // "toString" cannot collide with Object.prototype.
    this.byName = Object.create(null) as SymbolsByName;
    this.byLocation = Object.create(null) as NamesByLocation;

    const names = Object.keys(source);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const location = source[name];
      if (!Array.isArray(location) || location.length !== 2) {
        throw new Error(`invalid embedded symbol location for '${name}'`);
      }
      const bank = Number(location[0]);
      const address = Number(location[1]);
      if (!Number.isInteger(bank) || !Number.isInteger(address)) {
        throw new Error(`non-integer symbol location for '${name}'`);
      }
      const symbol: RomSymbol = { bank: bank, address: address, name: name };
      this.byName[name] = symbol;
      const key = locationKey(bank, address);
      const existing = this.byLocation[key];
      if (existing === undefined) {
        this.byLocation[key] = [name];
      } else {
        existing.push(name);
      }
    }
    this.count = names.length;
  }

  /** How many symbols the manifest defined. */
  get size(): number {
    return this.count;
  }

  /** True when `name` is defined. */
  has(name: string): boolean {
    return this.byName[name] !== undefined;
  }

  /**
   * Resolve a symbol, or throw.
   *
   * The message matches `_symbol()` in build_rom_data.py, so a manifest gap
   * reads the same way in both implementations.
   */
  get(name: string): RomSymbol {
    const symbol = this.byName[name];
    if (symbol === undefined) {
      throw new Error(`required symbol '${name}' is missing`);
    }
    return symbol;
  }

  /** Resolve a symbol, or null when it is not defined. */
  tryGet(name: string): RomSymbol | null {
    const symbol = this.byName[name];
    return symbol === undefined ? null : symbol;
  }

  /** Every name defined at one location, in manifest order. */
  namesAt(bank: number, address: number): string[] {
    const names = this.byLocation[locationKey(bank, address)];
    return names === undefined ? [] : names.slice();
  }

  /**
   * Every symbol whose name starts with `prefix`, sorted by
   * (bank, address, name) -- the same ordering the reference uses, so
   * prefix-driven tables come out in the same order.
   */
  prefixed(prefix: string): RomSymbol[] {
    const out: RomSymbol[] = [];
    const names = Object.keys(this.byName);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (name.indexOf(prefix) === 0) {
        out.push(this.byName[name]);
      }
    }
    out.sort(function compare(a: RomSymbol, b: RomSymbol): number {
      if (a.bank !== b.bank) {
        return a.bank - b.bank;
      }
      if (a.address !== b.address) {
        return a.address - b.address;
      }
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return out;
  }
}
