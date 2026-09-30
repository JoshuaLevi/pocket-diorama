/**
 * Every tunable constant of the bridge lives here.
 *
 * The bridge is a PROVISIONING tool: it exists for the one session in which a lens
 * pulls a ROM off this machine. Nothing here may become a runtime dependency of the
 * lens, so keep the surface small and the defaults conservative.
 */
/** Bumped when a wire change breaks an older lens client. See PROTOCOL.md. */

export const PROTOCOL_VERSION = 1;

/** Browser UI. Loopback-only by default; see README "Threat model". */

export const DEFAULT_HTTP_PORT = 8780;

export const DEFAULT_HTTP_HOST = "127.0.0.1";

/** Fixed by the protocol so a lens client can hardcode it. */

export const WS_PORT = 8781;

export const DEFAULT_WS_HOST = "0.0.0.0";

/** A Game Boy cartridge image that is not exactly this size is never a Gen 1 ROM. */

export const GEN1_ROM_BYTES = 1048576;

/** Gen 1 SRAM image. Anything else is accepted but flagged. */

export const GEN1_SAVE_BYTES = 32768;

/** Upload guards for the local HTTP API. */

export const MAX_ROM_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_SAVE_UPLOAD_BYTES = 256 * 1024;

/** Any single inbound WebSocket message larger than this kills the connection. */

export const WS_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * Chunking. A WebSocket frame must never exceed 64 KiB so a constrained client can
 * size a receive buffer once and forget about it.
 *
 *   binary : 20-byte chunk header + payload <= 65536
 *   base64 : payload -> ceil(n/3)*4 characters + ~140 bytes of JSON envelope
 */
export const CHUNK_BYTES_DEFAULT = 32768;

export const CHUNK_BYTES_MIN = 4096;

export const CHUNK_BYTES_MAX_BINARY = 65516;

export const CHUNK_BYTES_MAX_BASE64 = 47000;

/** Frame budget a lens client can rely on: no frame the bridge sends exceeds this. */

export const MAX_FRAME_BYTES = 65536;

/** How long the bridge waits for a rom.ack before it gives up on a paced transfer. */

export const ACK_TIMEOUT_MS = 30000;

/** Failed pairing attempts allowed on one connection before it is closed. */

export const MAX_PAIRING_ATTEMPTS = 3;

/** A connection that has not paired within this window is dropped. */

export const PAIRING_GRACE_MS = 60000;

/** Heartbeat interval for server-initiated WebSocket pings. */

export const PING_INTERVAL_MS = 20000;

/**
 * The only cartridge images the bridge will hand to a lens.
 *
 * A ROM whose SHA-1 is not in this table is stored and shown in the library with a red
 * verdict so the user can see WHY it is unusable, but it is never listed to, nor sent
 * to, a lens: decoding an unknown revision with Gen 1 symbol addresses produces garbage,
 * and garbage that looks like data is worse than a refusal.
 */
export const CANONICAL_ROMS = [
  {
    game: "red",
    label: "Pokemon Red (USA, Europe)",
    sha1: "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
    sizeBytes: GEN1_ROM_BYTES,
  },
  {
    game: "blue",
    label: "Pokemon Blue (USA, Europe)",
    sha1: "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2",
    sizeBytes: GEN1_ROM_BYTES,
  },
  {
    game: "yellow",
    label: "Pokemon Yellow (USA, Europe)",
    sha1: "cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1",
    sizeBytes: GEN1_ROM_BYTES,
  },
];

/** Returns the canonical entry for a SHA-1, or null when the ROM is not one of ours. */

export function canonicalRomFor(sha1) {
  const wanted = sha1.toLowerCase();
  for (const entry of CANONICAL_ROMS) {
    if (entry.sha1 === wanted)
      return entry;
  }
  return null;
}
