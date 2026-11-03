# Testing against html5lib-tests

Each test tokenizes its input from its initial state, with its last
start tag and without the state switching tree construction does, and
writes the tokens and errors in the canonical form the generator
wrote the expected ones in (see `scripts/html5lib_tokenizer.py`).

    let {
      ContentState, Comment, Doctype, DroppedTag, EndTag, HtmlParseError, HtmlToken,
      HtmlTokenizer, StartTag, Text,
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
      if (errors != test.errors) { return "errors: ${errors}"; }
      "ok"
    }

Tests expecting `<?` to start a processing instruction, as
html5lib-tests now does, though the standard Kelpto follows reads it as
a bogus comment (see docs/design.md). They're counted apart.

    let expectsProcessingInstruction(test: TokenizerTest): Boolean {
      test.tokens.indexOf("ProcessingInstruction") is StringIndex ||
        test.errors.indexOf("processing-instruction") is StringIndex
    }

Counts by file, as `file: passed/total`, and the failures; tests
expecting a processing instruction count as passed if they pass, and
are otherwise left out of both counts and failures.

    let report(tests: List<TokenizerTest>, failures: ListBuilder<String>): String {
      let files = new ListBuilder<String>();
      let passed = new ListBuilder<Int>();
      let totals = new ListBuilder<Int>();
      let left = new ListBuilder<Int>();
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
          left.add(0);
        }
        let outcome = check(test);
        if (outcome == "ok") {
          totals.set(at, totals[at] + 1);
          passed.set(at, passed[at] + 1);
        } else if (expectsProcessingInstruction(test)) {
          left.set(at, left[at] + 1);
        } else {
          totals.set(at, totals[at] + 1);
          failures.add("${test.file} ${test.state} ${test.description} ${test.input}: ${outcome}");
        }
      }
      let out = new StringBuilder();
      for (var j = 0; j < files.length; j += 1) {
        let pi = if (left[j] > 0) { " (and ${left[j].toString()} expecting processing instructions)" } else { "" };
        out.append("  ${files[j]}: ${passed[j].toString()}/${totals[j].toString()}${pi}\n");
      }
      out.toString()
    }

## Tests

Every test passes, but those expecting processing instructions.
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
