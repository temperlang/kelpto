# The site

A static page in `site/`, built by `site/build.py` from Temper's JS
output, and deployed by `.github/workflows/site.yml`. It runs Kelpto's
libraries live, with the same build every other language's tests run
on: kelpto-md first, then kelpto-html and kelpto once the page is up
(`tree.js`), so the Markdown demo never waits for them.

## What's there

- **The opening:** the slogan, the pitch, a conformance line (every
  CommonMark 0.31.2 and GFM example passes; the build runs them in Node
  and fails otherwise), and the beta note.
- **Try it (`#try`):** Markdown in, rendered HTML out, in a sandboxed
  frame. Clicking a heading, table cell, task box, or link edits it
  through the API, and the output shows as a diff against the input:
  the lossless point. Raw HTML is escaped, trusted, or sanitized
  (`renderSafe`); the sample has a `<span>` with a `style` and an
  `onmouseover`, and a `javascript:` link, so Sanitize visibly differs
  from Trust (the preview frame is sandboxed without scripts, so
  neither runs in Trust). Sanitized, the HTML and Tree views strike
  through what `SafeHtml.removals` lists, matched to built nodes by
  origin, with a count under the views ("1 attribute, 1 style, and 1
  link removed"). Each mark's tooltip, and the Tree view's note, says
  why in a line: a handler or `javascript:` link would run on a real
  page though not in the preview, and `style` goes since CSS isn't
  checked yet. The HTML view falls back to the plain output if
  striking out what's marked wouldn't leave exactly it. A Tree view
  shows the tree a browser builds from it
  all (`buildHtml`), each element badged by where it came from
  (Markdown, raw HTML, implied, reopened by the parser, or copied into
  a `<selectedcontent>`); hovering or focusing a node highlights its
  source in the input. Long rows wrap, attributes on following lines,
  indented, so neither view scrolls sideways.
- **Your edits, as code:** under the diff, each edit as one line of code
  in all seven languages, with the same tabs as the tour, sharing the
  choice. `editcode.js` records each edit as a step (its kind, the index
  path the API takes to it, and the new value), and the page edits
  through those steps, so the code is what the page did. Each path
  starts at one of the document's typed lists (`headings`, `tables`,
  `taskListItems`, `linkReferenceDefinitions`, or `links`), so no
  language needs a cast. The build runs the JavaScript for the samples in `site/golden/` and
  checks it prints what the page's edits give, runs the Python too once
  it's built, and checks the other languages' code against `site/golden/`
  (`--update-golden` rewrites it).
- **HTML (`#html`):** kelpto-html's tokenizer and tree construction,
  with a conformance line: html5lib-tests' tokenizer tests and
  web-platform-tests' tree construction tests, run by the build in Node
  (`html-conformance-node.mjs`) from those test libraries' JS builds.
  The build fails unless every tokenizer test passes and the tree tests
  pass at least as their runner's floors say (all of them). Then a
  parser to try: HTML in, as a document or as `innerHTML` of a chosen
  element, giving its tree (with implied, reopened, and copied
  elements marked, and sources highlighted as in the demo), its
  serialization, and the tokenizer's parse errors.
- **Safe rendering (`#safe`):** the `safeGallery()` cases in
  `kelpto/kelpto.temper.md`, rendered by the build in Node
  (`safe-node.mjs`), which fails unless each gives what the library's
  tests expect and parses back to itself. Six show; the rest fold away.
  Each has a "Try it" that loads it into the demo, sanitized. Tricky
  hosts join when Hrefine does.
- **Kelpto in your view function:** in `#safe`, for people who build
  pages immediate-mode style (htpy, maud, j2html, or React-style
  views): `view(state) = layout(nav, postHtml(state.post.markdown))`
  in each language (`site/view/`), with the parse and sanitize memoized
  by content. It shows where Kelpto fits in such code: documents inside
  a view, not the view itself. The build runs the JavaScript one
  (`view-node.mjs`).
- **The tour (`#tour`):** each language's tour from `demos/tour/`, in
  tabs, with the JavaScript one run in the page.

## Where later wow goes

Each lands as its own section between `#safe` and `#tour`, in this
order, with a nav link; `index.html` marks the spot. Nothing shows until
a section has content.

1. **Speed (`#speed`):** benchmarks against other parsers, recorded
   ahead of time, with each version and machine named.
2. **Compare (`#compare`):** a conformance table against other
   parsers: spec examples passed, roundtrip, and edits.

Data recorded from other parsers goes in `site/` as JSON, with a script
to record it, as Hrefine's site does. Analytics wait for a GoatCounter
name.
