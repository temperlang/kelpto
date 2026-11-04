# Demos

## Tour

`tour/` shows Kelpto in each supported language: parsing and printing
back exactly, odd input included; editing a heading, a table cell, a task
list item, and a link definition's destination, with only those lines
changing; rendering, with raw HTML escaped by default, then trusted, then
through GFM's filter; GitHub Flavored Markdown's extensions, all at once
or one at a time; footnotes, renamed by label; and walking a document,
then moving its headings down a level and making its relative links
absolute, in one batch of edits; building a document from plain
strings, escaped so they read back as written; and inserting,
replacing, and removing blocks inside a block quote and a list item,
with builders' blocks and rich content; then kelpto-html, parsing a
document and fragments as browsers do and editing a tag; Markdown and
its raw HTML built as the one tree a browser builds, each element
traced to its source; and `renderSafe`. Every version prints
the same text, `tour/expected.txt`, so the tours double as a
cross-language test.

First build the libraries from the repo's top, with
[Temper](https://temperlang.dev/):

    temper build -b cpp -b csharp -b java -b js -b lua -b py -b rust

Each tour uses the generated library in `temper.out/` by relative path.
Run one from its directory:

| Language | In `tour/…` | Commands |
|---|---|---|
| C++ | `cpp` | `cmake -B build && cmake --build build && ./build/tour` |
| C# | `csharp` | `dotnet run` |
| Java | `java` | `./gradlew run` |
| JavaScript | `js` | `npm ci && npm start` |
| Lua | `lua` | `lua -l paths tour.lua` |
| Python | `py` | `uv run tour.py` |
| Rust | `rust` | `cargo run` |

Or run them all and compare each with `expected.txt`:

    uv run demos/run.py [LANGUAGE ...]

Java's Gradle build compiles the generated sources along with the tour,
because the generated Maven projects expect a JDK 8 toolchain and
release signing, and prints in UTF-8 whatever the locale. Python's tour
names Temper's runtime as a dependency too, so it comes from
`temper.out/`, not from older releases on PyPI.

Rust's tour doesn't build for now: Temper's Rust backend currently
generates code for kelpto-md that rustc rejects (E0282, a constructor
reading another object's field as its own), a Temper bug, not
Kelpto's. The tour is kept as written, to run once that's fixed.

The site shows these tours, and runs the JavaScript one in the page; see
[docs/site.md](../docs/site.md).
