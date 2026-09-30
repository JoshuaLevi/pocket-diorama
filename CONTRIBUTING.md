# Contributing

Read [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) first and get a world rendering.
Everything below assumes you have.

---

## The one absolute rule: no ROM ever enters git

No cartridge image, no save, and nothing derived from either. Not in a commit, not in a
branch, not in a test fixture, not "temporarily".

`.gitignore` blocks `*.gb`, `*.gbc`, `*.sav`, `*.sgm`, `*.rom` and the whole of
`Assets/Generated/`. Do not weaken it. If you need a new kind of ROM-derived output, add
its path to `.gitignore` in the same commit that creates it.

Check before every push:

```sh
git status --short
git ls-files | grep -Ei '\.(gb|gbc|sav|sgm|rom)$|^Assets/Generated/'
```

The second command must print nothing. CI runs the same check and fails the build if it
ever prints something, and also asserts that `.gitignore` still blocks a `.gb`, a `.sav`
and `Assets/Generated/`.

This is not caution about a grey area. It is the reason the repository can be public: the
lens ships an extractor and a symbol manifest, and every byte of game content is read out
of the user's own cartridge on their own hardware. The moment a ROM-derived file lands in
git, that is no longer true of the project's whole history.

---

## Running the gates

```sh
./tools/verify.sh
```

That is the command to run before calling anything done. It ends in
`VERIFY: ALL GATES PASS`, or it names what failed. Anything it cannot run prints `SKIP`
rather than passing quietly.

| Gate | Asserts | Needs |
|---|---|---|
| `tools/gate.sh` | The lens compiles against Lens Studio 5.23 | LS 5.23 |
| `tools/gate515.sh` | It also compiles against 5.15.4, the device target | LS 5.15.4 |
| `test/overworld.test.mjs` | Collision, grass, map seams, encounter distribution | a baked bundle |
| `test/script.test.mjs` | The script VM and the ported map scripts | a baked bundle |
| `test/checksum.test.mjs` | The lens's CRC-32 and SHA-1 agree with Node's | your cartridge |
| `test/worldfromrom.test.mjs` | All 18 datasets are byte-identical to the reference | cartridge + golden |
| `test/bundle.test.mjs` | The lens-built world matches the desktop-baked one | cartridge + bundle |
| `test/rombridge.test.mjs` | The shipping client talks to the real bridge | your cartridge |

Point it at your own files:

```sh
export CARTRIDGE_ROM="/path/to/your.gb"
export CARTRIDGE_GOLDEN="/path/to/gen1recomp-golden/json"   # optional
```

Tests run the shipping TypeScript unmodified, through the resolver in
`test/ts-resolver.mjs`. **Run them from the repository root** — `--import
./test/register.mjs` is resolved against the working directory, and from anywhere else
you get `ERR_MODULE_NOT_FOUND ... /test/ts-resolver.mjs`.

```sh
node --experimental-strip-types --import ./test/register.mjs test/<yours>.mjs <args>
```

Also available, and not in `verify.sh` because they need their own toolchains:

```sh
cd tools/extractor && npm ci && npm run typecheck    # clean; keep it that way
cd bridge && npm i --no-save typescript @types/node && npm run typecheck
```

The bridge one is **not clean today**: six pre-existing errors in `src/protocol/session.js`
and `test/verify-transfer.js`, all of the same shape — a field initialised to `null` gets
inferred as type `null` and every later assignment to it is rejected. Do not add a seventh.
CI runs it for visibility without blocking; when it is clean, delete the
`continue-on-error` line from the workflow so it starts blocking.

Watch out for one trap in `tools/extractor`: bare `npx tsc` there does **not** typecheck
anything. With no `node_modules` it fetches an unrelated package that prints "This is not
the tsc command you are looking for" and compiles nothing — and it has been observed
exiting 0, so a `&&` chain after it happily continues. Use `npm run typecheck`, or
`./node_modules/.bin/tsc --noEmit`.

---

## A gate you have not seen fail is not a gate

This project has been bitten by silent passes repeatedly. None of the following is
hypothetical:

- the 5.15 gate took **four attempts** to become a gate at all, and every one of those
  failures was a silent pass — it reported `PASS` while compiling nothing;
- `lensifyts` colours its human output, so grepping the raw stream for `error TS` matched
  nothing on a failing build: the ANSI codes sat in the middle of the string;
- the compiler binary moved between Lens Studio versions
  (`Es_TypeScriptCompiler.bundle` on 5.15, `Es_TypeScriptCompilationManager.bundle` on
  5.23), so a hard-coded path resolved to nothing;
- 5.15's compiler exits before type checking if `--componentsCompileDir` is missing, and
  reports that as a CLI usage error rather than as a diagnostic — no errors, therefore
  "clean";
- neither compiler's exit code tracks diagnostics, so `&& echo ok` said ok;
- a game controller that reported "connected" with no hardware in the room, and then
  swallowed every input;
- a byte-for-byte comparison whose own canonicaliser reordered keys, so two different
  structures compared equal;
- an asset lookup that returned PNG bytes where pixels were expected.

So: **print what the code believes, not whether it ran**, and prove every new gate can
fail before you trust it passing.

Both compile gates carry a `--selftest` that plants a fault and requires a `FAIL`:

```sh
./tools/gate.sh --selftest
```
```
CARTRIDGE-GATE: compiler=Es_TypeScriptCompilationManager.bundle
CARTRIDGE-GATE: exit=0 errors=1
{"type":"Error","data":"Assets/Scripts/__GateSelfTest.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"}
CARTRIDGE-GATE: FAIL
```

```sh
./tools/gate515.sh --selftest
```
```
CARTRIDGE-GATE-515: compiler=5.15.4
CARTRIDGE-GATE-515: exit=0 ours=1 packages=276 bytes=55325
src/Assets/Scripts/__Gate515SelfTest.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
CARTRIDGE-GATE-515: FAIL
```

Note `exit=0` in both. The exit code is printed precisely because it lies; the error
count is what the gate decides on. Both scripts clean up the planted file on exit.

If you add a gate, give it a marker line that is always printed, so "gate passed" and
"gate never ran" cannot be confused, and write down in the script's own header how you
proved it discriminates.

---

## Lens Studio TypeScript

The lens sources under `Assets/Scripts/` are compiled by Lens Studio's own compiler, not
by `tsc`. It is a restricted dialect:

- **No `Record<>`, `Map<>` or `Set<>`.** Use plain objects with an index signature and
  plain arrays.
- **No `export enum`.** Use `const` values on a plain object.
- **`print()`, never `console.log`.**
- **Type-only imports must be `import type`.** Node's type stripping cannot tell a type
  from a value, so a plain `import { SomeInterface }` survives stripping and the tests
  break on a missing export.
- **Every `@input` needs a matching `@hint()`.**
- **No `node:fs`, no `Buffer`.** Anything under `rom/` takes a `Uint8Array` in and returns
  plain objects out, because the same code runs in Node under test and inside the Lens
  Studio sandbox on device.
- World units are centimetres. Rotation is degrees in the Editor API and radians at
  runtime.

This project adds one convention of its own: `PokemonAR` is the **only** script component
in the scene, and it builds every object, mesh and material in code at start-up. That is
not stylistic — a scene built in code migrates to 5.15 by creating one object and setting
a handful of inputs, where an editor-built scene has to be re-authored by hand.

Lens Studio's own rules on scene order and its two separate APIs (the Lens API inside the
lens, the Editor API inside the editor) apply throughout; see developers.snap.com.

---

## It has to compile against 5.15.4 too

Development happens in Lens Studio 5.23, for the agent tooling. **Spectacles (2024) ships
from 5.15.4**, and a change that only compiles against 5.23 is not done. `tools/gate515.sh`
runs 5.15's compiler over the same sources on every change, and a change that fails it
does not land.

What that gate has already caught, both of which would have surfaced on the headset as
confusing failures:

- **`JsonAsset` does not exist in 5.15**, and neither does any other text asset. The baked
  world is therefore a 5.23 convenience only; on the glasses the bundle arrives once and
  lives in `PersistentStorageSystem`, which does exist in both.
- **`BluetoothGatt`'s disconnect signal is named differently** in each version. The
  vendored controller binds whichever is present.

The pattern for spanning the two: duck-type at the boundary. Check for the member you
need, bind whichever is there, and keep the versioned knowledge in one place instead of
letting it leak upward.

`gate515` reports package diagnostics separately from ours, and only `ours=` counts. A few
hundred `packages=` errors are expected: SIK 0.18 is a 5.23-era package, and a real 5.15
project takes its own SIK from the 5.15 template. Never copy a 5.22+ `.lspkg` across.

Consequences of the same constraint, which are why the code looks the way it does: the
scene is built in code rather than in the editor, geometry is CPU `MeshBuilder`, materials
are `ImageMaterialPreset` clones with every property set explicitly, and there are no
graph shaders anywhere.

---

## Style

- **Comments and commit messages in English. No emoji, anywhere.**
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `perf:`.
  One logical change per commit.
- Small, focused files: 200–400 lines is the target, 800 the ceiling. Extract rather than
  grow.
- Comments explain *why*, and especially why something is not the obvious way. The
  headers on `tools/gate.sh` and `Assets/Scripts/world/RomBridge.ts` are the house style:
  they name the trap and how it was found.
- Never force-push `main`.

---

## What CI can and cannot do

[`.github/workflows/verify.yml`](.github/workflows/verify.yml) runs what a hosted runner
can: the extractor's typecheck, a load check over the lens sources, and the ROM hygiene
check. It cannot run either compile gate — those need Lens Studio installed — and it will
never have a cartridge, so every cartridge test skips.

**A green CI badge therefore does not mean a change is safe.** Run `./tools/verify.sh`
locally, on a machine with both Lens Studio versions and your own cartridge, before you
open a pull request, and say in the PR what it printed.
