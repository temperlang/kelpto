# Benchmarks

kelpto-md against each language's usual Markdown parsers, on the same
bytes, in CommonMark mode. Results, and what they mean, are in
[docs/benchmarks.md](../docs/benchmarks.md).

| Language | kelpto-md against | Project |
|---|---|---|
| C++ | cmark (C) | `cpp/`, CMake; cmark from its release source, pinned by hash |
| C# | Markdig | `csharp/`, `packages.lock.json` |
| Java | commonmark-java, flexmark | `java/`, Gradle, `gradle.lockfile` |
| JavaScript | commonmark.js, markdown-it | `js/`, `package-lock.json` |
| Lua | (none usual; kelpto-md alone) | `lua/` |
| Python | markdown-it-py, mistune | `py/`, the repo's top-level `pyproject.toml` and `uv.lock` |
| Rust | pulldown-cmark, comrak | `rust/`, `Cargo.lock` |

## Running

Build the libraries, then run all languages or some:

    temper build -b cpp -b csharp -b java -b js -b lua -b py -b rust
    uv run scripts/bench.py [LANGUAGE ...]

It builds each project, writes the inputs to `build/inputs/`, runs three
rounds (`--rounds`), measures peak memory, and writes
`results/<date>.json` and a summary table, `results/<date>.md`. A run of
some languages replaces just those in the day's file. Other options:

- `--quick`: small inputs, one short round, to check everything works.
- `--lock FILE`: hold an exclusive `flock` on `FILE` while building and
  timing, so other heavy jobs sharing that lock wait.
- `--summary results/<date>.json`: print a summary again.

Three rounds of all languages take about two hours, mostly Python and
Lua on the long document. Close what you can; timing is noisy on a busy
machine.

## What it measures

Inputs: the documents in `tests/samples/docs/` (the CommonMark spec and
four READMEs), the spec ten times over (about 2 MB), and nine of cmark's
pathological shapes at n, 2n, 4n, and 8n.

Tasks, each from the text to a result:

- **parse:** build the library's tree (for pulldown-cmark, a pull parser,
  read every event; for markdown-it and markdown-it-py, their token
  streams);
- **render:** parse and render HTML, with raw HTML passed through;
- **walk** (kelpto-md only): parse, list `descendants`, check each
  view's type, and print the document back (`asWritten`);
- **transform** (kelpto-md only): parse, move every heading down a level
  in one `editor()`, and print the `toDocument()` back.

Parsers and renderers are made once, outside the timing. Pathological
inputs are only parsed, and documents get every task.

## How

Each `<language>/` worker reads a plan (a header line `warmup_ms
sample_ms samples budget_ms`, then one `library<TAB>task<TAB>file` line
per job) and prints one line per job: `library`, `task`, `file`, ops
per sample, a checksum, and each sample's seconds per op. For each job
it warms up for `warmup_ms` (at least two ops; a second for the JIT
compilers of the JVM, .NET, and Node.js), picks enough ops for a sample of about `sample_ms`, and times up
to `samples` samples within `budget_ms` (at least three). It collects
garbage before each sample where the runtime allows.

`mem LIBRARY TASK FILE` does one task once, for peak resident memory
(the runner reads it from `wait4`), against `none read`, which only reads
the file.

Jobs for the same input and task run back to back, library by library,
and every round runs every language again, so slow moments spread over
all libraries. The summary gives medians over all samples of all rounds,
with the fastest and slowest sample. Ratios are per round, kelpto-md's
median over the other library's: the summary gives the median round's,
with the lowest and highest. A job that fails (some libraries refuse
deep nesting, or overflow their stack) is recorded with its error, and a
new worker goes on with the rest.

The worker that only reads the file loads every library too, so memory
above it is what parsing adds, though a library's own startup data,
freed and reused, can hide a small parse.
