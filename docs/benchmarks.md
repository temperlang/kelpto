# Benchmarks

kelpto-md against each language's usual Markdown parsers, on the same
bytes, in CommonMark mode. How to run them, and exactly what each task
times, is in [bench/README.md](../bench/README.md). Every number below
is from [bench/results/2026-11-02.md](../bench/results/2026-11-02.md),
which has the full tables per language (each input and task, times
with their ranges, pathological shapes, and peak memory), and its
`.json` has every sample.

## Results (2026-11-02)

On an Intel i7-1165G7 (4 cores, 8 threads) with 7.6 GiB, in a dev
container on WSL2, shared with other light work; three rounds of every
language. kelpto-md at commit 5ae8c9f, built by Temper
0.6.1-dev+575.

How many times longer kelpto-md takes than each language's usual
parsers. Each round gives a ratio of medians; this is the median
round's, with the lowest and highest in brackets. The spec is 205 KB,
spec-x10 is it ten times over (2 MB), and the four READMEs are 4 to
32 KB.

| Language | Against | spec, parse | spec, render | spec-x10, parse | READMEs, parse |
|---|---|---|---|---|---|
| C++ | cmark 0.31.2 (C) | 8.6 (8.3 to 11) | 15 (12 to 15) | 4.3 (4.2 to 4.5) | 11 to 21 (9.3 to 21) |
| C# | Markdig 1.5.1 | 33 (32 to 34) | 29 (26 to 30) | 65 (64 to 73) | 25 to 39 (22 to 43) |
| Java | commonmark-java 0.32.0 | 7 (5.9 to 7.6) | 8.6 (8.4 to 11) | 12 (5.2 to 13) | 5.1 to 6.4 (4.3 to 7.5) |
| Java | flexmark 0.64.8 | 1.7 (1.6 to 2.4) | 1.5 (1.4 to 1.8) | 3.6 (2.9 to 3.9) | 1.1 to 2.5 (0.93 to 3.4) |
| JavaScript | commonmark.js 0.31.2 | 16 (14 to 16) | 19 (17 to 22) | 11 (10 to 11) | 15 to 17 (15 to 18) |
| JavaScript | markdown-it 15.0.3 | 6.6 (5 to 6.8) | 7.5 (7.1 to 11) | 4.3 (3.9 to 4.4) | 4.2 to 5.7 (4.1 to 5.8) |
| Python | markdown-it-py 4.2.0 | 9.5 (8 to 11) | 11 (9.9 to 13) | 8.7 (7.9 to 9) | 5.9 to 8.8 (4.8 to 9.2) |
| Python | mistune 3.4.0 | 15 (11 to 15) | 15 (14 to 15) | 14 (13 to 15) | 5.8 to 8.8 (5.1 to 9.1) |
| Rust | pulldown-cmark 0.13.6 | 104 (93 to 108) | 88 (82 to 95) | 105 (92 to 110) | 99 to 126 (93 to 137) |
| Rust | comrak 0.55.0 | 30 (29 to 34) | 31 (27 to 33) | 16 (15 to 18) | 31 to 38 (28 to 45) |

Lua has no usual parser to compare with; kelpto-md parses the spec
there in 870 ms (779 ms to 1 s).

kelpto-md's own speed, parsing the spec: 8.4 MB/s in C++; 2.0 to 2.2
MB/s in C#, Java, JavaScript, and Rust; 0.32 MB/s in Python; and 0.24
MB/s in Lua. Rendering adds up to about 50% to parsing (about 100% in
C++). Walking every view and printing the document back, or moving
every heading down a level in one `editor()` and printing the new
document, adds up to about 20% (25 to 80% in C++, where each view is a
`shared_ptr`).

Peak memory parsing spec-x10 (2 MB): 81 MiB in C++, 87 MiB in Rust,
171 MiB in Python, 231 MiB in JavaScript, 234 MiB in Java, 310 MiB in
Lua, and 381 MiB in C#; against under 8 MiB for cmark,
pulldown-cmark, and comrak, and 16 to 116 MiB for the rest.

**Pathological inputs** (cmark's shapes, each at four sizes doubling):
every inline shape stays linear in every language, from ×1.7 to ×2.7
per doubling (×2 is linear, and small sizes are noisy). kelpto-md even beats cmark there in C++
(13 ms against 68 ms on 96 KB of `_a `). Deep block nesting is not
linear yet: nested block quotes take ×3.1 to ×3.9 per doubling
(quadratic), and nested lists ×2.3 to ×2.5, both far behind the
others (C++: 18 ms for 800 nested quotes, against 73 µs for cmark).
That's roadmap item 4 in [design.md](design.md). Python's kelpto-md
also hits its recursion limit at 1,000 nested quotes, so the sizes
here stop at 800. The others have their own limits: Markdig refuses
input past its nesting limit (17 of the 36 pathological inputs,
inline ones too), and is quadratic on several inline shapes (6.8 s on
160 KB of `[ (](`); flexmark overflows its stack on every size of
`[ (](` and takes 5.7 s on 192 KB of unclosed links.

## Where kelpto-md is slower, and why

kelpto-md is slower everywhere but against flexmark: 1.5 to 3.6 times
there, about 4 to 21 times against the rest in C++, Java, JavaScript,
and Python, about 16 to 65 times against comrak and Markdig, and about
100 times against pulldown-cmark. Why:

- **It builds much more.** Every byte is in the tree, as tokens under
  nodes, so a document makes several times the objects of an abstract
  tree, and 40 to 190 bytes of memory per byte of input. The others
  keep only what HTML needs, or, like pulldown-cmark and markdown-it,
  no tree at all.
- **One source, translated, and not tuned yet.** The same Temper runs
  in every language, through each one's Temper runtime. Where a
  language's translation is costly, every step pays. In Rust, each
  object with a mutable field, and each `ListBuilder`, sits behind an
  `Arc<RwLock<…>>`, so every field read or write takes a lock (815
  `read()` or `write()` calls in kelpto-md's generated Rust); it runs
  4 times slower than the C++ from the same source (94 ms against
  24.5 ms on the spec; not profiled, since `perf` isn't installed
  here). Python adds checks to integer arithmetic (755,000
  calls to `int_add` in one parse of the spec, about 10% of it).
- **`SourceText` decodes every text in full.** It copies the document
  into two arrays, code points and their indices, one character at a
  time through the runtime's string functions, and does it again for
  each paragraph's inline content. In Python (cProfile, the spec) that
  is 29% of a parse: 1,865 `SourceText`s, 0.71 s of 2.43 s. In
  JavaScript (`node --prof`, Hrefine's README) the constructor and its
  array pushes are about 20% of the ticks. Decoding lazily, or indexing
  the language's own strings where they allow it, would cut most of
  that, and some memory.
- **Garbage collection** on long documents in C# and Lua: spec-x10
  takes 18 times the spec's time there for 10 times the bytes, against
  7 to 13 times elsewhere, with C#'s peak memory the highest.

The gap is smallest against flexmark, which also keeps positions in
the source for its whole tree. That suggests a detailed tree costs any
library a lot, and that much of the remaining gap elsewhere is the
translation and the hotspots above, which can be fixed.

## What the others don't do

The comparison is fair on input and output, not on what each library
builds:

- **kelpto-md keeps every byte.** Its tree holds every marker, space,
  line ending, delimiter run, and bracket as a token, so it prints the
  document back exactly, and typed views and edits work on that tree.
  The others keep what HTML needs: cmark, commonmark.js,
  commonmark-java, comrak, and Markdig build an abstract tree (cmark
  and Markdig with source positions); flexmark's tree points into the
  source, the closest to lossless here; markdown-it and markdown-it-py
  give a flat token stream; pulldown-cmark is a pull parser, building
  no tree at all; and mistune gives lists of dictionaries.
- **mistune isn't CommonMark.** It's fast partly by following its own
  rules; its HTML for the spec differs from the others'.
- **Rendering is trusted** here, raw HTML passed through as the others
  do; kelpto-md escapes it by default, at about the same cost.
- **Written once.** kelpto-md is one Temper source, translated to each
  language, with nothing tuned per language yet. The others are
  written for their language, some for years.
- **CommonMark only.** GitHub Flavored Markdown isn't compared yet.

The HTML each library renders for the spec, the long document, and
Hrefine's README is the same length as cmark's in every case but
mistune's, pulldown-cmark's (which escapes fewer characters), and
Markdig's and flexmark's on the spec (by 88 and 3 characters in 228
thousand, and ten times that on the long document).
