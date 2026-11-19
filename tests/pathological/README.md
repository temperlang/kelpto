# Pathological inputs

kelpto-md's linearity tests, in `linear.temper.md`: the shapes of the
CommonMark spec's appendix and of cmark's and cmark-gfm's pathological
tests (deep brackets, emphasis, backticks, unclosed HTML, wide tables,
autolinks, and footnotes), each at a size where a parser quadratic in
it would take minutes, and each checked to parse, roundtrip, and
render. They're here, rather than with kelpto-md's own tests, since a
loaded machine can push them past a backend's test timeout; they run
with the full suite, not the quick tier (see Kelpto's README). For
timings of the same shapes, see `bench/`.
