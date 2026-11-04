// Loads Kelpto's libraries from the built site's `lib/`, the files the page
// loads, resolving the page's import map names the same way, for the
// build's checks in Node.

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/** The import map's names, by folder, as in index.html. */
const FOLDERS = {
  kelpto: "kelpto",
  "kelpto-html": "kelpto-html",
  "kelpto-md": "kelpto-md",
  "kelpto-core": "kelpto-core",
  "@temperlang/core": "temper-core",
};

/** @type {string | null} */
let registered = null;

/**
 * A library, by its import map name (kelpto-md by default), from the built
 * site in `build`.
 *
 * @param {string} build
 * @param {string} [name]
 */
export async function loadLibrary(build, name = "kelpto-md") {
  if (registered === null) {
    registered = build;
    const base = pathToFileURL(`${build}/`);
    /** @type {Record<string, string>} */
    const imports = Object.fromEntries(
      Object.entries(FOLDERS).map(([specifier, folder]) => [specifier, new URL(`lib/${folder}/index.js`, base).href]),
    );
    registerHooks({
      resolve: (specifier, context, next) =>
        Object.hasOwn(imports, specifier) ? { url: imports[specifier], shortCircuit: true } : next(specifier, context),
    });
  } else if (registered !== build) {
    throw new Error(`Already loading from ${registered}, not ${build}.`);
  }
  return import(name);
}

/**
 * The libraries a tour or program may import, by name.
 *
 * @param {string} build
 */
export async function loadLibraries(build) {
  return {
    "kelpto-md": await loadLibrary(build, "kelpto-md"),
    "kelpto-html": await loadLibrary(build, "kelpto-html"),
    kelpto: await loadLibrary(build, "kelpto"),
  };
}
