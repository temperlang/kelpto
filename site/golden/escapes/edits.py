from kelpto_md import LinkTarget, MarkdownParser

text = """
# Say "hi" \\\\o/ \"\"" `x` ${y} ??= )" ]] ]=] [h](/h)\t

> *see [here](/a "t")*  
> next\\\\
end "q\""""
doc = MarkdownParser.common_mark.parse(text)
doc = doc.links[0].with_destination(LinkTarget("/h?a=\"b\"&c=\\d"))
doc = doc.links[1].with_destination(LinkTarget("/b`${c}`??=)\"]]"))
doc = doc.headings[0].with_text("Tab\there, \"quotes\" \\ ??= ]] )\"")
print(doc.as_written)
