# Source text

Text to parse, indexed by code point, so parsers can look ahead and
slice by plain `Int` positions, and spans count the same way in every
language (not UTF-16 units in JavaScript and C#, nor bytes in Rust and
Python's C API). Slices come from the original string, so they're
exactly as written, even for text that isn't valid Unicode, such as a
lone surrogate.

    export class SourceText {
      public text: String;
      private codes: List<Int>;
      private indices: List<StringIndex>;

      public constructor(text: String) {
        this.text = text;
        let codes = new ListBuilder<Int>();
        let indices = new ListBuilder<StringIndex>();
        var i = String.begin;
        while (text.hasIndex(i)) {
          codes.add(text[i]);
          indices.add(i);
          i = text.next(i);
        }
        indices.add(text.end);
        this.codes = codes.toList();
        this.indices = indices.toList();
      }

The length in code points.

      public get length(): Int { codes.length }

The code point at `at`, or -1 outside the text.

      public codeAt(at: Int): Int {
        if (at < 0 || at >= codes.length) { -1 } else { codes[at] }
      }

The text from `start` to `end`, in code points, exactly as written.

      public slice(start: Int, end: Int): String {
        text.slice(indices[start], indices[end])
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
    }

    test("escaping and lowercasing") {
      let escaped = escapeHtml("a<b>&\"c\"é");
      assert(escaped == "a&lt;b&gt;&amp;&quot;c&quot;é") { escaped };
      assert(asciiLowercase("DiV-É") == "div-É") { asciiLowercase("DiV-É") };
    }
