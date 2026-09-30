// How the world gets into the lens.
//
// Two sources, one contract. The bridge pulls the bundle over the LAN the first
// time; persistent storage replays it every time after that. The point of the split
// is the property that makes this worth wearing: once the bake has happened, the
// glasses never need the laptop again.
//
// Persistent storage on Spectacles is 125 MB but has no byte-array type, so the
// bundle is stored as a string. All of Kanto is about 561 KB, which fits with room
// to spare.

/**
 * Reads a bundle baked on a desktop and imported as a JSON asset.
 *
 * It earns its keep twice over: it makes the lens playable with no bridge and no
 * network permission, and it gives LEAF scenarios a deterministic world with no
 * laptop in the loop.
 *
 * JsonAsset exists in Lens Studio 5.23 but NOT in 5.15.4, which is the version the
 * Spectacles (2024) device build ships from -- verified against 5.15's own
 * declarations, which have no JsonAsset and no text asset of any kind. Naming the
 * type here would make the file fail to compile on 5.15 outright, so the asset is
 * duck-typed and a missing getString simply means "no baked world", which is the
 * correct answer on 5.15. There the bundle arrives over the bridge once and lives
 * in persistent storage from then on; PersistentStorageSystem does exist in 5.15.
 */
export function loadBakedBundle(asset: Asset): string {
  if (!asset) {
    return null;
  }
  try {
    const json: any = asset;
    if (!json || typeof json.getString !== "function") {
      print("[WorldSource] asset carries no getString; not a JSON asset on this runtime");
      return null;
    }
    const text = json.getString();
    return text && text.length > 0 ? text : null;
  } catch (e) {
    print("[WorldSource] baked bundle unreadable: " + e);
    return null;
  }
}

export interface WorldSourceCallbacks {
  onProgress: (fraction: number, message: string) => void;
  onReady: (bundleText: string) => void;
  onError: (message: string) => void;
}

/**
 * What the lens holds while a world is on its way in, whichever way it comes.
 *
 * Both sources need a frame tick for the one failure a socket or a fetch
 * cannot report -- silence -- and both need closing when the wizard asks for
 * another go, or every retry leaves a transfer running behind it.
 */
export interface WorldTransfer {
  tick(dt: number): void;
  close(): void;
}

/** The https source can tell a missing code from a missing network. */
export interface HttpsWorldCallbacks extends WorldSourceCallbacks {
  /**
   * The server answered and has no world under that code: mistyped, or
   * older than a day. Optional; without it the case lands in onError.
   */
  onNotFound?: (message: string) => void;
}

const STORE_KEY_BUNDLE: string = "worldBundle";
const STORE_KEY_SHA: string = "worldBundleSha1";
const STORE_KEY_SAVE: string = "save";
const STORE_KEY_WIZARD: string = "wizardSeen";
const STORE_KEY_VIEW: string = "viewSettings";

/**
 * Whether the first-run wizard has already walked this wearer through placing
 * the diorama and finding the buttons.
 *
 * Only the PLACE and CONTROLS pages are gated on it. The LOADING page always
 * runs, because that is the one replacing the black screen -- a returning
 * wearer sees one flash of it and is in the title inside a second and a half.
 *
 * Guarded the same way loadCachedBundle is: persistent storage is a device API,
 * and a preview without one must fall back to "not seen" rather than throw
 * inside onStart, which is where this is read.
 */
export function loadWizardSeen(): boolean {
  try {
    return global.persistentStorageSystem.store.getBool(STORE_KEY_WIZARD) === true;
  } catch (e) {
    print("[WorldSource] wizard flag unreadable: " + e);
    return false;
  }
}

export function storeWizardSeen(): void {
  try {
    global.persistentStorageSystem.store.putBool(STORE_KEY_WIZARD, true);
  } catch (e) {
    print("[WorldSource] wizard flag not stored: " + e);
  }
}

/**
 * The view settings as they were left, or null when there are none.
 *
 * Returned RAW, as whatever JSON.parse produced. Every field is clamped by
 * sanitiseViewSettings against the current ladders, which is what makes this
 * safe to read back after a row has been added or removed -- and rows have
 * been added and removed three times this week. A stored file that names a
 * rung that no longer exists must not be able to put the cursor or the mesh
 * somewhere neither can come back from.
 *
 * Unreadable is treated as absent here, unlike the save: losing a TILT setting
 * costs one press, and refusing to write would freeze the wearer's settings on
 * a value they cannot change.
 */
export function loadViewSettings(): any {
  try {
    const text = global.persistentStorageSystem.store.getString(STORE_KEY_VIEW);
    if (!text || text.length === 0) {
      return null;
    }
    return JSON.parse(text);
  } catch (e) {
    print("[WorldSource] view settings unreadable: " + e);
    return null;
  }
}

/** Writes the view settings. Silent on a device with no store. */
export function storeViewSettings(settings: any): void {
  try {
    global.persistentStorageSystem.store.putString(
      STORE_KEY_VIEW, JSON.stringify(settings));
  } catch (e) {
    print("[WorldSource] view settings not stored: " + e);
  }
}

/** Reads a previously cached bundle. Returns null when there is nothing cached. */
export function loadCachedBundle(): string {
  try {
    const store = global.persistentStorageSystem.store;
    const text = store.getString(STORE_KEY_BUNDLE);
    return text && text.length > 0 ? text : null;
  } catch (e) {
    print("[WorldSource] cache read failed: " + e);
    return null;
  }
}

export function cachedBundleSha1(): string {
  try {
    return global.persistentStorageSystem.store.getString(STORE_KEY_SHA);
  } catch (e) {
    return "";
  }
}

export function storeBundle(text: string, sha1: string): boolean {
  try {
    const store = global.persistentStorageSystem.store;
    store.putString(STORE_KEY_BUNDLE, text);
    store.putString(STORE_KEY_SHA, sha1 ? sha1 : "");

    // Read it straight back. Persistent storage is 125 MB on Spectacles and the
    // bundle is under a megabyte, so this should always hold -- but "should" is
    // not a thing to discover on a headset, and a silently truncated write would
    // look exactly like a corrupt bundle on the next launch.
    const written = store.getString(STORE_KEY_BUNDLE);
    if (!written || written.length !== text.length) {
      print("[WorldSource] cache write did not round-trip: wrote " + text.length +
            " chars, read back " + (written ? written.length : 0));
      return false;
    }
    print("[WorldSource] cached " + text.length + " chars");
    return true;
  } catch (e) {
    print("[WorldSource] cache write failed: " + e);
    return false;
  }
}

/**
 * Forgets the stored world, and only the world: the save, the view settings
 * and the wizard's own flag keep their keys.
 *
 * The cache wins at every start, so without this a wearer who stored one
 * world could never reach the code page again -- not for a second cartridge
 * and not for a world re-baked after the site was fixed. The next start finds
 * no cache and asks for a code.
 *
 * Written as two empty strings rather than a removal: loadCachedBundle has
 * always read an empty string as "nothing cached", and a write is the one
 * operation both Lens Studio versions are already known to perform here.
 * Read back, like storeBundle, because "probably forgotten" is a world that
 * comes back tomorrow.
 */
export function forgetBundle(): boolean {
  try {
    const store = global.persistentStorageSystem.store;
    store.putString(STORE_KEY_BUNDLE, "");
    store.putString(STORE_KEY_SHA, "");
    const left = store.getString(STORE_KEY_BUNDLE);
    if (left && left.length > 0) {
      print("[WorldSource] the stored world would not go: " + left.length + " chars remain");
      return false;
    }
    print("[WorldSource] stored world forgotten");
    return true;
  } catch (e) {
    print("[WorldSource] forgetting the stored world failed: " + e);
    return false;
  }
}

export interface SaveState {
  mapId: string;
  cellX: number;
  cellY: number;
  facing: string;
  steps: number;
}

/**
 * Where the player was, kept between sessions.
 *
 * In-lens persistent storage is the source of truth, not the bridge: the whole
 * point is that the glasses play with no laptop present, and a save that lives on
 * the laptop would quietly undo that. The bridge is a backup and export target.
 *
 * A Gen 1 save is 32 KB against 125 MB of storage, so size is never the constraint
 * here -- this is a few dozen bytes.
 */
let loadFailed: boolean = false;

export function loadSave(): SaveState {
  try {
    const text = global.persistentStorageSystem.store.getString(STORE_KEY_SAVE);
    if (!text || text.length === 0) {
      return null;
    }
    const state = JSON.parse(text) as SaveState;
    if (!state || !state.mapId) {
      return null;
    }
    return state;
  } catch (e) {
    // Unreadable is NOT the same as absent, and the difference decides whether a
    // playthrough survives. A caller that treats both as "no save" starts a fresh
    // game and the autosave overwrites the damaged one within a few frames, so
    // whatever was recoverable is gone before the player can be told. saveLoadFailed
    // lets the loop refuse to write over it instead.
    print("[WorldSource] save unreadable, NOT overwriting it: " + e);
    loadFailed = true;
    return null;
  }
}

/**
 * True when the last loadSave() found something it could not parse.
 *
 * Absent and corrupt are different states. The loop must not autosave over the
 * second one.
 */
export function saveLoadFailed(): boolean {
  return loadFailed;
}

/** Cleared by an explicit new game, which is the one thing allowed to overwrite. */
export function clearSaveLoadFailure(): void {
  loadFailed = false;
}

/**
 * Writes the save, and reads it back before believing it.
 *
 * putString not throwing is not evidence that anything was stored. storeBundle
 * in this file has always known that -- "a silently truncated write would look
 * exactly like a corrupt bundle on the next launch" -- and this function did not,
 * which mattered less while a save was forty bytes of position. It is about to
 * hold a whole playthrough, and a half-written blob fails JSON.parse on the next
 * boot and routes straight into "starting fresh".
 */
export function storeSave(state: SaveState): boolean {
  try {
    const text = JSON.stringify(state);
    const store = global.persistentStorageSystem.store;
    store.putString(STORE_KEY_SAVE, text);
    const written = store.getString(STORE_KEY_SAVE);
    if (!written || written.length !== text.length) {
      print("[WorldSource] save did not round-trip: wrote " + text.length +
            " chars, read back " + (written ? written.length : 0));
      return false;
    }
    return true;
  } catch (e) {
    print("[WorldSource] save failed: " + e);
    return false;
  }
}

export function clearSave(): void {
  try {
    global.persistentStorageSystem.store.putString(STORE_KEY_SAVE, "");
  } catch (e) {
    print("[WorldSource] save clear failed: " + e);
  }
}

export function clearCachedBundle(): void {
  try {
    const store = global.persistentStorageSystem.store;
    store.putString(STORE_KEY_BUNDLE, "");
    store.putString(STORE_KEY_SHA, "");
  } catch (e) {
    print("[WorldSource] cache clear failed: " + e);
  }
}

/**
 * Pulls a bundle from the pairing bridge over a WebSocket.
 *
 * The bundle is JSON text, so it travels as text slices carrying an index and a
 * total rather than as base64 -- one less decode, and the outer frame's own JSON
 * escaping handles it. The index and total exist so the lens can show a real
 * progress bar rather than a spinner, which matters because this is the one moment
 * the user is waiting on a laptop.
 */
export class BridgeWorldSource implements WorldTransfer {
  private internetModule: InternetModule;
  private url: string;
  private bundleId: string;
  private socket: any = null;

  private chunks: string[] = [];
  private expectedChunks: number = 0;
  private receivedChunks: number = 0;
  /** Seconds since the last frame the bridge sent. See tick(). */
  private quietFor: number = 0;
  /** Kept so the stall watchdog can report a transfer nobody is going to finish. */
  private watching: WorldSourceCallbacks = null;
  /** Set once the transfer has ended, one way or the other. */
  private settled: boolean = false;
  /** Seconds since connect() with nothing at all having arrived. See tick(). */
  private silentFor: number = 0;

  constructor(internetModule: InternetModule, url: string, bundleId: string) {
    this.internetModule = internetModule;
    this.url = url;
    this.bundleId = bundleId;
  }

  /** The bridge and the lens share a Mac in preview, but not on device. */
  static defaultUrl(lanHost: string): string {
    const host = global.deviceInfoSystem.isEditor() ? "127.0.0.1" : lanHost;
    return "ws://" + host + ":8781";
  }

  /**
   * How long the bridge may say nothing, mid-transfer, before it has failed.
   *
   * The whole bundle crosses a LAN in under a second -- 103 chunks in 471 ms,
   * measured on 10 September -- so six seconds of silence is not slowness, it
   * is a transfer that is not coming.
   */
  static readonly STALL_SECONDS: number = 6;

  /**
   * How long the bridge has to answer AT ALL before it has failed.
   *
   * STALL_SECONDS above watches a transfer that has started and stops. This
   * watches the case it cannot see: one that never starts. The watchdog only
   * armed once a catalog had arrived and set expectedChunks, so a bridge that
   * was not running left nothing counting down at all.
   *
   * That is not hypothetical. On 10 September the devserver died between two
   * playtests, and the two runs that followed sat in the setup wizard for
   * forty-five and eighty-three seconds -- the placer re-placing the diorama
   * twice a second, no world, no title screen, no audio, and not one word on
   * the panel about why. The report was "de game liep weer vast". It had not.
   * It was waiting for a machine that was not there.
   *
   * Ten, against six. A bundle crosses the LAN in under a second and the
   * socket opens in three hundred milliseconds, so ten seconds is not a slow
   * network, it is an absent one -- and this deadline covers a laptop that has
   * gone to sleep as well as a server that was never started.
   */
  static readonly SILENT_SECONDS: number = 10;

  /**
   * One frame of the stall watchdog. Does nothing unless a transfer is running.
   *
   * This exists because of the one failure mode a socket cannot report. On
   * 10 September two frames reached the lens truncated, and a WebSocket whose
   * framing has come apart does not recover: every byte after it is read at
   * the wrong offset, so the rest of the bundle AND the bundleEnd that would
   * have completed it were simply gone. The socket stayed open and healthy.
   * Nothing failed. The wearer sat on "Receiving world 92%" with the diorama
   * placer still ticking away underneath, which is what "de lens leek vast te
   * lopen" was.
   *
   * Every other waiting state in this lens has a deadline now -- SCAN_LINKED
   * got one the same day, for the same reason. This is the bridge's.
   */
  tick(dt: number): void {
    if (this.settled || !this.watching) {
      return;
    }
    // Nothing has arrived yet: a different failure and a different deadline.
    // See SILENT_SECONDS. This covers both a socket that never opens and one
    // that opens onto a server with nothing to say.
    if (this.expectedChunks <= 0) {
      this.silentFor = this.silentFor + dt;
      if (this.silentFor < BridgeWorldSource.SILENT_SECONDS) {
        return;
      }
      const waiting = this.watching;
      this.settled = true;
      this.watching = null;
      this.close();
      waiting.onError("no answer from the bridge at " + this.url +
                      " after " + BridgeWorldSource.SILENT_SECONDS +
                      "s -- is it running?");
      return;
    }
    this.quietFor = this.quietFor + dt;
    if (this.quietFor < BridgeWorldSource.STALL_SECONDS) {
      return;
    }
    const callbacks = this.watching;
    this.settled = true;
    this.watching = null;
    this.close();
    callbacks.onError("the bridge went quiet at " + this.receivedChunks + "/" +
                      this.expectedChunks + " chunks");
  }

  connect(callbacks: WorldSourceCallbacks): void {
    this.watching = callbacks;
    this.settled = false;
    this.quietFor = 0;
    this.silentFor = 0;
    let socket: any = null;
    try {
      socket = this.internetModule.createWebSocket(this.url);
    } catch (e) {
      callbacks.onError("cannot open " + this.url + ": " + e);
      return;
    }
    this.socket = socket;
    socket.binaryType = "blob";

    socket.onopen = () => {
      callbacks.onProgress(0, "Connected to bridge");
      socket.send(JSON.stringify({ type: "hello", client: "lens" }));
    };

    socket.onmessage = async (event: any) => {
      let text: string = null;
      try {
        text = typeof event.data === "string" ? event.data : await event.data.text();
      } catch (e) {
        callbacks.onError("unreadable frame: " + e);
        return;
      }
      this.handleMessage(text, callbacks);
    };

    socket.onerror = (event: any) => {
      callbacks.onError("bridge socket error");
    };

    socket.onclose = (event: any) => {
      if (this.receivedChunks < this.expectedChunks) {
        callbacks.onError("bridge closed mid-transfer");
      }
    };
  }

  private handleMessage(text: string, callbacks: WorldSourceCallbacks): void {
    // Any frame at all is proof the bridge is still there, including one that
    // does not parse: a truncated frame means the transfer is in trouble, not
    // that the socket has gone. The watchdog is about SILENCE.
    this.quietFor = 0;
    let message: any = null;
    try {
      message = JSON.parse(text);
    } catch (e) {
      // Say how big it was and how it started. A frame that fails to parse is
      // almost always one that arrived truncated, and the length is what tells
      // that apart from a server sending nonsense -- which is the difference
      // between "make the chunks smaller" and "fix the server".
      callbacks.onError("bad frame from bridge: " + text.length + " chars starting " +
                        text.substring(0, 24));
      return;
    }

    if (message.type === "catalog") {
      callbacks.onProgress(0.02, "Requesting world");
      this.socket.send(JSON.stringify({ type: "getBundle", id: this.bundleId }));
      return;
    }

    if (message.type === "bundleStart") {
      this.expectedChunks = message.chunks;
      this.receivedChunks = 0;
      this.chunks = [];
      for (let i = 0; i < this.expectedChunks; i++) {
        this.chunks.push("");
      }
      callbacks.onProgress(0.05, "Receiving world");
      return;
    }

    if (message.type === "chunk") {
      if (message.index >= 0 && message.index < this.chunks.length) {
        this.chunks[message.index] = message.data;
        this.receivedChunks++;
        const fraction = 0.05 + 0.9 * (this.receivedChunks / this.expectedChunks);
        callbacks.onProgress(fraction, "Receiving world");
      }
      return;
    }

    if (message.type === "bundleEnd") {
      if (this.receivedChunks !== this.expectedChunks) {
        callbacks.onError(
          "incomplete transfer: " + this.receivedChunks + "/" + this.expectedChunks
        );
        return;
      }
      this.settled = true;
      this.watching = null;
      callbacks.onProgress(0.97, "Unpacking world");
      const joined = this.chunks.join("");
      callbacks.onReady(joined);
      return;
    }

    if (message.type === "error") {
      callbacks.onError("bridge: " + message.message);
    }
  }

  close(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // Already gone; nothing to do.
      }
      this.socket = null;
    }
  }
}

/**
 * Pulls a baked bundle from the world site over https, by code.
 *
 * This is the published lens's only way in. A published Spectacles lens may
 * open `https://` and `wss://` and nothing else, so the LAN bridge above is a
 * development path, and what a player does instead is open the site on their
 * own computer, drop their cartridge on it, and type the six-character code
 * it shows them into the lens. The site serves the bundle back under that
 * code for a day; after the first fetch the bundle lives in persistent
 * storage and the site is never asked again.
 *
 * fetch() gives no progress events and cannot be cancelled, so the bar the
 * wizard draws moves in three steps -- asked, answered, unpacked -- and a
 * close() only makes a late answer land in nothing. The 5.15 runtime the
 * glasses run declares InternetModule.fetch beside createWebSocket, and the
 * URL is passed as a string rather than a Request so nothing here needs a
 * class 5.15 may not have.
 */
export class HttpsWorldSource implements WorldTransfer {
  private internetModule: InternetModule;
  private url: string;
  private watching: HttpsWorldCallbacks = null;
  private settled: boolean = false;
  private waited: number = 0;

  /**
   * How long the site has to answer in full before it has failed.
   *
   * A 1.7 MB bundle crosses a home connection in a second or two; forty-five
   * seconds is not slow, it is a request that is not coming back -- a lens
   * with no Wi-Fi, or a site that is down. The wizard auto-retries after it.
   */
  static readonly TIMEOUT_SECONDS: number = 45;

  constructor(internetModule: InternetModule, url: string) {
    this.internetModule = internetModule;
    this.url = url;
  }

  /** `site` with or without a trailing slash; the code goes in the path. */
  static bundleUrl(site: string, code: string): string {
    let base = site ? site : "";
    while (base.length > 0 && base.charAt(base.length - 1) === "/") {
      base = base.substring(0, base.length - 1);
    }
    return base + "/api/bundle/" + encodeURIComponent(code ? code : "");
  }

  /** The host, for a page to name: "https://a.b/c" becomes "a.b". */
  static hostOf(site: string): string {
    let text = site ? site : "";
    const scheme = text.indexOf("://");
    if (scheme >= 0) {
      text = text.substring(scheme + 3);
    }
    const slash = text.indexOf("/");
    return slash >= 0 ? text.substring(0, slash) : text;
  }

  tick(dt: number): void {
    if (this.settled || !this.watching) {
      return;
    }
    this.waited = this.waited + dt;
    if (this.waited < HttpsWorldSource.TIMEOUT_SECONDS) {
      return;
    }
    const waiting = this.watching;
    this.settle();
    waiting.onError("no answer from " + HttpsWorldSource.hostOf(this.url) + " after " +
                    HttpsWorldSource.TIMEOUT_SECONDS + "s -- are the glasses on Wi-Fi?");
  }

  connect(callbacks: HttpsWorldCallbacks): void {
    this.watching = callbacks;
    this.settled = false;
    this.waited = 0;
    callbacks.onProgress(0.05, "Asking for the world");
    let pending: any = null;
    try {
      pending = this.internetModule.fetch(this.url as any, {
        method: "GET",
        headers: { "Accept": "application/json" },
      } as any);
    } catch (e) {
      this.settle();
      callbacks.onError("cannot ask " + HttpsWorldSource.hostOf(this.url) + ": " + e);
      return;
    }
    if (!pending || typeof pending.then !== "function") {
      this.settle();
      callbacks.onError("fetch gave no promise back");
      return;
    }
    pending.then((response: any) => this.answered(response, callbacks))
      .catch((e: any) => {
        if (this.watching !== callbacks || this.settled) {
          return;
        }
        this.settle();
        callbacks.onError("could not reach " + HttpsWorldSource.hostOf(this.url) + ": " + e);
      });
  }

  private answered(response: any, callbacks: HttpsWorldCallbacks): void {
    if (this.watching !== callbacks || this.settled) {
      return;
    }
    const status = response ? response.status : 0;
    if (status === 404 || status === 410) {
      this.settle();
      const gone = "no world under this code -- it may have expired";
      if (callbacks.onNotFound) {
        callbacks.onNotFound(gone);
      } else {
        callbacks.onError(gone);
      }
      return;
    }
    if (status !== 200) {
      this.settle();
      callbacks.onError("the site answered " + status);
      return;
    }
    callbacks.onProgress(0.5, "Receiving world");
    // The declared length, when the server sends one, is the only truncation
    // check a text() can have: a body cut short by a dropped connection is
    // still a string, and JSON.parse would report it as a corrupt bundle.
    let declared = -1;
    try {
      const headers: any = response.headers;
      const value = headers && typeof headers.get === "function" ? headers.get("x-bundle-length") : null;
      if (value !== null && value !== undefined && ("" + value).length > 0) {
        declared = parseInt("" + value, 10);
      }
    } catch (e) {
      declared = -1;
    }
    let body: any = null;
    try {
      body = response.text();
    } catch (e) {
      this.settle();
      callbacks.onError("the answer could not be read: " + e);
      return;
    }
    if (!body || typeof body.then !== "function") {
      this.settle();
      callbacks.onError("the answer had no body");
      return;
    }
    body.then((text: string) => {
      if (this.watching !== callbacks || this.settled) {
        return;
      }
      this.settle();
      if (!text || text.length === 0) {
        callbacks.onError("the site sent an empty world");
        return;
      }
      if (declared >= 0 && declared !== text.length) {
        callbacks.onError("the world arrived cut short: " + text.length + " of " +
                          declared + " chars");
        return;
      }
      callbacks.onProgress(0.97, "Unpacking world");
      callbacks.onReady(text);
    }).catch((e: any) => {
      if (this.watching !== callbacks || this.settled) {
        return;
      }
      this.settle();
      callbacks.onError("the world did not arrive whole: " + e);
    });
  }

  private settle(): void {
    this.settled = true;
    this.watching = null;
  }

  /** Nothing to abort: a fetch runs to its end. Its answer lands in nothing. */
  close(): void {
    this.settle();
  }
}
