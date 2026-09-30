// The lens side of bridge/PROTOCOL.md: pair, list, fetch a ROM, verify it.
//
// This replaces a smaller protocol invented to unblock rendering, which carried a
// pre-baked bundle rather than a cartridge. The bridge's is the real one, and the
// difference matters: what arrives here is the user's own ROM, which the lens then
// decodes itself. Nothing Nintendo made ever ships inside the lens.
//
// Two details from the spec are easy to get wrong and are handled deliberately:
//   - payload goes at `byteOffset`, not at chunkIndex * chunkBytes. They agree
//     today; the offset is authoritative and costs nothing.
//   - Blob.bytes() is async, so two chunks can be inside the handler at once. The
//     header is read before anything is awaited, so out-of-order completion is
//     harmless.

import { crc32, sha1Hex } from "./Checksum";

/** 20-byte little-endian header on every binary chunk. */
const HEADER_BYTES: number = 20;
const MAGIC_0: number = 0x50; // 'P'
const MAGIC_1: number = 0x41; // 'A'
const MAGIC_2: number = 0x52; // 'R'
const MAGIC_3: number = 0x31; // '1'
const KIND_ROM: number = 1;

const PROTOCOL_VERSION: number = 1;

export interface RomBridgeCallbacks {
  onProgress: (fraction: number, message: string) => void;
  /** The verified ROM, and the SHA-1 that selects its symbol table. */
  onRom: (bytes: Uint8Array, sha1: string, game: string) => void;
  onError: (message: string) => void;
}

export class RomBridge {
  private internetModule: InternetModule;
  private url: string;
  private pairingCode: string;
  private preferredRomId: string;

  private socket: any = null;
  private callbacks: RomBridgeCallbacks = null;

  private buffer: Uint8Array = null;
  private expectedChunks: number = 0;
  private receivedChunks: number = 0;
  private expectedSha1: string = "";
  private expectedCrc32: string = "";
  private game: string = "";
  private finished: boolean = false;
  /**
   * Messages are processed strictly in order by chaining them onto this promise.
   *
   * Without it, `rom.end` overtakes the still-awaiting `bytes()` of the last binary
   * frames and the transfer is declared incomplete at 30 of 32 chunks -- observed,
   * repeatedly. A text frame needs no await, so it jumps the queue; the chain puts
   * it back in line.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(internetModule: InternetModule, url: string, pairingCode: string,
              preferredRomId: string) {
    this.internetModule = internetModule;
    this.url = url;
    this.pairingCode = pairingCode ? pairingCode : "000000";
    this.preferredRomId = preferredRomId ? preferredRomId : "";
  }

  /** Preview and the bridge share a Mac; on device they do not. */
  static urlFor(lanHost: string, port: number): string {
    const host = global.deviceInfoSystem.isEditor() ? "127.0.0.1" : lanHost;
    return "ws://" + host + ":" + port;
  }

  connect(callbacks: RomBridgeCallbacks): void {
    this.callbacks = callbacks;
    let socket: any = null;
    try {
      socket = this.internetModule.createWebSocket(this.url);
    } catch (e) {
      callbacks.onError("cannot open " + this.url + ": " + e);
      return;
    }
    this.socket = socket;
    socket.binaryType = "blob";

    socket.onopen = () => callbacks.onProgress(0, "Connected");

    socket.onmessage = (event: any) => {
      const data = event.data;
      this.queue = this.queue.then(async () => {
        try {
          if (typeof data === "string") {
            this.onJson(JSON.parse(data));
            return;
          }
          this.onBinaryChunk(await data.bytes());
        } catch (e) {
          this.fail("frame handling failed: " + e);
        }
      });
    };

    socket.onerror = () => this.fail("socket error");
    socket.onclose = () => {
      if (!this.finished) {
        this.fail("bridge closed after " + this.receivedChunks + "/" + this.expectedChunks);
      }
    };
  }

  close(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // Already gone.
      }
      this.socket = null;
    }
  }

  private fail(message: string): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.callbacks) {
      this.callbacks.onError(message);
    }
  }

  private send(message: any): void {
    try {
      this.socket.send(JSON.stringify(message));
    } catch (e) {
      this.fail("send failed: " + e);
    }
  }

  private onJson(message: any): void {
    const type = message ? message.type : "";

    if (type === "hello") {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        this.fail("bridge speaks protocol " + message.protocolVersion +
                  ", this lens speaks " + PROTOCOL_VERSION);
        return;
      }
      this.callbacks.onProgress(0.02, "Pairing");
      this.send({
        type: "pair",
        id: "p1",
        code: this.pairingCode,
        client: { name: "Pokemon-AR lens", version: "0.1.0", platform: "spectacles" },
      });
      return;
    }

    if (type === "paired") {
      if (this.preferredRomId) {
        this.requestRom(this.preferredRomId);
      } else {
        this.callbacks.onProgress(0.04, "Looking for a cartridge");
        this.send({ type: "rom.list", id: "l1" });
      }
      return;
    }

    if (type === "rom.list.ok") {
      const roms = message.roms;
      if (!roms || roms.length === 0) {
        this.fail("the bridge has no verified cartridge; add one in its browser page");
        return;
      }
      this.requestRom(roms[0].romId);
      return;
    }

    if (type === "rom.begin") {
      // Allocate from what the bridge actually chose, never from what was asked.
      this.buffer = new Uint8Array(message.sizeBytes);
      this.expectedChunks = message.chunkCount;
      this.receivedChunks = 0;
      this.expectedSha1 = message.sha1;
      this.expectedCrc32 = message.crc32;
      this.game = message.game;
      this.callbacks.onProgress(0.06, "Reading the cartridge");
      return;
    }

    if (type === "rom.end") {
      this.finishTransfer(message);
      return;
    }

    if (type && type.indexOf("error") >= 0) {
      this.fail("bridge: " + (message.code ? message.code : "") + " " +
                (message.message ? message.message : ""));
    }
  }

  private requestRom(romId: string): void {
    this.callbacks.onProgress(0.05, "Requesting the cartridge");
    this.send({
      type: "rom.get",
      id: "g1",
      romId: romId,
      encoding: "binary",
      chunkBytes: 32768,
      ackEvery: 0,
    });
  }

  private onBinaryChunk(frame: Uint8Array): void {
    if (!this.buffer || frame.length < HEADER_BYTES) {
      return;
    }
    if (frame[0] !== MAGIC_0 || frame[1] !== MAGIC_1 ||
        frame[2] !== MAGIC_2 || frame[3] !== MAGIC_3) {
      this.fail("binary frame is not PAR1");
      return;
    }
    if (frame[5] !== KIND_ROM) {
      return;
    }

    // Little endian, as the header specifies.
    const byteOffset =
      frame[16] | (frame[17] << 8) | (frame[18] << 16) | (frame[19] << 24);

    const payloadLength = frame.length - HEADER_BYTES;
    if (byteOffset < 0 || byteOffset + payloadLength > this.buffer.length) {
      this.fail("chunk at offset " + byteOffset + " does not fit the ROM");
      return;
    }
    for (let i = 0; i < payloadLength; i++) {
      this.buffer[byteOffset + i] = frame[HEADER_BYTES + i];
    }

    this.receivedChunks++;
    const fraction = 0.06 + 0.8 * (this.receivedChunks / this.expectedChunks);
    this.callbacks.onProgress(fraction, "Reading the cartridge");
  }

  private finishTransfer(message: any): void {
    if (this.receivedChunks !== this.expectedChunks) {
      this.fail("incomplete: " + this.receivedChunks + "/" + this.expectedChunks + " chunks");
      return;
    }

    // CRC first: it is cheap and catches a truncated or misassembled transfer
    // before the far more expensive hash runs.
    this.callbacks.onProgress(0.88, "Checking the cartridge");
    const crc = crc32(this.buffer);
    if (this.expectedCrc32 && crc !== this.expectedCrc32) {
      this.fail("CRC-32 mismatch: got " + crc + ", expected " + this.expectedCrc32);
      return;
    }

    this.callbacks.onProgress(0.92, "Verifying the cartridge");
    const sha = sha1Hex(this.buffer);
    if (this.expectedSha1 && sha !== this.expectedSha1) {
      this.fail("SHA-1 mismatch: got " + sha + ", expected " + this.expectedSha1);
      return;
    }

    this.finished = true;
    this.callbacks.onProgress(0.95, "Cartridge verified");
    this.callbacks.onRom(this.buffer, sha, this.game);
  }
}
