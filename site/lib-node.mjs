// Loads kelpto-md from the built site's `lib/`, the files the page loads,
// resolving the page's import map names the same way, for the build's
// checks in Node.

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * kelpto-md, from the built site in `build`.
 *
 * @param {string} build
 */
export async function loadLibrary(build) {
  const base = pathToFileURL(`${build}/`);
  // As in index.html's import map.
  /** @type {Record<string, string>} */
  const imports = {
    "kelpto-md": new URL("lib/kelpto-md/index.js", base).href,
    "kelpto-core": new URL("lib/kelpto-core/index.js", base).href,
    "@temperlang/core": new URL("lib/temper-core/index.js", base).href,
  };
  registerHooks({
    resolve: (specifier, context, next) =>
      Object.hasOwn(imports, specifier) ? { url: imports[specifier], shortCircuit: true } : next(specifier, context),
  });
  return import("kelpto-md");
}
