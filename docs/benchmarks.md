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

## Tuning (2026-11-02, later)

A first tuning, measured before and after on the same machine in
[bench/results/2026-11-02-tuning.md](../bench/results/2026-11-02-tuning.md)
(kelpto-md alone, in JavaScript, Python, and Rust; the machine was
busy, so that file compares the two builds, not absolute times):

- **Paragraphs share the document's decoding.** A paragraph's inline
  text was copied in slices from the document's decoded code points,
  and its slices taken from the original string, line by line. Before,
  each paragraph was joined into a new string and decoded again, twice
  (once to split off link definitions, once to write it). The
  document's decoding is gone since (below).
- **Deep block nesting is linear.** Marking each block's last line
  stopped at the first block already marked, and opening a block's
  node checks its depth instead of searching the open nodes; neither
  recurses now, nor does printing a tree back (`asWritten`).
- **Fewer field reads in per-character loops,** for Rust, whose
  translation takes a lock on every field read or write of a class
  with `var` fields: the block parser's indentation scans, the inline
  parser's main loop, and its whole-paragraph scans work on locals.

Parsing the CommonMark spec got 1.2 to 1.3 times faster in all three,
and Hrefine's README 1.3 to 1.4 times; nested block quotes 11 to 15
times, and nested lists 7 to 13 times, now ×1.9 to ×2.1 per doubling
like every other shape. In Rust, a one-round run of
`scripts/bench.py` gave 84 ms for the spec (99 times pulldown-cmark's
time, 27 times comrak's). The tables above are the run before; a full
run of all seven languages needs a quiet machine.

## Reading by `StringIndex` (2026-11-03)

The block parser and tree writer keep `StringIndex` positions into the
source string and read it directly, and lines are found with
`indexOf`, so the document is no longer decoded into arrays of code
points and string indices. Only paragraph-like text is decoded, line
by line, for the inline parser (`sourceLines`), and a paragraph not
starting with `[` isn't decoded to look for link definitions. On the
spec, measured the same way before and after (the machine was busy,
so shares and counts rather than times):

- **Python** (cProfile): 6.93 million calls per parse, now 5.22
  million (25% fewer); decoding was 22% of the time, now 12%.
- **JavaScript** (`node --prof`, 40 parses): ticks with decoding on
  the stack were 31%, now 17%.
- **Peak memory** parsing spec-x10 (one run each, noisy): Python 216
  to 105 MiB, JavaScript 346 to 183 MiB.

Then the inline parser (same day) read by `StringIndex` too, so
nothing is decoded: a paragraph's content is the source string itself
when its lines follow each other there, ending in `\n`, and otherwise
its lines joined into one new string. Measured the same way:

- **Python** (cProfile): 5.22 million calls per parse, now 4.14
  million (21% fewer); building paragraph content was 13% of the time
  (12% decoding), now 1%.
- **JavaScript** (`node --prof`, 40 parses): ticks with decoding on
  the stack were 17%, now 0.3%, and building paragraph content 21%,
  now 3%. The inline parser's share rose from 33% to 39%: reading
  the string by index costs it a little more per code point than
  reading an array did, so the time per parse came out about even
  (57 ms both, busy machine).
- **Peak memory** on spec-x10 is unchanged (Python 105 MiB,
  JavaScript 175 MiB): a paragraph's decoding was short-lived, and the
  tree dominates.

## Sharing identical tokens (2026-11-03)

`GreenNodeBuilder` now makes each token of up to 4 code points once per
kind and text (a line ending, a space, a `*`, an indent), and each node
whose only child is such a token (a blank line), as rowan does. On the
spec, counted exactly:

- **Tokens:** 22,342 objects before, 7,817 now; most were `\n` (9,755),
  a backtick, or a space. **Nodes:** 8,502, now 6,106 (2,128 blank
  lines were the same node).
- **Memory the parsed tree keeps** (after garbage collection): spec in
  Python 3.7 to 2.1 MiB (`tracemalloc`), spec-x10 in JavaScript 25.3
  to 14.3 MiB.
- **Peak memory** on spec-x10 (one noisy run each): Python 105 to
  88 MiB; JavaScript 174 to 171 MiB, where garbage made while parsing,
  not the tree, sets the peak.

Speed, measured as shares and counts on a busy machine: each token's
width is checked before its lookup, so long tokens are never hashed.
Looking every token up instead was cheaper in Python (a `dict` lookup
is one C call, and the width check two helper calls), but in
JavaScript it moved the builder's `token` from about 2% of a parse's
ticks to about 9%, hashing fresh long strings; a list indexed by code
point for one-character tokens was slower in both. As built, a
benchmark of just `token` over the spec's tokens comes out even with
before in JavaScript. Python makes 4% more calls per parse (4.14 to
4.30 million); its `token` benchmark ranged from 20% faster to 50%
slower than before (noisy), and `token` is about 5% of a parse, so a
Python parse may be up to about 2% slower.

Step 3 of the plan, fewer and larger tokens, found nothing to merge:
runs of plain text are one token already, and each node's child list
is exactly its children in every backend.

## C++, Rust, and JavaScript's garbage (2026-11-03)

kelpto-md alone, after the steps above, on a busy machine (a shared
lock kept other heavy jobs out of each timing); full numbers in
[bench/results/2026-11-03-compiled.md](../bench/results/2026-11-03-compiled.md):

- **Rust is 1.6 times faster, in 45% less memory:** the spec parses
  in 61 ms (94 ms on 2026-11-02), spec-x10 in 578 ms (918 ms), with
  peak memory 49 MiB above reading it (87 MiB).
- **C++ is 24 times slower:** 580 ms for the spec (24.5 ms), 11.8 ms
  for Hrefine's README (4.9 ms). Temper's C++ passes a `String` by
  value, so each helper call reading the source by `StringIndex`
  copies the whole document; spec-x10 would take minutes. That needs a
  Temper fix (strings by reference); nothing in Kelpto's source.
- **JavaScript's peak** on spec-x10 isn't the tree (14 MiB kept) but
  V8's young generation, grown to fit a parse allocating 85 MiB, plus
  what lives until the parse ends: each line's and block's data. With
  a 1 MiB young generation (`--max-semi-space-size=1`) the peak is
  115 MiB instead of 171. The tree writer now reuses one inline parser
  for all paragraphs, and lines' container prefixes are one list, not
  one per line: a parse allocates 73 MiB (sampled), and peak is 151 to
  169 MiB, against 171 to 172 before (total, including Node's 67 MiB
  for reading the file).

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
- **One source, translated, and barely tuned.** The same Temper runs
  in every language, through each one's Temper runtime. Where a
  language's translation is costly, every step pays. In Rust, each
  object with a mutable field, and each `ListBuilder`, sits behind an
  `Arc<RwLock<…>>`, so every field read or write takes a lock (815
  `read()` or `write()` calls in kelpto-md's generated Rust, 788 after
  the tuning above, with the hottest loops on locals); it ran 4 times
  slower than the C++ from the same source (94 ms against 24.5 ms on
  the spec; not profiled, since `perf` isn't installed here). Python adds checks to integer arithmetic (755,000
  calls to `int_add` in one parse of the spec, about 10% of it).
- **Decoding,** one code point at a time through the runtime's string
  functions, into arrays of code points and their indices, was 29% of
  a Python parse of the spec at first, and about 20% of the ticks in
  JavaScript. It's gone: all three passes read the source by
  `StringIndex` (see above). In Python and JavaScript the gain is
  smaller than the decode's share, since each read and step by
  `StringIndex` is a helper call there too.
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
