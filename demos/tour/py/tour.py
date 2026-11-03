"""A tour of Kelpto's Markdown library, from Python.

The same tour exists for each language Kelpto supports, and they all print
the same text. See demos/README.md for how to run them.
"""

from kelpto_md import (
    Heading, Inlines, Link, LinkReferenceDefinition, LinkTarget, MarkdownBuilder, MarkdownParser, MarkdownRenderer,
    parse_markdown,
)


def section(title):
    print()
    print(f"## {title}")


def shown(text):
    """Tabs and line endings made visible."""
    return text.replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n")


def rendered(label, html):
    """Rendered HTML under a label, without its last newline."""
    print(f"{label}:")
    print(html.removesuffix("\n"))


def changes(before, after):
    """The lines an edit changed, and how many it left alone."""
    old = before.split("\n")
    new = after.split("\n")
    changed = 0
    for a, b in zip(old, new):
        if a != b:
            print(f"- {a}")
            print(f"+ {b}")
            changed += 1
    print(f"{changed} of {len(old) - 1} lines changed, the rest byte for byte")


print("# Kelpto tour")

section("1. Parse and print, losslessly")

text = """# Release notes

Kelpto keeps *every*   byte.

| Library     | Status |
|:------------|-------:|
| kelpto-md   | ready  |
| kelpto-html | early  |

- [x] CommonMark
- [ ] HTML trees

Read [the docs][docs].

[docs]: https://example.com/old
"""
doc = MarkdownParser.gfm.parse(text)
print(f"printed back exactly: {str(doc.as_written == text).lower()}")
heading = doc.headings[0]
print(f"heading {heading.level}: {heading.text}")
table = doc.tables[0]
print(f"table: {', '.join(c.text for c in table.header.cells)} ({', '.join(table.alignments)})")
for row in table.rows:
    print(f"row: {', '.join(c.text for c in row.cells)}")
for task in doc.task_list_items:
    print(f"task: {task.marker} {'checked' if task.checked else 'not checked'}")
definition = doc.link_reference_definitions[0]
print(f"definition: {definition.label} -> {definition.destination.url}")

# Odd input prints back as written too: tabs, line endings, and spacing.
for odd in ["  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n"]:
    print(f"{shown(odd)} -> {'exactly' if parse_markdown(odd).as_written == odd else 'changed'}")

section("2. Edit one part")

# Each edit gives a new document; the old one stays as it was.
edited = doc.headings[0].with_text("Release notes, 0.1")
edited = edited.tables[0].rows[1].cells[1].with_text("ready")
edited = edited.task_list_items[1].with_checked(True)
edited = edited.link_reference_definitions[0].with_destination(LinkTarget("https://example.com/new"))
changes(text, edited.as_written)
print(f"at level 2: {shown(edited.headings[0].with_level(2).headings[0].as_written)}")
try:
    edited.headings[0].with_level(7)
    print("level 7: done")
except RuntimeError:
    print("level 7: throws")

section("3. Render, safe by default")

page = parse_markdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n")
rendered("safe", page.to_html())
rendered("trusted", MarkdownRenderer().with_raw_html_trusted().render(page))
rendered("trusted, GFM's filter", MarkdownRenderer().with_raw_html_trusted().with_disallowed_raw_html_filtered().render(page))

section("4. GitHub Flavored Markdown")

gfm_text = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n"
gfm = MarkdownParser.gfm.parse(gfm_text)
rendered("GFM", gfm.to_html())
cell = gfm.tables[0].rows[0].cells[1]
print(f"cell {cell.text}: column {cell.column}, {cell.alignment}")
plain = MarkdownParser.common_mark.parse(gfm_text)
print(f"as CommonMark: tables {len(plain.tables)}, task items {len(plain.task_list_items)}")
tables_only = MarkdownParser.common_mark.with_tables(True).parse(gfm_text)
print(f"tables alone: tables {len(tables_only.tables)}, task items {len(tables_only.task_list_items)}")
checked = gfm.task_list_items[0].with_checked(True)
print(f"checked: {shown(checked.task_list_items[0].as_written)}")

section("5. Footnotes")

notes = MarkdownParser.gfm.parse("Lossless[^1], always.\n\n[^1]: Every byte.\n")
reference = notes.footnote_references[0]
print(f"reference {reference.label} -> definition {reference.definition.label}")
rendered("html", notes.to_html())
renamed = notes.footnote_definitions[0].with_label("bytes")
found = renamed.footnote_references[0].definition
print(f"definition renamed: reference finds {found.label if found else 'nothing'}")
renamed = renamed.footnote_references[0].with_label("bytes")
found = renamed.footnote_references[0].definition
print(f"reference renamed: reference finds {found.label if found else 'nothing'}")
print(shown(renamed.as_written))
try:
    notes.footnote_definitions[0].with_label("two words")
    print("label 'two words': done")
except RuntimeError:
    print("label 'two words': throws")

section("6. Walk and transform")

guide = "# Guide\n\nRead [this](start.md), [that][t], and [top](#top).\n\n## More\n\n[t]: api.md\n"
doc = parse_markdown(guide)
# Every view inside the document, in order, each knowing its depth.
for view in doc.descendants:
    if isinstance(view, Heading):
        print(f"depth {view.depth}, heading {view.level}: {view.text}")
    elif isinstance(view, Link):
        print(f"depth {view.depth}, link {view.text} -> {view.destination.url}")
# Many edits, one new document: headings a level down, relative links absolute.
base = "https://example.com/docs/"
editor = doc.editor()
for view in doc.descendants:
    if isinstance(view, Heading):
        editor.set_level(view, view.level + 1)
    elif isinstance(view, Link) and view.style == "inline" and not view.destination.url.startswith("#"):
        editor.set_destination(view, LinkTarget(base + view.destination.url))
    elif isinstance(view, LinkReferenceDefinition):
        editor.set_destination(view, LinkTarget(base + view.destination.url))
changes(guide, editor.to_document().as_written)

section("7. Build from plain strings")

# Text from anywhere, escaped so it reads back as written.
name = "<Ana> #1"
said = "*really*"
b = MarkdownBuilder()
b.heading(2, Inlines.empty.text(f"Report for {name}"))
b.paragraph(
    Inlines.empty.text("Said: ").emphasis(Inlines.empty.text(said)).text(" see ")
    .link(Inlines.empty.text("the [docs]"), LinkTarget("docs/read me.md"))
)
first = MarkdownBuilder()
first.paragraph(Inlines.empty.text("1. first, `x`"))
second = MarkdownBuilder()
second.code_block("py", "print('```')\n")
b.bullet_list([first, second])
rendered("markdown", b.to_markdown())
built = b.to_document()
print(f"heading: {built.headings[0].text}")
print(f"link: {built.links[0].text} -> {built.links[0].destination.url}")
rendered("html", built.to_html())
