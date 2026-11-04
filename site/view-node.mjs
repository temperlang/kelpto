// Runs the JavaScript view function example (`view/view.js`) in Node, as
// the tour runs (tourrun.js), with a layout and nav of its own, and fails
// unless the view gives what renderSafe gives, the second time from the
// cache. `build.py` runs it on the built site.
//
//     node site/view-node.mjs site/build

import { readFileSync } from "node:fs";
import { loadLibraries } from "./lib-node.mjs";
import { runTour } from "./tourrun.js";

const build = process.argv[2] ?? "site/build";
const modules = await loadLibraries(build);
const markdown = "Hi <b onclick=x>there</b> [x](javascript:alert(1))";
const harness = `
const layout = (...parts) => parts.join("");
const nav = (user) => "<nav>" + user + "</nav>";
const raw = (html) => html;
${readFileSync(`${build}/view/view.js`, "utf8")}
const state = { user: "ana", post: { markdown: ${JSON.stringify(markdown)} } };
console.log(view(state));
console.log(view(state));
`;
const out = await runTour(harness, modules);
const { parseMarkdownWithHtml, renderSafe } = modules.kelpto;
const page = `<nav>ana</nav>${renderSafe(parseMarkdownWithHtml(markdown)).html}`;
if (out !== `${page}\n${page}\n`) {
  console.error(`The view gives otherwise:\n${out}\nnot\n${page}`);
  process.exit(1);
}
