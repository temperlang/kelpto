# Rendering to HTML

CommonMark's HTML output, as its reference implementation, cmark,
writes it, with secure defaults: **raw HTML is escaped,** shown as
text, unless the caller chooses otherwise by name. Link and image
destinations stay as written in the tree (`LinkTarget`); the renderer
percent-encodes them only as it writes them.

    let { escapeHtml, isWordCharacter, lowercase } = import("../kelpto-core");

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

GFM's filter for disallowed raw HTML, over another renderer: a `<` that
starts a `title`, `textarea`, `style`, `xmp`, `iframe`, `noembed`,
`noframes`, `script`, or `plaintext` tag, opening or closing, becomes
`&lt;`, as cmark-gfm's tagfilter does: at the start of inline raw HTML,
and anywhere in an HTML block.

    class FilteredRawHtml extends RawHtmlRenderer {
      private inner: RawHtmlRenderer;
      public constructor(inner: RawHtmlRenderer) { this.inner = inner; }
      public renderRawHtml(rawHtml: RawHtmlContent): String {
        filterDisallowedTags(inner.renderRawHtml(rawHtml), rawHtml.isBlock)
      }
    }

    let filterDisallowedTags(html: String, everywhere: Boolean): String {
      var changed = false;
      for (var i = String.begin; html.hasIndex(i); i = html.next(i)) {
        if (html[i] == char'<' && isDisallowedTag(html, i)) { changed = true; }
        if (!everywhere) { break; }
      }
      if (!changed) { return html; }
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; html.hasIndex(i); i = html.next(i)) {
        if (html[i] == char'<' && (everywhere || i == String.begin) && isDisallowedTag(html, i)) {
          out.append(html.slice(runStart, i));
          out.append("&lt;");
          runStart = html.next(i);
        }
      }
      out.append(html.slice(runStart, html.end));
      out.toString()
    }

    let disallowedTags = [
      "title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext",
    ];

Whether the `<` at `at` starts one: `<` or `</`, the name in any case,
then whitespace, `>`, or `/>`.

    let isDisallowedTag(html: String, at: StringIndex): Boolean {
      let end = html.end;
      var nameStart = html.next(at);
      if (codeInAt(html, nameStart, end) == char'/') { nameStart = html.next(nameStart); }
      for (var k = 0; k < disallowedTags.length; k += 1) {
        let name = disallowedTags[k];
        let after = html.step(nameStart, name.countBetween(String.begin, name.end));
        if (html.hasIndex(after) && asciiLowercase(html.slice(nameStart, after)) == name) {
          let c = html[after];
          if (
            c == char' ' || c == char'\t' || c == char'\n' || c == char'\r' || c == char'>' ||
            (c == char'/' && codeInAt(html, html.next(after), end) == char'>')
          ) {
            return true;
          }
        }
      }
      false
    }

## Rendering to something else

What the renderer writes, as parts, for building something other than
a string from it, such as the `kelpto` library's tree of the HTML a
browser builds: each start tag, end tag, run of text, and piece of raw
HTML, in order, each with the node it renders. Rendering to a string
writes the same parts, joined.

    export interface RenderSink {

A start tag: its name, and the whole tag as the renderer writes it,
attributes and all, such as `<a href="/x">` or `<br />`.

      public startTag(name: String, written: String, node: MarkdownNode): Void;
      public endTag(name: String, node: MarkdownNode): Void;

Text, not escaped: written escaped as HTML (`&lt;` for `<`), it's the
text in the HTML. Line breaks between blocks are text too.

      // Not `text`: a method of that name makes Temper's C++ backend
      // treat views' `text` getters as non-const (notes/temper-fixes.md).
      public characters(text: String, node: MarkdownNode): Void;

Raw HTML, inline or a block, and what the `RawHtmlRenderer` gave for
it, which goes into the HTML as is.

      public rawHtml(content: RawHtmlContent, rendered: String, node: MarkdownNode): Void;
    }

## Highlighting code

How code blocks are highlighted, if at all: given a block's info
string (empty for an indented block) and its code, the code as spans,
each with a CSS class, or null to write it plain. The spans' text,
joined, must be the code exactly, or the code is written plain. Each
is written as `<span class="…">`, escaped, the class too (or as plain
text, for an empty class), so a highlighter can't add markup or change
what the code says, however it's written: no HTML from it reaches the
page.

```temper inert
let keywords = new MarkdownRenderer().withCodeHighlighter { (info: String, code: String): List<HighlightSpan>? =>
  if (info == "py" && code == "pass\n") { [new HighlightSpan("k", "pass"), new HighlightSpan("", "\n")] } else { null }
};
keywords.render(parseMarkdown("```py\npass\n```\n"));
  // "<pre><code class=\"language-py\"><span class=\"k\">pass</span>\n</code></pre>\n"
```

    export @fun interface CodeHighlighter(info: String, code: String): List<HighlightSpan>?;

A run of code and its CSS class, or `""` for none.

    export class HighlightSpan(public className: String, public text: String) {}

    let noHighlighting(info: String, code: String): List<HighlightSpan>? { null }

    let noSpans: List<HighlightSpan> = new ListBuilder<HighlightSpan>().toList();

What a renderer does beyond CommonMark's HTML.

    class RenderOptions(
      public headingIds: Boolean,
      public headingIdPrefix: String,
      public alerts: Boolean,
      public highlights: Boolean,
      public highlighter: CodeHighlighter,
    ) {}

## The renderer

CommonMark's HTML, as its reference implementation lays it out: each
block on its own lines, and tight lists' paragraphs without `<p>`.
GitHub's heading ids, alerts, and code highlighting are opt-in, with
`withHeadingIds`, `withAlerts`, and `withCodeHighlighter`, so the HTML
stays CommonMark's (or GFM's) unless asked.

    export class MarkdownRenderer {
      private rawHtmlRenderer: RawHtmlRenderer;
      private var options: RenderOptions = new RenderOptions(false, "", false, false, noHighlighting);

A renderer that escapes raw HTML, unless given another
`RawHtmlRenderer`.

      public constructor(rawHtmlRenderer: RawHtmlRenderer = new EscapedRawHtml()) {
        this.rawHtmlRenderer = rawHtmlRenderer;
      }

      private made(rawHtml: RawHtmlRenderer, newOptions: RenderOptions): MarkdownRenderer {
        let renderer = new MarkdownRenderer(rawHtml);
        renderer.options = newOptions;
        renderer
      }

A renderer that passes raw HTML through exactly as written, inline and
in HTML blocks. **Only for Markdown you trust as much as your own
page's code:** raw HTML from anyone else can run scripts in your page
(`<img src=x onerror=…>`), steal what your users type, or restyle the
page to mislead them. For Markdown from users, keep the default, or
use the `kelpto` library's `renderSafe`.

      public withRawHtmlTrusted(): MarkdownRenderer {
        made(new TrustedRawHtml(), options)
      }

A renderer using `renderer` for raw HTML.

      public withRawHtmlRenderer(renderer: RawHtmlRenderer): MarkdownRenderer {
        made(renderer, options)
      }

A renderer that also applies GFM's filter for disallowed raw HTML to
what this one's `RawHtmlRenderer` gives: `<script>`, `<style>`,
`<iframe>`, `<textarea>`, `<title>`, `<xmp>`, `<noembed>`,
`<noframes>`, and `<plaintext>` tags show as text, as GitHub's do.
Call it after `withRawHtmlTrusted()`, as `new
MarkdownRenderer().withRawHtmlTrusted().withDisallowedRawHtmlFiltered()`,
for GFM's own output. **It isn't a sanitizer:** it leaves event
handlers (`<img src=x onerror=…>`), `javascript:` links, and every other
tag, so trust the Markdown as for `withRawHtmlTrusted()`, or use the
`kelpto` library's `renderSafe`.

      public withDisallowedRawHtmlFiltered(): MarkdownRenderer {
        made(new FilteredRawHtml(rawHtmlRenderer), options)
      }

A renderer that gives each heading an `id`, as GitHub's are, so links
to `#a-heading` work as on GitHub: the heading's text (as the page
shows it, so without markup, raw HTML tags, or images), with leading
and trailing whitespace dropped, lowercased (see kelpto-core's
`lowercase`), with each space as `-`, and only `-` and word characters
kept (see `isWordCharacter`): `## This'll be a _Helpful_ Section` is
`thisll-be-a-helpful-section`. A repeat gets `-1`, `-2`, and so on, as
github-slugger numbers them, so every id is unique. `prefix` goes
before each, such as GitHub's `user-content-`, to keep ids apart from
the page's own. A heading with no word characters gets no `id`.

      public withHeadingIds(prefix: String = ""): MarkdownRenderer {
        let o = options;
        made(rawHtmlRenderer, new RenderOptions(true, prefix, o.alerts, o.highlights, o.highlighter))
      }

A renderer that writes GitHub's alerts as GitHub does: a block quote at
the top of the document whose first line is `[!NOTE]`, `[!TIP]`,
`[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]` (in any case, alone on
its line, as written, without escapes), with something after it,
becomes `<div class="markdown-alert markdown-alert-note">` with a
title, `<p class="markdown-alert-title">Note</p>`, and the rest. Block
quotes inside others, in lists, or in footnotes stay block quotes, as
on GitHub.

      public withAlerts(): MarkdownRenderer {
        let o = options;
        made(rawHtmlRenderer, new RenderOptions(o.headingIds, o.headingIdPrefix, true, o.highlights, o.highlighter))
      }

A renderer that highlights code blocks with `highlighter` (see
`CodeHighlighter`).

      public withCodeHighlighter(highlighter: CodeHighlighter): MarkdownRenderer {
        let o = options;
        made(rawHtmlRenderer, new RenderOptions(o.headingIds, o.headingIdPrefix, o.alerts, true, highlighter))
      }

      public render(doc: MarkdownDocument): String { renderWith(doc, null).toString() }

Renders `doc` as `render` does, handing `sink` each part instead of
writing a string.

      public renderTo(doc: MarkdownDocument, sink: RenderSink): Void { renderWith(doc, sink); }

      private renderWith(doc: MarkdownDocument, sink: RenderSink?): HtmlOut {
        let footnotes = if (hasFootnotes(doc.node)) { new FootnoteIndex(doc.node) } else { null };
        let out = new HtmlOut(definitionsOf(doc), isGfmDocument(doc.node), footnotes, sink);
        let blocks = doc.children;
        for (var i = 0; i < blocks.length; i += 1) {
          let block = blocks[i];
          if (options.alerts && block is BlockQuote) {
            let alert = alertOf(block as BlockQuote orelse panic());
            if (alert != null) {
              renderAlert(alert, out);
              continue;
            }
          }
          renderBlock(block, false, out);
        }
        if (footnotes != null) { renderFootnotes(doc, footnotes, out); }
        out
      }

GFM's footnotes, as cmark-gfm writes them: after the document, a
section with an item for each definition referred to, in number order,
wherever it was written. Its backlinks, one for each reference, go at
the end of its last paragraph, after a space, or else on a line of
their own. Nested definitions aren't in their parents.

      private renderFootnotes(doc: MarkdownDocument, footnotes: FootnoteIndex, out: HtmlOut): Void {
        let used = footnotes.used;
        if (used.isEmpty) { return; }
        out.startTag("section", "<section class=\"footnotes\" data-footnotes>", doc);
        out.newline(doc);
        out.startTag("ol", "<ol>", doc);
        out.newline(doc);
        for (var n = 0; n < used.length; n += 1) {
          let definition = new FootnoteDefinition(used[n]);
          let id = escapeHref(definition.label);
          out.startTag("li", "<li id=\"fn-${id}\">", definition);
          out.newline(definition);
          let kids = definition.children;
          var last = -1;
          for (var i = 0; i < kids.length; i += 1) {
            let kid = kids[i];
            if (!(kid is BlankLine || kid is LinkReferenceDefinition || kid is FootnoteDefinition)) { last = i; }
          }
          var written = false;
          for (var i = 0; i < kids.length; i += 1) {
            let kid = kids[i];
            if (i == last && kid is Paragraph) {
              out.line(kid);
              out.startTag("p", "<p>", kid);
              renderInlines((kid as Paragraph orelse panic()).children, out);
              out.characters(" ", kid);
              footnoteBacklinks(id, n + 1, footnotes.counts[n], definition, out);
              out.endTag("p", kid);
              out.newline(kid);
              written = true;
            } else {
              renderBlock(kid, false, out);
            }
          }
          if (!written) {
            footnoteBacklinks(id, n + 1, footnotes.counts[n], definition, out);
            out.newline(definition);
          }
          out.endTag("li", definition);
          out.newline(definition);
        }
        out.endTag("ol", doc);
        out.newline(doc);
        out.endTag("section", doc);
        out.newline(doc);
      }

A reference: its definition's number, linking there, with an `id`
for the backlink, `-2` and on after the first. With no definition, its
text as written.

      private renderFootnoteReference(reference: FootnoteReference, out: HtmlOut): Void {
        let footnotes = out.footnotes;
        if (footnotes != null) {
          let at = reference.node.offset;
          let number = footnotes.numberAt(at);
          if (number > 0) {
            let place = footnotes.placeAt(at);
            let id = escapeHref(new FootnoteDefinition(footnotes.used[number - 1]).label);
            let suffix = if (place > 1) { "-${place.toString()}" } else { "" };
            out.startTag("sup", "<sup class=\"footnote-ref\">", reference);
            out.startTag("a", "<a href=\"#fn-${id}\" id=\"fnref-${id}${suffix}\" data-footnote-ref>", reference);
            out.characters(number.toString(), reference);
            out.endTag("a", reference);
            out.endTag("sup", reference);
            return;
          }
        }
        out.characters("[^${reference.label}]", reference);
      }

An alert, as GitHub writes it, but laid out as cmark lays out a block
quote: the title, then the rest of the first paragraph, if any, as a
paragraph, then the other blocks.

      private renderAlert(alert: Alert, out: HtmlOut): Void {
        let quote = alert.quote;
        out.line(quote);
        out.startTag("div", "<div class=\"markdown-alert markdown-alert-${alert.type}\">", quote);
        out.newline(quote);
        out.startTag("p", "<p class=\"markdown-alert-title\">", quote);
        out.characters(alert.title, quote);
        out.endTag("p", quote);
        out.newline(quote);
        let kids = quote.children;
        let first = kids[0] as Paragraph orelse panic();
        let inlines = first.children;
        if (alert.restAt < inlines.length) {
          out.startTag("p", "<p>", first);
          let split = inlines[alert.restAt];
          if (alert.restText != "" && split is Text) {
            out.characters(alert.restText, split);
          } else {
            renderInline(split, out);
          }
          for (var i = alert.restAt + 1; i < inlines.length; i += 1) { renderInline(inlines[i], out); }
          out.endTag("p", first);
          out.newline(first);
        }
        for (var i = 1; i < kids.length; i += 1) { renderBlock(kids[i], false, out); }
        out.line(quote);
        out.endTag("div", quote);
        out.newline(quote);
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
            out.line(block);
            var id = "";
            if (options.headingIds) {
              let slug = out.uniqueSlug(slugOf(headingText(block.children, out.footnotes)));
              if (!slug.isEmpty) { id = " id=\"${escapeHtml("${options.headingIdPrefix}${slug}")}\""; }
            }
            out.startTag(tag, "<${tag}${id}>", block);
            renderInlines(block.children, out);
            out.endTag(tag, block);
            out.newline(block);
          };
          is Paragraph -> do {
            if (tight) {
              renderInlines(block.children, out);
            } else {
              out.line(block);
              out.startTag("p", "<p>", block);
              renderInlines(block.children, out);
              out.endTag("p", block);
              out.newline(block);
            }
          };
          is CodeBlock -> do {
            let language = block.language;
            out.line(block);
            out.startTag("pre", "<pre>", block);
            if (language.isEmpty) {
              out.startTag("code", "<code>", block);
            } else {
              out.startTag("code", "<code class=\"language-${escapeHtml(language)}\">", block);
            }
            renderCode(block.info, block.code, block, out);
            out.endTag("code", block);
            out.endTag("pre", block);
            out.newline(block);
          };
          is IndentedCode -> do {
            out.line(block);
            out.startTag("pre", "<pre>", block);
            out.startTag("code", "<code>", block);
            renderCode("", block.code, block, out);
            out.endTag("code", block);
            out.endTag("pre", block);
            out.newline(block);
          };
          is ThematicBreak -> do {
            out.line(block);
            out.startTag("hr", "<hr />", block);
            out.newline(block);
          };
          is HtmlBlock -> do {
            out.line(block);
            out.rawHtml(block, rawHtmlRenderer.renderRawHtml(block), block);
            out.line(block);
          };
          is BlockQuote -> do {
            out.line(block);
            out.startTag("blockquote", "<blockquote>", block);
            out.newline(block);
            renderBlocks(block.children, false, out);
            out.line(block);
            out.endTag("blockquote", block);
            out.newline(block);
          };
          is ListBlock -> do {
            let start = block.start;
            let tag = if (start == null) { "ul" } else { "ol" };
            out.line(block);
            out.startTag(tag, "<${tag}${startAttribute(start)}>", block);
            out.newline(block);
            let itemsTight = block.tight;
            let items = block.items;
            for (var i = 0; i < items.length; i += 1) {
              let item = items[i];
              out.line(item);
              out.startTag("li", "<li>", item);
              let task = item.task;
              if (task != null) {
                out.startTag(
                  "input",
                  if (task.checked) {
                    "<input type=\"checkbox\" checked=\"\" disabled=\"\" />"
                  } else {
                    "<input type=\"checkbox\" disabled=\"\" />"
                  },
                  item,
                );
                out.characters(" ", item);
              }
              renderBlocks(item.children, itemsTight, out);
              out.endTag("li", item);
              out.newline(item);
            }
            out.line(block);
            out.endTag(tag, block);
            out.newline(block);
          };
          is Table -> renderTable(block, out);
          is FootnoteDefinition -> do {};
          is LinkReferenceDefinition -> do {};
          is BlankLine -> do {};
        }
      }

Code, highlighted if the highlighter gives spans that join to it.

      private renderCode(info: String, code: String, block: MarkdownNode, out: HtmlOut): Void {
        if (options.highlights) {
          let highlighter = options.highlighter;
          let found = highlighter(info, code);
          // Typed apart, since Temper types `found` as any value, not null.
          let spans: List<HighlightSpan> = found ?? noSpans;
          if (found != null && spannedText(spans) == code) {
            for (var i = 0; i < spans.length; i += 1) {
              let span = spans[i];
              if (span.text.isEmpty) { continue; }
              if (span.className.isEmpty) {
                out.characters(span.text, block);
              } else {
                out.startTag("span", "<span class=\"${escapeHtml(span.className)}\">", block);
                out.characters(span.text, block);
                out.endTag("span", block);
              }
            }
            return;
          }
        }
        out.characters(code, block);
      }

A GFM table, as cmark-gfm writes it: `<thead>` with the header row,
then `<tbody>` with the rest, if any, each row with as many cells as
the header, filled in empty, and `align` on cells in aligned columns.

      private renderTable(table: Table, out: HtmlOut): Void {
        let alignments = table.alignments;
        out.line(table);
        out.startTag("table", "<table>", table);
        out.newline(table);
        out.startTag("thead", "<thead>", table);
        out.newline(table);
        renderRow(table.header, "th", alignments, out);
        out.endTag("thead", table);
        out.newline(table);
        let rows = table.rows;
        if (!rows.isEmpty) {
          out.startTag("tbody", "<tbody>", table);
          out.newline(table);
          for (var i = 0; i < rows.length; i += 1) { renderRow(rows[i], "td", alignments, out); }
          out.endTag("tbody", table);
          out.newline(table);
        }
        out.endTag("table", table);
        out.newline(table);
      }

Cells the row doesn't have are filled in empty, from the row.

      private renderRow(row: TableRow, tag: String, alignments: List<String>, out: HtmlOut): Void {
        let cells = row.cells;
        out.startTag("tr", "<tr>", row);
        out.newline(row);
        for (var i = 0; i < alignments.length; i += 1) {
          let alignment = alignments[i];
          let cell: MarkdownNode = if (i < cells.length) { cells[i] } else { row };
          out.startTag(tag, if (alignment == "none") { "<${tag}>" } else { "<${tag} align=\"${alignment}\">" }, cell);
          if (i < cells.length) { renderInlines(cells[i].children, out); }
          out.endTag(tag, cell);
          out.newline(cell);
        }
        out.endTag("tr", row);
        out.newline(row);
      }

      private renderInlines(inlines: List<ParagraphChild>, out: HtmlOut): Void {
        for (var i = 0; i < inlines.length; i += 1) {
          renderInline(inlines[i], out);
        }
      }

      private renderInline(inline: MarkdownNode, out: HtmlOut): Void {
        when (inline) {
          is Text -> out.characters(inline.text, inline);
          is CodeSpan -> do {
            out.startTag("code", "<code>", inline);
            out.characters(inline.code, inline);
            out.endTag("code", inline);
          };
          is RawHtml -> out.rawHtml(inline, rawHtmlRenderer.renderRawHtml(inline), inline);
          is CharacterReference -> out.characters(inline.value, inline);
          is FootnoteReference -> renderFootnoteReference(inline, out);
          is HardBreak -> do {
            out.startTag("br", "<br />", inline);
            out.newline(inline);
          };
          is Emphasis -> do {
            out.startTag("em", "<em>", inline);
            renderInlines(inline.children, out);
            out.endTag("em", inline);
          };
          is Strong -> do {
            out.startTag("strong", "<strong>", inline);
            if (out.gfm) { renderInStrong(inline.children, out); } else { renderInlines(inline.children, out); }
            out.endTag("strong", inline);
          };
          is Strikethrough -> do {
            out.startTag("del", "<del>", inline);
            renderInlines(inline.children, out);
            out.endTag("del", inline);
          };
          is Autolink -> do {
            out.startTag("a", "<a href=\"${escapeHref(inline.destination.url)}\">", inline);
            out.characters(inline.text, inline);
            out.endTag("a", inline);
          };
          is Link -> do {
            let target = linkDestinationOf(inline.node, out.definitions);
            if (target == null) {
              unresolved(inline, out);
            } else {
              let title = titleAttribute(linkTitleOf(inline.node, out.definitions));
              out.startTag("a", "<a href=\"${escapeHref(target.url)}\"${title}>", inline);
              let kids = inline.children;
              for (var i = 0; i < kids.length; i += 1) { renderInline(kids[i], out); }
              out.endTag("a", inline);
            }
          };
          is Image -> do {
            let target = linkDestinationOf(inline.node, out.definitions);
            if (target == null) {
              unresolved(inline, out);
            } else {
              let alt = new StringBuilder();
              addAltText(inline.children, alt, out.footnotes);
              let title = titleAttribute(linkTitleOf(inline.node, out.definitions));
              out.startTag(
                "img", "<img src=\"${escapeHref(target.url)}\" alt=\"${escapeHtml(alt.toString())}\"${title} />", inline,
              );
            }
          };
          else -> do {};
        }
      }

A strong's children in a GFM document, as cmark-gfm's renderer writes
them: a strong directly inside another adds no tags, so `****foo****`
is `<strong>foo</strong>`, and `**a **b** c**` is `<strong>a b
c</strong>`. The tree keeps both, as CommonMark parses them; only the
HTML differs, and it looks the same.

      private renderInStrong(inlines: List<ParagraphChild>, out: HtmlOut): Void {
        for (var i = 0; i < inlines.length; i += 1) {
          let inline = inlines[i];
          if (inline is Strong) { renderInStrong(inline.children, out); } else { renderInline(inline, out); }
        }
      }

A reference whose definition is gone, as after an edit: its brackets
and label as text, around its text rendered.

      private unresolved(view: MarkdownNode, out: HtmlOut): Void {
        let node = view.node;
        let kids = node.green.children;
        out.characters((kids[0] as GreenToken orelse panic()).text, view);
        renderInlines(paragraphChildrenOf(node), out);
        var after = false;
        for (var i = 1; i < kids.length; i += 1) {
          if (kids[i].kind.id == linkCloseKind.id) { after = true; }
          if (after) {
            let rest = new StringBuilder();
            kids[i].writeTo(rest);
            out.characters(rest.toString(), view);
          }
        }
      }
    }

The backlinks of footnote `number`, whose `id` is escaped already, to
each of its `count` references.

    let footnoteBacklinks(id: String, number: Int, count: Int, node: MarkdownNode, out: HtmlOut): Void {
      let n = number.toString();
      out.startTag(
        "a",
        "<a href=\"#fnref-${id}\" class=\"footnote-backref\" data-footnote-backref data-footnote-backref-idx=\"${n}\" aria-label=\"Back to reference ${n}\">",
        node,
      );
      out.characters("↩", node);
      out.endTag("a", node);
      for (var k = 2; k <= count; k += 1) {
        let m = "${n}-${k.toString()}";
        out.characters(" ", node);
        out.startTag(
          "a",
          "<a href=\"#fnref-${id}-${k.toString()}\" class=\"footnote-backref\" data-footnote-backref data-footnote-backref-idx=\"${m}\" aria-label=\"Back to reference ${m}\">",
          node,
        );
        out.characters("↩", node);
        out.startTag("sup", "<sup class=\"footnote-ref\">", node);
        out.characters(k.toString(), node);
        out.endTag("sup", node);
        out.endTag("a", node);
      }
    }

    let spannedText(spans: List<HighlightSpan>): String {
      let out = new StringBuilder();
      for (var i = 0; i < spans.length; i += 1) { out.append(spans[i].text); }
      out.toString()
    }

## Heading ids

A heading's text as the page shows it, for its id: what the renderer
writes as text, without tags, so without raw HTML's tags or images'
`alt`, and footnote references as their numbers.

    let headingText(inlines: List<ParagraphChild>, footnotes: FootnoteIndex?): String {
      let out = new StringBuilder();
      addHeadingText(inlines, out, footnotes);
      out.toString()
    }

    let addHeadingText(inlines: List<ParagraphChild>, out: StringBuilder, footnotes: FootnoteIndex?): Void {
      for (var i = 0; i < inlines.length; i += 1) {
        let inline = inlines[i];
        when (inline) {
          is Text -> out.append(inline.text);
          is CodeSpan -> out.append(inline.code);
          is CharacterReference -> out.append(inline.value);
          is Autolink -> out.append(inline.text);
          is Emphasis -> addHeadingText(inline.children, out, footnotes);
          is Strong -> addHeadingText(inline.children, out, footnotes);
          is Strikethrough -> addHeadingText(inline.children, out, footnotes);
          is Link -> addHeadingText(paragraphChildrenOf(inline.node), out, footnotes);
          is FootnoteReference -> do {
            let number = footnotes?.numberAt(inline.node.offset) ?? 0;
            out.append(if (number > 0) { number.toString() } else { "[^${inline.label}]" });
          };
          else -> do {};
        }
      }
    }

GitHub's slug of `text`, before numbering repeats: trimmed,
lowercased, spaces as `-`, and only `-` and word characters kept.

    let slugOf(text: String): String {
      var start = String.begin;
      var end = text.end;
      while (text.hasIndex(start) && isWhitespaceCode(text[start])) { start = text.next(start); }
      while (end > start && isWhitespaceCode(text[text.prev(end)])) { end = text.prev(end); }
      let lower = lowercase(text.slice(start, end));
      let out = new StringBuilder();
      var runStart = String.begin;
      var i = String.begin;
      while (lower.hasIndex(i)) {
        let c = lower[i];
        let next = lower.next(i);
        if (c == char' ') {
          out.append(lower.slice(runStart, i));
          out.append("-");
          runStart = next;
        } else if (c != char'-' && !isWordCharacter(c)) {
          out.append(lower.slice(runStart, i));
          runStart = next;
        }
        i = next;
      }
      out.append(lower.slice(runStart, lower.end));
      out.toString()
    }

    let isWhitespaceCode(c: Int): Boolean {
      c == char' ' || c == char'\t' || c == char'\n' || c == char'\r' || c == 0xC
    }

## Alerts

A block quote that's a GitHub alert: its `type` (`note`, `tip`,
`important`, `warning`, or `caution`) and `title`, and where the first
paragraph goes on after the marker's line, as an index among its
inlines and, if that's a `Text` the line ends in, the text after the
line break.

    class Alert(
      public quote: BlockQuote,
      public type: String,
      public title: String,
      public restAt: Int,
      public restText: String,
    ) {}

    let alertTypes = ["note", "tip", "important", "warning", "caution"];
    let alertTitles = ["Note", "Tip", "Important", "Warning", "Caution"];

The alert `quote` is, or null: its first block a paragraph whose first
line is only plain text, as written, that reads `[!NOTE]` or another
type, ignoring ASCII case and trailing spaces, and something after
that line.

    let alertOf(quote: BlockQuote): Alert? {
      let kids = quote.children;
      if (kids.isEmpty || !(kids[0] is Paragraph)) { return null; }
      let inlines = (kids[0] as Paragraph orelse panic()).children;
      let line = new StringBuilder();
      var restAt = inlines.length;
      var restText = "";
      for (var i = 0; i < inlines.length; i += 1) {
        let inline = inlines[i];
        if (inline is HardBreak) {
          restAt = i + 1;
          break;
        }
        if (!(inline is Text)) { return null; }
        let text = (inline as Text orelse panic()).text;
        let written = inline.asWritten;
        let breakAt = firstLineEnd(text);
        let firstLine = text.slice(String.begin, breakAt);
        // As written: no escapes or references on the marker's line.
        if (!startsWithText(written, firstLine)) { return null; }
        line.append(firstLine);
        if (text.hasIndex(breakAt)) {
          let rest = text.slice(text.next(breakAt), text.end);
          if (rest.isEmpty) {
            restAt = i + 1;
          } else {
            restAt = i;
            restText = rest;
          }
          break;
        }
      }
      let marker = asciiLowercase(trimEnd(line.toString()));
      for (var k = 0; k < alertTypes.length; k += 1) {
        if (marker == "[!${alertTypes[k]}]") {
          var more = restAt < inlines.length;
          for (var j = 1; j < kids.length; j += 1) {
            let kid = kids[j];
            if (!(kid is BlankLine || kid is LinkReferenceDefinition)) { more = true; }
          }
          return if (more) { new Alert(quote, alertTypes[k], alertTitles[k], restAt, restText) } else { null };
        }
      }
      null
    }

    let firstLineEnd(text: String): StringIndex {
      var i = String.begin;
      while (text.hasIndex(i) && text[i] != char'\n') { i = text.next(i); }
      i
    }

    let trimEnd(text: String): String {
      var end = text.end;
      while (end > String.begin && (text[text.prev(end)] == char' ' || text[text.prev(end)] == char'\t')) {
        end = text.prev(end);
      }
      text.slice(String.begin, end)
    }

    let titleAttribute(title: String?): String {
      if (title != null) { " title=\"${escapeHtml(title)}\"" } else { "" }
    }

An image's description as `alt` text: plain text, with line breaks as
spaces, as cmark writes it. A footnote reference adds nothing, unless
it has no definition; then it's its text.

    let addAltText(inlines: List<ParagraphChild>, out: StringBuilder, footnotes: FootnoteIndex?): Void {
      for (var i = 0; i < inlines.length; i += 1) {
        let inline = inlines[i];
        when (inline) {
          is Text -> out.append(lineBreaksAsSpaces(inline.text));
          is CodeSpan -> out.append(inline.code);
          is RawHtml -> out.append(inline.html);
          is CharacterReference -> out.append(inline.value);
          is HardBreak -> out.append(" ");
          is Autolink -> out.append(inline.text);
          is Emphasis -> addAltText(inline.children, out, footnotes);
          is Strong -> addAltText(inline.children, out, footnotes);
          is Strikethrough -> addAltText(inline.children, out, footnotes);
          is Image -> addAltText(inline.children, out, footnotes);
          is Link -> addAltText(paragraphChildrenOf(inline.node), out, footnotes);
          is FootnoteReference -> if ((footnotes?.numberAt(inline.node.offset) ?? 0) == 0) {
            out.append("[^${inline.label}]");
          };
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
      out.append("%");
      out.appendCodePoint(hexDigit(b >> 4)) orelse panic();
      out.appendCodePoint(hexDigit(b & 15)) orelse panic();
    }

    let hexDigit(d: Int): Int {
      if (d < 10) { char'0' + d } else { char'A' + d - 10 }
    }

A list's `start` attribute: for an ordered list not starting at 1.

    let startAttribute(start: Int?): String {
      if (start != null) {
        if (start != 1) { return " start=\"${start.toString()}\""; }
      }
      ""
    }

Output that knows whether it's at the start of a line, for cmark's
layout: each block starts on a new line. It writes a string, or hands
a `RenderSink` each part.

    class HtmlOut {
      private out: StringBuilder = new StringBuilder();
      private var atLineStart: Boolean = true;
      private sink: RenderSink?;

The document's definitions, for reference links.

      public definitions: Map<String, LinkReferenceDefinition>;

Whether the document was parsed with GFM, so renders as cmark-gfm does.

      public gfm: Boolean;

How the document's footnotes number, if it was parsed with them.

      public footnotes: FootnoteIndex?;

Heading ids given so far, each with how many repeats of it there were,
as github-slugger counts them.

      private slugs: MapBuilder<String, Int> = new MapBuilder<String, Int>();

      public uniqueSlug(base: String): String {
        var result = base;
        while (slugs.has(result)) {
          let n = slugs.getOr(base, 0) + 1;
          slugs[base] = n;
          result = "${base}-${n.toString()}";
        }
        slugs[result] = 0;
        result
      }

      public constructor(
        definitions: Map<String, LinkReferenceDefinition>, gfm: Boolean, footnotes: FootnoteIndex?,
        sink: RenderSink?,
      ) {
        this.definitions = definitions;
        this.gfm = gfm;
        this.footnotes = footnotes;
        this.sink = sink;
      }

      public startTag(name: String, written: String, node: MarkdownNode): Void {
        let s = sink;
        if (s == null) { out.append(written); } else { s.startTag(name, written, node); }
        atLineStart = false;
      }

      public endTag(name: String, node: MarkdownNode): Void {
        let s = sink;
        if (s == null) {
          out.append("</");
          out.append(name);
          out.append(">");
        } else {
          s.endTag(name, node);
        }
        atLineStart = false;
      }

Text, escaped as it's written.

      public characters(text: String, node: MarkdownNode): Void {
        if (text.isEmpty) { return; }
        let s = sink;
        if (s == null) { out.append(escapeHtml(text)); } else { s.characters(text, node); }
        atLineStart = text[text.prev(text.end)] == char'\n';
      }

      public newline(node: MarkdownNode): Void {
        let s = sink;
        if (s == null) { out.append("\n"); } else { s.characters("\n", node); }
        atLineStart = true;
      }

      public rawHtml(content: RawHtmlContent, rendered: String, node: MarkdownNode): Void {
        if (rendered.isEmpty) { return; }
        let s = sink;
        if (s == null) { out.append(rendered); } else { s.rawHtml(content, rendered, node); }
        atLineStart = rendered[rendered.prev(rendered.end)] == char'\n';
      }

A line break, unless at the start of a line.

      public line(node: MarkdownNode): Void {
        if (!atLineStart) { newline(node); }
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

A strong directly inside a strong: nested, as CommonMark writes it,
but one `<strong>` in a GFM document, as cmark-gfm writes it, with the
tree the same either way. A link or emphasis between them keeps both,
and emphasis inside emphasis is unchanged.

    test("rendering: a strong in a strong, as CommonMark and as GFM") {
      let text = "****a****\n\n**b **c** d**\n\n**[**e**](/u)** ***f*** **_**g**_**\n\n*_h_*\n";
      let plain = parseMarkdown(text);
      let gfm = MarkdownParser.gfm.parse(text);
      let outer = gfm.blocks[0] as Paragraph orelse panic();
      let strong = outer.children[0] as Strong orelse panic();
      assert(strong.children[0] is Strong && gfm.asWritten == text) { "keeps the tree" };
      let cm = plain.toHtml();
      let expectedCm = [
        "<p><strong><strong>a</strong></strong></p>\n",
        "<p><strong>b <strong>c</strong> d</strong></p>\n",
        "<p><strong><a href=\"/u\"><strong>e</strong></a></strong> <em><strong>f</strong></em> ",
        "<strong><em><strong>g</strong></em></strong></p>\n<p><em><em>h</em></em></p>\n",
      ].join("") { (s: String): String => s };
      assert(cm == expectedCm) { cm };
      let expectedGfm = [
        "<p><strong>a</strong></p>\n",
        "<p><strong>b c d</strong></p>\n",
        "<p><strong><a href=\"/u\"><strong>e</strong></a></strong> <em><strong>f</strong></em> ",
        "<strong><em><strong>g</strong></em></strong></p>\n<p><em><em>h</em></em></p>\n",
      ].join("") { (s: String): String => s };
      let html = gfm.toHtml();
      assert(html == expectedGfm) { html };
      let tablesOnly = MarkdownParser.commonMark.withTables(true).parse(text).toHtml();
      assert(tablesOnly == expectedGfm) { tablesOnly };
    }

What `renderTo` hands a sink: each part, with its node.

    class RecordingSink extends RenderSink {
      public out: StringBuilder = new StringBuilder();
      public constructor() {}
      public startTag(name: String, written: String, node: MarkdownNode): Void {
        out.append("S:${written}@${node.node.kind.name};");
      }
      public endTag(name: String, node: MarkdownNode): Void { out.append("E:${name}@${node.node.kind.name};"); }
      public characters(text: String, node: MarkdownNode): Void { out.append("T:${text}@${node.node.kind.name};"); }
      public rawHtml(content: RawHtmlContent, rendered: String, node: MarkdownNode): Void {
        out.append("R:${rendered}@${node.node.kind.name};");
      }
    }

    test("rendering to a sink, part by part") {
      let doc = parseMarkdown("# A\n\nx <b>y</b> `<z>`\n");
      let sink = new RecordingSink();
      new MarkdownRenderer().withRawHtmlTrusted().renderTo(doc, sink);
      let parts = sink.out.toString();
      let expected = [
        "S:<h1>@Heading;T:A@Text;E:h1@Heading;T:\n@Heading;",
        "S:<p>@Paragraph;T:x @Text;R:<b>@RawHtml;T:y@Text;R:</b>@RawHtml;T: @Text;",
        "S:<code>@CodeSpan;T:<z>@CodeSpan;E:code@CodeSpan;E:p@Paragraph;T:\n@Paragraph;",
      ].join("") { (s: String): String => s };
      assert(parts == expected) { parts };
      let escaped = new RecordingSink();
      new MarkdownRenderer().renderTo(doc, escaped);
      assert(escaped.out.toString().split("R:&lt;b&gt;@RawHtml;").length == 2) { escaped.out.toString() };
    }

### Heading ids

GitHub's documented examples ("Section links", in its docs on basic
writing and formatting syntax), and more: markup, raw HTML, code,
references, footnotes, and repeats of repeats, numbered as
github-slugger numbers them.

    let idsOf(html: String): String {
      let parts = html.split(" id=\"");
      let out = new ListBuilder<String>();
      for (var i = 1; i < parts.length; i += 1) { out.add(parts[i].split("\"")[0]); }
      out.toList().join(" ") { (s: String): String => s }
    }

    test("heading ids, as GitHub's") {
      let doc = MarkdownParser.gfm.parse([
        "# Example headings\n\n## Sample Section\n\n",
        "## This'll  be a _Helpful_ Section About the Greek Letter \u{398}!\n\n",
        "## This    heading is not unique in the file\n\nTEXT 1\n\n",
        "## This    heading is not unique in the file\n\nTEXT 2\n",
      ].join("") { (s: String): String => s });
      let html = new MarkdownRenderer().withHeadingIds().render(doc);
      let expected = [
        "<h1 id=\"example-headings\">Example headings</h1>\n<h2 id=\"sample-section\">Sample Section</h2>\n",
        "<h2 id=\"thisll--be-a-helpful-section-about-the-greek-letter-\u{3B8}\">This'll  be a <em>Helpful</em> Section About the Greek Letter \u{398}!</h2>\n",
        "<h2 id=\"this----heading-is-not-unique-in-the-file\">This    heading is not unique in the file</h2>\n<p>TEXT 1</p>\n",
        "<h2 id=\"this----heading-is-not-unique-in-the-file-1\">This    heading is not unique in the file</h2>\n<p>TEXT 2</p>\n",
      ].join("") { (s: String): String => s };
      assert(html == expected) { html };
      let more = MarkdownParser.gfm.parse([
        "# `a.b` & <b>C</b> [D](/d) ![e](/e.png) f_g\n# A\n# A\n# A-1\n# !!!\n# Ünïcödé Straße İ\n",
        "Setext\nheading\n---\n## Note[^1]\n\n[^1]: x\n",
      ].join("") { (s: String): String => s });
      let ids = idsOf(new MarkdownRenderer().withHeadingIds("user-content-").render(more));
      let expectedIds = [
        "user-content-ab--c-d--f_g", "user-content-a", "user-content-a-1", "user-content-a-1-1",
        "user-content-\u{FC}n\u{EF}c\u{F6}d\u{E9}-stra\u{DF}e-i\u{307}", "user-content-setextheading",
        "user-content-note1", "fnref-1", "fn-1",
      ].join(" ") { (s: String): String => s };
      assert(ids == expectedIds) { ids };
      assert(idsOf(more.toHtml()) == "fnref-1 fn-1") { "off by default" };
    }

### Alerts

Each of GitHub's five types, as its docs on basic writing and
formatting syntax show them (with our own words), and what isn't an
alert.

    test("alerts, as GitHub's") {
      let types = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
      let titles = ["Note", "Tip", "Important", "Warning", "Caution"];
      let says = [
        "Worth knowing, even when skimming.", "A better or easier way.", "Needed to reach the goal.",
        "Needs attention now, to avoid trouble.", "Risks, or what can go wrong.",
      ];
      let alerts = new MarkdownRenderer().withAlerts();
      for (var i = 0; i < types.length; i += 1) {
        let html = alerts.render(MarkdownParser.gfm.parse("> [!${types[i]}]\n> ${says[i]}\n"));
        let expected = "<div class=\"markdown-alert markdown-alert-${asciiLowercase(types[i])}\">\n<p class=\"markdown-alert-title\">${titles[i]}</p>\n<p>${says[i]}</p>\n</div>\n";
        assert(html == expected) { html };
      }
      let more = alerts.render(MarkdownParser.gfm.parse("> [!tip]  \n> **Bold** advice.\n>\n> - and a list\n"));
      assert(more == "<div class=\"markdown-alert markdown-alert-tip\">\n<p class=\"markdown-alert-title\">Tip</p>\n<p><strong>Bold</strong> advice.</p>\n<ul>\n<li>and a list</li>\n</ul>\n</div>\n") { more };
      let blank = alerts.render(parseMarkdown("> [!Warning]\n>\n> Hot.\n"));
      assert(blank == "<div class=\"markdown-alert markdown-alert-warning\">\n<p class=\"markdown-alert-title\">Warning</p>\n<p>Hot.</p>\n</div>\n") { blank };
      let notAlerts = [
        "> [!NOTE] on one line\n", "> [!NOTE]\n", "> \\[!NOTE]\n> escaped\n", "> [!INFO]\n> unknown\n",
        "> > [!NOTE]\n> > nested\n", "- > [!NOTE]\n  > in a list\n", "> *[!NOTE]*\n> emphasis\n",
        "> x\n> [!NOTE]\n> second line\n", "[!NOTE]\nnot quoted\n",
      ];
      for (var i = 0; i < notAlerts.length; i += 1) {
        let doc = MarkdownParser.gfm.parse(notAlerts[i]);
        let html = alerts.render(doc);
        assert(html == doc.toHtml()) { "${i.toString()}: ${html}" };
      }
      let plain = MarkdownParser.gfm.parse("> [!NOTE]\n> x\n");
      assert(plain.toHtml() == "<blockquote>\n<p>[!NOTE]\nx</p>\n</blockquote>\n") { "off by default" };
    }

### Highlighting

A highlighter's spans are written escaped, classes too, so nothing it
gives becomes markup, and spans that don't join to the code are
ignored.

    test("code highlighting, safe whatever the highlighter gives") {
      let doc = parseMarkdown("```py extra\nif a < b: pass\n```\n\n    indented\n\n```\n<i>x</i>\n```\n");
      let calls = new ListBuilder<String>();
      let html = new MarkdownRenderer().withCodeHighlighter { (info: String, code: String): List<HighlightSpan>? =>
        calls.add(info);
        if (info == "py extra") {
          [new HighlightSpan("k", "if"), new HighlightSpan("", " a < b: "), new HighlightSpan("k", "pass"), new HighlightSpan("", "\n")]
        } else if (info == "") {
          [new HighlightSpan("x\" onmouseover=\"alert(1)", code)]
        } else {
          null
        }
      }.render(doc);
      let expected = [
        "<pre><code class=\"language-py\"><span class=\"k\">if</span> a &lt; b: <span class=\"k\">pass</span>\n</code></pre>\n",
        "<pre><code><span class=\"x&quot; onmouseover=&quot;alert(1)\">indented\n</span></code></pre>\n",
        "<pre><code><span class=\"x&quot; onmouseover=&quot;alert(1)\">&lt;i&gt;x&lt;/i&gt;\n</span></code></pre>\n",
      ].join("") { (s: String): String => s };
      assert(html == expected) { html };
      assert(calls.toList().join("|") { (s: String): String => s } == "py extra||") { "info strings" };
      let changing = new MarkdownRenderer().withCodeHighlighter { (info: String, code: String): List<HighlightSpan>? =>
        [new HighlightSpan("k", "<script>alert(1)</script>")]
      }.render(doc);
      assert(changing == doc.toHtml()) { changing };
    }
