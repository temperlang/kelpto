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
- **Parse errors** by the standard's codes, with offsets, from
  `HtmlTokenizer.tokenize`.

Not yet: fragment parsing, tree construction's parse errors, and a
sanitizer (which will drop processing instructions by default).
