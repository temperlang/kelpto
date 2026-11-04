// Renders the #safe gallery's cases (`safeGallery()` in
// kelpto/kelpto.temper.md, which `build.py` reads) through the built
// site's kelpto in Node, as the page would, and checks each output parses
// back to itself. Prints each case, with what it gives, as JSON;
// `build.py` fails unless each gives what the library's tests expect.
//
//     node site/safe-node.mjs site/build GALLERY_JSON

import { readFileSync } from "node:fs";
import { loadLibrary } from "./lib-node.mjs";

const [build, galleryPath] = process.argv.slice(2);
const { parseMarkdownWithHtml, renderSafe } = await loadLibrary(build, "kelpto");
const { FragmentContext, parseHtmlFragment } = await loadLibrary(build, "kelpto-html");

/** @type {[string, string, string][]} */
const gallery = JSON.parse(readFileSync(galleryPath, "utf8"));
const body = new FragmentContext("body");
const results = gallery.map(([label, markdown, expected]) => {
  const html = renderSafe(parseMarkdownWithHtml(markdown)).html;
  const reparsed = parseHtmlFragment(html, body);
  const reparses = reparsed.html === html && reparsed.sanitize().html === html;
  return { label, markdown, html, expected, reparses };
});
process.stdout.write(JSON.stringify(results) + "\n");
