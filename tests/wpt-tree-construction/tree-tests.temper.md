# Testing against web-platform-tests

Each test parses its input as a document, or as a fragment in its
context element, and writes the tree in the `.dat` files' dump format: a line per node, indented two spaces per
level, attributes sorted by name under their element, and a template's
contents under `content`.

    let {
      BuiltComment, BuiltDoctype, BuiltNode, BuiltProcessingInstruction, BuiltText, Element,
      FragmentContext, HtmlParser,
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

A fragment's tree, its context written as the files write it: a
name, or `svg` or `math`, a space, and a name.

    let fragmentTreeOf(input: String, context: String, scripting: Boolean): String {
      let parts = context.split(" ");
      let fragmentContext = if (parts.length == 2) {
        new FragmentContext(parts[1], parts[0])
      } else {
        new FragmentContext(context)
      };
      let fragment = HtmlParser.html.withScripting(scripting).parseFragment(input, fragmentContext);
      if (fragment.asWritten != input) { return "not lossless"; }
      let out = new ListBuilder<String>();
      dump(fragment.children, 0, out);
      out.join("\n") { (s: String): String => s }
    }

    let treeFor(test: TreeTest, scripting: Boolean): String {
      if (test.fragment.isEmpty) {
        treeOf(test.input, scripting)
      } else {
        fragmentTreeOf(test.input, test.fragment, scripting)
      }
    }

What a test gives: `ok`, or the tree it got.

    let check(test: TreeTest): String {
      let expected = if (test.fragment.isEmpty) { "#document\n${test.tree}" } else { test.tree };
      if (test.scripting != "off") {
        let got = treeFor(test, true);
        if (got != expected) { return got; }
      }
      if (test.scripting != "on") {
        let got = treeFor(test, false);
        if (got != expected) { return got; }
      }
      "ok"
    }

Counts by file, as `file: passed/total`, documents and fragments
apart, and the failures. Gives how many documents and how many
fragments passed.

    class Counts(public documents: Int, public fragments: Int) {}

    let report(tests: List<TreeTest>, failures: ListBuilder<String>): Counts {
      let files = new ListBuilder<String>();
      let passed = new ListBuilder<Int>();
      let totals = new ListBuilder<Int>();
      let fragmentsPassed = new ListBuilder<Int>();
      let fragments = new ListBuilder<Int>();
      var documentsPassed = 0;
      var documentTotal = 0;
      var allFragmentsPassed = 0;
      var fragmentTotal = 0;
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
          fragmentsPassed.add(0);
          fragments.add(0);
        }
        let outcome = check(test);
        let ok = outcome == "ok";
        if (test.fragment.isEmpty) {
          totals.set(at, totals[at] + 1);
          documentTotal += 1;
          if (ok) {
            passed.set(at, passed[at] + 1);
            documentsPassed += 1;
          }
        } else {
          fragments.set(at, fragments[at] + 1);
          fragmentTotal += 1;
          if (ok) {
            fragmentsPassed.set(at, fragmentsPassed[at] + 1);
            allFragmentsPassed += 1;
          }
        }
        if (!ok) {
          let context = if (test.fragment.isEmpty) { "" } else { " (in ${test.fragment})" };
          failures.add("${test.file}: ${test.input}${context}\n--- expected\n${test.tree}\n--- got\n${outcome}");
        }
      }
      let out = new StringBuilder();
      for (var j = 0; j < files.length; j += 1) {
        let documents = if (totals[j] > 0) { " ${passed[j].toString()}/${totals[j].toString()}" } else { "" };
        let rest = if (fragments[j] > 0) {
          " (fragments ${fragmentsPassed[j].toString()}/${fragments[j].toString()})"
        } else {
          ""
        };
        out.append("  ${files[j]}:${documents}${rest}\n");
      }
      out.append("  all documents: ${documentsPassed.toString()}/${documentTotal.toString()}\n");
      out.append("  all fragments: ${allFragmentsPassed.toString()}/${fragmentTotal.toString()}\n");
      console.log(out.toString());
      new Counts(documentsPassed, allFragmentsPassed)
    }

## Tests

Every test passes: at least `documentFloor()` documents and
`fragmentFloor()` fragments, which are all of them (functions, since
Rust can't see test-only module values). Logs the counts for every
file, and the first failures.

    // C++ passes 1,760: Temper's C++ backend compiles with -std=c++14,
    // where `??>` in the generated string literal for
    // processing-instructions.dat's `<?something ?\t   ??>` is a
    // trigraph for `}`, so the test's input itself differs. Kelpto
    // reads the real input right.
    let documentFloor(): Int { 1761 }
    let fragmentFloor(): Int { 206 }

    test("WPT tree construction tests") {
      let failures = new ListBuilder<String>();
      let counts = report(treeTests(), failures);
      let all = failures.toList();
      for (var i = 0; i < all.length && i < 30; i += 1) { console.log(all[i]); }
      assert(counts.documents >= documentFloor()) {
        "${counts.documents.toString()} documents passed, fewer than ${documentFloor().toString()}"
      };
      assert(counts.fragments >= fragmentFloor()) {
        "${counts.fragments.toString()} fragments passed, fewer than ${fragmentFloor().toString()}"
      };
    }
