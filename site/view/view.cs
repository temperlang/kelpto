using System.Collections.Concurrent;
using Microsoft.AspNetCore.Components;
using static Kelpto.KelptoGlobal;

static class Views
{
    // Parsed and sanitized once per text, not on every render.
    static readonly ConcurrentDictionary<string, MarkupString> Posts = new();

    static MarkupString PostHtml(string markdown)
    {
        if (Posts.Count >= 500) Posts.Clear();
        return Posts.GetOrAdd(markdown, md => new MarkupString(RenderSafe(ParseMarkdownWithHtml(md)).Html));
    }

    // The page from state, as Blazor views go: Kelpto renders the post, not the page.
    public static RenderFragment View(State state) => Layout(Nav(state.User), PostHtml(state.Post.Markdown));
}
