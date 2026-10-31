# kelpto-md

Lossless Markdown: parse, edit one part, and print the rest exactly as
written; render to HTML with raw HTML escaped by default.

```temper
let doc = parseMarkdown("# Old\n\n> See <b>this</b>.\n\n- a\n- *b* [home]\n\n[home]: /old\n");
doc.asWritten;               // the input, byte for byte
doc.headings[0].text;        // "Old"
doc.headings[0].withText("New").asWritten;     // "# New\n\n> See <b>this</b>.\n…"
(doc.headings[0].withLevel(2) orelse panic()).asWritten; // "## Old\n…"
(doc.linkReferenceDefinitions[0].withDestination(new LinkTarget("/new")) orelse panic())
  .asWritten;                // "…[home]: /new\n"
doc.toHtml();                // "<h1>Old</h1>\n<blockquote>\n<p>See &lt;b&gt;…"
                             // "…<li><em>b</em> <a href=\"/old\">home</a></li>…"
new MarkdownRenderer().withRawHtmlTrusted().render(doc); // "…<p>See <b>this</b>.</p>…"
```

- **All of CommonMark 0.31.2,** by its two-phase algorithm: every
  block, and every inline (emphasis and strong emphasis, links and
  images, inline and by reference, autolinks, code spans, raw HTML,
  character references, backslash escapes, and hard and soft line
  breaks). All 652 of the spec's examples pass, and parsing stays
  linear on cmark's pathological inputs.
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
  `Strong`, `Link`, `Image`, `Autolink`, `HardBreak`, and
  `CharacterReference`), and `LinkTextChild`, all of those but `Link`,
  since links can't nest. Links know their `style`, `label`,
  `destination`, and `title`, resolving references through the
  document's definitions; `normalizeLabel` matches labels as the spec
  does, with full Unicode case folding.
- **Edits** give a new document, changing only the edited span and
  sharing what didn't change: `Heading.withText` and `withLevel`,
  `CodeBlock.withInfo`, and `withDestination` on
  `LinkReferenceDefinition`, and on inline `Link` and `Image`.
- **Raw HTML,** inline and in HTML blocks, is found by CommonMark's
  rules and handed to a `RawHtmlHandler` (opaque text by default), and
  rendered by a `RawHtmlRenderer` (escaped by default). The `kelpto`
  library fills both in with kelpto-html; kelpto-md never imports it.
- **Destinations stay as written** in the tree, as a `LinkTarget`
  (escapes and character references resolved, nothing else); the
  renderer percent-encodes them only as it writes `href` and `src`.
