// GET /api/cleanup: the nightly sweep. Vercel Cron calls it once a day.
//
// A code lasts a day and api/bundle/[code].js already refuses and deletes an
// expired one when asked; this is for the bundles nobody ever asked for, so
// the store does not fill with worlds whose codes were never typed. Guarded
// with CRON_SECRET, which Vercel sends as a bearer token when the variable is
// set on the project.

import { list, del } from "@vercel/blob";
import { BUNDLE_PREFIX, FETCHED_PREFIX, isExpired } from "../lib/codes.js";

export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (secret.length > 0 && auth !== "Bearer " + secret) {
    return new Response(JSON.stringify({ error: "unauthorised" }), { status: 401 });
  }
  const now = Date.now();
  let seen = 0;
  const gone = [];
  // The bundles, and the "fetched" markers beside them: both live a day.
  for (const prefix of [BUNDLE_PREFIX, FETCHED_PREFIX]) {
    let cursor = undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      for (const blob of page.blobs) {
        seen++;
        if (isExpired(blob.uploadedAt, now)) {
          gone.push(blob.pathname);
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  if (gone.length > 0) {
    await del(gone);
  }
  return new Response(JSON.stringify({ seen, deleted: gone.length }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
