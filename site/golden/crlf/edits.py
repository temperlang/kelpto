from kelpto_md import LinkTarget, MarkdownParser

text = """Title\r
=====\r
\r
Café — naïve 😀 ??( \x01 ctrl\r
\r
| a | [l](/x) |\r
|---|---|\r
| 1 | 2 |\r
\r
- [ ] täsk\r
"""
doc = MarkdownParser.gfm.parse(text)
doc = doc.links[0].with_destination(LinkTarget("/ünï 😀"))
doc = doc.tables[0].rows[0].cells[0].with_text("naïve ☕")
doc = doc.task_list_items[0].with_checked(True)
doc = doc.headings[0].with_text("Café — 😀")
print(doc.as_written)
