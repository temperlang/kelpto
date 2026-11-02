// Times Markdown parsers in C#, for scripts/bench.py.
//
//     dotnet bin/Release/net6.0/Bench.dll time PLAN
//     dotnet bin/Release/net6.0/Bench.dll mem LIBRARY TASK FILE
//
// See ../README.md for the plan format and what each task does.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using KelptoMd;

static Dictionary<string, Func<string, long>> Kelpto()
{
    var parser = MarkdownParser.CommonMark;
    var renderer = new MarkdownRenderer().WithRawHtmlTrusted();
    return new()
    {
        ["parse"] = text => parser.Parse(text).Span.End,
        ["render"] = text => renderer.Render(parser.Parse(text)).Length,
        ["walk"] = text =>
        {
            var doc = parser.Parse(text);
            var views = doc.Descendants;
            long headings = 0;
            foreach (var view in views)
            {
                if (view is Heading) headings += 1;
            }
            return views.Count + headings + doc.AsWritten.Length;
        },
        ["transform"] = text =>
        {
            var doc = parser.Parse(text);
            var editor = doc.Editor();
            foreach (var heading in doc.Headings)
            {
                var level = heading.Level;
                if (level < 6 && !(level == 2 && heading.Style == "setext")) editor.SetLevel(heading, level + 1);
            }
            return editor.ToDocument().AsWritten.Length;
        },
    };
}

static Dictionary<string, Func<string, long>> MarkdigTasks()
{
    // The default pipeline is CommonMark alone, with raw HTML passed through.
    var pipeline = new Markdig.MarkdownPipelineBuilder().Build();
    return new()
    {
        ["parse"] = text => Markdig.Markdown.Parse(text, pipeline).Count,
        ["render"] = text => Markdig.Markdown.ToHtml(text, pipeline).Length,
    };
}

static Dictionary<string, Func<string, long>> Library(string name) => name switch
{
    "kelpto" => Kelpto(),
    "markdig" => MarkdigTasks(),
    "none" => new() { ["read"] = text => text.Length },
    _ => throw new ArgumentException(name),
};

static string Read(string path) => File.ReadAllText(path, System.Text.Encoding.UTF8);

if (args[0] == "mem")
{
    Console.WriteLine(Library(args[1])[args[2]](Read(args[3])));
    return;
}
var lines = File.ReadAllLines(args[1]).Where(line => line.Length > 0).ToList();
var head = lines[0].Split(' ').Select(x => double.Parse(x, CultureInfo.InvariantCulture)).ToArray();
var made = new Dictionary<string, Dictionary<string, Func<string, long>>>();
foreach (var line in lines.Skip(1))
{
    var job = line.Split('\t');
    if (!made.ContainsKey(job[0])) made[job[0]] = Library(job[0]);
    var op = made[job[0]][job[1]];
    var text = Read(job[2]);
    var (warmupMs, sampleMs, maxSamples, budgetMs) = (head[0], head[1], (int)head[2], head[3]);
    long check;
    var count = 0;
    var watch = Stopwatch.StartNew();
    double elapsed;
    for (;;)
    {
        check = op(text);
        count += 1;
        elapsed = watch.Elapsed.TotalSeconds;
        if (elapsed * 1000 >= warmupMs && count >= 2) break;
    }
    var perOp = elapsed / count;
    var inner = (int)Math.Max(1, Math.Round(sampleMs / 1000 / perOp));
    var samples = Math.Max(3, Math.Min(maxSamples, (int)(budgetMs / 1000 / (perOp * inner))));
    var times = new List<double>();
    long sink = 0;
    for (var i = 0; i < samples; i += 1)
    {
        GC.Collect();
        var begin = Stopwatch.GetTimestamp();
        for (var j = 0; j < inner; j += 1) sink += op(text);
        times.Add((Stopwatch.GetTimestamp() - begin) / (double)Stopwatch.Frequency / inner);
    }
    if (sink == 42) Console.Error.Write("");
    var shown = string.Join(" ", times.Select(t => t.ToString("E9", CultureInfo.InvariantCulture)));
    Console.WriteLine($"{job[0]}\t{job[1]}\t{job[2]}\t{inner}\t{check}\t{shown}");
}
