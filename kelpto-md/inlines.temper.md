# Inlines

The second phase of CommonMark's parsing: the inlines of each paragraph
and heading, by the spec's algorithm, as its reference implementation,
cmark, runs it: one pass left to right, with a stack of delimiter runs
(`*` and `_`) and one of brackets (`[` and `![`), then emphasis matched
by the spec's "process emphasis" procedure.

    let {
      caseFold, characterReferenceEnd, decodeCharacterReference, isUnicodePunctuation,
      isUnicodeWhitespace,
    } = import("../kelpto-core");

Everything stays as written. The parser gives a tree of items, each a
range of the content (a token's text) or a node holding items, and
`TreeWriter` writes them as green tokens and nodes:

- **Delimiter runs** are text, and emphasis takes from them only the
  `*` or `_` it uses, as `EmphasisMarker` tokens, so `***a**` is a `*`
  of text, then `Strong`.
- **Links and images** keep their brackets, the parentheses, whitespace,
  destination, and title of an inline link, or the label of a
  reference, as tokens, and their text as inline nodes.
- **Character references** keep their text; their value is a view.

It's linear in the input, even on the spec's pathological cases (deep
nesting, and many `*`, `_`, `[`, backticks, or unclosed HTML): openers
are searched with the spec's `openers_bottom`, link openers are
deactivated all at once, and searches for a closing backtick run or
HTML end that once failed aren't repeated.

## Link labels

How CommonMark matches a link's label to a definition's: Unicode case
folded, with the whitespace at each end removed and runs of whitespace
inside made one space. `"Foo\n  BAR "` and `"foo bar"` match.

    export let normalizeLabel(label: String): String {
      let source = new SourceText(caseFold(label));
      let out = new StringBuilder();
      var space = false;
      var any = false;
      for (var i = 0; i < source.length; i += 1) {
        let c = source.codeAt(i);
        if (isAsciiWhitespace(c)) {
          space = true;
        } else {
          if (space && any) { out.append(" "); }
          space = false;
          any = true;
          out.append(source.slice(i, i + 1));
        }
      }
      out.toString()
    }

Text with CommonMark's backslash escapes and character references
resolved, as destinations, titles, and info strings read.

    let resolveText(text: String): String {
      let source = new SourceText(text);
      let out = new StringBuilder();
      var i = 0;
      while (i < source.length) {
        let c = source.codeAt(i);
        if (c == char'\\' && isAsciiPunctuation(source.codeAt(i + 1))) {
          out.append(source.slice(i + 1, i + 2));
          i += 2;
        } else if (c == char'&') {
          let end = characterReferenceEnd(source, i, source.length);
          if (end > i) {
            out.append(decodeCharacterReference(source.slice(i, end)));
            i = end;
          } else {
            out.append("&");
            i += 1;
          }
        } else {
          out.append(source.slice(i, i + 1));
          i += 1;
        }
      }
      out.toString()
    }

The value of a character reference as written.

    let referenceValue(written: String): String { decodeCharacterReference(written) }

## The parser

Items live in parallel lists, indexed by number, rather than as
objects, so emphasis can splice them in place cheaply and no backend
has to manage cycles. Item 0 is the root, the `InlineContent` node.

    class InlineParser {
      private text: SourceText;
      private start: Int;
      private end: Int;
      private labels: Mapped<String, Boolean>;

GFM's inline extensions, and whether this is a table cell's content.

      private strikethrough: Boolean;
      private autolinks: Boolean;
      private footnotes: Boolean;
      private inCell: Boolean;

Whether this is a GFM document, parsed with any extension on, where
`![^` is never an image, footnotes or not, as cmark-gfm reads it.

      private gfm: Boolean;

Each item's kind; its range, or -1 for a node; whether it groups into
a `Text` node; its first and last children; and its siblings.

      public kinds: ListBuilder<Kind> = new ListBuilder<Kind>();
      public starts: ListBuilder<Int> = new ListBuilder<Int>();
      public ends: ListBuilder<Int> = new ListBuilder<Int>();
      public textual: ListBuilder<Boolean> = new ListBuilder<Boolean>();
      public firsts: ListBuilder<Int> = new ListBuilder<Int>();
      public lasts: ListBuilder<Int> = new ListBuilder<Int>();
      public nexts: ListBuilder<Int> = new ListBuilder<Int>();
      public prevs: ListBuilder<Int> = new ListBuilder<Int>();

The delimiter stack, a list linked through `delimiterPrevs` and
`delimiterNexts`, by number, so later delimiters have higher numbers:
each run's text item, its character, its length as written (for the
rule of 3), and whether it can open and close emphasis.

      private delimiterItems: ListBuilder<Int> = new ListBuilder<Int>();
      private delimiterChars: ListBuilder<Int> = new ListBuilder<Int>();
      private delimiterLengths: ListBuilder<Int> = new ListBuilder<Int>();
      private canOpen: ListBuilder<Boolean> = new ListBuilder<Boolean>();
      private canClose: ListBuilder<Boolean> = new ListBuilder<Boolean>();
      private delimiterPrevs: ListBuilder<Int> = new ListBuilder<Int>();
      private delimiterNexts: ListBuilder<Int> = new ListBuilder<Int>();
      private var lastDelimiter: Int = -1;

The bracket stack: each `[` or `![`'s text item, whether it's an
image's, the delimiter on top when it was pushed, where its text
starts, and whether a bracket came after it. Link openers below
`activeFrom` are inactive: once a link is made, no link opener before
it can make another, since links can't nest.

      private bracketItems: ListBuilder<Int> = new ListBuilder<Int>();
      private bracketImages: ListBuilder<Boolean> = new ListBuilder<Boolean>();
      private bracketDelimiters: ListBuilder<Int> = new ListBuilder<Int>();
      private bracketTextStarts: ListBuilder<Int> = new ListBuilder<Int>();
      private bracketAfter: ListBuilder<Boolean> = new ListBuilder<Boolean>();
      private var activeFrom: Int = 0;

Searches that failed, so they aren't repeated: for each length, where
the last backtick run of that length starts (filled in on the first
code span), and from where no HTML comment, processing instruction,
declaration, or CDATA section closes.

      private backtickRuns: ListBuilder<Int> = new ListBuilder<Int>();
      private var backticksScanned: Boolean = false;
      private var noCommentEnd: Int = -1;
      private var noInstructionEnd: Int = -1;
      private var noDeclarationEnd: Int = -1;
      private var noCdataEnd: Int = -1;

Where the content's line breaks are, found the first time a footnote
reference might span one.

      private newlines: ListBuilder<Int> = new ListBuilder<Int>();
      private var newlinesScanned: Boolean = false;

The start of plain text not yet in an item.

      private var pending: Int;

      public constructor(
        text: SourceText, start: Int, end: Int, labels: Mapped<String, Boolean>,
        strikethrough: Boolean, autolinks: Boolean, footnotes: Boolean, inCell: Boolean,
        gfm: Boolean,
      ) {
        this.text = text;
        this.start = start;
        this.end = end;
        this.labels = labels;
        this.strikethrough = strikethrough;
        this.autolinks = autolinks;
        this.footnotes = footnotes;
        this.inCell = inCell;
        this.gfm = gfm;
        this.pending = start;
        newNode(inlineContentKind);
      }

### Items

      private newItem(kind: Kind, start: Int, end: Int, textual: Boolean): Int {
        let item = kinds.length;
        kinds.add(kind);
        starts.add(start);
        ends.add(end);
        this.textual.add(textual);
        firsts.add(-1);
        lasts.add(-1);
        nexts.add(-1);
        prevs.add(-1);
        item
      }

      private newNode(kind: Kind): Int { newItem(kind, -1, -1, false) }

      private append(parent: Int, item: Int): Void {
        let last = lasts[parent];
        if (last < 0) {
          firsts.set(parent, item);
        } else {
          nexts.set(last, item);
          prevs.set(item, last);
        }
        lasts.set(parent, item);
      }

Appends a token to `parent`, unless it's empty.

      private token(parent: Int, kind: Kind, start: Int, end: Int, textual: Boolean): Int {
        if (start >= end) { return -1; }
        let item = newItem(kind, start, end, textual);
        append(parent, item);
        item
      }

A node of `kind` holding one token.

      private wrapped(kind: Kind, tokenKind: Kind, start: Int, end: Int): Void {
        let node = newNode(kind);
        append(0, node);
        token(node, tokenKind, start, end, false);
      }

Whether `item` is plain text starting at `at`, or empty, so the writer
can join it to the plain text before.

      public isContiguousPlain(item: Int, at: Int): Boolean {
        if (starts[item] != at || !textual[item]) { return false; }
        starts[item] == ends[item] || kinds[item].id == plainKind.id
      }

Plain text from `pending` to `at` becomes an item.

      private flush(at: Int): Void {
        token(0, plainKind, pending, at, true);
        pending = at;
      }

      private codeAt(at: Int): Int { if (at < end) { text.codeAt(at) } else { -1 } }

### The pass

      public parse(): Void {
        var i = start;
        while (i < end) {
          let c = text.codeAt(i);
          let next = when (c) {
            char'\\' -> backslash(i);
            char'\n' -> lineBreak(i);
            char'`' -> backticks(i);
            char'<' -> angleBracket(i);
            char'&' -> ampersand(i);
            char'*', char'_' -> delimiterRun(i, c);
            char'[' -> openBracket(i, i + 1, false);
            char'!' -> if (codeAt(i + 1) == char'[' && !(gfm && codeAt(i + 2) == char'^')) {
              openBracket(i, i + 2, true)
            } else {
              i + 1
            };
            char']' -> closeBracket(i);
            char'~' -> if (strikethrough) { tildeRun(i) } else { i + 1 };
            char':' -> if (autolinks) { urlAutolink(i) } else { i + 1 };
            char'w' -> if (autolinks) { wwwAutolink(i) } else { i + 1 };
            else -> i + 1;
          };
          i = next;
        }
        flush(end);
        processEmphasis(-1);
        if (autolinks) { emailAutolinks(0); }
      }

A backslash escapes ASCII punctuation, and before a line ending makes a
hard break. Otherwise it's text.

      private backslash(i: Int): Int {
        let c = codeAt(i + 1);
        if (inCell && (c == char'|' || (c == char'\\' && codeAt(i + 2) == char'|'))) {

In a table cell, GFM drops a backslash before `|` before reading
inlines, so `\|` is a `|`, and `\\|` an escaped `|`. Either way the
backslashes are a `PipeEscape` and the `|` is text.

          let close = if (c == char'|') { i + 1 } else { i + 2 };
          flush(i);
          token(0, pipeEscapeKind, i, close, true);
          pending = close;
          return close;
        }
        if (c == char'\n') {
          flush(i);
          let node = newNode(hardBreakKind);
          append(0, node);
          token(node, hardBreakMarkerKind, i, i + 1, false);
          token(node, whitespaceKind, i + 1, i + 2, false);
          pending = i + 2;
          return i + 2;
        }
        if (isAsciiPunctuation(c)) {
          flush(i);
          token(0, escapeKind, i, i + 2, true);
          pending = i + 2;
          return i + 2;
        }
        i + 1
      }

A line ending: a hard break after two or more spaces, or else a soft
break. Either way the spaces and tabs before it are layout, not text,
and so is the next line's prefix and indentation, which `emit` writes
with the line ending.

      private lineBreak(i: Int): Int {
        let spaceStart = trimBlanksBack(text, pending, i);
        flush(spaceStart);
        if (i - spaceStart >= 2 && text.codeAt(i - 1) == char' ' && text.codeAt(i - 2) == char' ') {
          let node = newNode(hardBreakKind);
          append(0, node);
          token(node, hardBreakMarkerKind, spaceStart, i, false);
          token(node, whitespaceKind, i, i + 1, false);
        } else {
          token(0, whitespaceKind, spaceStart, i + 1, true);
        }
        pending = i + 1;
        i + 1
      }

A code span, if a backtick run of the same length closes it; else the
run is text.

      private backticks(i: Int): Int {
        var runEnd = i;
        while (runEnd < end && text.codeAt(runEnd) == char'`') { runEnd += 1; }
        let count = runEnd - i;
        let close = if (hasBacktickRunAfter(count, runEnd)) {
          closingBackticks(text, runEnd, end, count)
        } else {
          -1
        };
        if (close < 0) { return runEnd; }
        flush(i);
        let node = newNode(codeSpanKind);
        append(0, node);
        token(node, backticksKind, i, runEnd, false);
        codeText(node, runEnd, close);
        token(node, backticksKind, close, close + count, false);
        pending = close + count;
        close + count
      }

A code span's code: one token, but in a table cell, each backslash
before `|` is a `PipeEscape`, which the code leaves out.

      private codeText(node: Int, from: Int, to: Int): Void {
        var at = from;
        if (inCell) {
          for (var k = from; k + 1 < to; k += 1) {
            if (text.codeAt(k) == char'\\' && text.codeAt(k + 1) == char'|') {
              token(node, codeTextKind, at, k, false);
              token(node, pipeEscapeKind, k, k + 1, false);
              at = k + 1;
            }
          }
        }
        token(node, codeTextKind, at, to, false);
      }

Whether a run of exactly `count` backticks starts at or after `from`,
from the last start of each length, found in one pass the first time.

      private hasBacktickRunAfter(count: Int, from: Int): Boolean {
        if (!backticksScanned) {
          backticksScanned = true;
          var i = start;
          while (i < end) {
            if (text.codeAt(i) == char'`') {
              var j = i;
              while (j < end && text.codeAt(j) == char'`') { j += 1; }
              let length = j - i;
              while (backtickRuns.length <= length) { backtickRuns.add(-1); }
              backtickRuns.set(length, i);
              i = j;
            } else {
              i += 1;
            }
          }
        }
        count < backtickRuns.length && backtickRuns[count] >= from
      }

At `<`: an autolink, or raw HTML, or else text.

      private angleBracket(i: Int): Int {
        let autolink = autolinkEnd(text, i, end);
        if (autolink > i) {
          flush(i);
          let node = newNode(autolinkKind);
          append(0, node);
          token(node, angleBracketKind, i, i + 1, false);
          token(node, autolinkTextKind, i + 1, autolink - 1, false);
          token(node, angleBracketKind, autolink - 1, autolink, false);
          pending = autolink;
          return autolink;
        }
        let html = rawHtmlEnd(i);
        if (html > i) {
          flush(i);
          token(0, rawHtmlKind, i, html, false);
          pending = html;
          return html;
        }
        i + 1
      }

The end of the raw HTML starting at `at`, or `at`: an open or closing
tag, a comment, a processing instruction, a declaration, or a CDATA
section, as CommonMark defines them. A search for an end that failed
once fails from anywhere after, so it isn't repeated.

      private rawHtmlEnd(at: Int): Int {
        let c = codeIn(text, at + 1, end);
        if (c == char'/') { return closingTagEnd(text, at, end); }
        if (c == char'?') {
          if (noInstructionEnd >= 0 && at >= noInstructionEnd) { return at; }
          let close = findText(at + 2, "?>");
          if (close < 0) { noInstructionEnd = at; return at; }
          return close + 2;
        }
        if (c == char'!') {
          if (startsWithText(text, at, end, "<!--")) {
            if (codeIn(text, at + 4, end) == char'>') { return at + 5; }
            if (startsWithText(text, at + 4, end, "->")) { return at + 6; }
            if (noCommentEnd >= 0 && at >= noCommentEnd) { return at; }
            let close = findText(at + 4, "-->");
            if (close < 0) { noCommentEnd = at; return at; }
            return close + 3;
          }
          if (startsWithText(text, at, end, "<![CDATA[")) {
            if (noCdataEnd >= 0 && at >= noCdataEnd) { return at; }
            let close = findText(at + 9, "]]>");
            if (close < 0) { noCdataEnd = at; return at; }
            return close + 3;
          }
          if (isAsciiAlpha(codeIn(text, at + 2, end))) {
            if (noDeclarationEnd >= 0 && at >= noDeclarationEnd) { return at; }
            let close = findText(at + 3, ">");
            if (close < 0) { noDeclarationEnd = at; return at; }
            return close + 1;
          }
          return at;
        }
        openTagEnd(text, at, end)
      }

Where `target`, ASCII, first appears from `from`, or -1.

      private findText(from: Int, target: String): Int {
        let first = target[String.begin];
        for (var i = from; i < end; i += 1) {
          if (text.codeAt(i) == first && startsWithText(text, i, end, target)) { return i; }
        }
        -1
      }

At `&`: a character reference, or else text.

      private ampersand(i: Int): Int {
        let close = characterReferenceEnd(text, i, end);
        if (close < 0) { return i + 1; }
        flush(i);
        wrapped(characterReferenceKind, referenceTextKind, i, close);
        pending = close;
        close
      }

### Emphasis

A run of `*` or `_` is text, and goes on the delimiter stack if it can
open or close emphasis, by the spec's flanking rules, with Unicode
whitespace and punctuation. The start and end of the content count as
whitespace.

      private delimiterRun(i: Int, c: Int): Int {
        var runEnd = i;
        while (runEnd < end && text.codeAt(runEnd) == c) { runEnd += 1; }
        let before = if (i > 0) { text.codeAt(i - 1) } else { char'\n' };
        let after = if (runEnd < end) { text.codeAt(runEnd) } else { char'\n' };
        let beforeSpace = isUnicodeWhitespace(before);
        let afterSpace = isUnicodeWhitespace(after);
        let beforePunctuation = isUnicodePunctuation(before);
        let afterPunctuation = isUnicodePunctuation(after);
        let leftFlanking = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
        let rightFlanking = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
        var opens = leftFlanking;
        var closes = rightFlanking;
        if (c == char'_') {
          opens = leftFlanking && (!rightFlanking || beforePunctuation);
          closes = rightFlanking && (!leftFlanking || afterPunctuation);
        }
        flush(i);
        let item = token(0, plainKind, i, runEnd, true);
        pending = runEnd;
        if (opens || closes) { pushDelimiter(item, c, runEnd - i, opens, closes); }
        runEnd
      }

      private pushDelimiter(item: Int, c: Int, length: Int, opens: Boolean, closes: Boolean): Void {
        let d = delimiterItems.length;
        delimiterItems.add(item);
        delimiterChars.add(c);
        delimiterLengths.add(length);
        canOpen.add(opens);
        canClose.add(closes);
        delimiterPrevs.add(lastDelimiter);
        delimiterNexts.add(-1);
        if (lastDelimiter >= 0) { delimiterNexts.set(lastDelimiter, d); }
        lastDelimiter = d;
      }

GFM's strikethrough: a run of `~`, read 100 at a time as cmark-gfm
does, flanking as `*` is, goes on the delimiter stack if it's one or
two long.

      private tildeRun(i: Int): Int {
        var runEnd = i;
        while (runEnd < end && runEnd - i < 100 && text.codeAt(runEnd) == char'~') { runEnd += 1; }
        let before = if (i > 0) { text.codeAt(i - 1) } else { char'\n' };
        let after = if (runEnd < end) { text.codeAt(runEnd) } else { char'\n' };
        let beforeSpace = isUnicodeWhitespace(before);
        let afterSpace = isUnicodeWhitespace(after);
        let beforePunctuation = isUnicodePunctuation(before);
        let afterPunctuation = isUnicodePunctuation(after);
        let opens = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
        let closes = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
        flush(i);
        let item = token(0, plainKind, i, runEnd, true);
        pending = runEnd;
        if ((opens || closes) && runEnd - i <= 2) { pushDelimiter(item, char'~', runEnd - i, opens, closes); }
        runEnd
      }

      private removeDelimiter(d: Int): Void {
        let prev = delimiterPrevs[d];
        let next = delimiterNexts[d];
        if (prev >= 0) { delimiterNexts.set(prev, next); }
        if (next >= 0) { delimiterPrevs.set(next, prev); } else { lastDelimiter = prev; }
      }

      private delimiterLeft(d: Int): Int {
        let item = delimiterItems[d];
        ends[item] - starts[item]
      }

The spec's "process emphasis", for the delimiters above `bottom` (a
delimiter's number, or -1 for all). For each closer, the nearest
opener that matches; `openersBottom` remembers, for each kind of
closer, where a search found none, so no search covers the same
openers twice. Kinds of closer: its character, whether it can also
open, and its length mod 3. Strikethrough's `~` runs match by the same
rules.

      private processEmphasis(bottom: Int): Void {
        let openersBottom = new ListBuilder<Int>();
        for (var k = 0; k < 18; k += 1) { openersBottom.add(bottom + 1); }
        var closer = -1;
        var candidate = lastDelimiter;
        while (candidate > bottom) {
          closer = candidate;
          candidate = delimiterPrevs[candidate];
        }
        while (closer >= 0) {
          if (canClose[closer]) {
            let c = delimiterChars[closer];
            let index = (if (c == char'*') { 0 } else if (c == char'_') { 6 } else { 12 }) +
              (if (canOpen[closer]) { 3 } else { 0 }) + delimiterLengths[closer] % 3;
            var opener = delimiterPrevs[closer];
            var found = false;
            while (opener >= openersBottom[index]) {
              if (canOpen[opener] && delimiterChars[opener] == c) {
                let both = canOpen[closer] || canClose[opener];
                let sum = delimiterLengths[opener] + delimiterLengths[closer];
                if (!both || delimiterLengths[closer] % 3 == 0 || sum % 3 != 0) {
                  found = true;
                  break;
                }
              }
              opener = delimiterPrevs[opener];
            }
            let oldCloser = closer;
            if (found && c == char'~') {
              closer = insertStrikethrough(opener, closer);
            } else if (found) {
              closer = insertEmphasis(opener, closer);
            } else {
              closer = delimiterNexts[closer];
              openersBottom.set(index, oldCloser);
              if (!canOpen[oldCloser]) { removeDelimiter(oldCloser); }
            }
          } else {
            closer = delimiterNexts[closer];
          }
        }
        while (lastDelimiter > bottom) { removeDelimiter(lastDelimiter); }
      }

Wraps what's between `opener` and `closer` in emphasis, strong if both
have two or more left, with markers taken from the inner end of each
run. Gives the closer to look at next.

      private insertEmphasis(opener: Int, closer: Int): Int {
        let use = if (delimiterLeft(opener) >= 2 && delimiterLeft(closer) >= 2) { 2 } else { 1 };
        wrap(opener, closer, use, if (use == 2) { strongKind } else { emphasisKind }, emphasisMarkerKind)
      }

Strikethrough, if the runs are the same length, taking all of each as
markers; if not, neither makes anything, as in cmark-gfm. Either way
they and the delimiters between them go.

      private insertStrikethrough(opener: Int, closer: Int): Int {
        let length = delimiterLengths[closer];
        if (delimiterLengths[opener] == length) {
          return wrap(opener, closer, length, strikethroughKind, strikethroughMarkerKind);
        }
        let next = delimiterNexts[closer];
        var d = closer;
        while (d >= 0 && d != opener) {
          let prev = delimiterPrevs[d];
          removeDelimiter(d);
          d = prev;
        }
        removeDelimiter(opener);
        next
      }

Wraps what's between `opener` and `closer` in a node of `kind`, with
`use` of each run as markers of `markerKind`.

      private wrap(opener: Int, closer: Int, use: Int, kind: Kind, markerKind: Kind): Int {
        let openItem = delimiterItems[opener];
        let closeItem = delimiterItems[closer];
        var between = delimiterPrevs[closer];
        while (between >= 0 && between != opener) {
          let prev = delimiterPrevs[between];
          removeDelimiter(between);
          between = prev;
        }
        let node = newNode(kind);
        let openEnd = ends[openItem];
        ends.set(openItem, openEnd - use);
        let closeStart = starts[closeItem];
        starts.set(closeItem, closeStart + use);
        let openMarker = newItem(markerKind, openEnd - use, openEnd, false);
        let closeMarker = newItem(markerKind, closeStart, closeStart + use, false);
        let first = nexts[openItem];
        let last = prevs[closeItem];
        firsts.set(node, openMarker);
        lasts.set(node, closeMarker);
        if (first == closeItem) {
          nexts.set(openMarker, closeMarker);
          prevs.set(closeMarker, openMarker);
        } else {
          nexts.set(openMarker, first);
          prevs.set(first, openMarker);
          nexts.set(last, closeMarker);
          prevs.set(closeMarker, last);
        }
        nexts.set(openItem, node);
        prevs.set(node, openItem);
        nexts.set(node, closeItem);
        prevs.set(closeItem, node);
        if (delimiterLeft(opener) == 0) { removeDelimiter(opener); }
        if (delimiterLeft(closer) == 0) {
          let next = delimiterNexts[closer];
          removeDelimiter(closer);
          return next;
        }
        closer
      }

### Extended autolinks

GFM's extended autolinks, as cmark-gfm finds them. At `:`, a URL: its
scheme, the letters just before, `http`, `https`, or `ftp`, then `//`
and a character that can start a host. At `w`, a domain starting
`www.`, at the start or after whitespace, `*`, `_`, `~`, or `(`, with
at least one dot. Neither inside brackets, which could still make a
link. Each runs to the next whitespace or `<`, less trailing
punctuation (see `autolinkTrim`), and is written as is: its scheme
letters, `*`, backslashes, and the rest are all link text. Email
addresses are found later, in text (see `emailAutolinks`).

      private urlAutolink(i: Int): Int {
        if (!bracketItems.isEmpty || end - i < 4 || codeAt(i + 1) != char'/' || codeAt(i + 2) != char'/') {
          return i + 1;
        }
        var schemeStart = i;
        while (schemeStart > start && isAsciiAlpha(text.codeAt(schemeStart - 1))) { schemeStart -= 1; }
        let scheme = asciiLowercase(text.slice(schemeStart, i));
        if (
          schemeStart < pending || !(scheme == "http" || scheme == "https" || scheme == "ftp") ||
          !isHostChar(text.codeAt(i + 3))
        ) {
          return i + 1;
        }
        let domain = domainEnd(text, i + 3, end, true);
        if (domain < 0) { return i + 1; }
        let linkEnd = autolinkTrim(text, i, linkRunEnd(domain));
        if (linkEnd <= i) { return i + 1; }
        extendedAutolink(urlAutolinkKind, schemeStart, linkEnd)
      }

      private wwwAutolink(i: Int): Int {
        if (!bracketItems.isEmpty || end - i < 4 || text.slice(i, i + 4) != "www.") { return i + 1; }
        if (i > start) {
          let before = text.codeAt(i - 1);
          if (
            !(before == char'*' || before == char'_' || before == char'~' || before == char'(' ||
              before == 0 || isCmarkSpace(before))
          ) {
            return i + 1;
          }
        }
        let domain = domainEnd(text, i, end, false);
        if (domain < 0) { return i + 1; }
        let linkEnd = autolinkTrim(text, i, linkRunEnd(domain));
        if (linkEnd <= i) { return i + 1; }
        extendedAutolink(wwwAutolinkKind, i, linkEnd)
      }

From `from` to the next whitespace or `<`.

      private linkRunEnd(from: Int): Int {
        var i = from;
        while (i < end && !isCmarkSpace(text.codeAt(i)) && text.codeAt(i) != char'<') { i += 1; }
        i
      }

      private extendedAutolink(kind: Kind, from: Int, to: Int): Int {
        flush(from);
        let node = newNode(kind);
        append(0, node);
        token(node, autolinkTextKind, from, to, false);
        pending = to;
        to
      }

Email addresses, after the rest, in each run of text outside links and
images, as cmark-gfm finds them once a paragraph is parsed (see
`findEmails`). A run is plain text and backslash escapes, as GFM reads
them, so `a\_b@example.com` is one address. Each becomes an
`EmailAutolink` holding the run's tokens.

      private emailAutolinks(parent: Int): Void {
        var item = firsts[parent];
        while (item >= 0) {
          var next = nexts[item];
          if (starts[item] < 0) {
            let id = kinds[item].id;
            if (id == emphasisKind.id || id == strongKind.id || id == strikethroughKind.id) {
              emailAutolinks(item);
            }
          } else if (isRunText(item)) {
            var last = item;
            while (nexts[last] >= 0 && isRunText(nexts[last])) { last = nexts[last]; }
            next = nexts[last];
            linkEmails(parent, item, last);
          }
          item = next;
        }
      }

      private isRunText(item: Int): Boolean {
        let id = kinds[item].id;
        starts[item] >= 0 && textual[item] && (id == plainKind.id || id == escapeKind.id)
      }

The emails in the run of items from `first` to `last`, as nodes in
their place.

      private linkEmails(parent: Int, first: Int, last: Int): Void {
        var any = false;
        for (var k = starts[first]; k < ends[last]; k += 1) {
          if (text.codeAt(k) == char'@') { any = true; break; }
        }
        if (!any) { return; }

The run as GFM reads it, escapes resolved, with where each code point
starts.

        let read = new StringBuilder();
        let positions = new ListBuilder<Int>();
        var item = first;
        while (true) {
          let s = starts[item];
          if (kinds[item].id == escapeKind.id) {
            read.append(text.slice(s + 1, s + 2));
            positions.add(s);
          } else {
            read.append(text.slice(s, ends[item]));
            for (var k = s; k < ends[item]; k += 1) { positions.add(k); }
          }
          if (item == last) { break; }
          item = nexts[item];
        }
        let found = findEmails(new SourceText(read.toString()));
        if (found.isEmpty) { return; }
        let linkStarts = new ListBuilder<Int>();
        let linkEnds = new ListBuilder<Int>();
        for (var k = 0; k < found.length; k += 2) {
          linkStarts.add(positions[found[k]]);
          linkEnds.add(if (found[k + 1] < positions.length) { positions[found[k + 1]] } else { ends[last] });
        }

The new items: text outside the links, and a node for each.

        let out = new ListBuilder<Int>();
        var j = 0;
        var node = -1;
        item = first;
        while (true) {
          let s = starts[item];
          let e = ends[item];
          let escape = kinds[item].id == escapeKind.id;
          var at = s;
          while (at < e) {
            if (j < linkStarts.length && at >= linkStarts[j]) {
              let stop = if (escape) { e } else { minInt(e, linkEnds[j]) };
              if (node < 0) {
                node = newNode(emailAutolinkKind);
                out.add(node);
              }
              append(node, newItem(if (escape) { escapeKind } else { autolinkTextKind }, at, stop, false));
              at = stop;
              if (at >= linkEnds[j]) {
                node = -1;
                j += 1;
              }
            } else {
              let stop = if (escape || j >= linkStarts.length) { e } else { minInt(e, linkStarts[j]) };
              out.add(newItem(if (escape) { escapeKind } else { plainKind }, at, stop, true));
              at = stop;
            }
          }
          if (item == last) { break; }
          item = nexts[item];
        }
        let before = prevs[first];
        let after = nexts[last];
        for (var k = 0; k < out.length; k += 1) {
          prevs.set(out[k], if (k > 0) { out[k - 1] } else { before });
          nexts.set(out[k], if (k + 1 < out.length) { out[k + 1] } else { after });
        }
        if (before >= 0) { nexts.set(before, out[0]); } else { firsts.set(parent, out[0]); }
        if (after >= 0) { prevs.set(after, out[out.length - 1]); } else { lasts.set(parent, out[out.length - 1]); }
      }

### Links and images

A `[`, or `![` for an image, is text, and goes on the bracket stack.

      private openBracket(i: Int, textStart: Int, image: Boolean): Int {
        flush(i);
        let item = token(0, plainKind, i, textStart, true);
        pending = textStart;
        if (!bracketAfter.isEmpty) { bracketAfter.set(bracketAfter.length - 1, true); }
        bracketItems.add(item);
        bracketImages.add(image);
        bracketDelimiters.add(lastDelimiter);
        bracketTextStarts.add(textStart);
        bracketAfter.add(false);
        textStart
      }

      private popBracket(): Void {
        bracketItems.removeLast();
        bracketImages.removeLast();
        bracketDelimiters.removeLast();
        bracketTextStarts.removeLast();
        bracketAfter.removeLast();
        if (activeFrom > bracketItems.length) { activeFrom = bracketItems.length; }
      }

At `]`: a link or image, if the last bracket is active and what
follows makes one: an inline destination and title in parentheses, or
a label (full, `[label]`, collapsed, `[]`, or the text itself) that a
definition has. Else `]` is text.

      private closeBracket(i: Int): Int {
        let b = bracketItems.length - 1;
        if (b < 0) { return i + 1; }
        let image = bracketImages[b];
        if (!image && b < activeFrom) {
          popBracket();
          return i + 1;
        }
        let after = i + 1;
        if (codeAt(after) == char'(') {
          let destinationStart = skipSpaceAndLineEnding(after + 1);
          let destinationEnd = if (codeAt(destinationStart) == char')') {
            destinationStart
          } else {
            linkDestinationEnd(text, destinationStart)
          };
          if (destinationEnd >= 0 && destinationEnd <= end) {
            let titleStart = skipSpaceAndLineEnding(destinationEnd);
            var titleEnd = -1;
            if (titleStart > destinationEnd) { titleEnd = linkTitleEnd(text, titleStart); }
            if (titleEnd > end) { titleEnd = -1; }
            let close = if (titleEnd >= 0) { skipSpaceAndLineEnding(titleEnd) } else { titleStart };
            if (codeAt(close) == char')') {
              let node = makeLink(b, i);
              token(node, openParenKind, after, after + 1, false);
              token(node, whitespaceKind, after + 1, destinationStart, false);
              token(node, linkDestinationKind, destinationStart, destinationEnd, false);
              if (titleEnd >= 0) {
                token(node, whitespaceKind, destinationEnd, titleStart, false);
                let title = newNode(linkTitleKind);
                append(node, title);
                token(title, titleTextKind, titleStart, titleEnd, false);
                token(node, whitespaceKind, titleEnd, close, false);
              } else {
                token(node, whitespaceKind, destinationEnd, close, false);
              }
              token(node, closeParenKind, close, close + 1, false);
              return finishLink(b, close + 1);
            }
          }
        }
        let labelEnd = referenceLabelEnd(after);
        var label = "";
        var hasLabel = false;
        var labelTokenEnd = after;
        if (labelEnd > after) {
          labelTokenEnd = labelEnd;
          label = text.slice(after + 1, labelEnd - 1);
          hasLabel = true;
        }
        if ((!hasLabel || normalizeLabel(label).isEmpty) && !bracketAfter[b]) {
          let textStart = bracketTextStarts[b];
          label = if (i - textStart <= 999) { text.slice(textStart, i) } else { "" };
          hasLabel = true;
        }
        let normalized = if (hasLabel) { normalizeLabel(label) } else { "" };
        if (!normalized.isEmpty && labels.has(normalized)) {
          let node = makeLink(b, i);
          if (labelTokenEnd > after) {
            let labelNode = newNode(linkLabelKind);
            append(node, labelNode);
            token(labelNode, labelTextKind, after, labelTokenEnd, false);
          }
          return finishLink(b, labelTokenEnd);
        }
        if (footnotes && isFootnoteReference(b, i)) { return footnoteReference(b, i); }
        popBracket();
        i + 1
      }

### GFM's footnote references

With footnotes on, a `[` that makes no link is a footnote reference if
`^` and something more follow it, as cmark-gfm reads them: its label
is the text up to `]` as written, whatever markup it holds, and it's a
reference whether or not a definition has that label. The renderer
shows one without a definition as that text. As in any GFM document,
an image can't start `![^`, so `![^1]` is `!` and a reference.

Two choices differ from cmark-gfm 0.29.0.gfm.13, whose results there
lose or garble text: the `^` must be written as is, not escaped or a
character reference, and a reference can't span a line break.

      private isFootnoteReference(b: Int, close: Int): Boolean {
        let textStart = bracketTextStarts[b];
        if (bracketImages[b] || text.codeAt(textStart) != char'^' || close <= textStart + 1) {
          return false;
        }
        if (!newlinesScanned) {
          newlinesScanned = true;
          for (var k = start; k < end; k += 1) {
            if (text.codeAt(k) == char'\n') { newlines.add(k); }
          }
        }
        var low = 0;
        var high = newlines.length;
        while (low < high) {
          let middle = (low + high) / 2;
          if (newlines[middle] < textStart) { low = middle + 1; } else { high = middle; }
        }
        low >= newlines.length || newlines[low] > close
      }

The reference for bracket `b`, closed by the `]` at `close`: its `[^`,
its label as one token, and the `]`. What was parsed inside goes, and
so do the delimiters there, as cmark-gfm drops them.

      private footnoteReference(b: Int, close: Int): Int {
        flush(close);
        let opener = bracketItems[b];
        while (lastDelimiter > bracketDelimiters[b]) { removeDelimiter(lastDelimiter); }
        let node = newNode(footnoteReferenceKind);
        let before = prevs[opener];
        prevs.set(node, before);
        if (before >= 0) { nexts.set(before, node); } else { firsts.set(0, node); }
        lasts.set(0, node);
        let open = starts[opener];
        kinds.set(opener, footnoteOpenKind);
        textual.set(opener, false);
        ends.set(opener, open + 2);
        prevs.set(opener, -1);
        nexts.set(opener, -1);
        firsts.set(node, opener);
        lasts.set(node, opener);
        token(node, labelTextKind, open + 2, close, false);
        token(node, linkCloseKind, close, close + 1, false);
        popBracket();
        pending = close + 1;
        close + 1
      }

Past spaces, tabs, and at most one line ending (a paragraph has no
blank lines, so at most one is there anyway).

      private skipSpaceAndLineEnding(from: Int): Int {
        var i = from;
        while (i < end && isAsciiWhitespace(text.codeAt(i))) { i += 1; }
        i
      }

The end of a link label `[…]` at `at`, after its `]`, or -1: no
unescaped brackets, and at most 999 code points inside.

      private referenceLabelEnd(at: Int): Int {
        if (codeAt(at) != char'[') { return -1; }
        var i = at + 1;
        while (i < end) {
          let c = text.codeAt(i);
          if (c == char'[') { return -1; }
          if (c == char']') { return i + 1; }
          if (c == char'\\' && isAsciiPunctuation(codeAt(i + 1))) { i += 2; } else { i += 1; }
          if (i - at > 1000) { return -1; }
        }
        -1
      }

Makes the link or image for bracket `b`, closed by the `]` at `close`:
a node in the bracket's place holding the bracket, the text after it,
and the `]`. Gives the node, to add the rest to.

      private makeLink(b: Int, close: Int): Int {
        flush(close);
        let opener = bracketItems[b];
        let image = bracketImages[b];
        let node = newNode(if (image) { imageKind } else { linkKind });
        kinds.set(opener, if (image) { imageOpenKind } else { linkOpenKind });
        textual.set(opener, false);
        let before = prevs[opener];
        prevs.set(node, before);
        if (before >= 0) { nexts.set(before, node); } else { firsts.set(0, node); }
        firsts.set(node, opener);
        lasts.set(node, lasts[0]);
        prevs.set(opener, -1);
        lasts.set(0, node);
        token(node, linkCloseKind, close, close + 1, false);
        node
      }

Emphasis inside the link's text, then the bracket goes; after a link,
every link opener before it is inactive.

      private finishLink(b: Int, next: Int): Int {
        processEmphasis(bracketDelimiters[b]);
        let image = bracketImages[b];
        popBracket();
        if (!image) { activeFrom = bracketItems.length; }
        pending = next;
        next
      }
    }

## Autolinks

The end of the autolink starting with the `<` at `at`, after its `>`,
or -1: a URI (a scheme of 2 to 32 letters, digits, `+`, `.`, and `-`,
starting with a letter, then `:` and no spaces, controls, `<`, or
`>`), or an email address.

    let autolinkEnd(text: SourceText, at: Int, end: Int): Int {
      if (codeIn(text, at, end) != char'<') { return -1; }
      let uri = uriAutolinkEnd(text, at + 1, end);
      if (uri >= 0) { return uri; }
      emailAutolinkEnd(text, at + 1, end)
    }

    let uriAutolinkEnd(text: SourceText, from: Int, end: Int): Int {
      if (!isAsciiAlpha(codeIn(text, from, end))) { return -1; }
      var i = from + 1;
      while (i < end && i - from <= 32) {
        let c = text.codeAt(i);
        if (!(isAsciiAlphanumeric(c) || c == char'+' || c == char'.' || c == char'-')) { break; }
        i += 1;
      }
      let scheme = i - from;
      if (scheme < 2 || scheme > 32 || codeIn(text, i, end) != char':') { return -1; }
      i += 1;
      while (i < end) {
        let c = text.codeAt(i);
        if (c == char'>') { return i + 1; }
        if (c <= 0x20 || c == char'<' || c == 0x7F) { return -1; }
        i += 1;
      }
      -1
    }

An email address, as the HTML standard's "valid email address" (but
for its length limits).

    let emailAutolinkEnd(text: SourceText, from: Int, end: Int): Int {
      var i = from;
      while (i < end && isEmailLocal(text.codeAt(i))) { i += 1; }
      if (i == from || codeIn(text, i, end) != char'@') { return -1; }
      i += 1;
      while (true) {
        let labelStart = i;
        while (i < end && i - labelStart < 63 && (isAsciiAlphanumeric(text.codeAt(i)) || text.codeAt(i) == char'-')) {
          i += 1;
        }
        let length = i - labelStart;
        if (length == 0 || text.codeAt(labelStart) == char'-' || text.codeAt(i - 1) == char'-') { return -1; }
        let c = codeIn(text, i, end);
        if (c == char'>') { return i + 1; }
        if (c != char'.') { return -1; }
        i += 1;
      }
      -1
    }

    let isEmailLocal(c: Int): Boolean {
      isAsciiAlphanumeric(c) || (
        c == char'.' || c == char'!' || c == char'#' || c == char'$' || c == char'%' ||
        c == char'&' || c == char'\'' || c == char'*' || c == char'+' || c == char'/' ||
        c == char'=' || c == char'?' || c == char'^' || c == char'_' || c == char'`' ||
        c == char'{' || c == char'|' || c == char'}' || c == char'~' || c == char'-'
      )
    }

## Extended autolinks

cmark-gfm's rules, kept exactly, odd corners and all, since GitHub
renders by them.

Whitespace as cmark's `cmark_isspace` reads it: space, tab, and line
endings.

    let isCmarkSpace(c: Int): Boolean {
      c == char' ' || c == char'\t' || c == char'\n' || c == char'\r'
    }

Whether `c` can be in a host: not whitespace or punctuation. cmark-gfm
counts only Unicode's punctuation (P), not its symbols (S), as
punctuation beyond ASCII; kelpto-core's table has both, so the common
symbol blocks (currency, letterlike, arrows, math, technical, shapes,
dingbats, and emoji) and Latin-1's symbols count as host characters
here.

    let isHostChar(c: Int): Boolean {
      if (c < 0x80) { return !isAsciiWhitespace(c) && !isAsciiPunctuation(c); }
      if (isUnicodeWhitespace(c)) { return false; }
      !isUnicodePunctuation(c) || isSymbolish(c)
    }

    let isSymbolish(c: Int): Boolean {
      (c >= 0x20A0 && c <= 0x20CF) || (c >= 0x2100 && c <= 0x2BFF) || (c >= 0x1F000 && c <= 0x1FBFF) ||
        (c >= 0xA2 && c <= 0xA6) || c == 0xA8 || c == 0xA9 || c == 0xAC || (c >= 0xAE && c <= 0xB1) ||
        c == 0xB4 || c == 0xB8 || c == 0xD7 || c == 0xF7
    }

The end of a domain starting at `at`, or -1, as cmark-gfm's
`check_domain` finds it: host characters, `-`, `_`, and `.`, with a
backslash skipping what follows, stopping before the last code point
of the content, or at any beyond ASCII. Underscores in the last two
parts make it no domain, unless it has more than 10 dots (so the check
stays linear). Unless `allowShort`, it needs a dot.

    let domainEnd(text: SourceText, at: Int, end: Int, allowShort: Boolean): Int {
      var dots = 0;
      var underscoresBefore = 0;
      var underscores = 0;
      let size = end - at;
      var i = 1;
      while (i < size - 1) {
        if (text.codeAt(at + i) == char'\\' && i < size - 2) { i += 1; }
        let c = text.codeAt(at + i);
        if (c == char'_') {
          underscores += 1;
        } else if (c == char'.') {
          underscoresBefore = underscores;
          underscores = 0;
          dots += 1;
        } else if (c >= 0x80 || (!isHostChar(c) && c != char'-')) {
          break;
        }
        i += 1;
      }
      if ((underscoresBefore > 0 || underscores > 0) && dots <= 10) { return -1; }
      if (allowShort || dots > 0) { at + i } else { -1 }
    }

The end of a link from `from` to `to` without what cmark-gfm's
`autolink_delim` trims: anything from a `<`, then from the end, `?`,
`!`, `.`, `,`, `:`, `*`, `_`, `~`, `'`, `"`, a `)` without a `(` to
match, or what looks like a character reference (`&amp;`).

    let autolinkTrim(text: SourceText, from: Int, to: Int): Int {
      var linkEnd = to;
      var opening = 0;
      var closing = 0;
      for (var i = from; i < linkEnd; i += 1) {
        let c = text.codeAt(i);
        if (c == char'<') {
          linkEnd = i;
          break;
        }
        if (c == char'(') { opening += 1; }
        if (c == char')') { closing += 1; }
      }
      while (linkEnd > from) {
        let c = text.codeAt(linkEnd - 1);
        if (c == char')') {
          if (closing <= opening) { return linkEnd; }
          closing -= 1;
          linkEnd -= 1;
        } else if (
          c == char'?' || c == char'!' || c == char'.' || c == char',' || c == char':' ||
          c == char'*' || c == char'_' || c == char'~' || c == char'\'' || c == char'"'
        ) {
          linkEnd -= 1;
        } else if (c == char';') {
          var reference = linkEnd - 2;
          while (reference > from && isAsciiAlpha(text.codeAt(reference))) { reference -= 1; }
          if (reference >= from && reference < linkEnd - 2 && text.codeAt(reference) == char'&') {
            linkEnd = reference;
          } else {
            linkEnd -= 1;
          }
        } else {
          return linkEnd;
        }
      }
      linkEnd
    }

The email addresses in `text`, a run of text as GFM reads it, as
pairs of start and end, by cmark-gfm's `postprocess_text`: at each
`@`, back over letters, digits, `.`, `+`, `-`, and `_` (and a
`mailto:` or `xmpp:` not right after a letter or digit), and on over
letters, digits, `-`, `_`, and `.` before a letter or digit (and `/`
after `xmpp:`), with at least one such dot, ending in a letter; a
second `@` starts again from it. Linear: each search starts past the
last.

    let findEmails(text: SourceText): List<Int> {
      let found = new ListBuilder<Int>();
      var begin = 0;
      var offset = 0;
      var remaining = text.length;
      while (offset < remaining) {
        var at = -1;
        for (var k = begin + offset; k < begin + remaining; k += 1) {
          if (text.codeAt(k) == char'@') {
            at = k;
            break;
          }
        }
        if (at < 0) { break; }
        var maxRewind = at - (begin + offset);
        var autoMailto = true;
        var isXmpp = false;
        var dots = 0;
        var rewind = 0;
        var linkEnd = 0;
        var retry = true;
        var skip = false;
        while (retry) {
          retry = false;
          let atPos = begin + offset + maxRewind;
          rewind = 0;
          while (rewind < maxRewind) {
            let c = text.codeAt(atPos - rewind - 1);
            if (isAsciiAlphanumeric(c) || c == char'.' || c == char'+' || c == char'-' || c == char'_') {
              rewind += 1;
            } else if (c == char':' && validProtocol(text, "mailto:", atPos, rewind, maxRewind)) {
              autoMailto = false;
              rewind += 1;
            } else if (c == char':' && validProtocol(text, "xmpp:", atPos, rewind, maxRewind)) {
              autoMailto = false;
              isXmpp = true;
              rewind += 1;
            } else {
              break;
            }
          }
          if (rewind == 0) {
            offset += maxRewind + 1;
            skip = true;
          } else {
            let limit = remaining - offset - maxRewind;
            linkEnd = 1;
            while (linkEnd < limit) {
              let c = text.codeAt(atPos + linkEnd);
              if (c == char'@') {
                offset += maxRewind + 1;
                maxRewind = linkEnd - 1;
                retry = true;
                break;
              }
              if (c == char'.' && linkEnd < limit - 1 && isAsciiAlphanumeric(text.codeAt(atPos + linkEnd + 1))) {
                dots += 1;
              } else if (
                !isAsciiAlphanumeric(c) && !(c == char'/' && isXmpp) && c != char'-' && c != char'_'
              ) {
                break;
              }
              linkEnd += 1;
            }
          }
        }
        if (!skip) {
          let atPos = begin + offset + maxRewind;
          let lastCode = text.codeAt(atPos + linkEnd - 1);
          if (linkEnd < 2 || dots == 0 || (!isAsciiAlpha(lastCode) && lastCode != char'.')) {
            offset += maxRewind + linkEnd;
          } else {
            linkEnd = autolinkTrim(text, atPos, atPos + linkEnd) - atPos;
            if (linkEnd == 0) {
              offset += maxRewind + 1;
            } else {
              found.add(atPos - rewind);
              found.add(atPos + linkEnd);
              begin += offset + maxRewind + linkEnd;
              remaining -= offset + maxRewind + linkEnd;
              offset = 0;
            }
          }
        }
      }
      found.toList()
    }

Whether `protocol` ends at the `:` before the address's part read so
far, at the start of what's searched or after something not a letter
or digit.

    let validProtocol(text: SourceText, protocol: String, at: Int, rewind: Int, maxRewind: Int): Boolean {
      let length = protocol.countBetween(String.begin, protocol.end);
      if (length > maxRewind - rewind) { return false; }
      let from = at - rewind - length;
      if (text.slice(from, from + length) != protocol) { return false; }
      length == maxRewind - rewind || !isAsciiAlphanumeric(text.codeAt(from - 1))
    }

## Tests

    test("inline views: emphasis, links, images, and the rest") {
      let doc = parseMarkdown(
        "***a** b* [t *x*](</u r> \"T\") ![alt *i*][ref] <me@x.test> &ouml;\\\nend `c`\n\n[REF]: /img 'R'\n",
      );
      let paragraph = doc.children[0] as Paragraph orelse panic();
      let inlines = paragraph.children;
      let em = inlines[0] as Emphasis orelse panic();
      assert(em.marker == "*" && em.text == "a b") { em.text };
      let strong = em.children[0] as Strong orelse panic();
      assert(strong.marker == "**" && strong.asWritten == "**a**") { strong.asWritten };
      let link = inlines[2] as Link orelse panic();
      assert(link.style == "inline" && link.text == "t x") { link.text };
      assert(link.destination?.url == "/u r" && link.title == "T") { link.asWritten };
      assert(link.label == null && link.children.length == 2) { "inline" };
      let image = inlines[4] as Image orelse panic();
      assert(image.style == "full" && image.label == "ref" && image.alt == "alt i") { image.alt };
      assert(image.destination?.url == "/img" && image.title == "R") { "from the definition" };
      let autolink = inlines[6] as Autolink orelse panic();
      assert(autolink.isEmail && autolink.destination.url == "mailto:me@x.test") { autolink.text };
      let reference = inlines[8] as CharacterReference orelse panic();
      assert(reference.asWritten == "&ouml;" && reference.value == "ö") { reference.value };
      let hardBreak = inlines[9] as HardBreak orelse panic();
      assert(hardBreak.style == "backslash") { hardBreak.style };
      assert(paragraph.text == "a b t x alt i me@x.test ö\nend c") { paragraph.text };
      let html = doc.toHtml();
      let expected = [
        "<p><em><strong>a</strong> b</em> <a href=\"/u%20r\" title=\"T\">t <em>x</em></a> ",
        "<img src=\"/img\" alt=\"alt i\" title=\"R\" /> <a href=\"mailto:me@x.test\">me@x.test</a> ö<br />\n",
        "end <code>c</code></p>\n",
      ].join("") { (s: String): String => s };
      assert(html == expected) { html };
    }

Delimiter runs, brackets, and references stay in the tree as written:
what emphasis doesn't use is text.

    test("inlines keep every code point") {
      let doc = parseMarkdown("*a **b** [x][] [y]*\n\n[x]: /x\n[Y]: /y\n");
      let inlines = (doc.children[0] as Paragraph orelse panic()).children;
      let em = inlines[0] as Emphasis orelse panic();
      assert(em.asWritten == "*a **b** [x][] [y]*") { em.asWritten };
      let leftover = parseMarkdown("***a**\n").blocks[0] as Paragraph orelse panic();
      let first = leftover.children[0] as Text orelse panic();
      assert(first.text == "*" && leftover.children[1] is Strong) { first.text };
      let links = em.children;
      let collapsed = links[3] as Link orelse panic();
      assert(collapsed.style == "collapsed" && collapsed.label == "x") { collapsed.asWritten };
      let shortcut = links[5] as Link orelse panic();
      assert(shortcut.style == "shortcut" && shortcut.destination?.url == "/y") { shortcut.asWritten };
    }

    test("labels match by case folding and whitespace") {
      assert(normalizeLabel("  Foo\n\t BAR ") == "foo bar") { normalizeLabel("  Foo\n\t BAR ") };
      assert(normalizeLabel("ẞ") == normalizeLabel("SS")) { "full case folding" };
      let html = parseMarkdown("[ẞ] [Straße]\n\n[SS]: /ss\n[STRASSE]: /strasse\n").toHtml();
      assert(html == "<p><a href=\"/ss\">ẞ</a> <a href=\"/strasse\">Straße</a></p>\n") { html };
    }

    test("Link.withDestination changes only the destination") {
      let text = "See [a *b*](/old \"t\") and [c]().\n";
      let doc = parseMarkdown(text);
      let links = new ListBuilder<Link>();
      let inlines = (doc.children[0] as Paragraph orelse panic()).children;
      for (var i = 0; i < inlines.length; i += 1) {
        let inline = inlines[i];
        if (inline is Link) { links.add(inline); }
      }
      let edited = links[0].withDestination(new LinkTarget("/new path")) orelse panic();
      assert(edited.asWritten == "See [a *b*](</new path> \"t\") and [c]().\n") { edited.asWritten };
      let filled = links[1].withDestination(new LinkTarget("/c")) orelse panic();
      assert(filled.asWritten == "See [a *b*](/old \"t\") and [c](/c).\n") { filled.asWritten };
      assert(doc.asWritten == text) { "the old document is unchanged" };
      let reference = parseMarkdown("[r]\n\n[r]: /r\n").blocks[0] as Paragraph orelse panic();
      let bad = do { (reference.children[0] as Link orelse panic()).withDestination(new LinkTarget("/x")); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "a reference's destination is its definition's" };
    }

    test("hrefs are percent-encoded only when rendered") {
      let html = parseMarkdown("[a](<b c'ö&amp;\\>>)\n").toHtml();
      assert(html == "<p><a href=\"b%20c&#x27;%C3%B6&amp;%3E\">a</a></p>\n") { html };
      let target = (parseMarkdown("[a](<b c'ö&amp;\\>>)\n").children[0] as Paragraph orelse panic()).children[0] as Link orelse panic();
      assert(target.destination?.url == "b c'ö&>") { target.destination?.url ?? "null" };
    }

Random mixes of inline markup, from a fixed seed, so a failure repeats.
Each must roundtrip, and render without failing.

    let inlinePieces(): List<String> {
      [
        "*", "**", "_", "__", "***", "a", " ", "  \n", "\n", "\\\n", "\\*", "\\", "[", "]", "![",
        "](", ")", "(", "<", ">", "\"", "'", "`", "``", "&", "&amp;", "&#35;", "&#x;", ";",
        "<http://a.b>", "<a@b.c>", "<b>", "</b>", "<!--", "-->", "<?", "?>", "<!X", "<![CDATA[",
        "]]>", "[ref]", "[]", "/url", " \"t\"", "é", "😀", "> ", "- ", "\t", "\r\n",
        "\n\n[ref]: /u\n",
      ]
    }

    test("roundtrip: fuzzing with inline markup") {
      let pieces = inlinePieces();
      var state = 4242;
      var failures = 0;
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
        doc.toHtml();
        new MarkdownRenderer().withRawHtmlTrusted().render(doc);
        if (doc.asWritten != text) {
          failures += 1;
          if (first == "") { first = text; }
        }
      }
      assert(failures == 0) { "${failures.toString()} failed, such as ${first}" };
    }

### Pathological inputs

The shapes of the spec's appendix and cmark's pathological tests, at
sizes where a parser quadratic in them would take minutes. Each must
parse, roundtrip, and render.

    let repeated(text: String, count: Int): String {
      let out = new StringBuilder();
      for (var i = 0; i < count; i += 1) { out.append(text); }
      out.toString()
    }

Each case is made in a loop, not as constants: the Kotlin Temper
compiler, folding many big constant strings, gives up (2026-10-31).

    let pathological(k: Int, n: Int): String {
      when (k) {
        0 -> "${repeated("[", n)}a${repeated("]", n)}";
        1 -> repeated("[a ", n);
        2 -> repeated("a] ", n);
        3 -> repeated("_a ", n);
        4 -> repeated("a_ ", n);
        5 -> repeated("*a_ ", n);
        6 -> "a**b${repeated("c* ", n)}";
        7 -> repeated("[ a_", n);
        8 -> repeated("[ (](", n);
        9 -> "${repeated("[", n)}${repeated("[a](b) ", n)}";
        10 -> repeated("[a](<b", n);
        11 -> repeated("[a](b", n);
        12 -> do {
          let out = new StringBuilder();
          for (var i = 1; i < 250; i += 1) {
            out.append("e");
            out.append(repeated("`", i));
          }
          out.toString()
        };
        13 -> "</${repeated("<!--", n)}";
        14 -> repeated("<![CDATA[", n);
        15 -> "${repeated("*a **a ", 100)}b${repeated(" a** a*", 100)}";
        16 -> repeated("aaa\rbbb\n-\u{B}\n", n);
        17 -> "|${repeated("a|", n)}\n|${repeated("-|", n)}\n${repeated("b\n", n)}";
        18 -> "${repeated("a|", n)}\n${repeated("-|", n)}\n";
        19 -> repeated("www._", n);
        20 -> repeated("www.a_", n);
        21 -> repeated("http://a_.", n);
        22 -> repeated("a@", n);
        23 -> "${repeated("a.", n)}@";
        24 -> "${repeated("mailto:", n)}a@b.c";
        25 -> "${repeated("(", n)}www.a.b${repeated(")", n)}";
        26 -> repeated("~a ~~a ", n);
        27 -> repeated("[www.a.b ", n);
        28 -> "${repeated("[^", n)}a${repeated("]", n)}";
        29 -> "${repeated("[^a] ", n)}\n\n[^a]: x\n";
        30 -> "${repeated("[^a]:", n)}\n\n[^a]\n";
        31 -> "${repeated("[^a]: [^a]\n", n)}";
        32 -> repeated("![^a ![^", n);
        33 -> "${repeated("[^a", n)}\n${repeated("]", n)}";
        else -> "";
      }
    }

    test("pathological inputs stay linear") {
      for (var k = 0; k < 16; k += 1) {
        let text = pathological(k, 10000);
        let doc = parseMarkdown(text);
        assert(doc.asWritten == text) { "case ${k.toString()} roundtrips" };
        assert(!doc.toHtml().isEmpty) { "case ${k.toString()} renders" };
      }
    }

Cases 16 to 27 are GFM's: cmark-gfm's pathological table, a wide
header over many short rows (stopped by `maxFilledCells`), and
autolinks with underscores, many `@`, protocols, and parentheses. They
parse with all of GFM on, in a test of their own, as are the
footnotes' below, so each stays within JavaScript's test timeout.

    test("pathological GFM inputs stay linear") {
      for (var k = 16; k < 28; k += 1) {
        let text = pathological(k, 10000);
        let doc = MarkdownParser.gfm.parse(text);
        assert(doc.asWritten == text) { "case ${k.toString()} roundtrips" };
        assert(!doc.toHtml().isEmpty) { "case ${k.toString()} renders" };
      }
    }

Cases 28 and on are GFM's footnotes: references nested in each other,
many to one definition, definitions nested on one line, many with one
label, images that can't start with `![^`, and brackets spanning lines.

    test("pathological footnotes stay linear") {
      for (var k = 28; k < 34; k += 1) {
        let text = pathological(k, 10000);
        let doc = MarkdownParser.gfm.parse(text);
        assert(doc.asWritten == text) { "case ${k.toString()} roundtrips" };
        assert(!doc.toHtml().isEmpty) { "case ${k.toString()} renders" };
      }
    }
