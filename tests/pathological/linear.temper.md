# Pathological inputs

kelpto-md's linearity tests, apart from its own since they're timing
sensitive: they run with the full suite, not the quick tier (see
Kelpto's README).

    let { MarkdownParser, parseMarkdown } = import("../../kelpto-md");

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
