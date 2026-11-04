# Testing against html5lib-tests

Each test tokenizes its input from its initial state, with its last
start tag and without the state switching tree construction does, and
writes the tokens and errors in the canonical form the generator
wrote the expected ones in (see `scripts/html5lib_tokenizer.py`).

    let {
      ContentState, Comment, Doctype, DroppedTag, EndTag, HtmlParseError, HtmlToken,
      HtmlTokenizer, ProcessingInstruction, StartTag, Text,
    } = import("../../kelpto-html");

    let stateFor(name: String): ContentState {
      if (name == "RCDATA state") {
        ContentState.rcdata
      } else if (name == "RAWTEXT state") {
        ContentState.rawtext
      } else if (name == "Script data state") {
        ContentState.scriptData
      } else if (name == "PLAINTEXT state") {
        ContentState.plaintext
      } else if (name == "CDATA section state") {
        ContentState.cdataSection
      } else {
        ContentState.data
      }
    }

    let fieldSeparator = "\u{1F}";

    let orNone(text: String?): String { text ?? "\u{0}" }

The tokens in canonical form, adjacent text joined, as html5lib-tests
writes them.

    let tokenStrings(test: TokenizerTest, tokenizer: HtmlTokenizer): List<String> {
      let out = new ListBuilder<String>();
      var chars = new StringBuilder();
      var inText = false;
      let children = tokenizer.tokenize(test.input).tokens.children;
      for (var i = 0; i < children.length; i += 1) {
        let child = children[i];
        when (child) {
          is Text -> do {
            chars.append(child.text);
            inText = true;
          }
          is DroppedTag -> do {}
          else -> do {
            if (inText) {
              out.add("Character${fieldSeparator}${chars.toString()}");
              chars = new StringBuilder();
              inText = false;
            }
            out.add(tokenString(child));
          }
        }
      }
      if (inText) { out.add("Character${fieldSeparator}${chars.toString()}"); }
      out.toList()
    }

    let tokenString(token: HtmlToken): String {
      when (token) {
        is StartTag -> do {
          let out = new StringBuilder();
          out.append("StartTag${fieldSeparator}${token.name}");
          let attributes = token.attributes;
          for (var i = 0; i < attributes.length; i += 1) {
            out.append("${fieldSeparator}${attributes[i].name}${fieldSeparator}${attributes[i].value}");
          }
          if (token.selfClosing) { out.append("\u{1D}"); }
          out.toString()
        }
        is EndTag -> "EndTag${fieldSeparator}${token.name}";
        is Comment -> "Comment${fieldSeparator}${token.text}";
        is ProcessingInstruction -> "ProcessingInstruction${fieldSeparator}${token.target}${fieldSeparator}${token.data}";
        is Doctype -> [
          "DOCTYPE", orNone(token.name), orNone(token.publicId), orNone(token.systemId),
          if (token.forceQuirks) { "false" } else { "true" },
        ].join(fieldSeparator) { (s: String): String => s };
        else -> "?";
      }
    }

Errors as `code:line:col`, counting lines and columns as html5lib-tests
does: after `\r\n` and `\r` become `\n`, and columns in UTF-16 code
units, so a code point past U+FFFF counts twice.

    let errorString(input: String, error: HtmlParseError): String {
      var line = 1;
      var column = 1;
      var i = String.begin;
      for (var k = 0; k < error.offset && input.hasIndex(i); k += 1) {
        let c = input[i];
        let next = input.next(i);
        if (c == char'\n' || (c == char'\r' && !(input.hasIndex(next) && input[next] == char'\n'))) {
          line += 1;
          column = 1;
        } else if (c != char'\r') {
          column += if (c > 0xFFFF) { 2 } else { 1 };
        }
        i = next;
      }
      "${error.code}:${line.toString()}:${column.toString()}"
    }

What a test gives: `ok`, or what went wrong.

    let check(test: TokenizerTest): String {
      let tokenizer = HtmlTokenizer.html.withStateSwitching(false)
        .withInitialState(stateFor(test.state)).withLastStartTag(test.lastStartTag);
      let result = tokenizer.tokenize(test.input);
      if (result.tokens.asWritten != test.input) { return "not lossless"; }
      let tokens = tokenStrings(test, tokenizer).join("\u{1E}") { (s: String): String => s };
      if (tokens != test.tokens) { return "tokens: ${tokens}"; }
      let errors = result.errors.join(",") { (e: HtmlParseError): String => errorString(test.input, e) };
      if (errors != expectedErrors(test)) { return "errors: ${errors}"; }
      "ok"
    }

At this commit, three of domjs.test's tests (`<?` then a line ending)
still expect the error `<?` gave before the standard read processing
instructions (whatwg/html#12118), at the `?`; the rest of
html5lib-tests expects what it gives now,
`invalid-first-character-of-processing-instruction-target`, at the
character after it. Their tokens are the same either way.

    let expectedErrors(test: TokenizerTest): String {
      if (test.file != "domjs.test") { return test.errors; }
      test.errors.split("unexpected-question-mark-instead-of-tag-name:1:2")
        .join("invalid-first-character-of-processing-instruction-target:1:3") { (s: String): String => s }
    }

Counts by file, as `file: passed/total`, and the failures.

    let report(tests: List<TokenizerTest>, failures: ListBuilder<String>): String {
      let files = new ListBuilder<String>();
      let passed = new ListBuilder<Int>();
      let totals = new ListBuilder<Int>();
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
        }
        let outcome = check(test);
        totals.set(at, totals[at] + 1);
        if (outcome == "ok") {
          passed.set(at, passed[at] + 1);
        } else {
          failures.add("${test.file} ${test.state} ${test.description} ${test.input}: ${outcome}");
        }
      }
      let out = new StringBuilder();
      for (var j = 0; j < files.length; j += 1) {
        out.append("  ${files[j]}: ${passed[j].toString()}/${totals[j].toString()}\n");
      }
      out.toString()
    }

## Tests

Every test passes.
Logs the counts for every file.

    test("html5lib tokenizer tests") {
      let failures = new ListBuilder<String>();
      console.log(report(tokenizerTests(), failures));
      let all = failures.toList();
      for (var i = 0; i < all.length && i < 50; i += 1) { console.log(all[i]); }
      assert(all.isEmpty) { "${all.length.toString()} failing" };
    }

    test("html5lib tokenizer tests: named character references") {
      let failures = new ListBuilder<String>();
      console.log(report(namedEntityTests(), failures));
      let all = failures.toList();
      for (var i = 0; i < all.length && i < 50; i += 1) { console.log(all[i]); }
      assert(all.isEmpty) { "${all.length.toString()} failing" };
    }
