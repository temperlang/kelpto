# Worked examples: walking and transforming

Two jobs on whole documents, with kelpto-md's `descendants` and
`MarkdownEditor`, first on a small document, then on the real ones in
`docs/`.

    let {
      Autolink, Heading, Image, Link, LinkReferenceDefinition, LinkTarget, MarkdownDocument,
      MarkdownNode, MarkdownParser,
    } = import("../../kelpto-md");

## Scraping: a table of contents and every link

One pass over `descendants`, in document order: each heading's level
and text, and each link's, image's, and autolink's destination (a
reference link's from its definition).

    class Scraped(public toc: List<String>, public destinations: List<String>) {}

    let scrape(doc: MarkdownDocument): Scraped {
      let toc = new ListBuilder<String>();
      let destinations = new ListBuilder<String>();
      let all = doc.descendants;
      for (var i = 0; i < all.length; i += 1) {
        let view = all[i];
        when (view) {
          is Heading -> toc.add("${view.level.toString()} ${view.text}");
          is Link -> destinations.add(view.destination?.url ?? "(undefined)");
          is Image -> destinations.add(view.destination?.url ?? "(undefined)");
          is Autolink -> destinations.add(view.destination.url);
          else -> do {};
        }
      }
      new Scraped(toc.toList(), destinations.toList())
    }

## Transforming: absolute links, and headings a level down

For pasting a document under another heading, at another address:
every relative destination, of inline links and images and of link
reference definitions (which reference links use), becomes absolute
under `base`, and every heading goes down a level. Each is one edit
to the original document; `toDocument()` makes them all at once, and
every other byte stays as written.

Headings that can't go down stay: level 6, and setext headings at
level 2, since setext has only two levels (rewriting one as ATX would
change more than its marker). URLs here are plain strings: a relative
one has no scheme and doesn't start with `#` or `//`, and resolving
it only joins, without removing dot segments.

    let absolutized(doc: MarkdownDocument, base: String): MarkdownDocument throws Bubble {
      let editor = doc.editor();
      let all = doc.descendants;
      for (var i = 0; i < all.length; i += 1) {
        let view = all[i];
        if (isEdited(view)) {
          when (view) {
            is Heading -> editor.setLevel(view, view.level + 1);
            is Link -> editor.setDestination(view, new LinkTarget(resolve(base, view.destination?.url ?? "")));
            is Image -> editor.setDestination(view, new LinkTarget(resolve(base, view.destination?.url ?? "")));
            is LinkReferenceDefinition -> editor.setDestination(view, new LinkTarget(resolve(base, view.destination.url)));
            else -> do {};
          }
        }
      }
      editor.toDocument()
    }

    let isEdited(view: MarkdownNode): Boolean {
      when (view) {
        is Heading -> view.level < 6 && !(view.style == "setext" && view.level == 2);
        is Link -> view.style == "inline" && isRelative(view.destination?.url ?? "");
        is Image -> view.style == "inline" && isRelative(view.destination?.url ?? "");
        is LinkReferenceDefinition -> isRelative(view.destination.url);
        else -> false;
      }
    }

    let isRelative(url: String): Boolean {
      if (url.isEmpty || url[String.begin] == char'#' || url.slice(String.begin, url.step(String.begin, 2)) == "//") {
        return false;
      }
      for (var i = String.begin; url.hasIndex(i); i = url.next(i)) {
        let c = url[i];
        if (c == char':') { return i == String.begin || !isSchemeStart(url[String.begin]); }
        if (!isSchemeStart(c) && !(c >= char'0' && c <= char'9') && c != char'+' && c != char'-' && c != char'.') {
          return true;
        }
      }
      true
    }

    let isSchemeStart(c: Int): Boolean { (c >= char'a' && c <= char'z') || (c >= char'A' && c <= char'Z') }

`base` ends with `/`; a destination starting with `/` goes under its
origin instead.

    let resolve(base: String, url: String): String {
      if (url.isEmpty || url[String.begin] != char'/') { return "${base}${url}"; }
      var slashes = 0;
      for (var i = String.begin; base.hasIndex(i); i = base.next(i)) {
        if (base[i] == char'/') {
          slashes += 1;
          if (slashes == 3) { return "${base.slice(String.begin, i)}${url}"; }
        }
      }
      "${base}${url}"
    }

## Checking a transform

That `edited` is `doc` with exactly the edits `absolutized` means:
the same views, of the same kinds; text outside the edited views'
spans the same, byte for byte; the edited views changed as they
should, and every other view's text, level, and destination the same;
and reading `edited`'s text again gives the same views. Gives what's
wrong, or the empty string.

    let checkAbsolutized(doc: MarkdownDocument, edited: MarkdownDocument, base: String, gfm: Boolean): String {
      let before = doc.descendants;
      let after = edited.descendants;
      if (viewKinds(before) != viewKinds(after)) { return "views changed"; }
      let old = doc.asWritten;
      let now = edited.asWritten;

Where in each text the views' code point offsets so far are, by
`StringIndex` too.

      var oldAt = 0;
      var newAt = 0;
      var oldIndex = String.begin;
      var newIndex = String.begin;
      var edits = 0;
      for (var i = 0; i < before.length; i += 1) {
        let a = before[i];
        let b = after[i];
        let wrong = viewChange(a, b, base);
        if (!wrong.isEmpty) { return "${wrong} at ${a.span.toString()}: ${a.asWritten}"; }

Outermost edited views only: a link in an edited heading is inside its
span.

        if (isEdited(a)) {
          edits += 1;
          if (a.span.start >= oldAt) {
            let oldStart = old.step(oldIndex, a.span.start - oldAt);
            let newStart = now.step(newIndex, b.span.start - newAt);
            if (old.slice(oldIndex, oldStart) != now.slice(newIndex, newStart)) {
              return "bytes changed before ${a.span.toString()}";
            }
            oldIndex = old.step(oldStart, a.span.end - a.span.start);
            newIndex = now.step(newStart, b.span.end - b.span.start);
            oldAt = a.span.end;
            newAt = b.span.end;
          }
        }
      }
      if (old.slice(oldIndex, old.end) != now.slice(newIndex, now.end)) { return "bytes changed at the end"; }
      let parser = if (gfm) { MarkdownParser.gfm } else { MarkdownParser.commonMark };
      let reparsed = parser.parse(edited.asWritten);
      if (viewKinds(reparsed.descendants) != viewKinds(after)) { return "reads back as other views"; }
      let one = scrape(edited);
      let two = scrape(reparsed);
      if (lines(one.toc) != lines(two.toc) || lines(one.destinations) != lines(two.destinations)) {
        return "reads back differently";
      }
      ""
    }

What's wrong with view `a` becoming `b`, or the empty string.

    let viewChange(a: MarkdownNode, b: MarkdownNode, base: String): String {
      let edited = isEdited(a);
      when (a) {
        is Heading -> do {
          let h = b as Heading orelse panic();
          let level = if (edited) { a.level + 1 } else { a.level };
          if (h.level != level || h.text != a.text) { return "heading"; }
        };
        is Link -> do {
          let l = b as Link orelse panic();
          if (l.text != a.text || l.title != a.title || l.destination?.url != expected(a.destination?.url, base)) {
            return "link";
          }
        };
        is Image -> do {
          let l = b as Image orelse panic();
          if (l.alt != a.alt || l.title != a.title || l.destination?.url != expected(a.destination?.url, base)) {
            return "image";
          }
        };
        is LinkReferenceDefinition -> do {
          let d = b as LinkReferenceDefinition orelse panic();
          if (d.label != a.label || d.title != a.title || d.destination.url != expected(a.destination.url, base)) {
            return "definition";
          }
        };
        else -> if (!edited && !isInEdited(a) && a.asWritten != b.asWritten) { return "text"; };
      }
      ""
    }

A relative destination becomes absolute, whether it's the link's own
or its definition's.

    let expected(url: String?, base: String): String? {
      if (url == null) { return null; }
      let written = url ?? "";
      if (isRelative(written)) { resolve(base, written) } else { written }
    }

Whether an edit is under `view`: an edited view holding it, or a
heading, link, or image whose text holds an edited link or image.

    let isInEdited(view: MarkdownNode): Boolean {
      var up = view.parent;
      while (up != null) {
        let holder = up as MarkdownNode orelse panic();
        if (isEdited(holder)) { return true; }
        up = holder.parent;
      }
      let inside = view.descendants;
      for (var i = 0; i < inside.length; i += 1) {
        if (isEdited(inside[i])) { return true; }
      }
      false
    }

    let viewKinds(views: List<MarkdownNode>): String {
      views.join(" ") { (view: MarkdownNode): String => "${view.depth.toString()}${view.node.green.kind.name}" }
    }

    let lines(items: List<String>): String { items.join("\n") { (s: String): String => s } }

## On a small document

A function, not a module-level `let`, which Rust tests can't see
(2026-11-02).

    let sample(): String {
      [
        "Intro\n",
        "=====\n",
        "\n",
        "See [the guide](guide/start.md \"Start\"), [the API][api], and [top](#top).\n",
        "\n",
        "## ![logo](img/logo.png) Images too\n",
        "\n",
        "> [Home](https://example.com/) and <https://example.org/>\n",
        "\n",
        "Usage\n",
        "-----\n",
        "\n",
        "###### Deepest\n",
        "\n",
        "[api]: /api/index.html\n",
      ].join("") { (s: String): String => s }
    }

    test("scraping a small document") {
      let found = scrape(MarkdownParser.gfm.parse(sample()));
      assert(lines(found.toc) == "1 Intro\n2 logo Images too\n2 Usage\n6 Deepest") { lines(found.toc) };
      let expected = "guide/start.md /api/index.html #top img/logo.png https://example.com/ https://example.org/";
      let got = found.destinations.join(" ") { (s: String): String => s };
      assert(got == expected) { got };
    }

    test("transforming a small document changes only what it should") {
      let doc = MarkdownParser.gfm.parse(sample());
      let base = "https://example.com/docs/";
      let edited = absolutized(doc, base) orelse panic();
      let expected = [
        "Intro\n",
        "-----\n",
        "\n",
        "See [the guide](https://example.com/docs/guide/start.md \"Start\"), [the API][api], and [top](#top).\n",
        "\n",
        "### ![logo](https://example.com/docs/img/logo.png) Images too\n",
        "\n",
        "> [Home](https://example.com/) and <https://example.org/>\n",
        "\n",
        "Usage\n",
        "-----\n",
        "\n",
        "###### Deepest\n",
        "\n",
        "[api]: https://example.com/api/index.html\n",
      ].join("") { (s: String): String => s };
      assert(edited.asWritten == expected) { edited.asWritten };
      let wrong = checkAbsolutized(doc, edited, base, true);
      assert(wrong.isEmpty) { wrong };
      assert(doc.asWritten == sample()) { "the original is unchanged" };
    }

## On the real documents

Each sample prints back byte for byte, parsed, through its top-level
views, and after a no-op edit of every heading (each to its own
level); and the transform changes only what it should.

    let parsed(sample: SampleDocument): MarkdownDocument {
      let parser = if (sample.gfm) { MarkdownParser.gfm } else { MarkdownParser.commonMark };
      parser.parse(sample.text)
    }

    let sampleNamed(name: String): SampleDocument {
      let all = sampleDocuments();
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].name == name) { return all[i]; }
      }
      panic()
    }

Gives what's wrong, or the empty string.

    let checkSample(name: String): String {
      let sample = sampleNamed(name);
      let doc = parsed(sample);
      if (doc.asWritten != sample.text) { return "parsed"; }
      let top = new StringBuilder();
      let all = doc.descendants;
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].depth == 1) { top.append(all[i].asWritten); }
      }
      if (top.toString() != sample.text) { return "top-level views"; }
      let editor = doc.editor();
      let headings = doc.headings;
      for (var i = 0; i < headings.length; i += 1) {
        editor.setLevel(headings[i], headings[i].level) orelse panic();
      }
      if ((editor.toDocument() orelse panic()).asWritten != sample.text) { return "no-op edit"; }
      if (scrape(doc).toc.isEmpty) { return "no headings"; }
      let base = "https://example.com/docs/";
      let edited = absolutized(doc, base) orelse panic();
      if (edited.asWritten == sample.text) { return "nothing changed"; }
      checkAbsolutized(doc, edited, base, sample.gfm)
    }

    test("the CommonMark spec: walked, scraped, and transformed") {
      let wrong = checkSample("commonmark-spec.md");
      assert(wrong.isEmpty) { wrong };
    }

    test("Chromarite's README: walked, scraped, and transformed") {
      let wrong = checkSample("chromarite-readme.md");
      assert(wrong.isEmpty) { wrong };
    }

    test("Hrefine's README: walked, scraped, and transformed") {
      let wrong = checkSample("hrefine-readme.md");
      assert(wrong.isEmpty) { wrong };
    }

    test("Kelpto's README: walked, scraped, and transformed") {
      let wrong = checkSample("kelpto-readme.md");
      assert(wrong.isEmpty) { wrong };
    }

    test("Ordable's README: walked, scraped, and transformed") {
      let wrong = checkSample("ordable-readme.md");
      assert(wrong.isEmpty) { wrong };
    }
