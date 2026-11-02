# The site

A static page in `site/`, built by `site/build.py` from Temper's JS
output, and deployed by `.github/workflows/site.yml`. It runs kelpto-md
live, with the same build every other language's tests run on.

## What's there

- **The opening:** the slogan, the pitch, a conformance line (every
  CommonMark 0.31.2 and GFM example passes; the build runs them in Node
  and fails otherwise), and the beta note.
- **Try it (`#try`):** Markdown in, rendered HTML out, in a sandboxed
  frame. Clicking a heading, table cell, task box, or link edits it
  through the API, and the output shows as a diff against the input:
  the lossless point.
- **The tour (`#tour`):** each language's tour from `demos/tour/`, in
  tabs, with the JavaScript one run in the page.

## Where later wow goes

Each lands as its own section between `#try` and `#tour`, in this
order, with a nav link; `index.html` marks the spot. Nothing shows until
a section has content.

1. **HTML (`#html`):** kelpto-html's WHATWG tokenizer and tree, with
   html5lib's tests counted at build time, as the conformance line
   counts Markdown's. The demo's raw HTML can then show as a tree.
2. **Safe rendering (`#safe`):** the sanitizer, with links checked by
   Hrefine. A gallery of hostile inputs (`javascript:` links, tricky
   hosts, event handlers), each with what Kelpto renders. The demo's
   "Trust raw HTML" box grows a third choice: sanitized.
3. **Speed (`#speed`):** benchmarks against other parsers, recorded
   ahead of time, with each version and machine named.
4. **Compare (`#compare`):** a conformance table against other
   parsers: spec examples passed, roundtrip, and edits.

Data recorded from other parsers goes in `site/` as JSON, with a script
to record it, as Hrefine's site does. Analytics wait for a GoatCounter
name.
