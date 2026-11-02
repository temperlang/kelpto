// A tour of Kelpto's Markdown library, from JavaScript.
//
// The same tour exists for each language Kelpto supports, and they all print
// the same text. See demos/README.md for how to run them.

import {
  Heading, Link, LinkReferenceDefinition, LinkTarget, MarkdownParser, MarkdownRenderer, parseMarkdown,
} from "kelpto-md";

function section(title) {
  console.log();
  console.log(`## ${title}`);
}

// Tabs and line endings made visible.
const shown = (text) => text.replaceAll("\t", "\\t").replaceAll("\r", "\\r").replaceAll("\n", "\\n");

// Rendered HTML under a label, without its last newline.
function rendered(label, html) {
  console.log(`${label}:`);
  console.log(html.replace(/\n$/, ""));
}

// The lines an edit changed, and how many it left alone.
function changes(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let changed = 0;
  oldLines.forEach((a, i) => {
    if (a !== newLines[i]) {
      console.log(`- ${a}`);
      console.log(`+ ${newLines[i]}`);
      changed += 1;
    }
  });
  console.log(`${changed} of ${oldLines.length - 1} lines changed, the rest byte for byte`);
}

console.log("# Kelpto tour");

section("1. Parse and print, losslessly");

const text = `# Release notes

Kelpto keeps *every*   byte.

| Library     | Status |
|:------------|-------:|
| kelpto-md   | ready  |
| kelpto-html | early  |

- [x] CommonMark
- [ ] HTML trees

Read [the docs][docs].

[docs]: https://example.com/old
`;
const doc = MarkdownParser.gfm.parse(text);
console.log(`printed back exactly: ${doc.asWritten === text}`);
const heading = doc.headings[0];
console.log(`heading ${heading.level}: ${heading.text}`);
const table = doc.tables[0];
console.log(`table: ${table.header.cells.map((c) => c.text).join(", ")} (${table.alignments.join(", ")})`);
for (const row of table.rows) {
  console.log(`row: ${row.cells.map((c) => c.text).join(", ")}`);
}
for (const task of doc.taskListItems) {
  console.log(`task: ${task.marker} ${task.checked ? "checked" : "not checked"}`);
}
const definition = doc.linkReferenceDefinitions[0];
console.log(`definition: ${definition.label} -> ${definition.destination.url}`);

// Odd input prints back as written too: tabs, line endings, and spacing.
for (const odd of ["  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n"]) {
  console.log(`${shown(odd)} -> ${parseMarkdown(odd).asWritten === odd ? "exactly" : "changed"}`);
}

section("2. Edit one part");

// Each edit gives a new document; the old one stays as it was.
let edited = doc.headings[0].withText("Release notes, 0.1");
edited = edited.tables[0].rows[1].cells[1].withText("ready");
edited = edited.taskListItems[1].withChecked(true);
edited = edited.linkReferenceDefinitions[0].withDestination(new LinkTarget("https://example.com/new"));
changes(text, edited.asWritten);
console.log(`at level 2: ${shown(edited.headings[0].withLevel(2).headings[0].asWritten)}`);
try {
  edited.headings[0].withLevel(7);
  console.log("level 7: done");
} catch {
  console.log("level 7: throws");
}

section("3. Render, safe by default");

const page = parseMarkdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n");
rendered("safe", page.toHtml());
rendered("trusted", new MarkdownRenderer().withRawHtmlTrusted().render(page));
rendered("trusted, GFM's filter", new MarkdownRenderer().withRawHtmlTrusted().withDisallowedRawHtmlFiltered().render(page));

section("4. GitHub Flavored Markdown");

const gfmText = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n";
const gfm = MarkdownParser.gfm.parse(gfmText);
rendered("GFM", gfm.toHtml());
const cell = gfm.tables[0].rows[0].cells[1];
console.log(`cell ${cell.text}: column ${cell.column}, ${cell.alignment}`);
const plain = MarkdownParser.commonMark.parse(gfmText);
console.log(`as CommonMark: tables ${plain.tables.length}, task items ${plain.taskListItems.length}`);
const tablesOnly = MarkdownParser.commonMark.withTables(true).parse(gfmText);
console.log(`tables alone: tables ${tablesOnly.tables.length}, task items ${tablesOnly.taskListItems.length}`);
const checked = gfm.taskListItems[0].withChecked(true);
console.log(`checked: ${shown(checked.taskListItems[0].asWritten)}`);

section("5. Footnotes");

const notes = MarkdownParser.gfm.parse("Lossless[^1], always.\n\n[^1]: Every byte.\n");
const reference = notes.footnoteReferences[0];
console.log(`reference ${reference.label} -> definition ${reference.definition.label}`);
rendered("html", notes.toHtml());
let renamed = notes.footnoteDefinitions[0].withLabel("bytes");
console.log(`definition renamed: reference finds ${renamed.footnoteReferences[0].definition?.label ?? "nothing"}`);
renamed = renamed.footnoteReferences[0].withLabel("bytes");
console.log(`reference renamed: reference finds ${renamed.footnoteReferences[0].definition?.label ?? "nothing"}`);
console.log(shown(renamed.asWritten));
try {
  notes.footnoteDefinitions[0].withLabel("two words");
  console.log("label 'two words': done");
} catch {
  console.log("label 'two words': throws");
}

section("6. Walk and transform");

const guide = "# Guide\n\nRead [this](start.md), [that][t], and [top](#top).\n\n## More\n\n[t]: api.md\n";
const guideDoc = parseMarkdown(guide);
// Every view inside the document, in order, each knowing its depth.
for (const view of guideDoc.descendants) {
  if (view instanceof Heading) {
    console.log(`depth ${view.depth}, heading ${view.level}: ${view.text}`);
  } else if (view instanceof Link) {
    console.log(`depth ${view.depth}, link ${view.text} -> ${view.destination.url}`);
  }
}
// Many edits, one new document: headings a level down, relative links absolute.
const base = "https://example.com/docs/";
const editor = guideDoc.editor();
for (const view of guideDoc.descendants) {
  if (view instanceof Heading) {
    editor.setLevel(view, view.level + 1);
  } else if (view instanceof Link && view.style === "inline" && !view.destination.url.startsWith("#")) {
    editor.setDestination(view, new LinkTarget(base + view.destination.url));
  } else if (view instanceof LinkReferenceDefinition) {
    editor.setDestination(view, new LinkTarget(base + view.destination.url));
  }
}
changes(guide, editor.toDocument().asWritten);
