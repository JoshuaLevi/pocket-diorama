// The page keeps the contract app.ts relies on, and points only at things
// that exist. A redesign that renames an id breaks the bake silently in the
// browser; this fails first.
//
//   node --test test/page.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
const html = readFileSync(join(pub, "index.html"), "utf8");
const app = readFileSync(join(here, "..", "src", "app.ts"), "utf8");

test("every id app.ts asks for is in the page, once", () => {
  const wanted = [...app.matchAll(/\$\("([a-z-]+)"\)/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 10, "app.ts should name its elements with $(id)");
  for (const id of wanted) {
    const count = (html.match(new RegExp(`\\sid="${id}"`, "g")) || []).length;
    assert.equal(count, 1, `id="${id}" should appear exactly once, found ${count}`);
  }
});

test("the drop zone keeps the classes app.ts toggles and the label the input needs", () => {
  assert.match(html, /id="drop" class="drop"/);
  assert.match(html, /<label class="pick" for="file">/);
  assert.match(html, /<input id="file" type="file" accept=".gb,application\/octet-stream" hidden \/>/);
});

test("the page loads only its own two scripts, deferred", () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["/app.js", "/site.js"]);
  for (const m of html.matchAll(/<script[^>]*>/g)) {
    assert.match(m[0], /defer/);
  }
});

test("the media the page shows is on disk for the deploy", () => {
  const refs = [...html.matchAll(/(?:src|href|poster|content)="(\/media\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, "the page should reference its media");
  for (const ref of new Set(refs)) {
    assert.ok(existsSync(join(pub, ref)), `${ref} is referenced but missing; see README, Media`);
  }
});

test("the privacy claims are still on the page, word for word where they matter", () => {
  for (const phrase of [
    "Not the cartridge.",
    "the same extractor the lens itself runs",
    "one day",
    "the code is not stored with it",
    "The lens ships no game content",
    "Not affiliated with, endorsed by or sponsored by Nintendo, Game Freak or The Pokemon Company.",
  ]) {
    assert.ok(html.includes(phrase), `missing: ${phrase}`);
  }
});
