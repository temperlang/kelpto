// Checks the code panel against the page, for `build.py`: for each sample
// in `golden/samples.json`, makes its edits as the page does
// (`applyStep`), then runs the JavaScript that `codeFor` writes for them,
// as the tour runs (tourrun.js), and fails unless it prints the same
// document. Prints, as JSON, each sample's document and its code in every
// language, which `build.py` checks against `golden/`.
//
//     node site/editcode-node.mjs site/build site/golden/samples.json

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadLibrary } from "./lib-node.mjs";
import { runTour } from "./tourrun.js";

const [build = "site/build", samplesPath = "site/golden/samples.json"] = process.argv.slice(2);
const kelptoMd = await loadLibrary(build);
const { CODE_LANGUAGES, applyStep, parserFor, programFor } = await import(pathToFileURL(`${build}/editcode.js`).href);

/** @type {Record<string, import("./editcode.js").Program>} */
const samples = JSON.parse(readFileSync(samplesPath, "utf8"));
/** @type {Record<string, { output: string, code: Record<string, string> }>} */
const results = {};
let failed = false;
for (const [name, program] of Object.entries(samples)) {
  let doc = parserFor(program).parse(program.input);
  for (const step of program.steps) {
    const next = applyStep(doc, step);
    if (next.asWritten === doc.asWritten) {
      console.error(`${name}: this step changes nothing: ${JSON.stringify(step)}`);
      failed = true;
    }
    doc = next;
  }
  const output = `${doc.asWritten}\n`;
  const ran = await runTour(programFor("js", program), { "kelpto-md": kelptoMd });
  if (ran !== output) {
    console.error(`${name}: the JavaScript code prints otherwise than the page's edits.\n` +
      `page: ${JSON.stringify(output)}\ncode: ${JSON.stringify(ran)}`);
    failed = true;
  }
  results[name] = { output, code: Object.fromEntries(CODE_LANGUAGES.map((lang) => [lang, programFor(lang, program)])) };
}
if (failed) process.exit(1);
process.stdout.write(JSON.stringify(results));
