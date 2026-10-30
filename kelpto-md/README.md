# kelpto-md

Lossless Markdown: parse, edit one part, and print the rest exactly as
written; render to HTML with raw HTML escaped by default.

```temper
let doc = parseMarkdown("# Old\n\nSee <b>this</b>.\n\n```py\nx = 1\n```\n");
doc.asWritten;               // the input, byte for byte
doc.headings[0].text;        // "Old"
doc.headings[0].withText("New").asWritten;  // "# New\n\nSee <b>this</b>.\n…"
(doc.codeBlocks[0].withInfo("python") orelse panic()).asWritten; // "…```python\n…"
doc.toHtml();                // "<h1>Old</h1>\n<p>See &lt;b&gt;this&lt;/b&gt;.</p>\n…"
new MarkdownRenderer().withRawHtmlTrusted().render(doc); // "…<p>See <b>this</b>.</p>…"
```

- **Typed views** say where each node may go: `DocumentChild`
  (`Heading`, `Paragraph`, `CodeBlock`, and `BlankLine`) and
  `ParagraphChild` (`Text`, `CodeSpan`, and `RawHtml`).
- **Raw HTML** is found by CommonMark's rules and handed to a
  `RawHtmlHandler` (opaque text by default), and rendered by a
  `RawHtmlRenderer` (escaped by default). The `kelpto` library fills
  both in with kelpto-html; kelpto-md never imports it.
- **Edits** give a new document, sharing what didn't change.

**A skeleton:** it understands ATX headings, paragraphs, blank lines,
fenced code blocks, text, backslash escapes, code spans, and raw inline
HTML. Everything else (lists, quotes, emphasis, links, and the rest)
reads as plain text for now, still printed back exactly.
