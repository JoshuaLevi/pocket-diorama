import { sha1Hex } from "../hash.js";
/**
 * A save on its way up from the glasses.
 *
 * The buffer is allocated once from the declared size, so a lens that lies about its
 * size or its offsets cannot make the bridge grow memory: every chunk is bounds checked
 * against that allocation, and the SHA-1 the lens declared up front is what decides
 * whether the assembled bytes are kept.
 */
export class SaveUpload {
  uploadId;
  filename;
  romId;
  note;
  sizeBytes;
  chunkBytes;
  chunkCount;
  #buffer;
  #expectedSha1;
  #receivedBytes = 0;
  #startedAt = Date.now();
  constructor(params) {
    this.uploadId = params.uploadId;
    this.filename = params.filename;
    this.romId = params.romId;
    this.note = params.note;
    this.sizeBytes = params.sizeBytes;
    this.chunkBytes = params.chunkBytes;
    this.chunkCount = Math.max(1, Math.ceil(params.sizeBytes / params.chunkBytes));
    this.#buffer = new Uint8Array(params.sizeBytes);
    this.#expectedSha1 = params.sha1;
  }
  snapshot() {
    return {
      transferId: this.uploadId,
      kind: "save",
      direction: "from-lens",
      name: this.filename,
      chunkIndex: Math.min(this.chunkCount, Math.ceil(this.#receivedBytes / this.chunkBytes)),
      chunkCount: this.chunkCount,
      transferredBytes: this.#receivedBytes,
      totalBytes: this.sizeBytes,
      startedAt: this.#startedAt,
    };
  }
  /** Returns false when the chunk did not fit; the caller decides how loudly to complain. */
  accept(byteOffset, payload) {
    if (byteOffset < 0 || payload.length === 0)
      return false;
    if (byteOffset + payload.length > this.sizeBytes)
      return false;
    this.#buffer.set(payload, byteOffset);
    const reach = byteOffset + payload.length;
    if (reach > this.#receivedBytes)
      this.#receivedBytes = reach;
    return true;
  }
  commit() {
    if (this.#receivedBytes !== this.sizeBytes) {
      return {
        ok: false,
        code: "E_UPLOAD_MISMATCH",
        message: "expected " + String(this.sizeBytes) + " bytes but received " + String(this.#receivedBytes),
      };
    }
    const actual = sha1Hex(this.#buffer);
    if (actual !== this.#expectedSha1) {
      return {
        ok: false,
        code: "E_UPLOAD_MISMATCH",
        message: "sha1 mismatch: the lens declared " + this.#expectedSha1 + " but the bytes hash to " + actual,
      };
    }
    return { ok: true, bytes: this.#buffer };
  }
}
