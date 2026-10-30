# Typed views and edits

Typed views over the red tree. Each wraps one red node, so it's cheap
to make and knows its span and its text as written. The types say
where each node may go, after Mike's idea of nesting in the types:

- **`DocumentChild`:** blocks at the top of a document, `Heading`,
  `Paragraph`, `CodeBlock`, and `BlankLine`.
- **`ParagraphChild`:** inlines, `Text`, `CodeSpan`, and `RawHtml`,
  which headings hold too.

Later, `LinkTextChild` would be implemented by the inlines a link's
text may hold, every `ParagraphChild` but links, since links can't
nest. Lists and block quotes would add `ListItemChild` and the like.

Edits give a new `MarkdownDocument`, changing only the edited node's
text and sharing every untouched green node; the old document stays as
it was.

    let {
      GreenElement, GreenNode, GreenToken, RedElement, RedNode, RedToken, SourceText, Span,
    } = import("../kelpto-core");

    export sealed interface MarkdownNode {

The red node this views.

      public node: RedNode;

The text exactly as written, and where.

      public get asWritten(): String;
      public get span(): Span;
    }

    export sealed interface DocumentChild extends MarkdownNode {}
    export sealed interface ParagraphChild extends MarkdownNode {}

## Documents

    export class MarkdownDocument extends MarkdownNode {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The blocks, in order, blank lines included.

      public get children(): List<DocumentChild> {
        let result = new ListBuilder<DocumentChild>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          result.add(documentChildOf(nodes[i]));
        }
        result.toList()
      }

      public get headings(): List<Heading> {
        let result = new ListBuilder<Heading>();
        let blocks = children;
        for (var i = 0; i < blocks.length; i += 1) {
          let block = blocks[i];
          if (block is Heading) { result.add(block); }
        }
        result.toList()
      }

      public get codeBlocks(): List<CodeBlock> {
        let result = new ListBuilder<CodeBlock>();
        let blocks = children;
        for (var i = 0; i < blocks.length; i += 1) {
          let block = blocks[i];
          if (block is CodeBlock) { result.add(block); }
        }
        result.toList()
      }

Every raw HTML span in headings and paragraphs, in order.

      public get rawHtml(): List<RawHtml> {
        let result = new ListBuilder<RawHtml>();
        let blocks = children;
        for (var i = 0; i < blocks.length; i += 1) {
          let block = blocks[i];
          let inlines = when (block) {
            is Heading -> block.children;
            is Paragraph -> block.children;
            else -> [];
          };
          for (var j = 0; j < inlines.length; j += 1) {
            let inline = inlines[j];
            if (inline is RawHtml) { result.add(inline); }
          }
        }
        result.toList()
      }

HTML with the default, escaping raw HTML. See `MarkdownRenderer`.

      public toHtml(): String { new MarkdownRenderer().render(this) }
    }

    let documentChildOf(node: RedNode): DocumentChild {
      if (node.hasKind(headingKind)) { return new Heading(node); }
      if (node.hasKind(paragraphKind)) { return new Paragraph(node); }
      if (node.hasKind(codeBlockKind)) { return new CodeBlock(node); }
      new BlankLine(node)
    }

    let paragraphChildrenOf(content: RedNode): List<ParagraphChild> {
      let result = new ListBuilder<ParagraphChild>();
      let nodes = content.childNodes;
      for (var i = 0; i < nodes.length; i += 1) {
        let child = nodes[i];
        if (child.hasKind(codeSpanKind)) {
          result.add(new CodeSpan(child));
        } else if (child.hasKind(rawHtmlKind)) {
          result.add(new RawHtml(child));
        } else {
          result.add(new Text(child));
        }
      }
      result.toList()
    }

The text of inlines without markup: code spans' code, and raw HTML as
written.

    let plainTextOf(children: List<ParagraphChild>): String {
      let out = new StringBuilder();
      for (var i = 0; i < children.length; i += 1) {
        let child = children[i];
        when (child) {
          is Text -> out.append(child.text);
          is CodeSpan -> out.append(child.code);
          is RawHtml -> out.append(child.html);
        }
      }
      out.toString()
    }

    let contentOf(node: RedNode): RedNode {
      node.childOfKind(inlineContentKind) as RedNode orelse panic()
    }

## Blocks

An ATX heading, such as `## Usage`.

    export class Heading extends DocumentChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

1 to 6, the number of `#`.

      public get level(): Int {
        (node.childOfKind(atxMarkerKind) as RedToken orelse panic()).span.length
      }

      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }

The text without markup, such as `Usage`.

      public get text(): String { plainTextOf(children) }

A new document with this heading's text replaced by `text`, escaped
so it reads as plain text. Only the heading's content changes; its
`#` marker, closing sequence, and whitespace stay as written. Line
breaks in `text` become spaces, since a heading is one line.

      public withText(text: String): MarkdownDocument {
        let content = contentOf(node);
        let newContent = inlineContentGreen(escapeInline(text));
        let kids = node.green.children.toListBuilder();
        kids.set(content.index, newContent);
        if (newContent.width > 0) {

Keep the content apart from the marker and any closing sequence, so
`#` with no text becomes `# New`, not `#New`.

          let after = content.index + 1;
          if (after < kids.length && kids[after].kind.id == closingSequenceKind.id) {
            kids.add(new GreenToken(whitespaceKind, " "), after);
          }
          if (kids[content.index - 1].kind.id == atxMarkerKind.id) {
            kids.add(new GreenToken(whitespaceKind, " "), content.index);
          }
        }
        new MarkdownDocument(node.replaceWith(new GreenNode(headingKind, kids.toList())))
      }
    }

A paragraph.

    export class Paragraph extends DocumentChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get children(): List<ParagraphChild> { paragraphChildrenOf(contentOf(node)) }
      public get text(): String { plainTextOf(children) }
    }

A fenced code block, such as:

````md
```rust
fn main() {}
```
````

    export class CodeBlock extends DocumentChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      private get openingFence(): RedNode { node.childNodes[0] }

The info string after the opening fence, such as `rust`, or empty.
Not yet: backslash escapes and entity references in it.

      public get info(): String {
        let info = openingFence.childOfKind(infoKind);
        if (info == null) { "" } else { info.asWritten }
      }

The info string's first word, which CommonMark uses for the language.

      public get language(): String {
        let source = new SourceText(info);
        var end = 0;
        while (end < source.length && source.codeAt(end) != char' ' && source.codeAt(end) != char'\t') {
          end += 1;
        }
        source.slice(0, end)
      }

The code, each line ending in `\n`, with as much indentation removed
from each line as the opening fence had, as CommonMark reads it.

      public get code(): String {
        let indent = openingFence.childOfKind(indentKind)?.span?.length ?? 0;
        let out = new StringBuilder();
        var lineOpen = false;
        let kids = node.children;
        for (var i = 1; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid.hasKind(codeLineKind)) {
            out.append(dropSpaces(kid.asWritten, indent));
            lineOpen = true;
          } else if (kid.hasKind(lineEndingKind)) {
            out.append("\n");
            lineOpen = false;
          }
        }
        if (lineOpen) { out.append("\n"); }
        out.toString()
      }

A new document with this block's info string replaced by `info`
(trimmed; empty removes it). Only the info string changes; the fences,
whitespace, and code stay as written. Bubbles if `info` has a line
break, or a backtick after a backtick fence, which would change what
the fence means.

      public withInfo(info: String): MarkdownDocument throws Bubble {
        let source = new SourceText(info);
        var start = 0;
        while (start < source.length && isSpaceOrTab(source.codeAt(start))) { start += 1; }
        let end = trimBlanksBack(source, start, source.length);
        let trimmed = source.slice(start, end);
        let backtickFence = new SourceText(openingFence.childOfKind(fenceKind)?.asWritten ?? "").codeAt(0) == char'`';
        for (var i = start; i < end; i += 1) {
          let c = source.codeAt(i);
          if (c == char'\n' || c == char'\r' || (c == char'`' && backtickFence)) {
            bubble();
          }
        }
        let opening = openingFence;
        let kids = opening.green.children.toListBuilder();
        let old = opening.childOfKind(infoKind);
        if (old != null) {
          if (trimmed.isEmpty) {
            kids.splice(old.index, 1);
          } else {
            kids.set(old.index, new GreenToken(infoKind, trimmed));
          }
        } else if (!trimmed.isEmpty) {

No info before: put it after the fence and any whitespace there.

          var at = (opening.childOfKind(fenceKind) as RedToken orelse panic()).index + 1;
          if (at < kids.length && kids[at].kind.id == whitespaceKind.id) { at += 1; }
          kids.add(new GreenToken(infoKind, trimmed), at);
        }
        new MarkdownDocument(opening.replaceWith(new GreenNode(openingFenceKind, kids.toList())))
      }
    }

`text` with up to `count` leading spaces removed.

    let dropSpaces(text: String, count: Int): String {
      let source = new SourceText(text);
      var i = 0;
      while (i < count && source.codeAt(i) == char' ') { i += 1; }
      source.slice(i, source.length)
    }

One or more blank lines' worth: a line of only spaces and tabs.

    export class BlankLine extends DocumentChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
    }

## Inlines

A run of text, which may hold backslash escapes and line breaks.

    export class Text extends ParagraphChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The text as it reads: escapes resolved, line breaks as `\n`, and the
whitespace around line breaks left out.

      public get text(): String {
        let out = new StringBuilder();
        let kids = node.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid.hasKind(plainKind)) {
            out.append(kid.asWritten);
          } else if (kid.hasKind(escapeKind)) {
            let written = kid.asWritten;
            out.append(written.slice(written.next(String.begin), written.end));
          } else if (kid.hasKind(lineEndingKind)) {
            out.append("\n");
          }
        }
        out.toString()
      }
    }

A code span, such as `` `x` ``.

    export class CodeSpan extends ParagraphChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The code, as CommonMark reads it: line endings become spaces, and one
space is stripped from each end if both have one and it's not all
spaces.

      public get code(): String {
        let raw = node.childOfKind(codeTextKind)?.asWritten ?? "";
        let source = new SourceText(raw);
        let out = new StringBuilder();
        var allSpaces = true;
        for (var i = 0; i < source.length; i += 1) {
          let c = source.codeAt(i);
          if (c != char' ' && c != char'\n' && c != char'\r') { allSpaces = false; }
        }
        let n = source.length;
        var start = 0;
        var end = n;
        if (
          !allSpaces && n >= 2 && isLineSpace(source.codeAt(0)) && isLineSpace(source.codeAt(n - 1))
        ) {
          start = 1;
          end = n - 1;
        }
        for (var i = start; i < end; i += 1) {
          let c = source.codeAt(i);
          if (c == char'\r' && source.codeAt(i + 1) == char'\n') {
            // A CRLF is one line ending: one space, at its `\n`.
          } else if (c == char'\n' || c == char'\r') {
            out.append(" ");
          } else {
            out.append(source.slice(i, i + 1));
          }
        }
        out.toString()
      }
    }

    let isLineSpace(c: Int): Boolean { c == char' ' || c == char'\n' || c == char'\r' }

Raw HTML, such as `<b>` or `<!-- note -->`, found by CommonMark's
rules. Its children are whatever the `RawHtmlHandler` gave: one opaque
token by default, or an HTML subtree with the `kelpto` library.

    export class RawHtml extends ParagraphChild {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The HTML exactly as written. Not checked or sanitized.

      public get html(): String { node.asWritten }

The subtree a handler made, if any: a red node another library's
views can wrap.

      public get htmlNode(): RedNode? {
        let nodes = node.childNodes;
        if (nodes.isEmpty) { null } else { nodes[0] }
      }
    }

## Escaping for edits

`text` as Markdown that reads as `text`: backslashes before what would
otherwise start markup, and line breaks as spaces. Leading and
trailing spaces and tabs are trimmed, as a heading's are. A trailing
run of `#` gets a backslash, so it can't read as a closing sequence.

    let escapeInline(text: String): String {
      let source = new SourceText(text);
      var start = 0;
      while (start < source.length && isSpaceOrTab(source.codeAt(start))) { start += 1; }
      let end = trimBlanksBack(source, start, source.length);
      var hashes = end;
      while (hashes > start && source.codeAt(hashes - 1) == char'#') { hashes -= 1; }
      let out = new StringBuilder();
      for (var i = start; i < end; i += 1) {
        let c = source.codeAt(i);
        if (c == char'\n' || c == char'\r') {
          if (!(c == char'\n' && i > start && source.codeAt(i - 1) == char'\r')) {
            out.append(" ");
          }
        } else {
          if (
            c == char'\\' || c == char'`' || c == char'*' || c == char'_' || c == char'[' ||
            c == char']' || c == char'<' || c == char'&' || (c == char'#' && i == hashes)
          ) {
            out.append("\\");
          }
          out.append(source.slice(i, i + 1));
        }
      }
      out.toString()
    }

## Tests

    test("typed views") {
      let doc = parseMarkdown(
        "## Usage ##\n\nSome `code` and <b class=\"x\">bold</b>,\nwrapped.\n\n```rust  extra\n  fn main() {}\n```\n",
      );
      let blocks = doc.children;
      assert(blocks.length == 5) { blocks.length.toString() };
      let heading = doc.headings[0];
      assert(heading.level == 2) { heading.level.toString() };
      assert(heading.text == "Usage") { heading.text };
      assert(heading.span.toString() == "0+12") { heading.span.toString() };
      let paragraph = blocks[2] as Paragraph orelse panic();
      let inlines = paragraph.children;
      assert(inlines.length == 7) { inlines.length.toString() };
      let code = inlines[1] as CodeSpan orelse panic();
      assert(code.code == "code") { code.code };
      let raw = inlines[3] as RawHtml orelse panic();
      assert(raw.html == "<b class=\"x\">") { raw.html };
      assert(raw.htmlNode == null) { "opaque by default" };
      assert(paragraph.text == "Some code and <b class=\"x\">bold</b>,\nwrapped.") { paragraph.text };
      let block = doc.codeBlocks[0];
      assert(block.info == "rust  extra") { block.info };
      assert(block.language == "rust") { block.language };
      assert(block.code == "  fn main() {}\n") { block.code };
    }

    test("views: escapes, indentation, and code spans") {
      let doc = parseMarkdown("  ```\n   a\n  b\n```\n\\# not a heading `` a`b ``\n");
      let block = doc.codeBlocks[0];
      assert(block.code == " a\nb\n") { block.code };
      let paragraph = doc.children[1] as Paragraph orelse panic();
      assert(paragraph.text == "# not a heading a`b") { paragraph.text };
      let unclosed = parseMarkdown("~~~\ncode").codeBlocks[0];
      assert(unclosed.code == "code\n") { unclosed.code };
    }

    test("withText changes only the heading's text") {
      let text = "Intro\n\n# Old *title* #\nAfter\n";
      let doc = parseMarkdown(text);
      let edited = doc.headings[0].withText("New [1] #");
      assert(edited.asWritten == "Intro\n\n# New \\[1\\] \\# #\nAfter\n") { edited.asWritten };
      assert(doc.asWritten == text) { "the old document is unchanged" };
      let reparsed = parseMarkdown(edited.asWritten);
      assert(reparsed.headings[0].text == "New [1] #") { reparsed.headings[0].text };
      let bare = parseMarkdown("#\n").headings[0].withText("Title");
      assert(bare.asWritten == "# Title\n") { bare.asWritten };
      let closed = parseMarkdown("# #\n").headings[0].withText("Title");
      assert(closed.asWritten == "# Title #\n") { closed.asWritten };
    }

    test("withInfo changes only the info string") {
      let doc = parseMarkdown("Text\n\n```py   \nx = 1\n```\n");
      let block = doc.codeBlocks[0];
      let edited = block.withInfo("rust") orelse panic();
      assert(edited.asWritten == "Text\n\n```rust   \nx = 1\n```\n") { edited.asWritten };
      let added = (parseMarkdown("~~~\nx\n~~~").codeBlocks[0].withInfo(" js ") orelse panic());
      assert(added.asWritten == "~~~js\nx\n~~~") { added.asWritten };
      let removed = block.withInfo("") orelse panic();
      assert(removed.asWritten == "Text\n\n```   \nx = 1\n```\n") { removed.asWritten };
      let bad = do { block.withInfo("a`b"); "accepted" } orelse "bubbled";
      assert(bad == "bubbled") { "a backtick can't follow a backtick fence" };
    }
