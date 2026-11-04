# Markdown and HTML together

kelpto-md finds raw HTML and asks a `RawHtmlHandler` what goes in it;
kelpto-html tokenizes HTML. This library joins them, so neither needs
the other:

- **Parsing:** `ParsedRawHtml` fills in kelpto-md's `RawHtmlHandler`
  with kelpto-html, so each raw HTML span and HTML block in a Markdown
  document holds an HTML subtree, in the same green tree, still
  lossless.
- **Rendering safely:** `renderSafe` sanitizes the tree a browser
  builds from the rendering, raw HTML and Markdown together.

```temper inert
let doc = parseMarkdownWithHtml("Hi <b class=x>there</b><script>alert(1)</script>");
htmlOf(doc.rawHtml[0]).startTags[0].name; // "b", through kelpto-html's views
renderSafe(doc).html;                     // "<p>Hi <b class=\"x\">there</b></p>\n"
```

    let { GreenElement, RedNode } = import("../kelpto-core");
    let {
      Emphasis, HtmlBlock, MarkdownDocument, MarkdownNode, MarkdownParser, MarkdownRenderer, Paragraph,
      RawHtml, RawHtmlContent, RawHtmlHandler, RenderSink,
      parseMarkdown, viewOf,
    } = import("../kelpto-md");
    let {
      Attribute, BuiltComment, BuiltNode, BuiltText, Element, FragmentContext, FragmentStream, HtmlFragment,
      HtmlTokens, SafeHtml, SanitizerPolicy, StartTag, UrlCheck, htmlTokensKind, parseHtmlFragment, tokenizeHtml, tokenizeHtmlGreen,
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

## The tree a browser builds

What a browser builds from a document's HTML, Markdown and raw HTML
together, as one tree: one fragment parse, as `innerHTML` parses, of
what the renderer gives, with raw HTML trusted (passed through as
written) unless `renderer` says otherwise. So the pieces interact as
in a browser: `<b>` in one paragraph and `</b>` in the next, a
`<div>` in one HTML block closed in another, a `<table>` foster
parenting the Markdown after it, or a `<textarea>` left open reading
the rest as text. The tree is exactly what `parseHtmlFragment` gives
for the rendered HTML, but each node points back where it came from:
an element written as raw HTML at its start tag in the Markdown tree
(`Element.startTag`), and anything Markdown made at its Markdown node
(`markdownNodeOf`). Built when asked, so parsing and rendering cost
nothing more when nobody asks.

```temper inert
let doc = parseMarkdownWithHtml("<div class=note>\n\n*Hi* <b>there\n\n</div>\n");
let built = buildHtml(doc);
built.html;   // "<div class=\"note\">\n<p><em>Hi</em> <b>there</b></p>\n</div>\n"
let div = built.children[0] as Element;
div.startTag?.asWritten;                  // "<div class=note>", in doc's tree
markdownNodeOf(div.children[1]);          // the Paragraph
```

    export let buildHtml(
      doc: MarkdownDocument,
      context: FragmentContext = new FragmentContext("body"),
      renderer: MarkdownRenderer = new MarkdownRenderer().withRawHtmlTrusted(),
    ): BuiltHtml {
      let stream = new FragmentStream(context);
      renderer.renderTo(doc, new StreamRenderSink(stream));
      stream.end();
      new BuiltHtml(doc, stream)
    }

The built tree: its nodes, as `HtmlFragment.children`, and the
standard's serialization of them.

    export class BuiltHtml {
      public document: MarkdownDocument;
      private stream: FragmentStream;
      public constructor(document: MarkdownDocument, stream: FragmentStream) {
        this.document = document;
        this.stream = stream;
      }
      public get context(): FragmentContext { stream.context }
      public get children(): List<BuiltNode> { stream.children }
      public get html(): String { stream.html }

The tree sanitized by `policy`, as `renderSafe` gives it.

      public sanitize(policy: SanitizerPolicy = SanitizerPolicy.standard): SafeHtml { stream.sanitize(policy) }
    }

The Markdown node a built node came from: the one that rendered it,
or the `RawHtml` or `HtmlBlock` it was written in. Null for an element
the standard implies (such as `<tbody>`) and for nodes of plain HTML.

    export let markdownNodeOf(node: BuiltNode): MarkdownNode? {
      let origin = node.origin;
      if (origin == null) { return null; }
      var red = origin as RedNode orelse panic();
      while (isHtmlKind(red)) {
        let up = red.parent;
        if (up == null) { return null; }
        red = up as RedNode orelse panic();
      }
      viewOf(red)
    }

kelpto-html's kinds take ids 200 to 299.

    let isHtmlKind(red: RedNode): Boolean {
      let id = red.green.kind.id;
      id >= 200 && id < 300
    }

One raw HTML piece parsed alone, as a fragment in its Markdown
parent: `p` for inline HTML, `body` for an HTML block. Cheaper than
`buildHtml`, and right for most pieces, but it can't see what other
pieces open or close, so judge the whole document by `buildHtml`.

    export let fragmentOf(rawHtml: RawHtmlContent): HtmlFragment {
      parseHtmlFragment(rawHtml.html, new FragmentContext(if (rawHtml.isBlock) { "body" } else { "p" }))
    }

What the renderer writes, as tokens for the stream: tags without
attributes and text as synthetic tokens, tags with them written, and
raw HTML as written, pointing at its tokens in the Markdown tree when
it was parsed with `parseMarkdownWithHtml` and rendered as written.

    class StreamRenderSink extends RenderSink {
      private stream: FragmentStream;

      // Counted only so each method writes a field: Temper's C++
      // backend makes methods that don't `const`, and then they don't
      // override `RenderSink`'s, which aren't (notes/temper-fixes.md).
      private var parts: Int = 0;

      public constructor(stream: FragmentStream) { this.stream = stream; }

      public startTag(name: String, written: String, node: MarkdownNode): Void {
        parts += 1;
        if (written == "<${name}>") {
          stream.startTag(name, false, node.node);
        } else if (written == "<${name} />") {
          stream.startTag(name, true, node.node);
        } else {
          stream.write(written, node.node);
        }
      }

      public endTag(name: String, node: MarkdownNode): Void {
        parts += 1;
        stream.endTag(name, node.node);
      }

      public characters(text: String, node: MarkdownNode): Void {
        parts += 1;
        stream.characters(text, node.node);
      }

      public rawHtml(content: RawHtmlContent, rendered: String, node: MarkdownNode): Void {
        parts += 1;
        let tokens = content.htmlNode;
        if (tokens != null) {
          if (tokens.hasKind(htmlTokensKind) && rendered == content.html) {
            stream.write(rendered, tokens);
            return;
          }
        }
        stream.write(rendered, node.node);
      }
    }

## Rendering safely

Renders `doc` for a page, safe for Markdown from anyone: the tree a
browser builds from the rendering (`buildHtml`, with raw HTML parsed
as written), sanitized by `policy` (kelpto-html's
`SanitizerPolicy.standard` by default: what Markdown and GFM render,
and common formatting) for `context`. So raw HTML and Markdown are
judged together, as the browser joins them, and Markdown's own links
and images are checked like any other URL: `[x](javascript:alert(1))`
keeps its text and loses its `href`. See kelpto-html's `sanitizeHtml`
for what's kept and what's guaranteed.

```temper inert
let doc = parseMarkdownWithHtml("[a](javascript:alert(1)) <b onclick=x>b</b><script>alert(2)</script>");
renderSafe(doc).html;   // "<p><a>a</a> <b>b</b></p>\n"
```

    export let renderSafe(
      doc: MarkdownDocument,
      policy: SanitizerPolicy = SanitizerPolicy.standard,
      context: FragmentContext = new FragmentContext("body"),
    ): SafeHtml {
      buildHtml(doc, context).sanitize(policy)
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

    test("renderSafe keeps what the policy allows, judged on the built tree") {
      let doc = parseMarkdownWithHtml(
        "Hi <b onclick=\"x()\">there</b><script>alert(1)</script> <em>ok</em> <img src=x onerror=alert(1)><!-- c -->",
      );
      let html = renderSafe(doc).html;
      assert(html == "<p>Hi <b>there</b> <em>ok</em> <img src=\"x\"></p>\n") { html };
      // The script swallows the rest, `</p>` included, so the `p` ends with the fragment.
      let fromPlain = renderSafe(parseMarkdown("<i>x</i><script>")).html;
      assert(fromPlain == "<p><i>x</i></p>") { fromPlain };
    }

### The `#safe` gallery

Hostile Markdown, each with what `renderSafe` gives: a label, the
Markdown, and the HTML. The site's `#safe` section shows these (see
docs/site.md). Each is also checked to parse back to itself: parsing
the output as a fragment in `body` and serializing gives it again,
and sanitizing that changes nothing.

    let safeGallery(): List<List<String>> {
      [
        ["javascript: link", "[a](javascript:alert(1))", "<p><a>a</a></p>\n"],
        ["javascript: in any case", "[a](JaVaScRiPt:alert(1))", "<p><a>a</a></p>\n"],
        ["javascript: autolink", "<javascript:alert(1)>", "<p><a>javascript:alert(1)</a></p>\n"],
        ["javascript: as an image", "![a](javascript:alert(1))", "<p><img alt=\"a\"></p>\n"],
        ["a tab, as a reference", "<a href=\"java&#x09;script:alert(1)\">a</a>", "<p><a>a</a></p>\n"],
        ["a newline inside", "<a href=\"jav&#x0A;ascript:alert(1)\">a</a>", "<p><a>a</a></p>\n"],
        ["letters as references", "<a href=\"&#106;&#x61;vascript&colon;alert(1)\">a</a>", "<p><a>a</a></p>\n"],
        ["leading controls and spaces", "<a href=\"&#1; &#x1F;javascript:alert(1)\">a</a>", "<p><a>a</a></p>\n"],
        ["a Markdown escape", "[a](javascript\\:alert(1))", "<p><a>a</a></p>\n"],
        ["a reference definition", "[a]\n\n[a]: JAVASCRIPT:alert(1)", "<p><a>a</a></p>\n"],
        ["data: link", "[a](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)", "<p><a>a</a></p>\n"],
        ["vbscript: link", "<a href=\"vbscript:msgbox(1)\">a</a>", "<p><a>a</a></p>\n"],
        ["safe links stay", "[a](https://example.com/?q=1&r=2) [b](/rel) [c](#top) <mailto:me@example.com>", "<p><a href=\"https://example.com/?q=1&amp;r=2\">a</a> <a href=\"/rel\">b</a> <a href=\"#top\">c</a> <a href=\"mailto:me@example.com\">mailto:me@example.com</a></p>\n"],
        ["event handlers", "<img src=x onerror=alert(1)> <b onmouseover=\"alert(1)\">b</b>", "<p><img src=\"x\"> <b>b</b></p>\n"],
        ["style attributes", "<div style=\"background:url(javascript:alert(1))\">x</div>", "<div>x</div>\n"],
        ["script and style", "<script>alert(1)</script><style>*{color:red}</style>", "\n"],
        ["svg script", "<svg><script>alert(1)</script></svg>", "<p></p>\n"],
        ["svg link", "<svg><a xlink:href=\"javascript:alert(1)\"><text y=20>x</text></a></svg>", "<p></p>\n"],
        ["math mXSS", "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>", "<p></p>"],
        ["math in a form", "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>", ""],
        ["noscript breakout", "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">", "<p><img src=\"x\">\"&gt;</p>\n"],
        ["template", "<template><script>alert(1)</script><img src=x onerror=alert(1)></template>", "<p></p>\n"],
        ["textarea breakout", "<textarea><img title=\"</textarea><img src=x onerror=alert(1)>\">", "<img src=\"x\">\"&gt;\n"],
        ["title breakout", "<title><img title=\"</title><img src=x onerror=alert(1)>\">", "<img src=\"x\">\"&gt;\n"],
        ["an unclosed comment swallows Markdown", "<!-- open\n\n[a](javascript:alert(1)) *md*\n", ""],
        ["an attribute across paragraphs", "<b title=\"\n\n<img src=x onerror=alert(1)>\n\n\">b</b>", "<p>&lt;b title=\"</p>\n<img src=\"x\">\n<p>\"&gt;b</p>\n"],
        ["a raw tag left open", "a <i>b\n\n<b>c</b> d", "<p>a <i>b</i></p><i>\n<p><b>c</b> d</p>\n</i>"],
        ["foster parenting", "<table><tr><td>x</td></tr><img src=x onerror=alert(1)></table>", "<img src=\"x\"><table><tbody><tr><td>x</td></tr></tbody></table>\n"],
        ["base href", "<base href=\"javascript:alert(1)//\">\n\n[a](/x)", "\n<p><a href=\"/x\">a</a></p>\n"],
        ["meta refresh", "<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">", "\n"],
        ["srcset", "<img srcset=\"a.png 1x, javascript:alert(1) 2x\"> <img srcset=\"a.png 1x, b.png 2x\" alt=ok>", "<p><img> <img srcset=\"a.png 1x, b.png 2x\" alt=\"ok\"></p>\n"],
        ["form action", "<form action=\"javascript:alert(1)\"><button formaction=\"javascript:alert(1)\">go</button></form>", "go\n"],
        ["iframe, object, and embed", "<iframe src=\"javascript:alert(1)\"></iframe><object data=\"javascript:alert(1)\"></object><embed src=x>", "\n"],
        ["processing instructions", "<?php echo 1; ?> <?xml-stylesheet href=x?>", " \n"],
        ["a p the browser closes", "<p><button><div>x</div></button></p>", "<p></p><div>x</div><p></p>\n"],
        ["plaintext swallows the rest", "a <plaintext>\n\n# h\n", "<p>a </p>"],
      ]
    }

    test("the #safe gallery") {
      let gallery = safeGallery();
      let body = new FragmentContext("body");
      let failures = new ListBuilder<String>();
      for (var i = 0; i < gallery.length; i += 1) {
        let item = gallery[i];
        let html = renderSafe(parseMarkdownWithHtml(item[1])).html;
        if (html != item[2]) { failures.add("${item[0]}: ${html}"); }
        let reparsed = parseHtmlFragment(html, body);
        if (reparsed.html != html || reparsed.sanitize().html != html) { failures.add("${item[0]}: reparses otherwise"); }
      }
      assert(failures.isEmpty) { failures.toList().join("\n") { (s: String): String => s } };
    }

A policy of one's own: fewer elements, other schemes, and a
`UrlCheck` of one's own, as Hrefine will be. A check that rewrites
URLs must give back what it gives when given its own output, since
the sanitizer checks its output again.

    class OnlyExampleLinks extends UrlCheck {
      // Writes no field, as kelpto-html's `SchemeUrlCheck` doesn't:
      // Temper's C++ backend then makes `UrlCheck.checkUrl` `const`,
      // and an override writing a field isn't, so doesn't override
      // (notes/temper-fixes.md).
      public constructor() {}
      public checkUrl(url: String, element: String, attribute: String): String? {
        let www = "https://www.example.com/";
        let bare = "https://example.com/";
        if (url.split(www).length > 1) {
          url
        } else if (url.split(bare).length > 1) {
          url.split(bare).join(www) { (s: String): String => s }
        } else {
          null
        }
      }
    }

    test("renderSafe with a policy of one's own") {
      let doc = parseMarkdownWithHtml("[a](https://example.com/a) [b](https://other.example/) ![c](https://example.com/c.png) <u>u</u> ~~s~~\n");
      let strict = SanitizerPolicy.standard.withoutElements(["img", "u"]).withUrlCheck(new OnlyExampleLinks());
      let html = renderSafe(doc, strict).html;
      assert(html == "<p><a href=\"https://www.example.com/a\">a</a> <a>b</a>  u ~~s~~</p>\n") { html };
      let tel = renderSafe(parseMarkdownWithHtml("<a href=\"tel:123\" target=_blank>t</a> <video src=v.mp4 controls>v</video>"),
        SanitizerPolicy.standard.withSchemes(["tel"]).withElements(["video"]).withAttributes("video", ["src", "controls"]).withAttributes("a", ["target"])).html;
      assert(tel == "<p><a href=\"tel:123\" target=\"_blank\">t</a> <video src=\"v.mp4\" controls=\"\">v</video></p>\n") { tel };
      let textOnly = renderSafe(parseMarkdownWithHtml("# *a* [b](/c)\n"), SanitizerPolicy.textOnly).html;
      assert(textOnly == "a b\n") { textOnly };
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
      assert(html == "<div class=\"x\">\n<b>hi</b>\n</div>\n<blockquote>\n<p>\nquoted\n</p></blockquote>\n") { html };
    }

### The tree a browser builds

A dump of built nodes, with namespaces and attributes, for comparing
trees.

    let treeOf(nodes: List<BuiltNode>): String {
      let out = new StringBuilder();
      addTree(nodes, out);
      out.toString()
    }

    let addTree(nodes: List<BuiltNode>, out: StringBuilder): Void {
      for (var i = 0; i < nodes.length; i += 1) {
        let node = nodes[i];
        when (node) {
          is Element -> do {
            out.append("<${node.namespace}:${node.name}");
            let attributes = node.attributes;
            for (var j = 0; j < attributes.length; j += 1) {
              let a = attributes[j];
              out.append(" ${a.prefix}:${a.name}=\"${a.value}\"");
            }
            out.append(">");
            addTree(node.templateContents, out);
            out.append("|");
            addTree(node.children, out);
            out.append("</>");
          }
          is BuiltText -> out.append("\"${node.text}\"");
          is BuiltComment -> out.append("<!--${node.text}-->");
          else -> out.append(node.html);
        }
      }
    }

The built tree, and the tree parsing the rendered HTML gives, or ""
if they're the same.

    let treeDifference(doc: MarkdownDocument, context: FragmentContext, renderer: MarkdownRenderer): String {
      let built = treeOf(buildHtml(doc, context, renderer).children);
      let parsed = treeOf(parseHtmlFragment(renderer.render(doc), context).children);
      if (built == parsed) { "" } else { "built ${built}\nparsed ${parsed}" }
    }

Pieces that interact, each checked against parsing its HTML.

    test("Markdown and raw HTML, as one tree") {
      let cases = [
        "a <b>bold\n\nstill bold</b> c\n",
        "<div class=x>\n\n*in the div*\n\n</div>\n\nafter\n",
        "<table>\n\nfoster *parented*\n\n</table>\n\n<table><tr><td>\n\n- in a cell\n\n</table>\n",
        "x <script>a\n\n*b* `c` </p>\n\n</script> y\n",
        "x <textarea>a\n\n*b* &amp; <i>c</i>\n\n</textarea> y\n",
        "<div>\n<!-- open\n\n*md* --!\n\n-->\n\nafter\n",
        "<div>\n<b class=\"\n\npara\"\n\n> y\n",
        "x <plaintext>\n\n# h\n",
        "<svg><title>\n\n*a* <b>\n\n</title></svg>\n\n<svg><![CDATA[\n\nz\n\n]]></svg>\n",
        "- <b>a\n- b</b>\n\n> <i>q\n\nz</i>\n",
        "[link](/u \"t\") ![i *x*](/i.png) <a href=x>raw</a>\\\nbreak <!-- c --> <?p i?>\n",
        "<pre>\n\n\nx\n\n</pre>\n\n<textarea>\n\n</textarea>\n",
        "a <b>\r\n\r\n<i>c\r\rd\r",
        "<div>\n<",
        "*a* </",
      ];
      let body = new FragmentContext("body");
      let trusted = new MarkdownRenderer().withRawHtmlTrusted();
      for (var i = 0; i < cases.length; i += 1) {
        let doc = parseMarkdownWithHtml(cases[i]);
        let difference = treeDifference(doc, body, trusted);
        assert(difference.isEmpty) { "${i.toString()}: ${difference}" };
        assert(doc.asWritten == cases[i]) { "lossless" };
      }
      let gfm = MarkdownParser.gfm.withRawHtmlHandler(new ParsedRawHtml()).parse(
        "<em>a\n\n| x | <b>y |\n|---|---|\n| 1 | 2 |\n\n<title>t</title> [^1]\n\n[^1]: <i>note\n",
      );
      let filtered = trusted.withDisallowedRawHtmlFiltered();
      let gfmDifference = treeDifference(gfm, body, filtered);
      assert(gfmDifference.isEmpty) { gfmDifference };
      let textarea = treeDifference(parseMarkdownWithHtml("*a* <b>\n\nc"), new FragmentContext("textarea"), trusted);
      assert(textarea.isEmpty) { textarea };
      let escaped = treeDifference(parseMarkdownWithHtml("a <b>x"), body, new MarkdownRenderer());
      assert(escaped.isEmpty) { escaped };
    }

    test("built nodes point back at raw tokens and Markdown nodes") {
      let doc = parseMarkdownWithHtml("<div class=note>\n\n*Hi* <b>there</b>\n\n</div>\n\n<table><td>x</table>\n");
      let built = buildHtml(doc);
      let html = built.html;
      assert(
        html == "<div class=\"note\">\n<p><em>Hi</em> <b>there</b></p>\n</div>\n<table><tbody><tr><td>x</td></tr></tbody></table>\n"
      ) { html };
      let div = built.children[0] as Element orelse panic();
      let tag = div.startTag as StartTag orelse panic();
      assert(tag.asWritten == "<div class=note>" && tag.node.root.kind.name == "Document") { "in the Markdown tree" };
      assert(markdownNodeOf(div) is HtmlBlock) { "the HTML block" };
      let p = div.children[1] as Element orelse panic();
      assert(p.startTag == null && markdownNodeOf(p) is Paragraph) { "Markdown's p" };
      let em = p.children[0] as Element orelse panic();
      assert(markdownNodeOf(em) is Emphasis && (markdownNodeOf(em.children[0])?.node?.kind?.name ?? "") == "Text") { "emphasis" };
      let b = p.children[2] as Element orelse panic();
      assert(b.startTag?.asWritten == "<b>" && markdownNodeOf(b) is RawHtml) { "raw b" };
      let table = built.children[2] as Element orelse panic();
      let tbody = table.children[0] as Element orelse panic();
      assert(tbody.origin == null && markdownNodeOf(tbody) == null) { "implied" };
      assert(markdownNodeOf(parseHtmlFragment("<p>", new FragmentContext("body")).children[0]) == null) { "plain HTML" };
    }

Each piece alone, the cheap view, can't see the others: `<b>` here
is closed by the fragment's end, not by `</b>` in the next paragraph.

    test("one piece alone, as a fragment") {
      let doc = parseMarkdownWithHtml("a <b>x\n\ny</b>\n\n<td>z\n");
      assert(fragmentOf(doc.rawHtml[0]).html == "<b></b>") { fragmentOf(doc.rawHtml[0]).html };
      assert(fragmentOf(doc.htmlBlocks[0]).html == "z\n") { fragmentOf(doc.htmlBlocks[0]).html };
      let joined = buildHtml(doc).html;
      assert(joined == "<p>a <b>x</b></p><b>\n</b><p><b>y</b></p>\nz\n") { joined };
    }
