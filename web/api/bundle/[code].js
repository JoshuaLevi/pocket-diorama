// GET /api/bundle/<code>: the baked world under a code, once, for a day.
//
// What the lens calls (Assets/Scripts/world/WorldSource.ts, HttpsWorldSource)
// with the code the wearer typed. 404 is "no such code", 410 is "there was,
// and its day is over" -- the lens shows the same page for both and sends
// the wearer back to the site. The body is served whole with its length in
// X-Bundle-Length, which is the lens's truncation check.

import { get, head, del, put } from "@vercel/blob";
import { normaliseCode, isValidCode, pathnameFor, fetchedPathnameFor, isExpired } from "../../lib/codes.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.split("/").pop() || "");
  const code = normaliseCode(raw);
  if (!isValidCode(code)) {
    return json(404, { error: "no such code" });
  }
  const pathname = pathnameFor(code);

  let meta = null;
  try {
    meta = await head(pathname);
  } catch (e) {
    meta = null;
  }
  if (!meta) {
    return json(404, { error: "no such code" });
  }
  if (isExpired(meta.uploadedAt, Date.now())) {
    // Gone the moment it is a day old, whether or not the nightly sweep has
    // been round yet; the sweep is only there for codes nobody asked for.
    await del(pathname).catch(() => undefined);
    return json(410, { error: "this code has expired" });
  }

  let result = null;
  try {
    result = await get(pathname, { access: "private", useCache: false });
  } catch (e) {
    result = null;
  }
  if (!result || !result.stream) {
    return json(404, { error: "no such code" });
  }
  // Whole, not streamed: the lens checks the length against the header, and
  // a bundle is under two megabytes.
  const text = await new Response(result.stream).text();
  // Tell the page that showed this code that the glasses have it now
  // (api/status/[code].js). A marker that fails to write costs the visitor a
  // tick they would have seen, never the world.
  await put(fetchedPathnameFor(code), JSON.stringify({ at: new Date().toISOString() }), {
    access: "private",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  }).catch(() => undefined);
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(text, "utf8")),
      "x-bundle-length": String(text.length),
      "cache-control": "private, no-store",
    },
  });
}
