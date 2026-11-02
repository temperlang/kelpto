// Runs CommonMark's and GFM's examples through the built site's kelpto-md in
// Node, as the libraries' own tests do (tests/commonmark and tests/gfm),
// and prints each suite's counts as JSON. `build.py` fails unless every
// example passes, and puts the counts in the page.
//
//     node site/conformance-node.mjs site/build tests/commonmark/spec.json tests/gfm/spec.json

import { readFileSync } from "node:fs";
import { loadLibrary } from "./lib-node.mjs";

const [build, commonMarkPath, gfmPath] = process.argv.slice(2);
const { MarkdownParser, MarkdownRenderer, parseMarkdown } = await loadLibrary(build);
const trusted = new MarkdownRenderer().withRawHtmlTrusted();

/** @param {string} path */
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * Passed and total, and the failing examples' labels.
 *
 * @param {any[]} examples
 * @param {(example: any) => boolean} passes
 * @param {(example: any) => string} label
 */
function score(examples, passes, label) {
  const failing = examples.filter((example) => !passes(example)).map(label);
  return { passed: examples.length - failing.length, total: examples.length, failing };
}

// As tests/gfm/spec-tests.temper.md chooses each example's parser and
// renderer, and its expected HTML for the spec's task list examples.

/** @param {any} example */
function gfmParser(example) {
  const { extension, source, section } = example;
  if (source === "regression") {
    let parser = MarkdownParser.commonMark;
    for (const name of extension.split(" ")) {
      if (name === "table") parser = parser.withTables(true);
      if (name === "strikethrough") parser = parser.withStrikethrough(true);
      if (name === "autolink") parser = parser.withExtendedAutolinks(true);
      if (name === "footnotes") parser = parser.withFootnotes(true);
    }
    return parser;
  }
  if (source === "extensions" || extension === "disabled") return MarkdownParser.gfm;
  if (extension === "table") return MarkdownParser.commonMark.withTables(true);
  if (extension === "strikethrough") return MarkdownParser.commonMark.withStrikethrough(true);
  if (extension === "autolink") return MarkdownParser.commonMark.withExtendedAutolinks(true);
  if (section === "Autolinks") return MarkdownParser.gfm.withExtendedAutolinks(false);
  return MarkdownParser.gfm;
}

/** @param {any} example */
function gfmRenderer(example) {
  return example.source === "extensions" || example.extension === "tagfilter" ? trusted.withDisallowedRawHtmlFiltered() : trusted;
}

/** @param {any} example */
function gfmExpected(example) {
  if (example.extension !== "disabled") return example.html;
  return example.html
    .replaceAll('<input checked="" disabled="" type="checkbox">', '<input type="checkbox" checked="" disabled="" />')
    .replaceAll('<input disabled="" type="checkbox">', '<input type="checkbox" disabled="" />');
}

const results = {
  commonmark: score(
    read(commonMarkPath),
    (example) => trusted.render(parseMarkdown(example.markdown)) === example.html,
    (example) => String(example.example),
  ),
  gfm: score(
    read(gfmPath),
    (example) =>
      example.html === "<IGNORE>\n" || gfmRenderer(example).render(gfmParser(example).parse(example.markdown)) === gfmExpected(example),
    (example) => `${example.source} ${example.example}`,
  ),
};
process.stdout.write(JSON.stringify(results) + "\n");
