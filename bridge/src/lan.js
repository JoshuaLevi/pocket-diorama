import { networkInterfaces } from "node:os";

/** @typedef {import("./types.js").LanAddress} LanAddress */
const VIRTUAL_PREFIXES = ["bridge", "utun", "vmnet", "docker", "veth", "awdl", "llw", "tun", "tap"];

/** @param {LanAddress} entry */
function rank(entry) {
  const name = entry.iface.toLowerCase();
  for (const prefix of VIRTUAL_PREFIXES) {
    if (name.startsWith(prefix))
      return 2;
  }
  // 169.254.x.x is a link-local self-assignment: reachable, but rarely what you want.
  if (entry.address.startsWith("169.254."))
    return 3;
  return 0;
}

/**
 * @param {LanAddress} a
 * @param {LanAddress} b
 */
function byLikelihood(a, b) {
  const diff = rank(a) - rank(b);
  if (diff !== 0)
    return diff;
  return a.iface.localeCompare(b.iface);
}

/**
 * Every non-internal IPv4 address the glasses could plausibly dial, most likely first:
 * a real Wi-Fi interface before a virtual bridge or a VPN tunnel. A lens client types
 * or scans an IPv4 literal, so IPv6 is deliberately not offered.
 *
 * @returns {LanAddress[]}
 */
export function lanAddresses() {
  /** @type {LanAddress[]} */
  const found = [];
  const table = networkInterfaces();
  for (const iface of Object.keys(table)) {
    const entries = table[iface];
    if (!entries)
      continue;
    for (const entry of entries) {
      if (entry.internal)
        continue;
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4")
        continue;
      found.push({ iface, address: entry.address, family: "IPv4" });
    }
  }
  return found.sort(byLikelihood);
}

/** Best guess at the address to print in the pairing card. */

export function primaryLanAddress() {
  const all = lanAddresses();
  return all.length > 0 ? all[0].address : null;
}
