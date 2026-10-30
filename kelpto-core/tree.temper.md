# Red-green trees

A lossless syntax tree in two layers, after Roslyn and rust-analyzer's
rowan:

- **Green** elements are immutable and know no position. A
  `GreenToken` (a leaf) holds its kind and text; a `GreenNode` holds its
  kind, its children, and its total width in code points. Since green
  elements never know where they are, one can be shared by many
  versions of a document.
- **Red** elements are cheap views made on demand as you walk: a green
  element, its parent, and its absolute offset. They give spans, text,
  and parents, and are thrown away freely.

Printing a tree (`asWritten`) concatenates its tokens' text, so a tree
parsed from some text prints that text again exactly.

```temper inert
let builder = new GreenNodeBuilder();
builder.startNode(someNodeKind);
builder.token(someTokenKind, "hello");
builder.finishNode();
let root = redRoot(builder.finish());
root.asWritten; // "hello"
```

## Spans

Where something is in the source: its `start` and `length` in code
points, as Hrefine's `SourceSpan` counts them. `toString` gives only
where it is, as `start+length`, never the text.

    export class Span(public start: Int, public length: Int) {
      public get end(): Int { start + length }
      public toString(): String { "${start.toString()}+${length.toString()}" }
    }

## Kinds

Each node and token has a `Kind`: a small class with an `id` and a
`name`. Why a class rather than a bare `Int`:

- **Names travel with nodes,** so a tree dump or a failing test reads
  `Heading`, not `102`, with no table to keep in step across libraries.
- **It translates plainly:** a small immutable class in every backend,
  and each green element holds one shared reference to it.
- **Comparisons go by `id`,** through `hasKind`, since Temper has no
  `==` on class instances. Each library takes its own range of ids:
  kelpto-core 0 to 99, kelpto-md 100 to 199, kelpto-html 200 to 299.

Typed views (`Heading`, `StartTag`, and the rest) do the matching, so
most code never compares kinds.

    export class Kind(public id: Int, public name: String) {
      public toString(): String { name }
    }

Text that a parser kept but didn't understand. Both parsers use it, so
nothing is ever lost.

    export let unknownKind = new Kind(1, "Unknown");

## Green elements

Either a node or a token.

    export sealed interface GreenElement {
      public kind: Kind;

The width in code points.

      public width: Int;

Appends the text exactly as written.

      public writeTo(out: StringBuilder): Void;
    }

A leaf: its kind and text.

    export class GreenToken extends GreenElement {
      public kind: Kind;
      public text: String;
      public width: Int;

      public constructor(kind: Kind, text: String) {
        this.kind = kind;
        this.text = text;
        this.width = text.countBetween(String.begin, text.end);
      }

      public writeTo(out: StringBuilder): Void { out.append(text); }
    }

An inner node: its kind, its children, and their total width.

    export class GreenNode extends GreenElement {
      public kind: Kind;
      public children: List<GreenElement>;
      public width: Int;

      public constructor(kind: Kind, children: List<GreenElement>) {
        this.kind = kind;
        this.children = children;
        var width = 0;
        for (var i = 0; i < children.length; i += 1) {
          width += children[i].width;
        }
        this.width = width;
      }

      public writeTo(out: StringBuilder): Void {
        for (var i = 0; i < children.length; i += 1) {
          children[i].writeTo(out);
        }
      }

The text exactly as written.

      public get text(): String {
        let out = new StringBuilder();
        writeTo(out);
        out.toString()
      }

A copy with child `index` replaced, sharing every other child.

      public withChild(index: Int, child: GreenElement): GreenNode {
        let kids = children.toListBuilder();
        kids.set(index, child);
        new GreenNode(kind, kids.toList())
      }
    }

Not yet, but planned:

- **Chunked children:** a document with thousands of top-level blocks
  would copy a long child list on each edit, so wide parents can group
  their children into hidden nodes of, say, 32, keeping each edit's
  copying small.
- **Interning:** identical small green elements (a newline token, a
  `#`) can be shared through a cache while building, saving memory on
  big documents.

## Building

Builds a green tree in one pass, as rowan's `GreenNodeBuilder` does:
start a node, add tokens and nodes, finish it. It's mutable while
building, and what it yields is immutable.

    export class GreenNodeBuilder {
      private kinds: ListBuilder<Kind> = new ListBuilder<Kind>();
      private starts: ListBuilder<Int> = new ListBuilder<Int>();
      private children: ListBuilder<GreenElement> = new ListBuilder<GreenElement>();

      public constructor() {}

Starts a node of `kind`; what's added until the matching `finishNode`
becomes its children.

      public startNode(kind: Kind): Void {
        kinds.add(kind);
        starts.add(children.length);
      }

Adds a token. Empty text adds nothing, so parsers needn't check.

      public token(kind: Kind, text: String): Void {
        if (!text.isEmpty) {
          children.add(new GreenToken(kind, text));
        }
      }

Adds an element built elsewhere, such as a subtree from another
parser, shared rather than copied.

      public element(green: GreenElement): Void {
        children.add(green);
      }

Finishes the node started last.

      public finishNode(): Void {
        let kind = kinds.removeLast();
        let start = starts.removeLast();
        let kids = children.splice(start, children.length - start);
        children.add(new GreenNode(kind, kids));
      }

The finished tree: the one node left once every node is finished.

      public finish(): GreenNode {
        if (!kinds.isEmpty || children.length != 1) {
          panic()
        }
        children[0] as GreenNode orelse panic()
      }
    }

## Red elements

Views of green elements in place: with a parent, an absolute offset,
and so a span. Made on demand, and cheap.

    export sealed interface RedElement {
      public get kind(): Kind;
      public get span(): Span;

The text exactly as written.

      public get asWritten(): String;
      public get parent(): RedNode?;

The index among the parent's children.

      public get index(): Int;

Whether this has `kind`, compared by `id`.

      public hasKind(kind: Kind): Boolean;
    }

The root view of a green tree, at offset 0.

    export let redRoot(green: GreenNode): RedNode {
      new RedNode(green, null, 0, 0)
    }

    export class RedNode extends RedElement {
      public green: GreenNode;
      private parentNode: RedNode?;
      public offset: Int;

This node's index among its parent's children.

      public index: Int;

      public constructor(green: GreenNode, parentNode: RedNode?, offset: Int, index: Int) {
        this.green = green;
        this.parentNode = parentNode;
        this.offset = offset;
        this.index = index;
      }

      public get kind(): Kind { green.kind }
      public get span(): Span { new Span(offset, green.width) }
      public get asWritten(): String { green.text }
      public get parent(): RedNode? { parentNode }
      public hasKind(kind: Kind): Boolean { green.kind.id == kind.id }

The top of the tree this node is in.

      public get root(): RedNode {
        let up = parentNode;
        if (up == null) { this } else { up.root }
      }

Views of the children, with their offsets.

      public get children(): List<RedElement> {
        let result = new ListBuilder<RedElement>();
        var at = offset;
        let kids = green.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          when (kid) {
            is GreenNode -> result.add(new RedNode(kid, this, at, i));
            is GreenToken -> result.add(new RedToken(kid, this, at, i));
          }
          at += kid.width;
        }
        result.toList()
      }

The child nodes only, leaving out tokens, made without views of the
tokens.

      public get childNodes(): List<RedNode> {
        // Each method making children passes `this` itself, rather than
        // calling `children`: C++ makes a method const unless it passes
        // `this` on, but not methods that call such a method (2026-10-30).
        let result = new ListBuilder<RedNode>();
        var at = offset;
        let kids = green.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid is GreenNode) { result.add(new RedNode(kid, this, at, i)); }
          at += kid.width;
        }
        result.toList()
      }

The first child of `kind`, node or token, or null.

      public childOfKind(kind: Kind): RedElement? {
        var at = offset;
        let kids = green.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid.kind.id == kind.id) {
            return when (kid) {
              is GreenNode -> new RedNode(kid, this, at, i);
              is GreenToken -> new RedToken(kid, this, at, i);
            };
          }
          at += kid.width;
        }
        null
      }

A new tree with this node replaced by `replacement`, copying only the
path from here to the root; every other green element is shared. Gives
the new root. This tree is unchanged.

      public replaceWith(replacement: GreenNode): RedNode {
        replaceAt(parentNode, index, replacement)
      }
    }

    export class RedToken extends RedElement {
      public green: GreenToken;
      private parentNode: RedNode;
      public offset: Int;
      public index: Int;

      public constructor(green: GreenToken, parentNode: RedNode, offset: Int, index: Int) {
        this.green = green;
        this.parentNode = parentNode;
        this.offset = offset;
        this.index = index;
      }

      public get kind(): Kind { green.kind }
      public get span(): Span { new Span(offset, green.width) }
      public get asWritten(): String { green.text }
      public get parent(): RedNode? { parentNode }
      public get text(): String { green.text }
      public hasKind(kind: Kind): Boolean { green.kind.id == kind.id }

A new tree with this token replaced, as `RedNode.replaceWith` does.

      public replaceWith(replacement: GreenToken): RedNode {
        replaceAt(parentNode, index, replacement)
      }
    }

Puts `replacement` at `index` in `parent`, then each new parent in its
own parent, up to a new root.

    let replaceAt(parent: RedNode?, index: Int, replacement: GreenElement): RedNode {
      if (parent == null) {
        redRoot(replacement as GreenNode orelse panic())
      } else {
        replaceAt(parent.parent, parent.index, parent.green.withChild(index, replacement))
      }
    }

## Tests

    let tokenKind = new Kind(2, "Token");
    let nodeKind = new Kind(3, "Node");

    let sample(): GreenNode {
      let builder = new GreenNodeBuilder();
      builder.startNode(nodeKind);
      builder.token(tokenKind, "a");
      builder.startNode(nodeKind);
      builder.token(tokenKind, "bé");
      builder.token(tokenKind, "");
      builder.token(tokenKind, "c");
      builder.finishNode();
      builder.token(tokenKind, "d");
      builder.finishNode();
      builder.finish()
    }

    test("builder, widths, and text") {
      let green = sample();
      assert(green.text == "abécd") { green.text };
      assert(green.width == 5) { green.width.toString() };
      assert(green.children.length == 3) { "empty tokens are dropped" };
    }

    test("red views: spans, parents, and kinds") {
      let root = redRoot(sample());
      let inner = root.childNodes[0];
      assert(inner.span.toString() == "1+3") { inner.span.toString() };
      assert(inner.asWritten == "béc") { inner.asWritten };
      assert(inner.hasKind(nodeKind)) { "kind" };
      let last = inner.children[1];
      assert(last.span.toString() == "3+1") { last.span.toString() };
      assert(last.parent?.span?.toString() == "1+3") { "parent" };
      assert(inner.root.span.toString() == "0+5") { "root" };
    }

    test("replacing copies only the path") {
      let root = redRoot(sample());
      let inner = root.childNodes[0];
      let token: GreenElement = new GreenToken(tokenKind, "XYZW");
      let newRoot = inner.replaceWith(new GreenNode(nodeKind, [token]));
      assert(newRoot.asWritten == "aXYZWd") { newRoot.asWritten };
      assert(root.asWritten == "abécd") { "the old tree is unchanged" };
      assert(newRoot.span.length == 6) { "widths follow" };
      let token = newRoot.children[2] as RedToken orelse panic();
      assert(token.span.toString() == "5+1") { token.span.toString() };
      let swapped = token.replaceWith(new GreenToken(tokenKind, "!"));
      assert(swapped.asWritten == "aXYZW!") { swapped.asWritten };
    }
