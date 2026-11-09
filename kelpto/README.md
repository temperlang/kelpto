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
- **`renderSafe`** renders Markdown for a page, safe for Markdown from
  anyone: the tree `buildHtml` builds, sanitized by kelpto-html's
  `SanitizerPolicy` (by default, what Markdown and GFM render and
  common formatting, with `http`, `https`, `mailto`, and relative
  URLs; `SanitizerPolicy.github` keeps GitHub's presentational
  attributes too), as `SafeHtml`, whose `removals` say what went and
  point back at the raw start tag or Markdown node it came from. Pass
  a `MarkdownRenderer` for GitHub's heading ids, alerts, or code
  highlighting, which the sanitizer judges like the rest.

```temper
let doc = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
doc.asWritten;                             // the input, byte for byte
htmlOf(doc.rawHtml[0]).startTags[0].name;  // "b"
renderSafe(doc).html;                      // "<p>Hi <b class=\"x\">there</b></p>\n"
renderSafe(parseMarkdownWithHtml("[x](JavaScript:alert(1))")).html; // "<p><a>x</a></p>\n"
renderSafe(doc).removals[0].kind;          // "element": the script

let github = new MarkdownRenderer().withRawHtmlTrusted().withHeadingIds().withAlerts();
let page = MarkdownParser.gfm.withRawHtmlHandler(new ParsedRawHtml()).parse("# Hi <i>you</i>\n\n> [!TIP]\n> Look.\n");
renderSafe(page, SanitizerPolicy.github, new FragmentContext("body"), github).html;
  // "<h1 id=\"hi-you\">Hi <i>you</i></h1>\n<div class=\"markdown-alert markdown-alert-tip\">…"

let open = buildHtml(parseMarkdownWithHtml("a <b>bold\n\nstill bold</b>"));
open.html;                                 // "<p>a <b>bold</b></p><b>\n</b><p><b>still bold</b></p>\n"
```

Since it judges the built tree, not each tag, pieces that only do
harm together are caught: a `<textarea>` or `<plaintext>` swallowing
the Markdown after it, a comment left open, foster parenting, or an
attribute value spanning paragraphs. What it gives is checked to
parse back to itself, against mutation XSS. Links are checked by
scheme for now; Hrefine would plug in as a `UrlCheck` (see
`sanitize.temper.md` in kelpto-html).
