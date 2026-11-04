local md = require("kelpto-md")
local LinkTarget, MarkdownParser = md.LinkTarget, md.MarkdownParser

local text = [[
Release notes
=============

Kelpto keeps   *every* byte, ~~mostly~~ always.
Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, <span style="color: crimson" onmouseover="alert('hi')">often</span>.

| Library     | Status |   Since |
|:------------|:------:|--------:|
| kelpto-md   | ready  |     0.1 |
| kelpto-html | ready  |     0.1 |
| Hrefine     | early  |         |

* [x] CommonMark
* [x] HTML trees
    * [x] html5lib's and WPT's tests
* [ ] Hrefine links

## Links

Read [the docs][docs], or the [FAQ](https://example.com/faq "FAQ").
Footnotes work too.[^why]

[Back to top](javascript:scrollTo(0,0))

[docs]:   https://example.com/old
[^why]: GitHub has them.
]]
local doc = MarkdownParser.gfm:parse(text)
doc = doc.headings[1]:withText("Release notes, “0.2” \"final\" \\ ok")
doc = doc.tables[1].header.cells[2]:withText("State")
doc = doc.tables[1].rows[2].cells[3]:withText("0.2")
doc = doc.taskListItems[3]:withChecked(true)
doc = doc.linkReferenceDefinitions[1]:withDestination(LinkTarget("https://example.com/new?q=é"))
doc = doc.links[2]:withDestination(LinkTarget("https://example.com/faq#ünï"))
doc = doc.links[3]:withDestination(LinkTarget("#top"))
doc = doc.headings[2]:withText("Links 🔗")
print(doc.asWritten)
