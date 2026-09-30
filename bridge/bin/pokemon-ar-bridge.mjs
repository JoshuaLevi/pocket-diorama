#!/usr/bin/env node
// Entry point.
//
// The whole package is plain ESM JavaScript, deliberately: Node refuses to strip
// TypeScript types from files under node_modules, so a TypeScript source tree cannot be
// run by `npx cartridge-diorama-bridge` -- which is the one invocation this tool exists for.
// The types live in src/types.d.ts and still check the JavaScript; see README.

const [major] = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));

if (!Number.isFinite(major) || major < 20) {
  process.stderr.write(
    "cartridge-diorama-bridge needs Node 20 or newer. This is Node " + process.versions.node + ".\n" +
      "Install a current Node from https://nodejs.org and retry.\n",
  );
  process.exit(1);
}

const { main } = await import("../src/cli.js");
process.exitCode = await main(process.argv.slice(2));
