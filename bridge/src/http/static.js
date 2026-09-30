import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../paths.js";
/**
 * An explicit allowlist rather than a directory walk.
 *
 * The bridge serves exactly four files and nothing else, which removes path traversal
 * from the threat model completely instead of defending against it.
 */
const ASSETS = [
  { path: "/", asset: { file: "index.html", contentType: "text/html; charset=utf-8" } },
  { path: "/index.html", asset: { file: "index.html", contentType: "text/html; charset=utf-8" } },
  { path: "/app.js", asset: { file: "app.js", contentType: "text/javascript; charset=utf-8" } },
  { path: "/style.css", asset: { file: "style.css", contentType: "text/css; charset=utf-8" } },
  { path: "/favicon.svg", asset: { file: "favicon.svg", contentType: "image/svg+xml" } },
];

/** Returns null when the path is not one of the served assets. */

export function readStaticFile(urlPath) {
  for (const entry of ASSETS) {
    if (entry.path !== urlPath)
      continue;
    try {
      const body = readFileSync(join(packageRoot(), "web", entry.asset.file));
      return { body, contentType: entry.asset.contentType };
    }
    catch {
      return null;
    }
  }
  return null;
}
