# Typed views and edits

Typed views over the red tree, each wrapping one red node, as in
kelpto-md. `HtmlToken` is what the tokenizer gives at the top level:
`StartTag`, `EndTag`, `Comment`, `Text`, `Doctype`,
`ProcessingInstruction`, and `DroppedTag`.
Each reads its parts as browsers do (names lowercased, character
references decoded, line endings as `\n`), while `asWritten` stays the
input.

Why `StartTag` and not `Element`: an element is what tree construction
builds, from a start tag, its end tag (or none), and what's between,
and it can differ from the source's nesting. The name `Element` is kept
for that view, which comes later.

    let {
      GreenNode, GreenToken, Kind, RedNode, Span, escapeHtml,
    } = import("../kelpto-core");

    export sealed interface HtmlNode {
      public node: RedNode;
      public get asWritten(): String;
      public get span(): Span;
    }

    export sealed interface HtmlToken extends HtmlNode {}

The tokens of some HTML, in order.

    export class HtmlTokens extends HtmlNode {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      public get children(): List<HtmlToken> {
        let result = new ListBuilder<HtmlToken>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          result.add(htmlTokenOf(nodes[i]));
        }
        result.toList()
      }

      public get startTags(): List<StartTag> {
        let result = new ListBuilder<StartTag>();
        let tokens = children;
        for (var i = 0; i < tokens.length; i += 1) {
          let token = tokens[i];
          if (token is StartTag) { result.add(token); }
        }
        result.toList()
      }
    }

The typed view of a token node.

    export let htmlTokenOf(node: RedNode): HtmlToken {
      if (node.hasKind(startTagKind)) { return new StartTag(node); }
      if (node.hasKind(endTagKind)) { return new EndTag(node); }
      if (node.hasKind(commentKind)) { return new Comment(node); }
      if (node.hasKind(doctypeKind) || node.hasKind(quirksDoctypeKind)) { return new Doctype(node); }
      if (node.hasKind(processingInstructionKind)) { return new ProcessingInstruction(node); }
      if (node.hasKind(droppedTagKind)) { return new DroppedTag(node); }
      new Text(node)
    }

    let tagNameOf(node: RedNode): String {
      htmlName(node.childOfKind(tagNameKind)?.asWritten ?? "")
    }

A start tag, such as `<a href="/x">`.

    export class StartTag extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The name, ASCII-lowercased, as HTML compares it.

      public get name(): String { tagNameOf(node) }

The attributes, in order, without repeats of an earlier one's name,
which browsers drop.

      public get attributes(): List<Attribute> {
        let result = new ListBuilder<Attribute>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          if (nodes[i].hasKind(attributeKind)) { result.add(new Attribute(nodes[i])); }
        }
        result.toList()
      }

The first attribute named `name` (lowercase), or null.

      public attribute(name: String): Attribute? {
        let all = attributes;
        for (var i = 0; i < all.length; i += 1) {
          let attribute = all[i];
          if (attribute.name == name) { return attribute; }
        }
        null
      }

Whether it ends in `/>`. HTML ignores that except on foreign elements,
such as SVG's.

      public get selfClosing(): Boolean { node.childOfKind(selfClosingKind) != null }
    }

An attribute in a start tag, such as `href="/x"`.

    export class Attribute extends HtmlNode {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      public get name(): String { htmlName(node.childOfKind(attributeNameKind)?.asWritten ?? "") }

The value as browsers read it, or empty if there's none: without its
quotes, and with character references, such as `&amp;`, decoded.

      public get value(): String {
        decodeAttributeValue(unquote(node.childOfKind(attributeValueKind)?.asWritten ?? ""))
      }

      public get hasValue(): Boolean { node.childOfKind(equalsKind) != null }

A new tree with this attribute's value replaced by `value`, written in
double quotes and escaped. Only the value changes; the name, the tag,
and everything else stay as written. Gives the new tree's top, which
is an `HtmlTokens` for HTML on its own. For HTML inside another tree,
such as a Markdown document, the new top is that tree's: wrap
`.node` in its own view, such as `new MarkdownDocument(top.node)`.

      public withValue(value: String): HtmlTokens {
        let quoted = new GreenToken(attributeValueKind, "\"${escapeHtml(value)}\"");
        let kids = node.green.children.toListBuilder();
        let old = node.childOfKind(attributeValueKind);
        if (old != null) {
          kids.set(old.index, quoted);
        } else {
          kids.add(new GreenToken(equalsKind, "="));
          kids.add(quoted);
        }
        new HtmlTokens(node.replaceWith(new GreenNode(attributeKind, kids.toList())))
      }
    }

Text without the quotes around it, if any: one at each end, or only
at the start for text the end of the input cut off.

    let unquote(written: String): String {
      let first = if (written.isEmpty) { -1 } else { written[String.begin] };
      if (first != char'"' && first != char'\'') { return written; }
      let start = written.next(String.begin);
      let last = written.prev(written.end);
      if (start <= last && written[last] == first) {
        written.slice(start, last)
      } else {
        written.slice(start, written.end)
      }
    }

An end tag, such as `</a>`.

    export class EndTag extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get name(): String { tagNameOf(node) }
    }

A comment, such as `<!-- note -->`.

    export class Comment extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The text between `<!--` and `-->`, as browsers read it.

      public get text(): String { normalizeText(node.childOfKind(commentTextKind)?.asWritten ?? "", true) }
    }

Text between markup, as browsers read it: character references, such
as `&amp;`, decoded, and line endings as `\n`.

    export class Text extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

      public get text(): String {
        let children = node.green.children;
        if (children.length == 1 && children[0].kind.id == charsKind.id) {
          return normalizeText(node.asWritten, false);
        }
        let out = new StringBuilder();
        for (var i = 0; i < children.length; i += 1) {
          let child = children[i];
          when (child) {
            is GreenToken -> do {
              let id = child.kind.id;
              if (id == charsKind.id) {
                out.append(normalizeText(child.text, false));
              } else if (id == characterReferenceKind.id) {
                out.append(decodeReference(child.text));
              } else if (id == replacedCharKind.id) {
                out.append("\u{FFFD}");
              }
            }
            else -> do {}
          }
        }
        out.toString()
      }
    }

A DOCTYPE, such as `<!DOCTYPE html>`.

    export class Doctype extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The name, lowercased, or null if it has none.

      public get name(): String? {
        let written = node.childOfKind(doctypeNameKind);
        if (written == null) { null } else { htmlName(written.asWritten) }
      }

The public and system identifiers, without quotes, or null.

      public get publicId(): String? { identifier(publicIdKind) }
      public get systemId(): String? { identifier(systemIdKind) }

      private identifier(kind: Kind): String? {
        let written = node.childOfKind(kind);
        if (written == null) { null } else { normalizeText(unquote(written.asWritten), true) }
      }

Whether the tokenizer set the force-quirks flag, as for a DOCTYPE
without a name or cut off by the end of the input, which puts the
document in quirks mode.

      public get forceQuirks(): Boolean { node.hasKind(quirksDoctypeKind) }
    }

A processing instruction, such as `<?php echo 1 ?>`, as the HTML
standard reads them since 2026 (before, browsers read them as
comments). Wherever one is written fresh, it ends in `?>`, which HTML
and XML both read.

    export class ProcessingInstruction extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The target, as written (the standard keeps its case).

      public get target(): String { node.childOfKind(piTargetKind)?.asWritten ?? "" }

What follows the target and its whitespace, up to `?>` or `>`, with
line endings as `\n`.

      public get data(): String { normalizeText(node.childOfKind(piDataKind)?.asWritten ?? "", false) }
    }

A tag browsers drop: one cut off by the end of the input, or `</>`,
or a processing instruction cut off by the end of the input. It's not
a token to them, but its text stays, and `tag` is its `StartTag`,
`EndTag`, or `ProcessingInstruction` view.

    export class DroppedTag extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get tag(): HtmlToken { htmlTokenOf(node.childNodes[0]) }
    }

## Tests

    test("typed views") {
      let tokens = tokenizeHtml("<A HREF=\"/x\" Title='t' hidden data-n=1>Go</a><!-- c --><br/>");
      let children = tokens.children;
      assert(children.length == 5) { children.length.toString() };
      let a = children[0] as StartTag orelse panic();
      assert(a.name == "a") { a.name };
      let names = a.attributes.join(",") { (x: Attribute): String => "${x.name}=${x.value}" };
      assert(names == "href=/x,title=t,hidden=,data-n=1") { names };
      assert(!(a.attribute("hidden") as Attribute orelse panic()).hasValue) { "bare attribute" };
      assert(a.attribute("missing") == null) { "no such attribute" };
      assert(!a.selfClosing) { "not self-closing" };
      let text = children[1] as Text orelse panic();
      assert(text.text == "Go") { text.text };
      assert(text.span.toString() == "39+2") { text.span.toString() };
      let end = children[2] as EndTag orelse panic();
      assert(end.name == "a") { end.name };
      let comment = children[3] as Comment orelse panic();
      assert(comment.text == " c ") { comment.text };
      assert((children[4] as StartTag orelse panic()).selfClosing) { "self-closing" };
    }

    test("withValue changes only the value") {
      let text = "<p>x</p><a  HREF = '/old'  title=t>y</a>";
      let tokens = tokenizeHtml(text);
      let href = tokens.startTags[1].attribute("href") as Attribute orelse panic();
      let edited = href.withValue("/new?a=1&b=\"2\"");
      assert(edited.asWritten == "<p>x</p><a  HREF = \"/new?a=1&amp;b=&quot;2&quot;\"  title=t>y</a>") {
        edited.asWritten
      };
      assert(tokens.asWritten == text) { "the old tree is unchanged" };
      let bare = tokenizeHtml("<input disabled>").startTags[0].attributes[0].withValue("");
      assert(bare.asWritten == "<input disabled=\"\">") { bare.asWritten };
    }

    test("views read as browsers read") {
      let tokens = tokenizeHtml(
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\"><a href='?a=1&amp;b=2&copy=3' ID=x id=y>Fish &amp chips &#x80;\r\n</a ><!--a\r\nb--><div"
      );
      let children = tokens.children;
      let doctype = children[0] as Doctype orelse panic();
      assert(doctype.name == "html" && doctype.systemId == null && !doctype.forceQuirks) { "doctype" };
      assert(doctype.publicId == "-//W3C//DTD HTML 4.01//EN") { doctype.publicId ?? "null" };
      let a = children[1] as StartTag orelse panic();
      let names = a.attributes.join(",") { (x: Attribute): String => "${x.name}=${x.value}" };
      assert(names == "href=?a=1&b=2&copy=3,id=x") { names };
      let text = children[2] as Text orelse panic();
      assert(text.text == "Fish & chips €\n") { text.text };
      let comment = children[4] as Comment orelse panic();
      assert(comment.text == "a\nb") { comment.text };
      let dropped = children[5] as DroppedTag orelse panic();
      assert((dropped.tag as StartTag orelse panic()).name == "div") { "dropped" };
      assert(tokenizeHtml("<!doctype>").children[0] is Doctype) { "quirks doctype" };
      assert((tokenizeHtml("<!doctype>").children[0] as Doctype orelse panic()).forceQuirks) { "quirks" };
    }

    test("processing instructions") {
      // No `??>` in literals: C++14 reads it as a trigraph.
      let tokens = tokenizeHtml("<?php echo a?b?><?Foo\r\nx\r\ny><?xml version=1?><?1><?a");
      let children = tokens.children;
      assert(children.length == 5) { children.length.toString() };
      let php = children[0] as ProcessingInstruction orelse panic();
      assert(php.target == "php" && php.data == "echo a?b") { php.data };
      let foo = children[1] as ProcessingInstruction orelse panic();
      assert(foo.target == "Foo" && foo.data == "x\ny") { foo.data };
      assert((children[2] as Comment orelse panic()).text == "?xml version=1?") { "xml" };
      assert((children[3] as Comment orelse panic()).text == "?1") { "digit" };
      let dropped = children[4] as DroppedTag orelse panic();
      assert((dropped.tag as ProcessingInstruction orelse panic()).target == "a") { "dropped" };
    }
