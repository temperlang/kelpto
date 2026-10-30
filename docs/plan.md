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

Names: the repo's name is a placeholder. These libraries are meant to be
used together, so related names fit, unlike our other libraries'.

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
| html5lib/html5lib-tests | tokenizer (named, numeric, and other character references, among others), serializer, and encoding tests | MIT |
| web-platform-tests, `html/syntax/parsing/resources/` | tree-construction `.dat` files, maintained there now, not in html5lib-tests | BSD-3-Clause |

The CommonMark examples come from a CC-BY-SA document, so the extracted
tests likely carry CC-BY-SA. Keep them in `tests/` with attribution in
NOTICE, apart from the library's own code; decide before vendoring.
GitHub Flavored Markdown's extensions (tables, strikethrough, task
lists, and autolinks) have their spec in github/cmark-gfm, which isn't
in the allowed GitHub orgs yet.

## Steps

1. **Core and CommonMark blocks,** lossless, with the spec's block
   examples.
2. **CommonMark inlines,** all of `spec.txt`, HTML rendering included.
3. **Edits:** a small, consistent API for changing parts, with
   roundtrip fuzzing.
4. **HTML tokenizer,** then tree construction, against html5lib-tests
   and WPT's `.dat` files.
5. **Bridge:** safe rendering with Hrefine, and the raw HTML interface
   filled in.
6. **Tours and the site,** as in the other libraries.

## Open questions

- Names, for the set and each library.
- Whether GFM's extensions come in step 2 or later.
- HTML to Markdown: in the bridge, or not at all.
- Where the character reference table comes from: WHATWG's
  `entities.json` (whatwg org, not allowed yet) or html5lib-tests'
  `namedEntities.test`.
- How a lossless node API reads in each language (immutable values with
  `with` methods, as Hrefine's `Url`, or a mutable tree).
