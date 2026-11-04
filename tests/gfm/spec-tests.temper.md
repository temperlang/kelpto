# Testing against GFM's examples

Each example runs as cmark-gfm's own test tools run it: the spec's
extension examples with only the extension each names, extensions.txt's
with all of them, footnotes included, and regression.txt's with those
each names (none for most), raw HTML trusted (as cmark-gfm's
`--unsafe`), and the disallowed raw HTML filter on where the
extensions are.

The spec's examples without an extension are CommonMark 0.29's, which
cmark-gfm reads with none on yet renders as GFM. kelpto-md renders as
GFM only a document parsed with GFM, so they're parsed with all of it,
but for those in CommonMark's Autolinks section, which show what isn't
linked without extended autolinks. As CommonMark, they're checked in
`tests/commonmark/`, at 0.31.2.

    let { MarkdownDocument, MarkdownParser, MarkdownRenderer } = import("../../kelpto-md");
    let { buildHtml, ParsedRawHtml, renderSafe } = import("../../kelpto");
    let {
      BuiltComment, BuiltNode, BuiltText, Element, FragmentContext, SanitizerPolicy, parseHtmlFragment,
    } = import("../../kelpto-html");

    let parserFor(example: GfmExample): MarkdownParser {
      let extension = example.extension;
      if (example.source == "regression") {
        var parser = MarkdownParser.commonMark;
        let names = extension.split(" ");
        for (var i = 0; i < names.length; i += 1) {
          let name = names[i];
          if (name == "table") { parser = parser.withTables(true); }
          if (name == "strikethrough") { parser = parser.withStrikethrough(true); }
          if (name == "autolink") { parser = parser.withExtendedAutolinks(true); }
          if (name == "footnotes") { parser = parser.withFootnotes(true); }
        }
        return parser;
      }
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
        } else if (example.source == "regression") {
          "regression.txt"
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

## One tree, Markdown and raw HTML together

A dump of built nodes, with namespaces and attributes, for comparing
trees.

    let treeOf(nodes: List<BuiltNode>): String {
      let out = new StringBuilder();
      addTree(nodes, out);
      out.toString()
    }

    let addTree(nodes: List<BuiltNode>, out: StringBuilder): Void {
      for (var i = 0; i < nodes.length; i += 1) {
        let node = nodes[i];
        when (node) {
          is Element -> do {
            out.append("<${node.namespace}:${node.name}");
            let attributes = node.attributes;
            for (var j = 0; j < attributes.length; j += 1) {
              let a = attributes[j];
              out.append(" ${a.prefix}:${a.name}=\"${a.value}\"");
            }
            out.append(">");
            addTree(node.templateContents, out);
            out.append("|");
            addTree(node.children, out);
            out.append("</>");
          }
          is BuiltText -> out.append("\"${node.text}\"");
          is BuiltComment -> out.append("<!--${node.text}-->");
          else -> out.append(node.html);
        }
      }
    }

Whether kelpto's `buildHtml` gives the tree kelpto-html gives parsing
the rendered HTML, as a fragment in `body`, as one string.

    let sameTree(doc: MarkdownDocument, renderer: MarkdownRenderer): Boolean {
      let body = new FragmentContext("body");
      let built = treeOf(buildHtml(doc, body, renderer).children);
      built == treeOf(parseHtmlFragment(renderer.render(doc), body).children)
    }

Every example, with raw HTML parsed by kelpto, builds the tree its
HTML parses to, rendered as cmark-gfm's tools render it. Logs the
counts.

    test("GFM spec: every example builds the tree its HTML parses to") {
      let examples = gfmExamples();
      let failures = new ListBuilder<String>();
      var same = 0;
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        let doc = parserFor(example).withRawHtmlHandler(new ParsedRawHtml()).parse(example.markdown);
        if (sameTree(doc, rendererFor(example))) {
          same += 1;
        } else {
          failures.add(label(example));
        }
      }
      console.log("Same tree: ${same.toString()}/${examples.length.toString()} examples");
      assert(failures.isEmpty) {
        "examples building another tree: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }

Whether any link or image in the tree has a URL the standard policy
drops, which a safe rendering leaves out.

    let hasUnsafeUrl(nodes: List<BuiltNode>): Boolean {
      let check = SanitizerPolicy.standard.urlCheck;
      for (var i = 0; i < nodes.length; i += 1) {
        let node = nodes[i];
        if (node is Element) {
          let attributes = node.attributes;
          for (var j = 0; j < attributes.length; j += 1) {
            let a = attributes[j];
            if ((a.name == "href" || a.name == "src") && check.checkUrl(a.value, node.name, a.name) == null) { return true; }
          }
          if (hasUnsafeUrl(node.children)) { return true; }
        }
      }
      false
    }

Rendered safely (`renderSafe`), every example without raw HTML or a
link the standard policy drops gives the HTML the trusted rendering
parses to, as serialized. Logs the counts.

    test("GFM spec: examples render safely as trusted, but for raw HTML and unsafe links") {
      let examples = gfmExamples();
      let body = new FragmentContext("body");
      let failures = new ListBuilder<String>();
      var same = 0;
      var skipped = 0;
      for (var i = 0; i < examples.length; i += 1) {
        let example = examples[i];
        let doc = parserFor(example).withRawHtmlHandler(new ParsedRawHtml()).parse(example.markdown);
        let expected = parseHtmlFragment(rendererFor(example).render(doc), body);
        if (!doc.rawHtml.isEmpty || !doc.htmlBlocks.isEmpty || hasUnsafeUrl(expected.children)) {
          skipped += 1;
        } else if (renderSafe(doc).html == expected.html) {
          same += 1;
        } else {
          failures.add(label(example));
        }
      }
      console.log("Safe as trusted: ${same.toString()}/${examples.length.toString()} examples, ${skipped.toString()} with raw HTML or unsafe links");
      assert(failures.isEmpty) {
        "examples rendering otherwise: ${failures.toList().join(", ") { (s: String): String => s }}"
      };
    }
