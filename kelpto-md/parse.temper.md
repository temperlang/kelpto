# Parsing

Parses Markdown into a green tree that keeps every code point, so
`asWritten` gives the input back exactly, for any input. Text the
parser doesn't understand stays as text.

    let {
      GreenElement, GreenNode, GreenNodeBuilder, GreenToken, Kind, RedNode, redRoot,
    } = import("../kelpto-core");

The character classes this file uses (`isAsciiAlpha` and the like) are
imported in `blocks.temper.md`: importing a function in two files of
one library breaks it in Lua (2026-10-30).

## What it understands so far

- **Blocks:** all of CommonMark's: thematic breaks, ATX and setext
  headings, indented and fenced code, HTML blocks (all seven kinds),
  link reference definitions, paragraphs, blank lines, block quotes,
  and lists, tight and loose, with the spec's rules for containers,
  lazy lines, and tabs. See `blocks.temper.md`.
- **Inlines:** all of CommonMark's: backslash escapes, character
  references, code spans, emphasis and strong emphasis, links and
  images (inline, and full, collapsed, and shortcut references),
  autolinks, raw HTML, and hard and soft line breaks. See
  `inlines.temper.md`.

## How the tree holds the text

Each block is a node, and its text is in tokens, so nothing is lost:

- **Container prefixes** (`>`, list markers, and indentation) are
  tokens where they fall in the text: a block quote's `>` on its first
  line is in the `BlockQuote` node, and on later lines, in whatever
  node is open there, such as a paragraph running across lines. Views
  skip them.
- **Leaf blocks** hold their own markers (`#`, fences, underlines), and
  paragraphs and headings an `InlineContent` node with their inlines,
  without the whitespace around them.
- **Line endings** stay as written, `\n`, `\r\n`, or `\r`, each in a
  `LineEnding` token.

## Kinds

Nodes, which typed views wrap:

    export let documentKind = new Kind(100, "Document");
    export let headingKind = new Kind(101, "Heading");
    export let paragraphKind = new Kind(102, "Paragraph");
    export let blankLineKind = new Kind(103, "BlankLine");
    export let codeBlockKind = new Kind(104, "CodeBlock");
    export let openingFenceKind = new Kind(105, "OpeningFence");
    export let closingFenceKind = new Kind(106, "ClosingFence");
    export let blockQuoteKind = new Kind(108, "BlockQuote");
    export let listKind = new Kind(109, "List");
    export let listItemKind = new Kind(113, "ListItem");
    export let thematicBreakKind = new Kind(114, "ThematicBreak");
    export let setextHeadingKind = new Kind(115, "SetextHeading");
    export let indentedCodeKind = new Kind(116, "IndentedCode");
    export let htmlBlockKind = new Kind(117, "HtmlBlock");
    export let linkReferenceDefinitionKind = new Kind(118, "LinkReferenceDefinition");
    export let linkLabelKind = new Kind(119, "LinkLabel");
    export let linkTitleKind = new Kind(140, "LinkTitle");

The inlines of a heading or paragraph, without its markers and the
whitespace around them, so an edit can swap them as one node:

    export let inlineContentKind = new Kind(107, "InlineContent");
    export let textKind = new Kind(110, "Text");
    export let codeSpanKind = new Kind(111, "CodeSpan");
    export let rawHtmlKind = new Kind(112, "RawHtml");
    export let emphasisKind = new Kind(145, "Emphasis");
    export let strongKind = new Kind(146, "Strong");
    export let linkKind = new Kind(147, "Link");
    export let imageKind = new Kind(148, "Image");
    export let autolinkKind = new Kind(149, "Autolink");
    export let hardBreakKind = new Kind(150, "HardBreak");
    export let characterReferenceKind = new Kind(151, "CharacterReference");

Tokens:

    export let indentKind = new Kind(120, "Indent");
    export let atxMarkerKind = new Kind(121, "AtxMarker");
    export let whitespaceKind = new Kind(122, "Whitespace");
    export let closingSequenceKind = new Kind(123, "ClosingSequence");
    export let lineEndingKind = new Kind(124, "LineEnding");
    export let fenceKind = new Kind(125, "Fence");
    export let infoKind = new Kind(126, "Info");
    export let codeLineKind = new Kind(127, "CodeLine");
    export let plainKind = new Kind(128, "Plain");
    export let escapeKind = new Kind(129, "Escape");
    export let backticksKind = new Kind(130, "Backticks");
    export let codeTextKind = new Kind(131, "CodeText");
    export let htmlTextKind = new Kind(132, "OpaqueHtml");
    export let blockQuoteMarkerKind = new Kind(133, "BlockQuoteMarker");
    export let listMarkerKind = new Kind(134, "ListMarker");
    export let thematicBreakMarkerKind = new Kind(135, "ThematicBreakMarker");
    export let setextMarkerKind = new Kind(136, "SetextMarker");
    export let colonKind = new Kind(141, "Colon");
    export let linkDestinationKind = new Kind(142, "LinkDestination");
    export let labelTextKind = new Kind(143, "LabelText");
    export let titleTextKind = new Kind(144, "TitleText");

Inline markup, all kept as written: emphasis's `*` or `_` (only those
used; the rest of a run is text), a link's `[`, an image's `![`, `]`,
and the parentheses around a destination and title, an autolink's `<`
and `>`, a hard break's backslash or spaces, and a character
reference from `&` to `;`.

    export let emphasisMarkerKind = new Kind(152, "EmphasisMarker");
    export let linkOpenKind = new Kind(153, "LinkOpen");
    export let imageOpenKind = new Kind(154, "ImageOpen");
    export let linkCloseKind = new Kind(155, "LinkClose");
    export let openParenKind = new Kind(156, "OpenParen");
    export let closeParenKind = new Kind(157, "CloseParen");
    export let angleBracketKind = new Kind(158, "AngleBracket");
    export let autolinkTextKind = new Kind(159, "AutolinkText");
    export let hardBreakMarkerKind = new Kind(160, "HardBreakMarker");
    export let referenceTextKind = new Kind(161, "ReferenceText");

GitHub Flavored Markdown's extensions, when on (see `MarkdownParser`):
tables, each row a node, its cells nodes holding their inlines, with
every `|` a `Pipe` token and each delimiter (`:--`) a `TableDelimiter`
token; a task list item's `[ ]` or `[x]`, a `TaskMarker` token in its
item; strikethrough, its `~` runs `StrikethroughMarker` tokens; and
extended autolinks, written without angle brackets, a node for each
style, holding `AutolinkText` and any `Escape` tokens. In a table cell,
a backslash before `|` is a `PipeEscape` token, since GFM drops it
before reading the cell's inlines.

    export let tableKind = new Kind(162, "Table");
    export let tableHeaderRowKind = new Kind(163, "TableHeaderRow");
    export let tableDelimiterRowKind = new Kind(164, "TableDelimiterRow");
    export let tableRowKind = new Kind(165, "TableRow");
    export let tableCellKind = new Kind(166, "TableCell");
    export let pipeKind = new Kind(167, "Pipe");
    export let tableDelimiterKind = new Kind(168, "TableDelimiter");
    export let pipeEscapeKind = new Kind(169, "PipeEscape");
    export let taskMarkerKind = new Kind(170, "TaskMarker");
    export let strikethroughKind = new Kind(171, "Strikethrough");
    export let strikethroughMarkerKind = new Kind(172, "StrikethroughMarker");
    export let urlAutolinkKind = new Kind(173, "UrlAutolink");
    export let wwwAutolinkKind = new Kind(174, "WwwAutolink");
    export let emailAutolinkKind = new Kind(175, "EmailAutolink");

GFM's footnotes, when on: a definition, `[^label]:` and its blocks, a
container like a block quote, its marker tokens on its first line; and
a reference, `[^label]`, inline. Both write `[^` as a `FootnoteOpen`
token, the label as `LabelText`, and `]` as `LinkClose`, then a
definition's `:` as `Colon`. In a table cell, a backslash before `|` in
a reference's label is a `PipeEscape` token, as elsewhere in cells.

    export let footnoteDefinitionKind = new Kind(184, "FootnoteDefinition");
    export let footnoteReferenceKind = new Kind(185, "FootnoteReference");
    export let footnoteOpenKind = new Kind(186, "FootnoteOpen");

A document parsed with any GFM extension on has a root kind saying
so: which inline extensions, so edits that reparse inlines
(`Heading.withText`, `TableCell.withText`) read them as the parser
did, or else only that it's GFM, for rendering as cmark-gfm does.
Footnotes count as inline, and also tell the renderer to number them.
Every one is named `Document`.

    let documentKindFor(extensions: Extensions): Kind {
      let s = extensions.strikethrough;
      let a = extensions.autolinks;
      if (extensions.footnotes) {
        return new Kind(if (s && a) { 183 } else if (s) { 181 } else if (a) { 182 } else { 180 }, "Document");
      }
      if (s && a) { return new Kind(178, "Document"); }
      if (s) { return new Kind(176, "Document"); }
      if (a) { return new Kind(177, "Document"); }
      if (extensions.tables || extensions.taskListItems) { return new Kind(179, "Document"); }
      documentKind
    }

Whether the document holding `node` was parsed with any GFM extension.

    let isGfmDocument(node: RedNode): Boolean {
      node.root.green.kind.id != documentKind.id
    }

The inline extensions of the document holding `node`, from its root's
kind. Block extensions don't change inlines, so `tables` stands for
them all, and the inlines of a document with only those read as GFM's.

    let inlineExtensionsOf(node: RedNode): Extensions {
      let id = node.root.green.kind.id;
      new Extensions(
        id != documentKind.id, false, id == 176 || id == 178 || id == 181 || id == 183,
        id == 177 || id == 178 || id == 182 || id == 183, id >= 180 && id <= 183,
      )
    }

Whether the document holding `node` was parsed with footnotes on.

    let hasFootnotes(node: RedNode): Boolean {
      let id = node.root.green.kind.id;
      id >= 180 && id <= 183
    }

A tab partly used by a prefix, with 1, 2, or 3 columns left for the
block after it; code blocks show those columns as spaces.

    export let tabRemainder1Kind = new Kind(137, "TabRemainder1");
    export let tabRemainder2Kind = new Kind(138, "TabRemainder2");
    export let tabRemainder3Kind = new Kind(139, "TabRemainder3");

    let tabRemainderKind(columns: Int): Kind {
      if (columns == 1) { tabRemainder1Kind } else if (columns == 2) { tabRemainder2Kind } else { tabRemainder3Kind }
    }

The columns a `TabRemainder` token stands for, or 0 for other kinds.

    let tabRemainderColumns(kind: Kind): Int {
      let id = kind.id;
      if (id == tabRemainder1Kind.id) { 1 } else if (id == tabRemainder2Kind.id) { 2 } else if (id == tabRemainder3Kind.id) { 3 } else { 0 }
    }

## Raw HTML: the coordination point

kelpto-md finds raw HTML by CommonMark's own rules, both inline and in
HTML blocks, then asks a `RawHtmlHandler` what goes inside the node.
The default keeps it as one opaque token. The `kelpto` library supplies
a handler that parses it with kelpto-html, so the HTML becomes a
subtree in the same green tree. This way kelpto-md never imports
kelpto-html, and any other parser can plug in too.

Raw HTML split by container prefixes, as in an HTML block inside a
block quote, can't be handed over as one piece; it stays opaque text
between the prefixes.

    export interface RawHtmlHandler {

The children for a `RawHtml` or `HtmlBlock` node holding `html`. Their
text together must be exactly `html`; if not, the parser ignores them
and keeps `html` as one opaque token, so a faulty handler can't lose
text.

      public parseRawHtml(html: String): List<GreenElement>;
    }

The default: raw HTML stays one `OpaqueHtml` token.

    export class OpaqueRawHtml extends RawHtmlHandler {
      public constructor() {}
      public parseRawHtml(html: String): List<GreenElement> {
        // Typed first: C++ and Rust type `[subtype]` as a list of the
        // subtype, not the declared `List<GreenElement>` (2026-10-30).
        let token: GreenElement = new GreenToken(htmlTextKind, html);
        [token]
      }
    }

    export let opaqueRawHtml: RawHtmlHandler = new OpaqueRawHtml();

## The entry point

Parses `text` as CommonMark, with raw HTML handled by `rawHtmlHandler`.
Never fails: any text is some document.

    export let parseMarkdown(
      text: String, rawHtmlHandler: RawHtmlHandler = opaqueRawHtml,
    ): MarkdownDocument {
      new MarkdownDocument(redRoot(parseWith(text, rawHtmlHandler, noExtensions)))
    }

The green tree alone, for tools working below the typed views.

    export let parseMarkdownGreen(
      text: String, rawHtmlHandler: RawHtmlHandler = opaqueRawHtml,
    ): GreenNode {
      parseWith(text, rawHtmlHandler, noExtensions)
    }

## Parsers with options

A `MarkdownParser` says which of GitHub Flavored Markdown's extensions
to read, and how to handle raw HTML. Start from `MarkdownParser.gfm`,
with all of them, or `MarkdownParser.commonMark`, with none, as
`parseMarkdown` reads, and change one option per `with` method; each
gives a new parser, so one can be shared.

```temper inert
let doc = MarkdownParser.gfm.parse("| a | b |\n| - | -: |\n| ~~c~~ | www.example.com |\n");
doc.tables[0].rows[0].cells[1].alignment;     // "right"
doc.toHtml();                                 // "<table>\n<thead>\n<tr>\n<th>a</th>…"
MarkdownParser.commonMark.withTables(true).parse(text);
```

The extensions, as GFM's spec and its reference implementation,
cmark-gfm, define them:

- **Tables:** a header row, a delimiter row (`| --- | :-: |`) setting
  each column's alignment, and rows, with cells between `|`, until a
  blank line or another block. A table can't interrupt a paragraph,
  but takes its last line as the header row.
- **Task list items:** a list item starting `[ ]`, `[x]`, or `[X]`
  then a space or tab.
- **Strikethrough:** text between runs of one or two `~`, the same on
  each side, by emphasis's rules.
- **Extended autolinks:** `www.` domains, `http://`, `https://`, and
  `ftp://` URLs, and email addresses (with `mailto:` or `xmpp:` or
  not), linked without angle brackets.
- **Footnotes:** a definition, `[^label]:` then blocks indented four
  columns after its first line, and references, `[^label]`, matching
  definitions' labels as links' do. They render numbered in order of
  first reference, in a section at the end. cmark-gfm has them as an
  option rather than an extension, but GitHub turns them on, so `gfm`
  has them too.

GFM's fifth extension, the filter for disallowed raw HTML, is on
rendering: see `MarkdownRenderer.withDisallowedRawHtmlFiltered`. With
every extension off, parsing is exactly `parseMarkdown`'s, and costs
the same.

    export class MarkdownParser {
      private rawHtmlHandler: RawHtmlHandler;
      private tables: Boolean;
      private taskListItems: Boolean;
      private strikethrough: Boolean;
      private autolinks: Boolean;
      private footnotes: Boolean;

The constructor is private, so parsers start from `commonMark` or
`gfm`. Its parameters are plain types, since Temper's C# backend makes
private constructors public.

      private constructor(
        rawHtmlHandler: RawHtmlHandler, tables: Boolean, taskListItems: Boolean,
        strikethrough: Boolean, autolinks: Boolean, footnotes: Boolean,
      ) {
        this.rawHtmlHandler = rawHtmlHandler;
        this.tables = tables;
        this.taskListItems = taskListItems;
        this.strikethrough = strikethrough;
        this.autolinks = autolinks;
        this.footnotes = footnotes;
      }

CommonMark alone, as `parseMarkdown` reads it.

      public static commonMark: MarkdownParser = new MarkdownParser(
        new OpaqueRawHtml(), false, false, false, false, false,
      );

All four of GFM's syntax extensions, tables, task list items,
strikethrough, and extended autolinks, and footnotes, as GitHub reads
them.

      public static gfm: MarkdownParser = new MarkdownParser(
        new OpaqueRawHtml(), true, true, true, true, true,
      );

      public withRawHtmlHandler(handler: RawHtmlHandler): MarkdownParser {
        new MarkdownParser(handler, tables, taskListItems, strikethrough, autolinks, footnotes)
      }

      public withTables(on: Boolean): MarkdownParser {
        new MarkdownParser(rawHtmlHandler, on, taskListItems, strikethrough, autolinks, footnotes)
      }

      public withTaskListItems(on: Boolean): MarkdownParser {
        new MarkdownParser(rawHtmlHandler, tables, on, strikethrough, autolinks, footnotes)
      }

      public withStrikethrough(on: Boolean): MarkdownParser {
        new MarkdownParser(rawHtmlHandler, tables, taskListItems, on, autolinks, footnotes)
      }

      public withExtendedAutolinks(on: Boolean): MarkdownParser {
        new MarkdownParser(rawHtmlHandler, tables, taskListItems, strikethrough, on, footnotes)
      }

      public withFootnotes(on: Boolean): MarkdownParser {
        new MarkdownParser(rawHtmlHandler, tables, taskListItems, strikethrough, autolinks, on)
      }

Parses `text`. Never fails: any text is some document.

      public parse(text: String): MarkdownDocument { new MarkdownDocument(redRoot(parseGreen(text))) }

The green tree alone.

      public parseGreen(text: String): GreenNode {
        parseWith(
          text, rawHtmlHandler,
          new Extensions(tables, taskListItems, strikethrough, autolinks, footnotes),
        )
      }
    }

Which extensions a parse reads, inside the library.

    class Extensions(
      public tables: Boolean,
      public taskListItems: Boolean,
      public strikethrough: Boolean,
      public autolinks: Boolean,
      public footnotes: Boolean,
    ) {

Whether any is on, so the document is GFM's.

      public get gfm(): Boolean {
        tables || taskListItems || strikethrough || autolinks || footnotes
      }
    }

    let noExtensions = new Extensions(false, false, false, false, false);

    let parseWith(text: String, rawHtmlHandler: RawHtmlHandler, extensions: Extensions): GreenNode {
      let blocks = new BlockParser(text, extensions);
      blocks.parse();
      let labels = definitionLabels(text, blocks.lines);
      new TreeWriter(text, blocks.lines, rawHtmlHandler, labels, extensions)
        .writeDocument(blocks.document)
    }

The labels of the document's link reference definitions, normalized,
so the inline parser knows which `[text]` are links.

    let definitionLabels(source: String, lines: List<LineData>): Mapped<String, Boolean> {
      let labels = new MapBuilder<String, Boolean>();
      for (var n = 0; n < lines.length; n += 1) {
        let leaf = lines[n].leaf;
        if (leaf != null) {
          if (leaf.blockType == typeDefinition && leaf.firstLine == n) {
            let content = paragraphContent(source, lines, n, leaf.lastLine + 1);
            let text = content.text;
            let scan = scanDefinition(text, content.start, content.end);
            if (scan != null) {
              labels[normalizeLabel(text.slice(text.next(content.start), text.prev(scan.labelEnd)))] = true;
            }
          }
        }
      }
      labels
    }

The inline content node for `text` alone, one line, used by edits that
swap inlines, so an edited tree matches what parsing its text gives:
with the inline extensions of `extensions`, and in a table cell if
`inCell`.

    let inlineContentGreen(text: String, extensions: Extensions, inCell: Boolean): GreenNode {
      let line = new LineData(String.begin, text.end, text.end);
      new TreeWriter(text, [line], opaqueRawHtml, new Map<String, Boolean>([]), extensions)
        .inlinesOnly(inCell)
    }

## Writing the tree

The second pass: the lines, with what the first gave for each, become
the green tree. Blocks open where their first token is and close after
their last line; each leaf writes all of its lines, including the
prefix tokens on lines after its first.

    class TreeWriter {
      private source: String;
      private lines: List<LineData>;
      private handler: RawHtmlHandler;
      private labels: Mapped<String, Boolean>;
      private extensions: Extensions;
      private builder: GreenNodeBuilder = new GreenNodeBuilder();
      private open: ListBuilder<BlockData> = new ListBuilder<BlockData>();
      private var inText: Boolean = false;
      private var inCell: Boolean = false;

      public constructor(
        source: String, lines: List<LineData>, handler: RawHtmlHandler,
        labels: Mapped<String, Boolean>, extensions: Extensions,
      ) {
        this.source = source;
        this.lines = lines;
        this.handler = handler;
        this.labels = labels;
        this.extensions = extensions;
      }

      public writeDocument(document: BlockData): GreenNode {
        builder.startNode(documentKindFor(extensions));
        open.add(document);
        var n = 0;
        while (n < lines.length) {
          while (open.length > 1 && open[open.length - 1].lastLine < n) {
            builder.finishNode();
            open.removeLast();
          }
          let line = lines[n];
          let prefix = line.prefix;
          for (var i = 0; i < prefix.length; i += 1) {
            let token = prefix[i];
            ensureOpen(token.owner);
            sourceToken(token.kind, token.start, token.end);
          }
          let leaf = line.leaf;
          if (leaf == null) {
            sourceToken(whitespaceKind, line.leafStart, line.contentEnd);
            lineEnding(line);
            n += 1;
          } else {
            ensureOpen(leaf.parent ?? document);
            writeLeaf(leaf);
            n = leaf.lastLine + 1;
          }
        }
        while (open.length > 1) {
          builder.finishNode();
          open.removeLast();
        }
        builder.finishNode();
        builder.finish()
      }

      public inlinesOnly(inCell: Boolean): GreenNode {
        let content = rangeContent(source, 0, String.begin, source.end);
        parseInlines(content, content.start, content.end, inCell);
        builder.finish()
      }

Opens `block`'s node, and its parents', unless open already. `open`
is a path down from the document, so a block is open just when it's at
its depth there.

      private ensureOpen(block: BlockData): Void {
        if (!isOpen(block)) {
          let closed = new ListBuilder<BlockData>();
          var at = block;
          while (!isOpen(at)) {
            closed.add(at);
            at = at.parent as BlockData orelse panic();
          }
          for (var i = closed.length - 1; i >= 0; i -= 1) {
            builder.startNode(kindOfBlock(closed[i]));
            open.add(closed[i]);
          }
        }
      }

      private isOpen(block: BlockData): Boolean {
        block.depth < open.length && open[block.depth].id == block.id
      }

      private sourceToken(kind: Kind, start: StringIndex, end: StringIndex): Void {
        if (start < end) {
          builder.token(kind, source.slice(start, end));
        }
      }

      private lineEnding(line: LineData): Void {
        sourceToken(lineEndingKind, line.contentEnd, line.breakEnd);
      }

The prefix tokens of line `n`, inside a leaf.

      private prefixOf(n: Int): Void {
        let prefix = lines[n].prefix;
        for (var i = 0; i < prefix.length; i += 1) {
          let token = prefix[i];
          sourceToken(token.kind, token.start, token.end);
        }
      }

Tokens of `kind` for the range from `start` to `end` of `content`,
with each line break in it written as the line ending, the next line's
prefix tokens, and its leading whitespace.

      private emit(content: Content, kind: Kind, start: StringIndex, end: StringIndex): Void {
        let text = content.text;
        let joins = content.joins;
        var at = start;
        var i = content.lineOf(at);
        while (at < end) {
          let lineEnd = if (i < joins.length) { joins[i] } else { content.end };
          if (at < lineEnd) {
            let stop = minIndex(end, lineEnd);
            builder.token(kind, text.slice(at, stop));
            at = stop;
          } else {
            let n = content.firstLine + i;
            lineEnding(lines[n]);
            prefixOf(n + 1);
            let next = lines[n + 1];
            sourceToken(whitespaceKind, next.leafStart, content.sourceStarts[i + 1]);
            at = text.next(at);
            i += 1;
          }
        }
      }

      private writeLeaf(leaf: BlockData): Void {
        builder.startNode(kindOfBlock(leaf));
        let type = leaf.blockType;
        if (type == typeParagraph) {
          writeParagraph(leaf.firstLine, leaf.lastLine + 1);
        } else if (type == typeSetextHeading) {
          writeParagraph(leaf.firstLine, leaf.lastLine);
          prefixOf(leaf.lastLine);
          let line = lines[leaf.lastLine];
          let start = skipBlanksAt(source, line.leafStart, line.contentEnd);
          let end = trimBlanksBackAt(source, start, line.contentEnd);
          sourceToken(indentKind, line.leafStart, start);
          sourceToken(setextMarkerKind, start, end);
          sourceToken(whitespaceKind, end, line.contentEnd);
          lineEnding(line);
        } else if (type == typeAtxHeading) {
          writeAtxHeading(lines[leaf.firstLine], leaf.firstLine);
        } else if (type == typeThematicBreak) {
          let line = lines[leaf.firstLine];
          let start = skipBlanksAt(source, line.leafStart, line.contentEnd);
          let end = trimBlanksBackAt(source, start, line.contentEnd);
          sourceToken(indentKind, line.leafStart, start);
          sourceToken(thematicBreakMarkerKind, start, end);
          sourceToken(whitespaceKind, end, line.contentEnd);
          lineEnding(line);
        } else if (type == typeFencedCode) {
          writeFencedCode(leaf);
        } else if (type == typeIndentedCode) {
          for (var n = leaf.firstLine; n <= leaf.lastLine; n += 1) {
            if (n > leaf.firstLine) { prefixOf(n); }
            codeLine(lines[n]);
          }
        } else if (type == typeHtmlBlock) {
          writeHtmlBlock(leaf);
        } else if (type == typeDefinition) {
          writeDefinition(leaf);
        } else if (type == typeTable) {
          writeTable(leaf);
        } else {
          let line = lines[leaf.firstLine];
          sourceToken(whitespaceKind, line.leafStart, line.contentEnd);
          lineEnding(line);
        }
        builder.finishNode();
      }

A paragraph's lines, or a setext heading's before its underline:
leading whitespace, the inline content, trailing whitespace, and the
last line ending.

      private writeParagraph(first: Int, end: Int): Void {
        let content = paragraphContent(source, lines, first, end);
        sourceToken(whitespaceKind, lines[first].leafStart, content.sourceStarts[0]);
        let contentEnd = trimBlanksBackAt(content.text, content.start, content.end);
        parseInlines(content, content.start, contentEnd, false);
        emit(content, whitespaceKind, contentEnd, content.end);
        lineEnding(lines[end - 1]);
      }

An ATX heading: indentation, one to six `#`, then the content, an
optional closing sequence of `#`, and whitespace between.

      private writeAtxHeading(line: LineData, n: Int): Void {
        let source = this.source;
        let end = line.contentEnd;
        let indentEnd = skipBlanksAt(source, line.leafStart, end);
        let markerEnd = atxHeadingStart(source, indentEnd, end);
        let contentStart = skipBlanksAt(source, markerEnd, end);
        let trailStart = trimBlanksBackAt(source, contentStart, end);
        var hashStart = trailStart;
        while (hashStart > contentStart && source[source.prev(hashStart)] == char'#') {
          hashStart = source.prev(hashStart);
        }
        var closeStart = trailStart;
        if (
          hashStart < trailStart &&
          (hashStart == contentStart || isSpaceOrTab(source[source.prev(hashStart)]))
        ) {
          closeStart = hashStart;
        }
        let contentEnd = trimBlanksBackAt(source, contentStart, closeStart);
        sourceToken(indentKind, line.leafStart, indentEnd);
        sourceToken(atxMarkerKind, indentEnd, markerEnd);
        sourceToken(whitespaceKind, markerEnd, contentStart);
        parseInlines(rangeContent(source, n, contentStart, contentEnd), contentStart, contentEnd, false);
        sourceToken(whitespaceKind, contentEnd, closeStart);
        sourceToken(closingSequenceKind, closeStart, trailStart);
        sourceToken(whitespaceKind, trailStart, end);
        lineEnding(line);
      }

A fenced code block: an opening fence with an optional info string,
lines of code, and a closing fence, unless it ran to the end of its
container.

      private writeFencedCode(leaf: BlockData): Void {
        let line = lines[leaf.firstLine];
        let end = line.contentEnd;
        let fenceStart = skipBlanksAt(source, line.leafStart, end);
        let fenceEnd = openingFenceEnd(source, fenceStart, end);
        let infoStart = skipBlanksAt(source, fenceEnd, end);
        let infoEnd = trimBlanksBackAt(source, infoStart, end);
        builder.startNode(openingFenceKind);
        sourceToken(indentKind, line.leafStart, fenceStart);
        sourceToken(fenceKind, fenceStart, fenceEnd);
        sourceToken(whitespaceKind, fenceEnd, infoStart);
        sourceToken(infoKind, infoStart, infoEnd);
        sourceToken(whitespaceKind, infoEnd, end);
        lineEnding(line);
        builder.finishNode();
        for (var n = leaf.firstLine + 1; n <= leaf.lastLine; n += 1) {
          prefixOf(n);
          let row = lines[n];
          if (n == leaf.lastLine && leaf.closedByFence) {
            // Only spaces and tabs follow the fence's code points.
            let closeStart = skipBlanksAt(source, row.leafStart, row.contentEnd);
            let closeEnd = trimBlanksBackAt(source, closeStart, row.contentEnd);
            builder.startNode(closingFenceKind);
            sourceToken(indentKind, row.leafStart, closeStart);
            sourceToken(fenceKind, closeStart, closeEnd);
            sourceToken(whitespaceKind, closeEnd, row.contentEnd);
            lineEnding(row);
            builder.finishNode();
          } else {
            codeLine(row);
          }
        }
      }

A line of code: the indentation the block strips, any tab remainder,
the code, and the line ending.

      private codeLine(line: LineData): Void {
        sourceToken(indentKind, line.leafStart, line.codeStart);
        var start = line.codeStart;
        if (line.tabRemainder > 0 && start < line.contentEnd) {
          let next = source.next(start);
          sourceToken(tabRemainderKind(line.tabRemainder), start, next);
          start = next;
        }
        sourceToken(codeLineKind, start, line.contentEnd);
        lineEnding(line);
      }

An HTML block: its lines go to the handler as one piece, unless
container prefixes split them; then each line is opaque text.

      private writeHtmlBlock(leaf: BlockData): Void {
        let first = lines[leaf.firstLine];
        var whole = first.tabRemainder == 0;
        for (var n = leaf.firstLine + 1; n <= leaf.lastLine; n += 1) {
          let line = lines[n];
          if (!line.prefix.isEmpty || line.leafStart != line.start) { whole = false; }
        }
        if (whole) {
          rawHtmlChildren(source.slice(first.leafStart, lines[leaf.lastLine].breakEnd));
          return;
        }
        for (var n = leaf.firstLine; n <= leaf.lastLine; n += 1) {
          if (n > leaf.firstLine) { prefixOf(n); }
          let line = lines[n];
          sourceToken(indentKind, line.leafStart, line.codeStart);
          var start = line.codeStart;
          if (line.tabRemainder > 0 && start < line.contentEnd) {
            let next = source.next(start);
            sourceToken(tabRemainderKind(line.tabRemainder), start, next);
            start = next;
          }
          sourceToken(htmlTextKind, start, line.contentEnd);
          lineEnding(line);
        }
      }

The handler's children for `html`, or one opaque token if they don't
give back exactly `html`.

      private rawHtmlChildren(html: String): Void {
        let children = handler.parseRawHtml(html);
        if (new GreenNode(rawHtmlKind, children).text == html) {
          for (var k = 0; k < children.length; k += 1) {
            builder.element(children[k]);
          }
        } else {
          builder.token(htmlTextKind, html);
        }
      }

A table: its header row, its delimiter row, and its other rows, each a
node, with container prefixes between them.

      private writeTable(leaf: BlockData): Void {
        for (var n = leaf.firstLine; n <= leaf.lastLine; n += 1) {
          if (n > leaf.firstLine) { prefixOf(n); }
          let line = lines[n];
          let start = skipBlanksAt(source, line.leafStart, line.contentEnd);
          let kind = if (n == leaf.firstLine) {
            tableHeaderRowKind
          } else if (n == leaf.firstLine + 1) {
            tableDelimiterRowKind
          } else {
            tableRowKind
          };
          builder.startNode(kind);
          sourceToken(indentKind, line.leafStart, start);
          if (n == leaf.firstLine + 1) {
            writeDelimiters(start, line.contentEnd);
          } else {
            writeCells(n, start, line.contentEnd);
          }
          lineEnding(line);
          builder.finishNode();
        }
      }

A delimiter row's tokens: pipes, whitespace, and delimiters such as
`:--`.

      private writeDelimiters(start: StringIndex, end: StringIndex): Void {
        let source = this.source;
        var i = start;
        while (i < end) {
          let c = source[i];
          var next = source.next(i);
          if (c == char'|') {
            sourceToken(pipeKind, i, next);
          } else if (isTableSpace(c)) {
            next = skipTableSpaces(source, i, end);
            sourceToken(whitespaceKind, i, next);
          } else {
            while (next < end && (source[next] == char'-' || source[next] == char':')) {
              next = source.next(next);
            }
            sourceToken(tableDelimiterKind, i, next);
          }
          i = next;
        }
      }

A row's cells, between pipes, as `tableRowCells` counts them: after
the last pipe, only spaces are no cell.

      private writeCells(n: Int, start: StringIndex, end: StringIndex): Void {
        let source = this.source;
        var i = start;
        if (i < end && source[i] == char'|') {
          let next = source.next(i);
          sourceToken(pipeKind, i, next);
          i = next;
        }
        while (true) {
          let pipe = nextPipe(source, i, end);
          if (pipe >= end) {
            if (skipTableSpaces(source, i, end) < end) {
              writeCell(n, i, end, i > start);
            } else {
              sourceToken(whitespaceKind, i, end);
            }
            break;
          }
          writeCell(n, i, pipe, i > start);
          let next = source.next(pipe);
          sourceToken(pipeKind, pipe, next);
          i = next;
        }
      }

A cell: the whitespace around its content, and its inlines. After a
pipe, cmark-gfm skips vertical tabs and form feeds too; then it trims
spaces and tabs.

      private writeCell(n: Int, start: StringIndex, end: StringIndex, afterPipe: Boolean): Void {
        builder.startNode(tableCellKind);
        let from = if (afterPipe) { skipTableSpaces(source, start, end) } else { start };
        let contentStart = skipBlanksAt(source, from, end);
        let contentEnd = trimBlanksBackAt(source, contentStart, end);
        sourceToken(whitespaceKind, start, contentStart);
        parseInlines(rangeContent(source, n, contentStart, contentEnd), contentStart, contentEnd, true);
        sourceToken(whitespaceKind, contentEnd, end);
        builder.finishNode();
      }

A link reference definition: `[label]: destination "title"`, across
lines or not.

      private writeDefinition(leaf: BlockData): Void {
        let content = paragraphContent(source, lines, leaf.firstLine, leaf.lastLine + 1);
        let text = content.text;
        let start = content.start;
        let end = content.end;
        sourceToken(whitespaceKind, lines[leaf.firstLine].leafStart, content.sourceStarts[0]);
        let scan = scanDefinition(text, start, end);
        if (scan == null) {

Not expected, since the first pass found it, but kept as text if so.

          emit(content, plainKind, start, end);
        } else {
          let colonEnd = text.next(scan.labelEnd);
          builder.startNode(linkLabelKind);
          emit(content, labelTextKind, start, scan.labelEnd);
          builder.finishNode();
          emit(content, colonKind, scan.labelEnd, colonEnd);
          emit(content, whitespaceKind, colonEnd, scan.destinationStart);
          emit(content, linkDestinationKind, scan.destinationStart, scan.destinationEnd);
          if (scan.hasTitle) {
            emit(content, whitespaceKind, scan.destinationEnd, scan.titleStart);
            builder.startNode(linkTitleKind);
            emit(content, titleTextKind, scan.titleStart, scan.titleEnd);
            builder.finishNode();
            emit(content, whitespaceKind, scan.titleEnd, end);
          } else {
            emit(content, whitespaceKind, scan.destinationEnd, end);
          }
        }
        lineEnding(lines[leaf.lastLine]);
      }

### Inlines

Runs of plain text, escapes, and line endings group into `Text` nodes,
between code spans and raw HTML.

      private openText(): Void {
        if (!inText) {
          builder.startNode(textKind);
          inText = true;
        }
      }

      private closeText(): Void {
        if (inText) {
          builder.finishNode();
          inText = false;
        }
      }

The inlines of `content` from `start` to `end`, in an `InlineContent`
node: parsed by `InlineParser` (see `inlines.temper.md`), then written
here, so each range becomes tokens with the line breaks between lines
written as `emit` writes them.

      private parseInlines(content: Content, start: StringIndex, end: StringIndex, inCell: Boolean): Void {
        let parser = new InlineParser(
          content.text, start, end, labels, extensions.strikethrough, extensions.autolinks,
          extensions.footnotes, inCell, extensions.gfm,
        );
        this.inCell = inCell;
        parser.parse();
        builder.startNode(inlineContentKind);
        writeItems(content, parser, 0);
        closeText();
        builder.finishNode();
      }

The children of `parent`, an item of `parser`. Text items group into
`Text` nodes; contiguous plain text becomes one token.

      private writeItems(content: Content, parser: InlineParser, parent: Int): Void {
        var item = parser.firsts[parent];
        while (item >= 0) {
          let kind = parser.kinds[item];
          let start = parser.starts[item];
          var end = parser.ends[item];
          if (parser.nodes[item]) {
            closeText();
            builder.startNode(kind);
            writeItems(content, parser, item);
            closeText();
            builder.finishNode();
          } else if (start == end) {
            // Emptied by emphasis: nothing to write.
          } else if (kind.id == rawHtmlKind.id) {
            closeText();
            rawHtml(content, start, end);
          } else if (parser.textual[item]) {
            openText();
            if (kind.id == plainKind.id) {
              while (parser.nexts[item] >= 0 && parser.isContiguousPlain(parser.nexts[item], end)) {
                item = parser.nexts[item];
                end = parser.ends[item];
              }
            }
            emit(content, kind, start, end);
          } else if (inCell && kind.id == labelTextKind.id) {
            closeText();
            cellLabel(content, start, end);
          } else {
            closeText();
            emit(content, kind, start, end);
          }
          item = parser.nexts[item];
        }
      }

A footnote reference's label in a table cell, with each backslash
before `|` a `PipeEscape`, which the label leaves out, as GFM drops it
before reading the cell's inlines. Done here, once per label written,
rather than as references are found, which can nest.

      private cellLabel(content: Content, start: StringIndex, end: StringIndex): Void {
        let text = content.text;
        var at = start;
        var k = start;
        while (k < end) {
          let next = text.next(k);
          if (next < end && text[k] == char'\\' && text[next] == char'|') {
            emit(content, labelTextKind, at, k);
            emit(content, pipeEscapeKind, k, next);
            at = next;
          }
          k = next;
        }
        emit(content, labelTextKind, at, end);
      }

Raw HTML goes to the handler if it's one piece in the source, and
stays opaque text between line breaks' prefixes if not.

      private rawHtml(content: Content, start: StringIndex, end: StringIndex): Void {
        builder.startNode(rawHtmlKind);
        let text = content.text;
        let first = content.lineOf(start);
        let last = content.lineOf(text.prev(end));
        var whole = true;
        for (var i = first; i < last; i += 1) {
          let next = lines[content.firstLine + i + 1];
          if (!next.prefix.isEmpty || content.sourceStarts[i + 1] != next.start) { whole = false; }
        }
        if (whole) {

As written: each line of `text` with its line ending from the source,
which may be `\r\n` or `\r` where `text` has `\n`.

          let html = new StringBuilder();
          var at = start;
          for (var i = first; i < last; i += 1) {
            let join = content.joins[i];
            let line = lines[content.firstLine + i];
            html.append(text.slice(at, join));
            html.append(source.slice(line.contentEnd, line.breakEnd));
            at = text.next(join);
          }
          html.append(text.slice(at, end));
          rawHtmlChildren(html.toString());
        } else {
          emit(content, htmlTextKind, start, end);
        }
        builder.finishNode();
      }
    }

    let kindOfBlock(block: BlockData): Kind {
      let type = block.blockType;
      if (type == typeDocument) { return documentKind; }
      if (type == typeBlockQuote) { return blockQuoteKind; }
      if (type == typeList) { return listKind; }
      if (type == typeListItem) { return listItemKind; }
      if (type == typeParagraph) { return paragraphKind; }
      if (type == typeAtxHeading) { return headingKind; }
      if (type == typeSetextHeading) { return setextHeadingKind; }
      if (type == typeThematicBreak) { return thematicBreakKind; }
      if (type == typeFencedCode) { return codeBlockKind; }
      if (type == typeIndentedCode) { return indentedCodeKind; }
      if (type == typeHtmlBlock) { return htmlBlockKind; }
      if (type == typeDefinition) { return linkReferenceDefinitionKind; }
      if (type == typeTable) { return tableKind; }
      if (type == typeFootnoteDefinition) { return footnoteDefinitionKind; }
      blankLineKind
    }

## Scanning helpers

Each reads a string by `StringIndex`, up to an `end`, and those that
find something give where it ends, or where they started if nothing is
there.

    let isSpaceOrTab(c: Int): Boolean { c == char' ' || c == char'\t' }

    let isAsciiPunctuation(c: Int): Boolean {
      (c >= 0x21 && c <= 0x2F) || (c >= 0x3A && c <= 0x40) ||
        (c >= 0x5B && c <= 0x60) || (c >= 0x7B && c <= 0x7E)
    }

After the line ending at `at`: `\n`, `\r\n`, or `\r`.

    let lineBreakEnd(text: String, at: StringIndex): StringIndex {
      let next = text.next(at);
      if (text[at] == char'\r' && text.hasIndex(next) && text[next] == char'\n') {
        text.next(next)
      } else {
        next
      }
    }

Past spaces and tabs in `text`, from `from`, before `end`.

    let skipBlanksAt(text: String, from: StringIndex, end: StringIndex): StringIndex {
      var i = from;
      while (i < end && isSpaceOrTab(text[i])) {
        i = text.next(i);
      }
      i
    }

Back over spaces and tabs before `end`, but not before `start`.

    let trimBlanksBackAt(text: String, start: StringIndex, end: StringIndex): StringIndex {
      var i = end;
      while (i > start) {
        let before = text.prev(i);
        if (!isSpaceOrTab(text[before])) { break; }
        i = before;
      }
      i
    }

Whether the two code points before `end` are spaces, after `start`.

    let endsWithTwoSpaces(text: String, start: StringIndex, end: StringIndex): Boolean {
      if (end <= start) { return false; }
      let last = text.prev(end);
      last > start && text[last] == char' ' && text[text.prev(last)] == char' '
    }

A code point before `end`, or -1.

    let codeInAt(text: String, at: StringIndex, end: StringIndex): Int {
      if (at < end) { text[at] } else { -1 }
    }

    let minIndex(a: StringIndex, b: StringIndex): StringIndex { if (a < b) { a } else { b } }

Where a run of exactly `count` backticks starts, from `from`, or `end`.

    let closingBackticks(text: String, from: StringIndex, end: StringIndex, count: Int): StringIndex {
      var i = from;
      while (i < end) {
        if (text[i] == char'`') {
          var j = i;
          var length = 0;
          while (j < end && text[j] == char'`') {
            j = text.next(j);
            length += 1;
          }
          if (length == count) { return i; }
          i = j;
        } else {
          i = text.next(i);
        }
      }
      end
    }

### Raw HTML, by CommonMark's rules

Scanners for tags, used by HTML blocks and by `InlineParser`'s
`rawHtmlEnd`, which also finds comments, processing instructions,
declarations, and CDATA sections. Each gives the end of what starts
with the `<` at `at`, or `at` if none starts there. A paragraph has no
blank lines, so a tag's whitespace holds at most one line ending, as
CommonMark allows, without checking.

A closing tag: `</`, a name, optional whitespace, and `>`.

    let closingTagEnd(text: String, at: StringIndex, end: StringIndex): StringIndex {
      let slash = text.next(at);
      if (codeInAt(text, slash, end) != char'/') { return at; }
      let nameStart = text.next(slash);
      let nameEnd = tagNameEnd(text, nameStart, end);
      if (nameEnd == nameStart) { return at; }
      let close = skipWhitespace(text, nameEnd, end);
      if (codeInAt(text, close, end) == char'>') { text.next(close) } else { at }
    }

    let skipWhitespace(text: String, from: StringIndex, end: StringIndex): StringIndex {
      var i = from;
      while (i < end && isAsciiWhitespace(text[i])) {
        i = text.next(i);
      }
      i
    }

A tag name: an ASCII letter, then letters, digits, and `-`. Gives its
end, or `from` if none.

    let tagNameEnd(text: String, from: StringIndex, end: StringIndex): StringIndex {
      if (!isAsciiAlpha(codeInAt(text, from, end))) { return from; }
      var i = text.next(from);
      while (i < end && (isAsciiAlphanumeric(text[i]) || text[i] == char'-')) {
        i = text.next(i);
      }
      i
    }

An open tag: `<`, a name, attributes, optional whitespace, an optional
`/`, and `>`.

    let openTagEnd(text: String, at: StringIndex, end: StringIndex): StringIndex {
      let nameStart = text.next(at);
      var i = tagNameEnd(text, nameStart, end);
      if (i == nameStart) { return at; }
      while (true) {
        let attributeStart = skipWhitespace(text, i, end);
        if (attributeStart == i) { break; }
        let attributeEnd = attributeEnd(text, at, attributeStart, end);
        if (attributeEnd < attributeStart) { return at; }
        if (attributeEnd == attributeStart) { break; }
        i = attributeEnd;
      }
      i = skipWhitespace(text, i, end);
      if (codeInAt(text, i, end) == char'/') { i = text.next(i); }
      if (codeInAt(text, i, end) == char'>') { text.next(i) } else { at }
    }

An attribute: a name, then optionally `=` and a value, unquoted,
single-quoted, or double-quoted. Gives `from` if no name starts there,
or `tagStart`, before it, if a value is missing.

    let attributeEnd(
      text: String, tagStart: StringIndex, from: StringIndex, end: StringIndex,
    ): StringIndex {
      let first = codeInAt(text, from, end);
      if (!(isAsciiAlpha(first) || first == char'_' || first == char':')) { return from; }
      var i = text.next(from);
      while (i < end) {
        let c = text[i];
        if (!(isAsciiAlphanumeric(c) || c == char'_' || c == char'.' || c == char':' || c == char'-')) {
          break;
        }
        i = text.next(i);
      }
      let equals = skipWhitespace(text, i, end);
      if (codeInAt(text, equals, end) != char'=') { return i; }
      let valueStart = skipWhitespace(text, text.next(equals), end);
      let quote = codeInAt(text, valueStart, end);
      if (quote == char'"' || quote == char'\'') {
        var j = text.next(valueStart);
        while (j < end) {
          if (text[j] == quote) { return text.next(j); }
          j = text.next(j);
        }
        return tagStart;
      }
      var j = valueStart;
      while (j < end) {
        let c = text[j];
        if (
          isAsciiWhitespace(c) || c == char'"' || c == char'\'' || c == char'=' ||
          c == char'<' || c == char'>' || c == char'`'
        ) {
          break;
        }
        j = text.next(j);
      }
      if (j == valueStart) { tagStart } else { j }
    }

## Tests

Printing a parsed document gives back its input exactly, for ordinary,
odd, and invalid input alike.

    let roundtripCases(): List<String> {
      [
        "", "\n", "\r\n", "\r", "   ", "x", "# Title", "# Title\n", "#\n", "####### seven\n",
        "#hashtag\n", "  ## Indented ##  \r\n", "# Title # with # hashes ###\n", "# \\#\n",
        "Para one\nline two\r\n\r\nPara two\n\n\n", "    four spaces\n", "\t# tab\n",
        "```\ncode\n```\n", "```rust info\n  let x;\n````\nafter\n", "~~~\nunclosed",
        "``` a`b\nnot a fence\n", "  ~~~~\n~~~\n~~~~~", "``\n``\n",
        "`code` and ``a ` b`` and `unclosed", "<b>bold</b> <a href='x' title=\"y\" data-z=w>",
        "<!-- comment --> <!--> <!---> <!-- unclosed", "<1> < b> <b <b/> </b > </ b> <a href>",
        "<a\nhref=\"x\">\nmore", "\\`not code\\` \\\\ \\a", "* list\n- item\n> quote\n---\n",
        "é😀\u{0}\u{FEFF}\n", "trailing  \n  spaces  ", "line\rbreaks\r\nmixed\n",
        "> quote\r\n> > nested\rlazy\n>\n", "- a\n  - b\n\n- c", "1) x\n2) y\n10. z",
        ">\t\tcode\n-\t\tcode\n \t- x\n", "Title\n===\n\nSub\r\n---\r\n",
        "    code\n\n\n    more\n\n", "<div>\n<b>\n\n<!--\n\n-->\n<?x?>\n<![CDATA[\n]]>\n",
        "[a]: /u\n[b]:\n<c d> 'e\nf'\n[bad]: x y\n", "- \n  x\n-\n\n  y", "* * *\n_ _ _\n-\t-\t-",
        "> ```\n> code\n```\n", "- ```\n  a\n\n  b\n  ```\n", "  > - 1.  > x\n  >   >  y",
        "<pre>\nx\n</pre>y\n", "\t\t\n\t>\t\n", "[\nlabel\n]: <> (t)\n",
      ]
    }

    test("roundtrip: asWritten gives the input back") {
      let cases = roundtripCases();
      for (var i = 0; i < cases.length; i += 1) {
        let text = cases[i];
        let written = parseMarkdown(text).asWritten;
        assert(written == text) { "${i.toString()}: ${written}" };
      }
    }

Random mixes of block markers, tabs, and line endings, from a fixed
seed, so a failure repeats. Each must roundtrip, and render without
failing.

    let fuzzPieces(): List<String> {
      [
        "> ", ">", "- ", "-", "* ", "+ ", "1. ", "2) ", "10. ", "#", "# ", "###### ", "```", "~~~",
        "    ", "  ", " ", "\t", "\n", "\r\n", "\r", "\n\n", "text", "a", "===", "---", "***",
        "<div>", "</div>", "<!--", "-->", "<?", "?>", "<![CDATA[", "]]>", "<pre>", "</pre>",
        "<a href='x'>", "[a]:", " /url", " 'title'", "[", "]", "`", "``", "\\", "\u{0}", "é",
        "😀", "<", ">", "\"",
      ]
    }

    test("roundtrip: fuzzing with block markers, tabs, and line endings") {
      let pieces = fuzzPieces();
      var state = 12345;
      var failures = 0;
      var rendered = 0;
      var first = "";
      for (var round = 0; round < 400; round += 1) {
        let out = new StringBuilder();
        state = (state * 75 + 74) % 65537;
        let count = 1 + state % 40;
        for (var k = 0; k < count; k += 1) {
          state = (state * 75 + 74) % 65537;
          out.append(pieces[state % pieces.length]);
        }
        let text = out.toString();
        let doc = parseMarkdown(text);
        if (!doc.toHtml().isEmpty || !doc.blocks.isEmpty) { rendered += 1; }
        if (doc.asWritten != text) {
          failures += 1;
          if (first == "") { first = text; }
        }
      }
      assert(failures == 0 && rendered > 0) { "${failures.toString()} failed, such as ${first}" };
    }

Every block's span starts where the last one ended, so the blocks tile
the document.

    test("roundtrip: blocks tile the document") {
      let doc = parseMarkdown("# A\n\npara\nmore\n```\nx\n```\n# B");
      var at = 0;
      let kinds = new ListBuilder<String>();
      let blocks = doc.children;
      for (var i = 0; i < blocks.length; i += 1) {
        let block = blocks[i];
        assert(block.span.start == at) { block.span.toString() };
        at = block.span.end;
        kinds.add(block.node.kind.name);
      }
      let names = kinds.join(" ") { (s: String): String => s };
      assert(names == "Heading BlankLine Paragraph CodeBlock Heading") { names };
      assert(at == doc.span.length) { "covers the whole document" };
    }

A handler that loses text is ignored, so the tree stays lossless.

    class LossyHandler extends RawHtmlHandler {
      public constructor() {}
      public parseRawHtml(html: String): List<GreenElement> {
        let token: GreenElement = new GreenToken(htmlTextKind, "oops");
        [token]
      }
    }

    test("a lossy RawHtmlHandler can't lose text") {
      let doc = parseMarkdown("a <b> c", new LossyHandler());
      assert(doc.asWritten == "a <b> c") { doc.asWritten };
    }

### GFM's extensions

Off, as in `parseMarkdown`, GFM's syntax is plain CommonMark.

    test("GFM extensions are off unless asked for") {
      let text = "~~a~~ www.x.test a@b.test\n| a |\n|-|\n- [ ] x\n";
      let html = parseMarkdown(text).toHtml();
      let expected = "<p>~~a~~ www.x.test a@b.test\n| a |\n|-|</p>\n<ul>\n<li>[ ] x</li>\n</ul>\n";
      assert(html == expected) { html };
      assert(MarkdownParser.commonMark.parse(text).toHtml() == expected) { "commonMark is parseMarkdown" };
      let tables = MarkdownParser.commonMark.withTables(true).parse(text).toHtml();
      let tablesOnly = "<p>~~a~~ www.x.test a@b.test</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n</table>\n<ul>\n<li>[ ] x</li>\n</ul>\n";
      assert(tables == tablesOnly) { tables };
    }

Each extension alone, and the parser keeps its raw HTML handler.

    test("MarkdownParser options, one at a time") {
      let c = MarkdownParser.commonMark;
      let strike = c.withStrikethrough(true).parse("~~a~~ ~b~ ~~~c~~~").toHtml();
      assert(strike == "<p><del>a</del> <del>b</del> ~~~c~~~</p>\n") { strike };
      let links = c.withExtendedAutolinks(true).parse("www.a.test, https://b.test/x). c@d.test").toHtml();
      let expectedLinks = "<p><a href=\"http://www.a.test\">www.a.test</a>, <a href=\"https://b.test/x\">https://b.test/x</a>). <a href=\"mailto:c@d.test\">c@d.test</a></p>\n";
      assert(links == expectedLinks) { links };
      let tasks = c.withTaskListItems(true).parse("- [x] a\n- [y] b\n").toHtml();
      assert(tasks == "<ul>\n<li><input type=\"checkbox\" checked=\"\" disabled=\"\" /> a</li>\n<li>[y] b</li>\n</ul>\n") { tasks };
      let lossy = MarkdownParser.gfm.withRawHtmlHandler(new LossyHandler()).parse("a <b> c");
      assert(lossy.asWritten == "a <b> c") { lossy.asWritten };
      let off = MarkdownParser.gfm.withTables(false).withTaskListItems(false).withStrikethrough(false)
        .withExtendedAutolinks(false).parse("~~a~~").toHtml();
      assert(off == "<p>~~a~~</p>\n") { off };
    }

Where kelpto-md follows GFM's spec rather than cmark-gfm: task list
items in block quotes and nested on one line are task items (cmark-gfm
looks for the marker from the start of the line only).

    test("GFM: task list items inside containers") {
      let html = MarkdownParser.gfm.parse("> - [ ] a\n- - [x] b\n").toHtml();
      let expected = "<blockquote>\n<ul>\n<li><input type=\"checkbox\" disabled=\"\" /> a</li>\n</ul>\n</blockquote>\n<ul>\n<li>\n<ul>\n<li><input type=\"checkbox\" checked=\"\" disabled=\"\" /> b</li>\n</ul>\n</li>\n</ul>\n";
      assert(html == expected) { html };
    }

    test("GFM: tables end at a blank line or another block, and take paragraphs' last lines") {
      let doc = MarkdownParser.gfm.parse("[r]: /u\nintro\n| a |\n| - |\n| [r] |\n    code\n");
      let kinds = new ListBuilder<String>();
      let blocks = doc.children;
      for (var i = 0; i < blocks.length; i += 1) { kinds.add(blocks[i].node.kind.name); }
      let names = kinds.join(" ") { (s: String): String => s };
      assert(names == "LinkReferenceDefinition Paragraph Table IndentedCode") { names };
      let html = doc.toHtml();
      assert(html.split("<td><a href=\"/u\">r</a></td>").length == 2) { html };
      let mismatch = MarkdownParser.gfm.parse("a | b\n|-|\nc\n|-|\n").toHtml();
      assert(mismatch == "<p>a | b\n|-|\nc\n|-|</p>\n") { mismatch };
    }

One place where cmark-gfm's inline scan differs from CommonMark's,
followed in GFM documents, those parsed with any extension on: `![^`
never starts an image, footnotes or not. Plain CommonMark documents
read it as CommonMark does.

    test("GFM: `![^` is no image, footnotes or not") {
      let text = "![^a](/u) ![a](/v)\n";
      let cm = parseMarkdown(text).toHtml();
      assert(cm == "<p><img src=\"/u\" alt=\"^a\" /> <img src=\"/v\" alt=\"a\" /></p>\n") { cm };
      let expected = "<p>!<a href=\"/u\">^a</a> <img src=\"/v\" alt=\"a\" /></p>\n";
      let tablesOnly = MarkdownParser.commonMark.withTables(true).parse(text);
      assert(tablesOnly.toHtml() == expected) { tablesOnly.toHtml() };
      assert(tablesOnly.asWritten == text) { tablesOnly.asWritten };
      let gfm = MarkdownParser.gfm.withFootnotes(false).parse(text).toHtml();
      assert(gfm == expected) { gfm };
    }

Random mixes of GFM's markup, footnotes included, from a fixed seed.
Each must roundtrip, and render without failing, with all of GFM on.

    let gfmPieces(): List<String> {
      [
        "|", " | ", "\\|", "\\\\|", "---", ":-", "-:", ":-:", "|-|", "\n", "\r\n", "\r", "\n\n", "a",
        "~", "~~", "~~~", " ", "\t", "www.", "x.test", "http://", "https://a.b", "ftp:", "@", "a@b.c",
        "mailto:", "xmpp:", "_", "*", "(", ")", "&amp;", ";", "<", ">", "- ", "1. ", "[ ] ", "[x] ",
        "[X]", "> ", "    ", "`", "[", "]", "é", "😀", "\u{B}", "[^a]", "[^a]: ", "[^", "^", "![",
      ]
    }

    test("roundtrip: fuzzing with GFM's markup") {
      let pieces = gfmPieces();
      var state = 777;
      var failures = 0;
      var rendered = 0;
      var first = "";
      for (var round = 0; round < 600; round += 1) {
        let out = new StringBuilder();
        state = (state * 75 + 74) % 65537;
        let count = 1 + state % 50;
        for (var k = 0; k < count; k += 1) {
          state = (state * 75 + 74) % 65537;
          out.append(pieces[state % pieces.length]);
        }
        let text = out.toString();
        let doc = MarkdownParser.gfm.parse(text);
        let html = new MarkdownRenderer().withRawHtmlTrusted().withDisallowedRawHtmlFiltered().render(doc);
        if (!html.isEmpty || !doc.blocks.isEmpty) { rendered += 1; }
        if (doc.asWritten != text) {
          failures += 1;
          if (first == "") { first = text; }
        }
      }
      assert(failures == 0 && rendered > 0) { "${failures.toString()} failed, such as ${first}" };
    }

### GFM's footnotes

Rendered HTML below is cmark-gfm 0.29.0.gfm.13's for the same input
(with all of GFM and footnotes on), byte for byte. These helpers write
its markup for a reference and a backlink.

    let fnRef(id: String, number: Int, place: Int): String {
      let suffix = if (place > 1) { "-${place.toString()}" } else { "" };
      "<sup class=\"footnote-ref\"><a href=\"#fn-${id}\" id=\"fnref-${id}${suffix}\" data-footnote-ref>${number.toString()}</a></sup>"
    }

    let fnBack(id: String, number: Int, place: Int): String {
      let n = number.toString();
      if (place == 1) {
        return "<a href=\"#fnref-${id}\" class=\"footnote-backref\" data-footnote-backref data-footnote-backref-idx=\"${n}\" aria-label=\"Back to reference ${n}\">↩</a>";
      }
      let p = place.toString();
      " <a href=\"#fnref-${id}-${p}\" class=\"footnote-backref\" data-footnote-backref data-footnote-backref-idx=\"${n}-${p}\" aria-label=\"Back to reference ${n}-${p}\">↩<sup class=\"footnote-ref\">${p}</sup></a>"
    }

    let joined(parts: List<String>): String { parts.join("") { (s: String): String => s } }

Definitions keep every code point where they're written, and render
at the end in order of first reference, the unused one left out, a
reference in it still counting. References match case-insensitively;
one without a definition is its text, markup and all; `![^` is no
image.

    test("GFM footnotes: definitions and references, losslessly") {
      let text = "Hi[^n] and[^N], ![^n] [^none] [^x *y*].\n\n> [^n]: A *note*.\n>\n>     More.\n\n[^u]: Unused, but [^m].\n\n[^m]:\n    ```\n    code\n    ```\n";
      let doc = MarkdownParser.gfm.parse(text);
      assert(doc.asWritten == text) { doc.asWritten };
      let definitions = doc.footnoteDefinitions;
      let labels = new ListBuilder<String>();
      for (var i = 0; i < definitions.length; i += 1) { labels.add(definitions[i].label); }
      assert(joined(labels.toList()) == "num") { joined(labels.toList()) };
      let quote = doc.children[2] as BlockQuote orelse panic();
      let note = quote.children[0] as FootnoteDefinition orelse panic();
      assert(note.asWritten == "[^n]: A *note*.\n") { note.asWritten };
      let after = quote.children;
      assert(note.children[0] is Paragraph && after[after.length - 1] is IndentedCode) { "the `>` line ends it" };
      let references = doc.footnoteReferences;
      assert(references.length == 6) { references.length.toString() };
      assert(references[1].label == "N" && references[1].definition?.label == "n") { references[1].label };
      assert(references[3].definition == null && references[4].label == "x *y*") { references[4].label };
      assert(references[5].asWritten == "[^m]" && references[5].definition?.label == "m") { "in the unused one" };
      let html = doc.toHtml();
      let expected = joined([
        "<p>Hi", fnRef("n", 1, 1), " and", fnRef("n", 1, 2), ", !", fnRef("n", 1, 3),
        " [^none] [^x *y*].</p>\n<blockquote>\n<pre><code>More.\n</code></pre>\n</blockquote>\n",
        "<section class=\"footnotes\" data-footnotes>\n<ol>\n<li id=\"fn-n\">\n<p>A <em>note</em>. ",
        fnBack("n", 1, 1), fnBack("n", 1, 2), fnBack("n", 1, 3), "</p>\n</li>\n",
        "<li id=\"fn-m\">\n<pre><code>code\n</code></pre>\n", fnBack("m", 2, 1), "\n</li>\n",
        "</ol>\n</section>\n",
      ]);
      assert(html == expected) { html };
    }

In a table cell, where `\|` is `|`; in an image's description, where a
reference adds nothing but one without a definition is its text; and
in a list, where a definition that's only `[^a]:` ends with a blank
line, making the list loose. The first definition with a label wins,
and a reference followed by `[]` stays one, but one followed by a
destination is a link.

    test("GFM footnotes: in cells, images, and lists") {
      let table = MarkdownParser.gfm.parse("| a | b |\n| - | - |\n| [^p\\|q] | [^z] |\n\n[^p|q]: Pipe.\n");
      let cell = table.footnoteReferences[0];
      assert(cell.label == "p|q" && cell.asWritten == "[^p\\|q]") { cell.label };
      let tableHtml = table.toHtml();
      let tableExpected = joined([
        "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>",
        fnRef("p%7Cq", 1, 1), "</td>\n<td>[^z]</td>\n</tr>\n</tbody>\n</table>\n",
        "<section class=\"footnotes\" data-footnotes>\n<ol>\n<li id=\"fn-p%7Cq\">\n<p>Pipe. ",
        fnBack("p%7Cq", 1, 1), "</p>\n</li>\n</ol>\n</section>\n",
      ]);
      assert(tableHtml == tableExpected) { tableHtml };
      let image = MarkdownParser.gfm.parse("![x [^a] y [^b]](/u)\n\n[^a]: q\n").toHtml();
      let imageExpected = joined([
        "<p><img src=\"/u\" alt=\"x  y [^b]\" /></p>\n<section class=\"footnotes\" data-footnotes>\n<ol>\n",
        "<li id=\"fn-a\">\n<p>q ", fnBack("a", 1, 1), "</p>\n</li>\n</ol>\n</section>\n",
      ]);
      assert(image == imageExpected) { image };
      let list = MarkdownParser.gfm.parse("- [^a]:\n- b\n\n[^a]: x\n    [^a]: y\n\n[^a] [^a][] [^a](/l)\n").toHtml();
      let listExpected = joined([
        "<ul>\n<li></li>\n<li>\n<p>b</p>\n</li>\n</ul>\n<p>", fnRef("a", 1, 1), " ", fnRef("a", 1, 2),
        "[] <a href=\"/l\">^a</a></p>\n<section class=\"footnotes\" data-footnotes>\n<ol>\n<li id=\"fn-a\">\n",
        fnBack("a", 1, 1), fnBack("a", 1, 2), "\n</li>\n</ol>\n</section>\n",
      ]);
      assert(list == listExpected) { list };
    }

Off, as in `parseMarkdown`, `[^a]: /u` is a link reference definition
and `![^a](/i)` an image, as CommonMark has them; in a GFM document
without footnotes, `![^` is no image, though. On, the definition is a
footnote's, and the `!` text.

    test("GFM footnotes: off unless asked for") {
      let text = "[^a]\n\n[^a]: /u\n![^a](/i)\n";
      let off = parseMarkdown(text).toHtml();
      assert(off == "<p><a href=\"/u\">^a</a></p>\n<p><img src=\"/i\" alt=\"^a\" /></p>\n") { off };
      let gfmOff = MarkdownParser.gfm.withFootnotes(false).parse(text).toHtml();
      assert(gfmOff == "<p><a href=\"/u\">^a</a></p>\n<p>!<a href=\"/i\">^a</a></p>\n") { gfmOff };
      let on = MarkdownParser.commonMark.withFootnotes(true).parse(text).toHtml();
      let expected = joined([
        "<p>", fnRef("a", 1, 1), "</p>\n<section class=\"footnotes\" data-footnotes>\n<ol>\n",
        "<li id=\"fn-a\">\n<p>/u\n!<a href=\"/i\">^a</a> ", fnBack("a", 1, 1), "</p>\n</li>\n</ol>\n</section>\n",
      ]);
      assert(on == expected) { on };
    }

Where kelpto-md differs from cmark-gfm, which there drops or garbles
text: a `^` escaped or written as a character reference, and brackets
across a line break, make no reference.

    test("GFM footnotes: an escaped ^ and a line break make no reference") {
      let html = MarkdownParser.gfm.parse("[\\^a] [&#94;a] [^a\nb]\n\n[^a]: x\n").toHtml();
      assert(html == "<p>[^a] [^a] [^a\nb]</p>\n") { html };
    }

Edits: a heading's new text is escaped, so it holds no reference, and
labels change alone, references to an old one no longer resolving. An
edited document renders as its text parses.

    test("GFM footnotes: edits") {
      let doc = MarkdownParser.gfm.parse("# Notes[^n]\n\nText[^n].\n\n[^n]: A note.\n");
      let heading = doc.headings[0].withText("New [^n]");
      assert(heading.asWritten == "# New \\[^n\\]\n\nText[^n].\n\n[^n]: A note.\n") { heading.asWritten };
      assert(heading.footnoteReferences.length == 1) { "the heading has none" };
      let renamed = doc.footnoteDefinitions[0].withLabel("note") orelse panic();
      assert(renamed.asWritten == "# Notes[^n]\n\nText[^n].\n\n[^note]: A note.\n") { renamed.asWritten };
      assert(renamed.footnoteReferences[0].definition == null) { "no longer resolves" };
      let renamedHtml = renamed.toHtml();
      assert(renamedHtml == "<h1>Notes[^n]</h1>\n<p>Text[^n].</p>\n") { renamedHtml };
      let pointed = doc.footnoteReferences[1].withLabel("Other") orelse panic();
      assert(pointed.asWritten == "# Notes[^n]\n\nText[^Other].\n\n[^n]: A note.\n") { pointed.asWritten };
      let edits = [heading, renamed, pointed];
      for (var i = 0; i < edits.length; i += 1) {
        let again = MarkdownParser.gfm.parse(edits[i].asWritten).toHtml();
        assert(edits[i].toHtml() == again) { again };
      }
      let bad = do { doc.footnoteDefinitions[0].withLabel("a b"); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "a label can't hold a space" };
      let empty = do { doc.footnoteReferences[0].withLabel(""); "accepted" } orelse "bubbled";
      assert(empty == "bubbled") { "nor be empty" };
      let cell = MarkdownParser.gfm.parse("| a |\n| - |\n| [^p\\|q] |\n").footnoteReferences[0];
      let cellEdit = cell.withLabel("r") orelse panic();
      assert(cellEdit.asWritten == "| a |\n| - |\n| [^r] |\n") { cellEdit.asWritten };
    }
