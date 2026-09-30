// Drives the REAL lens client against the REAL bridge.
//
// The two were written in parallel against one brief and diverged; this is the
// proof they now agree. It runs Assets/Scripts/world/RomBridge.ts unmodified, with
// only the two runtime objects the lens provides stubbed: an InternetModule that
// hands back a WebSocket, and Blob.bytes(), which Node spells differently.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const romPath = process.argv[2];
if (!romPath) {
  console.error("usage: rombridge.test.mjs <rom.gb>");
  process.exit(2);
}

globalThis.print = (...a) => console.log("  [lens]", ...a);
globalThis.global = { deviceInfoSystem: { isEditor: () => true } };

const { RomBridge } = await import("../Assets/Scripts/world/RomBridge.ts");

const PORT = 8791;
const CODE = "246810";
const bridge = spawn("node", [
  resolve(repo, "bridge/bin/pokemon-ar-bridge.mjs"),
  "--ws-port", String(PORT), "--port", "8790",
  "--code", CODE, "--add", romPath,
], { stdio: ["ignore", "pipe", "pipe"] });

let bridgeOut = "";
bridge.stdout.on("data", (d) => { bridgeOut += d; });
bridge.stderr.on("data", (d) => { bridgeOut += d; });

const stop = () => { try { bridge.kill(); } catch {} };
process.on("exit", stop);

// Give the bridge a moment to bind and hash the ROM.
await new Promise((r) => setTimeout(r, 2500));

// The lens's InternetModule, as far as RomBridge is concerned.
const internetModule = {
  createWebSocket(url) {
    const ws = new WebSocket(url);
    ws.binaryType = "blob";
    return ws;
  },
};

const expected = createHash("sha1").update((await import("node:fs")).readFileSync(romPath)).digest("hex");

const result = await new Promise((resolve_, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out after 30 s")), 30000);
  const client = new RomBridge(internetModule, `ws://127.0.0.1:${PORT}`, CODE, "");
  let lastPct = -1;
  client.connect({
    onProgress: (f, m) => {
      const pct = Math.round(f * 100);
      if (pct >= lastPct + 20) { lastPct = pct; console.log(`  ${pct}%  ${m}`); }
    },
    onRom: (bytes, sha1, game) => {
      clearTimeout(timer); client.close(); resolve_({ bytes, sha1, game });
    },
    onError: (m) => { clearTimeout(timer); client.close(); reject(new Error(m)); },
  });
});

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (!ok) failures++;
}

console.log("");
check("the ROM arrives whole", result.bytes.length === 1048576, `${result.bytes.length} bytes`);
check("its SHA-1 matches the file on disk", result.sha1 === expected, result.sha1);
check("the bridge names the game", result.game === "red", result.game);
check("the lens computed the hash itself",
      createHash("sha1").update(result.bytes).digest("hex") === expected);

console.log("\n" + (failures === 0 ? "ROM BRIDGE OK" : "ROM BRIDGE FAILED"));
stop();
process.exit(failures === 0 ? 0 : 1);
