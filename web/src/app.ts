// The page: drop a cartridge, get a code.
//
// Everything that touches the cartridge happens here or in the worker, in the
// visitor's browser. What leaves the machine is the baked world -- the lens's
// own bundle, derived data -- and it goes to a private store for a day under
// the code this page shows. See ../README.md for why it is built this way.

import { sha1 } from "../../Assets/Scripts/rom/core/sha1";

/**
 * The cartridges this page bakes, by SHA-1, each with the symbol manifest that
 * describes it. Red and Blue share an engine; Yellow has its own opening, its
 * own title and Jessie and James, all in the lens since 19 September 2026.
 * `plays` is the switch for a cartridge whose manifest bakes before the lens
 * can play it: named and refused rather than baked into a world that stops.
 */
const CARTRIDGES: { [sha1: string]: { name: string; manifest: string; plays: boolean } } = {
  ea9bcae617fdf159b045185467ae58b2e4a48b9a: {
    name: "Pokemon Red (USA, Europe)", manifest: "/manifests/rom_manifest_red.json", plays: true,
  },
  d7037c83e1ae5b39bde3c30787637ba1d4c48ce2: {
    name: "Pokemon Blue (USA, Europe)", manifest: "/manifests/rom_manifest_blue.json", plays: true,
  },
  cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1: {
    name: "Pokemon Yellow (USA, Europe)", manifest: "/manifests/rom_manifest_yellow.json", plays: true,
  },
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const drop = $("drop");
const fileInput = $("file") as HTMLInputElement;
const status = $("status");
const bar = $("bar");
const barFill = $("bar-fill");
const result = $("result");
const codeOut = $("code");
const expiry = $("expiry");
const detail = $("detail");
const again = $("again");
const fetched = $("fetched");

let busy = false;
/** The poll that watches for the glasses; cleared by reset() and by an answer. */
let watchTimer: number = 0;
let watchCode: string = "";
let watchSince: number = 0;

/**
 * Asks /api/status/<code> until the lens has fetched the world, so the page
 * can say so. Every four seconds for the first half hour, then every thirty:
 * a visitor who left the tab open overnight should not be a request a second.
 */
function watchForGlasses(code: string) {
  stopWatching();
  watchCode = code;
  watchSince = Date.now();
  fetched.hidden = false;
  fetched.className = "fetched waiting";
  fetched.textContent = "Waiting for your glasses to fetch it.";
  const tick = async () => {
    if (watchCode !== code) {
      return;
    }
    let answer: any = null;
    try {
      const response = await fetch("/api/status/" + encodeURIComponent(code), { cache: "no-store" });
      answer = await response.json();
    } catch (e) {
      answer = null;
    }
    if (watchCode !== code) {
      return;
    }
    const state = answer && answer.state ? answer.state : "";
    if (state === "fetched") {
      const at = answer.fetchedAt ? new Date(answer.fetchedAt) : null;
      const when = at && !isNaN(at.getTime())
        ? at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
      fetched.className = "fetched done";
      fetched.textContent = "Your glasses have it" + (when ? " (" + when + ")" : "") + ". The world is on them for good.";
      return;
    }
    if (state === "expired" || state === "unknown") {
      fetched.className = "fetched gone";
      fetched.textContent = state === "expired"
        ? "This code has expired. Drop the file again for a new one."
        : "This code is no longer on the site. Drop the file again for a new one.";
      return;
    }
    const slow = Date.now() - watchSince > 30 * 60 * 1000;
    watchTimer = window.setTimeout(tick, slow ? 30000 : 4000);
  };
  watchTimer = window.setTimeout(tick, 4000);
}

function stopWatching() {
  if (watchTimer) {
    window.clearTimeout(watchTimer);
    watchTimer = 0;
  }
  watchCode = "";
  fetched.hidden = true;
  fetched.textContent = "";
}

function say(text: string, kind: string = "") {
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
}

function progress(fraction: number | null) {
  if (fraction === null) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  barFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + "%";
}

function reset() {
  stopWatching();
  result.hidden = true;
  drop.hidden = false;
  progress(null);
  say("Drop your cartridge dump here, or choose the file.");
  fileInput.value = "";
}

function formatExpiry(iso: string): string {
  const at = new Date(iso);
  if (isNaN(at.getTime())) {
    return "in about a day";
  }
  return at.toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" });
}

async function handleFile(file: File) {
  if (busy) {
    return;
  }
  busy = true;
  drop.hidden = true;
  result.hidden = true;
  try {
    say("Reading " + file.name + "...");
    progress(0.02);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== 0x100000) {
      throw new Error(file.name + " is " + bytes.length + " bytes; a Generation 1 cartridge is 1,048,576. This is not a cartridge dump.");
    }
    const hash = sha1(bytes);
    const cartridge = CARTRIDGES[hash];
    if (!cartridge) {
      throw new Error("This file's SHA-1 is " + hash.slice(0, 12) + "..., which is not Pokemon Red, Blue or Yellow (USA, Europe). Nothing was read from it.");
    }
    if (!cartridge.plays) {
      throw new Error("This is " + cartridge.name + ". The lens does not play this cartridge yet. Nothing was read from it.");
    }
    say("A " + cartridge.name + " cartridge. Fetching the symbol manifest...");
    progress(0.06);
    const manifestResponse = await fetch(cartridge.manifest);
    if (!manifestResponse.ok) {
      throw new Error("the symbol manifest could not be fetched (" + manifestResponse.status + ")");
    }
    const manifest = await manifestResponse.json();

    say("Baking the world in your browser. Nothing has left this machine.");
    progress(0.1);
    const baked = await bake(bytes.buffer, manifest);

    say("Baked " + baked.maps + " maps in " + (baked.ms / 1000).toFixed(1) + " s. Storing the world for a day...");
    progress(0.9);
    const upload = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: baked.text,
    });
    const answer: any = await upload.json().catch(() => ({}));
    if (!upload.ok || !answer.code) {
      throw new Error("the world could not be stored: " + (answer.error || upload.status) +
                      (answer.reason ? " (" + answer.reason + ")" : ""));
    }
    progress(1);
    codeOut.textContent = answer.code.slice(0, 3) + " " + answer.code.slice(3);
    expiry.textContent = "It works until " + formatExpiry(answer.expiresAt) + ". After that, drop the file again for a new one.";
    detail.textContent = baked.maps + " maps, " + (baked.chars / 1048576).toFixed(2) + " MB baked, cartridge " + hash.slice(0, 8) + ".";
    result.hidden = false;
    say("Done. Type the code into the lens.", "ok");
    watchForGlasses(answer.code);
  } catch (e: any) {
    say(String(e && e.message ? e.message : e), "bad");
    progress(null);
    drop.hidden = false;
  } finally {
    busy = false;
  }
}

function bake(rom: ArrayBuffer, manifest: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/extract.worker.js");
    worker.onmessage = (event: MessageEvent) => {
      const m = event.data || {};
      if (m.type === "stage") {
        say("Baking: " + m.name + " (" + (m.index + 1) + " of " + m.total + ")");
        progress(0.1 + 0.75 * ((m.index + 1) / m.total));
      } else if (m.type === "done") {
        worker.terminate();
        resolve(m);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error("the bake failed: " + m.message));
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      reject(new Error("the bake crashed: " + (event.message || "unknown error")));
    };
    // A copy, not a transfer: the page keeps its bytes in case of a retry.
    worker.postMessage({ type: "bake", rom: rom.slice(0), manifest });
  });
}

drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
  if (file) {
    handleFile(file);
  }
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files ? fileInput.files[0] : null;
  if (file) {
    handleFile(file);
  }
});
again.addEventListener("click", reset);
reset();
