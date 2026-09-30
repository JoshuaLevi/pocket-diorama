// GET /api/status/<code>: has the lens fetched this world yet?
//
// The page that baked a world and showed its code polls this while the
// visitor walks to the glasses, so it can close the loop: "waiting for your
// glasses" becomes "your glasses have it" the moment api/bundle/[code].js has
// served the bundle. It answers with a state and nothing else -- never the
// bundle, never anything a guessed code could use.
//
//   waiting   the bundle is there, nobody has fetched it
//   fetched   the lens fetched it (fetchedAt), whether or not it still exists
//   expired   its day is over and nobody fetched it
//   unknown   no such code (or older than the sweep)

import { head } from "@vercel/blob";
import { normaliseCode, isValidCode, pathnameFor, fetchedPathnameFor, isExpired, BUNDLE_TTL_MS } from "../../lib/codes.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function headOrNull(pathname) {
  try {
    return await head(pathname);
  } catch (e) {
    return null;
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.split("/").pop() || "");
  const code = normaliseCode(raw);
  if (!isValidCode(code)) {
    return json(404, { state: "unknown" });
  }
  const now = Date.now();
  const [bundle, marker] = await Promise.all([
    headOrNull(pathnameFor(code)),
    headOrNull(fetchedPathnameFor(code)),
  ]);
  if (marker && !isExpired(marker.uploadedAt, now)) {
    return json(200, { state: "fetched", fetchedAt: new Date(marker.uploadedAt).toISOString() });
  }
  if (!bundle) {
    return json(200, { state: "unknown" });
  }
  if (isExpired(bundle.uploadedAt, now)) {
    return json(200, { state: "expired" });
  }
  const expiresAt = new Date(new Date(bundle.uploadedAt).getTime() + BUNDLE_TTL_MS).toISOString();
  return json(200, { state: "waiting", expiresAt });
}
