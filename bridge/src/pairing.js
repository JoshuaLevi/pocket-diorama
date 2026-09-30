import { randomInt } from "node:crypto";
import { safeEqual } from "./hash.js";
/**
 * A six digit code, shown in the terminal and in the browser UI, that a lens must
 * present before the bridge will talk about ROMs.
 *
 * This is not authentication in any serious sense; it is the guarantee a printer
 * pairing code gives. It stops the other laptop on the cafe wifi from silently pulling
 * a megabyte off this machine, and it makes "which of these two Macs am I talking to"
 * answerable from inside a lens that has no keyboard.
 */
export class PairingCode {
  #code;
  #required;
  #rotatedAt;
  constructor(required, initial) {
    this.#required = required;
    this.#code = initial ?? PairingCode.generate();
    this.#rotatedAt = Date.now();
  }
  static generate() {
    return String(randomInt(0, 1000000)).padStart(6, "0");
  }
  get value() {
    return this.#code;
  }
  get required() {
    return this.#required;
  }
  get rotatedAt() {
    return this.#rotatedAt;
  }
  rotate() {
    this.#code = PairingCode.generate();
    this.#rotatedAt = Date.now();
    return this.#code;
  }
  /** True when the supplied code is acceptable. Always true when pairing is disabled. */
  matches(candidate) {
    if (!this.#required)
      return true;
    if (typeof candidate !== "string")
      return false;
    return safeEqual(candidate.trim(), this.#code);
  }
}
