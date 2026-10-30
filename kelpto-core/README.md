# kelpto-core

The lossless tree kelpto-md and kelpto-html share. Most people never
use it directly.

- **Green elements** (`GreenNode`, `GreenToken`): immutable, with a
  kind, and children or text, and a width in code points, but no
  position, so versions of a document share them.
- **`GreenNodeBuilder`:** start a node, add tokens, finish the node,
  as rust-analyzer's rowan does; mutable while building.
- **Red elements** (`RedNode`, `RedToken`): cheap views with a parent,
  an offset, a `span`, and `asWritten`, made as you walk.
- **`replaceWith`:** a new root, copying only the path to the
  replaced node.
- **`Span`** (start and length in code points), **`Kind`** (an id and
  a name), and **`SourceText`** (text indexed by code point).

```temper
let word = new Kind(1000, "Word");
let line = new Kind(1001, "Line");
let builder = new GreenNodeBuilder();
builder.startNode(line);
builder.token(word, "hello");
builder.token(word, " world");
builder.finishNode();
let root = redRoot(builder.finish());
let second = root.children[1];
second.span.toString();      // "5+6"
second.asWritten;            // " world"
```

Planned: chunked children for wide parents, interning small green
elements, and HTML's named character references.
