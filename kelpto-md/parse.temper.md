# Parsing

Parses Markdown into a green tree that keeps every code point, so
`asWritten` gives the input back exactly, for any input. Text the
parser doesn't understand stays as text.

    let {
      GreenElement, GreenNode, GreenNodeBuilder, GreenToken, Kind, SourceText, redRoot,
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

Parses `text` as Markdown, with raw HTML handled by `rawHtmlHandler`.
Never fails: any text is some document.

    export let parseMarkdown(
      text: String, rawHtmlHandler: RawHtmlHandler = opaqueRawHtml,
    ): MarkdownDocument {
      new MarkdownDocument(redRoot(parseMarkdownGreen(text, rawHtmlHandler)))
    }

The green tree alone, for tools working below the typed views.

    export let parseMarkdownGreen(
      text: String, rawHtmlHandler: RawHtmlHandler = opaqueRawHtml,
    ): GreenNode {
      let source = new SourceText(text);
      let blocks = new BlockParser(source);
      blocks.parse();
      let labels = definitionLabels(source, blocks.lines);
      new TreeWriter(source, blocks.lines, rawHtmlHandler, labels).writeDocument(blocks.document)
    }

The labels of the document's link reference definitions, normalized,
so the inline parser knows which `[text]` are links.

    let definitionLabels(source: SourceText, lines: List<LineData>): Mapped<String, Boolean> {
      let labels = new MapBuilder<String, Boolean>();
      for (var n = 0; n < lines.length; n += 1) {
        let leaf = lines[n].leaf;
        if (leaf != null) {
          if (leaf.blockType == typeDefinition && leaf.firstLine == n) {
            let text = paragraphContent(source, lines, n, leaf.lastLine + 1).text;
            let scan = scanDefinition(text, 0);
            if (scan != null) {
              labels[normalizeLabel(text.slice(1, scan.labelEnd - 1))] = true;
            }
          }
        }
      }
      labels
    }

The inline content node for `text` alone, one line, used by edits that
swap a heading's inlines, so an edited tree matches what parsing its
text gives.

    let inlineContentGreen(text: String): GreenNode {
      let source = new SourceText(text);
      let line = new LineData(0, source.length, source.length);
      new TreeWriter(source, [line], opaqueRawHtml, new Map<String, Boolean>([])).inlinesOnly()
    }

## Writing the tree

The second pass: the lines, with what the first gave for each, become
the green tree. Blocks open where their first token is and close after
their last line; each leaf writes all of its lines, including the
prefix tokens on lines after its first.

    class TreeWriter {
      private source: SourceText;
      private lines: List<LineData>;
      private handler: RawHtmlHandler;
      private labels: Mapped<String, Boolean>;
      private builder: GreenNodeBuilder = new GreenNodeBuilder();
      private open: ListBuilder<BlockData> = new ListBuilder<BlockData>();
      private var inText: Boolean = false;

      public constructor(
        source: SourceText, lines: List<LineData>, handler: RawHtmlHandler,
        labels: Mapped<String, Boolean>,
      ) {
        this.source = source;
        this.lines = lines;
        this.handler = handler;
        this.labels = labels;
      }

      public writeDocument(document: BlockData): GreenNode {
        builder.startNode(documentKind);
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

      public inlinesOnly(): GreenNode {
        let content = rangeContent(source, 0, 0, source.length);
        parseInlines(content, 0, source.length);
        builder.finish()
      }

Opens `block`'s node, and its parents', unless open already.

      private ensureOpen(block: BlockData): Void {
        for (var i = open.length - 1; i >= 0; i -= 1) {
          if (open[i].id == block.id) { return; }
        }
        ensureOpen(block.parent as BlockData orelse panic());
        builder.startNode(kindOfBlock(block));
        open.add(block);
      }

      private sourceToken(kind: Kind, start: Int, end: Int): Void {
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

      private emit(content: Content, kind: Kind, start: Int, end: Int): Void {
        var at = start;
        while (at < end) {
          let i = content.lineOf(at);
          let lineStart = content.starts[i];
          let lineEnd = lineStart + content.lengths[i];
          if (at < lineEnd) {
            let stop = minInt(end, lineEnd);
            let base = content.sourceStarts[i] - lineStart;
            sourceToken(kind, base + at, base + stop);
            at = stop;
          } else {
            let n = content.firstLine + i;
            lineEnding(lines[n]);
            prefixOf(n + 1);
            let next = lines[n + 1];
            sourceToken(whitespaceKind, next.leafStart, content.sourceStarts[i + 1]);
            at += 1;
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
          let start = skipBlanks(source, line.leafStart, line.contentEnd);
          let end = trimBlanksBack(source, start, line.contentEnd);
          sourceToken(indentKind, line.leafStart, start);
          sourceToken(setextMarkerKind, start, end);
          sourceToken(whitespaceKind, end, line.contentEnd);
          lineEnding(line);
        } else if (type == typeAtxHeading) {
          writeAtxHeading(lines[leaf.firstLine], leaf.firstLine);
        } else if (type == typeThematicBreak) {
          let line = lines[leaf.firstLine];
          let start = skipBlanks(source, line.leafStart, line.contentEnd);
          let end = trimBlanksBack(source, start, line.contentEnd);
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
        let text = content.text;
        let contentEnd = trimBlanksBack(text, 0, text.length);
        parseInlines(content, 0, contentEnd);
        emit(content, whitespaceKind, contentEnd, text.length);
        lineEnding(lines[end - 1]);
      }

An ATX heading: indentation, one to six `#`, then the content, an
optional closing sequence of `#`, and whitespace between.

      private writeAtxHeading(line: LineData, n: Int): Void {
        let end = line.contentEnd;
        let indentEnd = skipBlanks(source, line.leafStart, end);
        let markerEnd = atxHeadingStart(source, indentEnd, end);
        let contentStart = skipBlanks(source, markerEnd, end);
        let trailStart = trimBlanksBack(source, contentStart, end);
        var hashStart = trailStart;
        while (hashStart > contentStart && source.codeAt(hashStart - 1) == char'#') {
          hashStart -= 1;
        }
        var closeStart = trailStart;
        if (
          hashStart < trailStart &&
          (hashStart == contentStart || isSpaceOrTab(source.codeAt(hashStart - 1)))
        ) {
          closeStart = hashStart;
        }
        let contentEnd = trimBlanksBack(source, contentStart, closeStart);
        sourceToken(indentKind, line.leafStart, indentEnd);
        sourceToken(atxMarkerKind, indentEnd, markerEnd);
        sourceToken(whitespaceKind, markerEnd, contentStart);
        let content = rangeContent(source, n, contentStart, contentEnd);
        parseInlines(content, 0, contentEnd - contentStart);
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
        let fenceStart = skipBlanks(source, line.leafStart, end);
        let fenceEnd = openingFenceEnd(source, fenceStart, end);
        let infoStart = skipBlanks(source, fenceEnd, end);
        let infoEnd = trimBlanksBack(source, infoStart, end);
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
            let closeStart = skipBlanks(source, row.leafStart, row.contentEnd);
            var closeEnd = closeStart;
            while (closeEnd < row.contentEnd && source.codeAt(closeEnd) == leaf.fenceChar) {
              closeEnd += 1;
            }
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
          sourceToken(tabRemainderKind(line.tabRemainder), start, start + 1);
          start += 1;
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
            sourceToken(tabRemainderKind(line.tabRemainder), start, start + 1);
            start += 1;
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

A link reference definition: `[label]: destination "title"`, across
lines or not.

      private writeDefinition(leaf: BlockData): Void {
        let content = paragraphContent(source, lines, leaf.firstLine, leaf.lastLine + 1);
        let text = content.text;
        sourceToken(whitespaceKind, lines[leaf.firstLine].leafStart, content.sourceStarts[0]);
        let scan = scanDefinition(text, 0);
        if (scan == null) {

Not expected, since the first pass found it, but kept as text if so.

          emit(content, plainKind, 0, text.length);
        } else {
          builder.startNode(linkLabelKind);
          emit(content, labelTextKind, 0, scan.labelEnd);
          builder.finishNode();
          emit(content, colonKind, scan.labelEnd, scan.labelEnd + 1);
          emit(content, whitespaceKind, scan.labelEnd + 1, scan.destinationStart);
          emit(content, linkDestinationKind, scan.destinationStart, scan.destinationEnd);
          if (scan.titleStart >= 0) {
            emit(content, whitespaceKind, scan.destinationEnd, scan.titleStart);
            builder.startNode(linkTitleKind);
            emit(content, titleTextKind, scan.titleStart, scan.titleEnd);
            builder.finishNode();
            emit(content, whitespaceKind, scan.titleEnd, text.length);
          } else {
            emit(content, whitespaceKind, scan.destinationEnd, text.length);
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

      private parseInlines(content: Content, start: Int, end: Int): Void {
        let parser = new InlineParser(content.text, start, end, labels);
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
          if (start < 0) {
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
          } else {
            closeText();
            emit(content, kind, start, end);
          }
          item = parser.nexts[item];
        }
      }

Raw HTML goes to the handler if it's one piece in the source, and
stays opaque text between line breaks' prefixes if not.

      private rawHtml(content: Content, start: Int, end: Int): Void {
        builder.startNode(rawHtmlKind);
        let first = content.lineOf(start);
        let last = content.lineOf(end - 1);
        var whole = true;
        for (var i = first; i < last; i += 1) {
          let next = lines[content.firstLine + i + 1];
          if (!next.prefix.isEmpty || content.sourceStarts[i + 1] != next.start) { whole = false; }
        }
        if (whole) {
          rawHtmlChildren(source.slice(content.sourceAt(start), content.sourceAt(end - 1) + 1));
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
      blankLineKind
    }

## Scanning helpers

Each takes positions in code points, and gives a position, or -1 for
no match.

    let isSpaceOrTab(c: Int): Boolean { c == char' ' || c == char'\t' }

    let isAsciiPunctuation(c: Int): Boolean {
      (c >= 0x21 && c <= 0x2F) || (c >= 0x3A && c <= 0x40) ||
        (c >= 0x5B && c <= 0x60) || (c >= 0x7B && c <= 0x7E)
    }

Where the line from `from` ends, before its line ending.

    let lineContentEnd(source: SourceText, from: Int): Int {
      var i = from;
      while (i < source.length) {
        let c = source.codeAt(i);
        if (c == char'\n' || c == char'\r') { break; }
        i += 1;
      }
      i
    }

After the line ending at `at`: `\n`, `\r\n`, or `\r`.

    let lineBreakEnd(source: SourceText, at: Int): Int {
      let c = source.codeAt(at);
      if (c == char'\r' && source.codeAt(at + 1) == char'\n') {
        at + 2
      } else if (c == char'\r' || c == char'\n') {
        at + 1
      } else {
        at
      }
    }

Past spaces and tabs.

    let skipBlanks(source: SourceText, from: Int, end: Int): Int {
      var i = from;
      while (i < end && isSpaceOrTab(source.codeAt(i))) {
        i += 1;
      }
      i
    }

Back over spaces and tabs before `end`, but not before `start`.

    let trimBlanksBack(source: SourceText, start: Int, end: Int): Int {
      var i = end;
      while (i > start && isSpaceOrTab(source.codeAt(i - 1))) {
        i -= 1;
      }
      i
    }

Where a run of exactly `count` backticks starts, from `from`, or -1.

    let closingBackticks(source: SourceText, from: Int, end: Int, count: Int): Int {
      var i = from;
      while (i < end) {
        if (source.codeAt(i) == char'`') {
          var j = i;
          while (j < end && source.codeAt(j) == char'`') {
            j += 1;
          }
          if (j - i == count) { return i; }
          i = j;
        } else {
          i += 1;
        }
      }
      -1
    }

### Raw HTML, by CommonMark's rules

Scanners for tags, used by HTML blocks and by `InlineParser`'s
`rawHtmlEnd`, which also finds comments, processing instructions,
declarations, and CDATA sections. Each gives the end of what starts
with the `<` at `at`, or `at` if none starts there. A paragraph has no
blank lines, so a tag's whitespace holds at most one line ending, as
CommonMark allows, without checking.

A closing tag: `</`, a name, optional whitespace, and `>`.

    let closingTagEnd(source: SourceText, at: Int, end: Int): Int {
      if (codeIn(source, at + 1, end) != char'/') { return at; }
      let nameEnd = tagNameEnd(source, at + 2, end);
      if (nameEnd < 0) { return at; }
      let close = skipWhitespace(source, nameEnd, end);
      if (codeIn(source, close, end) == char'>') { close + 1 } else { at }
    }

A code point before `end`, or -1.

    let codeIn(source: SourceText, at: Int, end: Int): Int {
      if (at < end) { source.codeAt(at) } else { -1 }
    }

    let skipWhitespace(source: SourceText, from: Int, end: Int): Int {
      var i = from;
      while (i < end && isAsciiWhitespace(source.codeAt(i))) {
        i += 1;
      }
      i
    }

A tag name: an ASCII letter, then letters, digits, and `-`.

    let tagNameEnd(source: SourceText, from: Int, end: Int): Int {
      if (!isAsciiAlpha(codeIn(source, from, end))) { return -1; }
      var i = from + 1;
      while (i < end && (isAsciiAlphanumeric(source.codeAt(i)) || source.codeAt(i) == char'-')) {
        i += 1;
      }
      i
    }

    let minInt(a: Int, b: Int): Int { if (a < b) { a } else { b } }

An open tag: `<`, a name, attributes, optional whitespace, an optional
`/`, and `>`.

    let openTagEnd(source: SourceText, at: Int, end: Int): Int {
      var i = tagNameEnd(source, at + 1, end);
      if (i < 0) { return at; }
      while (true) {
        let attributeStart = skipWhitespace(source, i, end);
        if (attributeStart == i) { break; }
        let attributeEnd = attributeEnd(source, attributeStart, end);
        if (attributeEnd < 0) { return at; }
        if (attributeEnd == attributeStart) { break; }
        i = attributeEnd;
      }
      i = skipWhitespace(source, i, end);
      if (codeIn(source, i, end) == char'/') { i += 1; }
      if (codeIn(source, i, end) == char'>') { i + 1 } else { at }
    }

An attribute: a name, then optionally `=` and a value, unquoted,
single-quoted, or double-quoted. Gives `from` if no name starts there,
or -1 if a value is missing.

    let attributeEnd(source: SourceText, from: Int, end: Int): Int {
      let first = codeIn(source, from, end);
      if (!(isAsciiAlpha(first) || first == char'_' || first == char':')) { return from; }
      var i = from + 1;
      while (i < end) {
        let c = source.codeAt(i);
        if (!(isAsciiAlphanumeric(c) || c == char'_' || c == char'.' || c == char':' || c == char'-')) {
          break;
        }
        i += 1;
      }
      let equals = skipWhitespace(source, i, end);
      if (codeIn(source, equals, end) != char'=') { return i; }
      let valueStart = skipWhitespace(source, equals + 1, end);
      let quote = codeIn(source, valueStart, end);
      if (quote == char'"' || quote == char'\'') {
        for (var j = valueStart + 1; j < end; j += 1) {
          if (source.codeAt(j) == quote) { return j + 1; }
        }
        return -1;
      }
      var j = valueStart;
      while (j < end) {
        let c = source.codeAt(j);
        if (
          isAsciiWhitespace(c) || c == char'"' || c == char'\'' || c == char'=' ||
          c == char'<' || c == char'>' || c == char'`'
        ) {
          break;
        }
        j += 1;
      }
      if (j == valueStart) { -1 } else { j }
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
