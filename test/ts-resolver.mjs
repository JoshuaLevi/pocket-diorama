// Lets Node import the lens sources unchanged.
//
// Lens Studio writes extensionless relative imports ("./WorldData"), which Node's
// ESM resolver rejects. Rewriting the sources to satisfy Node would mean the tests
// no longer run the code that ships, so the resolver is taught the convention
// instead: try the specifier as given, then with .ts appended.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const candidate = resolvePath(dirname(parentPath), specifier + ".ts");
    if (existsSync(candidate)) {
      // Deliberately no `format`: naming it as "module" makes Node skip its
      // TypeScript stripping and choke on the first type annotation. Letting Node
      // infer the format from the .ts extension is what enables stripping.
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
