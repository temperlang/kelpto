# kelpto-md

Lossless Markdown: parse, edit one part, and print the rest exactly as
written; render to HTML with raw HTML escaped by default.

```temper
let doc = parseMarkdown("# Old\n\n> See <b>this</b>.\n\n- a\n- *b* [home]\n\n[home]: /old\n");
doc.asWritten;               // the input, byte for byte
doc.headings[0].text;        // "Old"
doc.links[0].destination?.url; // "/old", from its definition
doc.headings[0].withText("New").asWritten;     // "# New\n\n> See <b>this</b>.\n…"
(doc.headings[0].withLevel(2) orelse panic()).asWritten; // "## Old\n…"
(doc.linkReferenceDefinitions[0].withDestination(new LinkTarget("/new")) orelse panic())
  .asWritten;                // "…[home]: /new\n"
doc.toHtml();                // "<h1>Old</h1>\n<blockquote>\n<p>See &lt;b&gt;…"
                             // "…<li><em>b</em> <a href=\"/old\">home</a></li>…"
new MarkdownRenderer().withRawHtmlTrusted().render(doc); // "…<p>See <b>this</b>.</p>…"

let gfm = MarkdownParser.gfm.parse("| a | b |\n|:--|--:|\n| ~~x~~ | www.example.com |\n\n- [ ] todo\n");
let cell = gfm.tables[0].rows[0].cells[1];
cell.alignment;                  // "right"
cell.withText("a|b").asWritten;  // "…| ~~x~~ | a\\|b |\n…"
gfm.taskListItems[0].withChecked(true).asWritten; // "…- [x] todo\n"
new MarkdownRenderer().withRawHtmlTrusted().withDisallowedRawHtmlFiltered().render(gfm);
                                 // GFM's own HTML: "<table>\n<thead>…<del>x</del>…"
MarkdownParser.commonMark.withTables(true).parse("| a |\n| - |\n"); // one extension

let notes = MarkdownParser.gfm.parse("Hi[^n].\n\n[^n]: A note.\n");
notes.footnoteReferences[0].definition?.label;   // "n"
notes.toHtml();   // "<p>Hi<sup class=\"footnote-ref\"><a href=\"#fn-n\" …>1</a></sup>.</p>\n<section …"
```

- **All of CommonMark 0.31.2,** by its two-phase algorithm: every
  block, and every inline (emphasis and strong emphasis, links and
  images, inline and by reference, autolinks, code spans, raw HTML,
  character references, backslash escapes, and hard and soft line
  breaks). All 652 of the spec's examples pass, and parsing stays
  linear on cmark's pathological inputs, deep block nesting
  included (see [Speed](#speed)).
- **GitHub Flavored Markdown's extensions,** opt-in, from
  `MarkdownParser.gfm` or one at a time from `MarkdownParser.commonMark`
  (`withTables`, `withTaskListItems`, `withStrikethrough`,
  `withExtendedAutolinks`, and `withFootnotes`): every example in GFM's
  spec and cmark-gfm's extension and regression tests renders as
  cmark-gfm renders it, linear on its pathological inputs too.
  Footnotes render as GitHub's do: numbered by first reference, in a
  section at the end, with backlinks. That includes cmark-gfm's one change to
  CommonMark's HTML: in a GFM document, a strong directly inside a
  strong adds no tags (`****foo****` is one `<strong>`), though the
  tree keeps both. There, too, `![^` is never an image. Off, parsing
  and rendering are CommonMark's, at the same cost. GFM's filter for
  disallowed raw HTML is on rendering: `withDisallowedRawHtmlFiltered()`.
  Where it differs from cmark-gfm on purpose, see
  [Differences from cmark-gfm](#differences-from-cmark-gfm).
- **Lossless,** whatever the input: tabs stay tabs (columns are counted
  as the spec says), line endings stay `\n`, `\r\n`, or `\r`, and odd
  input stays as written. Inlines keep their markup too: delimiter
  runs, brackets, destinations, titles, and labels are tokens, and a
  character reference keeps its text, with its value a view. Checked
  on every spec example, changed ones, and random mixes of block and
  inline markup, tabs, and line endings.
- **Typed views** say where each node may go: `BlockChild` (`Heading`,
  `Paragraph`, `CodeBlock`, `IndentedCode`, `ThematicBreak`,
  `HtmlBlock`, `LinkReferenceDefinition`, `BlockQuote`, `ListBlock`,
  and `BlankLine`), `ListChild` (`ListItem` and `BlankLine`), and
  `ParagraphChild` (`Text`, `CodeSpan`, `RawHtml`, `Emphasis`,
  `Strong`, `Strikethrough`, `Link`, `Image`, `Autolink`, `HardBreak`,
  and `CharacterReference`), and `LinkTextChild`, all of those but
  `Link`, since links can't nest. GFM's `Table` is a block, with a
  `header` and `rows` of `TableCell`s, each with its `alignment`;
  `ListItem.task` gives a `TaskListItem` (`checked`); and `Autolink`'s
  `style` is `"angle"`, or `"url"`, `"www"`, or `"email"` for extended
  ones. `FootnoteDefinition` is a block holding blocks, and
  `FootnoteReference` an inline, with its `label` and `definition`.
  Table pipes, delimiter rows, `~` runs, and task markers are
  tokens, so GFM stays lossless too. Links know their `style`, `label`,
  `destination`, and `title`, resolving references through the
  document's definitions, and a document's `links` lists them all, in
  order, wherever they are; `normalizeLabel` matches labels as the spec
  does, with full Unicode case folding.
- **Edits** give a new document, changing only the edited span and
  sharing what didn't change: `Heading.withText` and `withLevel`,
  `CodeBlock.withInfo`, `withDestination` on
  `LinkReferenceDefinition`, and on inline `Link` and `Image`,
  `TableCell.withText`, `TaskListItem.withChecked`, and `withLabel` on
  footnote definitions and references.
- **Building from scratch:** `MarkdownBuilder` and `Inlines` write a
  document from plain strings, escaped so they read back as written.
  See [Building from scratch](#building-from-scratch).
- **Walking and batch edits:** every view has `descendants` (all the
  views inside it, in document order), `parent`, and `depth`; a
  document's `editor()` collects edits to many nodes and builds one new
  document from them. See [Walking and transforming](#walking-and-transforming).
- **Raw HTML,** inline and in HTML blocks, is found by CommonMark's
  rules and handed to a `RawHtmlHandler` (opaque text by default), and
  rendered by a `RawHtmlRenderer` (escaped by default). The `kelpto`
  library fills both in with kelpto-html; kelpto-md never imports it.
- **Destinations stay as written** in the tree, as a `LinkTarget`
  (escapes and character references resolved, nothing else); the
  renderer percent-encodes them only as it writes `href` and `src`.

## Building from scratch

`MarkdownBuilder` writes a new document from plain strings, escaping
them so they read back as written, whatever they hold: a `#` or `1.`
at a line's start, `*`, `<b>`, or a backslash. `Inlines` is a
heading's or paragraph's content: a value, from `Inlines.empty`, with
each method giving new content, so calls chain.

```temper
let b = new MarkdownBuilder();
b.heading(2, Inlines.empty.text("Report for <Ana> #1")) orelse panic();
b.paragraph(Inlines.empty.text("Said: ").emphasis(Inlines.empty.text("*really*"))
  .text(" see ").link(Inlines.empty.text("the [docs]"), new LinkTarget("docs/read me.md")));
let item = new MarkdownBuilder();
item.paragraph(Inlines.empty.text("1. first, `x`"));
b.bulletList([item]);
b.toMarkdown();
  // "## Report for \\<Ana> #1\n\nSaid: *\\*really\\** see [the \\[docs\\]](<docs/read me.md>)\n\n- 1\\. first, \\`x\\`\n"
b.toDocument().links[0].text;   // "the [docs]"
```

Blocks: `heading`, `paragraph`, `codeBlock(info, code)` (its fence
longer than any in the code), `thematicBreak`, `blockQuote`,
`bulletList`, and `orderedList(start, items)`, the containers taking
other builders. Inlines: `text`, `code`, `emphasis`, `strong`,
`link(content, target, title)`, `image(alt, target, title)`, and
`lineBreak`; titles are optional. Line breaks in text become spaces
(`lineBreak()` makes a real one). What Markdown can't hold is left
out: empty emphasis and code spans, a break ending a paragraph, and a
link inside a link, which keeps only its text. The Markdown reads the
same in CommonMark and GFM. Emphasis directly or indirectly inside
emphasis of its own kind (`<em>` in `<em>`) can, rarely, read back
otherwise when punctuation or markup is at its edges; the builder
checks and retries, but CommonMark can't always say it. Tables and
task list items are still to come.

## Speed

kelpto-md is slower than each language's usual parsers, since it keeps
every byte and isn't tuned yet: on the CommonMark spec, 1.7 times
flexmark's time in Java, 7 to 16 times that of cmark,
commonmark-java, commonmark.js, markdown-it, markdown-it-py, and
mistune, 30 to 33 times that of comrak and Markdig, and 104 times
pulldown-cmark's (2026-11-02). It parses at about 8 MB/s in C++, 2 MB/s
in C#, Java, JavaScript, and Rust, and 0.3 MB/s in Python and Lua.
Walking every view and printing back, or a batch of edits, costs
little more than parsing. See [docs/benchmarks.md](../docs/benchmarks.md)
for the numbers, ranges, and reasons, and `bench/` to run them. A
first tuning made parsing 1.2 to 1.4 times faster, and deep block
nesting linear (7 to 15 times faster at hundreds of levels).

## Walking and transforming

`descendants` is every view inside a node, each before what it holds,
as one flat list: blocks, list items, table rows and cells, and
inlines. Filter it with a type test, as you would any list. An
editor takes edits to views of one document (`setText`, `setLevel`,
`setInfo`, `setDestination`, `setChecked`, and `setLabel`, as the
views' `with…` edits), and `toDocument()` makes them all in one pass,
copying each changed path once and leaving every other byte as
written. Edits that overlap, such as two to one heading, bubble.

```temper
let doc = parseMarkdown("# Guide\n\nRead [this](start.md) and [that][t].\n\n[t]: /api\n");
let editor = doc.editor();
let all = doc.descendants;
for (var i = 0; i < all.length; i += 1) {
  let view = all[i];
  when (view) {
    is Heading -> editor.setLevel(view, view.level + 1) orelse panic();
    is Link -> if (view.style == "inline") {
      editor.setDestination(view, new LinkTarget("https://x.test/${view.destination?.url ?? ""}")) orelse panic();
    };
    is LinkReferenceDefinition -> editor.setDestination(view, new LinkTarget("https://x.test${view.destination.url}")) orelse panic();
    else -> do {};
  }
}
(editor.toDocument() orelse panic()).asWritten;
  // "## Guide\n\nRead [this](https://x.test/start.md) and [that][t].\n\n[t]: https://x.test/api\n"
```

In Python, the same walk is a loop with `isinstance`:

```python
toc = [(v.level, v.text) for v in doc.descendants if isinstance(v, Heading)]
urls = [v.destination.url for v in doc.descendants if isinstance(v, Link) and v.destination]
```

Worked examples, a table of contents with every link destination, and
the transform above checked to change only what it should, run on the
CommonMark spec and some READMEs in
[tests/samples](../tests/samples/README.md).

## Differences from cmark-gfm

kelpto-md follows CommonMark 0.31.2, and in GFM documents renders as
cmark-gfm (0.29.0.gfm.13) does, with these deliberate differences:

- **Links don't nest.** After a link, cmark-gfm makes earlier `[`
  openers active again, so `[a [b](/c) [d] e](/f)` is a link inside a
  link (invalid HTML). kelpto-md keeps CommonMark's rule, which its
  typed views rely on.
- **Raw HTML keeps its line endings** (`\r\n` and `\r`) as written,
  where cmark-gfm writes `\n`, in CommonMark documents too.
- **Task list items** also work inside block quotes and on a nested
  item's first line, where cmark-gfm misses them.
- **Footnote references** need their `^` written as is (not `\^` or
  `&#94;`) and can't span a line break; cmark-gfm garbles or drops the
  text there.
- **CommonMark 0.31.2, not 0.29:** where the spec changed since
  cmark-gfm's base, kelpto-md follows the newer spec (for example, a
  link definition's title on the next line followed by other text).
- **`~~` beside emphasis:** `*~~ a \**` is emphasis in kelpto-md, as
  CommonMark's delimiter rules give, where cmark-gfm leaves plain text.

Known bugs, to be fixed (see the roadmap in docs/design.md): a `\|` at
the end of an extended autolink in a table cell stays in the link, and
a paragraph that is only a link definition directly before a table is
read as a definition, where cmark-gfm keeps it as text.
