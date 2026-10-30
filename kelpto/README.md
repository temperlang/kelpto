# kelpto

kelpto-md and kelpto-html together, so neither imports the other:

- **`parseMarkdownWithHtml`** parses raw HTML in Markdown with
  kelpto-html, as subtrees of the same lossless tree.
- **`htmlOf`** views a `RawHtml` node through kelpto-html's types.
- **`renderSafe`** renders Markdown keeping only a few allowlisted
  elements, without attributes, as `SafeHtml`.

```temper
let doc = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
doc.asWritten;                             // the input, byte for byte
htmlOf(doc.rawHtml[0]).startTags[0].name;  // "b"
renderSafe(doc).html;                      // "<p>Hi <b>there</b>alert(1)</p>\n"
```

**`renderSafe` is a sketch, not a sanitizer;** don't rely on it yet.
It judges each tag alone, not the tree a browser builds, and checks no
URLs. The real one sanitizes the built HTML tree.
