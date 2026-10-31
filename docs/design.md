# Design sketch: each library alone, and together

A first sketch (2026-10-30). Nothing here is decided unless it says
so; it's meant to make the choices visible. See [plan.md](plan.md) for
goals and tests.

## Decided so far (the user, 2026-10-30)

- **Four libraries,** with a separate `kelpto-core`.
- **URLs are a wrapper on `String` for now** (say `LinkTarget`), with
  no URL processing yet; revisit later. If Hrefine comes in, it comes
  as a git submodule, and some of its Unicode processing might be
  extracted for shared use.
- **Order:** settle how kelpto-md and kelpto-html coordinate, then
  build the Markdown side only.
- **Red-green trees from the start,** as in "Edits without heavy
  copying", below, since retrofitting positions is hard.

## Status (2026-10-31)

Real, tested Temper in all four libraries. Each library's README shows
it in use, and the top README shows them alone and together.

- **kelpto-core:** red-green trees (`GreenNode`, `GreenToken`,
  `GreenNodeBuilder`, `RedNode`, and `RedToken`), `Span`, `Kind`, and
  `SourceText`, with `replaceWith` copying only the path to the root.
  Also HTML's character references (named ones from html5lib-tests,
  each with a flag for HTML's forms without `;`, and numeric ones), and
  Unicode 18's punctuation, whitespace, and full case folding, as small
  generated tables read in place (see "Generated tables", below).
  Kinds are small classes with an id and a name, so names travel with
  nodes into dumps and test failures; they compare by id, since
  Temper has no `==` on class instances. Each library takes a range of
  ids (core 0 to 99, md 100 to 199, html 200 to 299).
- **kelpto-md:** all of CommonMark 0.31.2, lossless: blocks by the
  spec's two-phase algorithm (see "kelpto-md's blocks", below), and
  inlines by its delimiter algorithm (see "kelpto-md's inlines").
  Typed views by where a node may go (`BlockChild`, `ListChild`,
  `ParagraphChild`, and `LinkTextChild`); edits `Heading.withText` and
  `withLevel`, `CodeBlock.withInfo`, and `withDestination` on
  definitions, inline links, and images; rendering with raw HTML
  escaped unless `withRawHtmlTrusted()`. All 652 of the spec's
  examples pass, in `tests/commonmark/`. GFM's extensions are opt-in
  (see "kelpto-md's GFM extensions", below).
- **kelpto-html:** a simplified tokenizer (start tags with attributes,
  end tags, comments, and text), typed views (`StartTag`, `EndTag`,
  `Comment`, `Text`, and `Attribute`), and `Attribute.withValue`.
  `Element` is saved for the built tree.
- **kelpto:** `ParsedRawHtml`, `parseMarkdownWithHtml`, `htmlOf`, and
  a `renderSafe` sketch giving `SafeHtml`.

**How they coordinate:** kelpto-md defines two interfaces and never
imports kelpto-html.

- **`RawHtmlHandler`** gives the children of each `RawHtml` node and
  `HtmlBlock`. The default, `OpaqueRawHtml`, keeps one token; kelpto's
  `ParsedRawHtml` gives kelpto-html's green subtree, so the HTML sits
  in the Markdown tree, lossless. kelpto-md checks the children's text
  matches and falls back to opaque if not, so a faulty handler can't
  lose text. HTML split by container prefixes (an HTML block in a
  block quote, say) stays opaque text between them for now.
- **`RawHtmlRenderer`** renders each `RawHtmlContent` (inline or a
  block): escaped by default, as written with `withRawHtmlTrusted()`,
  or kelpto's allowlist for `renderSafe`.
- **Shared red nodes:** kelpto-html's views wrap any red node of its
  kinds, so `htmlOf(rawHtml)` views the subtree in place, and an HTML
  edit there gives a new root that `new MarkdownDocument(top.node)`
  views as Markdown again.

Every input prints back exactly: text a parser doesn't understand
stays text. Tests in each library check roundtrips on ordinary, odd,
and invalid input, the typed views, that edits change only their span,
and rendering defaults.

### kelpto-md's blocks

- **Two passes:** the first follows cmark's block algorithm line by
  line, recording for each line its container prefixes (each `>`, list
  marker, and indentation, with the block it belongs to) and which
  leaf takes the rest. The second writes the green tree from that, so
  every code point lands in one token.
- **Prefixes where they fall:** a container's prefix on its first line
  is in its own node; on later lines it's a token in whatever node is
  open there, such as a paragraph spanning lines. Views skip them.
- **Tabs:** kept as written, with columns counted as the spec says. A
  tab partly used by a prefix goes to the block after it as a
  `TabRemainder1` to `3` token, which code shows as that many spaces.
- **Blank lines and definitions** are nodes, so they keep their text;
  a list's tightness is computed from where blank lines are, so it
  follows edits.

### kelpto-md's inlines

- **One pass, then emphasis,** as cmark does: a left-to-right scan
  making items (ranges of the paragraph's text, or nodes holding
  items), with stacks of delimiter runs and brackets, then the spec's
  "process emphasis". `TreeWriter` writes the items as tokens, so line
  breaks and prefixes inside them land as in blocks.
- **Lossless:** delimiter runs are text, with only the `*` or `_` that
  emphasis uses in `EmphasisMarker` tokens; links keep their
  brackets, parentheses, whitespace, destination, title, and label as
  tokens; a character reference keeps its text, with its value a view.
- **References** resolve when the tree is read: the parser needs only
  which labels the document defines, and a reference link's
  destination is its definition's, so it follows edits to the
  definition. `LinkTarget` stays as written (escapes and references
  resolved); the renderer percent-encodes only when it writes HTML.
- **Linear,** checked on cmark's pathological shapes: `openers_bottom`
  for emphasis, link openers deactivated by a mark rather than one by
  one, and failed searches for closing backticks or HTML ends not
  repeated.

### kelpto-md's GFM extensions

- **Opt-in, by parser:** `MarkdownParser.gfm` has all four syntax
  extensions, `MarkdownParser.commonMark` none, and `withTables`,
  `withTaskListItems`, `withStrikethrough`, `withExtendedAutolinks`,
  and `withRawHtmlHandler` change one, as Hrefine's `UrlPolicy` does,
  so no named arguments are needed. `parseMarkdown` is `commonMark`.
  The disallowed raw HTML filter is on rendering,
  `withDisallowedRawHtmlFiltered()`, wrapping the `RawHtmlRenderer`.
- **As cmark-gfm 0.29.0.gfm.13 does it,** odd corners included (tables
  stop filling short rows after 524,288 empty cells, `~` runs read 100
  at a time, emails found in text after the rest), since GitHub renders
  by it. All of GFM's spec examples and cmark-gfm's extension tests
  pass, in `tests/gfm/`, but nine where cmark-gfm's renderer drops a
  `<strong>` directly inside another. One choice follows the spec
  instead: task list items work inside block quotes and on a nested
  item's line, where cmark-gfm, looking from the line's start, misses
  them.
- **Lossless:** a table is a leaf block whose lines are row nodes, with
  `Pipe`, `TableDelimiter`, and cell nodes; a backslash before `|` in a
  cell is a `PipeEscape` token, since GFM drops it before reading the
  cell. Task markers are tokens in their item, strikethrough's runs
  `StrikethroughMarker` tokens, and each extended autolink style a
  node kind.
- **Edits reparse as parsed:** the root's kind records the inline
  extensions, so `Heading.withText` and `TableCell.withText` escape
  `~` (and `|` in cells) only where needed.
- **No cost when off:** each check is behind its flag, and only `~`,
  `:`, and `w` gain cases in the inline scan.

### Generated tables

Scripts in `scripts/` write them into kelpto-core from pinned sources,
checking every entry as the Temper code reads it:

- **`unicode-tables.temper.md`** (`unicode_tables.py`): punctuation
  (P and S, 359 ranges) and full case folding (C and F, 313 entries
  for 1,606 code points) as base-32 strings in chunks of 16, found by
  binary search over a short list of chunk starts, then read in
  place; whitespace as 9 ranges. 2,947 characters of strings, 4.8 KB
  of source.
- **`entities.temper.md`** (`character_references.py`): the 2,125
  named references, sorted and front-coded, 14,263 characters, read
  into a map when the library loads.

**Next,** roughly in order:

1. Edit batches (`doc.edit`), insert and remove, and more edits (link
   text, titles, and emphasis).
2. The WHATWG tokenizer in full, with kelpto-core's character
   references (and HTML's forms without `;`), then tree construction,
   against html5lib-tests and WPT.
3. A real sanitizer on the built tree, with links checked, replacing
   the `renderSafe` sketch.
4. Chunked children and interning, once documents are big enough to
   measure; deep nesting (thousands of block quotes or emphasis
   levels) without deep recursion.
5. GFM's rest: footnotes, and maybe a renderer option for cmark-gfm's
   merged nested `<strong>`; more edits for tables (rows and columns).

## Libraries and layout

One repo, one Temper worktree, libraries in subdirectories, versioned
together:

| Directory | Package | What it is |
|---|---|---|
| `kelpto-core/` | `kelpto-core` | Spans, the lossless tree's shared interfaces, and HTML's character references. Small, with no dependencies. |
| `kelpto-md/` | `kelpto-md` | CommonMark, lossless: parse, edit, print, and render. |
| `kelpto-html/` | `kelpto-html` | The WHATWG HTML parser, lossless, plus a sanitizer. |
| `kelpto/` | `kelpto` | Both together: HTML inside Markdown understood as HTML, and safe rendering of Markdown in one call. |

Dependencies go one way, so there's no cycle:

```mermaid
graph BT
  core[kelpto-core]
  md[kelpto-md] --> core
  html[kelpto-html] --> core
  html --> hrefine[hrefine]
  md --> hrefine
  kelpto[kelpto] --> md
  kelpto --> html
```

Why four rather than two: Markdown alone shouldn't carry an HTML
parser (most of the size), and HTML alone shouldn't carry a Markdown
parser, yet both need spans, the same tree interfaces, and the
character references (about 2,200 entries). `kelpto-core` is that
shared part, and most users never name it. The umbrella package takes
the plain name, `kelpto`, so "install kelpto" gets everything.

## Shared ideas (kelpto-core)

- **Spans:** `Span(start, length)` in code points of the input, as in
  Hrefine's `SourceSpan`, ideally the same type shared across both
  libraries.
- **Lossless nodes:** every node can print exactly the text it was
  parsed from (`asWritten`), trivia included, and knows its span.
  Printing an unchanged tree gives back the input byte for byte.
- **Immutable trees, edits by replacement:** `doc.replace(node, new)`
  gives a new document whose text changes only inside `node`'s span;
  nodes are values, safe to share across threads, as Hrefine's `Url`
  is. Building a node from scratch gives it canonical text. Kept cheap
  as in "Edits without heavy copying", below.
- **Two outputs, never confused:** `asWritten` (the source, exactly)
  and a normalized form (`format()`), each named for what it is.
- **Character references:** the table and decoding, used by both
  parsers.

## Edits without heavy copying

Deeply immutable documents can make editing awkward and, done
naively, copy a lot and make much garbage. The proven answer for
lossless syntax trees is the red-green design of Roslyn (C#) and
rust-analyzer's rowan:

- **Green nodes, immutable and shared:** each node holds only its
  kind, its children, and its total width in code points, not its
  position. Tokens (leaves) hold their text. A green node never knows
  where it is, so the same node can be shared by many versions of a
  document, and identical small nodes can even be interned.
- **Red nodes, cheap views:** made on demand as you walk, each wraps a
  green node with its parent and absolute offset. They're the API users
  see (parent, position, and siblings) and are thrown away freely.
- **An edit copies only one path:** replacing a node builds new green
  nodes from it up to the root, and everything else is shared. Markdown
  trees are shallow (a document, a block or two of nesting, inlines),
  so that's a handful of nodes per edit. Positions after the edit need
  no updates, since green nodes store widths, not offsets.
- **Wide parents:** a document with thousands of top-level blocks would
  copy a long child list on each edit, so long lists can be chunked
  (children grouped into nodes of, say, 32) to keep that copying small.
- **Many edits at once:** an editor object collects a batch of edits
  and builds the new document once (`doc.edit(fn (e) { … })`, or a
  builder), so a hundred changes don't make a hundred intermediate
  documents.
- **Building from scratch:** builders are mutable while building and
  produce immutable nodes at the end, so construction makes no extra
  garbage.
- **Later, incremental parsing:** after a text edit, reparse only the
  affected blocks (Markdown's block structure keeps changes local) and
  reuse the untouched green nodes.

This maps to every backend: plain immutable classes with
reference-counted or garbage-collected sharing (`Arc` in Rust,
`shared_ptr` in C++), and no cycles, since green nodes have no parent
pointers.

Languages with "functional but in place" reference counting (Koka,
Lean) reuse an immutable node's memory when nothing else holds it, so
immutable updates cost little there; Rust's `Arc::make_mut` does the
same opt-in. Temper's targets mostly can't, so the design above can't
rely on it, though a backend could use it where it exists.

## kelpto-md alone

What someone with only Markdown wants: edit Markdown files without
churning them, and render Markdown to HTML.

- **Parse and print:** `parseMarkdown(text)` gives a `MarkdownDocument`;
  `doc.asWritten` is the input again.
- **Typed tree:** node types by where they can go, after Mike's idea:
  sealed interfaces such as `BlockNode`, `InlineNode`, and
  `LinkTextNode` (links can't nest), so built trees are valid by
  construction.
- **Edits:** replace, insert, and remove nodes; a heading's text, a
  link's target, a code block's info string. Only the touched span is
  rewritten.
- **Building:** constructors and builders that read well in each
  language, plus the context Mike described for anchors and link
  definitions that never collide.
- **Rendering to HTML:** CommonMark's HTML output, with secure defaults:
  - **Raw HTML is escaped by default,** shown as text. Passing it
    through needs an explicit, plainly named choice, such as
    `withRawHtmlTrusted()`, and the docs say what that risks.
  - **Link and image targets:** for now a `String` wrapper with no URL
    processing (decided above). Later, checked with Hrefine or
    something like it: a scheme allowlist (http, https, mailto,
    relative) by default, so `javascript:` and tricky spellings never
    become live links.
- **Raw HTML in the tree:** kept as an opaque node with its text, found
  by CommonMark's own rules, through an interface (`RawHtmlHandler`)
  that `kelpto` fills in with a real parser.

## kelpto-html alone

What someone with only HTML wants: parse HTML as browsers do, edit it
without churning it, and sanitize untrusted HTML.

- **Parse:** `parseHtmlDocument(text)` and `parseHtmlFragment(text,
  context)`, following the standard's tokenizer and tree construction,
  so the tree is what a browser builds, misnesting and all.
- **Two views of one parse:**
  - **As written:** tokens with spans, so a tool can change one
    attribute and leave the rest byte for byte.
  - **As built:** the element tree the standard constructs, which can
    differ from the source's nesting (implied `<tbody>`, adopted
    formatting elements). Each built node points back at the spans it
    came from, where it has one.
- **Serialize:** the standard's fragment serializer (normalized), and
  lossless printing of the as-written tokens.
- **Sanitize:** a sanitizer working on the built tree, the only safe
  place to judge HTML: an allowlist of elements and attributes,
  Hrefine checking every URL-valued attribute, and safe defaults
  (no scripts, event handlers, `style` unless asked, or `srcdoc`).
  Its output is `SafeHtml`: HTML the library understands and has
  checked, as structure, not just a string.

## Together (kelpto)

What the pair adds that neither can alone:

- **HTML inside Markdown, understood:** `kelpto` fills in kelpto-md's
  `RawHtmlHandler` with kelpto-html, so raw HTML blocks and inline tags
  become HTML subtrees in the Markdown tree, still lossless.
- **Safe rendering in one call:** `renderSafe(doc, policy)` renders
  Markdown, parses any raw HTML, sanitizes the result as one tree, and
  returns `SafeHtml`. That's the common case for comments, READMEs, and
  chat: Markdown from users, HTML for a page.
- **Typed embedding:** an HTML fragment built with kelpto-html's
  builders (or `SafeHtml`) placed in a Markdown document, printed as
  raw HTML Markdown keeps.
- **Maybe later:** HTML to Markdown.

## Secure defaults, everywhere

- Escape what isn't understood; sanitize what is.
- Never decide on text as written; check the parsed, normalized form,
  as Hrefine does.
- Name the dangerous choices plainly (`Trusted`, `WithCredentials`),
  never with "safe" or "secure".
- Never log or echo raw input in errors.

## Open questions

- The umbrella library's directory: `kelpto/` inside the `kelpto` repo
  reads oddly, but matches the package name, as Python repos do. Rec:
  keep it.
- Spans: keep kelpto-core's the same shape as Hrefine's `SourceSpan`
  (code points, start and length), without sharing the type for now.
