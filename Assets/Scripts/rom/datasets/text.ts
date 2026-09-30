/**
 * text.json, text_pointers.json, trainer_headers.json -- all dialogue.
 *
 * Port of `extract_text` in gen1recomp/tools/build_rom_data.py. This is the
 * one dataset that writes three files: the decoded strings, the per-map table
 * that says which TEXT_* id resolves to which label, and the trainer headers
 * that hook a battle onto a conversation.
 *
 * Only `text.json` is decoded from the cart. Each label names a text-command
 * stream -- a tiny bytecode of inline strings and runtime splices -- which
 * core/text.ts walks. The other two files are port metadata the manifest
 * carries, because assembly erased the map/text association at build time and
 * there is nothing in the ROM left to read it back from.
 *
 * The splices are the fragile part. A stream that says "print the trainer's
 * name here" stores an opcode and a RAM address, and the manifest records
 * which token belongs at that point. core/text.ts insists every recorded
 * splice is consumed, in order, with the opcode the manifest predicted; a
 * silent misalignment would produce dialogue that reads perfectly and names
 * the wrong character.
 */

import { decodeTextCommands, parseSubstitutions } from "../core/text";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type {
  ManifestBlob,
  TextPointerTable,
  TextTable,
  TrainerHeaderTable,
} from "../types";
import { deepCloneJson, hasOwn } from "./graphics";

interface TextOutputs {
  text: TextTable;
  text_pointers: TextPointerTable;
  trainer_headers: TrainerHeaderTable;
}

function build(ctx: ExtractContext): TextOutputs {
  const metadata = ctx.manifest.text;
  const charmap = ctx.manifest.charmap;
  const dynamic: ManifestBlob = metadata.dynamic;
  const labels: string[] = metadata.labels;

  const texts: TextTable = {};
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    // hasOwn, not a bare lookup: a label called "constructor" would otherwise
    // pick up Object.prototype and blow up inside parseSubstitutions.
    const substitutions = parseSubstitutions(
      hasOwn(dynamic, label) ? dynamic[label] : [],
    );
    texts[label] = decodeTextCommands(
      ctx.rom,
      ctx.symbols.get(label),
      charmap,
      substitutions,
    );
  }

  // Both metadata tables are cloned so the output never aliases the manifest.
  // The reference converts the trainer-header indices from strings to ints on
  // the way through Lua; in JSON an object key is a string either way, and the
  // manifest already stores them in their normalised form ("1", not "01"), so
  // the conversion has nothing left to do here.
  return {
    text: texts,
    text_pointers: deepCloneJson(metadata.pointers) as TextPointerTable,
    trainer_headers: deepCloneJson(
      metadata.trainerHeaders,
    ) as TrainerHeaderTable,
  };
}

export const builder: DatasetBuilder = {
  name: "text",
  outputs: ["text", "text_pointers", "trainer_headers"],
  build: build,
};

export default builder;
