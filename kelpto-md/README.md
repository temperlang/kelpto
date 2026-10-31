# kelpto-md

Lossless Markdown: parse, edit one part, and print the rest exactly as
written; render to HTML with raw HTML escaped by default.

```temper
let doc = parseMarkdown("# Old\n\n> See <b>this</b>.\n\n- a\n- b\n\n[home]: /old\n");
doc.asWritten;               // the input, byte for byte
doc.headings[0].text;        // "Old"
doc.headings[0].withText("New").asWritten;     // "# New\n\n> See <b>this</b>.\n…"
(doc.headings[0].withLevel(2) orelse panic()).asWritten; // "## Old\n…"
(doc.linkReferenceDefinitions[0].withDestination(new LinkTarget("/new")) orelse panic())
  .asWritten;                // "…[home]: /new\n"
doc.toHtml();                // "<h1>Old</h1>\n<blockquote>\n<p>See &lt;b&gt;…"
new MarkdownRenderer().withRawHtmlTrusted().render(doc); // "…<p>See <b>this</b>.</p>…"
```

- **Blocks:** all of CommonMark's, by its two-phase algorithm: thematic
  breaks, ATX and setext headings, indented and fenced code, HTML
  blocks (all seven kinds), link reference definitions, paragraphs,
  blank lines, block quotes, and lists, tight and loose, with
  laziness and tabs as the spec has them. Every block section of the
  spec's examples passes, but for examples needing inlines below.
- **Lossless,** whatever the input: tabs stay tabs (columns are counted
  as the spec says), line endings stay `\n`, `\r\n`, or `\r`, and odd
  input stays as written. Checked on every spec example, changed ones,
  and random mixes of markers, tabs, and line endings.
- **Typed views** say where each node may go: `BlockChild` (`Heading`,
  `Paragraph`, `CodeBlock`, `IndentedCode`, `ThematicBreak`,
  `HtmlBlock`, `LinkReferenceDefinition`, `BlockQuote`, `ListBlock`,
  and `BlankLine`), `ListChild` (`ListItem` and `BlankLine`), and
  `ParagraphChild` (`Text`, `CodeSpan`, and `RawHtml`).
- **Edits** give a new document, changing only the edited span and
  sharing what didn't change: `Heading.withText` and `withLevel`,
  `CodeBlock.withInfo`, and `LinkReferenceDefinition.withDestination`.
- **Raw HTML,** inline and in HTML blocks, is found by CommonMark's
  rules and handed to a `RawHtmlHandler` (opaque text by default), and
  rendered by a `RawHtmlRenderer` (escaped by default). The `kelpto`
  library fills both in with kelpto-html; kelpto-md never imports it.

**Inlines, for now:** text, backslash escapes, code spans, and raw
inline HTML. Emphasis, links, images, autolinks, entity references,
and hard line breaks read as plain text, still printed back exactly.
They're next.
