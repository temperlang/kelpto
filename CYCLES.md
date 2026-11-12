# Reference cycles: a trial

A trial of Temper's proposed memory cycle checker, for discussion: what
would it report on Kelpto, and what would Kelpto change to pass? The
checker doesn't exist yet, so this branch pretends it does. The
`forbids` clause isn't real syntax yet, so this branch doesn't compile.

Backends without a garbage collector (C++, Rust) reference count
Temper's objects, and reference counting can't free a cycle. The
proposal makes cycles a compile-time error, with `forbids` clauses on
type parameters and type declarations (`class Cons<T forbids Cons<T>>`)
to say what a type may never lead back to. It builds on Temper issues
[#5](https://github.com/temperlang/temper/issues/5) ("does not
reference" bounds) and [#7](https://github.com/temperlang/temper/issues/7)
(`this` escaping a constructor).

## The rules, as read here

1. **A "may reference" graph over types.** An edge from `A` to `B` when
   an `A` can hold a `B`: a field, a `List` or `ListBuilder` element, a
   `Map` or `MapBuilder` key or value, or a variable captured by a
   stored closure. Edges count subtypes, so an interface reaches every
   implementation.
2. **Mutable edges** are `var` fields, builder elements, keys, and
   values, and captured `var`s. A field typed `Listed` or `Mapped` may
   hold a builder, so its elements count as mutable too.
3. **Every loop through a mutable edge is an error,** reported at that
   field. Loops of immutable edges are fine: an object can only point at
   older ones.
4. **Generic instantiations** are checked against `forbids` where they
   happen.
5. **Constructors:** `this` isn't used until every field is set (already
   the rule). Kelpto passes `this` on only from methods, as `RedNode`
   does making its children's views.

Where the proposal and other sketches differ or are silent, this trial
takes the stricter, more literal reading:

- **`forbids` is transitive:** `T forbids X` means a `T` can't reach an
  `X` by any path, as the proposal's `Cons` example needs.
- **Open types reach anything.** `AnyValue`, and an interface with
  implementations the library can't see (exported and not `sealed`,
  including `@fun` interfaces), have an edge to every type. That counts
  on any path, not only for fields declared with that type: a mutable
  edge whose target can reach an open type can lead back.
- **Closed interfaces** are `sealed` ones and ones not exported, whose
  implementations are all in the library.
- **Stored closures** (a field or element of a function or `@fun`
  interface type) have edges to what they capture. Closures only passed
  as arguments add none.
- **std's types:** `ListBuilder`, `MapBuilder`, and similar hold mutable
  edges to their elements, and declare `forbids` on them (say,
  `ListBuilder<T forbids ListBuilder<T>>`). `List` and `Map` hold
  immutable ones. `StringBuilder` holds only text.
- **No write-once exemption:** a `var` set only before its object
  escapes still counts as mutable (#7's `late` isn't in the proposal).

## What it reports

Types analyzed: 142 (135 in the libraries, 7 in the test libraries).
Two reports, fixed with one `forbids` clause and one restructure; no
cases the rules can't express.

### `BlockData.children`: a real cycle

The block parser's tree kept each block's children in a
`ListBuilder<BlockData>`, and each child its `parent`. The checker
reports the mutable loop `BlockData.children` → `BlockData`. It's a real
cycle, not just a possible one: every block with a parent is in one, so
in today's C++ and Rust translations every parse leaks its whole block
tree.

**Change** (in kelpto-md's blocks): children are ids, `ListBuilder<Int>`,
and the parser keeps every block in `blocks`, by id (ids were already
numbered from 0, in order). The immutable `parent` stays: a child
pointing at its older parent is fine. `lastRealChild`, `hasRealChild`,
and `openLastChild` move to the parser, which has the blocks. It
compiles today: with the `forbids` clause below taken out, the
interpreter passes kelpto-md's tests and the CommonMark, GFM, and
sample suites.

### `MarkdownRenderer.options`: noise

`options` is a `var` holding `RenderOptions`, whose `highlighter` is a
`CodeHighlighter`, an exported `@fun` interface, so it may reach
anything, a `MarkdownRenderer` included. The checker reports the loop
at `options`. But `options` is only ever set by `made`, on a renderer
it has just made, before anything else sees it; it's a `var` only
because the public constructor doesn't take options.

**Change:** `CodeHighlighter … forbids MarkdownRenderer`, so a
highlighter can't refer to a renderer, even through other objects. That
closes the loop, with no runtime change. The cost falls on users: each
highlighter they write is checked against it, though only one that
refers to a renderer, say through a captured `var`, is refused, and
that one could make a real cycle.

The other fix would be making `options` immutable, set by the
constructor; that means a public constructor taking the internal
`RenderOptions`, or an API change, so the `forbids` was the smaller
edit. Without either, a user-side cycle is still caught: a highlighter
capturing a `var` that holds its renderer loops through that captured
`var` in the user's code.

## Near misses

What passes, and what would have been reported with small changes:

- **Red-green trees.** `RedNode` and `RedToken` keep their `parent`,
  immutably, and make children's views on demand, never caching them.
  A cache in a `var` would be a report, and a real cycle.
- **Built HTML trees and inline lists** are already arenas: `BuiltTree`
  and `InlineParser` keep parents, children, and siblings as `Int`
  lists. The block parser now matches them.
- **Open interfaces** (`UrlCheck`, `RawHtmlHandler`, `RawHtmlRenderer`,
  `RenderSink`, `RawHtmlContent`) are held only in immutable fields,
  and no mutable edge leads to them, so they pass without `forbids`.
- **Token sinks:** `TokenSink` isn't exported, so its implementations
  (`NoTokenSink`, `StreamSink`, `TreeBuilder`) are known, and the
  tokenizer, sink, stream, and tree builder hold each other only one
  way.
- **No generic types** of Kelpto's own, so nothing needs a `forbids`
  clause on a type parameter.

## Noise and real risks

One of each. `BlockData` is a real leak, and the fix is the one the
memory tutorial suggests (indices instead of back references). The
`options` report is noise from a write-once `var`; a rule that treated
fields set only before the object escapes as part of construction would
remove it, and leave the user-side check in place.
