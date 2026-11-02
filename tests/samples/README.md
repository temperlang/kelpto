# Sample documents

Real Markdown, for tests and benchmarks, and worked examples run on it.

- **`docs/`:** the documents, as plain files for tools in any language:
  - `commonmark-spec.md`: the CommonMark spec's `spec.txt`, tag 0.31.2
    (205 KB), from <https://github.com/commonmark/commonmark-spec>.
  - `chromarite-readme.md`, `hrefine-readme.md`, `ordable-readme.md`,
    and `kelpto-readme.md`: READMEs of Temper libraries (4 to 32 KB),
    GitHub Flavored Markdown, as committed on 2026-11-02. Snapshots,
    so results stay comparable; Kelpto's own is this repo's README at
    that time.
- **`documents.temper.md`:** the same texts, as Temper, generated from
  `docs/` by `scripts/sample_docs.py` (`uv run`), which can also
  download the spec again (`--fetch`).
- **`examples.temper.md`:** worked examples, as tests: scraping a table
  of contents and every link destination, and a transform making
  relative link destinations absolute and moving headings down a
  level, checked to change only those bytes; plus a no-op edit of
  every heading, checked to print back byte for byte.

**Licensing:** `spec.txt` is © John MacFarlane, under the Creative
Commons Attribution-ShareAlike 4.0 license
(<https://creativecommons.org/licenses/by-sa/4.0/>), so
`docs/commonmark-spec.md` and `documents.temper.md` are too. They're
kept here, in a test-only library that nothing imports and that isn't
published, apart from Kelpto's own code. The READMEs are Apache-2.0 OR
MIT, as their libraries are. See `NOTICE` at the top of the repo.
