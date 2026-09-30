import { RomLibrary } from "./library.js";
import { SaveStore } from "./saves.js";
import { PairingCode } from "./pairing.js";
import { LensSession } from "./protocol/session.js";
import { lanAddresses } from "./lan.js";
import { log } from "./log.js";
import { PROTOCOL_VERSION, WS_PORT } from "./config.js";

/** @typedef {import("./types.js").ActivityLine} ActivityLine */
/** @typedef {import("./types.js").BridgeState} BridgeState */
const ACTIVITY_LIMIT = 60;

const BROADCAST_THROTTLE_MS = 100;

/**
 * The single place that knows everything: the library on disk, the saves, the pairing
 * code, and every lens currently attached.
 *
 * Both faces of the bridge read from here, and neither reaches past it. The browser UI
 * polls one state object; the WebSocket sessions get their dependencies as a context.
 * A change from either side lands in the same place and fans out to both.
 */
export class BridgeHub {
  library;
  saves;
  pairing;
  dataDir;
  startedAt = new Date().toISOString();
  /** @type {LensSession[]} */
  #sessions = [];
  /** @type {ActivityLine[]} */
  #activity = [];
  /** @type {((state: BridgeState) => void)[]} */
  #listeners = [];
  /** @type {NodeJS.Timeout | null} */
  #broadcastTimer = null;
  #httpUrl = "";
  #wsPort = WS_PORT;
  #verbose;
  constructor(layout, pairing, verbose) {
    this.library = new RomLibrary(layout);
    this.saves = new SaveStore(layout);
    this.pairing = pairing;
    this.dataDir = layout.root;
    this.#verbose = verbose;
  }
  /** Told by the CLI once both listeners are actually bound. */
  setEndpoints(httpUrl, wsPort) {
    this.#httpUrl = httpUrl;
    this.#wsPort = wsPort;
  }
  /** Appends one line to the activity feed shown in the terminal and the browser. */
  activity = (text) => {
    const line = { at: new Date().toISOString(), text };
    this.#activity = this.#activity.concat([line]).slice(-ACTIVITY_LIMIT);
    log.info(text);
    this.changed();
  };
  /** Debug detail that should not clutter the activity feed. */
  trace(text) {
    if (this.#verbose)
      log.info(text);
  }
  /** Coalesced notification: a burst of chunk updates becomes one render. */
  changed = () => {
    if (this.#broadcastTimer !== null)
      return;
    this.#broadcastTimer = setTimeout(() => {
      this.#broadcastTimer = null;
      const state = this.state();
      for (const listener of this.#listeners) {
        try {
          listener(state);
        }
        catch {
          // A dead SSE stream must never take the bridge down with it.
        }
      }
    }, BROADCAST_THROTTLE_MS);
    if (typeof this.#broadcastTimer.unref === "function")
      this.#broadcastTimer.unref();
  };
  subscribe(listener) {
    this.#listeners = this.#listeners.concat([listener]);
    return () => {
      this.#listeners = this.#listeners.filter((entry) => entry !== listener);
    };
  }
  attach(connection) {
    const session = new LensSession(connection, {
      library: this.library,
      saves: this.saves,
      pairing: this.pairing,
      activity: this.activity,
      changed: this.changed,
    });
    this.#sessions = this.#sessions.concat([session]);
    connection.addCloseListener(() => {
      this.#sessions = this.#sessions.filter((entry) => entry !== session);
      this.activity("lens disconnected (" + connection.remoteAddress + ")");
    });
    this.activity("lens connected from " + connection.remoteAddress);
    return session;
  }
  /** Tells every paired lens that the ROM list moved under its feet. */
  notifyLibraryChanged() {
    for (const session of this.#sessions)
      session.notifyLibraryChanged();
    this.changed();
  }
  hasLens() {
    return this.#sessions.length > 0;
  }
  state() {
    const addresses = lanAddresses();
    return {
      server: {
        name: "pokemon-ar-bridge",
        protocolVersion: PROTOCOL_VERSION,
        dataDir: this.dataDir,
        httpUrl: this.#httpUrl,
        wsPort: this.#wsPort,
        wsUrls: addresses.map((entry) => "ws://" + entry.address + ":" + String(this.#wsPort)),
        lan: addresses,
        pairingRequired: this.pairing.required,
        pairingCode: this.pairing.value,
        startedAt: this.startedAt,
      },
      roms: this.library.list(),
      saves: this.saves.list(),
      clients: this.#sessions.map((session) => session.snapshot()),
      activity: this.#activity.slice().reverse(),
    };
  }
}
