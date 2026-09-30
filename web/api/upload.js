// POST /api/upload: a baked world in, a code out.
//
// The body is the bundle the page baked in the visitor's own browser -- JSON,
// about 1.7 MB -- and nothing else ever reaches this server: the cartridge
// stays on their machine. The bundle is filed in a PRIVATE blob store under a
// hash of a fresh code, and the code is what the visitor types into the lens.
// It lasts a day; see api/bundle/[code].js and api/cleanup.js.

import { put, head } from "@vercel/blob";
import { mintCode, pathnameFor, inspectBundle, BUNDLE_TTL_MS } from "../lib/codes.js";

/** Larger than any bundle the extractor produces, smaller than the platform's cap. */
const MAX_BYTES = 4 * 1024 * 1024;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) {
    return json(413, { error: "too large", limit: MAX_BYTES });
  }
  let text = "";
  try {
    text = await request.text();
  } catch (e) {
    return json(400, { error: "unreadable body" });
  }
  if (text.length === 0 || text.length > MAX_BYTES) {
    return json(text.length === 0 ? 400 : 413, { error: text.length === 0 ? "empty body" : "too large" });
  }
  const looked = inspectBundle(text);
  if (!looked.ok) {
    return json(422, { error: "not a world bundle", reason: looked.reason });
  }

  // A fresh code, and a fresh pathname: overwrite is refused, so on the
  // vanishingly rare collision the mint is simply repeated.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    const pathname = pathnameFor(code);
    try {
      const existing = await head(pathname).catch(() => null);
      if (existing) {
        continue;
      }
      await put(pathname, text, {
        access: "private",
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
      });
      return json(200, {
        code,
        expiresAt: new Date(Date.now() + BUNDLE_TTL_MS).toISOString(),
        chars: text.length,
        romSha1: looked.romSha1,
        maps: looked.maps,
      });
    } catch (e) {
      if (attempt === 4) {
        return json(500, { error: "could not store the world", detail: String(e && e.message ? e.message : e) });
      }
    }
  }
  return json(500, { error: "could not mint a code" });
}
