import { ACK_TIMEOUT_MS } from "../config.js";
import { CHUNK_VERSION, encodeChunkFrame } from "./binheader.js";
/**
 * One file on its way to the glasses.
 *
 * Two things here exist purely because the receiver is a lens. The chunk loop awaits
 * every send, so socket backpressure actually reaches the loop and the progress bar on
 * the glasses tracks reality instead of jumping to 100 while the kernel drains. And
 * `ackEvery` lets a client that cannot keep up with the wire throttle the sender from
 * its own side, which a WebSocket otherwise gives you no way to express.
 */
export class ChunkDownload {
  transferId;
  chunkCount;
  #deps;
  #params;
  #cancelled = false;
  #cancelReason = "";
  #chunkIndex = 0;
  #sentBytes = 0;
  #startedAt = Date.now();
  #awaitingChunk = -1;
  /** @type {((delivered: boolean) => void) | null} */
  #ackResolve = null;
  /** @type {NodeJS.Timeout | null} */
  #ackTimer = null;
  constructor(deps, params) {
    this.#deps = deps;
    this.#params = params;
    this.transferId = params.transferId;
    this.chunkCount = Math.max(1, Math.ceil(params.bytes.length / params.chunkBytes));
  }
  get elapsedMs() {
    return Date.now() - this.#startedAt;
  }
  snapshot() {
    return {
      transferId: this.transferId,
      kind: this.#params.kind,
      direction: "to-lens",
      name: this.#params.name,
      chunkIndex: this.#chunkIndex,
      chunkCount: this.chunkCount,
      transferredBytes: this.#sentBytes,
      totalBytes: this.#params.bytes.length,
      startedAt: this.#startedAt,
    };
  }
  cancel(reason) {
    if (this.#cancelled)
      return;
    this.#cancelled = true;
    this.#cancelReason = reason;
    this.#settleAck(false);
  }
  /** A lens acking chunk N releases the sender through chunk N. */
  ack(chunkIndex) {
    if (this.#ackResolve !== null && chunkIndex >= this.#awaitingChunk)
      this.#settleAck(true);
  }
  #settleAck(delivered) {
    if (this.#ackTimer !== null) {
      clearTimeout(this.#ackTimer);
      this.#ackTimer = null;
    }
    const resolve = this.#ackResolve;
    this.#ackResolve = null;
    if (resolve !== null)
      resolve(delivered);
  }
  #waitForAck(chunkIndex) {
    return new Promise((resolve) => {
      this.#awaitingChunk = chunkIndex;
      this.#ackResolve = resolve;
      this.#ackTimer = setTimeout(() => {
        this.#ackTimer = null;
        this.#ackResolve = null;
        resolve(false);
      }, ACK_TIMEOUT_MS);
    });
  }
  #frameFor(index) {
    const { bytes, chunkBytes, encoding, kind, chunkKind } = this.#params;
    const byteOffset = index * chunkBytes;
    const end = Math.min(byteOffset + chunkBytes, bytes.length);
    const slice = bytes.subarray(byteOffset, end);
    if (encoding === "binary") {
      const frame = encodeChunkFrame({
        version: CHUNK_VERSION,
        kind: chunkKind,
        transferId: this.transferId,
        chunkIndex: index,
        chunkCount: this.chunkCount,
        byteOffset,
      }, slice);
      return { frame, text: null, end };
    }
    const text = JSON.stringify({
      type: kind === "rom" ? "rom.chunk" : "save.chunk",
      transferId: this.transferId,
      chunkIndex: index,
      chunkCount: this.chunkCount,
      byteOffset,
      byteLength: slice.length,
      data: Buffer.from(slice).toString("base64"),
    });
    return { frame: null, text, end };
  }
  /**
   * Sends `begin`, then every chunk, then `end`. The two envelope messages are supplied
   * by the caller so this class stays ignorant of the difference between a ROM and a
   * save; everything in between is identical.
   */
  async run(begin, buildEnd) {
    this.#startedAt = Date.now();
    await this.#deps.send(begin);
    // Yield one turn before the first chunk so `begin` leaves in its own write. Without
    // this the header and chunk zero share a TCP segment, the client parses both in one
    // pass, and any handler installed in reaction to `begin` misses the chunk that was
    // dispatched microseconds earlier. Costs a millisecond; removes a whole class of
    // "the first chunk vanished" bug reports from client authors.
    await new Promise((done) => setImmediate(done));
    for (let index = 0; index < this.chunkCount; index += 1) {
      if (this.#cancelled) {
        await this.#deps.send({
          type: "rom.cancelled",
          transferId: this.transferId,
          reason: this.#cancelReason,
        });
        return { completed: false, reason: this.#cancelReason };
      }
      const { frame, text, end } = this.#frameFor(index);
      try {
        if (frame !== null)
          await this.#deps.connection.sendBinary(frame);
        else if (text !== null)
          await this.#deps.connection.sendText(text);
      }
      catch (error) {
        return { completed: false, reason: "send failed: " + String(error) };
      }
      this.#chunkIndex = index + 1;
      this.#sentBytes = end;
      this.#deps.changed();
      const isLast = index + 1 >= this.chunkCount;
      const { ackEvery } = this.#params;
      if (ackEvery > 0 && !isLast && (index + 1) % ackEvery === 0) {
        const delivered = await this.#waitForAck(index);
        if (!delivered) {
          const reason = this.#cancelled ? this.#cancelReason : "no ack within " + String(ACK_TIMEOUT_MS) + " ms";
          if (!this.#cancelled) {
            await this.#deps.send({
              type: "error",
              code: "E_TIMEOUT",
              message: "no ack for chunk " + String(index) + ", giving up on transfer " + String(this.transferId),
            });
          }
          else {
            await this.#deps.send({ type: "rom.cancelled", transferId: this.transferId, reason });
          }
          return { completed: false, reason };
        }
      }
    }
    await this.#deps.send(buildEnd(this.elapsedMs));
    return { completed: true, reason: "" };
  }
}
