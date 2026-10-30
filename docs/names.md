# Name candidates

**Working name: Kelpto** (the user, 2026-10-30), a clever misspelling of
"klepto", for a set that keeps everything. Free on PyPI, npm,
crates.io, and NuGet (bare, `-markdown`, and `-html`), and none of
kelpto.com, .dev, or .org resolves; a thorough search found only a 2020
song and a known misspelling of Klepto, a Super Mario enemy. To weigh
before release: people typing "klepto" land on Python's `klepto` (a
caching package); "klepto" means thief, slightly off for a library
about safe rendering; some may read "kelp-to". Library names would be
`kelpto-markdown`, `kelpto-html`, `kelpto-tree`, and `kelpto-safe`.

Undecided. These libraries work together, so an umbrella name for the
repo and similar library names fit. Checked 2026-10-30: package
registries by their APIs (LuaRocks and Maven Central weren't reachable),
domains by DNS only, and clashes by a light web search. Nothing here is
a trademark search.

## Stet (was leading)

The proofreader's mark for "let it stand": undo the edit and keep the
original, which is what lossless editing does. Short, and spelled as
it's said.

- **Registries:** bare `stet` is free on npm and NuGet, and taken on
  PyPI (a tiny, early package for caching experiment scripts) and
  crates.io (an active PostScript interpreter, the nearest clash, since
  it renders documents). `stet-markdown`, `stet-html`, and `stetmd` are
  free on PyPI, npm, crates.io, and NuGet; crates.io's `stet-core` is
  taken.
- **Domains:** stet.com, stet.dev, and stet.org all resolve; not
  checked for what's on them.
- **Scheme:** the repo and umbrella `stet`, with `stet-markdown`,
  `stet-html`, `stet-safe` (or `stet-sanitize`), and `stet-tree` (or
  `stet-base`) for the core, avoiding `stet-core`.

- **Trademarks and clashes** (web search, 2026-10-30; not a register
  search): no registered STET mark in software found. Same-field uses:
  an open-source local-first document editor named Stet, with AI
  markup, on GitHub and promoted on Reddit in 2026; Stet, an inactive
  2006 tool for commenting on documents (from the Software Freedom Law
  Center's GPLv3 drafting); STET, an old folding text editor; and the
  crates.io PostScript interpreter. "Stet" is an ordinary proofreading
  word, so a mark on it for editing software would be weak, but the
  name is crowded in documents and editing, which hurts searchability
  more than it risks a lawsuit.

## Others

| Name | Verdict | Notes |
|---|---|---|
| Marquetry | OK | Inlaid patterns, and contains "mark". No clash found; bare crate free. Long, and easy to misspell. |
| Palimpsest | OK | Rewriting while keeping traces. No clash found, but long and hard to spell; better as a tagline. |
| Colophon | OK at best | Crowded in publishing, such as Colophon Foundry. |
| Galley | Avoid | Galley (a Mac app that typesets Markdown), Markdown Galley, and BeeWare Galley. |
| Quire | Avoid | Quire Markdown (a Chrome Markdown viewer), Quire task management, and Getty's Quire. |
| Hypermark | Avoid | `hypermark-py` on PyPI, a Markdown-to-HTML converter from 2026. |
| Folio | Avoid | Very crowded, such as the FOLIO library-services platform. |
| Verbatim | Avoid | A storage-media brand, and LaTeX's `verbatim` makes it hard to search for. |
| Inkle | Avoid | inkle, the game studio behind the ink narrative markup. |
| Vellum | Avoid | Vellum, the book-formatting app. |

## Second round (2026-10-30)

Twenty more, thinking further afield. Checked the same way
(registries by API, domains by DNS, and web searches for six of them;
no register search). Suffixed forms (`NAME-markdown`, `NAME-html`,
`NAME-tree`) are free on PyPI, npm, crates.io, and NuGet for every
name but `fleuron-markdown` on crates.io; every bare name is taken
somewhere, and every name has a registered .com, .dev, or .org.

**Ranked:**

1. **Selvedge:** the edge that keeps fabric from unraveling, as
   lossless roundtripping keeps text. selvedge.com doesn't resolve; no
   software or font clash found. Bare PyPI and npm names belong to
   unrelated AI tools. But "selvage" is a common variant spelling (the
   usual American one), a real risk for a package name people type.
2. **Recto:** short and on theme. recto.dev doesn't resolve; bare
   names are held by minor projects (terminal flashcards on PyPI, a
   stale Bootstrap fork on npm). No product named Recto found, only
   look-alike fonts (Recton, Recta). A common word, so harder to
   search for, and in Spanish it also means rectum.
3. **Pellucid:** bare name free but for a stale npm package, but all
   three domains are taken, and Pellucid Inc. (hardware and operating
   systems, 1992) and Pellucid Analytics (data software, 2012) hold
   trademarks.
4. **Pilcrow:** the most recognizable symbol, but Pilcrow is already
   an open-source Markdown reader and editor for Android, on F-Droid:
   a same-field clash. Also an AI governance SDK on PyPI (2026), a
   2018 font crate, and Pilcrow AG, a Swiss app developer.
   pilcrow.com doesn't resolve (which doesn't prove it's
   unregistered).
5. **Segno:** a lovely round trip, but a popular Python QR-code library
   holds it.

**Avoid:** Dinkus (Textualize's Dinkus, a Markdown editor), Fleuron (a
live paged-media engine taking Markdown), Manicule (active document
search), Quoin (a type-foundry plugin), Imprimatur (document
authoring), Cartouche (a Sphinx extension), Folium, Hedera, Intaglio,
Tessera, Asterism, Twill, Frisket, and Mimeo (crowded or famous).
Burin is OK at best.

**The ideas behind them:**

**Marks of the text itself:**

- **Pilcrow:** ¶, the paragraph mark; instantly about text.
- **Dinkus:** `* * *`, a section break; Markdown's `***` is one.
- **Fleuron:** ❦, a printer's ornament.
- **Asterism:** ⁂.
- **Hedera:** ❧, a leaf ornament.
- **Manicule:** ☞, the pointing hand readers drew in margins.

**The printing trade, where each tool maps to a job:**

- **Quoin:** the wedge that locks set type in place, as text stays as
  written.
- **Frisket:** the mask that protects the page from stray ink, as safe
  rendering does.
- **Imprimatur:** approval to print.
- **Burin:** an engraver's tool.
- **Intaglio:** engraved printing.
- **Recto:** the right-hand page.
- **Folium:** a leaf of a book.

**Round trips and fidelity:**

- **Segno:** the sign that *dal segno* returns to, a round trip.
- **Mimeo:** a faithful copy.
- **Pellucid:** clear all the way through.

**Weaving and making:**

- **Selvedge:** the self-finished edge that keeps fabric from
  unraveling.
- **Twill:** a weave of two threads, Markdown and HTML.
- **Tessera:** one tile of a mosaic.
- **Cartouche:** a framed inscription.

## Third round (2026-10-30), strict criteria

Each name must have one obvious spelling, not be a common word in a
major language (nor rude or awkward anywhere), and have no same-field
project (GitHub, F-Droid, app stores, and registries); every name got
at least two web searches. Mostly coined, as Hrefine was.

**Passes every criterion:** Tagwell, Marklock, Kepto, Twinmark,
Keepmark, Roundmark, Markfast, Inkfast, Tagfast, and Marksure. Each
is free on PyPI, npm, crates.io, and NuGet, bare and suffixed, and
nothing named so turned up on GitHub, the app stores, or F-Droid.

**Ranked:**

1. **Tagwell:** "tags, done well". Looked cleanest, but a thorough
   search found TagWell™ from SoftPLC (an industrial IoT software
   platform), TagWell (a wellness booking app, tagwell.com), and
   Tagwell Solutions LLC (business software). Dropped. This round's
   web searches were too shallow, so its other passes need rechecking
   with thorough searches.
2. **Marklock:** "marks locked in", lossless; Markdown-first. Domains
   don't resolve. A pending USPTO application for MARKLOCK (serial
   99792928, April 2026) covers trademark-portfolio software, another
   field but a software class. "Lock" can suggest DRM.
3. **Kepto:** invented, from "keep", like Ordable. All three domains
   don't resolve, but the name is busier than the check found: an
   Australian receipts app, a crypto token, and, per the user, lots of
   other companies and apps. Dropped.
4. **Twinmark:** Markdown and HTML as twins. .com is parked.
5. **Keepmark:** says lossless plainly, if blandly. .com is parked.

Close behind: Roundmark (best meaning, but .com and .dev resolve),
Markfast (a fashion designer, Mark Fast), Marksure, Inkfast, and
Tagfast (Avery Dennison's Tag Fast fasteners). Faithmark passes with
a religious overtone and a finance trademark owner.

**Failed:** Proofmark (a firearms term, and taken bare names),
Evermark (an iOS Markdown editor), Inkwise (an AI writing tool),
Inkora (a TipTap editor on npm; Inkra, a Markdown editor), Lumark
(ambiguous pronunciation, and Cooper Lighting's trademark), Selvo (a
Markdown knowledge-base product), Holdfast and Inkline (common words,
taken), and Proofline (taken bare names). The checker's own coinages,
Fidelo, Kepra, Tessil, Velno, and Ravell, fail on homophones or
meanings (Fidelio, Keppra, Tessl, Italian *veleno*, Ravel).

**Keptag** (the user's idea, checked 2026-10-30): every package slot
free, and nothing named so found, but searches take it for "keytag" or
"KeepTag", and "kept tag" has one t sound, so people would type
`keeptag` or `keytag`. keptag.com resolves (likely parked); .dev and
.org don't.

**Thorough recheck** (extended searches, 2026-10-30) of the remaining
passes; none is clean:

- **Marklock:** avoid. MarkLock, an active local-first encrypted
  Markdown editor (GitHub WitsonX/MarkLock), and MARKLOCK, a
  trademark-management SaaS.
- **Keepmark:** avoid. Keepmark, a paid desktop notes app with a
  Markdown editor, and Keepmark, an active open-source bookmark sync
  project.
- **Roundmark:** avoid. Roundmark, a design-feedback SaaS that
  comments on documents.
- **Marksure:** avoid. MarkSure, an Android watermarking app; Marksure
  Print Solutions (India); and a gradebook.
- **Twinmark:** leaning avoid. No software product, but Twinmark Media
  Enterprises, banned by Facebook in 2019 as a fake-news network, plus
  agencies and an arXiv ML watermarking method, TwinMark.
- **Markfast:** the cleanest, with no software found, but the Mark Fast
  fashion label owns markfast.com, and "fast" invites speed claims.

Compounds of common words (mark, keep, tag, ink) are nearly all in
use; a next round should try truly invented words, checked thoroughly
from the start.

## Before deciding

- Check LuaRocks and Maven Central.
- Search trademarks (USPTO, EUIPO, and WIPO) in software classes 9
  and 42, directly in the registers (tmsearch.uspto.gov needs a
  browser).
- See what's on the main domains.
