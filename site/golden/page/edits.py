from kelpto_md import LinkTarget, MarkdownParser

text = """Release notes
=============

Kelpto keeps   *every* byte, ~~mostly~~ always.
Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.

| Library     | Status |   Since |
|:------------|:------:|--------:|
| kelpto-md   | ready  |     0.1 |
| kelpto-html | early  |         |

* [x] CommonMark
* [ ] HTML trees
    * [ ] html5lib's tests

## Links

Read [the docs][docs], or the [FAQ](https://example.com/faq "FAQ").
Footnotes work too.[^why]

[docs]:   https://example.com/old
[^why]: GitHub has them.
"""
doc = MarkdownParser.gfm.parse(text)
doc = doc.headings[0].with_text("Release notes, “0.2” \"final\" \\ ok")
doc = doc.tables[0].header.cells[1].with_text("State")
doc = doc.tables[0].rows[1].cells[2].with_text("0.2")
doc = doc.task_list_items[2].with_checked(True)
doc = doc.link_reference_definitions[0].with_destination(LinkTarget("https://example.com/new?q=é"))
doc = doc.links[1].with_destination(LinkTarget("https://example.com/faq#ünï"))
doc = doc.headings[1].with_text("Links 🔗")
print(doc.as_written)
