# Source text

Text to parse, indexed by code point, so parsers can look ahead and
slice by plain `Int` positions, and spans count the same way in every
language (not UTF-16 units in JavaScript and C#, nor bytes in Rust and
Python's C API). Slices come from the original string, so they're
exactly as written, even for text that isn't valid Unicode, such as a
lone surrogate.

A `SourceText` can also be lines of another, joined by `\n`, as a
paragraph's inline content is: `joinLines` copies the other's decoded
code points rather than decoding the joined text again, and shares its
string indices, so slices still come from the original string.

    export class SourceText {

The string slices come from, and where each of its code points is in
it (and its end), shared by every text joined from it.

      private base: String;
      private indices: List<StringIndex>;

The code points; for a joined text, where its `\n`s are, in order, and
where each line starts in `indices`. A whole string is one line,
starting at 0.

      private codes: List<Int>;
      private joins: List<Int>;
      private bases: List<Int>;

The same code points, for `joinLines` to copy from. For a whole string,
it's the builder they were decoded into: JavaScript copies a slice of
a builder 50 to 100 times faster than one of a `List`, which it keeps
frozen; elsewhere it's as fast either way.

      private copyFrom: Listed<Int>;

Where each `\n` and `\r` is, in order: found while decoding, or a
joined text's joins, since its lines have none.

      private breaks: List<Int>;

`text` decoded whole. `joinLines` passes the rest, for text it has
already decoded; leave them out.

      public constructor(
        text: String,
        indices: List<StringIndex>? = null,
        codes: List<Int> = [],
        joins: List<Int> = [],
        bases: List<Int> = [0],
      ) {
        this.base = text;
        if (indices == null) {
          let decoded = new ListBuilder<Int>();
          let at = new ListBuilder<StringIndex>();
          let breaks = new ListBuilder<Int>();
          var i = String.begin;
          while (text.hasIndex(i)) {
            let c = text[i];
            // One comparison for nearly every code point.
            if (c <= char'\r') {
              if (c == char'\n' || c == char'\r') { breaks.add(decoded.length); }
            }
            decoded.add(c);
            at.add(i);
            i = text.next(i);
          }
          at.add(text.end);
          this.indices = at.toList();
          this.codes = decoded.toList();
          this.copyFrom = decoded;
          this.breaks = breaks.toList();
        } else {
          this.indices = indices;
          this.codes = codes;
          this.copyFrom = codes;
          this.breaks = joins;
        }
        this.joins = joins;
        this.bases = bases;
      }

The text of `ranges` of this one, each a `start` and an `end` in code
points within one line, joined by `\n`, without decoding again.

      public joinLines(ranges: List<Int>): SourceText {
        let joined = new ListBuilder<Int>();
        let joins = new ListBuilder<Int>();
        let bases = new ListBuilder<Int>();
        for (var r = 0; r < ranges.length; r += 2) {
          if (r > 0) {
            joins.add(joined.length);
            joined.add(char'\n');
          }
          let first = ranges[r];
          bases.add(indexAt(lineOf(first), first));
          if (ranges.length > 2) { addRange(joined, copyFrom, first, ranges[r + 1]); }
        }
        if (ranges.isEmpty) { bases.add(0); }
        // One line, the usual case: one slice, nothing to join.
        let joinedCodes = if (ranges.length == 2) { copyFrom.slice(ranges[0], ranges[1]) } else { joined.toList() };
        new SourceText(base, indices, joinedCodes, joins.toList(), bases.toList())
      }

The text, as a string.

      public get text(): String { slice(0, codes.length) }

The length in code points.

      public get length(): Int { codes.length }

The code point at `at`, or -1 outside the text.

      public codeAt(at: Int): Int {
        if (at < 0 || at >= codes.length) { -1 } else { codes[at] }
      }

Where each `\n` and `\r` is, in code points, in order, for splitting
into lines without another pass over the code points.

      public get lineBreaks(): List<Int> { breaks }

Where the line from `from` ends: at the first `\n` or `\r` from there,
or the end.

      public lineEnd(from: Int): Int {
        let codes = this.codes;
        var i = from;
        while (i < codes.length) {
          let c = codes[i];
          if (c == char'\n' || c == char'\r') { break; }
          i += 1;
        }
        i
      }

The text from `start` to `end`, in code points, exactly as written.

      public slice(start: Int, end: Int): String {
        let line = lineOf(start);
        if (line >= joins.length || end <= joins[line]) {
          base.slice(indices[indexAt(line, start)], indices[indexAt(line, end)])
        } else {
          joinedSlice(start, end, line)
        }
      }

A slice across lines, from `line` on. (Not an early return in `slice`,
which costs every call in Python.)

      private joinedSlice(start: Int, end: Int, firstLine: Int): String {
        let out = new StringBuilder();
        var from = start;
        var line = firstLine;
        while (line < joins.length && joins[line] < end) {
          out.append(base.slice(indices[indexAt(line, from)], indices[indexAt(line, joins[line])]));
          out.append("\n");
          from = joins[line] + 1;
          line += 1;
        }
        out.append(base.slice(indices[indexAt(line, from)], indices[indexAt(line, end)]));
        out.toString()
      }

The line holding `at`, counting a `\n` joining lines, and the end, as
the end of the line before.

      private lineOf(at: Int): Int {
        var low = 0;
        var high = joins.length;
        while (low < high) {
          let middle = (low + high) / 2;
          if (joins[middle] < at) { low = middle + 1; } else { high = middle; }
        }
        low
      }

Where `at`, on `line`, is in `indices`.

      private indexAt(line: Int, at: Int): Int {
        if (line == 0) { bases[0] + at } else { bases[line] + at - joins[line - 1] - 1 }
      }
    }

Adds `from`'s items from `start` to `end` to `to`, a few thousand at a
time: JavaScript's `addAll` spreads them into one call's arguments,
which overflows the stack past about 120,000.

    let addRange<T>(to: ListBuilder<T>, from: Listed<T>, start: Int, end: Int): Void {
      for (var at = start; at < end; at += 4096) {
        to.addAll(from.slice(at, if (end - at < 4096) { end } else { at + 4096 }));
      }
    }

Character classes both parsers need, on code points.

    export let isAsciiAlpha(c: Int): Boolean {
      (c >= char'a' && c <= char'z') || (c >= char'A' && c <= char'Z')
    }

    export let isAsciiDigit(c: Int): Boolean { c >= char'0' && c <= char'9' }

    export let isAsciiAlphanumeric(c: Int): Boolean { isAsciiAlpha(c) || isAsciiDigit(c) }

Space, tab, line feed, form feed, and carriage return, as both
CommonMark and HTML define whitespace.

    export let isAsciiWhitespace(c: Int): Boolean {
      c == char' ' || c == char'\t' || c == char'\n' || c == 0xC || c == char'\r'
    }

Escapes text for HTML: `&`, `<`, `>`, and `"`, as CommonMark's
renderer does, so it's safe in element content and quoted attribute
values.

    export let escapeHtml(text: String): String {
      let out = new StringBuilder();
      var runStart = String.begin;
      var i = String.begin;
      while (text.hasIndex(i)) {
        let c = text[i];
        let replacement = when (c) {
          char'&' -> "&amp;";
          char'<' -> "&lt;";
          char'>' -> "&gt;";
          char'"' -> "&quot;";
          else -> "";
        };
        let next = text.next(i);
        if (!replacement.isEmpty) {
          out.append(text.slice(runStart, i));
          out.append(replacement);
          runStart = next;
        }
        i = next;
      }
      out.append(text.slice(runStart, i));
      out.toString()
    }

ASCII letters lowercased, others unchanged, as HTML compares tag and
attribute names.

    export let asciiLowercase(text: String): String {
      let out = new StringBuilder();
      var runStart = String.begin;
      var i = String.begin;
      while (text.hasIndex(i)) {
        let c = text[i];
        let next = text.next(i);
        if (c >= char'A' && c <= char'Z') {
          out.append(text.slice(runStart, i));
          out.appendCodePoint(c + 32) orelse panic();
          runStart = next;
        }
        i = next;
      }
      out.append(text.slice(runStart, i));
      out.toString()
    }

## Tests

    test("source text by code point") {
      let source = new SourceText("a😀b\n");
      assert(source.length == 4) { source.length.toString() };
      assert(source.codeAt(1) == 0x1F600) { "code point" };
      assert(source.codeAt(4) == -1) { "past the end" };
      assert(source.slice(1, 3) == "😀b") { source.slice(1, 3) };
      assert(source.slice(0, 4) == "a😀b\n") { "whole" };
      assert(source.lineEnd(0) == 3 && source.lineEnd(4) == 4) { "line end" };
      let breaks = new SourceText("a\r\nb\rc\n").lineBreaks;
      assert(breaks.length == 4 && breaks[0] == 1 && breaks[1] == 2 && breaks[3] == 6) { "line breaks" };
    }

    test("lines joined from source text") {
      let source = new SourceText("> a😀b\r\n> cd\n> e");
      let joined = source.joinLines([2, 5, 9, 11, 14, 15]);
      assert(joined.length == 8) { joined.length.toString() };
      assert(joined.text == "a😀b\ncd\ne") { joined.text };
      assert(joined.codeAt(3) == char'\n' && joined.codeAt(4) == char'c') { "code points" };
      assert(joined.slice(1, 3) == "😀b") { joined.slice(1, 3) };
      assert(joined.slice(2, 3) == "b" && joined.slice(3, 3) == "") { "within a line" };
      assert(joined.slice(2, 5) == "b\nc") { joined.slice(2, 5) };
      assert(joined.slice(3, 4) == "\n" && joined.slice(4, 6) == "cd") { "around a join" };
      assert(joined.slice(0, 8) == joined.text) { "whole" };
      assert(joined.lineBreaks.length == 2 && joined.lineBreaks[1] == 6) { "joined line breaks" };
      let one = source.joinLines([9, 11]);
      assert(one.text == "cd" && one.slice(0, 1) == "c") { one.text };
      assert(source.joinLines([]).text == "") { "empty" };
    }

    test("escaping and lowercasing") {
      let escaped = escapeHtml("a<b>&\"c\"é");
      assert(escaped == "a&lt;b&gt;&amp;&quot;c&quot;é") { escaped };
      assert(asciiLowercase("DiV-É") == "div-É") { asciiLowercase("DiV-É") };
    }
