using System;
using KelptoMd;

var text = @"
# Say ""hi"" \\o/ """""" `x` ${y} ??= )"" ]] ]=] [h](/h)	

> *see [here](/a ""t"")*  
> next\\
end ""q""";
var doc = MarkdownParser.CommonMark.Parse(text);
doc = ((Link) doc.Headings[0].Children[3]).WithDestination(new LinkTarget("/h?a=\"b\"&c=\\d"));
doc = ((Link) ((Emphasis) ((Paragraph) doc.Blocks[4]).Children[0]).Children[1]).WithDestination(new LinkTarget("/b`${c}`??=)\"]]"));
doc = doc.Headings[0].WithText("Tab\there, \"quotes\" \\ ??= ]] )\"");
Console.WriteLine(doc.AsWritten);
