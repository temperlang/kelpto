# Testing against the spec

Each example renders with raw HTML trusted, since the spec expects raw
HTML passed through as written; kelpto-md's default escapes it.

    let { MarkdownRenderer, parseMarkdown } = import("../../kelpto-md");

An example passes when its HTML is exactly the spec's.

    let passes(example: SpecExample): Boolean {
      let doc = parseMarkdown(example.markdown);
      new MarkdownRenderer().withRawHtmlTrusted().render(doc) == example.html
    }

Counts by section, as `Section: passed/total`, blocks first.

    let report(examples: List<SpecExample>): String {
      let sections = new ListBuilder<String>();
      let passed = new ListBuilder<Int>();
      let totals = new ListBuilder<Int>();
      let blockFlags = new ListBuilder<Boolean>();
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        var at = -1;
        for (var j = 0; j < sections.length; j += 1) {
          if (sections[j] == example.section) { at = j; }
        }
        if (at < 0) {
          at = sections.length;
          sections.add(example.section);
          passed.add(0);
          totals.add(0);
          blockFlags.add(example.isBlock);
        }
        totals.set(at, totals[at] + 1);
        if (passes(example)) { passed.set(at, passed[at] + 1); }
      }
      let out = new StringBuilder();
      for (var pass = 0; pass < 2; pass += 1) {
        let blocks = pass == 0;
        var sumPassed = 0;
        var sumTotal = 0;
        out.append(if (blocks) { "Block sections:\n" } else { "Inline sections:\n" });
        for (var j = 0; j < sections.length; j += 1) {
          if (blockFlags[j] == blocks) {
            out.append("  ${sections[j]}: ${passed[j].toString()}/${totals[j].toString()}\n");
            sumPassed += passed[j];
            sumTotal += totals[j];
          }
        }
        out.append("  All: ${sumPassed.toString()}/${sumTotal.toString()}\n");
      }
      out.toString()
    }

## Tests

Every example passes. Logs the counts for every section.

    test("CommonMark spec: every example renders as the spec says") {
      let examples = specExamples();
      console.log(report(examples));
      let failures = new ListBuilder<String>();
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        if (!passes(example)) { failures.add(example.number.toString()); }
      }
      assert(failures.isEmpty) {
        "examples failing: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }

Every example roundtrips, inline ones included.

    test("CommonMark spec: every example roundtrips") {
      let examples = specExamples();
      let failures = new ListBuilder<String>();
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        if (parseMarkdown(example.markdown).asWritten != example.markdown) {
          failures.add(example.number.toString());
        }
      }
      assert(failures.isEmpty) {
        "examples not roundtripping: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }

Every example also roundtrips, and renders without failing, when
changed: with `\r\n` or `\r` line endings, its lines in a block quote
or list item, or tabs for leading spaces.

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
      [crlf.toString(), cr.toString(), quoted.toString(), listed.toString(), tabbed.toString()]
    }

    test("CommonMark spec: changed examples roundtrip") {
      let examples = specExamples();
      let failures = new ListBuilder<String>();
      var rendered = 0;
      for (var i = 0; i < examples.length; i += 1) {
        let changed = variants(examples[i].markdown);
        for (var j = 0; j < changed.length; j += 1) {
          let text = changed[j];
          let doc = parseMarkdown(text);
          if (!doc.toHtml().isEmpty) { rendered += 1; }
          if (doc.asWritten != text) {
            failures.add("${examples[i].number.toString()}/${j.toString()}");
          }
        }
      }
      assert(failures.isEmpty && rendered > 0) {
        "changed examples not roundtripping: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }
