# CommonMark spec tests

kelpto-md's tests against the examples in CommonMark's spec, 0.31.2.

- **`spec.json`:** the examples, extracted from `spec.txt` by
  `scripts/commonmark_spec.py`: number, section, Markdown, and HTML.
- **`examples.temper.md`:** the same, as Temper, generated from
  `spec.json`.
- **`spec-tests.temper.md`:** the tests: each example's rendered HTML
  against the spec's, counts by section, and roundtrips.

**Licensing:** `spec.txt` is © John MacFarlane, under the Creative
Commons Attribution-ShareAlike 4.0 license
(<https://creativecommons.org/licenses/by-sa/4.0/>), so `spec.json` and
`examples.temper.md`, derived from it, are too. They're kept here, in a
test-only library that nothing imports and that isn't published, apart
from Kelpto's own code. The spec's test tools, whose way of reading the
examples the script follows, are BSD-2-Clause. See `NOTICE` at the top
of the repo.
