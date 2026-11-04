# Testing against web-platform-tests

Each test parses its input as a document and writes the tree in the
`.dat` files' dump format: a line per node, indented two spaces per
level, attributes sorted by name under their element, and a template's
contents under `content`.

    let {
      BuiltComment, BuiltDoctype, BuiltNode, BuiltProcessingInstruction, BuiltText, Element,
      HtmlParser,
    } = import("../../kelpto-html");

    let dump(nodes: List<BuiltNode>, depth: Int, out: ListBuilder<String>): Void {
      for (var i = 0; i < nodes.length; i += 1) {
        dumpNode(nodes[i], depth, out);
      }
    }

    let indent(depth: Int): String {
      let out = new StringBuilder();
      for (var i = 0; i < depth; i += 1) { out.append("  "); }
      out.toString()
    }

    let dumpNode(node: BuiltNode, depth: Int, out: ListBuilder<String>): Void {
      let pad = indent(depth);
      when (node) {
        is Element -> do {
          let space = node.namespace;
          let prefix = if (space == "html") { "" } else { "${space} " };
          out.add("${pad}<${prefix}${node.name}>");
          let names = new ListBuilder<String>();
          let lines = new ListBuilder<String>();
          let attributes = node.attributes;
          for (var i = 0; i < attributes.length; i += 1) {
            let a = attributes[i];
            let name = if (a.prefix.isEmpty) { a.name } else { "${a.prefix} ${a.name}" };
            var at = names.length;
            while (at > 0 && before(name, names[at - 1])) { at -= 1; }
            names.add(name, at);
            lines.add("${pad}  ${name}=\"${a.value}\"", at);
          }
          out.addAll(lines);
          if (space == "html" && node.name == "template") {
            out.add("${pad}  content");
            dump(node.templateContents, depth + 2, out);
          }
          dump(node.children, depth + 1, out);
        }
        is BuiltText -> out.add("${pad}\"${node.text}\"");
        is BuiltComment -> out.add("${pad}<!-- ${node.text} -->");
        is BuiltDoctype -> do {
          if (node.publicId.isEmpty && node.systemId.isEmpty) {
            out.add("${pad}<!DOCTYPE ${node.name}>");
          } else {
            out.add("${pad}<!DOCTYPE ${node.name} \"${node.publicId}\" \"${node.systemId}\">");
          }
        }
        is BuiltProcessingInstruction -> out.add("${pad}<?${node.target} ${node.data}?>");
        else -> out.add("${pad}?");
      }
    }

Whether `a` sorts before `b`, by code point.

    let before(a: String, b: String): Boolean {
      var i = String.begin;
      var j = String.begin;
      while (a.hasIndex(i) && b.hasIndex(j)) {
        if (a[i] != b[j]) { return a[i] < b[j]; }
        i = a.next(i);
        j = b.next(j);
      }
      !a.hasIndex(i) && b.hasIndex(j)
    }

The tree a parse gives, in the dump format.

    let treeOf(input: String, scripting: Boolean): String {
      let doc = HtmlParser.html.withScripting(scripting).parse(input);
      if (doc.asWritten != input) { return "not lossless"; }
      let out = new ListBuilder<String>();
      out.add("#document");
      dump(doc.children, 0, out);
      out.join("\n") { (s: String): String => s }
    }

What a test gives: `ok`, `fragment` (not run yet), or the tree it got.

    let check(test: TreeTest): String {
      if (!test.fragment.isEmpty) { return "fragment"; }
      let expected = "#document\n${test.tree}";
      if (test.scripting != "off") {
        let got = treeOf(test.input, true);
        if (got != expected) { return got; }
      }
      if (test.scripting != "on") {
        let got = treeOf(test.input, false);
        if (got != expected) { return got; }
      }
      "ok"
    }

Counts by file, as `file: passed/total`, with fragment tests counted
apart, and the failures.

    let report(tests: List<TreeTest>, failures: ListBuilder<String>): Int {
      let files = new ListBuilder<String>();
      let passed = new ListBuilder<Int>();
      let totals = new ListBuilder<Int>();
      let fragments = new ListBuilder<Int>();
      var allPassed = 0;
      for (var i = 0; i < tests.length; i += 1) {
        let test = tests[i];
        var at = -1;
        for (var j = 0; j < files.length; j += 1) {
          if (files[j] == test.file) { at = j; }
        }
        if (at < 0) {
          at = files.length;
          files.add(test.file);
          passed.add(0);
          totals.add(0);
          fragments.add(0);
        }
        let outcome = check(test);
        if (outcome == "fragment") {
          fragments.set(at, fragments[at] + 1);
        } else {
          totals.set(at, totals[at] + 1);
          if (outcome == "ok") {
            passed.set(at, passed[at] + 1);
            allPassed += 1;
          } else {
            failures.add("${test.file}: ${test.input}\n--- expected\n${test.tree}\n--- got\n${outcome}");
          }
        }
      }
      let out = new StringBuilder();
      var total = 0;
      for (var j = 0; j < files.length; j += 1) {
        total += totals[j];
        let rest = if (fragments[j] > 0) { " (and ${fragments[j].toString()} fragment tests)" } else { "" };
        out.append("  ${files[j]}: ${passed[j].toString()}/${totals[j].toString()}${rest}\n");
      }
      out.append("  all documents: ${allPassed.toString()}/${total.toString()}\n");
      console.log(out.toString());
      allPassed
    }

## Tests

Not every test passes yet, so this checks that none that passed
stops passing: at least `floor()` pass (a function, since Rust
can't see test-only module values). Logs the counts for every file,
and the first failures.

    let floor(): Int { 1757 }

    test("WPT tree construction tests") {
      let failures = new ListBuilder<String>();
      let passed = report(treeTests(), failures);
      let all = failures.toList();
      for (var i = 0; i < all.length && i < 30; i += 1) { console.log(all[i]); }
      assert(passed >= floor()) { "${passed.toString()} passed, fewer than ${floor().toString()}" };
    }
