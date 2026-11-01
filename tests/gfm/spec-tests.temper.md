# Testing against GFM's examples

Each example runs as cmark-gfm's own test tools run it: the spec's
extension examples with only the extension each names, and
extensions.txt's with all of them, raw HTML trusted (as cmark-gfm's
`--unsafe`), and the disallowed raw HTML filter on where the
extensions are.

The spec's examples without an extension are CommonMark 0.29's, which
cmark-gfm reads with none on yet renders as GFM. kelpto-md renders as
GFM only a document parsed with GFM, so they're parsed with all of it,
but for those in CommonMark's Autolinks section, which show what isn't
linked without extended autolinks. As CommonMark, they're checked in
`tests/commonmark/`, at 0.31.2.

    let { MarkdownParser, MarkdownRenderer } = import("../../kelpto-md");

    let parserFor(example: GfmExample): MarkdownParser {
      let extension = example.extension;
      if (example.source == "extensions" || extension == "disabled") { return MarkdownParser.gfm; }
      if (extension == "table") { return MarkdownParser.commonMark.withTables(true); }
      if (extension == "strikethrough") { return MarkdownParser.commonMark.withStrikethrough(true); }
      if (extension == "autolink") { return MarkdownParser.commonMark.withExtendedAutolinks(true); }
      if (example.section == "Autolinks") { return MarkdownParser.gfm.withExtendedAutolinks(false); }
      MarkdownParser.gfm
    }

    let rendererFor(example: GfmExample): MarkdownRenderer {
      let trusted = new MarkdownRenderer().withRawHtmlTrusted();
      if (example.source == "extensions" || example.extension == "tagfilter") {
        trusted.withDisallowedRawHtmlFiltered()
      } else {
        trusted
      }
    }

The spec's two task list examples are disabled there, since their
HTML is normalized: they're checked against the markup cmark-gfm
writes instead, as extensions.txt has it. One example in
extensions.txt only checks that parsing doesn't fail.

    let expectedHtml(example: GfmExample): String {
      if (example.extension != "disabled") { return example.html; }
      example.html
        .split("<input checked=\"\" disabled=\"\" type=\"checkbox\">")
        .join("<input type=\"checkbox\" checked=\"\" disabled=\"\" />") { (s: String): String => s }
        .split("<input disabled=\"\" type=\"checkbox\">")
        .join("<input type=\"checkbox\" disabled=\"\" />") { (s: String): String => s }
    }

    let render(example: GfmExample): String {
      rendererFor(example).render(parserFor(example).parse(example.markdown))
    }

    let passes(example: GfmExample): Boolean {
      let html = render(example);
      example.html == "<IGNORE>\n" || html == expectedHtml(example)
    }

    let label(example: GfmExample): String {
      "${example.source} ${example.number.toString()}"
    }

Counts by extension, as `extension: passed/total`.

    let report(examples: List<GfmExample>): String {
      let names = new ListBuilder<String>();
      let passed = new ListBuilder<Int>();
      let totals = new ListBuilder<Int>();
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        let name = if (example.source == "extensions") {
          "extensions.txt (all)"
        } else if (example.extension == "") {
          "spec (CommonMark 0.29)"
        } else if (example.extension == "disabled") {
          "spec (tasklist)"
        } else {
          "spec (${example.extension})"
        };
        var at = -1;
        for (var j = 0; j < names.length; j += 1) {
          if (names[j] == name) { at = j; }
        }
        if (at < 0) {
          at = names.length;
          names.add(name);
          passed.add(0);
          totals.add(0);
        }
        totals.set(at, totals[at] + 1);
        if (passes(example)) { passed.set(at, passed[at] + 1); }
      }
      let out = new StringBuilder();
      for (var j = 0; j < names.length; j += 1) {
        out.append("  ${names[j]}: ${passed[j].toString()}/${totals[j].toString()}\n");
      }
      out.toString()
    }

## Tests

Every example passes. Logs the counts.

    test("GFM spec: every example renders as cmark-gfm does") {
      let examples = gfmExamples();
      console.log(report(examples));
      let failures = new ListBuilder<String>();
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        if (!passes(example)) { failures.add(label(example)); }
      }
      assert(failures.isEmpty) {
        "examples failing: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }

The extensions' examples pass with all of GFM on, too, as GitHub
renders them.

    test("GFM spec: extension examples render the same with all of GFM") {
      let examples = gfmExamples();
      let failures = new ListBuilder<String>();
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        let extension = example.extension;
        if (example.source == "spec" && extension != "" && extension != "tagfilter") {
          let html = rendererFor(example).render(MarkdownParser.gfm.parse(example.markdown));
          if (html != expectedHtml(example)) { failures.add(label(example)); }
        }
      }
      assert(failures.isEmpty) {
        "examples failing: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }

Every example roundtrips with all of GFM on, and so do changed ones:
with `\r\n` or `\r` line endings, in a block quote or list item, or
with tabs for leading spaces.

    let variants(markdown: String): List<String> {
      let crlf = new StringBuilder();
      let cr = new StringBuilder();
      let quoted = new StringBuilder();
      let listed = new StringBuilder();
      let tabbed = new StringBuilder();
      var lineStart = true;
      var i = String.begin;
      while (markdown.hasIndex(i)) {
        let c = markdown[i];
        let next = markdown.next(i);
        let one = markdown.slice(i, next);
        if (lineStart) {
          quoted.append("> ");
          listed.append(" -\t");
        }
        if (c == char'\n') {
          crlf.append("\r\n");
          cr.append("\r");
        } else {
          crlf.append(one);
          cr.append(one);
        }
        if (c == char' ' && lineStart) { tabbed.append("\t"); } else { tabbed.append(one); }
        quoted.append(one);
        listed.append(one);
        lineStart = c == char'\n';
        i = next;
      }
      [markdown, crlf.toString(), cr.toString(), quoted.toString(), listed.toString(), tabbed.toString()]
    }

    test("GFM spec: every example, and changed ones, roundtrip") {
      let examples = gfmExamples();
      let failures = new ListBuilder<String>();
      var rendered = 0;
      for (var i = 0; i < examples.length; i += 1) {
        let changed = variants(examples[i].markdown);
        for (var j = 0; j < changed.length; j += 1) {
          let text = changed[j];
          let doc = MarkdownParser.gfm.parse(text);
          if (!doc.toHtml().isEmpty) { rendered += 1; }
          if (doc.asWritten != text) { failures.add("${label(examples[i])}/${j.toString()}"); }
        }
      }
      assert(failures.isEmpty && rendered > 0) {
        "not roundtripping: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }
