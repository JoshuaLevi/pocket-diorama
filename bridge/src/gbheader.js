const CARTRIDGE_TYPES = [
  { code: 0x00, name: "ROM ONLY" },
  { code: 0x01, name: "MBC1" },
  { code: 0x02, name: "MBC1+RAM" },
  { code: 0x03, name: "MBC1+RAM+BATTERY" },
  { code: 0x05, name: "MBC2" },
  { code: 0x06, name: "MBC2+BATTERY" },
  { code: 0x0f, name: "MBC3+TIMER+BATTERY" },
  { code: 0x10, name: "MBC3+TIMER+RAM+BATTERY" },
  { code: 0x11, name: "MBC3" },
  { code: 0x12, name: "MBC3+RAM" },
  { code: 0x13, name: "MBC3+RAM+BATTERY" },
  { code: 0x19, name: "MBC5" },
  { code: 0x1b, name: "MBC5+RAM+BATTERY" },
];

function cartridgeTypeName(code) {
  for (const entry of CARTRIDGE_TYPES) {
    if (entry.code === code)
      return entry.name;
  }
  return "UNKNOWN 0x" + code.toString(16).padStart(2, "0");
}

/** Reads the header, or null when the buffer is too short to hold one. */

export function readGbHeader(bytes) {
  if (bytes.length < 0x0150)
    return null;
  let title = "";
  for (let i = 0x0134; i <= 0x0143; i += 1) {
    const code = bytes[i];
    if (code === 0x00)
      break;
    // Printable ASCII only; a CGB title field reuses the tail for manufacturer bytes.
    if (code < 0x20 || code > 0x7e)
      break;
    title += String.fromCharCode(code);
  }
  const romSizeCode = bytes[0x0148];
  const declaredRomBytes = romSizeCode <= 0x08 ? 32768 << romSizeCode : 0;
  let checksum = 0;
  for (let i = 0x0134; i <= 0x014c; i += 1) {
    checksum = (checksum - bytes[i] - 1) & 0xff;
  }
  const cartridgeType = bytes[0x0147];
  return {
    title: title.trim(),
    cgbFlag: bytes[0x0143],
    cartridgeType,
    cartridgeTypeName: cartridgeTypeName(cartridgeType),
    romSizeCode,
    declaredRomBytes,
    ramSizeCode: bytes[0x0149],
    headerChecksumOk: checksum === bytes[0x014d],
  };
}
