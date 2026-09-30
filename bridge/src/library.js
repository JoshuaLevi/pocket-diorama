import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalRomFor, MAX_ROM_UPLOAD_BYTES } from "./config.js";
import { crc32Hex, sha1Hex } from "./hash.js";
import { readGbHeader } from "./gbheader.js";
import { isFile } from "./paths.js";
function safeFilename(name) {
  const trimmed = name.trim().replace(/[^A-Za-z0-9 ._()-]/g, "_");
  const clipped = trimmed.slice(0, 120);
  return clipped.length > 0 ? clipped : "rom.gb";
}

function parseRecords(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed))
    return [];
  const out = [];
  for (const item of parsed) {
    if (item === null || typeof item !== "object")
      continue;
    const candidate = item;
    if (typeof candidate.sha1 !== "string" || typeof candidate.sizeBytes !== "number")
      continue;
    out.push({
      id: candidate.sha1,
      sha1: candidate.sha1,
      crc32: typeof candidate.crc32 === "string" ? candidate.crc32 : "",
      filename: typeof candidate.filename === "string" ? candidate.filename : "rom.gb",
      sizeBytes: candidate.sizeBytes,
      addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : new Date(0).toISOString(),
      game: typeof candidate.game === "string" ? candidate.game : null,
      label: typeof candidate.label === "string" ? candidate.label : null,
      verified: candidate.verified === true,
      cartridgeTitle: typeof candidate.cartridgeTitle === "string" ? candidate.cartridgeTitle : "",
      cartridgeType: typeof candidate.cartridgeType === "string" ? candidate.cartridgeType : "",
    });
  }
  return out;
}

/**
 * The on-disk ROM library.
 *
 * Records are treated as immutable: every mutation replaces the array rather than
 * editing an entry in place, so a caller holding a list keeps a stable snapshot.
 */
export class RomLibrary {
  #layout;
  #records = [];
  constructor(layout) {
    this.#layout = layout;
    this.#load();
  }
  #romPath(sha1) {
    return join(this.#layout.roms, sha1 + ".gb");
  }
  #load() {
    if (!isFile(this.#layout.romIndex)) {
      this.#records = [];
      return;
    }
    let records = [];
    try {
      records = parseRecords(readFileSync(this.#layout.romIndex, "utf8"));
    }
    catch {
      records = [];
    }
    // Drop entries whose backing file went away, so the UI never offers a ghost.
    this.#records = records.filter((record) => isFile(this.#romPath(record.sha1)));
    if (this.#records.length !== records.length)
      this.#persist();
  }
  #persist() {
    const tmp = this.#layout.romIndex + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.#records, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.#layout.romIndex);
  }
  /** Snapshot of the library, newest first. */
  list() {
    return this.#records.slice().sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  /** Only the ROMs a lens is allowed to see. */
  listVerified() {
    return this.list().filter((record) => record.verified);
  }
  get(id) {
    for (const record of this.#records) {
      if (record.id === id)
        return record;
    }
    return null;
  }
  /** Raw cartridge bytes. Throws when the record is unknown or the file vanished. */
  readBytes(id) {
    const record = this.get(id);
    if (record === null)
      throw new Error("unknown rom id " + id);
    const buffer = readFileSync(this.#romPath(record.sha1));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  /**
   * Stores a cartridge image. A ROM whose hash is not canonical is still stored, but
   * marked unverified: the user gets a red row in the UI explaining why their file is
   * unusable, which beats a silent rejection. Serving is gated on `verified`.
   */
  add(filename, bytes) {
    if (bytes.length === 0)
      throw new Error("empty file");
    if (bytes.length > MAX_ROM_UPLOAD_BYTES) {
      throw new Error("file is larger than the " + MAX_ROM_UPLOAD_BYTES + " byte upload limit");
    }
    const sha1 = sha1Hex(bytes);
    const existing = this.get(sha1);
    if (existing !== null)
      return { record: existing, created: false };
    const canonical = canonicalRomFor(sha1);
    const header = readGbHeader(bytes);
    const record = {
      id: sha1,
      sha1,
      crc32: crc32Hex(bytes),
      filename: safeFilename(filename),
      sizeBytes: bytes.length,
      addedAt: new Date().toISOString(),
      game: canonical === null ? null : canonical.game,
      label: canonical === null ? null : canonical.label,
      verified: canonical !== null,
      cartridgeTitle: header === null ? "" : header.title,
      cartridgeType: header === null ? "" : header.cartridgeTypeName,
    };
    const target = this.#romPath(sha1);
    const tmp = target + ".tmp";
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, target);
    this.#records = this.#records.concat([record]);
    this.#persist();
    return { record, created: true };
  }
  /** Removes the record and its bytes. Returns false when the id was unknown. */
  remove(id) {
    const record = this.get(id);
    if (record === null)
      return false;
    this.#records = this.#records.filter((entry) => entry.id !== id);
    this.#persist();
    rmSync(this.#romPath(record.sha1), { force: true });
    return true;
  }
}
