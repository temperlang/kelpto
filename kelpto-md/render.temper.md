# Rendering to HTML

CommonMark's HTML output for the subset kelpto-md understands, with
secure defaults: **raw HTML is escaped,** shown as text, unless the
caller chooses otherwise by name.

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
        let out = new HtmlOut();
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
          let inline = inlines[i];
          when (inline) {
            is Text -> out.append(escapeHtml(inline.text));
            is CodeSpan -> out.append("<code>${escapeHtml(inline.code)}</code>");
            is RawHtml -> out.append(rawHtmlRenderer.renderRawHtml(inline));
          }
        }
      }
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

      public constructor() {}

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
      let expected = "<h3>Spaced</h3>\n<p>one\ntwo*</p>\n<pre><code></code></pre>\n";
      assert(html == expected) { html };
    }
