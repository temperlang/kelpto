# Rendering to HTML

CommonMark's HTML output, as its reference implementation, cmark,
writes it, with secure defaults: **raw HTML is escaped,** shown as
text, unless the caller chooses otherwise by name. Link and image
destinations stay as written in the tree (`LinkTarget`); the renderer
percent-encodes them only as it writes them.

    let { escapeHtml } = import("../kelpto-core");

```temper inert
let doc = parseMarkdown("Hi <b>there</b>");
doc.toHtml();                                        // "<p>Hi &lt;b&gt;there&lt;/b&gt;</p>\n"
new MarkdownRenderer().withRawHtmlTrusted().render(doc); // "<p>Hi <b>there</b></p>\n"
```

## Raw HTML

How raw HTML renders, inline or in HTML blocks: the second half of the
coordination with other libraries, after `RawHtmlHandler`. The `kelpto`
library supplies one that keeps only allowlisted elements.

    export interface RawHtmlRenderer {

The HTML to output for `rawHtml`. Whatever this returns goes into the
page as is.

      public renderRawHtml(rawHtml: RawHtmlContent): String;
    }

The default: raw HTML as text, so `<script>` shows as `&lt;script&gt;`.

    class EscapedRawHtml extends RawHtmlRenderer {
      public constructor() {}
      public renderRawHtml(rawHtml: RawHtmlContent): String { escapeHtml(rawHtml.html) }
    }

    class TrustedRawHtml extends RawHtmlRenderer {
      public constructor() {}
      public renderRawHtml(rawHtml: RawHtmlContent): String { rawHtml.html }
    }

## The renderer

CommonMark's HTML, as its reference implementation lays it out: each
block on its own lines, and tight lists' paragraphs without `<p>`.

    export class MarkdownRenderer {
      private rawHtmlRenderer: RawHtmlRenderer;

A renderer that escapes raw HTML, unless given another
`RawHtmlRenderer`.

      public constructor(rawHtmlRenderer: RawHtmlRenderer = new EscapedRawHtml()) {
        this.rawHtmlRenderer = rawHtmlRenderer;
      }

A renderer that passes raw HTML through exactly as written, inline and
in HTML blocks. **Only for Markdown you trust as much as your own
page's code:** raw HTML from anyone else can run scripts in your page
(`<img src=x onerror=…>`), steal what your users type, or restyle the
page to mislead them. For Markdown from users, keep the default, or
use the `kelpto` library's `renderSafe`.

      public withRawHtmlTrusted(): MarkdownRenderer {
        new MarkdownRenderer(new TrustedRawHtml())
      }

A renderer using `renderer` for raw HTML.

      public withRawHtmlRenderer(renderer: RawHtmlRenderer): MarkdownRenderer {
        new MarkdownRenderer(renderer)
      }

      public render(doc: MarkdownDocument): String {
        let out = new HtmlOut(definitionsOf(doc));
        renderBlocks(doc.children, false, out);
        out.toString()
      }

      private renderBlocks(blocks: List<BlockChild>, tight: Boolean, out: HtmlOut): Void {
        for (var i = 0; i < blocks.length; i += 1) {
          renderBlock(blocks[i], tight, out);
        }
      }

`tight` is whether the block is directly in an item of a tight list.

      private renderBlock(block: BlockChild, tight: Boolean, out: HtmlOut): Void {
        when (block) {
          is Heading -> do {
            let tag = "h${block.level.toString()}";
            out.line();
            out.append("<${tag}>");
            renderInlines(block.children, out);
            out.append("</${tag}>\n");
          };
          is Paragraph -> do {
            if (tight) {
              renderInlines(block.children, out);
            } else {
              out.line();
              out.append("<p>");
              renderInlines(block.children, out);
              out.append("</p>\n");
            }
          };
          is CodeBlock -> do {
            let language = block.language;
            out.line();
            if (language.isEmpty) {
              out.append("<pre><code>");
            } else {
              out.append("<pre><code class=\"language-${escapeHtml(language)}\">");
            }
            out.append(escapeHtml(block.code));
            out.append("</code></pre>\n");
          };
          is IndentedCode -> do {
            out.line();
            out.append("<pre><code>");
            out.append(escapeHtml(block.code));
            out.append("</code></pre>\n");
          };
          is ThematicBreak -> do {
            out.line();
            out.append("<hr />\n");
          };
          is HtmlBlock -> do {
            out.line();
            out.append(rawHtmlRenderer.renderRawHtml(block));
            out.line();
          };
          is BlockQuote -> do {
            out.line();
            out.append("<blockquote>\n");
            renderBlocks(block.children, false, out);
            out.line();
            out.append("</blockquote>\n");
          };
          is ListBlock -> do {
            let start = block.start;
            let tag = if (start == null) { "ul" } else { "ol" };
            out.line();
            out.append("<${tag}${startAttribute(start)}>\n");
            let itemsTight = block.tight;
            let items = block.items;
            for (var i = 0; i < items.length; i += 1) {
              out.line();
              out.append("<li>");
              renderBlocks(items[i].children, itemsTight, out);
              out.append("</li>\n");
            }
            out.line();
            out.append("</${tag}>\n");
          };
          is LinkReferenceDefinition -> do {};
          is BlankLine -> do {};
        }
      }

      private renderInlines(inlines: List<ParagraphChild>, out: HtmlOut): Void {
        for (var i = 0; i < inlines.length; i += 1) {
          renderInline(inlines[i], out);
        }
      }

      private renderInline(inline: MarkdownNode, out: HtmlOut): Void {
        when (inline) {
          is Text -> out.append(escapeHtml(inline.text));
          is CodeSpan -> out.append("<code>${escapeHtml(inline.code)}</code>");
          is RawHtml -> out.append(rawHtmlRenderer.renderRawHtml(inline));
          is CharacterReference -> out.append(escapeHtml(inline.value));
          is HardBreak -> out.append("<br />\n");
          is Emphasis -> do {
            out.append("<em>");
            renderInlines(inline.children, out);
            out.append("</em>");
          };
          is Strong -> do {
            out.append("<strong>");
            renderInlines(inline.children, out);
            out.append("</strong>");
          };
          is Autolink -> out.append(
            "<a href=\"${escapeHref(inline.destination.url)}\">${escapeHtml(inline.text)}</a>",
          );
          is Link -> do {
            let target = linkDestinationOf(inline.node, out.definitions);
            if (target == null) {
              unresolved(inline.node, out);
            } else {
              out.append("<a href=\"${escapeHref(target.url)}\"");
              appendTitle(linkTitleOf(inline.node, out.definitions), out);
              out.append(">");
              let kids = inline.children;
              for (var i = 0; i < kids.length; i += 1) { renderInline(kids[i], out); }
              out.append("</a>");
            }
          };
          is Image -> do {
            let target = linkDestinationOf(inline.node, out.definitions);
            if (target == null) {
              unresolved(inline.node, out);
            } else {
              let alt = new StringBuilder();
              addAltText(inline.children, alt);
              out.append("<img src=\"${escapeHref(target.url)}\" alt=\"${escapeHtml(alt.toString())}\"");
              appendTitle(linkTitleOf(inline.node, out.definitions), out);
              out.append(" />");
            }
          };
          else -> do {};
        }
      }

A reference whose definition is gone, as after an edit: its brackets
and label as text, around its text rendered.

      private unresolved(node: RedNode, out: HtmlOut): Void {
        let kids = node.green.children;
        out.append(escapeHtml((kids[0] as GreenToken orelse panic()).text));
        renderInlines(paragraphChildrenOf(node), out);
        var after = false;
        for (var i = 1; i < kids.length; i += 1) {
          if (kids[i].kind.id == linkCloseKind.id) { after = true; }
          if (after) {
            let rest = new StringBuilder();
            kids[i].writeTo(rest);
            out.append(escapeHtml(rest.toString()));
          }
        }
      }
    }

    let appendTitle(title: String?, out: HtmlOut): Void {
      if (title != null) { out.append(" title=\"${escapeHtml(title)}\""); }
    }

An image's description as `alt` text: plain text, with line breaks as
spaces, as cmark writes it.

    let addAltText(inlines: List<ParagraphChild>, out: StringBuilder): Void {
      for (var i = 0; i < inlines.length; i += 1) {
        let inline = inlines[i];
        when (inline) {
          is Text -> out.append(lineBreaksAsSpaces(inline.text));
          is CodeSpan -> out.append(inline.code);
          is RawHtml -> out.append(inline.html);
          is CharacterReference -> out.append(inline.value);
          is HardBreak -> out.append(" ");
          is Autolink -> out.append(inline.text);
          is Emphasis -> addAltText(inline.children, out);
          is Strong -> addAltText(inline.children, out);
          is Image -> addAltText(inline.children, out);
          is Link -> addAltText(paragraphChildrenOf(inline.node), out);
        }
      }
    }

    let lineBreaksAsSpaces(text: String): String {
      let out = new StringBuilder();
      var i = String.begin;
      while (text.hasIndex(i)) {
        let next = text.next(i);
        if (text[i] == char'\n') { out.append(" "); } else { out.append(text.slice(i, next)); }
        i = next;
      }
      out.toString()
    }

The document's definitions by normalized label, the first for each.

    let definitionsOf(doc: MarkdownDocument): Map<String, LinkReferenceDefinition> {
      let map = new MapBuilder<String, LinkReferenceDefinition>();
      let all = doc.linkReferenceDefinitions;
      for (var i = 0; i < all.length; i += 1) {
        let label = normalizeLabel(all[i].label);
        if (!map.has(label)) { map[label] = all[i]; }
      }
      map.toMap()
    }

A destination for an `href` or `src`, as cmark writes it: ASCII
letters, digits, and `-_.+!*(),%#@?=;:/~$` as they are, `&` as
`&amp;`, `'` as `&#x27;`, and the rest percent-encoded as UTF-8. A `%`
stays, so text already percent-encoded isn't encoded twice.

    let escapeHref(url: String): String {
      let out = new StringBuilder();
      var i = String.begin;
      while (url.hasIndex(i)) {
        let c = url[i];
        let next = url.next(i);
        if (isHrefSafe(c)) {
          out.append(url.slice(i, next));
        } else if (c == char'&') {
          out.append("&amp;");
        } else if (c == char'\'') {
          out.append("&#x27;");
        } else {
          percentEncode(c, out);
        }
        i = next;
      }
      out.toString()
    }

    let isHrefSafe(c: Int): Boolean {
      isAsciiAlphanumeric(c) || (
        c == char'-' || c == char'_' || c == char'.' || c == char'+' || c == char'!' ||
        c == char'*' || c == char'(' || c == char')' || c == char',' || c == char'%' ||
        c == char'#' || c == char'@' || c == char'?' || c == char'=' || c == char';' ||
        c == char':' || c == char'/' || c == char'~' || c == char'$'
      )
    }

`c` in UTF-8, each byte as `%XX`. A lone surrogate becomes U+FFFD's
bytes.

    let percentEncode(code: Int, out: StringBuilder): Void {
      let c = if (code >= 0xD800 && code <= 0xDFFF) { 0xFFFD } else { code };
      if (c < 0x80) {
        percentByte(c, out);
      } else if (c < 0x800) {
        percentByte(0xC0 | (c >> 6), out);
        percentByte(0x80 | (c & 0x3F), out);
      } else if (c < 0x10000) {
        percentByte(0xE0 | (c >> 12), out);
        percentByte(0x80 | ((c >> 6) & 0x3F), out);
        percentByte(0x80 | (c & 0x3F), out);
      } else {
        percentByte(0xF0 | (c >> 18), out);
        percentByte(0x80 | ((c >> 12) & 0x3F), out);
        percentByte(0x80 | ((c >> 6) & 0x3F), out);
        percentByte(0x80 | (c & 0x3F), out);
      }
    }

    let percentByte(b: Int, out: StringBuilder): Void {
      let digits = "0123456789ABCDEF";
      let source = new SourceText(digits);
      out.append("%");
      out.append(source.slice(b >> 4, (b >> 4) + 1));
      out.append(source.slice(b & 15, (b & 15) + 1));
    }

A list's `start` attribute: for an ordered list not starting at 1.

    let startAttribute(start: Int?): String {
      if (start != null) {
        if (start != 1) { return " start=\"${start.toString()}\""; }
      }
      ""
    }

Output that knows whether it's at the start of a line, for cmark's
layout: each block starts on a new line.

    class HtmlOut {
      private out: StringBuilder = new StringBuilder();
      private var atLineStart: Boolean = true;

The document's definitions, for reference links.

      public definitions: Map<String, LinkReferenceDefinition>;

      public constructor(definitions: Map<String, LinkReferenceDefinition>) {
        this.definitions = definitions;
      }

      public append(text: String): Void {
        if (!text.isEmpty) {
          out.append(text);
          atLineStart = text[text.prev(text.end)] == char'\n';
        }
      }

A line break, unless at the start of a line.

      public line(): Void {
        if (!atLineStart) { append("\n"); }
      }

      public toString(): String { out.toString() }
    }

## Tests

    test("rendering, with raw HTML escaped by default") {
      let doc = parseMarkdown(
        "# A & B\n\nHi <b onclick=\"x()\">there</b>, `<i>`\nnext <!-- c -->\n\n```js\nif (a < b) {}\n```\n",
      );
      let html = doc.toHtml();
      let expected = [
        "<h1>A &amp; B</h1>\n",
        "<p>Hi &lt;b onclick=&quot;x()&quot;&gt;there&lt;/b&gt;, <code>&lt;i&gt;</code>\nnext &lt;!-- c --&gt;</p>\n",
        "<pre><code class=\"language-js\">if (a &lt; b) {}\n</code></pre>\n",
      ].join("") { (s: String): String => s };
      assert(html == expected) { html };
    }

    test("raw HTML passes through only when trusted by name") {
      let doc = parseMarkdown("Hi <b>there</b>\n");
      let trusted = new MarkdownRenderer().withRawHtmlTrusted().render(doc);
      assert(trusted == "<p>Hi <b>there</b></p>\n") { trusted };
    }

    test("rendering: CommonMark's layout rules") {
      let html = parseMarkdown("   ### Spaced   ###  \n  one  \n   two\\*\n``` \n```\n").toHtml();
      let expected = "<h3>Spaced</h3>\n<p>one<br />\ntwo*</p>\n<pre><code></code></pre>\n";
      assert(html == expected) { html };
    }
