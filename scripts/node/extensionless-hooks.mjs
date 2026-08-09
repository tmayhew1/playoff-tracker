// Lets plain `node` resolve the app's extensionless imports.
//
// app/**/*.js uses Next's module resolution (`import { x } from "./leverage"`),
// which bare Node ESM does not implement. scripts/legacy-report.mjs runs
// outside Next, so it registers this hook to append ".js" when a specifier
// resolves to nothing else. Scoped to relative specifiers, so nothing in
// node_modules changes behaviour.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Next also imports JSON with a plain `import x from "./y.json"`, which Node
// requires an explicit `with { type: "json" }` for. Supply it here so the app
// modules stay written the way Next expects.
function withJsonAttr(result, specifier) {
  if (!specifier.endsWith(".json")) return result;
  return { ...result, importAttributes: { ...result.importAttributes, type: "json" } };
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return withJsonAttr(await nextResolve(specifier, context), specifier);
  } catch (err) {
    if (!specifier.startsWith(".") || specifier.endsWith(".js")) throw err;
    const withExt = `${specifier}.js`;
    const url = new URL(withExt, context.parentURL);
    if (!existsSync(fileURLToPath(url))) throw err;
    return nextResolve(withExt, context);
  }
}
