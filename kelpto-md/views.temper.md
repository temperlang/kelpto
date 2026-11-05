# Typed views and edits

Typed views over the red tree. Each wraps one red node, so it's cheap
to make and knows its span and its text as written. The types say
where each node may go, after Mike's idea of nesting in the types:

- **`BlockChild`:** blocks, which go in a document, a block quote, or a
  list item: `Heading`, `Paragraph`, `CodeBlock`, `IndentedCode`,
  `ThematicBreak`, `HtmlBlock`, `LinkReferenceDefinition`,
  `BlockQuote`, `ListBlock`, `Table`, `FootnoteDefinition`, and
  `BlankLine`.
- **`ListChild`:** what a list holds, `ListItem` and `BlankLine`.
- **`ParagraphChild`:** inlines, which headings and table cells hold
  too: `Text`, `CodeSpan`, `RawHtml`, `Emphasis`, `Strong`,
  `Strikethrough`, `Link`, `Image`, `Autolink`, `HardBreak`,
  `CharacterReference`, and `FootnoteReference`.
- **`LinkTextChild`:** what a link's text may hold: every
  `ParagraphChild` but `Link`, since links can't nest.

Edits give a new `MarkdownDocument`, changing only the edited node's
text and sharing every untouched green node; the old document stays as
it was.

    let {
      GreenElement, GreenNode, GreenToken, Kind, RedElement, RedNode, RedToken, Replacement, Span, Splice,
      editAll, replaceAll,
    } = import("../kelpto-core");

    export sealed interface MarkdownNode {

The red node this views. A getter here, though each view holds it as
a field: an interface's own getters can't pass on an abstract property
(Temper, 2026-11-02).

      public get node(): RedNode;

The text exactly as written, and where.

      public get asWritten(): String;
      public get span(): Span;

The view holding this one, or null for a document: a top-level
block's document, an item's list, a cell's row, a link's paragraph or
emphasis, and so on. See `walk.temper.md`.

      public get parent(): MarkdownNode? { parentViewOf(node) }

How many views hold this one: 0 for a document, 1 for its top-level
blocks, 2 for what they hold, and so on.

      public get depth(): Int { depthOf(node) }

Every view inside this one, each before what it holds, in document
order: blocks, list items, table rows and cells, and inlines, at any
depth, but not this one. One flat list, without a list per level.

      public get descendants(): List<MarkdownNode> {
        let result = new ListBuilder<MarkdownNode>();
        addDescendants(node, result);
        result.toList()
      }
    }

    export sealed interface BlockChild extends MarkdownNode {}
    export sealed interface ListChild extends MarkdownNode {}
    export sealed interface ParagraphChild extends MarkdownNode {}
    export sealed interface LinkTextChild extends MarkdownNode {}

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

A link destination, as written in the Markdown but with escapes and
character references resolved. A wrapper on `String` for now, with no
URL processing; the renderer percent-encodes it only when it writes
HTML.

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

As `MarkdownNode.descendants`, here too so Rust code in other crates
finds it without importing `MarkdownNodeTrait` (2026-11-02).

      public get descendants(): List<MarkdownNode> {
        let result = new ListBuilder<MarkdownNode>();
        addDescendants(node, result);
        result.toList()
      }

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

GFM tables, in order, inside containers too.

      public get tables(): List<Table> {
        let result = new ListBuilder<Table>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is Table) { result.add(block); }
        }
        result.toList()
      }

GFM task list items, in order, nested ones too.

      public get taskListItems(): List<TaskListItem> {
        let result = new ListBuilder<TaskListItem>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is ListBlock) {
            let items = block.items;
            for (var j = 0; j < items.length; j += 1) {
              let task = items[j].task;
              if (task != null) { result.add(task); }
            }
          }
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

GFM footnote definitions, in order, nested ones too, used or not.

      public get footnoteDefinitions(): List<FootnoteDefinition> {
        let result = new ListBuilder<FootnoteDefinition>();
        let all = blocks;
        for (var i = 0; i < all.length; i += 1) {
          let block = all[i];
          if (block is FootnoteDefinition) { result.add(block); }
        }
        result.toList()
      }

GFM footnote references, in order, wherever inlines go: in headings,
paragraphs, table cells, links, and footnote definitions.

      public get footnoteReferences(): List<FootnoteReference> {
        let result = new ListBuilder<FootnoteReference>();
        let walk = new FootnoteWalk();
        walk.visit(node);
        for (var i = 0; i < walk.references.length; i += 1) {
          result.add(new FootnoteReference(walk.references[i]));
        }
        result.toList()
      }

Links, inline or by reference, in order, wherever inlines go: in
headings, paragraphs, table cells, emphasis, image descriptions, and
inside containers and footnote definitions. Not images, autolinks, or
link reference definitions.

      public get links(): List<Link> {
        let result = new ListBuilder<Link>();
        addLinks(node, result);
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

An editor collecting many edits to this document, made at once by its
`toDocument()`. See `MarkdownEditor`.

      public editor(): MarkdownEditor { new MarkdownEditor(this) }
    }

    let addBlocks(blocks: List<BlockChild>, result: ListBuilder<BlockChild>): Void {
      for (var i = 0; i < blocks.length; i += 1) {
        let block = blocks[i];
        result.add(block);
        when (block) {
          is BlockQuote -> addBlocks(block.children, result);
          is FootnoteDefinition -> addBlocks(block.children, result);
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

Links don't nest, so a link's text needs no walk. Code, HTML, and
autolinks hold none.

    let addLinks(node: RedNode, result: ListBuilder<Link>): Void {
      let kind = node.green.kind;
      if (kind.id == linkKind.id) {
        result.add(new Link(node));
        return;
      }
      if (
        kind.id == codeBlockKind.id || kind.id == indentedCodeKind.id || kind.id == htmlBlockKind.id ||
        kind.id == rawHtmlKind.id || kind.id == codeSpanKind.id || kind.id == autolinkKind.id ||
        kind.id == urlAutolinkKind.id || kind.id == wwwAutolinkKind.id || kind.id == emailAutolinkKind.id
      ) {
        return;
      }
      var at = node.offset;
      let kids = node.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid is GreenNode) { addLinks(new RedNode(kid, node, at, i), result); }
        at += kid.width;
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
      if (node.hasKind(tableKind)) { return new Table(node); }
      if (node.hasKind(footnoteDefinitionKind)) { return new FootnoteDefinition(node); }
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

The typed view of an inline node.

    let inlineOf(node: RedNode): MarkdownNode {
      if (node.hasKind(codeSpanKind)) { return new CodeSpan(node); }
      if (node.hasKind(rawHtmlKind)) { return new RawHtml(node); }
      if (node.hasKind(emphasisKind)) { return new Emphasis(node); }
      if (node.hasKind(strongKind)) { return new Strong(node); }
      if (node.hasKind(linkKind)) { return new Link(node); }
      if (node.hasKind(imageKind)) { return new Image(node); }
      if (node.hasKind(strikethroughKind)) { return new Strikethrough(node); }
      if (
        node.hasKind(autolinkKind) || node.hasKind(urlAutolinkKind) || node.hasKind(wwwAutolinkKind) ||
        node.hasKind(emailAutolinkKind)
      ) {
        return new Autolink(node);
      }
      if (node.hasKind(hardBreakKind)) { return new HardBreak(node); }
      if (node.hasKind(characterReferenceKind)) { return new CharacterReference(node); }
      if (node.hasKind(footnoteReferenceKind)) { return new FootnoteReference(node); }
      new Text(node)
    }

The inlines in `node`, an inline content node or emphasis, or a link
or image, whose text ends at its `]`.

    let inlinesOf(node: RedNode): List<MarkdownNode> {
      let result = new ListBuilder<MarkdownNode>();
      var at = node.offset;
      let kids = node.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid.kind.id == linkCloseKind.id) { break; }
        if (kid is GreenNode) { result.add(inlineOf(new RedNode(kid, node, at, i))); }
        at += kid.width;
      }
      result.toList()
    }

    let paragraphChildrenOf(node: RedNode): List<ParagraphChild> {
      let result = new ListBuilder<ParagraphChild>();
      let kids = inlinesOf(node);
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid is ParagraphChild) { result.add(kid); }
      }
      result.toList()
    }

The text of inlines without markup: code spans' code, raw HTML as
written, character references' values, and hard breaks as `\n`.

    let plainTextOf(children: List<ParagraphChild>): String {
      let out = new StringBuilder();
      for (var i = 0; i < children.length; i += 1) {
        addPlainText(children[i], out);
      }
      out.toString()
    }

    let addPlainText(child: MarkdownNode, out: StringBuilder): Void {
      when (child) {
        is Text -> out.append(child.text);
        is CodeSpan -> out.append(child.code);
        is RawHtml -> out.append(child.html);
        is CharacterReference -> out.append(child.value);
        is HardBreak -> out.append("\n");
        is Autolink -> out.append(child.text);
        else -> do {
          let kids = paragraphChildrenOf(child.node);
          for (var i = 0; i < kids.length; i += 1) { addPlainText(kids[i], out); }
        };
      }
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

The first and last code points of `text`, or -1 if it's empty.

    let firstCodeOf(text: String): Int { if (text.isEmpty) { -1 } else { text[String.begin] } }

    let lastCodeOf(text: String): Int { if (text.isEmpty) { -1 } else { text[text.prev(text.end)] } }

`text` without its first and last code points, such as a label's
brackets or a title's quotes.

    let withoutEnds(text: String): String {
      text.slice(text.next(String.begin), text.prev(text.end))
    }

`text` with backslash escapes resolved, but not character references.

    let unescape(text: String): String {
      let out = new StringBuilder();
      let end = text.end;
      var runStart = String.begin;
      var i = String.begin;
      while (i < end) {
        let next = text.next(i);
        if (text[i] == char'\\' && isAsciiPunctuation(codeInAt(text, next, end))) {
          out.append(text.slice(runStart, i));
          runStart = next;
          i = text.next(next);
        } else {
          i = next;
        }
      }
      out.append(text.slice(runStart, end));
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
          return if (firstCodeOf(underline.asWritten) == char'=') { 1 } else { 2 };
        }
        (node.childOfKind(atxMarkerKind) as RedToken orelse panic()).span.length
      }

      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }

The text without markup, such as `Usage`.

      public get text(): String { plainTextOf(children) }

A new document with this heading's text replaced by `text`, escaped
so it reads as plain text (though with GFM's extended autolinks on, a
URL in it still links, as GitHub shows it). Only the heading's content changes; its
markers, closing sequence, and whitespace stay as written. Line breaks
in `text` become spaces, so a setext heading becomes one line.

      public withText(text: String): MarkdownDocument { applied(headingTextEdit(node, text)) }

A new document with this heading's content replaced by `content`,
written as `MarkdownBuilder.heading` writes it, so it reads back as
built. Line breaks become spaces, since a heading is one line.

      public withContent(content: Inlines): MarkdownDocument { applied(headingContentEdit(node, content)) }

A new document with this heading at `level`, changing only its
marker: the number of `#`, or a setext underline's character, kept
the same length. Bubbles for a level outside 1 to 6, or past 2 for a
setext heading, which has no such levels.

      public withLevel(level: Int): MarkdownDocument throws Bubble { applied(headingLevelEdit(node, level)) }
    }

    let applied(edit: Replacement): MarkdownDocument { new MarkdownDocument(edit.apply()) }

    let headingTextEdit(node: RedNode, text: String): Replacement {
      headingInlineEdit(node, escapeInline(text, inlineExtensionsOf(node).strikethrough, false))
    }

    let headingContentEdit(node: RedNode, content: Inlines): Replacement {
      headingInlineEdit(node, writeInlines(content.pieces, headingContext))
    }

The heading with `markdown` as its content.

    let headingInlineEdit(node: RedNode, markdown: String): Replacement {
      let content = contentOf(node);
      let extensions = inlineExtensionsOf(node);
      let newContent = inlineContentGreen(markdown, extensions, false);
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
      new Replacement(node, new GreenNode(node.kind, kids.toList()))
    }

    let headingLevelEdit(node: RedNode, level: Int): Replacement throws Bubble {
      if (level < 1 || level > 6) { bubble(); }
      let underline = node.childOfKind(setextMarkerKind);
      if (underline != null) {
        if (level > 2) { bubble(); }
        let token = underline as RedToken orelse panic();
        let mark = if (level == 1) { "=" } else { "-" };
        let out = new StringBuilder();
        for (var i = 0; i < token.span.length; i += 1) { out.append(mark); }
        return new Replacement(token, new GreenToken(setextMarkerKind, out.toString()));
      }
      let marker = node.childOfKind(atxMarkerKind) as RedToken orelse panic();
      let out = new StringBuilder();
      for (var i = 0; i < level; i += 1) { out.append("#"); }
      new Replacement(marker, new GreenToken(atxMarkerKind, out.toString()))
    }

A paragraph.

    // Called from outside the class: in Temper's main since #625,
    // `Inlines.empty.text(text)` in a class with a `text` getter reads
    // that getter (notes/temper-fixes.md, "Kelpto doesn't build on main
    // 24b86157").
    let plainInlines(text: String): Inlines { Inlines.empty.text(text) }

    export class Paragraph extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }
      public get text(): String { plainTextOf(children) }

A new document with this paragraph's text replaced by `text`, escaped
as `Inlines.text` escapes it, so it reads as plain text. Line breaks
become spaces. Only the paragraph's lines change, new ones taking
their container's prefixes; its leading spaces stay. Bubbles for
empty text, since a paragraph can't be empty (remove it with an
editor instead).

      public withText(text: String): MarkdownDocument throws Bubble {
        applied(paragraphContentEdit(node, plainInlines(text)))
      }

As `withText`, with rich content, written as
`MarkdownBuilder.paragraph` writes it.

      public withContent(content: Inlines): MarkdownDocument throws Bubble {
        applied(paragraphContentEdit(node, content))
      }
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
with backslash escapes and character references resolved.

      public get info(): String {
        let info = openingFence.childOfKind(infoKind);
        if (info == null) { "" } else { resolveText(info.asWritten) }
      }

The info string's first word, which CommonMark uses for the language.

      public get language(): String {
        let text = info;
        var end = String.begin;
        while (text.hasIndex(end) && text[end] != char' ' && text[end] != char'\t') {
          end = text.next(end);
        }
        text.slice(String.begin, end)
      }

The code, each line ending in `\n`, with as much indentation removed
from each line as the opening fence had, as CommonMark reads it.

      public get code(): String { codeOf(node) }

A new document with this block's info string replaced by `info`
(trimmed; empty removes it), as written, so escapes stay escapes.
Only the info string changes; the fences, whitespace, and code stay as
written. Bubbles if `info` has a line break, or a backtick after a
backtick fence, which would change what the fence means.

      public withInfo(info: String): MarkdownDocument throws Bubble { applied(infoEdit(node, info)) }
    }

    let infoEdit(node: RedNode, info: String): Replacement throws Bubble {
      let opening = node.childNodes[0];
      let start = skipBlanksAt(info, String.begin, info.end);
      let end = trimBlanksBackAt(info, start, info.end);
      let trimmed = info.slice(start, end);
      let fence = opening.childOfKind(fenceKind)?.asWritten ?? "";
      let backtickFence = !fence.isEmpty && fence[String.begin] == char'`';
      for (var i = start; i < end; i = info.next(i)) {
        let c = info[i];
        if (c == char'\n' || c == char'\r' || (c == char'`' && backtickFence)) {
          bubble();
        }
      }
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
      new Replacement(opening, new GreenNode(openingFenceKind, kids.toList()))
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
        written.slice(String.begin, written.step(String.begin, 1))
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

The label between the brackets, as written, line breaks included.
Links match it by `normalizeLabel`, ignoring case and runs of
whitespace.

      public get label(): String {
        let label = node.childOfKind(linkLabelKind) as RedNode orelse panic();
        withoutEnds(tokenTextOf(label, labelTextKind))
      }

The destination, without angle brackets, with escapes and character
references resolved.

      public get destination(): LinkTarget { destinationOf(node) }

The title without its quotes or parentheses, with escapes and
character references resolved, or null.

      public get title(): String? { titleOf(node) }

A new document with the destination replaced by `target`, written in
angle brackets if it needs them. Only the destination changes.
Bubbles if `target` has a line break, which a destination can't hold.

      public withDestination(target: LinkTarget): MarkdownDocument throws Bubble {
        applied(destinationEdit(node, target))
      }
    }

The destination token of a definition or inline link, resolved, or
empty if there's none, as in `[a]()`.

    let destinationOf(node: RedNode): LinkTarget {
      let written = node.childOfKind(linkDestinationKind)?.asWritten ?? "";
      let inner = if (firstCodeOf(written) == char'<') { withoutEnds(written) } else { written };
      new LinkTarget(resolveText(inner))
    }

    let titleOf(node: RedNode): String? {
      let title = node.childOfKind(linkTitleKind);
      if (title == null) { return null; }
      resolveText(withoutEnds(lineTextOf(title as RedNode orelse panic(), titleTextKind)))
    }

Like `tokenTextOf`, but with each line ending as `\n`.

    let lineTextOf(node: RedNode, kind: Kind): String {
      let out = new StringBuilder();
      let kids = node.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid is GreenToken) {
          if (kid.kind.id == kind.id) { out.append(kid.text); }
          if (kid.kind.id == lineEndingKind.id) { out.append("\n"); }
        }
      }
      out.toString()
    }

Replaces the destination of a definition or inline link with `target`,
or puts one in after `(` and any whitespace if there was none.

    let destinationEdit(node: RedNode, target: LinkTarget): Replacement throws Bubble {
      let written = new GreenToken(linkDestinationKind, writeDestination(target.url));
      let old = node.childOfKind(linkDestinationKind);
      if (old != null) {
        return new Replacement(old, written);
      }
      let kids = node.green.children.toListBuilder();
      let paren = node.childOfKind(openParenKind);
      if (paren == null) { bubble(); }
      var at = (paren as RedElement orelse panic()).index + 1;
      if (at < kids.length && kids[at].kind.id == whitespaceKind.id) { at += 1; }
      kids.add(written, at);
      new Replacement(node, new GreenNode(node.kind, kids.toList()))
    }

`url` as a link destination: as is if it can be, or else in angle
brackets, with `<`, `>`, and `\` escaped, and `&` where it would start
a character reference.

    let writeDestination(url: String): String throws Bubble {
      var plain = !url.isEmpty && firstCodeOf(url) != char'<';
      var depth = 0;
      for (var i = String.begin; url.hasIndex(i); i = url.next(i)) {
        let c = url[i];
        if (c == char'\n' || c == char'\r') { bubble(); }
        if (c <= 0x20 || c == 0x7F || c == char'\\' || startsReference(url, i)) { plain = false; }
        if (c == char'(') { depth += 1; }
        if (c == char')') {
          depth -= 1;
          if (depth < 0) { plain = false; }
        }
      }
      if (plain && depth == 0) { return url; }
      let out = new StringBuilder();
      out.append("<");
      var runStart = String.begin;
      for (var i = String.begin; url.hasIndex(i); i = url.next(i)) {
        let c = url[i];
        if (c == char'<' || c == char'>' || c == char'\\' || startsReference(url, i)) {
          out.append(url.slice(runStart, i));
          out.append("\\");
          runStart = i;
        }
      }
      out.append(url.slice(runStart, url.end));
      out.append(">");
      out.toString()
    }

    let startsReference(text: String, i: StringIndex): Boolean {
      text[i] == char'&' && characterReferenceEnd(text, i, text.end) != i
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
        let written = first.marker;
        if (written.isEmpty) { "" } else { written.slice(written.prev(written.end), written.end) }
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
in its last list, item, or footnote definition.

    let endsWithBlankLine(node: RedNode): Boolean {
      let kids = node.childNodes;
      if (kids.isEmpty) { return false; }
      let last = kids[kids.length - 1];
      if (last.hasKind(blankLineKind)) { return true; }
      if (last.hasKind(listKind) || last.hasKind(listItemKind)) { return endsWithBlankLine(last); }
      if (last.hasKind(footnoteDefinitionKind)) { return footnoteEndsBlank(last); }
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
          if (kid.hasKind(footnoteDefinitionKind) && footnoteEndsBlank(kid)) { return true; }
        }
      }
      false
    }

A footnote definition ends with a blank line if it holds nothing, its
first line empty after `[^label]:`, or its last block is one.

    let footnoteEndsBlank(node: RedNode): Boolean {
      let kids = node.childNodes;
      kids.isEmpty || kids[kids.length - 1].hasKind(blankLineKind)
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
        let written = marker;
        if (written.isEmpty) { return null; }
        let lastAt = written.prev(written.end);
        let last = written[lastAt];
        if (last != char'.' && last != char')') { return null; }
        var value = 0;
        for (var i = String.begin; i < lastAt; i = written.next(i)) {
          value = value * 10 + written[i] - char'0';
        }
        value
      }

The item as a GFM task list item, if it starts with `[ ]`, `[x]`, or
`[X]`, or null.

      public get task(): TaskListItem? {
        if (node.childOfKind(taskMarkerKind) == null) { null } else { new TaskListItem(node) }
      }
    }

A GFM task list item, such as `- [x] Done`: a list item whose
paragraph starts with a checkbox. It views the same node as its
`ListItem`.

    export class TaskListItem {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get item(): ListItem { new ListItem(node) }

The checkbox as written: `[ ]`, `[x]`, or `[X]`.

      public get marker(): String { node.childOfKind(taskMarkerKind)?.asWritten ?? "" }

      public get checked(): Boolean { marker != "[ ]" }

A new document with the box checked (`[x]`) or not (`[ ]`), changing
only the marker. An `[X]` stays as written if `checked`.

      public withChecked(checked: Boolean): MarkdownDocument {
        let edit = checkedEdit(node, checked);
        if (edit == null) { new MarkdownDocument(node.root) } else { applied(edit) }
      }
    }

The edit checking or unchecking a task, or null if it already is.

    let checkedEdit(node: RedNode, checked: Boolean): Replacement? {
      let marker = node.childOfKind(taskMarkerKind) as RedToken orelse panic();
      if (checked == (marker.text != "[ ]")) { return null; }
      new Replacement(marker, new GreenToken(taskMarkerKind, if (checked) { "[x]" } else { "[ ]" }))
    }

One or more blank lines' worth: a line of only spaces and tabs.

    export class BlankLine extends BlockChild & ListChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
    }

### GFM footnote definitions

A footnote definition, such as `[^note]: Text`, holding blocks: the
rest of its first line, then lines indented four columns, and empty
lines. It renders as nothing where it is; a document's definitions
with references render in a section at the end, numbered in order of
first reference.

    export class FootnoteDefinition extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The label between `[^` and `]`, as written. References match it by
`normalizeLabel`, as links match definitions.

      public get label(): String { node.childOfKind(labelTextKind)?.asWritten ?? "" }

      public get children(): List<BlockChild> { blockChildrenOf(node) }

A new document with the label replaced by `label`, changing only the
label. References to the old label no longer reach it. Bubbles unless
`label` is a valid one (see `checkFootnoteLabel`).

      public withLabel(label: String): MarkdownDocument throws Bubble {
        applied(footnoteDefinitionLabelEdit(node, label))
      }
    }

    let footnoteDefinitionLabelEdit(node: RedNode, label: String): Replacement throws Bubble {
      checkFootnoteLabel(label);
      let token = node.childOfKind(labelTextKind) as RedToken orelse panic();
      new Replacement(token, new GreenToken(labelTextKind, label))
    }

A label an edit can write for a footnote definition or reference:
something, with no whitespace, brackets, backslashes, backticks, `<`,
`|`, or U+0000, so it reads back as the same label wherever it goes.
Bubbles if not.

    let checkFootnoteLabel(label: String): Void throws Bubble {
      if (label.isEmpty) { bubble(); }
      for (var i = String.begin; label.hasIndex(i); i = label.next(i)) {
        let c = label[i];
        if (
          isAsciiWhitespace(c) || c == char'[' || c == char']' || c == char'\\' || c == char'`' ||
          c == char'<' || c == char'|' || c == 0
        ) {
          bubble();
        }
      }
    }

### GFM tables

A table: a header row, a delimiter row such as `| --- | :-: |`, and
rows.

    export class Table extends BlockChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      public get header(): TableRow { new TableRow(node.childOfKind(tableHeaderRowKind) as RedNode orelse panic()) }

The rows after the delimiter row, each with the cells as written, more
or fewer than the header's.

      public get rows(): List<TableRow> {
        let result = new ListBuilder<TableRow>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          if (nodes[i].hasKind(tableRowKind)) { result.add(new TableRow(nodes[i])); }
        }
        result.toList()
      }

The number of columns: the header's cells.

      public get columns(): Int { alignmentsOf(node).length }

Each column's alignment, from the delimiter row: `"left"` for `:--`,
`"right"` for `--:`, `"center"` for `:-:`, or `"none"`.

      public get alignments(): List<String> { alignmentsOf(node) }
    }

    let alignmentsOf(table: RedNode): List<String> {
      let result = new ListBuilder<String>();
      let row = table.childOfKind(tableDelimiterRowKind) as RedNode orelse panic();
      let kids = row.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid is GreenToken) {
          if (kid.kind.id == tableDelimiterKind.id) {
            let marker = kid.text;
            let left = firstCodeOf(marker) == char':';
            let right = lastCodeOf(marker) == char':';
            result.add(
              if (left && right) { "center" } else if (left) { "left" } else if (right) { "right" } else { "none" },
            );
          }
        }
      }
      result.toList()
    }

A row of a table, the header or another.

    export class TableRow extends MarkdownNode {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get isHeader(): Boolean { node.hasKind(tableHeaderRowKind) }

The cells as written. GFM renders as many as the header has, filling
in empty ones.

      public get cells(): List<TableCell> {
        let result = new ListBuilder<TableCell>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) { result.add(new TableCell(nodes[i])); }
        result.toList()
      }
    }

A table cell: inlines between pipes, without the whitespace around
them.

    export class TableCell extends MarkdownNode {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }
      public get text(): String { plainTextOf(children) }

Which column it's in, from 0.

      public get column(): Int {
        var column = 0;
        let row = node.parent as RedNode orelse panic();
        let kids = row.green.children;
        for (var i = 0; i < node.index; i += 1) {
          if (kids[i].kind.id == tableCellKind.id) { column += 1; }
        }
        column
      }

Its column's alignment, as `Table.alignments` gives it, or `"none"`
for a cell past the header's.

      public get alignment(): String {
        let table = (node.parent as RedNode orelse panic()).parent as RedNode orelse panic();
        let alignments = alignmentsOf(table);
        let i = column;
        if (i < alignments.length) { alignments[i] } else { "none" }
      }

A new document with this cell's text replaced by `text`, escaped so it
reads as plain text, `|` included, as for `Heading.withText`. Only the
cell's content changes; its whitespace and pipes stay as written.

      public withText(text: String): MarkdownDocument { applied(cellTextEdit(node, text)) }

As `withText`, with rich content, written as a heading's is, and
with `|` escaped.

      public withContent(content: Inlines): MarkdownDocument { applied(cellContentEdit(node, content)) }
    }

    let cellTextEdit(node: RedNode, text: String): Replacement {
      cellInlineEdit(node, escapeInline(text, inlineExtensionsOf(node).strikethrough, true))
    }

    let cellContentEdit(node: RedNode, content: Inlines): Replacement {
      cellInlineEdit(node, writeInlines(content.pieces, cellContext))
    }

    let cellInlineEdit(node: RedNode, markdown: String): Replacement {
      new Replacement(contentOf(node), inlineContentGreen(markdown, inlineExtensionsOf(node), true))
    }

## Inlines

A run of text, which may hold backslash escapes and line breaks.

    export class Text extends ParagraphChild & LinkTextChild {
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

    export class CodeSpan extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The code, as CommonMark reads it: line endings become spaces, and one
space is stripped from each end if both have one and it's not all
spaces.

      public get code(): String {
        let raw = tokenTextOf(node, codeTextKind);
        let out = new StringBuilder();
        var allSpaces = true;
        for (var i = String.begin; raw.hasIndex(i); i = raw.next(i)) {
          let c = raw[i];
          if (c != char' ' && c != char'\n' && c != char'\r') { allSpaces = false; }
        }
        var start = String.begin;
        var end = raw.end;
        // Not all spaces, so at least two code points if both ends are.
        if (!allSpaces && isLineSpace(firstCodeOf(raw)) && isLineSpace(lastCodeOf(raw))) {
          start = raw.next(start);
          end = raw.prev(end);
        }
        var runStart = start;
        for (var i = start; i < end; i = raw.next(i)) {
          let c = raw[i];
          if (c == char'\n' || c == char'\r') {
            out.append(raw.slice(runStart, i));
            runStart = raw.next(i);
            // A CRLF is one line ending: one space, at its `\n`.
            if (!(c == char'\r' && codeInAt(raw, runStart, raw.end) == char'\n')) { out.append(" "); }
          }
        }
        out.append(raw.slice(runStart, end));
        out.toString()
      }
    }

    let isLineSpace(c: Int): Boolean { c == char' ' || c == char'\n' || c == char'\r' }

Raw HTML, such as `<b>` or `<!-- note -->`, found by CommonMark's
rules. Its children are whatever the `RawHtmlHandler` gave: one opaque
token by default, or an HTML subtree with the `kelpto` library.

    export class RawHtml extends ParagraphChild & LinkTextChild & RawHtmlContent {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get html(): String { rawHtmlTextOf(node) }
      public get htmlNode(): RedNode? { htmlNodeOf(node) }
      public get isBlock(): Boolean { false }
    }

Emphasis, such as `*word*` or `_word_`.

    export class Emphasis extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(node) }
      public get text(): String { plainTextOf(children) }

`*` or `_`.

      public get marker(): String { node.childOfKind(emphasisMarkerKind)?.asWritten ?? "" }
    }

GFM strikethrough, such as `~~word~~` or `~word~`.

    export class Strikethrough extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(node) }
      public get text(): String { plainTextOf(children) }

`~~` or `~`.

      public get marker(): String { node.childOfKind(strikethroughMarkerKind)?.asWritten ?? "" }
    }

Strong emphasis, such as `**word**` or `__word__`.

    export class Strong extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(node) }
      public get text(): String { plainTextOf(children) }

`**` or `__`.

      public get marker(): String { node.childOfKind(emphasisMarkerKind)?.asWritten ?? "" }
    }

A link: its text in brackets, then a destination and title in
parentheses, as in `[text](/url "title")`, or a reference to a
definition: full, `[text][label]`, collapsed, `[text][]`, or shortcut,
`[text]`. Its text can hold any inline but another link.

    export class Link extends ParagraphChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      public get children(): List<LinkTextChild> {
        let result = new ListBuilder<LinkTextChild>();
        let kids = inlinesOf(node);
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid is LinkTextChild) { result.add(kid); }
        }
        result.toList()
      }

      public get text(): String { plainTextOf(paragraphChildrenOf(node)) }

`"inline"`, `"full"`, `"collapsed"`, or `"shortcut"`.

      public get style(): String { linkStyleOf(node) }

The destination: an inline link's own, or else its definition's, or
null if no definition in the document has its label (after an edit
removed it, say).

      public get destination(): LinkTarget? { linkDestinationOf(node, null) }

The title, its own or its definition's, or null if none.

      public get title(): String? { linkTitleOf(node, null) }

The label a reference link matches by: the label in its second
brackets, or its text as written for a collapsed or shortcut
reference. Null for an inline link.

      public get label(): String? { linkLabelOf(node) }

A new document with an inline link's destination replaced by `target`,
written in angle brackets if it needs them. Only the destination
changes. Bubbles if `target` has a line break, or for a reference
link, whose destination is its definition's: edit that instead.

      public withDestination(target: LinkTarget): MarkdownDocument throws Bubble {
        applied(linkDestinationEdit(node, target))
      }
    }

An image, written as a link with `!` before it: `![alt](/src "title")`
or a reference. Its description can hold any inline, links included,
and renders as plain text, its `alt`.

    export class Image extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(node) }

The description as plain text, as `alt` gets it.

      public get alt(): String { plainTextOf(children) }
      public get style(): String { linkStyleOf(node) }
      public get destination(): LinkTarget? { linkDestinationOf(node, null) }
      public get title(): String? { linkTitleOf(node, null) }
      public get label(): String? { linkLabelOf(node) }

As `Link.withDestination`.

      public withDestination(target: LinkTarget): MarkdownDocument throws Bubble {
        applied(linkDestinationEdit(node, target))
      }
    }

    let linkDestinationEdit(node: RedNode, target: LinkTarget): Replacement throws Bubble {
      if (linkStyleOf(node) != "inline") { bubble(); }
      destinationEdit(node, target)
    }

    let linkStyleOf(node: RedNode): String {
      if (node.childOfKind(openParenKind) != null) { return "inline"; }
      let label = node.childOfKind(linkLabelKind);
      if (label != null) {
        return if (label.span.length == 2) { "collapsed" } else { "full" };
      }
      "shortcut"
    }

    let linkLabelOf(node: RedNode): String? {
      let style = linkStyleOf(node);
      if (style == "inline") { return null; }
      if (style == "full") {
        return withoutEnds(lineTextOf(node.childOfKind(linkLabelKind) as RedNode orelse panic(), labelTextKind));
      }
      let out = new StringBuilder();
      let kids = node.green.children;
      for (var i = 1; i < kids.length; i += 1) {
        if (kids[i].kind.id == linkCloseKind.id) { break; }
        addLabelText(kids[i], out);
      }
      out.toString()
    }

A link's text as the parser read it for its label: as written, but
without container prefixes, and with line endings as `\n`.

    let addLabelText(green: GreenElement, out: StringBuilder): Void {
      when (green) {
        is GreenNode -> do {
          let kids = green.children;
          for (var i = 0; i < kids.length; i += 1) { addLabelText(kids[i], out); }
        };
        is GreenToken -> do {
          let id = green.kind.id;
          if (id == lineEndingKind.id) {
            out.append("\n");
          } else if (id != indentKind.id && id != blockQuoteMarkerKind.id && id != listMarkerKind.id) {
            out.append(green.text);
          }
        };
      }
    }

The definition a reference link uses: from `definitions`, the
renderer's map of them by normalized label, or else the first in the
document with its label.

    let definitionOf(
      node: RedNode, definitions: Mapped<String, LinkReferenceDefinition>?,
    ): LinkReferenceDefinition? {
      let label = normalizeLabel(linkLabelOf(node) ?? "");
      if (definitions != null) {
        if (!definitions.has(label)) { return null; }
        return definitions[label] orelse panic();
      }
      let all = new MarkdownDocument(node.root).linkReferenceDefinitions;
      for (var i = 0; i < all.length; i += 1) {
        if (normalizeLabel(all[i].label) == label) { return all[i]; }
      }
      null
    }

    let linkDestinationOf(
      node: RedNode, definitions: Mapped<String, LinkReferenceDefinition>?,
    ): LinkTarget? {
      if (linkStyleOf(node) == "inline") { return destinationOf(node); }
      definitionOf(node, definitions)?.destination
    }

    let linkTitleOf(node: RedNode, definitions: Mapped<String, LinkReferenceDefinition>?): String? {
      if (linkStyleOf(node) == "inline") { return titleOf(node); }
      definitionOf(node, definitions)?.title
    }

An autolink, such as `<https://example.com>` or `<me@example.com>`,
or, with GFM's extended autolinks, written without angle brackets:
`https://example.com`, `www.example.com`, or `me@example.com`.

    export class Autolink extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

`"angle"` for `<…>`, or for GFM's extended autolinks, `"url"`,
`"www"`, or `"email"`.

      public get style(): String {
        if (node.hasKind(urlAutolinkKind)) {
          "url"
        } else if (node.hasKind(wwwAutolinkKind)) {
          "www"
        } else if (node.hasKind(emailAutolinkKind)) {
          "email"
        } else {
          "angle"
        }
      }

The link's text: what's between the angle brackets, exactly as
written, since autolinks have no escapes or references; or an extended
autolink's text, with any backslash escapes in an email address
resolved, as GFM reads it.

      public get text(): String {
        let out = new StringBuilder();
        let kids = node.green.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid is GreenToken) {
            if (kid.kind.id == autolinkTextKind.id) {
              out.append(kid.text);
            } else if (kid.kind.id == escapeKind.id) {
              out.append(kid.text.slice(kid.text.next(String.begin), kid.text.end));
            }
          }
        }
        out.toString()
      }

Whether it's an email address rather than a URI.

      public get isEmail(): Boolean {
        if (node.hasKind(emailAutolinkKind)) { return true; }
        if (!node.hasKind(autolinkKind)) { return false; }
        let written = "${text}>";
        uriAutolinkEnd(written, String.begin, written.end) == String.begin
      }

Where it links: the text, with `mailto:` before an email address
(unless written with `mailto:` or `xmpp:`, the only way an extended
one can hold a `:`), and `http://` before a `www.` domain.

      public get destination(): LinkTarget {
        let written = text;
        if (node.hasKind(wwwAutolinkKind)) { return new LinkTarget("http://${written}"); }
        if (node.hasKind(emailAutolinkKind)) {
          if (written.indexOf(":") is StringIndex) { return new LinkTarget(written); }
          return new LinkTarget("mailto:${written}");
        }
        new LinkTarget(if (isEmail) { "mailto:${written}" } else { written })
      }
    }

A hard line break: a backslash, or two or more spaces, at the end of a
line in a paragraph.

    export class HardBreak extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

`"backslash"` or `"spaces"`.

      public get style(): String {
        if (node.childOfKind(hardBreakMarkerKind)?.asWritten == "\\") { "backslash" } else { "spaces" }
      }
    }

A character reference, such as `&amp;`, `&#35;`, or `&#x22;`, kept as
written, with its value a view.

    export class CharacterReference extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

What it stands for, such as `&` for `&amp;`.

      public get value(): String { referenceValue(node.asWritten) }
    }

A GFM footnote reference, such as `[^note]`. It renders as a number
linking to its definition, or, if no definition has its label, as its
text, as written.

    export class FootnoteReference extends ParagraphChild & LinkTextChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The label between `[^` and `]`, as written, markup and all (but for
backslashes before `|` in a table cell, which GFM drops).

      public get label(): String { footnoteLabelOf(node) }

The definition it refers to, or null: the first with its label, by
`normalizeLabel`. Looks through the whole document.

      public get definition(): FootnoteDefinition? {
        let index = new FootnoteIndex(node.root);
        let found = index.definitionOf(node);
        if (found == null) { null } else { new FootnoteDefinition(found) }
      }

A new document with the label replaced by `label`, changing only the
label. Bubbles unless `label` is a valid one (see
`checkFootnoteLabel`).

      public withLabel(label: String): MarkdownDocument throws Bubble {
        applied(footnoteReferenceLabelEdit(node, label))
      }
    }

    let footnoteReferenceLabelEdit(node: RedNode, label: String): Replacement throws Bubble {
      checkFootnoteLabel(label);
      let kids = node.green.children;
      let out = new ListBuilder<GreenElement>();
      var placed = false;
      for (var i = 0; i < kids.length; i += 1) {
        let id = kids[i].kind.id;
        if (id == labelTextKind.id || id == pipeEscapeKind.id) {
          if (!placed) { out.add(new GreenToken(labelTextKind, label)); }
          placed = true;
        } else {
          out.add(kids[i]);
        }
      }
      new Replacement(node, new GreenNode(node.kind, out.toList()))
    }

    let footnoteLabelOf(node: RedNode): String {
      let out = new StringBuilder();
      let kids = node.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        if (kid.kind.id == labelTextKind.id) { kid.writeTo(out); }
      }
      out.toString()
    }

### Numbering footnotes

The footnote nodes of a tree, in order: references as they come, and
definitions as each ends, after any nested in them, as cmark-gfm
collects them. Code, HTML, and tables' delimiter rows hold neither.

    class FootnoteWalk {
      public references: ListBuilder<RedNode> = new ListBuilder<RedNode>();
      public definitions: ListBuilder<RedNode> = new ListBuilder<RedNode>();
      public constructor() {}

      public visit(node: RedNode): Void {
        let kind = node.green.kind;
        if (kind.id == footnoteReferenceKind.id) {
          references.add(node);
          return;
        }
        if (
          kind.id == codeBlockKind.id || kind.id == indentedCodeKind.id || kind.id == htmlBlockKind.id ||
          kind.id == rawHtmlKind.id || kind.id == codeSpanKind.id
        ) {
          return;
        }
        var at = node.offset;
        let kids = node.green.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid is GreenNode) { visit(new RedNode(kid, node, at, i)); }
          at += kid.width;
        }
        if (kind.id == footnoteDefinitionKind.id) { definitions.add(node); }
      }
    }

How a document's footnotes number, as cmark-gfm numbers them: each
reference goes to the first definition with its label, and each
definition referred to gets the next number at its first reference.
References in definitions count where the definitions are, even
unused ones. A reference's label matches only up to 1,000 bytes of
UTF-8, as cmark-gfm's labels do.

    class FootnoteIndex {

The definitions referred to, in number order; how many references
each has; and each resolved reference's number and its place among
its definition's references (1 for the first), by its offset.

      public used: ListBuilder<RedNode> = new ListBuilder<RedNode>();
      public counts: ListBuilder<Int> = new ListBuilder<Int>();
      private numbers: MapBuilder<Int, Int> = new MapBuilder<Int, Int>();
      private places: MapBuilder<Int, Int> = new MapBuilder<Int, Int>();
      private byLabel: MapBuilder<String, RedNode> = new MapBuilder<String, RedNode>();

      public constructor(root: RedNode) {
        let walk = new FootnoteWalk();
        walk.visit(root);
        let definitions = walk.definitions;
        for (var i = 0; i < definitions.length; i += 1) {
          let label = normalizeLabel(new FootnoteDefinition(definitions[i]).label);
          if (!byLabel.has(label)) { byLabel[label] = definitions[i]; }
        }
        let numberOf = new MapBuilder<Int, Int>();
        let references = walk.references;
        for (var i = 0; i < references.length; i += 1) {
          let reference = references[i];
          let found = definitionOf(reference);
          if (found != null) {
            let key = found.offset;
            var number = numberOf.getOr(key, 0);
            if (number == 0) {
              used.add(found);
              counts.add(0);
              number = used.length;
              numberOf[key] = number;
            }
            counts.set(number - 1, counts[number - 1] + 1);
            numbers[reference.offset] = number;
            places[reference.offset] = counts[number - 1];
          }
        }
      }

The definition `reference` goes to, or null.

      public definitionOf(reference: RedNode): RedNode? {
        let label = footnoteLabelOf(reference);
        if (utf8Length(label) > 1000) { return null; }
        let normalized = normalizeLabel(label);
        if (normalized.isEmpty) { return null; }
        if (byLabel.has(normalized)) { byLabel[normalized] orelse panic() } else { null }
      }

The number of the reference at `offset`, or 0 if none, and its place
among its definition's references.

      public numberAt(offset: Int): Int { numbers.getOr(offset, 0) }
      public placeAt(offset: Int): Int { places.getOr(offset, 0) }
    }

    let utf8Length(text: String): Int {
      var length = 0;
      for (var i = String.begin; text.hasIndex(i); i = text.next(i)) {
        let c = text[i];
        length += if (c < 0x80) { 1 } else if (c < 0x800) { 2 } else if (c < 0x10000) { 3 } else { 4 };
      }
      length
    }

## Escaping for edits

`text` as Markdown that reads as `text`: backslashes before what would
otherwise start markup, and line breaks as spaces. Leading and
trailing spaces and tabs are trimmed, as a heading's are. A trailing
run of `#` gets a backslash, so it can't read as a closing sequence.
With `tilde`, so does each `~`, for strikethrough, and with `pipe`,
each `|`, for a table cell.

    let escapeInline(text: String, tilde: Boolean, pipe: Boolean): String {
      let start = skipBlanksAt(text, String.begin, text.end);
      let end = trimBlanksBackAt(text, start, text.end);
      var hashes = end;
      while (hashes > start && text[text.prev(hashes)] == char'#') { hashes = text.prev(hashes); }
      let out = new StringBuilder();
      var i = start;
      while (i < end) {
        let c = text[i];
        let next = text.next(i);
        let isBreak = c == char'\n' || c == char'\r';
        let afterCr = c == char'\n' && i > start && text[text.prev(i)] == char'\r';
        if (isBreak && !afterCr) { out.append(" "); }
        if (!isBreak) {
          if (
            c == char'\\' || c == char'`' || c == char'*' || c == char'_' || c == char'[' ||
            c == char']' || c == char'<' || c == char'&' || (c == char'#' && i == hashes) ||
            (c == char'~' && tilde) || (c == char'|' && pipe)
          ) {
            out.append("\\");
          }
          out.append(text.slice(i, next));
        }
        i = next;
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
      before.slice(String.begin, before.step(String.begin, prefix)) ==
        after.slice(String.begin, after.step(String.begin, prefix)) &&
        before.slice(before.step(before.end, -suffix), before.end) ==
        after.slice(after.step(after.end, -suffix), after.end)
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

    test("links: every link, in order, nested ones too") {
      let text = [
        "# [h](/h)\n",
        "\n",
        "> - *[a](/a)* and **[b][r]**\n",
        ">   1. [c]\n",
        "\n",
        "| [d](/d) | `[no](/no)` |\n",
        "|---|---|\n",
        "| ![i [e](/e)](/img) | <https://x.test> www.x.test |\n",
        "\n",
        "    [code](/code)\n",
        "\n",
        "Text[^n] and <b>[f](/f)</b>.\n",
        "\n",
        "[^n]: In a [g](/g) note.\n",
        "\n",
        "[r]: /r\n",
        "[c]: /c\n",
      ].join("") { (s: String): String => s };
      let doc = MarkdownParser.gfm.parse(text);
      let links = doc.links;
      let texts = links.join(" ") { (link: Link): String => link.text };
      assert(texts == "h a b c d e f g") { texts };
      let urls = links.join(" ") { (link: Link): String => link.destination?.url ?? "null" };
      assert(urls == "/h /a /r /c /d /e /f /g") { urls };
      assert(links[2].style == "full" && links[3].style == "shortcut") { links[3].style };
      assert(parseMarkdown("`[a](/a)` <https://x.test> ![b](/b)\n").links.length == 0) { "no code, autolinks, or images" };
    }

    test("edits through links change only the destination and reparse the same") {
      let text = "> - *[a](/a)*\n\n| ![i [e](/e)](/img) |\n|---|\n| [d](/d) |\n\nHi[^n] [r].\n\n[^n]: A [g](/g \"t\").\n\n[r]: /r\n";
      let doc = MarkdownParser.gfm.parse(text);
      let links = doc.links;
      assert(links.length == 5) { links.length.toString() };
      let a = links[0].withDestination(new LinkTarget("/new a")) orelse panic();
      assert(a.asWritten == "> - *[a](</new a>)*\n\n| ![i [e](/e)](/img) |\n|---|\n| [d](/d) |\n\nHi[^n] [r].\n\n[^n]: A [g](/g \"t\").\n\n[r]: /r\n") { a.asWritten };
      let e = links[1].withDestination(new LinkTarget("/x")) orelse panic();
      assert(e.links[1].destination?.url == "/x") { e.asWritten };
      let d = links[2].withDestination(new LinkTarget("/y")) orelse panic();
      assert(d.asWritten == "> - *[a](/a)*\n\n| ![i [e](/e)](/img) |\n|---|\n| [d](/y) |\n\nHi[^n] [r].\n\n[^n]: A [g](/g \"t\").\n\n[r]: /r\n") { d.asWritten };
      let g = links[4].withDestination(new LinkTarget("/z")) orelse panic();
      assert(g.links[4].destination?.url == "/z" && g.links[4].title == "t") { g.asWritten };
      let edits = [a, e, d, g];
      for (var i = 0; i < edits.length; i += 1) {
        let edited = edits[i];
        let reparsed = MarkdownParser.gfm.parse(edited.asWritten);
        let before = edited.links.join(" ") { (link: Link): String => "${link.text}=${link.destination?.url ?? "null"}" };
        let after = reparsed.links.join(" ") { (link: Link): String => "${link.text}=${link.destination?.url ?? "null"}" };
        assert(before == after) { after };
        assert(reparsed.toHtml() == edited.toHtml()) { edited.asWritten };
      }
      let bad = do { links[3].withDestination(new LinkTarget("/x")); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "a reference's destination is its definition's" };
      assert(doc.asWritten == text) { "the old document is unchanged" };
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

### GFM views and edits

    test("GFM views: tables, task list items, strikethrough, and autolinks") {
      let text = "| a | b \\| c | `x\\|y` |\n|:-|-:|:-:|\n| ~~s~~ | www.ex.com | me@x.io |\n| only\n\n- [ ] todo\n- [X] done\n";
      let doc = MarkdownParser.gfm.parse(text);
      assert(doc.asWritten == text) { doc.asWritten };
      let table = doc.tables[0];
      assert(table.columns == 3) { table.columns.toString() };
      let alignments = table.alignments.join(" ") { (s: String): String => s };
      assert(alignments == "left right center") { alignments };
      let header = table.header;
      assert(header.isHeader && header.cells[1].text == "b | c") { header.cells[1].text };
      assert(header.cells[2].text == "x|y") { header.cells[2].text };
      let rows = table.rows;
      assert(rows.length == 2 && !rows[0].isHeader) { rows.length.toString() };
      let cells = rows[0].cells;
      let strike = cells[0].children[0] as Strikethrough orelse panic();
      assert(strike.marker == "~~" && strike.text == "s") { strike.text };
      let www = cells[1].children[0] as Autolink orelse panic();
      assert(www.style == "www" && www.destination.url == "http://www.ex.com") { www.destination.url };
      let email = cells[2].children[0] as Autolink orelse panic();
      assert(email.style == "email" && email.isEmail && email.destination.url == "mailto:me@x.io") { email.text };
      assert(cells[2].column == 2 && cells[2].alignment == "center") { cells[2].alignment };
      assert(rows[1].cells.length == 1) { "short rows keep the cells written" };
      let tasks = doc.taskListItems;
      assert(tasks.length == 2 && !tasks[0].checked && tasks[1].checked) { tasks.length.toString() };
      assert(tasks[1].marker == "[X]" && tasks[0].item.marker == "-") { tasks[1].marker };
      let paragraph = tasks[0].item.children[0] as Paragraph orelse panic();
      assert(paragraph.text == "todo") { paragraph.text };
      let url = (MarkdownParser.gfm.parse("See https://x.test/a.").children[0] as Paragraph orelse panic()).children[1] as Autolink orelse panic();
      assert(url.style == "url" && url.text == "https://x.test/a") { url.text };
      let angle = (parseMarkdown("<https://x.test>").children[0] as Paragraph orelse panic()).children[0] as Autolink orelse panic();
      assert(angle.style == "angle") { angle.style };
    }

    test("TableCell.withText and TaskListItem.withChecked change only their span") {
      let text = "Intro\n\n> | a | b |\n> |---|---|\n> | old | x |\n\n- [ ] one\n- [X] two\n";
      let doc = MarkdownParser.gfm.parse(text);
      let cell = doc.tables[0].rows[0].cells[0];
      let edited = cell.withText("new | ~~not~~");
      let expected = "Intro\n\n> | a | b |\n> |---|---|\n> | new \\| \\~\\~not\\~\\~ | x |\n\n- [ ] one\n- [X] two\n";
      assert(edited.asWritten == expected) { edited.asWritten };
      let again = edited.tables[0].rows[0].cells;
      assert(again.length == 2 && again[0].text == "new | ~~not~~") { again[0].text };
      let reparsed = MarkdownParser.gfm.parse(edited.asWritten);
      assert(reparsed.tables[0].rows[0].cells[0].text == "new | ~~not~~") { "reparses the same" };
      let checked = doc.taskListItems[0].withChecked(true);
      assert(checked.asWritten == "Intro\n\n> | a | b |\n> |---|---|\n> | old | x |\n\n- [x] one\n- [X] two\n") { checked.asWritten };
      let same = doc.taskListItems[1].withChecked(true);
      assert(same.asWritten == text) { "already checked: [X] stays" };
      let unchecked = doc.taskListItems[1].withChecked(false);
      assert(!unchecked.taskListItems[1].checked) { unchecked.asWritten };
      assert(doc.asWritten == text) { "the old document is unchanged" };
    }

Edits reparse inlines as the document was parsed: `~` is escaped only
where strikethrough is on, and a URL links where extended autolinks
are.

    test("withText follows the document's extensions") {
      let gfm = MarkdownParser.gfm.parse("# T\n").headings[0].withText("a~b~ www.x.test");
      assert(gfm.asWritten == "# a\\~b\\~ www.x.test\n") { gfm.asWritten };
      assert(gfm.toHtml() == "<h1>a~b~ <a href=\"http://www.x.test\">www.x.test</a></h1>\n") { gfm.toHtml() };
      let plain = parseMarkdown("# T\n").headings[0].withText("a~b~ www.x.test");
      assert(plain.asWritten == "# a~b~ www.x.test\n") { plain.asWritten };
    }
