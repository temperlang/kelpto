# kelpto-html

Lossless HTML: tokenize, edit one part, and print the rest exactly as
written.

```temper
let tokens = tokenizeHtml("<A HREF='/old?a=1&amp;b=2' class=x>Go</a>");
let a = tokens.startTags[0];
a.name;                          // "a" (lowercased, as HTML compares)
a.attributes[0].value;           // "/old?a=1&b=2" (references decoded)
let href = a.attribute("href") as Attribute orelse panic();
href.withValue("/new").asWritten; // "<A HREF=\"/new\" class=x>Go</a>"

let result = HtmlTokenizer.html.tokenize("<p id=a id=b>");
result.errors[0].code;           // "duplicate-attribute"

let doc = parseHtml("<p>One<p>Two<table><td>x</table>");
doc.body?.children.length;       // 2: the two p elements
doc.html;                        // "<html><head></head><body><p>One</p><p>Two<table><tbody>…"

let cells = parseHtmlFragment("<td>1<td>2", new FragmentContext("tr"));
cells.html;                      // "<td>1</td><td>2</td>", as innerHTML of a tr reads it
parseHtmlFragment("<td>1<td>2", new FragmentContext("div")).html; // "12"

sanitizeHtml("<a href='java&#x09;script:x' onclick=y>Hi</a><script>z</script>").html; // "<a>Hi</a>"
```

- **The WHATWG tokenizer, in full:** every state of the HTML
  standard's tokenization section, character references (named,
  with HTML's forms without `;`, and numeric), DOCTYPEs, comments,
  CDATA sections, and the raw text of `<script>`, `<style>`,
  `<title>`, and `<textarea>`. html5lib-tests' tokenizer tests check
  it (see `tests/html5lib-tokenizer` in the repo).
- **Lossless:** every code point stays in the tree, so any input
  prints back exactly. What browsers drop (a repeated attribute, a tag
  cut off by the end of the input) is kept as text the views skip.
- **Typed views:** `StartTag` (name, attributes, and self-closing),
  `EndTag`, `Comment`, `Text`, `Doctype` (name, identifiers, and
  force-quirks), `ProcessingInstruction` (target and data, as the
  standard reads `<?target data?>` since 2026), `DroppedTag`, and
  `Attribute`, each read as browsers read it.
- **The tree browsers build:** `parseHtml` runs the standard's tree
  construction (every insertion mode, foreign content, the adoption
  agency algorithm, and foster parenting) beside the tokens, giving
  `Element`, `BuiltText`, `BuiltComment`, `BuiltDoctype`, and
  `BuiltProcessingInstruction` nodes, each pointing back at its token
  (`Element.startTag`), and `html`, the standard's serialization. WPT's
  tree construction tests check it (see `tests/wpt-tree-construction`).
- **Fragments,** as `innerHTML` parses them: `parseHtmlFragment` reads
  text as if inside a context element (a `FragmentContext`: name,
  namespace, attributes, whether it's in a `form`, and quirks mode, or
  `Element.fragmentContext` for an element already parsed), giving an
  `HtmlFragment` with the same tokens, nodes, and `html` as a
  document.
- **In pieces:** `FragmentStream` parses a fragment fed a piece at a
  time, synthetic tokens and HTML text, carrying the tokenizer's state
  across pieces, with each node's `origin` the red node it came from;
  the `kelpto` library builds Markdown's tree with it.
- **Parse errors** by the standard's codes, with offsets, from
  `HtmlTokenizer.tokenize`.

- **A sanitizer** on the built tree, never the text: `sanitizeHtml`,
  or `sanitize` on a parsed fragment, document, or `FragmentStream`,
  keeps what a `SanitizerPolicy` allows (`standard` by default;
  `withElements`, `withAttributes`, `withSchemes`, `withUrlCheck`,
  and the others change it), drops scripts, styles, event handlers,
  comments, processing instructions, and SVG and MathML unless
  allowed, checks every URL attribute, and gives `SafeHtml`, checked
  to parse back to the tree it was serialized from, with `removals`:
  each element, attribute, URL, or comment removed, with its origin.

Not yet: tree construction's parse errors.
