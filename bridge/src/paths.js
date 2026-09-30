import { homedir, platform } from "node:os";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const APP_DIR_NAME = "pokemon-ar-bridge";

/** Directory of the installed bridge package (…/bridge). */

export function packageRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Where ROMs and saves live: the OS user-data directory, never the repository and never
 * the current working directory. This repo is going open source with zero game content
 * in it, and the cheapest way to keep that true is to make it impossible to put a
 * cartridge image inside the checkout in the first place.
 */
export function defaultDataDir() {
  const home = homedir();
  const os = platform();
  if (os === "darwin") {
    return join(home, "Library", "Application Support", APP_DIR_NAME);
  }
  if (os === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, APP_DIR_NAME);
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(home, ".local", "share");
  return join(base, APP_DIR_NAME);
}

/** Resolution order: --data-dir flag, POKEMON_AR_BRIDGE_HOME, OS user-data dir. */

export function resolveDataDir(flagValue) {
  if (flagValue && flagValue.length > 0)
    return resolve(flagValue);
  const fromEnv = process.env.POKEMON_AR_BRIDGE_HOME;
  if (fromEnv && fromEnv.length > 0)
    return resolve(fromEnv);
  return defaultDataDir();
}

function isInside(child, parent) {
  const a = resolve(child) + sep;
  const b = resolve(parent) + sep;
  return a.startsWith(b);
}

/**
 * Hard guard. Throws rather than writing a cartridge image anywhere inside the git
 * checkout, whatever the flags say.
 */
export function assertSafeDataDir(dataDir) {
  const repoRoot = resolve(packageRoot(), "..");
  if (isInside(dataDir, repoRoot)) {
    throw new Error("refusing to use a data directory inside the Pokemon-AR checkout (" +
      dataDir +
      "). ROMs and saves must live outside the repository.");
  }
}

/** Creates the directory layout if it does not exist and returns the paths. */

export function ensureDataLayout(dataDir) {
  assertSafeDataDir(dataDir);
  const layout = {
    root: dataDir,
    roms: join(dataDir, "roms"),
    saves: join(dataDir, "saves"),
    romIndex: join(dataDir, "roms", "index.json"),
    saveIndex: join(dataDir, "saves", "index.json"),
  };
  mkdirSync(layout.roms, { recursive: true, mode: 0o700 });
  mkdirSync(layout.saves, { recursive: true, mode: 0o700 });
  return layout;
}

/** True when the path exists and is a regular file. */

export function isFile(path) {
  try {
    return statSync(path).isFile();
  }
  catch {
    return false;
  }
}
