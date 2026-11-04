# kelpto

kelpto-md and kelpto-html together, so neither imports the other:

- **`parseMarkdownWithHtml`** parses raw HTML in Markdown, inline and
  HTML blocks, with kelpto-html, as subtrees of the same lossless tree.
- **`htmlOf`** views a `RawHtml` node or `HtmlBlock` through
  kelpto-html's types.
- **`buildHtml`** builds the one tree a browser builds from the
  rendered document, Markdown and raw HTML together (a `<b>` left open
  in one paragraph, a `<textarea>` swallowing what follows), exactly
  as parsing the rendered HTML does, with each node pointing back at
  its raw start tag (`Element.startTag`) or Markdown node
  (`markdownNodeOf`). `fragmentOf` parses one piece alone, cheaper.
- **`renderSafe`** renders Markdown keeping only a few allowlisted
  elements, without attributes, as `SafeHtml`.

```temper
let doc = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
doc.asWritten;                             // the input, byte for byte
htmlOf(doc.rawHtml[0]).startTags[0].name;  // "b"
renderSafe(doc).html;                      // "<p>Hi <b>there</b>alert(1)</p>\n"

let open = buildHtml(parseMarkdownWithHtml("a <b>bold\n\nstill bold</b>"));
open.html;                                 // "<p>a <b>bold</b></p><b>\n</b><p><b>still bold</b></p>\n"
```

**`renderSafe` is a sketch, not a sanitizer;** don't rely on it yet.
It judges each tag alone, not the tree a browser builds, and checks no
URLs. The real one sanitizes the built HTML tree.
