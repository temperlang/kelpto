local md = require("kelpto-md")
local LinkTarget, MarkdownParser = md.LinkTarget, md.MarkdownParser

local text = [==[

# Say "hi" \\o/ """ `x` ${y} ??= )" ]] ]=] [h](/h)	

> *see [here](/a "t")*  
> next\\
end "q"]==]
local doc = MarkdownParser.commonMark:parse(text)
doc = doc.links[1]:withDestination(LinkTarget("/h?a=\"b\"&c=\\d"))
doc = doc.links[2]:withDestination(LinkTarget("/b`${c}`??=)\"]]"))
doc = doc.headings[1]:withText("Tab\there, \"quotes\" \\ ??= ]] )\"")
print(doc.asWritten)
