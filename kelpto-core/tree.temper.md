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
- **Comparisons go by `id`.** `==` works on kinds (`@auto("==")`
  compares `id` and `name`), but `hasKind` and the parsers compare ids
  alone, a single integer check. Each library takes its own range of
  ids: kelpto-core 0 to 99, kelpto-md 100 to 199, kelpto-html 200 to
  299.

Typed views (`Heading`, `StartTag`, and the rest) do the matching, so
most code never compares kinds.

    @auto("==")
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

With a stack of nodes and where each is up to, not recursion, so
thousands of nested block quotes can't overflow the call stack.

      public writeTo(out: StringBuilder): Void {
        let nodes = new ListBuilder<GreenNode>();
        let nexts = new ListBuilder<Int>();
        nodes.add(this);
        nexts.add(0);
        while (!nodes.isEmpty) {
          let top = nodes.length - 1;
          let node = nodes[top];
          let next = nexts[top];
          if (next < node.children.length) {
            nexts.set(top, next + 1);
            let child = node.children[next];
            when (child) {
              is GreenNode -> do {
                nodes.add(child);
                nexts.add(0);
              };
              else -> child.writeTo(out);
            }
          } else {
            nodes.removeLast();
            nexts.removeLast();
          }
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

## Building

Builds a green tree in one pass, as rowan's `GreenNodeBuilder` does:
start a node, add tokens and nodes, finish it. It's mutable while
building, and what it yields is immutable.

**Identical small elements are shared,** as rowan does: a token of up
to `shareWidth` code points is made once per kind and text, so each
line ending, space, `*`, or indent of a document is one object, and so
is a node whose only child is such a token, such as a blank line.
Green elements are immutable and never know where they are, so one
can stand in many places, and in edited trees too. The caches belong
to one builder, so one parse. Each is a map keyed by the text alone:
an entry is used only when its kinds match too, and replaced when they
don't. Longer tokens skip the maps, since they repeat much less, and
hashing them would cost more than checking the width first (measured
in JavaScript, 2026-11-03).

    export class GreenNodeBuilder {
      private kinds: ListBuilder<Kind> = new ListBuilder<Kind>();
      private starts: ListBuilder<Int> = new ListBuilder<Int>();
      private children: ListBuilder<GreenElement> = new ListBuilder<GreenElement>();
      private tokens: MapBuilder<String, GreenToken> = new MapBuilder<String, GreenToken>();
      private nodes: MapBuilder<String, GreenNode> = new MapBuilder<String, GreenNode>();

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
          if (text.hasAtLeast(String.begin, text.end, shareWidth + 1)) {
            children.add(new GreenToken(kind, text));
          } else {
            let shared = tokens.getOr(text, noToken);
            if (shared.kind.id == kind.id) {
              children.add(shared);
            } else {
              let token = new GreenToken(kind, text);
              tokens[text] = token;
              children.add(token);
            }
          }
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
        let only = if (children.length - start == 1) { tokenOrNone(children[start]) } else { noToken };
        if (only.width <= shareWidth) {
          let shared = nodes.getOr(only.text, noNode);
          if (shared.kind.id == kind.id && shared.children[0].kind.id == only.kind.id) {
            children.set(start, shared);
          } else {
            let node = new GreenNode(kind, children.splice(start, 1));
            nodes[only.text] = node;
            children.add(node);
          }
        } else {
          let kids = children.splice(start, children.length - start);
          children.add(new GreenNode(kind, kids));
        }
      }

The finished tree: the one node left once every node is finished.

      public finish(): GreenNode {
        if (!kinds.isEmpty || children.length != 1) {
          panic()
        }
        children[0] as GreenNode orelse panic()
      }
    }

The widest token shared, in code points: enough for line endings,
markers, and indents, which make most of a document's tokens.

    let shareWidth = 4;

What the caches give for text they don't have: a kind no element has,
and too wide to share.

    let noToken = new GreenToken(new Kind(-1, "None"), "-----");
    let noElement: GreenElement = noToken;
    let noNode = new GreenNode(noToken.kind, [noElement]);

    let tokenOrNone(element: GreenElement): GreenToken {
      when (element) {
        is GreenToken -> element;
        else -> noToken;
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

## Many replacements at once

One edit to make: `target`, a node or token, and the green element to
put in its place.

    export class Replacement(public target: RedElement, public replacement: GreenElement) {

A new tree with just this replacement, as `replaceWith` makes it.

      public apply(): RedNode {
        let parent = target.parent;
        if (parent == null) {
          redRoot(replacement as GreenNode orelse panic())
        } else {
          replaceAt(parent, target.index, replacement)
        }
      }
    }

A new tree with every one of `replacements` made at once: each node on
a path from a target to the root is copied once, however many targets
are under it, and every other green element is shared, so a hundred
edits don't make a hundred intermediate trees. The order of
`replacements` doesn't matter. This tree is unchanged.

Bubbles if two targets overlap (one is, or holds, another), or if a
target isn't in this tree, as far as a cheap check sees: each step of
its path must have the kind and width it has here.

    export let replaceAll(root: RedNode, replacements: List<Replacement>): RedNode throws Bubble {
      let none: List<Splice> = [];
      editAll(root, replacements, none)
    }

One change to a node's list of children, for inserting and removing:
the children from `from` up to `to` (none, to insert) give way to
`elements` (none, to remove).

    export class Splice(
      public parent: RedNode, public from: Int, public to: Int, public elements: List<GreenElement>,
    ) {}

As `replaceAll`, with `splices` made too, in the same pass. A
replacement is a splice of one child. Bubbles, as there, when edits
overlap: a target inside a spliced range, ranges sharing a child, or
two insertions at one place, whose order would be unclear.

    export let editAll(
      root: RedNode, replacements: List<Replacement>, splices: List<Splice>,
    ): RedNode throws Bubble {
      let n = replacements.length + splices.length;
      if (n == 0) { return root; }
      let paths = new ListBuilder<List<Int>>();
      let froms = new ListBuilder<Int>();
      let tos = new ListBuilder<Int>();
      let elements = new ListBuilder<List<GreenElement>>();
      for (var i = 0; i < replacements.length; i += 1) {
        let replacement = replacements[i];
        let target = replacement.target;
        let parent = target.parent;
        if (parent == null) {

The root itself: nothing else can change with it.

          pathTo(root.green, target);
          if (n > 1) { bubble(); }
          return redRoot(replacement.replacement as GreenNode orelse bubble());
        }
        paths.add(pathTo(root.green, parent as RedNode orelse panic()));
        froms.add(target.index);
        tos.add(target.index + 1);
        elements.add([replacement.replacement]);
      }
      for (var i = 0; i < splices.length; i += 1) {
        let splice = splices[i];
        if (splice.from < 0 || splice.to < splice.from || splice.to > splice.parent.green.children.length) {
          bubble();
        }
        paths.add(pathTo(root.green, splice.parent));
        froms.add(splice.from);
        tos.add(splice.to);
        elements.add(splice.elements);
      }
      let order = new ListBuilder<Int>();
      for (var i = 0; i < n; i += 1) { order.add(i); }
      let edits = new Edits(paths.toList(), froms.toList(), tos.toList(), elements.toList());
      let sorted = order.toList().sorted { (a: Int, b: Int): Int =>
        let byPath = comparePaths(edits.paths[a], edits.paths[b]);
        if (byPath != 0) { byPath } else if (edits.froms[a] != edits.froms[b]) {
          edits.froms[a] - edits.froms[b]
        } else { edits.tos[a] - edits.tos[b] }
      };
      redRoot(rebuild(root.green, 0, edits, sorted, 0, n))
    }

Every edit as a splice of its parent's children: the parent's path,
and the range and what replaces it.

    class Edits(
      public paths: List<List<Int>>, public froms: List<Int>, public tos: List<Int>,
      public elements: List<List<GreenElement>>,
    ) {}

The child indices from the root down to `target`, checked against
`root`'s tree.

    let pathTo(root: GreenNode, target: RedElement): List<Int> throws Bubble {
      let reversed = new ListBuilder<Int>();
      let greens = new ListBuilder<GreenElement>();
      greens.add(when (target) {
        is RedNode -> target.green;
        is RedToken -> target.green;
      });
      var up: RedElement = target;
      var parent = target.parent;
      while (parent != null) {
        let node = parent as RedNode orelse panic();
        reversed.add(up.index);
        greens.add(node.green);
        up = node;
        parent = node.parent;
      }
      let top = greens[greens.length - 1];
      if (top.kind.id != root.kind.id || top.width != root.width) { bubble(); }
      let path = new ListBuilder<Int>();
      var at: GreenElement = root;
      for (var i = reversed.length - 1; i >= 0; i -= 1) {
        let index = reversed[i];
        let node = at as GreenNode orelse bubble();
        if (index >= node.children.length) { bubble(); }
        at = node.children[index];
        let expected = greens[i];
        if (at.kind.id != expected.kind.id || at.width != expected.width) { bubble(); }
        path.add(index);
      }
      path.toList()
    }

Lexicographic, so a path comes just before the paths inside it.

    let comparePaths(a: List<Int>, b: List<Int>): Int {
      let shorter = if (a.length < b.length) { a.length } else { b.length };
      for (var i = 0; i < shorter; i += 1) {
        if (a[i] != b[i]) { return a[i] - b[i]; }
      }
      a.length - b.length
    }

`green` with the edits `sorted[from]` to `sorted[to - 1]`, whose paths
all pass through it, at `depth`, made: the edits of its own children
first (the shortest paths sort first), then each child holding edits,
rebuilt once; the child list is copied once.

    let rebuild(
      green: GreenNode, depth: Int, edits: Edits, sorted: List<Int>, from: Int, to: Int,
    ): GreenNode throws Bubble {
      let kids = green.children;
      var hereEnd = from;
      while (hereEnd < to && edits.paths[sorted[hereEnd]].length == depth) { hereEnd += 1; }
      for (var h = from; h < hereEnd; h += 1) {
        let edit = sorted[h];
        if (edits.tos[edit] > kids.length) { bubble(); }
        if (h > from) {
          let before = sorted[h - 1];
          let empties = edits.froms[before] == edits.tos[before] && edits.froms[edit] == edits.tos[edit];
          if (edits.tos[before] > edits.froms[edit] || (empties && edits.froms[before] == edits.froms[edit])) {
            bubble();
          }
        }
      }
      let out = new ListBuilder<GreenElement>();
      var i = 0;
      var h = from;
      var d = hereEnd;
      while (true) {
        var skipTo = i;
        while (h < hereEnd && edits.froms[sorted[h]] == i) {
          let added = edits.elements[sorted[h]];
          for (var k = 0; k < added.length; k += 1) { out.add(added[k]); }
          if (edits.tos[sorted[h]] > skipTo) { skipTo = edits.tos[sorted[h]]; }
          h += 1;
        }
        if (skipTo > i) {
          if (d < to && edits.paths[sorted[d]][depth] < skipTo) { bubble(); }
          i = skipTo;
          continue;
        }
        if (i >= kids.length) { break; }
        if (d < to && edits.paths[sorted[d]][depth] == i) {
          var e = d + 1;
          while (e < to && edits.paths[sorted[e]][depth] == i) { e += 1; }
          let child = kids[i] as GreenNode orelse bubble();
          out.add(rebuild(child, depth + 1, edits, sorted, d, e));
          d = e;
        } else {
          out.add(kids[i]);
        }
        i += 1;
      }
      if (h < hereEnd || d < to) { bubble(); }
      new GreenNode(green.kind, out.toList())
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

    test("shared tokens and nodes keep their kinds") {
      let builder = new GreenNodeBuilder();
      builder.startNode(nodeKind);
      for (var i = 0; i < 2; i += 1) {
        builder.token(tokenKind, "*");
        builder.token(nodeKind, "*");
        builder.startNode(nodeKind);
        builder.token(tokenKind, "\n");
        builder.finishNode();
        builder.startNode(tokenKind);
        builder.token(tokenKind, "\n");
        builder.finishNode();
        builder.startNode(nodeKind);
        builder.token(nodeKind, "\n");
        builder.finishNode();
        builder.token(tokenKind, "abcde");
      }
      builder.finishNode();
      let kids = builder.finish().children;
      let kinds = new ListBuilder<String>();
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];
        kinds.add(when (kid) {
          is GreenNode -> "${kid.kind.name}(${kid.children[0].kind.name} ${kid.width.toString()})";
          is GreenToken -> "${kid.kind.name} ${kid.text}";
        });
      }
      let expected = "Token *,Node *,Node(Token 1),Token(Token 1),Node(Node 1),Token abcde";
      assert(kinds.join(",") { (s: String): String => s } == "${expected},${expected}") {
        kinds.join(",") { (s: String): String => s }
      };
    }

    test("red views: spans, parents, and kinds") {
      let root = redRoot(sample());
      let inner = root.childNodes[0];
      assert(inner.span.toString() == "1+3") { inner.span.toString() };
      assert(inner.asWritten == "béc") { inner.asWritten };
      assert(inner.hasKind(nodeKind)) { "kind" };
      assert(new Kind(nodeKind.id, nodeKind.name) == nodeKind) { "kind ==" };
      assert(nodeKind != tokenKind) { "kind !=" };
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

    test("replaceAll makes many replacements in one pass") {
      let root = redRoot(sample());
      let inner = root.childNodes[0];
      let a = root.children[0] as RedToken orelse panic();
      let c = inner.children[1] as RedToken orelse panic();
      let d = root.children[2] as RedToken orelse panic();
      let edits = [
        new Replacement(d, new GreenToken(tokenKind, "D")),
        new Replacement(a, new GreenToken(tokenKind, "AA")),
        new Replacement(c, new GreenToken(tokenKind, "C")),
      ];
      let edited = replaceAll(root, edits) orelse panic();
      assert(edited.asWritten == "AAbéCD") { edited.asWritten };
      assert(root.asWritten == "abécd") { "the old tree is unchanged" };
      let none: List<Replacement> = [];
      assert((replaceAll(root, none) orelse panic()).asWritten == "abécd") { "no edits" };
      assert(edits[1].apply().asWritten == "AAbécd") { "one edit" };
      let overlap = do {
        replaceAll(root, [edits[2], new Replacement(inner, new GreenNode(nodeKind, []))]);
        "accepted"
      } orelse "bubbled";
      assert(overlap == "bubbled") { "a target inside another" };
      let twice = do { replaceAll(root, [edits[0], edits[0]]); "accepted" } orelse "bubbled";
      assert(twice == "bubbled") { "the same target twice" };
      let other = redRoot(new GreenNode(nodeKind, [new GreenToken(tokenKind, "zz")]));
      let foreign = new Replacement(other.children[0], new GreenToken(tokenKind, "y"));
      let stranger = do { replaceAll(root, [foreign]); "accepted" } orelse "bubbled";
      assert(stranger == "bubbled") { "a target from another tree" };
    }

    test("editAll inserts, removes, and replaces children with replacements") {
      let root = redRoot(sample());
      let inner = root.childNodes[0];
      let a = root.children[0] as RedToken orelse panic();
      let c = inner.children[1] as RedToken orelse panic();
      let x: GreenElement = new GreenToken(tokenKind, "x");
      let y: GreenElement = new GreenToken(tokenKind, "y");
      let none: List<GreenElement> = [];
      let edited = editAll(
        root, [new Replacement(c, new GreenToken(tokenKind, "C"))],
        [
          new Splice(root, 3, 3, [x, y]), new Splice(inner, 0, 0, [y]), new Splice(root, 0, 0, [x]),
          new Splice(root, 2, 3, none),
        ],
      ) orelse panic();
      assert(edited.asWritten == "xaybéCxy") { edited.asWritten };
      let removed = editAll(root, [], [new Splice(root, 0, 2, none)]) orelse panic();
      assert(removed.asWritten == "d") { removed.asWritten };
      let noReplacements: List<Replacement> = [];
      let inside = do {
        editAll(root, [new Replacement(a, x)], [new Splice(root, 0, 1, none)]);
        "accepted"
      } orelse "bubbled";
      assert(inside == "bubbled") { "a target in a removed range" };
      let deeper = do {
        editAll(root, [new Replacement(c, x)], [new Splice(root, 1, 2, none)]);
        "accepted"
      } orelse "bubbled";
      assert(deeper == "bubbled") { "a target inside a removed child" };
      let samePlace = do {
        editAll(root, noReplacements, [new Splice(root, 1, 1, [x]), new Splice(root, 1, 1, [y])]);
        "accepted"
      } orelse "bubbled";
      assert(samePlace == "bubbled") { "two insertions at one place" };
      let crossing = do {
        editAll(root, noReplacements, [new Splice(root, 0, 2, none), new Splice(root, 1, 3, none)]);
        "accepted"
      } orelse "bubbled";
      assert(crossing == "bubbled") { "ranges sharing a child" };
      let beside = editAll(root, [new Replacement(a, x)], [new Splice(root, 1, 1, [y])]) orelse panic();
      assert(beside.asWritten == "xybécd") { beside.asWritten };
      let past = do { editAll(root, noReplacements, [new Splice(root, 4, 4, [x])]); "accepted" } orelse "bubbled";
      assert(past == "bubbled") { "past the end" };
    }
