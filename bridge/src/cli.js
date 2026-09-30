import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, DEFAULT_WS_HOST, WS_PORT } from "./config.js";
import { BridgeHub } from "./hub.js";
import { startHttpServer } from "./http/server.js";
import { color, formatBytes, log } from "./log.js";
import { PairingCode } from "./pairing.js";
import { ensureDataLayout, resolveDataDir } from "./paths.js";
import { startWsServer } from "./ws/server.js";
const VERSION = "1.0.0";

const USAGE = [
  "pokemon-ar-bridge " + VERSION,
  "",
  "Hands your own Game Boy ROM to the Pokemon-AR lens once, over the LAN.",
  "After that first bake the lens is standalone: this tool is provisioning, not runtime.",
  "",
  "Usage:  npx pokemon-ar-bridge [options]",
  "",
  "Options:",
  "  --port <n>        port for the browser UI            (default " + DEFAULT_HTTP_PORT + ")",
  "  --host <addr>     bind address for the browser UI    (default " + DEFAULT_HTTP_HOST + ")",
  "  --ws-port <n>     port for the lens WebSocket        (default " + WS_PORT + ")",
  "  --ws-host <addr>  bind address for the WebSocket     (default " + DEFAULT_WS_HOST + ")",
  "  --data-dir <path> where ROMs and saves are kept      (default: OS user data dir)",
  "  --code <digits>   use a fixed pairing code instead of a random one",
  "  --no-pairing      accept any lens without a code     (development only)",
  "  --add <file.gb>   add a ROM to the library on startup",
  "  --open            open the browser UI on start",
  "  --verbose         log every protocol step",
  "  --version         print the version and exit",
  "  --help            print this help and exit",
  "",
  "ROMs and saves are stored in the OS user data directory, never in this repository.",
  "Only the three canonical Gen 1 cartridge hashes are ever served to a lens.",
].join("\n");

export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: "string" },
        host: { type: "string" },
        "ws-port": { type: "string" },
        "ws-host": { type: "string" },
        "data-dir": { type: "string" },
        code: { type: "string" },
        "no-pairing": { type: "boolean" },
        add: { type: "string", multiple: true },
        open: { type: "boolean" },
        verbose: { type: "boolean" },
        version: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    });
  }
  catch (error) {
    return { help: String(error instanceof Error ? error.message : error) + "\n\n" + USAGE };
  }
  const values = parsed.values;
  if (values.help === true)
    return { help: USAGE };
  if (values.version === true)
    return { help: VERSION };
  const toPort = (value, fallback) => {
    if (value === undefined)
      return fallback;
    const port = Number.parseInt(value, 10);
    return Number.isFinite(port) && port > 0 && port < 65536 ? port : fallback;
  };
  return {
    options: {
      httpPort: toPort(values.port, DEFAULT_HTTP_PORT),
      httpHost: values.host ?? DEFAULT_HTTP_HOST,
      wsPort: toPort(values["ws-port"], WS_PORT),
      wsHost: values["ws-host"] ?? DEFAULT_WS_HOST,
      dataDir: values["data-dir"] ?? null,
      code: values.code ?? null,
      pairing: values["no-pairing"] !== true,
      add: values.add ?? [],
      open: values.open === true,
      verbose: values.verbose === true,
    },
  };
}

/** Boots both servers. Exported so tests can drive a bridge in process. */

export async function startBridge(options) {
  const dataDir = resolveDataDir(options.dataDir);
  const layout = ensureDataLayout(dataDir);
  const pairing = new PairingCode(options.pairing, options.code);
  const hub = new BridgeHub(layout, pairing, options.verbose);
  for (const path of options.add) {
    const full = resolve(path);
    const buffer = readFileSync(full);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result = hub.library.add(basename(full), bytes);
    log.info((result.created ? "added " : "already had ") +
      basename(full) +
      " -> " +
      (result.record.verified ? color.green(String(result.record.game)) : color.red("not a known cartridge")));
  }
  const ws = await startWsServer({
    port: options.wsPort,
    host: options.wsHost,
    onConnection: (connection) => {
      hub.attach(connection);
    },
  });
  const http = await startHttpServer({ hub, port: options.httpPort, host: options.httpHost });
  const httpUrl = "http://" + (options.httpHost === "0.0.0.0" ? "127.0.0.1" : options.httpHost) + ":" + String(options.httpPort);
  hub.setEndpoints(httpUrl, options.wsPort);
  return {
    hub,
    httpUrl,
    wsPort: options.wsPort,
    stop: async () => {
      await ws.close();
      await http.close();
    },
  };
}

function printBanner(handle, options) {
  const state = handle.hub.state();
  const rule = color.dim("-".repeat(64));
  log.plain("");
  log.plain(color.bold("  pokemon-ar-bridge " + VERSION));
  log.plain(rule);
  log.plain("  browser UI    " + color.cyan(handle.httpUrl));
  if (state.server.wsUrls.length === 0) {
    log.plain("  lens endpoint " + color.red("no LAN address found; is this machine on wifi?"));
  }
  else {
    for (let i = 0; i < state.server.wsUrls.length; i += 1) {
      const label = i === 0 ? "  lens endpoint" : "               ";
      log.plain(label + " " + color.cyan(state.server.wsUrls[i]) + color.dim("  (" + state.server.lan[i].iface + ")"));
    }
  }
  log.plain("  pairing code  " +
    (options.pairing ? color.bold(state.server.pairingCode) : color.yellow("disabled (--no-pairing)")));
  log.plain("  data dir      " + color.dim(state.server.dataDir));
  const verified = state.roms.filter((rom) => rom.verified);
  if (state.roms.length === 0) {
    log.plain("  library       " + color.yellow("empty; drop a .gb file on the browser UI"));
  }
  else {
    log.plain("  library       " +
      String(verified.length) +
      " playable, " +
      String(state.roms.length - verified.length) +
      " rejected, " +
      String(state.saves.length) +
      " saves");
    for (const rom of verified) {
      log.plain(color.dim("                " + (rom.label ?? rom.filename) + "  " + formatBytes(rom.sizeBytes) + "  " + rom.sha1));
    }
  }
  log.plain(rule);
  log.plain(color.dim("  waiting for a lens. ctrl-c to stop."));
  log.plain("");
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    child.unref();
  }
  catch {
    log.warn("could not open a browser; visit " + url + " yourself");
  }
}

export async function main(argv) {
  const parsed = parseCliArgs(argv);
  if ("help" in parsed) {
    log.plain(parsed.help);
    return 0;
  }
  let handle;
  try {
    handle = await startBridge(parsed.options);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.indexOf("EADDRINUSE") >= 0) {
      log.error("a port is already in use. Another bridge may be running: " + message);
      return 2;
    }
    log.error(message);
    return 1;
  }
  printBanner(handle, parsed.options);
  if (parsed.options.open)
    openBrowser(handle.httpUrl);
  let stopping = false;
  const shutdown = () => {
    if (stopping)
      return;
    stopping = true;
    log.plain("");
    log.info("shutting down");
    void handle.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return await new Promise(() => {
    // Runs until a signal arrives.
  });
}
