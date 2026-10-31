# Typed views and edits

Typed views over the red tree. Each wraps one red node, so it's cheap
to make and knows its span and its text as written. The types say
where each node may go, after Mike's idea of nesting in the types:

- **`BlockChild`:** blocks, which go in a document, a block quote, or a
  list item: `Heading`, `Paragraph`, `CodeBlock`, `IndentedCode`,
  `ThematicBreak`, `HtmlBlock`, `LinkReferenceDefinition`,
  `BlockQuote`, `ListBlock`, and `BlankLine`.
- **`ListChild`:** what a list holds, `ListItem` and `BlankLine`.
- **`ParagraphChild`:** inlines, `Text`, `CodeSpan`, and `RawHtml`,
  which headings hold too.

Later, `LinkTextChild` would be implemented by the inlines a link's
text may hold, every `ParagraphChild` but links, since links can't
nest.

Edits give a new `MarkdownDocument`, changing only the edited node's
text and sharing every untouched green node; the old document stays as
it was.

    let {
      GreenElement, GreenNode, GreenToken, Kind, RedElement, RedNode, RedToken, SourceText, Span,
    } = import("../kelpto-core");

    export sealed interface MarkdownNode {

The red node this views.

      public node: RedNode;

The text exactly as written, and where.

      public get asWritten(): String;
      public get span(): Span;
    }

    export sealed interface BlockChild extends MarkdownNode {}
    export sealed interface ListChild extends MarkdownNode {}
    export sealed interface ParagraphChild extends MarkdownNode {}

Raw HTML, inline or a block: what a `RawHtmlRenderer` renders, and
what the `kelpto` library views as HTML.

    export interface RawHtmlContent {

The HTML as CommonMark reads it, without any container prefixes
between its lines. Not checked or sanitized.

      public get html(): String;

The subtree a handler made, if any: a red node another library's
views can wrap.

      public get htmlNode(): RedNode?;

Whether this is an HTML block, rather than inline.

      public get isBlock(): Boolean;
    }

A link destination, as written in the Markdown but with escapes
resolved. A wrapper on `String` for now, with no URL processing.

    export class LinkTarget(public url: String) {
      public toString(): String { url }
    }

## Documents

    export class MarkdownDocument extends MarkdownNode {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The top-level blocks, in order, blank lines included.

      public get children(): List<BlockChild> { blockChildrenOf(node) }

Every block, depth first: each container before what it holds, and
list items' blocks, but not the items themselves.

      public get blocks(): List<BlockChild> {
        let result = new ListBuilder<BlockChild>();
        addBlocks(children, result);
        result.toList()
      }

      public get headings(): List<Heading> {
        let result = new ListBuilder<Heading>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is Heading) { result.add(block); }
        }
        result.toList()
      }

Fenced code blocks.

      public get codeBlocks(): List<CodeBlock> {
        let result = new ListBuilder<CodeBlock>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is CodeBlock) { result.add(block); }
        }
        result.toList()
      }

      public get linkReferenceDefinitions(): List<LinkReferenceDefinition> {
        let result = new ListBuilder<LinkReferenceDefinition>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is LinkReferenceDefinition) { result.add(block); }
        }
        result.toList()
      }

      public get htmlBlocks(): List<HtmlBlock> {
        let result = new ListBuilder<HtmlBlock>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is HtmlBlock) { result.add(block); }
        }
        result.toList()
      }

Every inline raw HTML span in headings and paragraphs, in order. HTML
blocks are in `htmlBlocks`.

      public get rawHtml(): List<RawHtml> {
        let result = new ListBuilder<RawHtml>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          let inlines = when (block) {
            is Heading -> block.children;
            is Paragraph -> block.children;
            else -> [];
          };
          for (var j = 0; j < inlines.length; j += 1) {
            let inline = inlines[j];
            if (inline is RawHtml) { result.add(inline); }
          }
        }
        result.toList()
      }

HTML with the default, escaping raw HTML. See `MarkdownRenderer`.

      public toHtml(): String { new MarkdownRenderer().render(this) }
    }

    let addBlocks(blocks: List<BlockChild>, result: ListBuilder<BlockChild>): Void {
      for (var i = 0; i < blocks.length; i += 1) {
        let block = blocks[i];
        result.add(block);
        when (block) {
          is BlockQuote -> addBlocks(block.children, result);
          is ListBlock -> do {
            let items = block.items;
            for (var j = 0; j < items.length; j += 1) {
              addBlocks(items[j].children, result);
            }
          };
          else -> do {};
        }
      }
    }

The typed view of a block node.

    let blockChildOf(node: RedNode): BlockChild {
      if (node.hasKind(headingKind) || node.hasKind(setextHeadingKind)) { return new Heading(node); }
      if (node.hasKind(paragraphKind)) { return new Paragraph(node); }
      if (node.hasKind(codeBlockKind)) { return new CodeBlock(node); }
      if (node.hasKind(indentedCodeKind)) { return new IndentedCode(node); }
      if (node.hasKind(thematicBreakKind)) { return new ThematicBreak(node); }
      if (node.hasKind(htmlBlockKind)) { return new HtmlBlock(node); }
      if (node.hasKind(linkReferenceDefinitionKind)) { return new LinkReferenceDefinition(node); }
      if (node.hasKind(blockQuoteKind)) { return new BlockQuote(node); }
      if (node.hasKind(listKind)) { return new ListBlock(node); }
      new BlankLine(node)
    }

The blocks in a document, block quote, or list item: its child nodes,
since container prefixes are tokens.

    let blockChildrenOf(node: RedNode): List<BlockChild> {
      let result = new ListBuilder<BlockChild>();
      let nodes = node.childNodes;
      for (var i = 0; i < nodes.length; i += 1) {
        result.add(blockChildOf(nodes[i]));
      }
      result.toList()
    }

    let paragraphChildrenOf(content: RedNode): List<ParagraphChild> {
      let result = new ListBuilder<ParagraphChild>();
      let nodes = content.childNodes;
      for (var i = 0; i < nodes.length; i += 1) {
        let child = nodes[i];
        if (child.hasKind(codeSpanKind)) {
          result.add(new CodeSpan(child));
        } else if (child.hasKind(rawHtmlKind)) {
          result.add(new RawHtml(child));
        } else {
          result.add(new Text(child));
        }
      }
      result.toList()
    }

The text of inlines without markup: code spans' code, and raw HTML as
written.

    let plainTextOf(children: List<ParagraphChild>): String {
      let out = new StringBuilder();
      for (var i = 0; i < children.length; i += 1) {
        let child = children[i];
        when (child) {
          is Text -> out.append(child.text);
          is CodeSpan -> out.append(child.code);
          is RawHtml -> out.append(child.html);
        }
      }
      out.toString()
    }

    let contentOf(node: RedNode): RedNode {
      node.childOfKind(inlineContentKind) as RedNode orelse panic()
    }

The text of the tokens of `kind` in `node`, at any depth, with line
endings between them as written, and nothing else: no container
prefixes or whitespace around line breaks.

    let tokenTextOf(node: RedNode, kind: Kind): String {
      let out = new StringBuilder();
      addTokenText(node.green, kind, out);
      out.toString()
    }

    let addTokenText(green: GreenNode, kind: Kind, out: StringBuilder): Void {
      let kids = green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        when (kid) {
          is GreenNode -> addTokenText(kid, kind, out);
          is GreenToken -> if (kid.kind.id == kind.id || kid.kind.id == lineEndingKind.id) {
            out.append(kid.text);
          };
        }
      }
    }

Code from a code block's direct children: code lines, tab remainders
as spaces, and line endings as `\n`, each line ending in `\n`.

    let codeOf(node: RedNode): String {
      let out = new StringBuilder();
      var lineOpen = false;
      let kids = node.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid is GreenToken) {
          let id = kid.kind.id;
          let columns = tabRemainderColumns(kid.kind);
          if (id == codeLineKind.id) {
            out.append(kid.text);
            lineOpen = true;
          } else if (columns > 0) {
            for (var k = 0; k < columns; k += 1) { out.append(" "); }
            lineOpen = true;
          } else if (id == lineEndingKind.id) {
            out.append("\n");
            lineOpen = false;
          }
        }
      }
      if (lineOpen) { out.append("\n"); }
      out.toString()
    }

Raw HTML's text: as written, if a handler got it whole, or else its
opaque pieces with tab remainders as spaces and line endings, leaving
out container prefixes.

    let rawHtmlTextOf(node: RedNode): String {
      let kids = node.green.children;
      var pieces = false;
      for (var i = 0; i < kids.length; i += 1) {
        let id = kids[i].kind.id;
        if (id == lineEndingKind.id || tabRemainderColumns(kids[i].kind) > 0 || id == indentKind.id) {
          pieces = true;
        }
      }
      if (!pieces) { return node.asWritten; }
      let out = new StringBuilder();
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        let id = kid.kind.id;
        let columns = tabRemainderColumns(kid.kind);
        if (id == htmlTextKind.id || id == lineEndingKind.id) {
          out.append((kid as GreenToken orelse panic()).text);
        } else if (columns > 0) {
          for (var k = 0; k < columns; k += 1) { out.append(" "); }
        }
      }
      out.toString()
    }

    let htmlNodeOf(node: RedNode): RedNode? {
      let nodes = node.childNodes;
      if (nodes.isEmpty) { null } else { nodes[0] }
    }

`text` with backslash escapes resolved.

    let unescape(text: String): String {
      let source = new SourceText(text);
      let out = new StringBuilder();
      var i = 0;
      while (i < source.length) {
        if (source.codeAt(i) == char'\\' && isAsciiPunctuation(source.codeAt(i + 1))) {
          i += 1;
        }
        out.append(source.slice(i, i + 1));
        i += 1;
      }
      out.toString()
    }

## Blocks

A heading: ATX, such as `## Usage`, or setext, its text underlined by
`=` or `-`.

    export class Heading extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

`"atx"` or `"setext"`.

      public get style(): String {
        if (node.hasKind(setextHeadingKind)) { "setext" } else { "atx" }
      }

1 to 6: the number of `#`, or 1 for a `=` underline and 2 for `-`.

      public get level(): Int {
        let underline = node.childOfKind(setextMarkerKind);
        if (underline != null) {
          return if (new SourceText(underline.asWritten).codeAt(0) == char'=') { 1 } else { 2 };
        }
        (node.childOfKind(atxMarkerKind) as RedToken orelse panic()).span.length
      }

      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }

The text without markup, such as `Usage`.

      public get text(): String { plainTextOf(children) }

A new document with this heading's text replaced by `text`, escaped
so it reads as plain text. Only the heading's content changes; its
markers, closing sequence, and whitespace stay as written. Line breaks
in `text` become spaces, so a setext heading becomes one line.

      public withText(text: String): MarkdownDocument {
        let content = contentOf(node);
        let newContent = inlineContentGreen(escapeInline(text));
        let kids = node.green.children.toListBuilder();
        kids.set(content.index, newContent);
        if (newContent.width > 0) {

Keep the content apart from the marker and any closing sequence, so
`#` with no text becomes `# New`, not `#New`.

          let after = content.index + 1;
          if (after < kids.length && kids[after].kind.id == closingSequenceKind.id) {
            kids.add(new GreenToken(whitespaceKind, " "), after);
          }
          if (content.index > 0 && kids[content.index - 1].kind.id == atxMarkerKind.id) {
            kids.add(new GreenToken(whitespaceKind, " "), content.index);
          }
        }
        new MarkdownDocument(node.replaceWith(new GreenNode(node.kind, kids.toList())))
      }

A new document with this heading at `level`, changing only its
marker: the number of `#`, or a setext underline's character, kept
the same length. Bubbles for a level outside 1 to 6, or past 2 for a
setext heading, which has no such levels.

      public withLevel(level: Int): MarkdownDocument throws Bubble {
        if (level < 1 || level > 6) { bubble(); }
        let underline = node.childOfKind(setextMarkerKind);
        if (underline != null) {
          if (level > 2) { bubble(); }
          let token = underline as RedToken orelse panic();
          let mark = if (level == 1) { "=" } else { "-" };
          let out = new StringBuilder();
          for (var i = 0; i < token.span.length; i += 1) { out.append(mark); }
          return new MarkdownDocument(token.replaceWith(new GreenToken(setextMarkerKind, out.toString())));
        }
        let marker = node.childOfKind(atxMarkerKind) as RedToken orelse panic();
        let out = new StringBuilder();
        for (var i = 0; i < level; i += 1) { out.append("#"); }
        new MarkdownDocument(marker.replaceWith(new GreenToken(atxMarkerKind, out.toString())))
      }
    }

A paragraph.

    export class Paragraph extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }
      public get text(): String { plainTextOf(children) }
    }

A fenced code block, such as:

````md
```rust
fn main() {}
```
````

    export class CodeBlock extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      private get openingFence(): RedNode { node.childNodes[0] }

The info string after the opening fence, such as `rust`, or empty,
with backslash escapes resolved. Not yet: entity references.

      public get info(): String {
        let info = openingFence.childOfKind(infoKind);
        if (info == null) { "" } else { unescape(info.asWritten) }
      }

The info string's first word, which CommonMark uses for the language.

      public get language(): String {
        let source = new SourceText(info);
        var end = 0;
        while (end < source.length && source.codeAt(end) != char' ' && source.codeAt(end) != char'\t') {
          end += 1;
        }
        source.slice(0, end)
      }

The code, each line ending in `\n`, with as much indentation removed
from each line as the opening fence had, as CommonMark reads it.

      public get code(): String { codeOf(node) }

A new document with this block's info string replaced by `info`
(trimmed; empty removes it), as written, so escapes stay escapes.
Only the info string changes; the fences, whitespace, and code stay as
written. Bubbles if `info` has a line break, or a backtick after a
backtick fence, which would change what the fence means.

      public withInfo(info: String): MarkdownDocument throws Bubble {
        let source = new SourceText(info);
        var start = 0;
        while (start < source.length && isSpaceOrTab(source.codeAt(start))) { start += 1; }
        let end = trimBlanksBack(source, start, source.length);
        let trimmed = source.slice(start, end);
        let backtickFence = new SourceText(openingFence.childOfKind(fenceKind)?.asWritten ?? "").codeAt(0) == char'`';
        for (var i = start; i < end; i += 1) {
          let c = source.codeAt(i);
          if (c == char'\n' || c == char'\r' || (c == char'`' && backtickFence)) {
            bubble();
          }
        }
        let opening = openingFence;
        let kids = opening.green.children.toListBuilder();
        let old = opening.childOfKind(infoKind);
        if (old != null) {
          if (trimmed.isEmpty) {
            kids.splice(old.index, 1);
          } else {
            kids.set(old.index, new GreenToken(infoKind, trimmed));
          }
        } else if (!trimmed.isEmpty) {

No info before: put it after the fence and any whitespace there.

          var at = (opening.childOfKind(fenceKind) as RedToken orelse panic()).index + 1;
          if (at < kids.length && kids[at].kind.id == whitespaceKind.id) { at += 1; }
          kids.add(new GreenToken(infoKind, trimmed), at);
        }
        new MarkdownDocument(opening.replaceWith(new GreenNode(openingFenceKind, kids.toList())))
      }
    }

An indented code block: lines indented four or more columns.

    export class IndentedCode extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The code, each line ending in `\n`, without the four columns of
indentation.

      public get code(): String { codeOf(node) }
    }

A thematic break, such as `---` or `* * *`.

    export class ThematicBreak extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The marker character: `*`, `-`, or `_`.

      public get marker(): String {
        let written = node.childOfKind(thematicBreakMarkerKind)?.asWritten ?? "";
        new SourceText(written).slice(0, 1)
      }
    }

An HTML block, one of CommonMark's seven kinds, such as `<div>` and
the lines up to a blank line. Its children are whatever the
`RawHtmlHandler` gave, as for `RawHtml`.

    export class HtmlBlock extends BlockChild & RawHtmlContent {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get html(): String { rawHtmlTextOf(node) }
      public get htmlNode(): RedNode? { htmlNodeOf(node) }
      public get isBlock(): Boolean { true }
    }

A link reference definition, such as `[home]: https://example.com/
"Home"`. It renders as nothing; links use it.

    export class LinkReferenceDefinition extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The label between the brackets, as written, line breaks included. Not
yet: matching labels as CommonMark does, ignoring case and runs of
whitespace.

      public get label(): String {
        let label = node.childOfKind(linkLabelKind) as RedNode orelse panic();
        let written = new SourceText(tokenTextOf(label, labelTextKind));
        written.slice(1, written.length - 1)
      }

The destination, without angle brackets and with escapes resolved.

      public get destination(): LinkTarget {
        let written = node.childOfKind(linkDestinationKind)?.asWritten ?? "";
        let source = new SourceText(written);
        let inner = if (source.codeAt(0) == char'<') {
          source.slice(1, source.length - 1)
        } else {
          written
        };
        new LinkTarget(unescape(inner))
      }

The title without its quotes or parentheses, with escapes resolved,
or null.

      public get title(): String? {
        let title = node.childOfKind(linkTitleKind);
        if (title == null) { return null; }
        let written = new SourceText(tokenTextOf(title as RedNode orelse panic(), titleTextKind));
        unescape(written.slice(1, written.length - 1))
      }

A new document with the destination replaced by `target`, written in
angle brackets if it needs them. Only the destination changes.
Bubbles if `target` has a line break, which a destination can't hold.

      public withDestination(target: LinkTarget): MarkdownDocument throws Bubble {
        let destination = node.childOfKind(linkDestinationKind) as RedToken orelse panic();
        let written = writeDestination(target.url);
        new MarkdownDocument(destination.replaceWith(new GreenToken(linkDestinationKind, written)))
      }
    }

`url` as a link destination: as is if it can be, or else in angle
brackets, with `<`, `>`, and `\` escaped.

    let writeDestination(url: String): String throws Bubble {
      let source = new SourceText(url);
      var plain = source.length > 0 && source.codeAt(0) != char'<';
      var depth = 0;
      for (var i = 0; i < source.length; i += 1) {
        let c = source.codeAt(i);
        if (c == char'\n' || c == char'\r') { bubble(); }
        if (c <= 0x20 || c == 0x7F || c == char'\\') { plain = false; }
        if (c == char'(') { depth += 1; }
        if (c == char')') {
          depth -= 1;
          if (depth < 0) { plain = false; }
        }
      }
      if (plain && depth == 0) { return url; }
      let out = new StringBuilder();
      out.append("<");
      for (var i = 0; i < source.length; i += 1) {
        let c = source.codeAt(i);
        if (c == char'<' || c == char'>' || c == char'\\') { out.append("\\"); }
        out.append(source.slice(i, i + 1));
      }
      out.append(">");
      out.toString()
    }

A block quote: lines starting with `>`, holding blocks.

    export class BlockQuote extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<BlockChild> { blockChildrenOf(node) }
    }

A list: items with the same kind of marker, bullets or numbers.

    export class ListBlock extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

Items and the blank lines between them.

      public get children(): List<ListChild> {
        let result = new ListBuilder<ListChild>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          let child = nodes[i];
          if (child.hasKind(listItemKind)) {
            result.add(new ListItem(child));
          } else {
            result.add(new BlankLine(child));
          }
        }
        result.toList()
      }

      public get items(): List<ListItem> {
        let result = new ListBuilder<ListItem>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          if (nodes[i].hasKind(listItemKind)) { result.add(new ListItem(nodes[i])); }
        }
        result.toList()
      }

      private get first(): ListItem {
        new ListItem(node.childOfKind(listItemKind) as RedNode orelse panic())
      }

Whether its markers are numbers.

      public get ordered(): Boolean { first.number != null }

The first item's number, or null for a bullet list.

      public get start(): Int? { first.number }

The bullet (`-`, `+`, or `*`), or the delimiter after the numbers (`.`
or `)`).

      public get marker(): String {
        let written = new SourceText(first.marker);
        written.slice(written.length - 1, written.length)
      }

Whether it's tight, with no blank lines between its items or between
the blocks of any item, so its paragraphs render without `<p>`.
Blank lines at the very end of an item don't count unless another
item follows, and nor do blank lines in a nested block quote or code
block.

      public get tight(): Boolean {
        let kids = node.childNodes;
        var lastItem = -1;
        for (var i = 0; i < kids.length; i += 1) {
          if (kids[i].hasKind(listItemKind)) { lastItem = i; }
        }
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid.hasKind(listItemKind)) {
            if (i < lastItem) {
              if (kids[i + 1].hasKind(blankLineKind) || endsWithBlankLine(kid)) { return false; }
            }
            if (hasBlankBetweenBlocks(kid, i < lastItem)) { return false; }
          }
        }
        true
      }
    }

Whether `node`, a list or list item, ends with a blank line, there or
in its last list or item.

    let endsWithBlankLine(node: RedNode): Boolean {
      let kids = node.childNodes;
      if (kids.isEmpty) { return false; }
      let last = kids[kids.length - 1];
      if (last.hasKind(blankLineKind)) { return true; }
      if (last.hasKind(listKind) || last.hasKind(listItemKind)) { return endsWithBlankLine(last); }
      false
    }

Whether an item has a blank line after one of its blocks, before
another block, or before the next item if `hasNext`, as cmark judges
it. Link reference definitions don't count as blocks here, since
CommonMark leaves them out of the document.

    let hasBlankBetweenBlocks(item: RedNode, hasNext: Boolean): Boolean {
      let kids = item.childNodes;
      var lastBlock = -1;
      for (var i = 0; i < kids.length; i += 1) {
        if (isBlock(kids[i])) { lastBlock = i; }
      }
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (isBlock(kid) && (hasNext || i < lastBlock)) {
          if (i + 1 < kids.length && kids[i + 1].hasKind(blankLineKind)) { return true; }
          if ((kid.hasKind(listKind) || kid.hasKind(listItemKind)) && endsWithBlankLine(kid)) {
            return true;
          }
        }
      }
      false
    }

    let isBlock(node: RedNode): Boolean {
      !node.hasKind(blankLineKind) && !node.hasKind(linkReferenceDefinitionKind)
    }

A list item: a marker, then blocks indented to line up after it.

    export class ListItem extends ListChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<BlockChild> { blockChildrenOf(node) }

The marker as written, such as `-` or `3.`.

      public get marker(): String { node.childOfKind(listMarkerKind)?.asWritten ?? "" }

The number of an ordered item, or null.

      public get number(): Int? {
        let written = new SourceText(marker);
        let last = written.codeAt(written.length - 1);
        if (last != char'.' && last != char')') { return null; }
        var value = 0;
        for (var i = 0; i < written.length - 1; i += 1) {
          value = value * 10 + written.codeAt(i) - char'0';
        }
        value
      }
    }

One or more blank lines' worth: a line of only spaces and tabs.

    export class BlankLine extends BlockChild & ListChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
    }

## Inlines

A run of text, which may hold backslash escapes and line breaks.

    export class Text extends ParagraphChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The text as it reads: escapes resolved, line breaks as `\n`, and the
whitespace and container prefixes around line breaks left out.

      public get text(): String {
        let out = new StringBuilder();
        let kids = node.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid.hasKind(plainKind)) {
            out.append(kid.asWritten);
          } else if (kid.hasKind(escapeKind)) {
            let written = kid.asWritten;
            out.append(written.slice(written.next(String.begin), written.end));
          } else if (kid.hasKind(lineEndingKind)) {
            out.append("\n");
          }
        }
        out.toString()
      }
    }

A code span, such as `` `x` ``.

    export class CodeSpan extends ParagraphChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The code, as CommonMark reads it: line endings become spaces, and one
space is stripped from each end if both have one and it's not all
spaces.

      public get code(): String {
        let raw = tokenTextOf(node, codeTextKind);
        let source = new SourceText(raw);
        let out = new StringBuilder();
        var allSpaces = true;
        for (var i = 0; i < source.length; i += 1) {
          let c = source.codeAt(i);
          if (c != char' ' && c != char'\n' && c != char'\r') { allSpaces = false; }
        }
        let n = source.length;
        var start = 0;
        var end = n;
        if (
          !allSpaces && n >= 2 && isLineSpace(source.codeAt(0)) && isLineSpace(source.codeAt(n - 1))
        ) {
          start = 1;
          end = n - 1;
        }
        for (var i = start; i < end; i += 1) {
          let c = source.codeAt(i);
          if (c == char'\r' && source.codeAt(i + 1) == char'\n') {
            // A CRLF is one line ending: one space, at its `\n`.
          } else if (c == char'\n' || c == char'\r') {
            out.append(" ");
          } else {
            out.append(source.slice(i, i + 1));
          }
        }
        out.toString()
      }
    }

    let isLineSpace(c: Int): Boolean { c == char' ' || c == char'\n' || c == char'\r' }

Raw HTML, such as `<b>` or `<!-- note -->`, found by CommonMark's
rules. Its children are whatever the `RawHtmlHandler` gave: one opaque
token by default, or an HTML subtree with the `kelpto` library.

    export class RawHtml extends ParagraphChild & RawHtmlContent {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get html(): String { rawHtmlTextOf(node) }
      public get htmlNode(): RedNode? { htmlNodeOf(node) }
      public get isBlock(): Boolean { false }
    }

## Escaping for edits

`text` as Markdown that reads as `text`: backslashes before what would
otherwise start markup, and line breaks as spaces. Leading and
trailing spaces and tabs are trimmed, as a heading's are. A trailing
run of `#` gets a backslash, so it can't read as a closing sequence.

    let escapeInline(text: String): String {
      let source = new SourceText(text);
      var start = 0;
      while (start < source.length && isSpaceOrTab(source.codeAt(start))) { start += 1; }
      let end = trimBlanksBack(source, start, source.length);
      var hashes = end;
      while (hashes > start && source.codeAt(hashes - 1) == char'#') { hashes -= 1; }
      let out = new StringBuilder();
      for (var i = start; i < end; i += 1) {
        let c = source.codeAt(i);
        let isBreak = c == char'\n' || c == char'\r';
        let afterCr = c == char'\n' && i > start && source.codeAt(i - 1) == char'\r';
        if (isBreak && !afterCr) { out.append(" "); }
        if (!isBreak) {
          if (
            c == char'\\' || c == char'`' || c == char'*' || c == char'_' || c == char'[' ||
            c == char']' || c == char'<' || c == char'&' || (c == char'#' && i == hashes)
          ) {
            out.append("\\");
          }
          out.append(source.slice(i, i + 1));
        }
      }
      out.toString()
    }

## Tests

    test("typed views") {
      let doc = parseMarkdown(
        "## Usage ##\n\nSome `code` and <b class=\"x\">bold</b>,\nwrapped.\n\n```rust  extra\n  fn main() {}\n```\n",
      );
      let blocks = doc.children;
      assert(blocks.length == 5) { blocks.length.toString() };
      let heading = doc.headings[0];
      assert(heading.level == 2) { heading.level.toString() };
      assert(heading.text == "Usage") { heading.text };
      assert(heading.span.toString() == "0+12") { heading.span.toString() };
      let paragraph = blocks[2] as Paragraph orelse panic();
      let inlines = paragraph.children;
      assert(inlines.length == 7) { inlines.length.toString() };
      let code = inlines[1] as CodeSpan orelse panic();
      assert(code.code == "code") { code.code };
      let raw = inlines[3] as RawHtml orelse panic();
      assert(raw.html == "<b class=\"x\">") { raw.html };
      assert(raw.htmlNode == null) { "opaque by default" };
      assert(paragraph.text == "Some code and <b class=\"x\">bold</b>,\nwrapped.") { paragraph.text };
      let block = doc.codeBlocks[0];
      assert(block.info == "rust  extra") { block.info };
      assert(block.language == "rust") { block.language };
      assert(block.code == "  fn main() {}\n") { block.code };
    }

    test("views: escapes, indentation, and code spans") {
      let doc = parseMarkdown("  ```\n   a\n  b\n```\n\\# not a heading `` a`b ``\n");
      let block = doc.codeBlocks[0];
      assert(block.code == " a\nb\n") { block.code };
      let paragraph = doc.children[1] as Paragraph orelse panic();
      assert(paragraph.text == "# not a heading a`b") { paragraph.text };
      let unclosed = parseMarkdown("~~~\ncode").codeBlocks[0];
      assert(unclosed.code == "code\n") { unclosed.code };
    }

    test("withText changes only the heading's text") {
      let text = "Intro\n\n# Old *title* #\nAfter\n";
      let doc = parseMarkdown(text);
      let edited = doc.headings[0].withText("New [1] #");
      assert(edited.asWritten == "Intro\n\n# New \\[1\\] \\# #\nAfter\n") { edited.asWritten };
      assert(doc.asWritten == text) { "the old document is unchanged" };
      let reparsed = parseMarkdown(edited.asWritten);
      assert(reparsed.headings[0].text == "New [1] #") { reparsed.headings[0].text };
      let bare = parseMarkdown("#\n").headings[0].withText("Title");
      assert(bare.asWritten == "# Title\n") { bare.asWritten };
      let closed = parseMarkdown("# #\n").headings[0].withText("Title");
      assert(closed.asWritten == "# Title #\n") { closed.asWritten };
    }

    test("withInfo changes only the info string") {
      let doc = parseMarkdown("Text\n\n```py   \nx = 1\n```\n");
      let block = doc.codeBlocks[0];
      let edited = block.withInfo("rust") orelse panic();
      assert(edited.asWritten == "Text\n\n```rust   \nx = 1\n```\n") { edited.asWritten };
      let added = (parseMarkdown("~~~\nx\n~~~").codeBlocks[0].withInfo(" js ") orelse panic());
      assert(added.asWritten == "~~~js\nx\n~~~") { added.asWritten };
      let removed = block.withInfo("") orelse panic();
      assert(removed.asWritten == "Text\n\n```   \nx = 1\n```\n") { removed.asWritten };
      let bad = do { block.withInfo("a`b"); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "a backtick can't follow a backtick fence" };
    }

    test("views: containers and their blocks") {
      let doc = parseMarkdown(
        "> # Quoted\n> text\nlazy\n\n1. one\n2. two\n\n   more\n- [x]: </u r> 'T'\n***\n",
      );
      let quote = doc.children[0] as BlockQuote orelse panic();
      let inQuote = quote.children;
      assert(inQuote.length == 2) { inQuote.length.toString() };
      let paragraph = inQuote[1] as Paragraph orelse panic();
      assert(paragraph.text == "text\nlazy") { paragraph.text };
      assert(doc.headings[0].text == "Quoted") { "headings inside containers" };
      let list = doc.children[2] as ListBlock orelse panic();
      assert(list.ordered && list.start == 1 && list.marker == ".") { list.marker };
      assert(!list.tight) { "a blank line between an item's blocks" };
      let items = list.items;
      assert(items.length == 2) { items.length.toString() };
      assert(items[1].marker == "2." && items[1].number == 2) { items[1].marker };
      assert(items[1].children.length == 3) { items[1].children.length.toString() };
      let bullets = doc.children[3] as ListBlock orelse panic();
      assert(!bullets.ordered && bullets.start == null && bullets.tight) { "bullets" };
      let definition = bullets.items[0].children[0] as LinkReferenceDefinition orelse panic();
      assert(definition.label == "x") { definition.label };
      assert(definition.destination.url == "/u r") { definition.destination.url };
      assert(definition.title == "T") { definition.title ?? "null" };
      let rule = doc.children[4] as ThematicBreak orelse panic();
      assert(rule.marker == "*") { rule.marker };
    }

    test("views: headings, code, and HTML blocks") {
      let doc = parseMarkdown("Title\n===\n\n    \tcode\n\n<div>\n*x*\n</div>\n\nSub\n---\n");
      let setext = doc.headings[0];
      assert(setext.style == "setext" && setext.level == 1) { setext.style };
      assert(setext.text == "Title") { setext.text };
      assert(doc.headings[1].level == 2) { doc.headings[1].level.toString() };
      let code = doc.children[2] as IndentedCode orelse panic();
      assert(code.code == "\tcode\n") { code.code };
      let html = doc.htmlBlocks[0];
      assert(html.html == "<div>\n*x*\n</div>\n") { html.html };
      assert(html.isBlock) { "a block" };
      let quoted = parseMarkdown(">\t\tcode\n> <div>\n> x\n").blocks;
      let quotedCode = quoted[1] as IndentedCode orelse panic();
      assert(quotedCode.code == "  code\n") { quotedCode.code };
      let quotedHtml = quoted[2] as HtmlBlock orelse panic();
      assert(quotedHtml.html == "<div>\nx\n") { quotedHtml.html };
    }

Edits change only their own span: the text before and after it stays.

    let checkLocal(before: String, after: String, prefix: Int, suffix: Int): Boolean {
      let a = new SourceText(before);
      let b = new SourceText(after);
      a.slice(0, prefix) == b.slice(0, prefix) &&
        a.slice(a.length - suffix, a.length) == b.slice(b.length - suffix, b.length)
    }

    test("withLevel changes only the marker") {
      let text = "> ## Two\n\nSetext\n------\n";
      let doc = parseMarkdown(text);
      let atx = doc.headings[0].withLevel(4) orelse panic();
      assert(atx.asWritten == "> #### Two\n\nSetext\n------\n") { atx.asWritten };
      assert(atx.headings[0].level == 4) { "reparsed level" };
      let setext = doc.headings[1].withLevel(1) orelse panic();
      assert(setext.asWritten == "> ## Two\n\nSetext\n======\n") { setext.asWritten };
      let tooDeep = do { doc.headings[1].withLevel(3); "accepted" } orelse "bubbled";
      assert(tooDeep == "bubbled") { "setext headings have two levels" };
      let bad = do { doc.headings[0].withLevel(7); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "levels go to 6" };
      assert(doc.asWritten == text) { "the old document is unchanged" };
    }

    test("withDestination changes only the destination") {
      let text = "Intro\n\n> [a]:\n>   /old\n>   \"Title\"\n\nAfter\n";
      let doc = parseMarkdown(text);
      let definition = doc.linkReferenceDefinitions[0];
      assert(definition.title == "Title") { definition.title ?? "null" };
      let edited = definition.withDestination(new LinkTarget("/new path")) orelse panic();
      let expected = "Intro\n\n> [a]:\n>   </new path>\n>   \"Title\"\n\nAfter\n";
      assert(edited.asWritten == expected) { edited.asWritten };
      assert(checkLocal(text, edited.asWritten, 18, 20)) { "only its span changed" };
      let again = edited.linkReferenceDefinitions[0];
      assert(again.destination.url == "/new path") { again.destination.url };
      let plain = definition.withDestination(new LinkTarget("https://x.test/a(b)")) orelse panic();
      assert(plain.linkReferenceDefinitions[0].destination.url == "https://x.test/a(b)") { plain.asWritten };
      let bad = do { definition.withDestination(new LinkTarget("a\nb")); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "no line breaks" };
    }

    test("withText in a list item and a setext heading") {
      let text = "- # Old\n- item\n\nOld\nlines\n===\n";
      let doc = parseMarkdown(text);
      let edited = doc.headings[0].withText("New");
      assert(edited.asWritten == "- # New\n- item\n\nOld\nlines\n===\n") { edited.asWritten };
      let setext = doc.headings[1].withText("One line");
      assert(setext.asWritten == "- # Old\n- item\n\nOne line\n===\n") { setext.asWritten };
      assert(setext.headings[1].text == "One line") { setext.headings[1].text };
    }
