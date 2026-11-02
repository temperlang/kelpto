# GFM spec tests

kelpto-md's tests against GitHub Flavored Markdown's examples, from
cmark-gfm, GitHub's reference implementation, at tag 0.29.0.gfm.13.

- **`spec.json`:** the examples, extracted by `scripts/gfm_spec.py`
  from cmark-gfm's `test/spec.txt` (the GFM spec),
  `test/extensions.txt` (cmark-gfm's tests of the extensions, footnotes
  included), and `test/regression.txt` (its regression tests, only
  those with footnotes): source, number, section, the extensions each
  needs, Markdown, and HTML.
- **`examples.temper.md`:** the same, as Temper, generated from
  `spec.json`.
- **`spec-tests.temper.md`:** the tests: each example's rendered HTML
  against cmark-gfm's, counts by extension, and roundtrips.

**Licensing:** `spec.txt`, `extensions.txt`, and `regression.txt` are
under the Creative Commons Attribution-ShareAlike 4.0 license
(<https://creativecommons.org/licenses/by-sa/4.0/>), so `spec.json` and
`examples.temper.md`, derived from them, are too. They're kept here, in
a test-only library that nothing imports and that isn't published,
apart from Kelpto's own code. cmark-gfm's code, whose way of reading
the examples the script follows, is BSD-2-Clause. See `NOTICE` at the
top of the repo.
