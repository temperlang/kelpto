using System;
using KelptoMd;

var text = @"
# Say ""hi"" \\o/ """""" `x` ${y} ??= )"" ]] ]=] [h](/h)	

> *see [here](/a ""t"")*  
> next\\
end ""q""";
var doc = MarkdownParser.CommonMark.Parse(text);
doc = doc.Links[0].WithDestination(new LinkTarget("/h?a=\"b\"&c=\\d"));
doc = doc.Links[1].WithDestination(new LinkTarget("/b`${c}`??=)\"]]"));
doc = doc.Headings[0].WithText("Tab\there, \"quotes\" \\ ??= ]] )\"");
Console.WriteLine(doc.AsWritten);
