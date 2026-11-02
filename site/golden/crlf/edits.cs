using System;
using KelptoMd;

var text = "Title\r\n" +
    "=====\r\n" +
    "\r\n" +
    "Café — naïve 😀 ??( \u0001 ctrl\r\n" +
    "\r\n" +
    "| a | [l](/x) |\r\n" +
    "|---|---|\r\n" +
    "| 1 | 2 |\r\n" +
    "\r\n" +
    "- [ ] täsk\r\n";
var doc = MarkdownParser.Gfm.Parse(text);
doc = ((Link) doc.Tables[0].Header.Cells[1].Children[0]).WithDestination(new LinkTarget("/ünï 😀"));
doc = doc.Tables[0].Rows[0].Cells[0].WithText("naïve ☕");
doc = doc.TaskListItems[0].WithChecked(true);
doc = doc.Headings[0].WithText("Café — 😀");
Console.WriteLine(doc.AsWritten);
