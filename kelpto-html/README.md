# kelpto-html

Lossless HTML: tokenize, edit one part, and print the rest exactly as
written.

```temper
let tokens = tokenizeHtml("<A HREF='/old' class=x>Go</a>");
let a = tokens.startTags[0];
a.name;                          // "a" (lowercased, as HTML compares)
a.attributes[0].value;           // "/old"
let href = a.attribute("href") as Attribute orelse panic();
href.withValue("/new").asWritten; // "<A HREF=\"/new\" class=x>Go</a>"
```

- **Typed views:** `StartTag` (name, attributes, and self-closing),
  `EndTag`, `Comment`, `Text`, and `Attribute`. `Element` is saved for
  the tree a browser builds, which comes later.
- **Anything not understood stays text,** so any input prints back
  exactly.

**A skeleton:** a simplified tokenizer for start tags, end tags,
comments, and text. Not yet: character references, DOCTYPEs, raw text
elements such as `<script>`, the WHATWG tree construction, and a
sanitizer.
