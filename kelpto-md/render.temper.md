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

How raw HTML renders: the second half of the coordination with other
libraries, after `RawHtmlHandler`. The `kelpto` library supplies one
that keeps only allowlisted elements.

    export interface RawHtmlRenderer {

The HTML to output for `rawHtml`. Whatever this returns goes into the
page as is.

      public renderRawHtml(rawHtml: RawHtml): String;
    }

The default: raw HTML as text, so `<script>` shows as `&lt;script&gt;`.

    class EscapedRawHtml extends RawHtmlRenderer {
      public constructor() {}
      public renderRawHtml(rawHtml: RawHtml): String { escapeHtml(rawHtml.html) }
    }

    class TrustedRawHtml extends RawHtmlRenderer {
      public constructor() {}
      public renderRawHtml(rawHtml: RawHtml): String { rawHtml.html }
    }

## The renderer

    export class MarkdownRenderer {
      private rawHtmlRenderer: RawHtmlRenderer;

A renderer that escapes raw HTML, unless given another
`RawHtmlRenderer`.

      public constructor(rawHtmlRenderer: RawHtmlRenderer = new EscapedRawHtml()) {
        this.rawHtmlRenderer = rawHtmlRenderer;
      }

A renderer that passes raw HTML through exactly as written. **Only for
Markdown you trust as much as your own page's code:** raw HTML from
anyone else can run scripts in your page (`<img src=x onerror=…>`),
steal what your users type, or restyle the page to mislead them. For
Markdown from users, keep the default, or use the `kelpto` library's
`renderSafe`.

      public withRawHtmlTrusted(): MarkdownRenderer {
        new MarkdownRenderer(new TrustedRawHtml())
      }

A renderer using `renderer` for raw HTML.

      public withRawHtmlRenderer(renderer: RawHtmlRenderer): MarkdownRenderer {
        new MarkdownRenderer(renderer)
      }

      public render(doc: MarkdownDocument): String {
        let out = new StringBuilder();
        let blocks = doc.children;
        for (var i = 0; i < blocks.length; i += 1) {
          renderBlock(blocks[i], out);
        }
        out.toString()
      }

      private renderBlock(block: DocumentChild, out: StringBuilder): Void {
        when (block) {
          is Heading -> do {
            let tag = "h${block.level.toString()}";
            out.append("<${tag}>");
            renderInlines(block.children, out);
            out.append("</${tag}>\n");
          };
          is Paragraph -> do {
            out.append("<p>");
            renderInlines(block.children, out);
            out.append("</p>\n");
          };
          is CodeBlock -> do {
            let language = block.language;
            if (language.isEmpty) {
              out.append("<pre><code>");
            } else {
              out.append("<pre><code class=\"language-${escapeHtml(language)}\">");
            }
            out.append(escapeHtml(block.code));
            out.append("</code></pre>\n");
          };
          is BlankLine -> do {};
        }
      }

      private renderInlines(inlines: List<ParagraphChild>, out: StringBuilder): Void {
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
