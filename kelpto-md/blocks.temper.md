# Block structure

CommonMark parses in two phases: first the block structure, line by
line, then the inlines of each paragraph and heading. This is the
first phase, following the spec's algorithm as the reference
implementation, cmark, does it, with the same names where they help.

What it gives isn't the tree yet, but what the tree needs: for each
line, which container prefixes it has (each `>`, list marker, and
indentation, with the block it belongs to), and which leaf block takes
the rest. The tree comes from that in one pass (see `parse.temper.md`),
so every code point lands in exactly one token.

    let {
      Kind, SourceText, asciiLowercase, sourceLines, isAsciiAlpha, isAsciiAlphanumeric, isAsciiDigit,
      isAsciiWhitespace,
    } = import("../kelpto-core");

## Tabs

Tabs stay in the text as written, but count as spaces to the next
multiple of 4 columns, as the spec says. A tab can be partly used by a
prefix, such as the space after `>`; then the block after it gets the
tab with what's left of its columns, in a `TabRemainder` token whose
kind says how many (1 to 3). A code block shows those as spaces, as
cmark does.

    let tabStop = 4;

## What the first phase gives

Block types, as plain numbers, since they're internal.

    let typeDocument = 0;
    let typeBlockQuote = 1;
    let typeList = 2;
    let typeListItem = 3;
    let typeParagraph = 4;
    let typeAtxHeading = 5;
    let typeSetextHeading = 6;
    let typeThematicBreak = 7;
    let typeFencedCode = 8;
    let typeIndentedCode = 9;
    let typeHtmlBlock = 10;
    let typeDefinition = 11;
    let typeBlankLine = 12;
    let typeTable = 13;
    let typeFootnoteDefinition = 14;

A block while parsing: mutable, with what the algorithm needs. Blank
lines and link reference definitions are kept as blocks too, so they
get nodes, but the algorithm doesn't count them as children (cmark
doesn't make them).

    class BlockData {
      public id: Int;
      public var blockType: Int;
      public parent: BlockData?;

How many blocks it's inside: 0 for the document.

      public depth: Int;
      public children: ListBuilder<BlockData> = new ListBuilder<BlockData>();
      public var open: Boolean = true;
      public var firstLine: Int;

For leaves while parsing: one past their last line so far.

      public var endLine: Int;

Set at the end: the last line with any of this block's text, its
descendants' included.

      public var lastLine: Int = -1;
      public var lastLineBlank: Boolean = false;

Lists and list items:

      public var ordered: Boolean = false;
      public var bulletChar: Int = 0;
      public var delimiter: Int = 0;
      public var markerOffset: Int = 0;
      public var padding: Int = 0;

Code blocks, HTML blocks, and headings:

      public var fenceChar: Int = 0;
      public var fenceLength: Int = 0;
      public var fenceOffset: Int = 0;
      public var closedByFence: Boolean = false;
      public var htmlType: Int = 0;

Tables, and the paragraphs that might become them. A paragraph whose
last line didn't match a delimiter row's columns never becomes a
table, as in cmark-gfm. A table counts its columns, rows, and the cells
written in them (up to its columns), to stop adding rows once too many
cells would be filled in empty (see `maxFilledCells`).

      public var tableVisited: Boolean = false;
      public var tableColumns: Int = 0;
      public var tableRows: Int = 0;
      public var tableCells: Int = 0;

      public constructor(id: Int, type: Int, parent: BlockData?, firstLine: Int) {
        this.id = id;
        this.blockType = type;
        this.parent = parent;
        this.depth = if (parent == null) { 0 } else { parent.depth + 1 };
        this.firstLine = firstLine;
        this.endLine = firstLine;
      }

Whether the algorithm counts this as a child.

      public get isReal(): Boolean { blockType != typeBlankLine && blockType != typeDefinition }

      public get lastChild(): BlockData? {
        if (children.isEmpty) { null } else { children[children.length - 1] }
      }

      public get lastRealChild(): BlockData? {
        for (var i = children.length - 1; i >= 0; i -= 1) {
          let child = children[i];
          if (child.isReal) { return child; }
        }
        null
      }

      public get hasRealChild(): Boolean { lastRealChild != null }
    }

A token of a container's prefix on a line: indentation, a `>`, a list
marker, or the whitespace after one.

    class PrefixToken(
      public owner: BlockData,
      public kind: Kind,
      public start: StringIndex,
      public end: StringIndex,
    ) {}

A line, by where its parts are in the source string.

    class LineData {
      public start: StringIndex;

Where the line's content ends, before its line ending, and where its
line ending ends.

      public contentEnd: StringIndex;
      public breakEnd: StringIndex;
      public prefix: ListBuilder<PrefixToken> = new ListBuilder<PrefixToken>();

The leaf block taking the rest of the line, or null if the line only
opens containers.

      public var leaf: BlockData? = null;

Where the leaf's part of the line starts, after the container
prefixes.

      public var leafStart: StringIndex;

For code and HTML blocks: where the text starts after the block's own
indentation, and how many columns are left of a partly used tab
there, or 0.

      public var codeStart: StringIndex;
      public var tabRemainder: Int = 0;

      public constructor(start: StringIndex, contentEnd: StringIndex, breakEnd: StringIndex) {
        this.start = start;
        this.contentEnd = contentEnd;
        this.breakEnd = breakEnd;
        this.leafStart = start;
        this.codeStart = start;
      }
    }

Splits `text` into lines. A line ending (`\n`, `\r\n`, or `\r`) ends a
line; text after the last one is a last line without one. It finds
them with `indexOf`, which is native in every language, rather than
reading code point by code point: each is searched for again only
once passed, so text without `\r` is searched for it once.

    let splitLines(text: String): List<LineData> {
      let lines = new ListBuilder<LineData>();
      let end = text.end;
      var start = String.begin;
      var newline = indexOrEnd(text, "\n", start);
      var carriageReturn = indexOrEnd(text, "\r", start);
      while (start < end) {
        if (newline < start) { newline = indexOrEnd(text, "\n", start); }
        if (carriageReturn < start) { carriageReturn = indexOrEnd(text, "\r", start); }
        let at = if (carriageReturn < newline) { carriageReturn } else { newline };
        let next = if (at < end) { lineBreakEnd(text, at) } else { end };
        lines.add(new LineData(start, at, next));
        start = next;
      }
      lines.toList()
    }

Where `target` is in `text` from `start`, or the end.

    let indexOrEnd(text: String, target: String, start: StringIndex): StringIndex {
      let found = text.indexOf(target, start);
      when (found) {
        is StringIndex -> found;
        else -> text.end;
      }
    }

## The block parser

    class BlockParser {
      public text: String;
      public lines: List<LineData>;
      public document: BlockData;
      private extensions: Extensions;
      private var nextId: Int = 1;
      private var current: BlockData;

The state for the line being parsed, as cmark keeps it: `offset` is a
position in the source string and `column` counts tabs to tab stops; a
partly consumed tab leaves `offset` on the tab.

      private var lineNumber: Int = 0;
      private var lineEnd: StringIndex = String.begin;
      private var offset: StringIndex = String.begin;
      private var column: Int = 0;
      private var firstNonspace: StringIndex = String.begin;
      private var firstNonspaceColumn: Int = 0;
      private var indent: Int = 0;
      private var blank: Boolean = false;
      private var partiallyConsumedTab: Boolean = false;

Where the leaf's part of the line starts: after the last container
prefix matched or opened.

      private var containerOffset: StringIndex = String.begin;

      public constructor(text: String, extensions: Extensions) {
        this.text = text;
        this.extensions = extensions;
        this.lines = splitLines(text);
        let document = new BlockData(0, typeDocument, null, 0);
        this.document = document;
        this.current = document;
      }

      public parse(): Void {
        for (var n = 0; n < lines.length; n += 1) {
          processLine(n);
        }
        while (current.id != document.id) {
          current = finalize(current);
        }
        finalize(document);
        setLastLines();
      }

The code point at `at`, as if each line ended in `\n`.

      private peek(at: StringIndex): Int {
        if (at < lineEnd) { text[at] } else { char'\n' }
      }

The loops below work on locals and set the fields once: in Rust, each
read or write of a field of a class with `var` fields takes a lock.

      private findFirstNonspace(): Void {
        var charsToTab = tabStop - column % tabStop;
        if (firstNonspace <= offset) {
          let text = this.text;
          let lineEnd = this.lineEnd;
          var at = offset;
          var atColumn = column;
          while (at < lineEnd) {
            let c = text[at];
            if (c == char' ') {
              at = text.next(at);
              atColumn += 1;
              charsToTab -= 1;
              if (charsToTab == 0) { charsToTab = tabStop; }
            } else if (c == char'\t') {
              at = text.next(at);
              atColumn += charsToTab;
              charsToTab = tabStop;
            } else {
              break;
            }
          }
          firstNonspace = at;
          firstNonspaceColumn = atColumn;
        }
        indent = firstNonspaceColumn - column;
        blank = firstNonspace >= lineEnd;
      }

Moves past `count` columns, where a tab can be partly consumed.

      private advanceColumns(count: Int): Void {
        let text = this.text;
        let lineEnd = this.lineEnd;
        var at = offset;
        var atColumn = column;
        var partial = partiallyConsumedTab;
        var left = count;
        while (left > 0 && at < lineEnd) {
          if (text[at] == char'\t') {
            let charsToTab = tabStop - atColumn % tabStop;
            partial = charsToTab > left;
            let advance = if (left < charsToTab) { left } else { charsToTab };
            atColumn += advance;
            if (!partial) { at = text.next(at); }
            left -= advance;
          } else {
            partial = false;
            at = text.next(at);
            atColumn += 1;
            left -= 1;
          }
        }
        offset = at;
        column = atColumn;
        partiallyConsumedTab = partial;
      }

Moves to `target`, on this line, a whole code point at a time.

      private advanceTo(target: StringIndex): Void {
        let text = this.text;
        var at = offset;
        var atColumn = column;
        var partial = partiallyConsumedTab;
        while (at < target) {
          if (text[at] == char'\t') {
            atColumn += tabStop - atColumn % tabStop;
          } else {
            atColumn += 1;
          }
          partial = false;
          at = text.next(at);
        }
        offset = at;
        column = atColumn;
        partiallyConsumedTab = partial;
      }

      private prefixToken(owner: BlockData, kind: Kind, start: StringIndex, end: StringIndex): Void {
        if (start < end) {
          lines[lineNumber].prefix.add(new PrefixToken(owner, kind, start, end));
        }
      }

      private processLine(n: Int): Void {
        let line = lines[n];
        lineNumber = n;
        lineEnd = line.contentEnd;
        offset = line.start;
        column = 0;
        firstNonspace = line.start;
        firstNonspaceColumn = 0;
        indent = 0;
        blank = false;
        partiallyConsumedTab = false;
        containerOffset = line.start;

Which open blocks the line continues.

        var container = document;
        var allMatched = true;
        while (true) {
          let maybeLast = openLastChild(container);
          if (maybeLast == null) { break; }
          let last = maybeLast as BlockData orelse panic();
          findFirstNonspace();
          let matched = continues(last);
          if (matched == 0) {
            allMatched = false;
            break;
          }
          container = last;
          if (matched == 2) {

A closing fence: nothing more on this line.

            return;
          }
        }
        let lastMatched = container;
        container = openNewBlocks(container, allMatched);
        addTextToContainer(container, lastMatched);
      }

Whether `block` continues on this line, consuming its prefix: 0 if
not, 1 if so, and 2 for a closing code fence, which ends the line.

      private continues(block: BlockData): Int {
        let type = block.blockType;
        if (type == typeBlockQuote) {
          if (indent <= 3 && peek(firstNonspace) == char'>') {
            let start = offset;
            advanceColumns(indent + 1);
            prefixToken(block, indentKind, start, firstNonspace);
            prefixToken(block, blockQuoteMarkerKind, firstNonspace, offset);
            optionalSpace(block);
            containerOffset = offset;
            return 1;
          }
          return 0;
        }
        if (type == typeListItem) {
          if (indent >= block.markerOffset + block.padding) {
            let start = offset;
            advanceColumns(block.markerOffset + block.padding);
            prefixToken(block, indentKind, start, offset);
            containerOffset = offset;
            return 1;
          }
          if (blank && block.hasRealChild) {
            let start = offset;
            advanceTo(firstNonspace);
            prefixToken(block, indentKind, start, offset);
            containerOffset = offset;
            return 1;
          }
          return 0;
        }
        if (type == typeIndentedCode) {
          if (indent >= 4) {
            advanceColumns(4);
            return 1;
          }
          if (blank) {
            advanceTo(firstNonspace);
            return 1;
          }
          return 0;
        }
        if (type == typeFencedCode) {
          var matched = 0;
          if (indent <= 3 && peek(firstNonspace) == block.fenceChar) {
            matched = closingFenceLength(text, firstNonspace, lineEnd);
          }
          if (matched >= block.fenceLength) {
            let line = lines[lineNumber];
            line.leaf = block;
            line.leafStart = containerOffset;
            block.endLine = lineNumber + 1;
            block.closedByFence = true;
            current = finalize(block);
            return 2;
          }
          var i = block.fenceOffset;
          while (i > 0 && isSpaceOrTab(peek(offset))) {
            advanceColumns(1);
            i -= 1;
          }
          return 1;
        }
        if (type == typeHtmlBlock) {
          if (block.htmlType <= 5) { return 1; }
          return if (blank) { 0 } else { 1 };
        }
        if (type == typeParagraph) {
          return if (blank) { 0 } else { 1 };
        }
        if (type == typeTable) {
          return if (!blank && continuesTable(block)) { 1 } else { 0 };
        }
        if (type == typeFootnoteDefinition) {

GFM's footnote definitions go on with four columns of indentation, or
on an empty line, as cmark-gfm checks it: nothing at all before the
line ending, so not spaces, nor a container's prefix.

          if (indent >= 4) {
            let start = offset;
            advanceColumns(4);
            prefixToken(block, indentKind, start, offset);
            containerOffset = offset;
            return 1;
          }
          let line = lines[lineNumber];
          return if (line.start == line.contentEnd) { 1 } else { 0 };
        }
        if (
          type == typeAtxHeading || type == typeSetextHeading || type == typeThematicBreak ||
          type == typeBlankLine || type == typeDefinition
        ) {
          return 0;
        }
        1
      }

The optional space or tab after a `>`. A tab is consumed only by one
column, so it stays for what comes next.

      private optionalSpace(owner: BlockData): Void {
        if (isSpaceOrTab(peek(offset))) {
          let start = offset;
          advanceColumns(1);
          prefixToken(owner, whitespaceKind, start, offset);
        }
      }

      private addChild(parent: BlockData, type: Int): BlockData {
        var into = parent;
        while (!canContain(into.blockType, type)) {
          into = finalize(into);
        }
        let child = new BlockData(nextId, type, into, lineNumber);
        nextId += 1;
        into.children.add(child);
        child
      }

Opens the blocks that start on this line, giving the innermost.

      private openNewBlocks(start: BlockData, allMatched: Boolean): BlockData {
        var container = start;
        var maybeLazy = current.blockType == typeParagraph;
        var containerType = container.blockType;
        var depth = 0;
        while (
          containerType != typeFencedCode && containerType != typeIndentedCode &&
          containerType != typeHtmlBlock
        ) {
          depth += 1;
          findFirstNonspace();
          let indented = indent >= 4;
          let c = peek(firstNonspace);
          // Each found once: `c` rules out the branches before them.
          let atxEnd = if (!indented && c == char'#') {
            atxHeadingStart(text, firstNonspace, lineEnd)
          } else {
            firstNonspace
          };
          let fenceEnd = if (!indented && (c == char'`' || c == char'~')) {
            openingFenceEnd(text, firstNonspace, lineEnd)
          } else {
            firstNonspace
          };
          if (!indented && c == char'>') {
            let quote = addChild(container, typeBlockQuote);
            prefixToken(quote, indentKind, offset, firstNonspace);
            advanceTo(text.next(firstNonspace));
            prefixToken(quote, blockQuoteMarkerKind, firstNonspace, offset);
            optionalSpace(quote);
            containerOffset = offset;
            container = quote;
          } else if (atxEnd > firstNonspace) {
            container = addChild(container, typeAtxHeading);
            advanceTo(atxEnd);
          } else if (fenceEnd > firstNonspace) {
            let code = addChild(container, typeFencedCode);
            code.fenceChar = text[firstNonspace];
            code.fenceLength = text.countBetween(firstNonspace, fenceEnd);
            code.fenceOffset = text.countBetween(offset, firstNonspace);
            advanceTo(fenceEnd);
            container = code;
          } else if (
            !indented &&
            htmlBlockStart(text, firstNonspace, lineEnd, containerType != typeParagraph) > 0
          ) {
            let html = addChild(container, typeHtmlBlock);
            html.htmlType = htmlBlockStart(text, firstNonspace, lineEnd, containerType != typeParagraph);
            container = html;
          } else if (
            !indented && containerType == typeParagraph &&
            setextUnderline(text, firstNonspace, lineEnd) > 0
          ) {
            toSetextHeading(container);
          } else if (
            !indented && !(containerType == typeParagraph && !allMatched) &&
            isThematicBreak(text, firstNonspace, lineEnd)
          ) {
            container = addChild(container, typeThematicBreak);
            advanceTo(lineEnd);
          } else if (
            !indented && extensions.footnotes && depth < maxOpenDepth &&
            footnoteLabelEnd(text, firstNonspace, lineEnd) > firstNonspace
          ) {
            container = openFootnoteDefinition(container);
          } else if (
            (!indented || containerType == typeList) && indent < 4 &&
            listMarkerEnd(text, firstNonspace, lineEnd, containerType == typeParagraph) > firstNonspace
          ) {
            container = openListItem(container);
          } else if (indented && !maybeLazy && !blank) {
            advanceColumns(4);
            container = addChild(container, typeIndentedCode);
          } else if (
            !indented && containerType == typeParagraph && extensions.tables &&
            !container.tableVisited && toTable(container)
          ) {
            // The paragraph's last line is the header row; this line,
            // the delimiter row, joins it below.
          } else if (
            !indented && containerType == typeListItem && extensions.taskListItems &&
            container.firstLine == lineNumber && !container.hasRealChild &&
            taskMarkerEnd(text, firstNonspace, lineEnd) > firstNonspace
          ) {

A task list item's marker. The rest of the line is the item's
paragraph, whatever it holds, as in cmark-gfm.

            let markerEnd = taskMarkerEnd(text, firstNonspace, lineEnd);
            prefixToken(container, whitespaceKind, offset, firstNonspace);
            prefixToken(container, taskMarkerKind, firstNonspace, markerEnd);
            advanceTo(markerEnd);
            containerOffset = offset;
            break;
          } else {
            break;
          }
          if (acceptsLines(container.blockType)) { break; }
          containerType = container.blockType;
          maybeLazy = false;
        }
        container
      }

If this line is a delimiter row with as many columns as the cells of
the paragraph's last line, that line becomes a table's header row, and
the lines before it stay a paragraph. Gives whether it did.

      private toTable(paragraph: BlockData): Boolean {
        let columns = delimiterRowColumns(text, firstNonspace, lineEnd);
        if (columns == 0) { return false; }
        let headerLine = paragraph.endLine - 1;
        let header = lines[headerLine];
        let cells = tableRowCells(text, skipBlanksAt(text, header.leafStart, header.contentEnd), header.contentEnd);
        if (cells != columns) {
          paragraph.tableVisited = true;
          return false;
        }
        if (paragraph.firstLine < headerLine) {
          let parent = paragraph.parent as BlockData orelse panic();
          let before = new BlockData(nextId, typeParagraph, parent, paragraph.firstLine);
          nextId += 1;
          before.open = false;
          before.endLine = headerLine;
          for (var n = before.firstLine; n < headerLine; n += 1) {
            lines[n].leaf = before;
          }
          parent.children.add(before, indexOfChild(parent, paragraph));
          if (!splitDefinitions(before)) { removeChild(before); }
        }
        paragraph.blockType = typeTable;
        paragraph.firstLine = headerLine;
        paragraph.tableColumns = columns;
        paragraph.tableRows = 1;
        paragraph.tableCells = columns;
        true
      }

Whether this line is another row of `table`: a row with cells, unless
the table has filled in too many empty cells already.

      private continuesTable(table: BlockData): Boolean {
        let cells = tableRowCells(text, firstNonspace, lineEnd);
        cells > 0 && table.tableColumns * table.tableRows - table.tableCells <= maxFilledCells
      }

A paragraph becomes a setext heading, unless it was all link
reference definitions; then the underline is a paragraph's text.

      private toSetextHeading(paragraph: BlockData): Void {
        if (splitDefinitions(paragraph)) {
          paragraph.blockType = typeSetextHeading;
          advanceTo(lineEnd);
        }
      }

A GFM footnote definition, `[^label]:`, and the spaces and tabs after
it, as its prefix. Its blocks start after them, so its first line is
never indented code.

      private openFootnoteDefinition(container: BlockData): BlockData {
        let labelStart = text.next(text.next(firstNonspace));
        let labelEnd = footnoteLabelEnd(text, firstNonspace, lineEnd);
        let colon = text.next(labelEnd);
        let markerEnd = text.next(colon);
        let contentStart = skipBlanksAt(text, markerEnd, lineEnd);
        let definition = addChild(container, typeFootnoteDefinition);
        prefixToken(definition, indentKind, offset, firstNonspace);
        prefixToken(definition, footnoteOpenKind, firstNonspace, labelStart);
        prefixToken(definition, labelTextKind, labelStart, labelEnd);
        prefixToken(definition, linkCloseKind, labelEnd, colon);
        prefixToken(definition, colonKind, colon, markerEnd);
        prefixToken(definition, whitespaceKind, markerEnd, contentStart);
        advanceTo(contentStart);
        containerOffset = offset;
        definition
      }

A list item, and a list for it if `container` isn't a list it can
join. Its content starts after the marker and 1 to 4 columns of
spaces; with 5 or more, or none before the line's end, after one.

      private openListItem(container: BlockData): BlockData {
        let markerStart = firstNonspace;
        let markerEnd = listMarkerEnd(text, firstNonspace, lineEnd, container.blockType == typeParagraph);
        let indentStart = offset;
        let markerOffset = indent;
        let marker = text[text.prev(markerEnd)];
        let ordered = marker == char'.' || marker == char')';
        advanceTo(markerEnd);
        let savePartial = partiallyConsumedTab;
        let saveOffset = offset;
        let saveColumn = column;
        while (column - saveColumn <= 5 && isSpaceOrTab(peek(offset))) {
          advanceColumns(1);
        }
        let spaces = column - saveColumn;
        let width = text.countBetween(markerStart, markerEnd);
        var padding = width + spaces;
        if (spaces >= 5 || spaces < 1 || offset >= lineEnd) {
          padding = width + 1;
          offset = saveOffset;
          column = saveColumn;
          partiallyConsumedTab = savePartial;
          if (spaces > 0) { advanceColumns(1); }
        }
        var list = container;
        let sameList = container.blockType == typeList && container.ordered == ordered && (
          if (ordered) { container.delimiter == marker } else { container.bulletChar == marker }
        );
        if (!sameList) {
          list = addChild(container, typeList);
          list.ordered = ordered;
          if (ordered) { list.delimiter = marker; } else { list.bulletChar = marker; }
        }
        let item = addChild(list, typeListItem);
        item.ordered = ordered;
        item.markerOffset = markerOffset;
        item.padding = padding;
        prefixToken(item, indentKind, indentStart, markerStart);
        prefixToken(item, listMarkerKind, markerStart, markerEnd);
        prefixToken(item, whitespaceKind, markerEnd, offset);
        containerOffset = offset;
        item
      }

What's left of the line goes to a leaf, or makes a paragraph.

      private addTextToContainer(start: BlockData, lastMatched: BlockData): Void {
        var container = start;
        findFirstNonspace();
        if (blank) {
          let last = container.lastRealChild;
          if (last != null) { last.lastLineBlank = true; }
        }
        let type = container.blockType;
        container.lastLineBlank = blank && type != typeBlockQuote && type != typeAtxHeading &&
          type != typeSetextHeading && type != typeThematicBreak && type != typeFencedCode &&
          !(type == typeListItem && !container.hasRealChild && container.firstLine == lineNumber);
        clearLastLineBlank(container.parent);
        if (
          current.id != lastMatched.id && container.id == lastMatched.id && !blank &&
          current.blockType == typeParagraph
        ) {

A lazy continuation line.

          addLine(current);
          return;
        }
        while (current.id != lastMatched.id) {
          current = finalize(current);
        }
        if (type == typeFencedCode || type == typeIndentedCode) {
          addLine(container);
        } else if (type == typeHtmlBlock) {
          container = addHtmlLine(container);
        } else if (type == typeThematicBreak || type == typeAtxHeading) {
          addLine(container);
        } else if (blank) {
          if (
            (type == typeBlockQuote || type == typeListItem || type == typeFootnoteDefinition) &&
            container.firstLine == lineNumber &&
            !container.hasRealChild
          ) {

The rest of a line that opens a container, with nothing after it,
goes to the container itself.

            lines[lineNumber].leafStart = containerOffset;
          } else {
            let blankLine = new BlockData(nextId, typeBlankLine, container, lineNumber);
            nextId += 1;
            blankLine.open = false;
            container.children.add(blankLine);
            addLine(blankLine);
          }
        } else if (type == typeTable) {
          if (lineNumber > container.firstLine + 1) {
            let cells = tableRowCells(text, firstNonspace, lineEnd);
            container.tableRows += 1;
            container.tableCells += if (cells < container.tableColumns) { cells } else { container.tableColumns };
          }
          addLine(container);
        } else if (acceptsLines(type)) {
          addLine(container);
        } else {
          container = addChild(container, typeParagraph);
          addLine(container);
        }
        current = container;
      }

Adds the line to an HTML block, closing it if the line ends it.
Gives the block, or its parent if closed.

      private addHtmlLine(html: BlockData): BlockData {
        addLine(html);
        if (htmlBlockEnds(text, html.htmlType, firstNonspace, lineEnd)) {
          return finalize(html);
        }
        html
      }

      private addLine(leaf: BlockData): Void {
        let line = lines[lineNumber];
        line.leaf = leaf;
        line.leafStart = containerOffset;
        line.codeStart = offset;
        line.tabRemainder = if (partiallyConsumedTab) { tabStop - column % tabStop } else { 0 };
        leaf.endLine = lineNumber + 1;
      }

Closes `block`, giving its parent.

      private finalize(block: BlockData): BlockData {
        block.open = false;
        let parent = block.parent;
        // Not `if (…) { if (…) { … } } else if`: C# drops the braces
        // around the inner `if`, so the `else` goes with it (2026-10-30).
        if (block.blockType == typeParagraph && !splitDefinitions(block)) {
          removeChild(block);
        }
        if (block.blockType == typeIndentedCode) {
          trailingBlankLines(block);
        }
        parent ?? document
      }

Moves link reference definitions at the start of `paragraph` into
blocks of their own, before it. Gives whether any lines are left.

      private splitDefinitions(paragraph: BlockData): Boolean {
        // Each definition starts with `[`, so most paragraphs need no
        // decoding here.
        let firstText = lines[paragraph.firstLine];
        let textStart = skipBlanksAt(text, firstText.leafStart, firstText.contentEnd);
        if (codeInAt(text, textStart, firstText.contentEnd) != char'[') { return true; }
        let content = paragraphContent(text, lines, paragraph.firstLine, paragraph.endLine);
        let joined = content.text;
        let parent = paragraph.parent as BlockData orelse panic();
        var at = 0;
        var first = paragraph.firstLine;
        var insertAt = indexOfChild(parent, paragraph);
        while (at < joined.length && joined.codeAt(at) == char'[') {
          let end = definitionEnd(joined, at);
          if (end < 0) { break; }
          let lastLine = content.lineOf(end - 1);
          let definition = new BlockData(nextId, typeDefinition, parent, first);
          nextId += 1;
          definition.open = false;
          definition.endLine = paragraph.firstLine + lastLine + 1;
          for (var n = first; n < definition.endLine; n += 1) {
            lines[n].leaf = definition;
          }
          parent.children.add(definition, insertAt);
          insertAt += 1;
          first = definition.endLine;
          at = end;
        }
        paragraph.firstLine = first;
        first < paragraph.endLine
      }

      private removeChild(block: BlockData): Void {
        let parent = block.parent as BlockData orelse panic();
        parent.children.splice(indexOfChild(parent, block), 1);
      }

Trailing blank lines aren't part of an indented code block: they
become blank lines after it.

      private trailingBlankLines(code: BlockData): Void {
        let parent = code.parent as BlockData orelse panic();
        var insertAt = indexOfChild(parent, code) + 1;
        var end = code.endLine;
        while (end - 1 > code.firstLine && isBlankText(text, lines[end - 1].leafStart, lines[end - 1].contentEnd)) {
          end -= 1;
        }
        for (var n = end; n < code.endLine; n += 1) {
          let blankLine = new BlockData(nextId, typeBlankLine, parent, n);
          nextId += 1;
          blankLine.open = false;
          blankLine.endLine = n + 1;
          lines[n].leaf = blankLine;
          parent.children.add(blankLine, insertAt);
          insertAt += 1;
        }
        code.endLine = end;
      }

Sets each block's `lastLine` from the lines holding its text.

      private setLastLines(): Void {
        for (var n = 0; n < lines.length; n += 1) {
          let line = lines[n];
          let leaf = line.leaf;
          if (leaf != null) { reach(leaf, n); }
          let prefix = line.prefix;
          for (var i = 0; i < prefix.length; i += 1) {
            reach(prefix[i].owner, n);
          }
        }
      }
    }

Lines come in order, so once a block has reached line `n`, so have its
parents: stopping there keeps deep nesting linear.

    let reach(block: BlockData?, n: Int): Void {
      var at = block;
      while (at != null) {
        let b = at as BlockData orelse panic();
        if (b.lastLine >= n) { break; }
        b.lastLine = n;
        at = b.parent;
      }
    }

    let clearLastLineBlank(block: BlockData?): Void {
      var at = block;
      while (at != null) {
        let b = at as BlockData orelse panic();
        b.lastLineBlank = false;
        at = b.parent;
      }
    }

The last child of `block`, if it's still open.

    let openLastChild(block: BlockData): BlockData? {
      let last = block.lastChild;
      if (last != null) {
        if (last.open) { return last; }
      }
      null
    }

Where the definition at `at` ends, or -1.

    let definitionEnd(text: SourceText, at: Int): Int {
      let scan = scanDefinition(text, at);
      if (scan != null) { scan.end } else { -1 }
    }

    let indexOfChild(parent: BlockData, child: BlockData): Int {
      let children = parent.children;
      for (var i = children.length - 1; i >= 0; i -= 1) {
        if (children[i].id == child.id) { return i; }
      }
      panic()
    }

    let canContain(parent: Int, child: Int): Boolean {
      if (
        parent == typeDocument || parent == typeBlockQuote || parent == typeListItem ||
        parent == typeFootnoteDefinition
      ) {
        child != typeListItem
      } else if (parent == typeList) {
        child == typeListItem
      } else {
        false
      }
    }

    let acceptsLines(type: Int): Boolean {
      type == typeParagraph || type == typeAtxHeading || type == typeSetextHeading ||
        type == typeFencedCode || type == typeIndentedCode || type == typeTable
    }

    let isBlankText(text: String, start: StringIndex, end: StringIndex): Boolean {
      skipBlanksAt(text, start, end) == end
    }

## Paragraph content

A paragraph's text as the inline parser sees it: each line without
its prefixes and leading whitespace, joined by `\n`. Each code point
maps back to one in the source, so tokens can be made from ranges of
it, with the line breaks between them.

    class Content {
      public text: SourceText;

For each line: where it starts in `text`, its length, and where it
starts in the source string.

      public starts: List<Int>;
      public lengths: List<Int>;
      public sourceStarts: List<StringIndex>;

The line number of the first line.

      public firstLine: Int;

      public constructor(text: SourceText, sourceStarts: List<StringIndex>, firstLine: Int) {
        this.text = text;
        let joins = text.joinedAt;
        let starts = new ListBuilder<Int>();
        let lengths = new ListBuilder<Int>();
        var start = 0;
        for (var i = 0; i <= joins.length; i += 1) {
          let end = if (i < joins.length) { joins[i] } else { text.length };
          starts.add(start);
          lengths.add(end - start);
          start = end + 1;
        }
        this.starts = starts.toList();
        this.lengths = lengths.toList();
        this.sourceStarts = sourceStarts;
        this.firstLine = firstLine;
      }

The index of the line holding `at`, or ending at it.

      public lineOf(at: Int): Int {
        var low = 0;
        var high = starts.length - 1;
        while (low < high) {
          let middle = (low + high + 1) / 2;
          if (starts[middle] <= at) { low = middle; } else { high = middle - 1; }
        }
        low
      }
    }

The content of lines `first` up to `end` of a paragraph-like leaf,
decoded from the source string.

    let paragraphContent(text: String, lines: List<LineData>, first: Int, end: Int): Content {
      let ranges = new ListBuilder<StringIndex>();
      let sourceStarts = new ListBuilder<StringIndex>();
      for (var n = first; n < end; n += 1) {
        let line = lines[n];
        let textStart = skipBlanksAt(text, line.leafStart, line.contentEnd);
        sourceStarts.add(textStart);
        ranges.add(textStart);
        ranges.add(line.contentEnd);
      }
      new Content(sourceLines(text, ranges.toList()), sourceStarts.toList(), first)
    }

Content from one range of one line, as for an ATX heading.

    let rangeContent(text: String, line: Int, start: StringIndex, end: StringIndex): Content {
      new Content(sourceLines(text, [start, end]), [start], line)
    }

## Link reference definitions

Where the parts of a definition are, in a paragraph's content: its
label from `[` to `]`, its destination, its title with its quotes or
parentheses (or -1 if none), and its end, after the line ending.

    class DefinitionScan(
      public labelEnd: Int,
      public destinationStart: Int,
      public destinationEnd: Int,
      public titleStart: Int,
      public titleEnd: Int,
      public lineEnd: Int,
      public end: Int,
    ) {}

The definition starting at `start` in `text`, or null, by the spec's
rules: a label, `:`, a destination, and an optional title, each
separated by spaces, tabs, and at most one line ending, then nothing
else on the line. The title is left out if what follows it isn't the
end of a line.

    let scanDefinition(text: SourceText, start: Int): DefinitionScan? {
      let labelEnd = linkLabelEnd(text, start);
      if (labelEnd < 0) { return null; }
      if (text.codeAt(labelEnd) != char':') { return null; }
      let destinationStart = skipSpaceAndNewline(text, labelEnd + 1);
      let destinationEnd = linkDestinationEnd(text, destinationStart);
      if (destinationEnd < 0) { return null; }
      let beforeTitle = destinationEnd;
      let titleStart = skipSpaceAndNewline(text, beforeTitle);
      var titleEnd = -1;
      if (titleStart > beforeTitle) {
        titleEnd = linkTitleEnd(text, titleStart);
      }
      if (titleEnd >= 0) {
        let lineEnd = skipBlanks(text, titleEnd, text.length);
        if (lineEnd >= text.length || text.codeAt(lineEnd) == char'\n') {
          return new DefinitionScan(
            labelEnd, destinationStart, destinationEnd, titleStart, titleEnd, lineEnd,
            minInt(lineEnd + 1, text.length),
          );
        }
      }
      let lineEnd = skipBlanks(text, beforeTitle, text.length);
      if (lineEnd >= text.length || text.codeAt(lineEnd) == char'\n') {
        return new DefinitionScan(
          labelEnd, destinationStart, destinationEnd, -1, -1, lineEnd,
          minInt(lineEnd + 1, text.length),
        );
      }
      null
    }

Past spaces and tabs, at most one line ending, and spaces and tabs.

    let skipSpaceAndNewline(text: SourceText, from: Int): Int {
      var i = skipBlanks(text, from, text.length);
      if (text.codeAt(i) == char'\n') {
        i = skipBlanks(text, i + 1, text.length);
      }
      i
    }

A link label: `[`, up to 999 code points with no unescaped brackets
and something besides whitespace, then `]`. Gives the end, after `]`,
or -1.

    let linkLabelEnd(text: SourceText, start: Int): Int {
      if (text.codeAt(start) != char'[') { return -1; }
      var i = start + 1;
      var nonblank = false;
      while (i < text.length) {
        let c = text.codeAt(i);
        if (c == char'[') { return -1; }
        if (c == char']') {
          return if (nonblank) { i + 1 } else { -1 };
        }
        if (!isAsciiWhitespace(c)) { nonblank = true; }
        if (c == char'\\' && isAsciiPunctuation(text.codeAt(i + 1))) {
          i += 2;
        } else {
          i += 1;
        }
        if (i - start > 1000) { return -1; }
      }
      -1
    }

A link destination: `<`, then no line ending or unescaped `<` or `>`,
then `>`; or a nonempty run without spaces or ASCII control characters
and with balanced unescaped parentheses. Gives its end, or -1.

    let linkDestinationEnd(text: SourceText, start: Int): Int {
      if (text.codeAt(start) == char'<') {
        var i = start + 1;
        while (i < text.length) {
          let c = text.codeAt(i);
          if (c == char'>') { return i + 1; }
          if (c == char'\n' || c == char'<') { return -1; }
          if (c == char'\\' && isAsciiPunctuation(text.codeAt(i + 1))) { i += 2; } else { i += 1; }
        }
        return -1;
      }
      var depth = 0;
      var i = start;
      while (i < text.length) {
        let c = text.codeAt(i);
        if (c == char'\\' && isAsciiPunctuation(text.codeAt(i + 1))) {
          i += 2;
        } else if (c == char'(') {
          depth += 1;
          if (depth > 32) { return -1; }
          i += 1;
        } else if (c == char')') {
          if (depth == 0) { break; }
          depth -= 1;
          i += 1;
        } else if (c <= 0x20 || c == 0x7F) {
          break;
        } else {
          i += 1;
        }
      }
      if (i == start || depth != 0) { -1 } else { i }
    }

A link title: `"…"`, `'…'`, or `(…)`, with backslash escapes. Gives
its end, or -1.

    let linkTitleEnd(text: SourceText, start: Int): Int {
      let open = text.codeAt(start);
      let close = if (open == char'(') { char')' } else { open };
      if (open != char'"' && open != char'\'' && open != char'(') { return -1; }
      var i = start + 1;
      while (i < text.length) {
        let c = text.codeAt(i);
        if (c == close) { return i + 1; }
        if (open == char'(' && c == char'(') { return -1; }
        if (c == char'\\' && isAsciiPunctuation(text.codeAt(i + 1))) { i += 2; } else { i += 1; }
      }
      -1
    }

## Block starts

Each scans the line from `at`, the first non-whitespace code point, to
`end`, the end of its content, in the source string. Those that give
where something ends give `at` if it isn't there.

The end of an ATX heading's opening `#`s: one to six, then a space, a
tab, or the end of the line.

    let atxHeadingStart(text: String, at: StringIndex, end: StringIndex): StringIndex {
      var i = at;
      while (i < end && text[i] == char'#') { i = text.next(i); }
      if (
        i > at && !text.hasAtLeast(at, i, 7) && (i == end || isSpaceOrTab(text[i]))
      ) {
        i
      } else {
        at
      }
    }

The end of an opening code fence: three or more backticks or tildes. A
backtick fence's info string can't hold a backtick.

    let openingFenceEnd(text: String, at: StringIndex, end: StringIndex): StringIndex {
      let c = codeInAt(text, at, end);
      if (c != char'`' && c != char'~') { return at; }
      var i = at;
      while (i < end && text[i] == c) { i = text.next(i); }
      if (!text.hasAtLeast(at, i, 3)) { return at; }
      if (c == char'`') {
        for (var j = i; j < end; j = text.next(j)) {
          if (text[j] == char'`') { return at; }
        }
      }
      i
    }

The length of a closing fence of the code point at `at`, with only
spaces and tabs after it, or 0.

    let closingFenceLength(text: String, at: StringIndex, end: StringIndex): Int {
      let c = text[at];
      var i = at;
      while (i < end && text[i] == c) { i = text.next(i); }
      if (skipBlanksAt(text, i, end) != end) { return 0; }
      text.countBetween(at, i)
    }

A setext heading's underline: 1 for `=`, 2 for `-`, or 0.

    let setextUnderline(text: String, at: StringIndex, end: StringIndex): Int {
      let c = codeInAt(text, at, end);
      if (c != char'=' && c != char'-') { return 0; }
      var i = at;
      while (i < end && text[i] == c) { i = text.next(i); }
      if (skipBlanksAt(text, i, end) != end) { return 0; }
      if (c == char'=') { 1 } else { 2 }
    }

Three or more of one of `*`, `-`, or `_`, with only spaces and tabs
between and after them.

    let isThematicBreak(text: String, at: StringIndex, end: StringIndex): Boolean {
      let c = codeInAt(text, at, end);
      if (c != char'*' && c != char'-' && c != char'_') { return false; }
      var count = 0;
      for (var i = at; i < end; i = text.next(i)) {
        let d = text[i];
        if (d == c) {
          count += 1;
        } else if (!isSpaceOrTab(d)) {
          return false;
        }
      }
      count >= 3
    }

The end of a list marker: `-`, `+`, or `*`, or one to nine digits and
`.` or `)`, followed by a space, a tab, or the end of the line. One
interrupting a paragraph needs content after it, and if ordered, must
start at 1.

    let listMarkerEnd(
      text: String, at: StringIndex, end: StringIndex, interruptsParagraph: Boolean,
    ): StringIndex {
      let c = codeInAt(text, at, end);
      var i = at;
      if (c == char'-' || c == char'+' || c == char'*') {
        i = text.next(i);
      } else if (isAsciiDigit(c)) {
        var digits = 0;
        while (i < end && digits < 9 && isAsciiDigit(text[i])) {
          i = text.next(i);
          digits += 1;
        }
        let d = codeInAt(text, i, end);
        if (d != char'.' && d != char')') { return at; }
        if (interruptsParagraph && text.slice(at, i) != "1") { return at; }
        i = text.next(i);
      } else {
        return at;
      }
      if (i < end && !isSpaceOrTab(text[i])) { return at; }
      if (interruptsParagraph && skipBlanksAt(text, i, end) == end) { return at; }
      i
    }

### GFM: tables and task list items

How many cells a table needs filled in empty, for rows shorter than its
header, before it takes no more rows, as cmark-gfm limits it, so a wide
header and many short rows can't make output quadratic in the input.

    let maxFilledCells = 0x80000;

Spaces, tabs, vertical tabs, and form feeds, which cmark-gfm's table
scanners skip.

    let isTableSpace(c: Int): Boolean {
      c == char' ' || c == char'\t' || c == 0x0B || c == 0x0C
    }

    let skipTableSpaces(text: String, from: StringIndex, end: StringIndex): StringIndex {
      var i = from;
      while (i < end && isTableSpace(text[i])) { i = text.next(i); }
      i
    }

The columns of a delimiter row from `at` to `end`, or 0 if it isn't
one: delimiters of `-`, each with an optional `:` before and after,
between `|`, with spaces around, and optional `|` at each end.

    let delimiterRowColumns(text: String, at: StringIndex, end: StringIndex): Int {
      var i = at;
      var count = 0;
      if (codeInAt(text, i, end) == char'|') { i = text.next(i); }
      while (true) {
        i = skipTableSpaces(text, i, end);
        if (codeInAt(text, i, end) == char':') { i = text.next(i); }
        if (codeInAt(text, i, end) != char'-') { return 0; }
        while (codeInAt(text, i, end) == char'-') { i = text.next(i); }
        if (codeInAt(text, i, end) == char':') { i = text.next(i); }
        i = skipTableSpaces(text, i, end);
        count += 1;
        if (i >= end) { return count; }
        if (text[i] != char'|') { return 0; }
        i = text.next(i);
        if (skipTableSpaces(text, i, end) >= end) { return count; }
      }
      0
    }

The first `|` from `from` not right after a backslash, or `end`. A
backslash before `|` keeps it in the cell, as in cmark-gfm, even if
that backslash is escaped itself.

    let nextPipe(text: String, from: StringIndex, end: StringIndex): StringIndex {
      var before = if (from > String.begin) { text[text.prev(from)] } else { -1 };
      for (var i = from; i < end; i = text.next(i)) {
        let c = text[i];
        if (c == char'|' && before != char'\\') { return i; }
        before = c;
      }
      end
    }

The cells of a table row from `at`, its first nonspace, to `end`, as
cmark-gfm counts them, or 0 if it isn't a row: cells between `|`,
empty ones too, but after the last `|`, only if it holds more than
spaces. At most 65,535.

    let tableRowCells(text: String, at: StringIndex, end: StringIndex): Int {
      var count = 0;
      var i = at;
      if (codeInAt(text, i, end) == char'|') { i = text.next(i); }
      while (true) {
        let pipe = nextPipe(text, i, end);
        if (pipe >= end) {
          if (skipTableSpaces(text, i, end) < end) { count += 1; }
          break;
        }
        count += 1;
        i = text.next(pipe);
      }
      if (count > 65535) { 0 } else { count }
    }

The end of a task list item's marker at `at`: `[`, a space, `x`, or
`X`, and `]`, then a space or tab before anything else.

    let taskMarkerEnd(text: String, at: StringIndex, end: StringIndex): StringIndex {
      if (codeInAt(text, at, end) != char'[') { return at; }
      let markAt = text.next(at);
      let mark = codeInAt(text, markAt, end);
      if (mark != char' ' && mark != char'x' && mark != char'X') { return at; }
      let close = text.next(markAt);
      if (codeInAt(text, close, end) != char']') { return at; }
      let markerEnd = text.next(close);
      if (!isTableSpace(codeInAt(text, markerEnd, end))) { return at; }
      markerEnd
    }

### GFM: footnote definitions

How many blocks one line may open, past which cmark-gfm opens no
footnote definitions, so deep nesting on one line stays cheap.

    let maxOpenDepth = 100;

Where the `]` of a footnote definition's `[^label]:` at `at` is: `[^`,
a label of anything but `]`, spaces, tabs, line endings, and U+0000,
then `]:`, as cmark-gfm scans it.

    let footnoteLabelEnd(text: String, at: StringIndex, end: StringIndex): StringIndex {
      if (codeInAt(text, at, end) != char'[') { return at; }
      let caret = text.next(at);
      if (codeInAt(text, caret, end) != char'^') { return at; }
      let labelStart = text.next(caret);
      var i = labelStart;
      while (i < end) {
        let c = text[i];
        if (c == char']') {
          return if (i > labelStart && codeInAt(text, text.next(i), end) == char':') { i } else { at };
        }
        if (c == char' ' || c == char'\t' || c == 0) { return at; }
        i = text.next(i);
      }
      at
    }

### HTML blocks

The kind of HTML block starting at `at`, 1 to 7, or 0. Kind 7 can't
interrupt a paragraph, so `allowType7` is false there.

    let htmlBlockStart(text: String, at: StringIndex, end: StringIndex, allowType7: Boolean): Int {
      if (codeInAt(text, at, end) != char'<') { return 0; }
      let afterOpen = text.next(at);
      let next = codeInAt(text, afterOpen, end);
      if (next == char'!') {
        if (matchesAt(text, at, end, "<!--", false)) { return 2; }
        if (matchesAt(text, at, end, "<![CDATA[", false)) { return 5; }
        if (isAsciiAlpha(codeInAt(text, text.next(afterOpen), end))) { return 4; }
        return 0;
      }
      if (next == char'?') { return 3; }
      let closing = next == char'/';
      let nameStart = if (closing) { text.next(afterOpen) } else { afterOpen };
      var nameEnd = nameStart;
      while (nameEnd < end && isAsciiAlphanumeric(text[nameEnd])) { nameEnd = text.next(nameEnd); }
      let name = asciiLowercase(text.slice(nameStart, nameEnd));
      let after = codeInAt(text, nameEnd, end);
      if (
        !closing && isType1Name(name) &&
        (after == -1 || isSpaceOrTab(after) || after == char'>')
      ) {
        return 1;
      }
      if (
        isType6Name(name) && (
          after == -1 || isSpaceOrTab(after) || after == char'>' ||
          (after == char'/' && codeInAt(text, text.next(nameEnd), end) == char'>')
        )
      ) {
        return 6;
      }
      if (allowType7) {

The tag scanners read decoded text (see `parse.temper.md`), so the
rest of the line is decoded for them; few lines get this far.

        let line = new SourceText(text.slice(at, end));
        let length = line.length;
        let tagEnd = if (closing) { closingTagEnd(line, 0, length) } else { openTagEnd(line, 0, length) };
        if (tagEnd > 0 && skipBlanks(line, tagEnd, length) == length) {
          if (closing || !isType1Name(asciiLowercase(line.slice(1, tagNameEnd(line, 1, length))))) {
            return 7;
          }
        }
      }
      0
    }

Whether `target`, which is ASCII, and lowercase if `ignoreCase`, is at
`at`, before `end`, ignoring ASCII case if `ignoreCase`.

    let matchesAt(
      text: String, at: StringIndex, end: StringIndex, target: String, ignoreCase: Boolean,
    ): Boolean {
      var i = at;
      var j = String.begin;
      while (target.hasIndex(j)) {
        if (i >= end) { return false; }
        var c = text[i];
        if (ignoreCase && c >= char'A' && c <= char'Z') { c += 32; }
        if (c != target[j]) { return false; }
        i = text.next(i);
        j = target.next(j);
      }
      true
    }

Whether `text` is at `at` in decoded text, before `end`, for the
inline parser.

    let startsWithText(source: SourceText, at: Int, end: Int, text: String): Boolean {
      let length = text.countBetween(String.begin, text.end);
      at + length <= end && source.slice(at, at + length) == text
    }

    let isType1Name(name: String): Boolean {
      name == "pre" || name == "script" || name == "style" || name == "textarea"
    }

    let type6Names = [
      "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption",
      "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt",
      "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2",
      "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend", "li", "link",
      "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param",
      "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title",
      "tr", "track", "ul",
    ];

    let isType6Name(name: String): Boolean {
      for (var i = 0; i < type6Names.length; i += 1) {
        if (type6Names[i] == name) { return true; }
      }
      false
    }

Whether a line of an HTML block of `type` ends it: for kinds 1 to 5,
whether it holds the end text.

    let htmlBlockEnds(text: String, type: Int, at: StringIndex, end: StringIndex): Boolean {
      if (type == 1) {
        return containsText(text, at, end, "</pre>") || containsText(text, at, end, "</script>") ||
          containsText(text, at, end, "</style>") || containsText(text, at, end, "</textarea>");
      }
      if (type == 2) { return containsText(text, at, end, "-->"); }
      if (type == 3) { return containsText(text, at, end, "?>"); }
      if (type == 4) { return containsText(text, at, end, ">"); }
      if (type == 5) { return containsText(text, at, end, "]]>"); }
      false
    }

Whether `target`, in ASCII lowercase, is in the line from `at` to
`end`, ignoring ASCII case.

    let containsText(text: String, at: StringIndex, end: StringIndex, target: String): Boolean {
      let first = target[String.begin];
      for (var i = at; i < end; i = text.next(i)) {
        let c = text[i];
        if (c == first || c + 32 == first) {
          if (matchesAt(text, i, end, target, true)) { return true; }
        }
      }
      false
    }
