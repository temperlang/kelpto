// Runs the built site's JavaScript tour in Node, as the page's "Run in your
// browser" button does (tourrun.js), and prints its output. `build.py` runs
// it on the built site and fails unless it prints `tour/expected.txt`.
//
//     node site/tour-node.mjs site/build

import { readFileSync } from "node:fs";
import { loadLibrary } from "./lib-node.mjs";
import { runTour } from "./tourrun.js";

const build = process.argv[2] ?? "site/build";
const modules = { "kelpto-md": await loadLibrary(build) };
const source = readFileSync(`${build}/tour/tour.js`, "utf8");
process.stdout.write(await runTour(source, modules));
