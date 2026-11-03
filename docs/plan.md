# Plan

A set of Temper libraries, built like Hrefine, Chromarite, and Ordable:
one Temper source, tests from outside authorities, a tour in each
language, and a site that makes the point. A first sketch (2026-10-30);
nothing here is decided unless it says so.

## Why

As far as we know, nothing does lossless Markdown and a real HTML parser
together, in any language, let alone in all of Temper's targets:

- **Markdown that roundtrips:** Markdig (C#) has a roundtrip mode that
  keeps trivia and gives back the exact original, with raw HTML as
  opaque text. flexmark-java keeps full source offsets, and its
  formatter preserves much, but not all. micromark (JS) has tokens
  covering every character; goldmark (Go), comrak and pulldown-cmark
  (Rust), and markdown-it-py (Python) keep positions but reformat when
  writing.
- **HTML with positions:** parse5 (JS) follows the standard and keeps
  source locations. html5ever, html5lib, and jsoup follow it without
  roundtripping.
- **Across languages:** tree-sitter's Markdown and HTML grammars have
  spans, bindings for most targets, and HTML inside Markdown, but they're
  editor grammars: not CommonMark-exact, no HTML tree construction, and
  no API for editing or rendering.

(From memory, 2026-10-30. Check each before the site cites it.)

So the pitch: Markdig's roundtripping, tested against the specs, in
every language, with a real HTML parser and safe rendering.

## Libraries

Several libraries in this one repo, versioned together. Temper builds
the libraries in a worktree together and lets one import another
directly, so splitting costs little. Libraries can't depend on each
other in a cycle, so the layers go one way:

1. **Core:** what both parsers need. Source spans; a lossless tree's
   building blocks (nodes that own their text, trivia included, so
   printing an unchanged tree gives back the input byte for byte); and
   HTML's named character references (about 2,200), which Markdown
   needs too.
2. **Markdown:** CommonMark, lossless. Raw HTML is found by CommonMark's
   own rules and kept as text, through an interface (say
   `RawHtmlHandler`) that a caller can fill in with a real parser. That
   interface is the way up without a cycle: Markdown never imports HTML.
3. **HTML:** the WHATWG HTML parser (tokenizer and tree construction),
   with source spans. Useful on its own, and a showcase of its own.
4. **Bridge:** Markdown, HTML, and Hrefine together. Sanitized
   rendering (an allowlist of elements and attributes, links checked by
   Hrefine, so `javascript:` and tricky hosts are caught), HTML subtrees
   inside Markdown nodes, and maybe HTML to Markdown.

Names: the working name is Kelpto (2026-10-30; see
[names.md](names.md)), with `kelpto-md` and `kelpto-html` in
subdirectories. These libraries are designed to work together, so
similar names and an umbrella name fit, unlike our other libraries'.
How each works alone and together is sketched in
[design.md](design.md).

## Building documents (Mike's ideas, 2026-10-30)

Mike's sketch of a really nice Markdown library, with notes on each
idea. These are ideas to inform planning, not decisions.

**Nesting in the types.** A group of sealed interfaces named for where a
node may go: `FileChild`, `ParagraphChild`, `ListElementChild`,
`CodeBlockChild`, `LinkTextChild`, and `LinkTargetChild`. A node type
implements each place it may appear, so a program building a tree can
only nest what renders as valid Markdown. For example, text is a
`ParagraphChild` and a `LinkTextChild`, and a link is a `ParagraphChild`
but not a `LinkTextChild`, since links can't nest.
- Temper has sealed interfaces, generic ones included, and a class can
  implement several.
- Parsed trees must fit the same types. CommonMark's nesting is regular
  enough: container blocks hold blocks, and paragraphs and headings
  hold inlines, with a few exclusions, like links in links. What
  doesn't fit (raw HTML, odd but valid input) still needs a node that
  fits every place it can appear.

**Foreign languages inside Markdown.**
- **HTML:** make an HTML fragment from an HTML tree, a builder, or a
  safe HTML value. Safe HTML here means HTML the library understands,
  as structure rather than raw text, maybe validated in other ways too
  (well formed, or within an allowlist). This fits the bridge: the
  Markdown library defines the interface, and the HTML library (and the
  sanitizer, for the stricter checks) supply values for it.
- **Mermaid and others:** a fenced code block made from a Mermaid
  tree. Generalized, Markdown defines an interface for fenced content
  (its info string, and its text), and a Mermaid library, or any other,
  implements it, with no dependency from Markdown back to it.

**A context for names that must not collide.**
- **Anchors:** allocate a heading's anchor ahead of time, guaranteed
  unique, and use it as a link target from links before and after the
  heading, ideally across files. That calls for a context per document
  set, which hands out anchors, resolves forward references when
  rendering, and makes links between pages relative.
- **External links:** a global set of external URLs with unique names,
  used by links and written as reference definitions (`[name]: url`) at
  the end of each page that uses them. Hrefine can normalize the URLs,
  so two spellings of one URL share a name.
- **With lossless edits:** when editing an existing document, the
  context is seeded from its headings and reference definitions, so
  new anchors and names don't collide with what's already there.

**A builder DSL.** Mike's sketch in Kotlin:

```kt
val top: LinkTarget

page("/README.md") {
  h1 {
    top = allocAnchor(hint = "README-top")
    text("Hello, ")
    b {
      link {
        text("World")
      } targetsUrl {
        wikipediaWorldEntry
      }
    }
    text("!")
  }
}
```

- Temper's trailing blocks, and chained blocks such as
  `link { … } targetsUrl { … }`, might express this almost directly.
  Check what the grammar allows before relying on it.
- Allocating up front reads well in every language and avoids
  assigning an outer variable from inside a block:
  `let top = context.allocAnchor("README-top")`, then `h1` takes `top`.
- People using the library from Python, Java, and the others use its
  API there, not Temper's syntax. So the tree's constructors and
  builders need to read well in each language too (as Hrefine's tours
  check), such as nested constructor calls with lists of children.

## Lossless, defined

- **Roundtrip:** parsing then printing an unchanged tree gives back the
  input byte for byte, for every input, invalid ones included.
- **Edits stay local:** changing one node rewrites only that node's
  text; the rest of the document stays as written.
- **Formatting is separate:** a normalizing formatter is its own
  operation, never a side effect of printing.
- **Checked** by fuzzing roundtrips as well as by the spec tests.

## Tests

| Source | What | License |
|---|---|---|
| commonmark/commonmark-spec, 0.31.2 (latest tag) | `spec.txt`'s examples, input and expected HTML | spec text CC-BY-SA 4.0; test tools BSD-2-Clause |
| github/cmark-gfm, 0.29.0.gfm.13 | GFM's spec, extension, and regression examples | CC-BY-SA 4.0 |
| html5lib/html5lib-tests | tokenizer (named, numeric, and other character references, among others), serializer, and encoding tests | MIT |
| web-platform-tests, `html/syntax/parsing/resources/` | tree-construction `.dat` files, maintained there now, not in html5lib-tests | BSD-3-Clause |

The CommonMark examples come from a CC-BY-SA document, so the extracted
tests carry CC-BY-SA. They're vendored (2026-10-30) in
`tests/commonmark/`, a test-only library apart from the libraries'
code, which nothing imports and which isn't published, with
attribution and both licenses in NOTICE. GFM's are vendored the same
way in `tests/gfm/`.

## Steps

1. **Core and CommonMark blocks,** lossless, with the spec's block
   examples. Done (2026-10-30), with roundtrip fuzzing.
2. **CommonMark inlines,** all of `spec.txt`, HTML rendering included,
   with character references in core. Done (2026-10-31): all 652
   examples pass. Then GFM's extensions (tables, task list items,
   strikethrough, extended autolinks, and footnotes), opt-in: done, with
   all of cmark-gfm's spec, extension, and regression examples (see
   "kelpto-md's GFM extensions" in [design.md](design.md)).
3. **Edits:** a small, consistent API for changing parts, batches, and
   insert and remove; roundtrip fuzzing is in place.
4. **HTML tokenizer,** then tree construction, against html5lib-tests
   and WPT's `.dat` files.
5. **Bridge:** safe rendering with Hrefine, and the raw HTML interface
   filled in.
6. **Tours and the site,** as in the other libraries.

## Open questions

- Names, for the set and each library.
- HTML to Markdown: in the bridge, or not at all.
- How a lossless node API reads in each language (immutable values with
  `with` methods, as Hrefine's `Url`, or a mutable tree).
