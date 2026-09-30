// Bundles the page and the worker out of the lens's own sources.
//
//   node build.mjs
//
// The extractor lives in ../Assets/Scripts and is written for the Lens
// runtime; esbuild resolves the TypeScript straight from there, so the page
// bakes with the exact code the lens runs and there is no second copy to
// drift. The symbol manifests are copied in beside them. Nothing here reads
// or writes a cartridge.

import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
};

await build({ ...common, entryPoints: [join(here, "src/app.ts")], outfile: join(here, "public/app.js") });
await build({ ...common, entryPoints: [join(here, "src/extract.worker.ts")], outfile: join(here, "public/extract.worker.js") });
await build({ ...common, entryPoints: [join(here, "src/site.ts")], outfile: join(here, "public/site.js") });

mkdirSync(join(here, "public/manifests"), { recursive: true });
for (const game of ["red", "blue", "yellow"]) {
  copyFileSync(join(root, "Assets/Manifests/rom_manifest_" + game + ".json"),
               join(here, "public/manifests/rom_manifest_" + game + ".json"));
}

// Say what was built, in bytes, so a bundle that suddenly doubles is noticed.
for (const f of ["public/app.js", "public/extract.worker.js", "public/site.js", "public/manifests/rom_manifest_red.json", "public/manifests/rom_manifest_blue.json"]) {
  const bytes = readFileSync(join(here, f)).length;
  console.log(`BUILD  ${f}  ${(bytes / 1024).toFixed(0)} KB`);
}
writeFileSync(join(here, "public/.built"), new Date().toISOString() + "\n");
