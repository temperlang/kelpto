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
  replaced node; **`replaceAll`** makes many `Replacement`s at once,
  copying each shared path once.
- **`Span`** (start and length in code points), **`Kind`** (an id and
  a name), and **`SourceText`** (a string indexed by code point; the
  parsers read by `StringIndex` instead).

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

Also what both parsers need of text:

- **Character references:** `namedCharacterReference("ouml;")` gives
  `"ö"`, from HTML's 2,125 names; HTML's 106 forms without `;` also
  work (`"amp"`), which CommonMark doesn't use. `characterReferenceEnd`
  finds one in a string by `StringIndex`, by CommonMark's rules, numeric ones included, and
  `decodeCharacterReference` gives its value.
- **Unicode 18:** `isUnicodePunctuation` (P and S),
  `isUnicodeWhitespace` (Zs, tab, line feed, form feed, and carriage
  return), and `caseFold` (full: `"ẞ"` gives `"ss"`).

Planned: chunked children for wide parents, and interning small green
elements.
