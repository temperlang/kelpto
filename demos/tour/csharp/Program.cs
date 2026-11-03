// A tour of Kelpto's Markdown library, from C#.
//
// The same tour exists for each language Kelpto supports, and they all print
// the same text. See demos/README.md for how to run them.

using System;
using System.Linq;
using KelptoMd;
using static KelptoMd.KelptoMdGlobal;

static void Section(string title)
{
    Console.WriteLine();
    Console.WriteLine($"## {title}");
}

// Tabs and line endings made visible.
static string Shown(string text) => text.Replace("\t", "\\t").Replace("\r", "\\r").Replace("\n", "\\n");

// Rendered HTML under a label, without its last newline.
static void Rendered(string label, string html)
{
    Console.WriteLine($"{label}:");
    Console.WriteLine(html.EndsWith("\n") ? html[..^1] : html);
}

// The lines an edit changed, and how many it left alone.
static void Changes(string before, string after)
{
    var oldLines = before.Split('\n');
    var newLines = after.Split('\n');
    var changed = 0;
    foreach (var (a, b) in oldLines.Zip(newLines))
    {
        if (a != b)
        {
            Console.WriteLine($"- {a}");
            Console.WriteLine($"+ {b}");
            changed += 1;
        }
    }
    Console.WriteLine($"{changed} of {oldLines.Length - 1} lines changed, the rest byte for byte");
}

Console.WriteLine("# Kelpto tour");

Section("1. Parse and print, losslessly");

var text = @"# Release notes

Kelpto keeps *every*   byte.

| Library     | Status |
|:------------|-------:|
| kelpto-md   | ready  |
| kelpto-html | early  |

- [x] CommonMark
- [ ] HTML trees

Read [the docs][docs].

[docs]: https://example.com/old
";
var doc = MarkdownParser.Gfm.Parse(text);
Console.WriteLine($"printed back exactly: {(doc.AsWritten == text ? "true" : "false")}");
var heading = doc.Headings[0];
Console.WriteLine($"heading {heading.Level}: {heading.Text}");
var table = doc.Tables[0];
Console.WriteLine($"table: {string.Join(", ", table.Header.Cells.Select(c => c.Text))} ({string.Join(", ", table.Alignments)})");
foreach (var row in table.Rows)
{
    Console.WriteLine($"row: {string.Join(", ", row.Cells.Select(c => c.Text))}");
}
foreach (var task in doc.TaskListItems)
{
    Console.WriteLine($"task: {task.Marker} {(task.Checked ? "checked" : "not checked")}");
}
var definition = doc.LinkReferenceDefinitions[0];
Console.WriteLine($"definition: {definition.Label} -> {definition.Destination.Url}");

// Odd input prints back as written too: tabs, line endings, and spacing.
foreach (var odd in new[] { "  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n" })
{
    Console.WriteLine($"{Shown(odd)} -> {(ParseMarkdown(odd).AsWritten == odd ? "exactly" : "changed")}");
}

Section("2. Edit one part");

// Each edit gives a new document; the old one stays as it was.
var edited = doc.Headings[0].WithText("Release notes, 0.1");
edited = edited.Tables[0].Rows[1].Cells[1].WithText("ready");
edited = edited.TaskListItems[1].WithChecked(true);
edited = edited.LinkReferenceDefinitions[0].WithDestination(new LinkTarget("https://example.com/new"));
Changes(text, edited.AsWritten);
Console.WriteLine($"at level 2: {Shown(edited.Headings[0].WithLevel(2).Headings[0].AsWritten)}");
try
{
    edited.Headings[0].WithLevel(7);
    Console.WriteLine("level 7: done");
}
catch (Exception)
{
    Console.WriteLine("level 7: throws");
}

Section("3. Render, safe by default");

var page = ParseMarkdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n");
Rendered("safe", page.ToHtml());
Rendered("trusted", new MarkdownRenderer().WithRawHtmlTrusted().Render(page));
Rendered("trusted, GFM's filter", new MarkdownRenderer().WithRawHtmlTrusted().WithDisallowedRawHtmlFiltered().Render(page));

Section("4. GitHub Flavored Markdown");

var gfmText = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n";
var gfm = MarkdownParser.Gfm.Parse(gfmText);
Rendered("GFM", gfm.ToHtml());
var cell = gfm.Tables[0].Rows[0].Cells[1];
Console.WriteLine($"cell {cell.Text}: column {cell.Column}, {cell.Alignment}");
var plain = MarkdownParser.CommonMark.Parse(gfmText);
Console.WriteLine($"as CommonMark: tables {plain.Tables.Count}, task items {plain.TaskListItems.Count}");
var tablesOnly = MarkdownParser.CommonMark.WithTables(true).Parse(gfmText);
Console.WriteLine($"tables alone: tables {tablesOnly.Tables.Count}, task items {tablesOnly.TaskListItems.Count}");
var checkedDoc = gfm.TaskListItems[0].WithChecked(true);
Console.WriteLine($"checked: {Shown(checkedDoc.TaskListItems[0].AsWritten)}");

Section("5. Footnotes");

var notes = MarkdownParser.Gfm.Parse("Lossless[^1], always.\n\n[^1]: Every byte.\n");
var reference = notes.FootnoteReferences[0];
Console.WriteLine($"reference {reference.Label} -> definition {reference.Definition!.Label}");
Rendered("html", notes.ToHtml());
var renamed = notes.FootnoteDefinitions[0].WithLabel("bytes");
Console.WriteLine($"definition renamed: reference finds {renamed.FootnoteReferences[0].Definition?.Label ?? "nothing"}");
renamed = renamed.FootnoteReferences[0].WithLabel("bytes");
Console.WriteLine($"reference renamed: reference finds {renamed.FootnoteReferences[0].Definition?.Label ?? "nothing"}");
Console.WriteLine(Shown(renamed.AsWritten));
try
{
    notes.FootnoteDefinitions[0].WithLabel("two words");
    Console.WriteLine("label 'two words': done");
}
catch (Exception)
{
    Console.WriteLine("label 'two words': throws");
}

Section("6. Walk and transform");

var guide = "# Guide\n\nRead [this](start.md), [that][t], and [top](#top).\n\n## More\n\n[t]: api.md\n";
var guideDoc = ParseMarkdown(guide);
// Every view inside the document, in order, each knowing its depth.
foreach (var view in guideDoc.Descendants)
{
    if (view is Heading h)
    {
        Console.WriteLine($"depth {h.Depth}, heading {h.Level}: {h.Text}");
    }
    else if (view is Link link)
    {
        Console.WriteLine($"depth {link.Depth}, link {link.Text} -> {link.Destination!.Url}");
    }
}
// Many edits, one new document: headings a level down, relative links absolute.
var baseUrl = "https://example.com/docs/";
var editor = guideDoc.Editor();
foreach (var view in guideDoc.Descendants)
{
    if (view is Heading h)
    {
        editor.SetLevel(h, h.Level + 1);
    }
    else if (view is Link link && link.Style == "inline" && !link.Destination!.Url.StartsWith("#"))
    {
        editor.SetDestination(link, new LinkTarget(baseUrl + link.Destination.Url));
    }
    else if (view is LinkReferenceDefinition d)
    {
        editor.SetDestination(d, new LinkTarget(baseUrl + d.Destination.Url));
    }
}
Changes(guide, editor.ToDocument().AsWritten);

Section("7. Build from plain strings");

// Text from anywhere, escaped so it reads back as written.
var name = "<Ana> #1";
var said = "*really*";
var b = new MarkdownBuilder();
b.Heading(2, Inlines.Empty.Text($"Report for {name}"));
b.Paragraph(
    Inlines.Empty.Text("Said: ").Emphasis(Inlines.Empty.Text(said)).Text(" see ")
        .Link(Inlines.Empty.Text("the [docs]"), new LinkTarget("docs/read me.md")));
var first = new MarkdownBuilder();
first.Paragraph(Inlines.Empty.Text("1. first, `x`"));
var second = new MarkdownBuilder();
second.CodeBlock("py", "print('```')\n");
b.BulletList(new[] { first, second });
Rendered("markdown", b.ToMarkdown());
var built = b.ToDocument();
Console.WriteLine($"heading: {built.Headings[0].Text}");
Console.WriteLine($"link: {built.Links[0].Text} -> {built.Links[0].Destination!.Url}");
Rendered("html", built.ToHtml());

Section("8. Insert, replace, and remove blocks");

var advice = "# Notes\n\n> Old advice.\n> # Tip\n\n- one\n- two\n\nDraft, remove me.\n\nThe end.\n";
var adviceDoc = ParseMarkdown(advice);
var warning = new MarkdownBuilder();
warning.Paragraph(Inlines.Empty.Strong(Inlines.Empty.Text("Careful:")).Text(" it's *hot*."));
var also = new MarkdownBuilder();
also.Paragraph(Inlines.Empty.Text("Also: *this*."));
// Blocks from a builder, where they go, with the prefixes of the block
// quote or list item around them; the rest stays as written.
var adviceEditor = adviceDoc.Editor();
foreach (var view in adviceDoc.Descendants)
{
    if (view is Paragraph p && p.Text == "Old advice.")
    {
        adviceEditor.Replace(p, warning);
    }
    else if (view is Paragraph two && two.Text == "two")
    {
        adviceEditor.InsertAfter(two, also);
    }
    else if (view is Paragraph draft && draft.Text == "Draft, remove me.")
    {
        adviceEditor.Remove(draft);
    }
    else if (view is Heading tip && tip.Text == "Tip")
    {
        adviceEditor.SetContent(tip, Inlines.Empty.Text("Tip ").Code("#1"));
    }
}
var advised = adviceEditor.ToDocument();
Rendered("markdown", advised.AsWritten);
Console.WriteLine($"heading: {advised.Headings[1].Text}");
