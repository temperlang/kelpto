local md = require("kelpto-md")
local LinkTarget, MarkdownParser = md.LinkTarget, md.MarkdownParser

local text = "Title\r\n"
  .. "=====\r\n"
  .. "\r\n"
  .. "Café — naïve 😀 ??( \001 ctrl\r\n"
  .. "\r\n"
  .. "| a | [l](/x) |\r\n"
  .. "|---|---|\r\n"
  .. "| 1 | 2 |\r\n"
  .. "\r\n"
  .. "- [ ] täsk\r\n"
local doc = MarkdownParser.gfm:parse(text)
doc = doc.links[1]:withDestination(LinkTarget("/ünï 😀"))
doc = doc.tables[1].rows[1].cells[1]:withText("naïve ☕")
doc = doc.taskListItems[1]:withChecked(true)
doc = doc.headings[1]:withText("Café — 😀")
print(doc.asWritten)
