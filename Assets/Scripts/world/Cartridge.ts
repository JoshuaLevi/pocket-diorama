// Which cartridge a bundle came from, by the SHA-1 the manifests are keyed on.
//
// Red and Blue share an engine and their scripts: one bundle plays like the
// other with different wild tables, trades and a title. Yellow is the same
// Kanto with a different opening (Oak catches a Pikachu, the rival takes an
// Eevee), Jessie and James in four places, and some NPCs renamed or moved.
// Everything that has to know the difference asks here, so the answer is
// given once and the rest of the code stays a Kanto reader.

/** SHA-1 of the one Red cartridge the manifests know. */
export const RED_ROM_SHA1: string = "ea9bcae617fdf159b045185467ae58b2e4a48b9a";
/** SHA-1 of the one Blue cartridge the manifests know. */
export const BLUE_ROM_SHA1: string = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
/** SHA-1 of the one Yellow cartridge the manifests know. */
export const YELLOW_ROM_SHA1: string = "cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1";

/** The script family a cartridge belongs to: Red and Blue are one, Yellow another. */
export type CartridgeVersion = "red" | "blue" | "yellow";

/**
 * The version behind a SHA-1. Anything unknown answers "red", which is also
 * what an empty bundle and every test that pins no cartridge get: Red is the
 * reference the scripts were ported from, so it is the safe reading.
 */
export function cartridgeVersion(romSha1: string): CartridgeVersion {
  const sha = romSha1 ? romSha1.toLowerCase() : "";
  if (sha === YELLOW_ROM_SHA1) {
    return "yellow";
  }
  if (sha === BLUE_ROM_SHA1) {
    return "blue";
  }
  return "red";
}

/** True for the one cartridge whose scripts branch away from Red's. */
export function isYellow(romSha1: string): boolean {
  return cartridgeVersion(romSha1) === "yellow";
}
