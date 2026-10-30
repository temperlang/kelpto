# Parsing

Parses Markdown into a green tree that keeps every code point, so
`asWritten` gives the input back exactly, for any input. Text the
parser doesn't understand stays as text.

    let {
      GreenElement, GreenNode, GreenNodeBuilder, GreenToken, Kind, SourceText, redRoot,
      isAsciiAlpha, isAsciiAlphanumeric, isAsciiWhitespace,
    } = import("../kelpto-core");

## What it understands so far

A small part of CommonMark, enough to show the shape of the tree:

- **Blocks:** ATX headings (`# Title`), paragraphs, blank lines, and
  fenced code blocks (backticks or tildes).
- **Inlines:** text, backslash escapes, code spans, and raw inline
  HTML (open tags, closing tags, and comments, by CommonMark's rules).

Not yet, so these read as paragraphs and text: setext headings,
indented code, block quotes, lists, thematic breaks, HTML blocks, link
reference definitions, emphasis, links, images, autolinks, entity
references, hard line breaks, and tabs expanded to tab stops.

## Kinds

Nodes, which typed views wrap:

    export let documentKind = new Kind(100, "Document");
    export let headingKind = new Kind(101, "Heading");
    export let paragraphKind = new Kind(102, "Paragraph");
    export let blankLineKind = new Kind(103, "BlankLine");
    export let codeBlockKind = new Kind(104, "CodeBlock");
    export let openingFenceKind = new Kind(105, "OpeningFence");
    export let closingFenceKind = new Kind(106, "ClosingFence");

The inlines of a heading or paragraph, without its markers and the
whitespace around them, so an edit can swap them as one node:

    export let inlineContentKind = new Kind(107, "InlineContent");
    export let textKind = new Kind(110, "Text");
    export let codeSpanKind = new Kind(111, "CodeSpan");
    export let rawHtmlKind = new Kind(112, "RawHtml");

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

## Raw HTML: the coordination point

kelpto-md finds raw HTML by CommonMark's own rules, then asks a
`RawHtmlHandler` what goes inside the `RawHtml` node. The default keeps
it as one opaque token. The `kelpto` library supplies a handler that
parses it with kelpto-html, so the HTML becomes a subtree in the same
green tree. This way kelpto-md never imports kelpto-html, and any other
parser can plug in too.

    export interface RawHtmlHandler {

The children for a `RawHtml` node holding `html`. Their text together
must be exactly `html`; if not, the parser ignores them and keeps
`html` as one opaque token, so a faulty handler can't lose text.

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
      new MarkdownParser(new SourceText(text), rawHtmlHandler).parseDocument()
    }

The inline content node for `text` alone, used by edits that swap a
heading's inlines, so an edited tree matches what parsing its text
gives.

    let inlineContentGreen(text: String): GreenNode {
      let parser = new MarkdownParser(new SourceText(text), opaqueRawHtml);
      parser.parseInlinesOnly()
    }

## The parser

Blocks, line by line, then the inlines of each heading and paragraph.

    class MarkdownParser {
      private source: SourceText;
      private handler: RawHtmlHandler;
      private builder: GreenNodeBuilder = new GreenNodeBuilder();
      private var pos: Int = 0;
      private var inText: Boolean = false;

      public constructor(source: SourceText, handler: RawHtmlHandler) {
        this.source = source;
        this.handler = handler;
      }

      public parseDocument(): GreenNode {
        builder.startNode(documentKind);
        while (pos < source.length) {
          parseBlock();
        }
        builder.finishNode();
        builder.finish()
      }

      public parseInlinesOnly(): GreenNode {
        parseInlines(0, source.length);
        builder.finish()
      }

      private token(kind: Kind, start: Int, end: Int): Void {
        if (start < end) {
          builder.token(kind, source.slice(start, end));
        }
      }

      private parseBlock(): Void {
        let end = lineContentEnd(source, pos);
        if (skipBlanks(source, pos, end) == end) {
          builder.startNode(blankLineKind);
          token(whitespaceKind, pos, end);
          endLine(end);
          builder.finishNode();
        } else if (atxMarkerEnd(source, pos, end) >= 0) {
          parseHeading(end);
        } else if (openingFenceEnd(source, pos, end) >= 0) {
          parseCodeBlock(end);
        } else {
          parseParagraph(end);
        }
      }

Adds the line ending at `end`, if any, and moves to the next line.

      private endLine(end: Int): Void {
        let next = lineBreakEnd(source, end);
        token(lineEndingKind, end, next);
        pos = next;
      }

An ATX heading: up to three spaces, one to six `#`, then the content,
an optional closing sequence of `#`, and whitespace between.

      private parseHeading(end: Int): Void {
        let indentEnd = skipSpaces(source, pos, end);
        let markerEnd = atxMarkerEnd(source, pos, end);
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
        builder.startNode(headingKind);
        token(indentKind, pos, indentEnd);
        token(atxMarkerKind, indentEnd, markerEnd);
        token(whitespaceKind, markerEnd, contentStart);
        parseInlines(contentStart, contentEnd);
        token(whitespaceKind, contentEnd, closeStart);
        token(closingSequenceKind, closeStart, trailStart);
        token(whitespaceKind, trailStart, end);
        endLine(end);
        builder.finishNode();
      }

A fenced code block: an opening fence with an optional info string,
lines of code, and a closing fence at least as long, or the end of the
document.

      private parseCodeBlock(end: Int): Void {
        let indentEnd = skipSpaces(source, pos, end);
        let fenceEnd = openingFenceEnd(source, pos, end);
        let fenceChar = source.codeAt(indentEnd);
        let fenceLength = fenceEnd - indentEnd;
        let infoStart = skipBlanks(source, fenceEnd, end);
        let infoEnd = trimBlanksBack(source, infoStart, end);
        builder.startNode(codeBlockKind);
        builder.startNode(openingFenceKind);
        token(indentKind, pos, indentEnd);
        token(fenceKind, indentEnd, fenceEnd);
        token(whitespaceKind, fenceEnd, infoStart);
        token(infoKind, infoStart, infoEnd);
        token(whitespaceKind, infoEnd, end);
        endLine(end);
        builder.finishNode();
        while (pos < source.length) {
          let lineEnd = lineContentEnd(source, pos);
          let closeIndentEnd = skipSpaces(source, pos, lineEnd);
          var closeEnd = closeIndentEnd;
          while (source.codeAt(closeEnd) == fenceChar && closeEnd < lineEnd) {
            closeEnd += 1;
          }
          if (closeEnd - closeIndentEnd >= fenceLength && skipBlanks(source, closeEnd, lineEnd) == lineEnd) {
            builder.startNode(closingFenceKind);
            token(indentKind, pos, closeIndentEnd);
            token(fenceKind, closeIndentEnd, closeEnd);
            token(whitespaceKind, closeEnd, lineEnd);
            endLine(lineEnd);
            builder.finishNode();
            break;
          }
          token(codeLineKind, pos, lineEnd);
          endLine(lineEnd);
        }
        builder.finishNode();
      }

A paragraph: lines until a blank line, a heading, or a fence. Leading
and trailing whitespace stays outside its inline content.

      private parseParagraph(end: Int): Void {
        var lastEnd = end;
        var next = lineBreakEnd(source, end);
        while (next < source.length) {
          let lineEnd = lineContentEnd(source, next);
          if (
            skipBlanks(source, next, lineEnd) == lineEnd ||
            atxMarkerEnd(source, next, lineEnd) >= 0 ||
            openingFenceEnd(source, next, lineEnd) >= 0
          ) {
            break;
          }
          lastEnd = lineEnd;
          next = lineBreakEnd(source, lineEnd);
        }
        let contentStart = skipBlanks(source, pos, end);
        let contentEnd = trimBlanksBack(source, contentStart, lastEnd);
        builder.startNode(paragraphKind);
        token(whitespaceKind, pos, contentStart);
        parseInlines(contentStart, contentEnd);
        token(whitespaceKind, contentEnd, lastEnd);
        endLine(lastEnd);
        builder.finishNode();
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

      private plain(start: Int, end: Int): Void {
        if (start < end) {
          openText();
          token(plainKind, start, end);
        }
      }

      private parseInlines(start: Int, end: Int): Void {
        builder.startNode(inlineContentKind);
        var plainStart = start;
        var i = start;
        while (i < end) {
          let c = source.codeAt(i);
          if (c == char'\\' && i + 1 < end && isAsciiPunctuation(source.codeAt(i + 1))) {
            plain(plainStart, i);
            openText();
            token(escapeKind, i, i + 2);
            i += 2;
            plainStart = i;
          } else if (c == char'\n' || c == char'\r') {

A line ending inside a paragraph: whitespace before and after it is
layout, not text, as CommonMark strips it.

            let spaceStart = trimBlanksBack(source, plainStart, i);
            plain(plainStart, spaceStart);
            openText();
            token(whitespaceKind, spaceStart, i);
            let breakEnd = lineBreakEnd(source, i);
            token(lineEndingKind, i, breakEnd);
            let next = skipBlanks(source, breakEnd, end);
            token(whitespaceKind, breakEnd, next);
            i = next;
            plainStart = i;
          } else if (c == char'`') {
            var runEnd = i;
            while (runEnd < end && source.codeAt(runEnd) == char'`') {
              runEnd += 1;
            }
            let count = runEnd - i;
            let close = closingBackticks(source, runEnd, end, count);
            if (close >= 0) {
              plain(plainStart, i);
              closeText();
              builder.startNode(codeSpanKind);
              token(backticksKind, i, runEnd);
              token(codeTextKind, runEnd, close);
              token(backticksKind, close, close + count);
              builder.finishNode();
              i = close + count;
              plainStart = i;
            } else {
              i = runEnd;
            }
          } else if (c == char'<') {
            let tagEnd = rawHtmlEnd(source, i, end);
            if (tagEnd > i) {
              plain(plainStart, i);
              closeText();
              rawHtml(source.slice(i, tagEnd));
              i = tagEnd;
              plainStart = i;
            } else {
              i += 1;
            }
          } else {
            i += 1;
          }
        }
        plain(plainStart, end);
        closeText();
        builder.finishNode();
      }

Asks the handler for the raw HTML node's children, keeping `html` as
one token if they don't give back exactly `html`.

      private rawHtml(html: String): Void {
        builder.startNode(rawHtmlKind);
        let children = handler.parseRawHtml(html);
        if (new GreenNode(rawHtmlKind, children).text == html) {
          for (var k = 0; k < children.length; k += 1) {
            builder.element(children[k]);
          }
        } else {
          builder.token(htmlTextKind, html);
        }
        builder.finishNode();
      }
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

Past up to three spaces, the indentation a block may have.

    let skipSpaces(source: SourceText, from: Int, end: Int): Int {
      var i = from;
      while (i < end && i < from + 3 && source.codeAt(i) == char' ') {
        i += 1;
      }
      i
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

The end of an ATX heading's `#` marker on the line from `from` to
`end`, or -1.

    let atxMarkerEnd(source: SourceText, from: Int, end: Int): Int {
      let start = skipSpaces(source, from, end);
      var i = start;
      while (i < end && source.codeAt(i) == char'#') {
        i += 1;
      }
      let count = i - start;
      if (count >= 1 && count <= 6 && (i == end || isSpaceOrTab(source.codeAt(i)))) { i } else { -1 }
    }

The end of an opening code fence (three or more backticks or tildes)
on the line, or -1. A backtick fence's info string can't hold a
backtick.

    let openingFenceEnd(source: SourceText, from: Int, end: Int): Int {
      let start = skipSpaces(source, from, end);
      let c = source.codeAt(start);
      if (c != char'`' && c != char'~') { return -1; }
      var i = start;
      while (i < end && source.codeAt(i) == c) {
        i += 1;
      }
      if (i - start < 3) { return -1; }
      if (c == char'`') {
        for (var j = i; j < end; j += 1) {
          if (source.codeAt(j) == char'`') { return -1; }
        }
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

The end of the raw HTML starting with the `<` at `at`, or `at` if none
starts there. It knows open tags with attributes, closing tags, and
comments. Not yet: processing instructions, declarations, and CDATA
sections, which stay text for now. CommonMark allows at most one line
ending in a tag's whitespace; this allows any.

    let rawHtmlEnd(source: SourceText, at: Int, end: Int): Int {
      let c = codeIn(source, at + 1, end);
      if (c == char'/') {
        let nameEnd = tagNameEnd(source, at + 2, end);
        if (nameEnd < 0) { return at; }
        let close = skipWhitespace(source, nameEnd, end);
        if (codeIn(source, close, end) == char'>') { close + 1 } else { at }
      } else if (c == char'!') {
        commentEnd(source, at, end)
      } else {
        openTagEnd(source, at, end)
      }
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

`<!-->`, `<!--->`, or `<!--`, text, then `-->`.

    let commentEnd(source: SourceText, at: Int, end: Int): Int {
      if (source.slice(at, minInt(at + 4, end)) != "<!--") { return at; }
      if (codeIn(source, at + 4, end) == char'>') { return at + 5; }
      if (codeIn(source, at + 4, end) == char'-' && codeIn(source, at + 5, end) == char'>') {
        return at + 6;
      }
      for (var i = at + 4; i + 2 < end; i += 1) {
        if (
          source.codeAt(i) == char'-' && source.codeAt(i + 1) == char'-' &&
          source.codeAt(i + 2) == char'>'
        ) {
          return i + 3;
        }
      }
      at
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
