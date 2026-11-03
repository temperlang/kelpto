-- A tour of Kelpto's Markdown library, from Lua.
--
-- The same tour exists for each language Kelpto supports, and they all print
-- the same text. See demos/README.md for how to run them.

local md = require("kelpto-md")
local LinkTarget, MarkdownParser, MarkdownRenderer = md.LinkTarget, md.MarkdownParser, md.MarkdownRenderer
local parseMarkdown = md.parseMarkdown
local Heading, Link, LinkReferenceDefinition = md.Heading, md.Link, md.LinkReferenceDefinition
local Inlines, MarkdownBuilder = md.Inlines, md.MarkdownBuilder
local null_to_nil = require("temper-core").null_to_nil
local instance_of = require("temper-core").instance_of

local function section(title)
  print()
  print("## " .. title)
end

-- Tabs and line endings made visible.
local function shown(text)
  return (text:gsub("\t", "\\t"):gsub("\r", "\\r"):gsub("\n", "\\n"))
end

-- Rendered HTML under a label, without its last newline.
local function rendered(label, html)
  print(label .. ":")
  print((html:gsub("\n$", "")))
end

local function lines(text)
  local out = {}
  for line in (text .. "\n"):gmatch("(.-)\n") do
    out[#out + 1] = line
  end
  return out
end

-- The lines an edit changed, and how many it left alone.
local function changes(before, after)
  local old, new = lines(before), lines(after)
  local changed = 0
  for i, a in ipairs(old) do
    if a ~= new[i] then
      print("- " .. a)
      print("+ " .. new[i])
      changed = changed + 1
    end
  end
  print(changed .. " of " .. (#old - 1) .. " lines changed, the rest byte for byte")
end

local function texts(cells)
  local out = {}
  for _, cell in ipairs(cells) do
    out[#out + 1] = cell.text
  end
  return table.concat(out, ", ")
end

print("# Kelpto tour")

section("1. Parse and print, losslessly")

local text = [[
# Release notes

Kelpto keeps *every*   byte.

| Library     | Status |
|:------------|-------:|
| kelpto-md   | ready  |
| kelpto-html | early  |

- [x] CommonMark
- [ ] HTML trees

Read [the docs][docs].

[docs]: https://example.com/old
]]
local doc = MarkdownParser.gfm:parse(text)
print("printed back exactly: " .. tostring(doc.asWritten == text))
local heading = doc.headings[1]
print("heading " .. heading.level .. ": " .. heading.text)
local tbl = doc.tables[1]
print("table: " .. texts(tbl.header.cells) .. " (" .. table.concat(tbl.alignments, ", ") .. ")")
for _, row in ipairs(tbl.rows) do
  print("row: " .. texts(row.cells))
end
for _, task in ipairs(doc.taskListItems) do
  print("task: " .. task.marker .. " " .. (task.checked and "checked" or "not checked"))
end
local definition = doc.linkReferenceDefinitions[1]
print("definition: " .. definition.label .. " -> " .. definition.destination.url)

-- Odd input prints back as written too: tabs, line endings, and spacing.
for _, odd in ipairs({ "  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n" }) do
  print(shown(odd) .. " -> " .. (parseMarkdown(odd).asWritten == odd and "exactly" or "changed"))
end

section("2. Edit one part")

-- Each edit gives a new document; the old one stays as it was.
local edited = doc.headings[1]:withText("Release notes, 0.1")
edited = edited.tables[1].rows[2].cells[2]:withText("ready")
edited = edited.taskListItems[2]:withChecked(true)
edited = edited.linkReferenceDefinitions[1]:withDestination(LinkTarget("https://example.com/new"))
changes(text, edited.asWritten)
print("at level 2: " .. shown(edited.headings[1]:withLevel(2).headings[1].asWritten))
if pcall(edited.headings[1].withLevel, edited.headings[1], 7) then
  print("level 7: done")
else
  print("level 7: throws")
end

section("3. Render, safe by default")

local page = parseMarkdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n")
rendered("safe", page:toHtml())
rendered("trusted", MarkdownRenderer():withRawHtmlTrusted():render(page))
rendered("trusted, GFM's filter", MarkdownRenderer():withRawHtmlTrusted():withDisallowedRawHtmlFiltered():render(page))

section("4. GitHub Flavored Markdown")

local gfmText = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n"
local gfm = MarkdownParser.gfm:parse(gfmText)
rendered("GFM", gfm:toHtml())
local cell = gfm.tables[1].rows[1].cells[2]
print("cell " .. cell.text .. ": column " .. cell.column .. ", " .. cell.alignment)
local plain = MarkdownParser.commonMark:parse(gfmText)
print("as CommonMark: tables " .. #plain.tables .. ", task items " .. #plain.taskListItems)
local tablesOnly = MarkdownParser.commonMark:withTables(true):parse(gfmText)
print("tables alone: tables " .. #tablesOnly.tables .. ", task items " .. #tablesOnly.taskListItems)
local checked = gfm.taskListItems[1]:withChecked(true)
print("checked: " .. shown(checked.taskListItems[1].asWritten))

section("5. Footnotes")

-- A missing value is temper.null, which is truthy, so null_to_nil makes it nil.
local function labelOf(definition)
  local found = null_to_nil(definition)
  return found and found.label or "nothing"
end

local notes = MarkdownParser.gfm:parse("Lossless[^1], always.\n\n[^1]: Every byte.\n")
local reference = notes.footnoteReferences[1]
print("reference " .. reference.label .. " -> definition " .. reference.definition.label)
rendered("html", notes:toHtml())
local renamed = notes.footnoteDefinitions[1]:withLabel("bytes")
print("definition renamed: reference finds " .. labelOf(renamed.footnoteReferences[1].definition))
renamed = renamed.footnoteReferences[1]:withLabel("bytes")
print("reference renamed: reference finds " .. labelOf(renamed.footnoteReferences[1].definition))
print(shown(renamed.asWritten))
local footnote = notes.footnoteDefinitions[1]
if pcall(footnote.withLabel, footnote, "two words") then
  print("label 'two words': done")
else
  print("label 'two words': throws")
end

section("6. Walk and transform")

local guide = "# Guide\n\nRead [this](start.md), [that][t], and [top](#top).\n\n## More\n\n[t]: api.md\n"
local guideDoc = parseMarkdown(guide)
-- Every view inside the document, in order, each knowing its depth.
for _, view in ipairs(guideDoc.descendants) do
  if instance_of(view, Heading) then
    print("depth " .. view.depth .. ", heading " .. view.level .. ": " .. view.text)
  elseif instance_of(view, Link) then
    print("depth " .. view.depth .. ", link " .. view.text .. " -> " .. view.destination.url)
  end
end
-- Many edits, one new document: headings a level down, relative links absolute.
local base = "https://example.com/docs/"
local editor = guideDoc:editor()
for _, view in ipairs(guideDoc.descendants) do
  if instance_of(view, Heading) then
    editor:setLevel(view, view.level + 1)
  elseif instance_of(view, Link) and view.style == "inline" and view.destination.url:sub(1, 1) ~= "#" then
    editor:setDestination(view, LinkTarget(base .. view.destination.url))
  elseif instance_of(view, LinkReferenceDefinition) then
    editor:setDestination(view, LinkTarget(base .. view.destination.url))
  end
end
changes(guide, editor:toDocument().asWritten)

section("7. Build from plain strings")

-- Text from anywhere, escaped so it reads back as written.
local name = "<Ana> #1"
local said = "*really*"
local b = MarkdownBuilder()
b:heading(2, Inlines.empty:text("Report for " .. name))
b:paragraph(
  Inlines.empty:text("Said: "):emphasis(Inlines.empty:text(said)):text(" see ")
    :link(Inlines.empty:text("the [docs]"), LinkTarget("docs/read me.md"))
)
local first = MarkdownBuilder()
first:paragraph(Inlines.empty:text("1. first, `x`"))
local second = MarkdownBuilder()
second:codeBlock("py", "print('```')\n")
b:bulletList({ first, second })
rendered("markdown", b:toMarkdown())
local built = b:toDocument()
print("heading: " .. built.headings[1].text)
print("link: " .. built.links[1].text .. " -> " .. built.links[1].destination.url)
rendered("html", built:toHtml())
