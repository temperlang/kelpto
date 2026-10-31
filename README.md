# Kelpto (working name)

Lossless Markdown and a WHATWG HTML parser, written once in Temper, for
every language Temper supports. Parse a document, change one part, and
write it back with everything else exactly as it was. Render it safely,
with raw HTML parsed as browsers parse it and links checked by Hrefine.

**Status** (2026-10-31): all of CommonMark parses losslessly and
renders as every one of the spec's 652 examples expects; the HTML side
is still a small skeleton.
The design is in [docs/design.md](docs/design.md) and the plan in
[docs/plan.md](docs/plan.md).

| Library | What it is |
|---|---|
| [kelpto-core](kelpto-core/README.md) | The lossless red-green tree both parsers share. |
| [kelpto-md](kelpto-md/README.md) | Markdown: parse, edit, print exactly, and render. |
| [kelpto-html](kelpto-html/README.md) | HTML: tokenize, edit, and print exactly. |
| [kelpto](kelpto/README.md) | Both together: HTML inside Markdown, and safe rendering. |

kelpto-md never imports kelpto-html. It finds raw HTML by CommonMark's
rules and asks a `RawHtmlHandler` what goes inside, and a
`RawHtmlRenderer` how to render it; `kelpto` fills both in with
kelpto-html.

## Imagine using it

These run today, on every backend.

**Markdown alone,** in Temper:

```temper
let doc = parseMarkdown("# Old title\n\nSee <b>this</b>.\n\n```py\nx = 1\n```\n");
doc.headings[0].text;                       // "Old title"
doc.headings[0].withText("New title").asWritten; // "# New title\n\nSee <b>this</b>.\n…", the rest untouched
doc.toHtml();                               // "…<p>See &lt;b&gt;this&lt;/b&gt;.</p>…", raw HTML escaped
new MarkdownRenderer().withRawHtmlTrusted().render(doc); // "…<p>See <b>this</b>.</p>…"
```

**HTML alone:**

```temper
let a = tokenizeHtml("<a href=\"/old\" class=x>Go</a>").startTags[0];
a.name;                                     // "a"
(a.attribute("href") as Attribute orelse panic()).withValue("/new").asWritten;
                                            // "<a href=\"/new\" class=x>Go</a>"
```

**Together:**

```temper
let doc = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
htmlOf(doc.rawHtml[0]).startTags[0].name;   // "b": an HTML subtree in the Markdown tree
renderSafe(doc).html;                       // "<p>Hi <b>there</b>alert(1)</p>\n"
```

The same in **Python**:

```python
from kelpto_md import parse_markdown, MarkdownRenderer
from kelpto_html import tokenize_html
from kelpto import parse_markdown_with_html, html_of, render_safe

doc = parse_markdown("# Old title\n\nSee <b>this</b>.\n\n```py\nx = 1\n```\n")
doc.headings[0].with_text("New title").as_written
doc.code_blocks[0].with_info("python").as_written  # "…```python\n…"
doc.to_html()

a = tokenize_html('<a href="/old" class=x>Go</a>').start_tags[0]
[(x.name, x.value) for x in a.attributes]          # [("href", "/old"), ("class", "x")]
a.attribute("href").with_value("/new").as_written

both = parse_markdown_with_html("Hi <b class=x>there</b><script>alert(1)</script>")
render_safe(both).html                             # "<p>Hi <b>there</b>alert(1)</p>\n"
```

And **JavaScript**:

```js
import { parseMarkdown, MarkdownRenderer } from "kelpto-md";
import { tokenizeHtml } from "kelpto-html";
import { parseMarkdownWithHtml, htmlOf, renderSafe } from "kelpto";

const doc = parseMarkdown("# Old title\n\nSee <b>this</b>.\n");
doc.headings[0].withText("New title").asWritten;
new MarkdownRenderer().withRawHtmlTrusted().render(doc);

const a = tokenizeHtml('<a href="/old" class=x>Go</a>').startTags[0];
a.attribute("href").withValue("/new").asWritten;  // '<a href="/new" class=x>Go</a>'

const both = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
htmlOf(both.rawHtml[0]).startTags[0].name;        // "b"
renderSafe(both).html;
```

`renderSafe` is a sketch, not a sanitizer yet; see
[kelpto/README.md](kelpto/README.md).

## Tests and licensing

Each library has its own tests. kelpto-md's tests against CommonMark's
spec examples are in [tests/commonmark](tests/commonmark/README.md), a
test-only library, since the examples are CC-BY-SA 4.0; see
[NOTICE](NOTICE). `scripts/commonmark_spec.py` (run with `uv run`)
regenerates them.

## Building

One Temper worktree with a library in each directory; run `temper test`
at the top. Libraries import each other by path, as
`import("../kelpto-core")`.

## License

Apache-2.0 OR MIT, at your option, as Temper is; see [COPYRIGHT](COPYRIGHT). Third-party material, with its notices, is in [NOTICE](NOTICE). The CommonMark spec examples in [tests/commonmark](tests/commonmark/README.md) stay under CC-BY-SA 4.0, apart from the libraries' code, and aren't published.
