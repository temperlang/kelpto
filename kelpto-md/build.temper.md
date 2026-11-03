# Building documents

Builders for writing a document from scratch, from plain strings,
with the escaping done for you: whatever text goes in reads back as
that text, whatever it holds (`*`, `#` at a line's start, `<b>`, or a
backslash). A `MarkdownBuilder` takes blocks, and `Inlines` holds
the inline content of a heading, paragraph, emphasis, or link; each
method adds to the end, and `toDocument()` gives a `MarkdownDocument`.

```temper inert
let doc = new MarkdownBuilder();
doc.heading(1, Inlines.empty.text("Release *notes*")) orelse panic();
doc.paragraph(
  Inlines.empty.text("Read ").strong(Inlines.empty.link(
    Inlines.empty.text("the docs"), new LinkTarget("https://example.com/a b"),
  )).text(", then `run` it."),
);
doc.codeBlock("sh", "make\n");
doc.toMarkdown();
  // "# Release \\*notes\\*\n\nRead **[the docs](<https://example.com/a b>)**, then \\`run\\` it.\n\n```sh\nmake\n```\n"
```

`Inlines` is a value, and a `MarkdownBuilder` copies what it's given:
changing a builder after adding it changes nothing already added. The
Markdown reads the same in CommonMark and GitHub Flavored Markdown:
text never turns into strikethrough or an extended autolink (an `@`
is written `&#64;`). How it's escaped is in "Writing inlines", below.

kelpto-core's `characterReferenceEnd`, `isAsciiDigit`,
`isUnicodePunctuation`, and `isUnicodeWhitespace` come from other
files' imports: a module importing a function twice leaves it nil in
Lua (Temper, 2026-11-03).

## Inline content

What `Inlines` holds: a small tree, written as Markdown only when a
block takes it, since the characters around each piece decide its
escaping.

What an `Inlines` holds, opaque outside this library.

    export sealed interface InlinePiece {}

    class TextPiece(public text: String) extends InlinePiece {}

    class CodePiece(public code: String) extends InlinePiece {}

    class DelimitedPiece(public strong: Boolean, public content: List<InlinePiece>) extends InlinePiece {}

    class LinkPiece(
      public image: Boolean, public content: List<InlinePiece>, public target: LinkTarget,
      public title: String?,
    ) extends InlinePiece {}

    class BreakPiece() extends InlinePiece {}

Inline content for a heading, paragraph, emphasis, or link: a value,
like `MarkdownParser`. Start from `Inlines.empty`; each method gives
new content with one piece added at the end, so calls chain and any
content can be shared.

    export class Inlines {
      private parts: List<InlinePiece>;

      private constructor(parts: List<InlinePiece>) { this.parts = parts; }

      public static empty: Inlines = new Inlines([]);

What it holds, in order: for the library's own use, since Temper
has nothing between private and exported.

      public get pieces(): List<InlinePiece> { parts }

Plain text, escaped so it reads as written. Line breaks become
spaces; `lineBreak()` makes a real one.

      public text(text: String): Inlines {
        if (text.isEmpty) { new Inlines(parts) } else { plus(new TextPiece(spacedLines(text))) }
      }

A code span holding `code` as written. Line breaks become spaces, as
code spans read them. Empty code adds nothing, since Markdown has no
empty code span, and code spans next to each other join.

      public code(code: String): Inlines {
        if (code.isEmpty) { new Inlines(parts) } else { plus(new CodePiece(spacedLines(code))) }
      }

Emphasis (`<em>`) and strong emphasis (`<strong>`) around `content`.
Empty content adds nothing.

      public emphasis(content: Inlines): Inlines { plus(new DelimitedPiece(false, content.pieces)) }

      public strong(content: Inlines): Inlines { plus(new DelimitedPiece(true, content.pieces)) }

A link to `target`, with `content` as its text and an optional title.
Links can't nest, so a link inside `content` adds only its text. Line
breaks in `target` are percent-encoded, as rendering would write them,
and in `title` become spaces.

      public link(content: Inlines, target: LinkTarget, title: String? = null): Inlines {
        plus(new LinkPiece(false, content.pieces, target, title))
      }

An image of `target`, described by `alt`.

      public image(alt: String, target: LinkTarget, title: String? = null): Inlines {
        let altPieces = new ListBuilder<InlinePiece>();
        if (!alt.isEmpty) { altPieces.add(new TextPiece(spacedLines(alt))); }
        plus(new LinkPiece(true, altPieces.toList(), target, title))
      }

A hard line break. At the end of a paragraph, which can't hold one, it
adds nothing, and in a heading, which is one line, it's a space.

      public lineBreak(): Inlines { plus(new BreakPiece()) }

Copies the list, so content stays a value; inline content is short.
Never returns `this`, which would keep Temper's C++ backend from
making getters named like these methods `const` (2026-11-03).

      private plus(piece: InlinePiece): Inlines {
        let next = parts.toListBuilder();
        next.add(piece);
        new Inlines(next.toList())
      }
    }

Line breaks (`\r\n`, `\r`, or `\n`) as spaces.

    let hasLineBreak(text: String): Boolean {
      longestRun(text, char'\n') > 0 || longestRun(text, char'\r') > 0
    }

    let spacedLines(text: String): String {
      if (!hasLineBreak(text)) { return text; }
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; text.hasIndex(i); i = text.next(i)) {
        let c = text[i];
        if (c == char'\n' || c == char'\r') {
          out.append(text.slice(runStart, i));
          let afterCr = c == char'\n' && i > String.begin && text[text.prev(i)] == char'\r';
          if (!afterCr) { out.append(" "); }
          runStart = text.next(i);
        }
      }
      out.append(text.slice(runStart, text.end));
      out.toString()
    }

## Blocks

Builds a document block by block. Blocks are separated by blank
lines; container blocks take another `MarkdownBuilder` for what they
hold. A document's editor takes builders too, as the blocks it
inserts (see `MarkdownEditor.insertBefore`).

    export class MarkdownBuilder {
      private built: ListBuilder<BuiltBlock>;

      public constructor() {
        this.built = new ListBuilder<BuiltBlock>();
      }

An ATX heading, `#` to `######`. Bubbles for a level outside 1 to 6.

      public heading(level: Int, content: Inlines): Void throws Bubble {
        if (level < 1 || level > 6) { bubble(); }
        let out = new StringBuilder();
        for (var i = 0; i < level; i += 1) { out.append("#"); }
        let text = writeInlines(content.pieces, headingContext);
        if (!text.isEmpty) {
          out.append(" ");
          out.append(text);
        }
        out.append("\n");
        add(out.toString());
      }

A paragraph. Empty content adds nothing, since there's no empty
paragraph.

      public paragraph(content: Inlines): Void {
        let text = writeInlines(content.pieces, paragraphContext);
        if (!text.isEmpty) { add("${text}\n"); }
      }

A fenced code block with an info string (often a language, or empty)
and its code, kept as written but for line endings, which become `\n`;
a last line ending is added if missing. The fence is longer than any
run of its character in the code, and is `~` if the info string holds
a backtick. Line breaks in `info` become spaces, and it's trimmed, as
it reads.

      public codeBlock(info: String, code: String): Void {
        let lines = normalizedLines(code);
        let infoText = spacedLines(info);
        let fenceChar = if (longestRun(infoText, char'`') == 0) { char'`' } else { char'~' };
        let fenceText = if (fenceChar == char'`') { "`" } else { "~" };
        var length = longestRun(lines, fenceChar) + 1;
        if (length < 3) { length = 3; }
        let fence = new StringBuilder();
        for (var i = 0; i < length; i += 1) { fence.append(fenceText); }
        let out = new StringBuilder();
        out.append(fence.toString());
        let escapedInfo = escapeInfo(infoText);
        if (firstCodeOf(escapedInfo) == fenceChar) { out.append(" "); }
        out.append(escapedInfo);
        out.append("\n");
        out.append(lines);
        if (!lines.isEmpty && lastCodeOf(lines) != char'\n') { out.append("\n"); }
        out.append(fence.toString());
        out.append("\n");
        add(out.toString());
      }

A thematic break, `***` (or `---` where it starts a `*` list item,
which `* ***` would end).

      public thematicBreak(): Void { built.add(new BuiltBlock("***\n", thematicBlock, 0, [])); }

A block quote holding `content`'s blocks.

      public blockQuote(content: MarkdownBuilder): Void {
        add(prefixed(content.toMarkdown(), "> ", "> "));
      }

A bullet list, one item per builder. Its marker is `-`, `+`, or `*`,
whichever differs from a list just before it (so the two stay apart)
and from what its items start with.

      public bulletList(items: List<MarkdownBuilder>): Void {
        built.add(new BuiltBlock("", bulletBlock, 0, itemTexts(items)));
      }

An ordered list numbered from `start`, one item per builder. Bubbles
for a start outside 0 to 999,999,999, as Markdown allows. Its
delimiter is `.`, or `)` after an ordered list using `.`.

      public orderedList(start: Int, items: List<MarkdownBuilder>): Void throws Bubble {
        if (start < 0 || start + items.length - 1 > 999999999) { bubble(); }
        built.add(new BuiltBlock("", orderedBlock, start, itemTexts(items)));
      }

The Markdown, blocks separated by blank lines.

      public toMarkdown(): String { markdownBetween(0, 0, false) orelse panic() }

The document, parsed as CommonMark (GFM reads it the same).

      public toDocument(): MarkdownDocument { parseMarkdown(toMarkdown()) }

A builder with the same blocks, which changes apart from this one.

      public copy(): MarkdownBuilder {
        let other = new MarkdownBuilder();
        for (var i = 0; i < built.length; i += 1) { other.addBuilt(built[i]); }
        other
      }

For the library's own use, as an editor fits blocks between others:
the Markdown, with a first list's marker (its bullet, or its
delimiter after the numbers) other than `before`, a last list's other
than `after`, so neither joins a list beside it, and with `starItem`,
a first thematic break written so it can follow a `*` list marker.
Bubbles if no marker fits: an ordered list between lists using `.`
and `)`.

      public markdownBetween(before: Int, after: Int, starItem: Boolean): String throws Bubble {
        let out = new StringBuilder();
        var lastList = before;
        let n = built.length;
        for (var b = 0; b < n; b += 1) {
          let block = built[b];
          if (b > 0) { out.append("\n"); }
          let avoid = if (b == n - 1) { after } else { 0 };
          if (block.kind == bulletBlock) {
            let marker = bulletFor(block.items, lastList, avoid);
            let markerText = if (marker == char'-') { "-" } else if (marker == char'+') { "+" } else { "*" };
            for (var i = 0; i < block.items.length; i += 1) {
              out.append(prefixed(block.items[i], "${markerText} ", "  "));
            }
            lastList = marker;
          } else if (block.kind == orderedBlock) {
            var delimiter = if (lastList == char'.') { char')' } else { char'.' };
            if (delimiter == avoid) { delimiter = if (delimiter == char'.') { char')' } else { char'.' }; }
            if (delimiter == lastList || delimiter == avoid) { bubble(); }
            let delimiterText = if (delimiter == char'.') { "." } else { ")" };
            for (var i = 0; i < block.items.length; i += 1) {
              let marker = "${(block.start + i).toString()}${delimiterText}";
              let rest = new StringBuilder();
              for (var k = 0; k <= marker.countBetween(String.begin, marker.end); k += 1) { rest.append(" "); }
              out.append(prefixed(block.items[i], "${marker} ", rest.toString()));
            }
            lastList = delimiter;
          } else {
            out.append(if (block.kind == thematicBlock && b == 0 && starItem) { "---\n" } else { block.text });
            lastList = 0;
          }
        }
        out.toString()
      }

For the library's own use: whether the last block is a list, which
an indented block after it would join.

      public get endsWithList(): Boolean {
        !built.isEmpty && built[built.length - 1].kind != textBlock && built[built.length - 1].kind != thematicBlock
      }

For the library's own use: the blocks, and adding one.

      public get blocks(): List<BuiltBlock> { built.toList() }

      public addBuilt(block: BuiltBlock): Void { built.add(block); }

      private add(block: String): Void { built.add(new BuiltBlock(block, textBlock, 0, [])); }

      private itemTexts(items: List<MarkdownBuilder>): List<String> {
        let texts = new ListBuilder<String>();
        for (var i = 0; i < items.length; i += 1) {
          texts.add(items[i].toMarkdown());
        }
        texts.toList()
      }
    }

A block as built: its Markdown, or a list's items' Markdown, written
with its markers only when the document is, since those depend on the
blocks around it.

    export class BuiltBlock(
      public text: String, public kind: Int, public start: Int, public items: List<String>,
    ) {}

    let textBlock = 0;
    let thematicBlock = 1;
    let bulletBlock = 2;
    let orderedBlock = 3;

A bullet other than `before` and `avoid`, and if it can be, other than
what an item starts with. Bubbles if none is left, which can't happen
with only two to avoid.

    let bulletFor(items: List<String>, before: Int, avoid: Int): Int throws Bubble {
      let markers = [char'-', char'+', char'*'];
      for (var pass = 0; pass < 2; pass += 1) {
        for (var m = 0; m < markers.length; m += 1) {
          let candidate = markers[m];
          var ok = candidate != before && candidate != avoid;
          if (pass == 0) {
            for (var i = 0; i < items.length; i += 1) {
              if (firstCodeOf(items[i]) == candidate) { ok = false; }
            }
          }
          if (ok) { return candidate; }
        }
      }
      bubble()
    }

`text`'s lines, each ending `\n`, `\r\n`, or `\r`, with every line
ending as `\n`.

    let normalizedLines(text: String): String {
      if (longestRun(text, char'\r') == 0) { return text; }
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; text.hasIndex(i); i = text.next(i)) {
        if (text[i] == char'\r') {
          out.append(text.slice(runStart, i));
          out.append("\n");
          let next = text.next(i);
          runStart = if (text.hasIndex(next) && text[next] == char'\n') { text.next(next) } else { next };
        }
      }
      if (runStart < text.end) { out.append(text.slice(runStart, text.end)); }
      out.toString()
    }

The longest run of `c` in `text`.

    let longestRun(text: String, c: Int): Int {
      var longest = 0;
      var run = 0;
      for (var i = String.begin; text.hasIndex(i); i = text.next(i)) {
        if (text[i] == c) {
          run += 1;
          if (run > longest) { longest = run; }
        } else {
          run = 0;
        }
      }
      longest
    }

An info string, trimmed, with backslashes, backticks, and character
references escaped, so it reads as written.

    let escapeInfo(info: String): String {
      let start = skipBlanksAt(info, String.begin, info.end);
      let end = trimBlanksBackAt(info, start, info.end);
      let out = new StringBuilder();
      var runStart = start;
      for (var i = start; i < end; i = info.next(i)) {
        let c = info[i];
        if (c == char'\\' || c == char'`' || (c == char'&' && characterReferenceEnd(info, i, end) != i)) {
          out.append(info.slice(runStart, i));
          out.append("\\");
          runStart = i;
        }
      }
      out.append(info.slice(runStart, end));
      out.toString()
    }

`text`'s lines with `first` before the first and `rest` before the
others; blank lines get the prefix without trailing spaces.

    let prefixed(text: String, first: String, rest: String): String {
      let out = new StringBuilder();
      if (text.isEmpty) {
        out.append(trimBlanksEnd(first));
        out.append("\n");
        return out.toString();
      }
      var lineStart = String.begin;
      var isFirst = true;
      while (text.hasIndex(lineStart)) {
        let lineEnd = indexOrEnd(text, "\n", lineStart);
        let prefix = if (isFirst) { first } else { rest };
        if (lineEnd == lineStart) {
          out.append(trimBlanksEnd(prefix));
        } else {
          out.append(prefix);
          out.append(text.slice(lineStart, lineEnd));
        }
        out.append("\n");
        isFirst = false;
        lineStart = if (lineEnd < text.end) { text.next(lineEnd) } else { text.end };
      }
      out.toString()
    }

    let trimBlanksEnd(text: String): String {
      text.slice(String.begin, trimBlanksBackAt(text, String.begin, text.end))
    }

## Writing inlines

Plain text is escaped as `Heading.withText` escapes it (a backslash
before `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`, `&`, and `~`), plus what
only matters around other pieces or at a line's start:

- **A line's start,** in a paragraph (its first line, or after a hard
  break), gets a backslash before ASCII punctuation, and before the
  `.` or `)` after digits, so it can't start a block: a heading, list,
  quote, fence, thematic break, setext underline, or table row.
- **Spaces and tabs** where Markdown would drop them (a line's start
  and end, the ends of a heading or cell, and inside emphasis next to
  its delimiters) are character references, `&#32;` and `&#9;`.
- **Emphasis** uses `*` or `_`, alternating so neighboring delimiter
  runs never join, and a letter or digit right outside a delimiter is
  a character reference, so the delimiter is always a left- or
  right-flanking run as CommonMark's rules need.
- **GFM's extended autolinks** never start in text: `@` is `&#64;`, a
  `:` before `/` and a `.` after `www` are escaped.
- **Code spans** use one more backtick than their longest run, with a
  space inside each end when the code starts or ends with a backtick,
  or with a space at both ends.
- **Link destinations** go in `<…>` when they need it, as
  `withDestination` writes them, and titles in `"…"`.

Where inline content is: a paragraph, a heading, or a table cell.

    let paragraphContext = 0;
    let headingContext = 1;
    let cellContext = 2;

What holds a sequence of pieces: a block itself, emphasis, or a link.

    let blockLevel = 0;
    let emphasisLevel = 1;
    let linkLevel = 2;

    let writeInlines(pieces: List<InlinePiece>, context: Int): String {
      let all = preparedPieces(pieces, context);
      let first = new InlineWriter(context, 0);
      first.writeSequence(all, blockLevel, 0);
      let text = first.out.toString();
      if (!nestsEmphasis(all, 0)) { return text; }

Emphasis two deep can meet a case the rules below don't settle: a
delimiter run that can both open and close, inside emphasis of the
same character and length, which it would close. Rare, so the text is
parsed back and checked. If it differs, each run of neighboring
emphasis in turn takes its other choice, kept if more of the text then
reads as built, for up to three passes.

      let want = shapeOfPieces(all);
      var got = shapeOfText(text, context);
      if (got == want) { return text; }
      var best = commonLength(got, want);
      var mask = 0;
      let chains = if (first.chains < 30) { first.chains } else { 30 };
      for (var pass = 0; pass < 3; pass += 1) {
        for (var k = 0; k < chains; k += 1) {
          let tryMask = mask ^ bitAt(k);
          let writer = new InlineWriter(context, tryMask);
          writer.writeSequence(all, blockLevel, 0);
          let written = writer.out.toString();
          got = shapeOfText(written, context);
          if (got == want) { return written; }
          let length = commonLength(got, want);
          if (length > best) {
            best = length;
            mask = tryMask;
          }
        }
      }
      text
    }

`1 << k`, without a shift of a literal, which Temper's Rust backend
leaves untyped (2026-11-03).

    let bitAt(k: Int): Int {
      var bit = 1;
      for (var i = 0; i < k; i += 1) { bit *= 2; }
      bit
    }

How many code points `a` and `b` share at their start.

    let commonLength(a: String, b: String): Int {
      var i = String.begin;
      var j = String.begin;
      var n = 0;
      while (a.hasIndex(i) && b.hasIndex(j) && a[i] == b[j]) {
        i = a.next(i);
        j = b.next(j);
        n += 1;
      }
      n
    }

Pieces as a block writes them: normalized, hard breaks as spaces in
headings, which are one line, and none at a paragraph's end.

    let preparedPieces(pieces: List<InlinePiece>, context: Int): List<InlinePiece> {
      let all = normalizedPieces(
        if (context == paragraphContext) { pieces } else { breaksAsSpaces(pieces) }, false,
      );
      var end = all.length;
      while (end > 0 && all[end - 1] is BreakPiece) { end -= 1; }
      all.slice(0, end)
    }

    let breaksAsSpaces(pieces: List<InlinePiece>): List<InlinePiece> {
      let result = new ListBuilder<InlinePiece>();
      for (var i = 0; i < pieces.length; i += 1) {
        let piece = pieces[i];
        when (piece) {
          is BreakPiece -> result.add(new TextPiece(" "));
          is DelimitedPiece -> result.add(new DelimitedPiece(piece.strong, breaksAsSpaces(piece.content)));
          is LinkPiece -> result.add(
            new LinkPiece(piece.image, breaksAsSpaces(piece.content), piece.target, piece.title),
          );
          else -> result.add(piece);
        }
      }
      result.toList()
    }

Whether emphasis holds emphasis, at any depth.

    let nestsEmphasis(pieces: List<InlinePiece>, depth: Int): Boolean {
      for (var i = 0; i < pieces.length; i += 1) {
        let piece = pieces[i];
        when (piece) {
          is DelimitedPiece -> if (depth > 0 || nestsEmphasis(piece.content, depth + 1)) { return true; };
          is LinkPiece -> if (nestsEmphasis(piece.content, depth)) { return true; };
          else -> do {};
        }
      }
      false
    }

### Shapes

A shape of inline content, to compare what was written with what
parses back: text between `{` and `}`, with neighbors joined, so
character references don't split it, and markup around the rest.

    let shapeOfText(text: String, context: Int): String {
      let doc = parseMarkdown(if (context == headingContext) { "# ${text}" } else { text });
      let blocks = doc.children;
      if (blocks.isEmpty) { return ""; }
      if (blocks.length > 1) { return "?"; }
      let block = blocks[0];
      let out = new StringBuilder();
      when (block) {
        is Heading -> shapeOfViews(block.children, out);
        is Paragraph -> shapeOfViews(block.children, out);
        else -> out.append("?");
      }
      joinedText(out.toString())
    }

    let shapeOfViews(children: List<ParagraphChild>, out: StringBuilder): Void {
      for (var i = 0; i < children.length; i += 1) {
        let child = children[i];
        when (child) {
          is Text -> out.append("{${child.text}}");
          is CharacterReference -> out.append("{${child.value}}");
          is CodeSpan -> out.append("`${child.code}`");
          is HardBreak -> out.append("/");
          is Emphasis -> do {
            out.append("e(");
            shapeOfViews(child.children, out);
            out.append(")");
          };
          is Strong -> do {
            out.append("s(");
            shapeOfViews(child.children, out);
            out.append(")");
          };
          is Link -> do {
            out.append("l(");
            shapeOfViews(paragraphChildrenOf(child.node), out);
            out.append(")<${child.destination?.url ?? "-"}|${child.title ?? "-"}>");
          };
          is Image -> out.append("i(${child.alt})<${child.destination?.url ?? "-"}|${child.title ?? "-"}>");
          else -> out.append("?${child.asWritten}?");
        }
      }
    }

    let shapeOfPieces(pieces: List<InlinePiece>): String {
      let out = new StringBuilder();
      addShapeOfPieces(pieces, out);
      joinedText(out.toString())
    }

    let addShapeOfPieces(pieces: List<InlinePiece>, out: StringBuilder): Void {
      for (var i = 0; i < pieces.length; i += 1) {
        let piece = pieces[i];
        when (piece) {
          is TextPiece -> out.append("{${piece.text}}");
          is CodePiece -> out.append("`${piece.code}`");
          is BreakPiece -> out.append("/");
          is DelimitedPiece -> do {
            out.append(if (piece.strong) { "s(" } else { "e(" });
            addShapeOfPieces(piece.content, out);
            out.append(")");
          };
          is LinkPiece -> do {
            let url = encodedLines(piece.target.url);
            let title = if (piece.title == null) { "-" } else { spacedLines(piece.title ?? "") };
            if (piece.image) {
              let alt = new StringBuilder();
              for (var k = 0; k < piece.content.length; k += 1) {
                let part = piece.content[k];
                if (part is TextPiece) { alt.append(part.text); }
              }
              out.append("i(${alt.toString()})<${url}|${title}>");
            } else {
              out.append("l(");
              addShapeOfPieces(piece.content, out);
              out.append(")<${url}|${title}>");
            }
          };
          else -> do {};
        }
      }
    }

    let joinedText(shape: String): String {
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; shape.hasIndex(i); i = shape.next(i)) {
        let next = shape.next(i);
        if (shape[i] == char'}' && shape.hasIndex(next) && shape[next] == char'{') {
          out.append(shape.slice(runStart, i));
          runStart = shape.next(next);
        }
      }
      out.append(shape.slice(runStart, shape.end));
      out.toString()
    }

Pieces ready to write: empty emphasis dropped, hard breaks at the end
of emphasis moved after it (a delimiter after a line break can't close),
links inside links replaced by their text, and neighboring text pieces,
and code spans, joined.

    let normalizedPieces(pieces: List<InlinePiece>, inLink: Boolean): List<InlinePiece> {
      let result = new ListBuilder<InlinePiece>();
      for (var i = 0; i < pieces.length; i += 1) {
        let piece = pieces[i];
        when (piece) {
          is DelimitedPiece -> do {
            let inner = normalizedPieces(piece.content, inLink);
            var end = inner.length;
            while (end > 0 && inner[end - 1] is BreakPiece) { end -= 1; }
            if (end > 0) { addPiece(result, new DelimitedPiece(piece.strong, inner.slice(0, end))); }
            for (var k = end; k < inner.length; k += 1) { result.add(inner[k]); }
          };
          is LinkPiece -> do {
            let inner = normalizedPieces(piece.content, true);
            if (inLink && !piece.image) {
              for (var k = 0; k < inner.length; k += 1) { addPiece(result, inner[k]); }
            } else {
              result.add(new LinkPiece(piece.image, inner, piece.target, piece.title));
            }
          };
          else -> addPiece(result, piece);
        }
      }
      result.toList()
    }

    let addPiece(result: ListBuilder<InlinePiece>, piece: InlinePiece): Void {
      if (!result.isEmpty) {
        let last = result[result.length - 1];
        when (piece) {
          is TextPiece -> if (last is TextPiece) {
            result.set(result.length - 1, new TextPiece("${last.text}${piece.text}"));
            return;
          };
          is CodePiece -> if (last is CodePiece) {
            result.set(result.length - 1, new CodePiece("${last.code}${piece.code}"));
            return;
          };
          else -> do {}
        }
      }
      result.add(piece);
    }

    class InlineWriter {
      public out: StringBuilder;
      public context: Int;

Whether what's written next starts a line.

      public var lineStart: Boolean;

The delimiters of the emphasis being written, innermost last, as the
character times 4 plus the run's length. Links start afresh, since
emphasis can't match across a link's brackets.

      public var open: ListBuilder<Int>;

Which try this is: bit `k` takes the other choice at the `k`th run
of neighboring emphasis, counted as they're written.

      public attempt: Int;
      public var chains: Int;

      public constructor(context: Int, attempt: Int) {
        this.out = new StringBuilder();
        this.context = context;
        this.lineStart = true;
        this.open = new ListBuilder<Int>();
        this.attempt = attempt;
        this.chains = 0;
      }

Writes `pieces`, held by `level`. `run` is the delimiter character
of the emphasis holding them, which comes right before the first and
after the last, or 0.

      public writeSequence(pieces: List<InlinePiece>, level: Int, run: Int): Void {
        let n = pieces.length;
        let runs = delimiterRuns(pieces, run);
        for (var i = 0; i < n; i += 1) {
          let piece = pieces[i];
          let before = if (i > 0) { pieces[i - 1] } else { null };
          let after = if (i + 1 < n) { pieces[i + 1] } else { null };
          when (piece) {
            is TextPiece -> writeText(
              piece.text,
              i == 0 && level == emphasisLevel,
              before is DelimitedPiece,
              i == n - 1 && level != linkLevel,
              after is DelimitedPiece,
              isLinkNotImage(after),
              i == n - 1 && level == blockLevel && context == headingContext,
            );
            is CodePiece -> writeCode(piece.code);
            is DelimitedPiece -> do {
              let c = runs[i];
              let length = if (piece.strong) { 2 } else { 1 };
              let mark = if (c == char'*') { if (piece.strong) { "**" } else { "*" } } else {
                if (piece.strong) { "__" } else { "_" }
              };
              out.append(mark);
              lineStart = false;
              open.add(c * 4 + length);
              writeSequence(piece.content, emphasisLevel, c);
              open.removeLast();
              out.append(mark);
            };
            is LinkPiece -> do {
              if (piece.image) { out.append("!"); }
              out.append("[");
              lineStart = false;
              let outside = open;
              open = new ListBuilder<Int>();
              writeSequence(piece.content, linkLevel, 0);
              open = outside;
              out.append("](");
              out.append(writeDestination(encodedLines(piece.target.url)) orelse panic());
              let title = piece.title;
              if (title != null) {
                out.append(" \"");
                out.append(escapeTitle(spacedLines(title)));
                out.append("\"");
              }
              out.append(")");
            };
            is BreakPiece -> if (context == paragraphContext) {
              out.append("\\\n");
              lineStart = true;
            } else {
              out.append(" ");
            }
          }
        }
      }

The delimiter character for each emphasis in `pieces` (0 for other
pieces). Emphasis right next to emphasis, or to the delimiter `run`
holding them, alternates `*` and `_`, so no two runs join: a run of
neighbors ending at `run`'s closing delimiter is chosen from its end,
otherwise from its start. Only a run of neighbors filling all of
`pieces`, of even length, can't avoid both of `run`'s delimiters; it
joins the opening one, which CommonMark still reads as nested.
Otherwise `*` comes first, unless emphasis of the same length and
character is open around these pieces, which a delimiter run that can
both open and close might match. A try after the first (see
`writeInlines`) may instead join a run to `run`'s delimiter, or start
it with the other character.

      private delimiterRuns(pieces: List<InlinePiece>, run: Int): List<Int> {
        let n = pieces.length;
        let runs = new ListBuilder<Int>();
        for (var i = 0; i < n; i += 1) { runs.add(0); }
        var i = 0;
        while (i < n) {
          if (!(pieces[i] is DelimitedPiece)) {
            i += 1;
            continue;
          }
          var j = i;
          while (j < n && pieces[j] is DelimitedPiece) { j += 1; }
          let flip = chains < 30 && ((attempt >> chains) & 1) == 1;
          chains += 1;
          let chosen = chainRuns(pieces, i, j, run, flip);
          for (var k = i; k < j; k += 1) { runs.set(k, chosen[k - i]); }
          i = j;
        }
        runs.toList()
      }

The characters for the run of neighboring emphasis `pieces[i]` to
`pieces[j - 1]`, alternating; `flip` takes the other choice.

      private chainRuns(pieces: List<InlinePiece>, i: Int, j: Int, run: Int, flip: Boolean): List<Int> {
        let n = pieces.length;
        let result = new ListBuilder<Int>();
        let atStart = i == 0 && run != 0;
        let atEnd = j == n && run != 0;
        var c = if (atEnd && !(flip && atStart)) {
          let last = if (flip) { run } else { otherRun(run) };
          if ((j - 1 - i) % 2 == 0) { last } else { otherRun(last) }
        } else if (atStart) {
          if (flip) { run } else { otherRun(run) }
        } else {
          let first = pieces[i] as DelimitedPiece orelse panic();
          let star = isOpen(char'*', first.strong) && !isOpen(char'_', first.strong);
          if (star != flip) { char'_' } else { char'*' }
        };
        for (var k = i; k < j; k += 1) {
          result.add(c);
          c = otherRun(c);
        }
        result.toList()
      }

      private isOpen(c: Int, strong: Boolean): Boolean {
        let key = c * 4 + (if (strong) { 2 } else { 1 });
        for (var i = 0; i < open.length; i += 1) {
          if (open[i] == key) { return true; }
        }
        false
      }

Writes `text`, escaped. The flags say what's around it:
`firstInEmphasis`, `lastInSequence` (where trailing blanks would
drop), `afterDelimiter` and `beforeDelimiter` (where a letter or digit
would keep a delimiter from flanking), `beforeLink` (where `!` would
make an image), and `headingEnd` (where `#`s would close the heading).

      private writeText(
        text: String, firstInEmphasis: Boolean, afterDelimiter: Boolean, lastInSequence: Boolean,
        beforeDelimiter: Boolean, beforeLink: Boolean, headingEnd: Boolean,
      ): Void {
        let end = text.end;
        let blockStart = lineStart && context == paragraphContext;
        var hashes = end;
        if (headingEnd) {
          while (hashes > String.begin && text[text.prev(hashes)] == char'#') { hashes = text.prev(hashes); }
        }
        var ordered = end;
        if (blockStart) {
          var i = String.begin;
          var digits = 0;
          while (text.hasIndex(i) && isAsciiDigit(text[i]) && digits < 10) {
            i = text.next(i);
            digits += 1;
          }
          if (digits > 0 && digits < 10 && text.hasIndex(i) && (text[i] == char'.' || text[i] == char')')) {
            ordered = i;
          }
        }
        var runStart = String.begin;
        for (var i = String.begin; text.hasIndex(i); i = text.next(i)) {
          let c = text[i];
          let next = text.next(i);
          let isFirst = i == String.begin;
          let isLast = next >= end;
          var escaped = c == char'\\' || c == char'`' || c == char'*' || c == char'_' || c == char'[' ||
            c == char']' || c == char'<' || c == char'&' || c == char'~' ||
            (c == char'|' && context == cellContext) ||
            (isFirst && blockStart && isAsciiPunctuation(c)) || i == ordered || i == hashes ||
            (c == char'!' && isLast && beforeLink) ||
            (c == char':' && text.hasIndex(next) && text[next] == char'/') ||
            (c == char'.' && afterWww(text, i));
          var reference = c == char'@';
          if (!escaped && !reference) {
            let blank = isUnicodeWhitespace(c);
            let word = !blank && !isUnicodePunctuation(c);
            reference = (isFirst && blank && (lineStart || firstInEmphasis)) ||
              (isFirst && word && afterDelimiter) ||
              (isLast && blank && lastInSequence) ||
              (isLast && word && beforeDelimiter);
          }
          if (escaped || reference) {
            out.append(text.slice(runStart, i));
            if (escaped) {
              out.append("\\");
              runStart = i;
            } else {
              out.append("&#${c.toString()};");
              runStart = next;
            }
          }
        }
        out.append(text.slice(runStart, end));
        lineStart = false;
      }

      private writeCode(code: String): Void {
        let fence = new StringBuilder();
        let length = longestRun(code, char'`') + 1;
        for (var i = 0; i < length; i += 1) { fence.append("`"); }
        let first = code[String.begin];
        let last = code[code.prev(code.end)];
        var allSpaces = true;
        for (var i = String.begin; code.hasIndex(i); i = code.next(i)) {
          if (code[i] != char' ') { allSpaces = false; }
        }
        let pad = first == char'`' || last == char'`' || (first == char' ' && last == char' ' && !allSpaces);
        let body = if (context == cellContext) { escapedPipes(code) } else { code };
        out.append(fence.toString());
        if (pad) { out.append(" "); }
        out.append(body);
        if (pad) { out.append(" "); }
        out.append(fence.toString());
        lineStart = false;
      }
    }

    let isLinkNotImage(piece: InlinePiece?): Boolean {
      when (piece) {
        is LinkPiece -> !piece.image;
        else -> false;
      }
    }

    let otherRun(c: Int): Int { if (c == char'*') { char'_' } else { char'*' } }

Whether the `.` at `i` follows `www`, in any case, which GFM would
read as an extended autolink.

    let afterWww(text: String, i: StringIndex): Boolean {
      var at = i;
      for (var k = 0; k < 3; k += 1) {
        if (at <= String.begin) { return false; }
        at = text.prev(at);
        let c = text[at];
        if (c != char'w' && c != char'W') { return false; }
      }
      true
    }

    let escapedPipes(code: String): String {
      if (longestRun(code, char'|') == 0) { return code; }
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; code.hasIndex(i); i = code.next(i)) {
        if (code[i] == char'|') {
          out.append(code.slice(runStart, i));
          out.append("\\");
          runStart = i;
        }
      }
      out.append(code.slice(runStart, code.end));
      out.toString()
    }

Line breaks in a URL percent-encoded, as rendering would write them,
since a destination can't hold them.

    let encodedLines(url: String): String {
      if (!hasLineBreak(url)) { return url; }
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; url.hasIndex(i); i = url.next(i)) {
        let c = url[i];
        if (c == char'\n' || c == char'\r') {
          out.append(url.slice(runStart, i));
          out.append(if (c == char'\n') { "%0A" } else { "%0D" });
          runStart = url.next(i);
        }
      }
      out.append(url.slice(runStart, url.end));
      out.toString()
    }

A link title's text for between `"`s: backslashes before `\`, `"`,
and `&` where it would start a character reference.

    let escapeTitle(title: String): String {
      let out = new StringBuilder();
      var runStart = String.begin;
      for (var i = String.begin; title.hasIndex(i); i = title.next(i)) {
        let c = title[i];
        if (
          c == char'\\' || c == char'"' ||
          (c == char'&' && characterReferenceEnd(title, i, title.end) != i)
        ) {
          out.append(title.slice(runStart, i));
          out.append("\\");
          runStart = i;
        }
      }
      out.append(title.slice(runStart, title.end));
      out.toString()
    }

## Tests

`escapeHtml` comes from render.temper.md's import, as above.

    test("MarkdownBuilder writes a document") {
      let b = new MarkdownBuilder();
      b.heading(1, Inlines.empty.text("Release *notes*")) orelse panic();
      b.paragraph(
        Inlines.empty.text("Read ").strong(Inlines.empty.link(
          Inlines.empty.text("the docs"), new LinkTarget("https://example.com/a b"), "Docs",
        )).text(", then `run` it.").lineBreak().text("1. Not a list"),
      );
      b.codeBlock("sh", "make\r\nmake ```test```");
      let item = new MarkdownBuilder();
      item.paragraph(Inlines.empty.text("one"));
      let quote = new MarkdownBuilder();
      quote.paragraph(Inlines.empty.emphasis(Inlines.empty.text("quoted")));
      quote.thematicBreak();
      let second = new MarkdownBuilder();
      second.paragraph(Inlines.empty.code("x"));
      second.blockQuote(quote);
      b.bulletList([item, second]);
      b.bulletList([item]);
      b.orderedList(9, [item, item]) orelse panic();
      let expected = [
        "# Release \\*notes\\*\n",
        "Read **[the docs](<https://example.com/a b> \"Docs\")**, then \\`run\\` it.\\\n1\\. Not a list\n",
        "````sh\nmake\nmake ```test```\n````\n",
        "- one\n- `x`\n\n  > *quoted*\n  >\n  > ***\n",
        "+ one\n",
        "9. one\n10. one\n",
      ].join("\n") { (s: String): String => s };
      assert(b.toMarkdown() == expected) { b.toMarkdown() };
      let doc = b.toDocument();
      assert(doc.headings[0].text == "Release *notes*") { doc.headings[0].text };
      let paragraph = doc.children[2] as Paragraph orelse panic();
      assert(paragraph.text == "Read the docs, then `run` it.\n1. Not a list") { paragraph.text };
      assert(doc.links[0].destination?.url == "https://example.com/a b") { "destination" };
      assert(doc.links[0].title == "Docs") { "title" };
      assert(doc.codeBlocks[0].code == "make\nmake ```test```\n") { doc.codeBlocks[0].code };
      let lists = doc.blocks.filter { (block: BlockChild): Boolean => block is ListBlock };
      assert(lists.length == 3) { lists.length.toString() };
      let ordered = lists[2] as ListBlock orelse panic();
      assert(ordered.start == 9 && ordered.items.length == 2) { "ordered" };
      assert(!(lists[0] as ListBlock orelse panic()).tight) { "a block quote after a paragraph" };
      let empty = new MarkdownBuilder();
      empty.paragraph(Inlines.empty.lineBreak().emphasis(Inlines.empty));
      assert(empty.toMarkdown() == "") { empty.toMarkdown() };
      var bubbled = false;
      b.heading(7, Inlines.empty) orelse do { bubbled = true; };
      assert(bubbled) { "level 7 bubbles" };
    }

Hostile strings, each put everywhere text goes, read back as written
(line breaks as spaces), and render as plain text.

    let plainLine(text: String): String { spacedLines(text) }

    test("MarkdownBuilder: hostile text reads back as written") {
      let hostile = [
        "*", "_", "**a**", "`", "``a``", "[a](b)", "[a]", "]", "<b>", "<http://x.y>", "&amp;", "&#42;",
        "# h", "#", "a #", "a ##", "1. x", "1) x", "+ x", "- x", "> q", "=", "---", "***", "___",
        "    code", "\tx", " a ", "a\\", "\\", "\\*", "a\nb", "a\r\nb\rc", "x  \ny", "~~s~~", "| a | b |",
        "-|-", ":-:", "www.x.com", "http://x.com", "a@b.co", "[^n]", "![i](s)", "a*b*c", "a_b_c",
        "foo*", "*foo", "!", "é*é", "* * *", "```", "~~~", "[x]: /u", "<!-- c -->", "&", "a\u{a0}",
        "",
      ];
      for (var i = 0; i < hostile.length; i += 1) {
        let s = hostile[i];
        let want = plainLine(s);
        let b = new MarkdownBuilder();
        b.heading(2, Inlines.empty.text(s)) orelse panic();
        b.paragraph(Inlines.empty.text(s));
        b.paragraph(Inlines.empty.text("x").emphasis(Inlines.empty.text(s)).text("y"));
        b.paragraph(Inlines.empty.strong(Inlines.empty.text(s)));
        b.paragraph(Inlines.empty.text("a").lineBreak().text(s).lineBreak().text(s));
        b.paragraph(Inlines.empty.code(s).text(s));
        b.paragraph(Inlines.empty.text(s).link(Inlines.empty.text(s), new LinkTarget(s), s).text(s));
        b.paragraph(Inlines.empty.image(s, new LinkTarget(s)));
        b.codeBlock(s, s);
        let markdown = b.toMarkdown();
        let parsers = [MarkdownParser.commonMark, MarkdownParser.gfm];
        for (var p = 0; p < parsers.length; p += 1) {
          let doc = parsers[p].parse(markdown);
          let blocks = doc.children.filter { (block: BlockChild): Boolean => !(block is BlankLine) };
          let what = "${s} in ${markdown}";
          let paragraphCount = if (s.isEmpty) { 4 } else { 7 };
          assert(blocks.length == paragraphCount + 2) { what };
          assert(doc.headings[0].text == want) { what };
          let html = doc.toHtml();
          let e = escapeHtml(want);
          if (!s.isEmpty) {
            let start = "<h2>${e}</h2>\n<p>${e}</p>\n<p>x<em>${e}</em>y</p>\n<p><strong>${e}</strong></p>\n";
            assert(html.split("<p>a<br />")[0] == start) {
              "${what}: ${html}"
            };
            let breaks = blocks[4] as Paragraph orelse panic();
            assert(breaks.text == "a\n${want}\n${want}") { "${what}: ${breaks.text}" };
            let code = blocks[5] as Paragraph orelse panic();
            assert((code.children[0] as CodeSpan orelse panic()).code == want) { what };
            assert(code.text == "${want}${want}") { what };
            let link = doc.links[0];
            assert(link.text == want) { what };
            assert(link.destination?.url == encodedLines(s)) { what };
            assert(link.title == want) { what };
            let linked = blocks[6] as Paragraph orelse panic();
            assert(linked.children.length >= 1 && linked.text == "${want}${want}${want}") { what };
            let image = (blocks[7] as Paragraph orelse panic()).children[0] as Image orelse panic();
            assert(image.alt == want && image.destination?.url == encodedLines(s)) { what };
          }
          let block = doc.codeBlocks[0];
          let info = (spacedLines(s).split(" ").filter { (w: String): Boolean => !w.isEmpty })
            .join(" ") { (w: String): String => w };
          assert(block.info == info || block.info.isEmpty == info.isEmpty) { "${what}: ${block.info}" };
          let code = normalizedLines(s);
          let codeWant = if (code.isEmpty || lastCodeOf(code) == char'\n') { code } else { "${code}\n" };
          assert(block.code == codeWant) { "${what}: ${block.code}" };
        }
      }
    }

Random inline trees from a small generator, so the test is the same
every run.

    class Random {
      public var seed: Int;
      public constructor(seed: Int) { this.seed = seed; }
      public below(n: Int): Int {
        seed = (seed * 75 + 74) % 65537;
        let r = seed % n orelse panic();
        r
      }
    }

    let fuzzWords = [
      "a", "b", " ", "  ", "*", "_", "`", "``", "[", "]", "<", ">", "#", "1.", "\\", "\n", "&", "!", "~",
      "|", "-", "+", "=", "@", "www", ".", ":", "/", "\t", "é", "(", ")", "\"", "amp;", "&#32;", "'",
    ];

    let randomText(random: Random): String {
      let out = new StringBuilder();
      let n = 1 + random.below(5);
      for (var i = 0; i < n; i += 1) { out.append(fuzzWords[random.below(fuzzWords.length)]); }
      out.toString()
    }

Emphasis never holds emphasis of its own kind here, at any depth: that
can meet a delimiter that both opens and closes, which `writeInlines`
retries but can't always avoid (see the README).

    let randomInlines(random: Random, depth: Int, inEmphasis: Boolean, inStrong: Boolean): Inlines {
      var inlines = Inlines.empty;
      let n = random.below(5);
      for (var i = 0; i < n; i += 1) {
        let kind = random.below(if (depth < 3) { 10 } else { 4 });
        inlines = when (kind) {
          0, 1 -> inlines.text(randomText(random));
          2 -> inlines.code(randomText(random));
          3 -> inlines.lineBreak();
          4, 5 -> if (inEmphasis) { inlines } else {
            inlines.emphasis(randomInlines(random, depth + 1, true, inStrong))
          };
          6, 7 -> if (inStrong) { inlines } else {
            inlines.strong(randomInlines(random, depth + 1, inEmphasis, true))
          };
          8 -> inlines.link(randomInlines(random, depth + 1, inEmphasis, inStrong), new LinkTarget(randomText(random)));
          else -> inlines.image(randomText(random), new LinkTarget(randomText(random)), randomText(random));
        };
      }
      inlines
    }

    test("MarkdownBuilder: random inline content parses back as built") {
      let random = new Random(1);
      for (var round = 0; round < 400; round += 1) {
        let inlines = randomInlines(random, 0, false, false);
        let b = new MarkdownBuilder();
        b.paragraph(inlines);
        let markdown = b.toMarkdown();
        let want = shapeOfPieces(preparedPieces(inlines.pieces, paragraphContext));
        let parsers = [MarkdownParser.commonMark, MarkdownParser.gfm];
        for (var p = 0; p < parsers.length; p += 1) {
          let doc = parsers[p].parse(markdown);
          let got = new StringBuilder();
          let blocks = doc.children;
          if (!blocks.isEmpty) {
            assert(blocks.length == 1 && blocks[0] is Paragraph) { markdown };
            shapeOfViews((blocks[0] as Paragraph orelse panic()).children, got);
          }
          assert(joinedText(got.toString()) == want) {
            "${markdown}\n got ${joinedText(got.toString())}\nwant ${want}"
          };
        }
      }
    }
