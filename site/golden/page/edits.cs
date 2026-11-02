using System;
using KelptoMd;

var text = @"Release notes
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

Read [the docs][docs], or the [FAQ](https://example.com/faq ""FAQ"").
Footnotes work too.[^why]

[docs]:   https://example.com/old
[^why]: GitHub has them.
";
var doc = MarkdownParser.Gfm.Parse(text);
doc = doc.Headings[0].WithText("Release notes, “0.2” \"final\" \\ ok");
doc = doc.Tables[0].Header.Cells[1].WithText("State");
doc = doc.Tables[0].Rows[1].Cells[2].WithText("0.2");
doc = doc.TaskListItems[2].WithChecked(true);
doc = doc.LinkReferenceDefinitions[0].WithDestination(new LinkTarget("https://example.com/new?q=é"));
doc = ((Link) ((Paragraph) doc.Blocks[14]).Children[3]).WithDestination(new LinkTarget("https://example.com/faq#ünï"));
doc = doc.Headings[1].WithText("Links 🔗");
Console.WriteLine(doc.AsWritten);
