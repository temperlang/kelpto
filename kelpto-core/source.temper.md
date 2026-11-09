# Text helpers

What both parsers need of text. They read their source by
`StringIndex`, so nothing is decoded, and spans count code points the
same way in every language (not UTF-16 units in JavaScript and C#, nor
bytes in Rust and Python's C API).

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
      // Found natively first (`str.find` in Python), as most text has
      // nothing to escape.
      if (
        !(text.indexOf("&") is StringIndex) && !(text.indexOf("<") is StringIndex) &&
        !(text.indexOf(">") is StringIndex) && !(text.indexOf("\"") is StringIndex)
      ) {
        return text;
      }
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

    test("escaping and lowercasing") {
      let escaped = escapeHtml("a<b>&\"c\"é");
      assert(escaped == "a&lt;b&gt;&amp;&quot;c&quot;é") { escaped };
      assert(asciiLowercase("DiV-É") == "div-É") { asciiLowercase("DiV-É") };
    }
