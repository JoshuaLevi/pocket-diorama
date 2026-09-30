import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GEN1_SAVE_BYTES, MAX_SAVE_UPLOAD_BYTES } from "./config.js";
import { crc32Hex, sha1Hex } from "./hash.js";
import { isFile } from "./paths.js";
function newSaveId() {
  const now = new Date();
  const stamp = String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  return stamp + "-" + randomBytes(3).toString("hex");
}

function safeFilename(name) {
  const trimmed = name.trim().replace(/[^A-Za-z0-9 ._()-]/g, "_");
  const clipped = trimmed.slice(0, 120);
  return clipped.length > 0 ? clipped : "save.sav";
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
    if (typeof candidate.id !== "string" || typeof candidate.sizeBytes !== "number")
      continue;
    out.push({
      id: candidate.id,
      romId: typeof candidate.romId === "string" ? candidate.romId : null,
      filename: typeof candidate.filename === "string" ? candidate.filename : candidate.id + ".sav",
      sizeBytes: candidate.sizeBytes,
      sha1: typeof candidate.sha1 === "string" ? candidate.sha1 : "",
      crc32: typeof candidate.crc32 === "string" ? candidate.crc32 : "",
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
      source: typeof candidate.source === "string" ? candidate.source : "unknown",
      looksLikeGen1: candidate.looksLikeGen1 === true,
      note: typeof candidate.note === "string" ? candidate.note : "",
    });
  }
  return out;
}

/**
 * Battery-backed SRAM images the lens has pushed up, plus any the user dropped in from
 * the browser so the lens can pull one back down.
 *
 * Saves are the one thing here the user cannot regenerate from their own cartridge, so
 * writes are atomic (write temp, rename) and nothing is ever overwritten in place.
 */
export class SaveStore {
  #layout;
  #records = [];
  constructor(layout) {
    this.#layout = layout;
    this.#load();
  }
  #savePath(id) {
    return join(this.#layout.saves, id + ".sav");
  }
  #load() {
    if (!isFile(this.#layout.saveIndex)) {
      this.#records = [];
      return;
    }
    let records = [];
    try {
      records = parseRecords(readFileSync(this.#layout.saveIndex, "utf8"));
    }
    catch {
      records = [];
    }
    this.#records = records.filter((record) => isFile(this.#savePath(record.id)));
    if (this.#records.length !== records.length)
      this.#persist();
  }
  #persist() {
    const tmp = this.#layout.saveIndex + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.#records, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.#layout.saveIndex);
  }
  /** Snapshot, newest first. Optionally narrowed to one cartridge. */
  list(romId) {
    const all = this.#records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (romId === undefined || romId === null)
      return all;
    return all.filter((record) => record.romId === romId);
  }
  get(id) {
    for (const record of this.#records) {
      if (record.id === id)
        return record;
    }
    return null;
  }
  readBytes(id) {
    const record = this.get(id);
    if (record === null)
      throw new Error("unknown save id " + id);
    const buffer = readFileSync(this.#savePath(record.id));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  add(input) {
    const { bytes } = input;
    if (bytes.length === 0)
      throw new Error("empty save");
    if (bytes.length > MAX_SAVE_UPLOAD_BYTES) {
      throw new Error("save is larger than the " + MAX_SAVE_UPLOAD_BYTES + " byte limit");
    }
    const id = newSaveId();
    const record = {
      id,
      romId: input.romId,
      filename: safeFilename(input.filename),
      sizeBytes: bytes.length,
      sha1: sha1Hex(bytes),
      crc32: crc32Hex(bytes),
      createdAt: new Date().toISOString(),
      source: input.source,
      looksLikeGen1: bytes.length === GEN1_SAVE_BYTES,
      note: input.note ?? "",
    };
    const target = this.#savePath(id);
    const tmp = target + ".tmp";
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, target);
    this.#records = this.#records.concat([record]);
    this.#persist();
    return record;
  }
  remove(id) {
    const record = this.get(id);
    if (record === null)
      return false;
    this.#records = this.#records.filter((entry) => entry.id !== id);
    this.#persist();
    rmSync(this.#savePath(id), { force: true });
    return true;
  }
}
