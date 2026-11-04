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
      Emphasis, HtmlBlock, MarkdownDocument, MarkdownNode, MarkdownParser, MarkdownRenderer, Paragraph,
      RawHtml, RawHtmlContent, RawHtmlHandler, RawHtmlRenderer, RenderSink,
      parseMarkdown, viewOf,
    } = import("../kelpto-md");
    let {
      Attribute, BuiltComment, BuiltNode, BuiltText, Comment, Doctype, DroppedTag, Element, EndTag,
      FragmentContext, FragmentStream,
      HtmlFragment, HtmlTokens, StartTag, Text, htmlTokensKind, parseHtmlFragment, tokenizeHtml,
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
            is Comment, is Doctype, is DroppedTag -> do {};
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
