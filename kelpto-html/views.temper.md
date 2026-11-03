# Typed views and edits

Typed views over the red tree, each wrapping one red node, as in
kelpto-md. `HtmlToken` is what the tokenizer gives at the top level:
`StartTag`, `EndTag`, `Comment`, and `Text`.

Why `StartTag` and not `Element`: an element is what tree construction
builds, from a start tag, its end tag (or none), and what's between,
and it can differ from the source's nesting. The name `Element` is kept
for that view, which comes later.

    let {
      GreenNode, GreenToken, RedNode, Span, asciiLowercase,
      escapeHtml,
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
      new Text(node)
    }

    let tagNameOf(node: RedNode): String {
      asciiLowercase(node.childOfKind(tagNameKind)?.asWritten ?? "")
    }

A start tag, such as `<a href="/x">`.

    export class StartTag extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }

The name, ASCII-lowercased, as HTML compares it.

      public get name(): String { tagNameOf(node) }

      public get attributes(): List<Attribute> {
        let result = new ListBuilder<Attribute>();
        let nodes = node.childNodes;
        for (var i = 0; i < nodes.length; i += 1) {
          result.add(new Attribute(nodes[i]));
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

      public get name(): String { asciiLowercase(node.childOfKind(attributeNameKind)?.asWritten ?? "") }

The value without its quotes, or empty if there's none. Not yet:
character references, such as `&amp;`, are left as written.

      public get value(): String {
        let written = node.childOfKind(attributeValueKind)?.asWritten ?? "";
        let first = if (written.isEmpty) { -1 } else { written[String.begin] };
        if (first == char'"' || first == char'\'') {
          written.slice(written.next(String.begin), written.prev(written.end))
        } else {
          written
        }
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

The text between `<!--` and `-->`.

      public get text(): String { node.childOfKind(commentTextKind)?.asWritten ?? "" }
    }

Text between markup. Not yet: character references are left as
written, so `text` is `&amp;` where a browser reads `&`.

    export class Text extends HtmlToken {
      public node: RedNode;
      public constructor(node: RedNode) { this.node = node; }
      public get asWritten(): String { node.asWritten }
      public get span(): Span { node.span }
      public get text(): String { node.asWritten }
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
