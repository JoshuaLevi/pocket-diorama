// Browser UI for pokemon-ar-bridge. Plain DOM, no framework, no build step.
// State arrives over Server-Sent Events; every render is a full redraw of one object.

const el = (id) => document.getElementById(id);

const nodes = {
  lensStatus: el("lens-status"),
  lensStatusText: el("lens-status-text"),
  pairingCode: el("pairing-code"),
  rotate: el("rotate-code"),
  wsUrls: el("ws-urls"),
  noLan: el("no-lan"),
  transfer: el("transfer"),
  transferTitle: el("transfer-title"),
  transferBar: el("transfer-bar"),
  transferDetail: el("transfer-detail"),
  dropzone: el("dropzone"),
  romInput: el("rom-input"),
  romRows: el("rom-rows"),
  romEmpty: el("rom-empty"),
  romError: el("rom-error"),
  saveInput: el("save-input"),
  saveRom: el("save-rom"),
  saveRows: el("save-rows"),
  saveEmpty: el("save-empty"),
  saveError: el("save-error"),
  activity: el("activity"),
  dataDir: el("data-dir"),
  protocolVersion: el("protocol-version"),
};

let lastState = null;

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MiB";
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function showError(node, message) {
  node.textContent = message;
  node.classList.remove("hidden");
  window.setTimeout(() => node.classList.add("hidden"), 9000);
}

function copy(text, button) {
  const done = () => {
    const original = button.dataset.original || button.textContent;
    button.dataset.original = original;
    button.textContent = "copied";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => undefined);
    return;
  }
  const scratch = document.createElement("textarea");
  scratch.value = text;
  document.body.appendChild(scratch);
  scratch.select();
  try {
    document.execCommand("copy");
    done();
  } catch (error) {
    // Copying is a convenience; the text is on screen either way.
  }
  document.body.removeChild(scratch);
}

function renderLens(state) {
  const client = state.clients.length > 0 ? state.clients[0] : null;
  if (client === null) {
    nodes.lensStatus.className = "pill pill-idle";
    nodes.lensStatusText.textContent = "no lens attached";
    return;
  }
  nodes.lensStatus.className = "pill pill-live";
  const who = client.clientName === "unknown" ? "a lens" : client.clientName;
  nodes.lensStatusText.textContent = client.paired
    ? who + " attached (" + client.remoteAddress + ")"
    : "unpaired client at " + client.remoteAddress;
}

function renderTransfer(state) {
  let transfer = null;
  for (const client of state.clients) {
    if (client.transfer !== null) {
      transfer = client.transfer;
      break;
    }
  }
  if (transfer === null) {
    nodes.transfer.classList.add("hidden");
    return;
  }
  nodes.transfer.classList.remove("hidden");
  const pct = transfer.totalBytes === 0 ? 0 : (transfer.transferredBytes / transfer.totalBytes) * 100;
  nodes.transferTitle.textContent =
    transfer.direction === "to-lens" ? "Sending " + transfer.name : "Receiving " + transfer.name;
  nodes.transferBar.style.width = pct.toFixed(1) + "%";
  nodes.transferDetail.textContent =
    "chunk " +
    transfer.chunkIndex +
    " of " +
    transfer.chunkCount +
    "  ·  " +
    formatBytes(transfer.transferredBytes) +
    " of " +
    formatBytes(transfer.totalBytes) +
    "  ·  " +
    pct.toFixed(0) +
    "%";
}

function renderPairing(state) {
  nodes.pairingCode.textContent = state.server.pairingRequired ? state.server.pairingCode : "not needed";
  nodes.wsUrls.replaceChildren();
  const urls = state.server.wsUrls;
  nodes.noLan.classList.toggle("hidden", urls.length > 0);
  urls.forEach((url, index) => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = url;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = "copy";
    button.addEventListener("click", () => copy(url, button));
    const iface = document.createElement("span");
    iface.className = "iface";
    iface.textContent = state.server.lan[index] ? state.server.lan[index].iface : "";
    li.append(code, button, iface);
    nodes.wsUrls.appendChild(li);
  });
}

function romRow(rom) {
  const tr = document.createElement("tr");

  // A verified cartridge is named by what it is; an unverified file is named by what
  // the user called it, because its header title is untrusted and often junk.
  const name = document.createElement("td");
  name.className = "name";
  name.textContent = rom.verified ? rom.label : rom.filename;
  const sub = document.createElement("span");
  const detail = [];
  if (rom.verified) detail.push(rom.filename);
  else if (rom.cartridgeTitle) detail.push('header says "' + rom.cartridgeTitle + '"');
  if (rom.cartridgeType) detail.push(rom.cartridgeType);
  sub.textContent = detail.join("  ·  ");
  name.appendChild(sub);

  const size = document.createElement("td");
  size.textContent = formatBytes(rom.sizeBytes);

  const hash = document.createElement("td");
  const hashButton = document.createElement("button");
  hashButton.className = "hash";
  hashButton.type = "button";
  hashButton.title = rom.sha1 + " (click to copy)";
  hashButton.textContent = rom.sha1.slice(0, 12) + "...";
  hashButton.addEventListener("click", () => copy(rom.sha1, hashButton));
  hash.appendChild(hashButton);

  const verdict = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "verdict " + (rom.verified ? "verdict-ok" : "verdict-bad");
  badge.textContent = rom.verified ? "verified " + rom.game : "not a known cartridge";
  if (!rom.verified) badge.title = "The hash matches no canonical Gen 1 ROM, so the bridge will not send it.";
  verdict.appendChild(badge);

  const actions = document.createElement("td");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "remove";
  remove.addEventListener("click", () => {
    if (!window.confirm("Remove " + (rom.label || rom.filename) + " from the library?")) return;
    fetch("/api/roms/" + encodeURIComponent(rom.id), { method: "DELETE" }).catch((error) =>
      showError(nodes.romError, String(error)),
    );
  });
  actions.appendChild(remove);

  tr.append(name, size, hash, verdict, actions);
  return tr;
}

function renderRoms(state) {
  nodes.romRows.replaceChildren(...state.roms.map(romRow));
  nodes.romEmpty.classList.toggle("hidden", state.roms.length > 0);

  const selected = nodes.saveRom.value;
  nodes.saveRom.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "no cartridge";
  nodes.saveRom.appendChild(none);
  for (const rom of state.roms) {
    if (!rom.verified) continue;
    const option = document.createElement("option");
    option.value = rom.id;
    option.textContent = rom.label || rom.filename;
    nodes.saveRom.appendChild(option);
  }
  nodes.saveRom.value = selected;
}

function saveRow(save, romsById) {
  const tr = document.createElement("tr");

  const name = document.createElement("td");
  name.className = "name";
  name.textContent = save.filename;
  const sub = document.createElement("span");
  const origin = save.source === "lens" ? "pushed by the lens" : "uploaded here";
  sub.textContent = origin + (save.looksLikeGen1 ? "" : "  ·  not a 32 KiB Gen 1 save");
  name.appendChild(sub);

  const cartridge = document.createElement("td");
  const rom = save.romId ? romsById[save.romId] : null;
  cartridge.textContent = rom ? rom.label || rom.filename : "unknown";

  const size = document.createElement("td");
  size.textContent = formatBytes(save.sizeBytes);

  const stored = document.createElement("td");
  stored.textContent = formatDate(save.createdAt);

  const actions = document.createElement("td");
  const download = document.createElement("a");
  download.className = "ghost";
  download.href = "/api/saves/" + encodeURIComponent(save.id) + "/file";
  download.download = save.filename;
  download.textContent = "download";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "delete";
  remove.addEventListener("click", () => {
    if (!window.confirm("Delete " + save.filename + "? A save cannot be regenerated.")) return;
    fetch("/api/saves/" + encodeURIComponent(save.id), { method: "DELETE" }).catch((error) =>
      showError(nodes.saveError, String(error)),
    );
  });
  actions.append(download, document.createTextNode(" "), remove);

  tr.append(name, cartridge, size, stored, actions);
  return tr;
}

function renderSaves(state) {
  const romsById = {};
  for (const rom of state.roms) romsById[rom.id] = rom;
  nodes.saveRows.replaceChildren(...state.saves.map((save) => saveRow(save, romsById)));
  nodes.saveEmpty.classList.toggle("hidden", state.saves.length > 0);
}

function renderActivity(state) {
  nodes.activity.replaceChildren(
    ...state.activity.map((line) => {
      const li = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = line.at;
      time.textContent = formatTime(line.at);
      const text = document.createElement("span");
      text.textContent = line.text;
      li.append(time, text);
      return li;
    }),
  );
}

function render(state) {
  lastState = state;
  renderLens(state);
  renderTransfer(state);
  renderPairing(state);
  renderRoms(state);
  renderSaves(state);
  renderActivity(state);
  nodes.dataDir.textContent = state.server.dataDir;
  nodes.protocolVersion.textContent = String(state.server.protocolVersion);
}

async function uploadRoms(files) {
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch("/api/roms", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-filename": encodeURIComponent(file.name),
        },
        body: buffer,
      });
      const body = await response.json();
      if (!response.ok) {
        showError(nodes.romError, file.name + ": " + (body.error || response.statusText));
        continue;
      }
      if (body.rom && body.rom.verified === false) {
        showError(
          nodes.romError,
          file.name +
            " is stored but will not be sent: its SHA-1 (" +
            body.rom.sha1 +
            ") matches no canonical Gen 1 cartridge.",
        );
      }
    } catch (error) {
      showError(nodes.romError, file.name + ": " + String(error));
    }
  }
}

async function uploadSave(file, romId) {
  try {
    const buffer = await file.arrayBuffer();
    const response = await fetch("/api/saves", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-filename": encodeURIComponent(file.name),
        "x-rom-id": romId,
      },
      body: buffer,
    });
    if (!response.ok) {
      const body = await response.json();
      showError(nodes.saveError, file.name + ": " + (body.error || response.statusText));
    }
  } catch (error) {
    showError(nodes.saveError, String(error));
  }
}

function wireEvents() {
  nodes.dropzone.addEventListener("click", () => nodes.romInput.click());
  nodes.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      nodes.romInput.click();
    }
  });
  nodes.romInput.addEventListener("change", () => {
    if (nodes.romInput.files) void uploadRoms(Array.from(nodes.romInput.files));
    nodes.romInput.value = "";
  });

  for (const type of ["dragenter", "dragover"]) {
    nodes.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      nodes.dropzone.classList.add("hot");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    nodes.dropzone.addEventListener(type, () => nodes.dropzone.classList.remove("hot"));
  }
  nodes.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      void uploadRoms(Array.from(event.dataTransfer.files));
    }
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => event.preventDefault());

  nodes.saveInput.addEventListener("change", () => {
    const file = nodes.saveInput.files && nodes.saveInput.files[0];
    if (file) void uploadSave(file, nodes.saveRom.value);
    nodes.saveInput.value = "";
  });

  nodes.rotate.addEventListener("click", () => {
    fetch("/api/pairing/rotate", { method: "POST" }).catch(() => undefined);
  });
}

function connect() {
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    try {
      render(JSON.parse(event.data));
    } catch (error) {
      // A malformed frame is not worth tearing the page down for.
    }
  };
  source.onerror = () => {
    if (lastState !== null) {
      nodes.lensStatus.className = "pill pill-idle";
      nodes.lensStatusText.textContent = "bridge offline";
    }
  };
}

wireEvents();
connect();
