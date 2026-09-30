/**
 * The bridge's type vocabulary, in one place.
 *
 * The runtime is plain JavaScript: Node refuses to strip TypeScript types from files
 * under node_modules, which would break `npx pokemon-ar-bridge`, the one invocation
 * this tool exists to support. Declarations live here instead, where they still type
 * check the JavaScript (see tsconfig.json, checkJs) and still document the wire.
 *
 * The ClientMessage and ServerMessage unions below are the typed twin of PROTOCOL.md.
 * Read them side by side; if they disagree, PROTOCOL.md is normative.
 */

import type { IncomingMessage, Server } from "node:http";
import type { RomLibrary } from "./library.js";
import type { SaveStore } from "./saves.js";
import type { PairingCode } from "./pairing.js";
import type { WsConnection } from "./ws/server.js";
import type { BridgeHub } from "./hub.js";

// --------------------------------------------------------------------------
// from src/config.js
// --------------------------------------------------------------------------

/** One row of the canonical cartridge table in src/config.js. */
export type CanonicalRom = {
  game: string;
  label: string;
  sha1: string;
  sizeBytes: number;
};

// --------------------------------------------------------------------------
// from src/paths.js
// --------------------------------------------------------------------------

export type DataLayout = {
  root: string;
  roms: string;
  saves: string;
  romIndex: string;
  saveIndex: string;
};

// --------------------------------------------------------------------------
// from src/lan.js
// --------------------------------------------------------------------------

export type LanAddress = {
  iface: string;
  address: string;
  family: "IPv4";
};

// --------------------------------------------------------------------------
// from src/gbheader.js
// --------------------------------------------------------------------------

/**
 * The 80-byte Game Boy cartridge header at 0x0100-0x014F.
 *
 * Only used to put a human-readable title and cartridge type in the library UI. The
 * verdict that decides whether a ROM may reach a lens is the SHA-1, never this header:
 * a hacked ROM keeps a perfectly valid header.
 */
type GbHeader = {
  title: string;
  cgbFlag: number;
  cartridgeType: number;
  cartridgeTypeName: string;
  romSizeCode: number;
  declaredRomBytes: number;
  ramSizeCode: number;
  headerChecksumOk: boolean;
};

// --------------------------------------------------------------------------
// from src/library.js
// --------------------------------------------------------------------------

export type RomRecord = {
  /** The SHA-1 is the identity: adding the same cartridge twice is a no-op. */
  id: string;
  sha1: string;
  crc32: string;
  filename: string;
  sizeBytes: number;
  addedAt: string;
  /** "red" | "blue" | "yellow" when the hash is canonical, else null. */
  game: string | null;
  label: string | null;
  /** Only a verified ROM is ever listed to, or sent to, a lens. */
  verified: boolean;
  /** Cartridge header title, e.g. "POKEMON RED". Informational only. */
  cartridgeTitle: string;
  cartridgeType: string;
};

export type AddRomResult = {
  record: RomRecord;
  /** False when this exact ROM was already in the library. */
  created: boolean;
};

// --------------------------------------------------------------------------
// from src/saves.js
// --------------------------------------------------------------------------

export type SaveRecord = {
  id: string;
  /** SHA-1 of the ROM this save belongs to, or null when the pusher did not say. */
  romId: string | null;
  filename: string;
  sizeBytes: number;
  sha1: string;
  crc32: string;
  createdAt: string;
  /** "lens" when the glasses pushed it up, "upload" when it came from the browser UI. */
  source: string;
  /** A Gen 1 SRAM image is exactly 32768 bytes; anything else is kept but flagged. */
  looksLikeGen1: boolean;
  note: string;
};

// --------------------------------------------------------------------------
// from src/ws/frame.js
// --------------------------------------------------------------------------

export type DecodedMessage = {
  kind: "message";
  opcode: number;
  data: Buffer;
};

export type DecodedControl = {
  kind: "control";
  opcode: number;
  data: Buffer;
};

export type DecodedFailure = {
  kind: "failure";
  code: number;
  reason: string;
};

export type DecodeEvent = DecodedMessage | DecodedControl | DecodedFailure;

// --------------------------------------------------------------------------
// from src/ws/server.js
// --------------------------------------------------------------------------

export type WsConnectionHandlers = {
  onText?: (text: string) => void;
  onBinary?: (data: Uint8Array) => void;
  onClose?: (code: number, reason: string) => void;
};

export type WsServerOptions = {
  port: number;
  host: string;
  /** Called for every accepted connection. */
  onConnection: (connection: WsConnection, request: IncomingMessage) => void;
};

export type WsServerHandle = {
  server: Server;
  connections: () => WsConnection[];
  close: () => Promise<void>;
};

// --------------------------------------------------------------------------
// the wire vocabulary (see PROTOCOL.md)
// --------------------------------------------------------------------------

export type ErrorCode =
  | "E_BAD_MESSAGE"
  | "E_UNSUPPORTED"
  | "E_NOT_PAIRED"
  | "E_BAD_CODE"
  | "E_RATE_LIMIT"
  | "E_UNKNOWN_ROM"
  | "E_ROM_UNVERIFIED"
  | "E_BUSY"
  | "E_UNKNOWN_TRANSFER"
  | "E_UNKNOWN_SAVE"
  | "E_UPLOAD_MISMATCH"
  | "E_TOO_LARGE"
  | "E_TIMEOUT"
  | "E_INTERNAL";

export type Encoding = "binary" | "base64";

/** Everything the client may send. */
type ClientMessage =
  | { type: "pair"; id?: string; code?: string; client?: ClientInfo }
  | { type: "ping"; id?: string }
  | { type: "rom.list"; id?: string }
  | {
      type: "rom.get";
      id?: string;
      romId: string;
      chunkBytes?: number;
      encoding?: Encoding;
      ackEvery?: number;
    }
  | { type: "rom.ack"; transferId: number; chunkIndex: number }
  | { type: "rom.cancel"; transferId: number }
  | { type: "save.list"; id?: string; romId?: string }
  | {
      type: "save.put";
      id?: string;
      romId?: string;
      sizeBytes: number;
      sha1: string;
      chunkBytes?: number;
      encoding?: Encoding;
      filename?: string;
      note?: string;
    }
  | { type: "save.chunk"; uploadId: number; chunkIndex: number; byteOffset: number; data: string }
  | { type: "save.commit"; id?: string; uploadId: number }
  | { type: "save.abort"; uploadId: number }
  | {
      type: "save.get";
      id?: string;
      saveId: string;
      chunkBytes?: number;
      encoding?: Encoding;
      ackEvery?: number;
    };

export type ClientInfo = {
  name?: string;
  version?: string;
  platform?: string;
};

/** A ROM as the lens sees it. Unverified ROMs are never included. */
type RomSummary = {
  romId: string;
  game: string | null;
  label: string | null;
  filename: string;
  sizeBytes: number;
  sha1: string;
  crc32: string;
  cartridgeTitle: string;
  addedAt: string;
};

export type SaveSummary = {
  saveId: string;
  romId: string | null;
  filename: string;
  sizeBytes: number;
  sha1: string;
  crc32: string;
  createdAt: string;
  source: string;
};

export type ServerCapabilities = {
  maxFrameBytes: number;
  chunkBytesDefault: number;
  chunkBytesMaxBinary: number;
  chunkBytesMaxBase64: number;
  encodings: Encoding[];
  chunkHeaderBytes: number;
};

/** Everything the server may send. */
type ServerMessage =
  | {
      type: "hello";
      protocolVersion: number;
      server: { name: string; version: string };
      sessionId: string;
      pairingRequired: boolean;
      capabilities: ServerCapabilities;
    }
  | { type: "paired"; id?: string; pairedAt: string }
  | { type: "pong"; id?: string; serverTime: number }
  | { type: "rom.list.ok"; id?: string; roms: RomSummary[] }
  | {
      type: "rom.begin";
      id?: string;
      transferId: number;
      romId: string;
      game: string | null;
      sha1: string;
      crc32: string;
      sizeBytes: number;
      chunkBytes: number;
      chunkCount: number;
      encoding: Encoding;
      ackEvery: number;
    }
  | {
      type: "rom.chunk";
      transferId: number;
      chunkIndex: number;
      chunkCount: number;
      byteOffset: number;
      byteLength: number;
      data: string;
    }
  | {
      type: "rom.end";
      transferId: number;
      romId: string;
      sha1: string;
      crc32: string;
      sizeBytes: number;
      chunkCount: number;
      elapsedMs: number;
    }
  | { type: "rom.cancelled"; transferId: number; reason: string }
  | { type: "save.ready"; id?: string; uploadId: number; chunkBytes: number; encoding: Encoding }
  | { type: "save.ok"; id?: string; saveId: string; sha1: string; sizeBytes: number; storedAt: string }
  | { type: "save.list.ok"; id?: string; saves: SaveSummary[] }
  | {
      type: "save.begin";
      id?: string;
      transferId: number;
      saveId: string;
      sha1: string;
      crc32: string;
      sizeBytes: number;
      chunkBytes: number;
      chunkCount: number;
      encoding: Encoding;
      ackEvery: number;
    }
  | {
      type: "save.chunk";
      transferId: number;
      chunkIndex: number;
      chunkCount: number;
      byteOffset: number;
      byteLength: number;
      data: string;
    }
  | {
      type: "save.end";
      transferId: number;
      saveId: string;
      sha1: string;
      crc32: string;
      sizeBytes: number;
      chunkCount: number;
      elapsedMs: number;
    }
  | { type: "event"; event: "library.changed"; roms: RomSummary[] }
  | { type: "error"; id?: string; code: ErrorCode; message: string };

// --------------------------------------------------------------------------
// from src/protocol/inbound.js
// --------------------------------------------------------------------------

export type ParseSuccess = { ok: true; message: ClientMessage };

export type ParseFailure = { ok: false; code: ErrorCode; reason: string; id?: string };

export type ParseResult = ParseSuccess | ParseFailure;

// --------------------------------------------------------------------------
// from src/protocol/binheader.js
// --------------------------------------------------------------------------

export type ChunkHeader = {
  version: number;
  kind: number;
  transferId: number;
  chunkIndex: number;
  chunkCount: number;
  byteOffset: number;
};

export type ParsedChunk = {
  header: ChunkHeader;
  payload: Uint8Array;
};

// --------------------------------------------------------------------------
// from src/protocol/download.js
// --------------------------------------------------------------------------

export type TransferSnapshot = {
  transferId: number;
  kind: string;
  direction: string;
  name: string;
  chunkIndex: number;
  chunkCount: number;
  transferredBytes: number;
  totalBytes: number;
  startedAt: number;
};

export type DownloadDeps = {
  connection: WsConnection;
  send: (message: ServerMessage) => Promise<void>;
  changed: () => void;
};

export type DownloadParams = {
  transferId: number;
  /** "rom" or "save": decides the JSON chunk type and the binary header kind. */
  kind: "rom" | "save";
  chunkKind: number;
  name: string;
  bytes: Uint8Array;
  chunkBytes: number;
  encoding: Encoding;
  /** 0 disables pacing; N pauses after every N chunks until the lens acks. */
  ackEvery: number;
};

export type DownloadResult = {
  completed: boolean;
  reason: string;
};

// --------------------------------------------------------------------------
// from src/protocol/upload.js
// --------------------------------------------------------------------------

export type UploadParams = {
  uploadId: number;
  romId: string | null;
  filename: string;
  note: string;
  encoding: Encoding;
  chunkBytes: number;
  sizeBytes: number;
  /** SHA-1 the lens promised. The upload is refused if the bytes disagree. */
  sha1: string;
};

export type CommitResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: ErrorCode; message: string };

// --------------------------------------------------------------------------
// from src/protocol/session.js
// --------------------------------------------------------------------------

export type ClientSnapshot = {
  id: string;
  remoteAddress: string;
  connectedAt: number;
  paired: boolean;
  clientName: string;
  clientPlatform: string;
  transfer: TransferSnapshot | null;
};

export type SessionContext = {
  library: RomLibrary;
  saves: SaveStore;
  pairing: PairingCode;
  /** One human readable line for the terminal and the browser activity feed. */
  activity: (line: string) => void;
  /** Something a watcher would want to re-render. */
  changed: () => void;
};

// --------------------------------------------------------------------------
// from src/http/static.js
// --------------------------------------------------------------------------

export type Asset = {
  file: string;
  contentType: string;
};

export type StaticFile = {
  body: Buffer;
  contentType: string;
};

// --------------------------------------------------------------------------
// from src/http/server.js
// --------------------------------------------------------------------------

export type HttpServerOptions = {
  hub: BridgeHub;
  port: number;
  host: string;
};

export type HttpServerHandle = {
  server: Server;
  close: () => Promise<void>;
};

// --------------------------------------------------------------------------
// from src/hub.js
// --------------------------------------------------------------------------

export type ActivityLine = {
  at: string;
  text: string;
};

export type BridgeState = {
  server: {
    name: string;
    protocolVersion: number;
    dataDir: string;
    httpUrl: string;
    wsPort: number;
    wsUrls: string[];
    lan: LanAddress[];
    pairingRequired: boolean;
    pairingCode: string;
    startedAt: string;
  };
  roms: RomRecord[];
  saves: SaveRecord[];
  clients: ClientSnapshot[];
  activity: ActivityLine[];
};

// --------------------------------------------------------------------------
// from src/cli.js
// --------------------------------------------------------------------------

export type CliOptions = {
  httpPort: number;
  httpHost: string;
  wsPort: number;
  wsHost: string;
  dataDir: string | null;
  code: string | null;
  pairing: boolean;
  add: string[];
  open: boolean;
  verbose: boolean;
};

export type BridgeHandle = {
  hub: BridgeHub;
  httpUrl: string;
  wsPort: number;
  stop: () => Promise<void>;
};

