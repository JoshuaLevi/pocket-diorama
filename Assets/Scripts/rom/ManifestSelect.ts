import type { RomManifest } from "./types";

/**
 * Returns the candidate manifest for an exact ROM SHA-1, or null when the ROM
 * is unknown. The candidates are supplied by the caller because Lens runtime
 * code has no filesystem from which to discover manifests.
 */
export function selectManifest(
  romSha1: string,
  candidates: RomManifest[],
): RomManifest | null {
  if (!/^[0-9a-f]{40}$/i.test(romSha1)) {
    return null;
  }

  const wanted = romSha1.toLowerCase();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (
      candidate &&
      typeof candidate.romSha1 === "string" &&
      candidate.romSha1.toLowerCase() === wanted
    ) {
      return candidate;
    }
  }

  return null;
}
