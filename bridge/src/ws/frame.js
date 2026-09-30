/**
 * RFC 6455 frame codec.
 *
 * The bridge speaks WebSocket without a dependency, because the whole point of a
 * provisioning tool is that `npx pokemon-ar-bridge` works on a machine that has never
 * seen this project: no install step, no lockfile, no supply chain. The protocol we
 * actually use is small (text frames plus unfragmented binary frames), so the codec is
 * small too, but it validates strictly rather than assuming a friendly client.
 */
export const OPCODE_CONTINUATION = 0x0;

export const OPCODE_TEXT = 0x1;

export const OPCODE_BINARY = 0x2;

export const OPCODE_CLOSE = 0x8;

export const OPCODE_PING = 0x9;

export const OPCODE_PONG = 0xa;

export const CLOSE_NORMAL = 1000;

export const CLOSE_GOING_AWAY = 1001;

export const CLOSE_PROTOCOL_ERROR = 1002;

export const CLOSE_UNSUPPORTED_DATA = 1003;

export const CLOSE_POLICY_VIOLATION = 1008;

export const CLOSE_TOO_LARGE = 1009;

export const CLOSE_INTERNAL_ERROR = 1011;

/** Server frames are never masked; client frames always are. */

export function encodeFrame(opcode, payload, fin = true) {
  const length = payload.length;
  let headerLength = 2;
  if (length >= 126 && length <= 0xffff)
    headerLength = 4;
  else if (length > 0xffff)
    headerLength = 10;
  const frame = Buffer.allocUnsafe(headerLength + length);
  frame[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  if (headerLength === 2) {
    frame[1] = length;
  }
  else if (headerLength === 4) {
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
  }
  else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  if (length > 0)
    frame.set(payload, headerLength);
  return frame;
}

/** Close frame payload: a big-endian status code followed by a UTF-8 reason. */

export function encodeClose(code, reason) {
  const reasonBytes = Buffer.from(reason.slice(0, 120), "utf8");
  const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return encodeFrame(OPCODE_CLOSE, payload);
}

function unmask(payload, key) {
  const out = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[i] = payload[i] ^ key[i & 3];
  }
  return out;
}

/**
 * Incremental decoder. Feed it socket chunks, get back whole messages: fragmentation is
 * reassembled here so the session layer never sees a partial payload.
 */
export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  #consumed = 0;
  #fragments = [];
  #fragmentOpcode = -1;
  #fragmentBytes = 0;
  #maxMessageBytes;
  #failed = false;
  constructor(maxMessageBytes) {
    this.#maxMessageBytes = maxMessageBytes;
  }
  push(chunk) {
    if (this.#failed)
      return [];
    this.#buffer =
      this.#consumed === 0
        ? Buffer.concat([this.#buffer, chunk])
        : Buffer.concat([this.#buffer.subarray(this.#consumed), chunk]);
    this.#consumed = 0;
    return this.#drain();
  }
  #fail(events, code, reason) {
    this.#failed = true;
    events.push({ kind: "failure", code, reason });
    return events;
  }
  #drain() {
    const events = [];
    for (;;) {
      const available = this.#buffer.length - this.#consumed;
      if (available < 2)
        return events;
      const at = this.#consumed;
      const byte0 = this.#buffer[at];
      const byte1 = this.#buffer[at + 1];
      const fin = (byte0 & 0x80) !== 0;
      const reserved = byte0 & 0x70;
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      if (reserved !== 0) {
        return this.#fail(events, CLOSE_PROTOCOL_ERROR, "reserved bits set");
      }
      if (!masked) {
        return this.#fail(events, CLOSE_PROTOCOL_ERROR, "client frames must be masked");
      }
      let payloadLength = byte1 & 0x7f;
      let headerLength = 2;
      if (payloadLength === 126) {
        if (available < 4)
          return events;
        payloadLength = this.#buffer.readUInt16BE(at + 2);
        headerLength = 4;
      }
      else if (payloadLength === 127) {
        if (available < 10)
          return events;
        const big = this.#buffer.readBigUInt64BE(at + 2);
        if (big > BigInt(this.#maxMessageBytes)) {
          return this.#fail(events, CLOSE_TOO_LARGE, "frame exceeds the message limit");
        }
        payloadLength = Number(big);
        headerLength = 10;
      }
      if (payloadLength > this.#maxMessageBytes) {
        return this.#fail(events, CLOSE_TOO_LARGE, "frame exceeds the message limit");
      }
      const maskOffset = at + headerLength;
      const totalLength = headerLength + 4 + payloadLength;
      if (this.#buffer.length - at < totalLength)
        return events;
      const key = this.#buffer.subarray(maskOffset, maskOffset + 4);
      const maskedPayload = this.#buffer.subarray(maskOffset + 4, maskOffset + 4 + payloadLength);
      const payload = unmask(maskedPayload, key);
      this.#consumed = at + totalLength;
      const isControl = (opcode & 0x08) !== 0;
      if (isControl) {
        if (!fin)
          return this.#fail(events, CLOSE_PROTOCOL_ERROR, "fragmented control frame");
        if (payloadLength > 125) {
          return this.#fail(events, CLOSE_PROTOCOL_ERROR, "oversized control frame");
        }
        if (opcode !== OPCODE_CLOSE && opcode !== OPCODE_PING && opcode !== OPCODE_PONG) {
          return this.#fail(events, CLOSE_PROTOCOL_ERROR, "unknown control opcode");
        }
        events.push({ kind: "control", opcode, data: payload });
        continue;
      }
      if (opcode === OPCODE_CONTINUATION) {
        if (this.#fragmentOpcode < 0) {
          return this.#fail(events, CLOSE_PROTOCOL_ERROR, "continuation without a start frame");
        }
        this.#fragmentBytes += payload.length;
        if (this.#fragmentBytes > this.#maxMessageBytes) {
          return this.#fail(events, CLOSE_TOO_LARGE, "message exceeds the message limit");
        }
        this.#fragments.push(payload);
        if (fin) {
          const data = Buffer.concat(this.#fragments, this.#fragmentBytes);
          const messageOpcode = this.#fragmentOpcode;
          this.#fragments = [];
          this.#fragmentOpcode = -1;
          this.#fragmentBytes = 0;
          events.push({ kind: "message", opcode: messageOpcode, data });
        }
        continue;
      }
      if (opcode !== OPCODE_TEXT && opcode !== OPCODE_BINARY) {
        return this.#fail(events, CLOSE_PROTOCOL_ERROR, "unknown data opcode");
      }
      if (this.#fragmentOpcode >= 0) {
        return this.#fail(events, CLOSE_PROTOCOL_ERROR, "new data frame inside a fragment");
      }
      if (fin) {
        events.push({ kind: "message", opcode, data: payload });
        continue;
      }
      this.#fragmentOpcode = opcode;
      this.#fragments = [payload];
      this.#fragmentBytes = payload.length;
    }
  }
}
