# cartridge-diorama-bridge

The one-time pairing tool for the Pocket Diorama.

You run it on your Mac or PC, drop in your own Game Boy cartridge image, and the lens on
your glasses pulls the bytes over the LAN. The lens verifies the hash, extracts the game
data, and bakes its world into persistent storage. **After that first bake it never needs
this tool again** — no laptop, no phone, no server. That is the whole design brief: this is
a provisioning tool, not a runtime dependency.

```sh
npx cartridge-diorama-bridge
```

That is the entire install: no dependencies, no lockfile, no build step, and nothing to
audit but the source in front of you.

---

## What it does

```
  your ROM  ──drop on the page──►  bridge  ──ws://…:8781──►  lens  ──►  baked world
                                     │                                  (persistent,
                                     └──────  saves come back  ◄────────  standalone)
```

1. **A browser UI** on `http://127.0.0.1:8780` — a drop zone for `.gb` files, your library
   with a green or red verdict per file, the address and pairing code to enter in the lens,
   whether a lens is currently attached, and the saves it has pushed up.
2. **A WebSocket server** on port `8781` that the lens talks to. The protocol is documented
   in [PROTOCOL.md](./PROTOCOL.md), in enough detail to write a client against without
   reading any of this code.

## Verified cartridges only

A file is served to a lens only if its SHA-1 is one of these:

| game | SHA-1 |
|---|---|
| red | `ea9bcae617fdf159b045185467ae58b2e4a48b9a` |
| blue | `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2` |
| yellow | `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1` |

Anything else stays in your library with a red verdict explaining why, and is never sent.
This is not pedantry: the extractor reads the game out of the ROM at fixed symbol
addresses, and pointing those addresses at a different revision does not fail loudly — it
produces plausible-looking garbage. A refusal is the only honest outcome.

## Where your files live

ROMs and saves are written to the OS user data directory, never into this repository and
never into the working directory:

| | |
|---|---|
| macOS | `~/Library/Application Support/cartridge-diorama-bridge` |
| Windows | `%APPDATA%\cartridge-diorama-bridge` |
| Linux | `$XDG_DATA_HOME/cartridge-diorama-bridge`, else `~/.local/share/cartridge-diorama-bridge` |

Override with `--data-dir <path>` or `CARTRIDGE_BRIDGE_HOME`. The bridge refuses to start
if the resulting directory is inside the Pocket Diorama checkout — this project ships zero game
content, and the cheapest way to keep that true is to make the mistake impossible.

## Options

```
--port <n>        port for the browser UI            (default 8780)
--host <addr>     bind address for the browser UI    (default 127.0.0.1)
--ws-port <n>     port for the lens WebSocket        (default 8781)
--ws-host <addr>  bind address for the WebSocket     (default 0.0.0.0)
--data-dir <path> where ROMs and saves are kept      (default: OS user data dir)
--code <digits>   use a fixed pairing code instead of a random one
--no-pairing      accept any lens without a code     (development only)
--add <file.gb>   add a ROM to the library on startup
--open            open the browser UI on start
--verbose         log every protocol step
```

## Threat model, honestly

This is a LAN tool for a one-time handover, and it is worth being precise about what that
does and does not protect.

- **The WebSocket listens on every interface**, because the glasses have to reach it. It is
  gated by a six digit pairing code, regenerated every run and shown in your terminal.
  That is printer-pairing security: it stops the other laptop on the cafe wifi from quietly
  pulling a megabyte off your machine. It is not a defence against someone who wants in.
- **The browser UI binds to loopback only** by default, because it can delete your library
  and download your saves. `--host 0.0.0.0` opens it to the LAN if you want it on a phone;
  understand what you are doing when you pass it.
- **Mutating API requests are Origin-checked**, so a random web page you have open cannot
  quietly reach into `127.0.0.1:8780` and delete things.
- **Traffic is plaintext.** `wss://` would need a certificate the user does not have. If
  you are somewhere you would not send a file in the clear, do not run this there.
- Three wrong pairing codes closes the connection. A connection that has not paired within
  a minute is dropped.

Stop the bridge when you are done. It is meant to run for a couple of minutes, once.

## Verifying it works

```sh
node test/verify-transfer.js --rom "/path/to/your.gb"
```

This spawns the real CLI, drives it with a scripted WebSocket client that behaves the way
the lens will, pulls the ROM end to end in binary and in base64, reassembles it, round
trips a save, and asserts the SHA-1 of the reassembled megabyte. It passes or it fails on a
hash, not on an impression:

```
  [PASS] every announced chunk arrived  32 of 32
  [PASS] SHA-1 of the reassembled ROM is canonical Red  ea9bcae617fdf159b045185467ae58b2e4a48b9a
  [PASS] the reassembled bytes equal the source file  byte for byte
  [PASS] asking for an unverified ROM is refused  E_ROM_UNVERIFIED
  ALL GREEN: 31/31 checks passed
```

## Types

The runtime is plain JavaScript, but it is fully typed. Every declaration lives in
`src/types.d.ts` and the sources are checked against it:

```sh
npm i --no-save typescript @types/node && npm run typecheck
```

`tsconfig.json` turns on `checkJs` with `strict`, so this is a real gate, not decoration.

It is worth saying why the types are not simply written inline as TypeScript, because the
obvious approach does not work. Node 24 runs `.ts` files directly, which is lovely right
up to the moment you publish: **Node refuses to strip types from any file under
`node_modules`**, and there is no flag that lifts it. A TypeScript source tree therefore
cannot be run by `npx cartridge-diorama-bridge` — the one invocation this tool exists to support.
A `.d.ts` is never executed, so it ships happily alongside the JavaScript it describes.

## Layout

```
bin/cartridge-diorama-bridge.mjs   entry point; guards the Node version, then hands off
src/types.d.ts              every type in one file: the vocabulary of the whole tool
src/config.js               every tunable constant, including the canonical hashes
src/library.js              the ROM library on disk, keyed by SHA-1
src/saves.js                the save store
src/hub.js                  the one place that knows everything; both faces read from it
src/http/                   the browser UI server and its JSON API
src/ws/                     a dependency-free RFC 6455 server (frame codec + connections)
src/protocol/               the lens conversation: validation, transfers, session state
web/                        the browser UI: one page, no framework, no build step
test/verify-transfer.js     the acceptance gate
```

## Why no dependencies

`npx cartridge-diorama-bridge` should work on a machine that has never seen this project, on the
evening someone wants to try the lens, without an install step to sit through or a
lockfile to trust. Node already ships everything needed except a WebSocket *server*, which
is a few hundred lines of well specified frame handling in `src/ws/`. Writing those felt
like a better trade than a dependency tree, for a tool whose entire job is to be run once
and forgotten.
