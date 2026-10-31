# Markdown and HTML together

kelpto-md finds raw HTML and asks a `RawHtmlHandler` what goes in it;
kelpto-html tokenizes HTML. This library joins them, so neither needs
the other:

- **Parsing:** `ParsedRawHtml` fills in kelpto-md's `RawHtmlHandler`
  with kelpto-html, so each raw HTML span and HTML block in a Markdown
  document holds an HTML subtree, in the same green tree, still
  lossless.
- **Rendering:** `renderSafe` fills in kelpto-md's `RawHtmlRenderer`,
  keeping only a few allowlisted elements.

```temper inert
let doc = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
htmlOf(doc.rawHtml[0]).startTags[0].name; // "b", through kelpto-html's views
renderSafe(doc).html;                     // "<p>Hi <b>there</b>alert(1)</p>\n"
```

    let { GreenElement, RedNode, escapeHtml } = import("../kelpto-core");
    let {
      MarkdownDocument, MarkdownRenderer, RawHtmlContent, RawHtmlHandler, RawHtmlRenderer,
      parseMarkdown,
    } = import("../kelpto-md");
    let {
      Attribute, Comment, EndTag, HtmlTokens, StartTag, Text, htmlTokensKind, tokenizeHtml,
      tokenizeHtmlGreen,
    } = import("../kelpto-html");

## Parsing

The handler that parses raw HTML with kelpto-html: each raw HTML node
gets one `HtmlTokens` subtree.

    export class ParsedRawHtml extends RawHtmlHandler {
      public constructor() {}
      public parseRawHtml(html: String): List<GreenElement> {
        // Typed first: C++ and Rust type `[subtype]` as a list of the
        // subtype, not the declared `List<GreenElement>` (2026-10-30).
        let tokens: GreenElement = tokenizeHtmlGreen(html);
        [tokens]
      }
    }

Parses `text` as Markdown, with raw HTML parsed as HTML.

    export let parseMarkdownWithHtml(text: String): MarkdownDocument {
      parseMarkdown(text, new ParsedRawHtml())
    }

The HTML in `rawHtml`, inline or an HTML block, through kelpto-html's
views: its subtree if parsed with `parseMarkdownWithHtml`, or else
tokenized now.

    export let htmlOf(rawHtml: RawHtmlContent): HtmlTokens {
      let node = rawHtml.htmlNode;
      if (node != null) {
        if (node.hasKind(htmlTokensKind)) { return new HtmlTokens(node); }
      }
      tokenizeHtml(rawHtml.html)
    }

## Rendering

**A sketch, not a sanitizer.** HTML the renderer made from Markdown
and checked, as a type of its own, so code can ask for it by type
rather than trusting any string.

    export class SafeHtml {
      public html: String;
      private constructor(html: String) { this.html = html; }
      public toString(): String { html }
    }

Renders `doc` to HTML, keeping only the start and end tags of a few
inline elements (`b`, `i`, `em`, `strong`, and `code`), without their
attributes, and dropping all other raw HTML. Text stays escaped.

**This is a sketch, not a real sanitizer, so don't rely on it yet.**
It judges each raw HTML tag alone, not the tree a browser would
build, so the text between `<script>` and `</script>` stays (escaped,
as harmless text), unbalanced tags pass through, and Markdown's own
links aren't checked yet, so `[x](javascript:alert(1))` stays a live
link. The real one sanitizes the built HTML tree, with
an allowlist of elements and attributes and every URL checked.

    export let renderSafe(doc: MarkdownDocument): SafeHtml {
      new SafeHtml(new MarkdownRenderer(new AllowlistRawHtml()).render(doc))
    }

    let allowedElements = ["b", "i", "em", "strong", "code"];

    let isAllowed(name: String): Boolean {
      for (var i = 0; i < allowedElements.length; i += 1) {
        if (allowedElements[i] == name) { return true; }
      }
      false
    }

    class AllowlistRawHtml extends RawHtmlRenderer {
      public constructor() {}

      public renderRawHtml(rawHtml: RawHtmlContent): String {
        let out = new StringBuilder();
        let tokens = htmlOf(rawHtml).children;
        for (var i = 0; i < tokens.length; i += 1) {
          let token = tokens[i];
          when (token) {
            is StartTag -> if (isAllowed(token.name)) { out.append("<${token.name}>"); };
            is EndTag -> if (isAllowed(token.name)) { out.append("</${token.name}>"); };
            is Text -> out.append(escapeHtml(token.text));
            is Comment -> do {};
          }
        }
        out.toString()
      }
    }

## Tests

    let roundtripCases(): List<String> {
      [
        "", "Hi <b class=x>there</b>", "<a href='x' title=\"y\" data-z=w>",
        "<!-- comment --> <!--> <!--->", "a <b\nclass=x>", "`<b>` <i>x</i>",
        "# Heading <em>x</em> #\n\n```\n<b>not html</b>\n```\n",
      ]
    }

    test("roundtrip with HTML subtrees") {
      let cases = roundtripCases();
      for (var i = 0; i < cases.length; i += 1) {
        let text = cases[i];
        let written = parseMarkdownWithHtml(text).asWritten;
        assert(written == text) { "${i.toString()}: ${written}" };
      }
    }

    test("raw HTML becomes HTML nodes in the same tree") {
      let doc = parseMarkdownWithHtml("Hi <b class=x>there</b>");
      let raws = doc.rawHtml;
      assert(raws.length == 2) { raws.length.toString() };
      let node = raws[0].htmlNode as RedNode orelse panic();
      assert(node.kind.name == "HtmlTokens") { node.kind.name };
      assert(node.root.kind.name == "Document") { "one tree, Markdown at the top" };
      let b = htmlOf(raws[0]).startTags[0];
      assert(b.name == "b") { b.name };
      assert((b.attribute("class") as Attribute orelse panic()).value == "x") { "attribute" };
      assert(b.span.toString() == "3+11") { b.span.toString() };
      let plain = parseMarkdown("Hi <b class=x>there</b>").rawHtml;
      assert(plain[0].htmlNode == null) { "kelpto-md alone keeps it opaque" };
      assert(htmlOf(plain[0]).startTags[0].name == "b") { "tokenized on demand" };
    }

An edit through kelpto-html's views, inside a Markdown document.

    test("editing HTML inside Markdown") {
      let doc = parseMarkdownWithHtml("# Title\n\nSee <code lang=py>x</code>.\n");
      let code = htmlOf(doc.rawHtml[0]).startTags[0];
      let top = (code.attribute("lang") as Attribute orelse panic()).withValue("rust");
      let edited = new MarkdownDocument(top.node);
      assert(edited.asWritten == "# Title\n\nSee <code lang=\"rust\">x</code>.\n") { edited.asWritten };
      assert(edited.headings[0].text == "Title") { "still a Markdown document" };
    }

    test("renderSafe keeps allowlisted elements and drops the rest") {
      let doc = parseMarkdownWithHtml(
        "Hi <b onclick=\"x()\">there</b><script>alert(1)</script> <em>ok</em> <img src=x onerror=alert(1)><!-- c -->",
      );
      let html = renderSafe(doc).html;
      assert(html == "<p>Hi <b>there</b>alert(1) <em>ok</em> </p>\n") { html };
      let fromPlain = renderSafe(parseMarkdown("<i>x</i><script>")).html;
      assert(fromPlain == "<p><i>x</i></p>\n") { fromPlain };
    }

HTML blocks get HTML subtrees too, unless container prefixes split
their lines.

    test("HTML blocks become HTML nodes") {
      let doc = parseMarkdownWithHtml("<div class=x>\n<b>hi</b>\n</div>\n\n> <p>\n> quoted\n");
      assert(doc.asWritten == "<div class=x>\n<b>hi</b>\n</div>\n\n> <p>\n> quoted\n") { "roundtrip" };
      let blocks = doc.htmlBlocks;
      assert(blocks.length == 2) { blocks.length.toString() };
      let div = htmlOf(blocks[0]).startTags[0];
      assert(div.name == "div" && blocks[0].htmlNode != null) { div.name };
      assert(blocks[1].htmlNode == null) { "split by `>`, so opaque" };
      assert(htmlOf(blocks[1]).startTags[0].name == "p") { "tokenized on demand" };
      let html = renderSafe(doc).html;
      assert(html == "\n<b>hi</b>\n\n<blockquote>\n\nquoted\n</blockquote>\n") { html };
    }
