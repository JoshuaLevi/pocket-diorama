// The lens computes these before it decodes anything, so they have to be right.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
globalThis.print = () => {};
const { crc32, sha1Hex } = await import("../Assets/Scripts/world/Checksum.ts");

const rom = new Uint8Array(readFileSync(process.argv[2]));
const ours = sha1Hex(rom);
const theirs = createHash("sha1").update(rom).digest("hex");
console.log("  sha1 ours  ", ours);
console.log("  sha1 node  ", theirs);
console.log("  crc32 ours ", crc32(rom));
const empty = sha1Hex(new Uint8Array(0));
console.log("  sha1 empty ", empty, empty === "da39a3ee5e6b4b0d3255bfef95601890afd80709" ? "OK" : "WRONG");
const ok = ours === theirs && empty === "da39a3ee5e6b4b0d3255bfef95601890afd80709";
console.log(ok ? "\nCHECKSUM OK" : "\nCHECKSUM FAILED");
process.exit(ok ? 0 : 1);
