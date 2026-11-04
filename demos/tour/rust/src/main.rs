//! A tour of Kelpto's Markdown and HTML libraries, from Rust.
//!
//! The same tour exists for each language Kelpto supports, and they all
//! print the same text. See demos/README.md for how to run them.

use kelpto_md::{
    parse_markdown, FootnoteDefinition, Heading, Inlines, Link, LinkReferenceDefinition, LinkTarget, MarkdownBuilder, MarkdownNodeTrait,
    MarkdownParser,
    MarkdownRenderer, Paragraph, TableCell,
};
use kelpto::{build_html, markdown_node_of, parse_markdown_with_html, render_safe};
use kelpto_html::builders::FragmentContextBuilder;
use kelpto_html::{parse_html, parse_html_fragment, tokenize_html, BuiltNode, Element, FragmentContext, HtmlNodeTrait, SanitizerPolicy};
use std::sync::Arc;
use temper_core::cast;

fn section(title: &str) {
    println!();
    println!("## {title}");
}

/// Tabs and line endings made visible.
fn shown(text: &str) -> String {
    text.replace('\t', "\\t").replace('\r', "\\r").replace('\n', "\\n")
}

/// Rendered HTML under a label, without its last newline.
fn rendered(label: &str, html: &str) {
    println!("{label}:");
    println!("{}", html.strip_suffix('\n').unwrap_or(html));
}

/// The lines an edit changed, and how many it left alone.
fn changes(before: &str, after: &str) {
    let old: Vec<&str> = before.split('\n').collect();
    let mut changed = 0;
    for (a, b) in old.iter().zip(after.split('\n')) {
        if *a != b {
            println!("- {a}");
            println!("+ {b}");
            changed += 1;
        }
    }
    println!("{changed} of {} lines changed, the rest byte for byte", old.len() - 1);
}

fn texts(cells: &[TableCell]) -> String {
    cells.iter().map(|cell| cell.text().to_string()).collect::<Vec<_>>().join(", ")
}

fn label_of(definition: Option<FootnoteDefinition>) -> String {
    definition.map_or("nothing".into(), |found| found.label().to_string())
}

/// A fragment's context element, by name, with the rest as defaults.
fn inside(name: &str) -> FragmentContext {
    FragmentContextBuilder { name: Arc::new(name.to_string()) }.build()
}

/// Each element, indented, and where it came from: its raw start tag, its
/// Markdown node, or neither.
fn origins(nodes: &[BuiltNode], depth: usize) {
    for node in nodes.iter() {
        if let Some(element) = cast::<Element>(node.clone()) {
            let source = if let Some(tag) = element.start_tag() {
                tag.as_written().to_string()
            } else if let Some(markdown) = markdown_node_of(node.clone()) {
                markdown.node().kind().name().to_string()
            } else {
                "implied".to_string()
            };
            println!("{}{} <- {source}", "  ".repeat(depth), element.name());
            origins(&element.children(), depth + 1);
        }
    }
}

fn main() {
    println!("# Kelpto tour");

    section("1. Parse and print, losslessly");

    let text = "# Release notes

Kelpto keeps *every*   byte.

| Library     | Status |
|:------------|-------:|
| kelpto-md   | ready  |
| kelpto-html | ready  |
| Hrefine     | early  |

- [x] CommonMark
- [x] HTML trees
- [ ] Hrefine links

Read [the docs][docs].

[docs]: https://example.com/old
";
    let doc = MarkdownParser::gfm().parse(text);
    println!("printed back exactly: {}", doc.as_written().as_str() == text);
    let heading = &doc.headings()[0];
    println!("heading {}: {}", heading.level(), heading.text());
    let table = &doc.tables()[0];
    println!("table: {} ({})", texts(&table.header().cells()), table.alignments().iter().map(|a| a.as_str()).collect::<Vec<_>>().join(", "));
    for row in table.rows().iter() {
        println!("row: {}", texts(&row.cells()));
    }
    for task in doc.task_list_items().iter() {
        println!("task: {} {}", task.marker(), if task.checked() { "checked" } else { "not checked" });
    }
    let definition = &doc.link_reference_definitions()[0];
    println!("definition: {} -> {}", definition.label(), definition.destination().url());

    // Odd input prints back as written too: tabs, line endings, and spacing.
    for odd in ["  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n"] {
        let same = parse_markdown(odd, None).as_written().as_str() == odd;
        println!("{} -> {}", shown(odd), if same { "exactly" } else { "changed" });
    }

    section("2. Edit one part");

    // Each edit gives a new document; the old one stays as it was. Edits
    // that can fail give a Result.
    let mut edited = doc.headings()[0].with_text("Release notes, 0.1");
    edited = edited.tables()[0].rows()[2].cells()[1].with_text("ready");
    edited = edited.task_list_items()[2].with_checked(true);
    edited = edited.link_reference_definitions()[0].with_destination(LinkTarget::new("https://example.com/new")).expect("one line");
    changes(text, &edited.as_written());
    let level2 = edited.headings()[0].with_level(2).expect("a level from 1 to 6");
    println!("at level 2: {}", shown(&level2.headings()[0].as_written()));
    match edited.headings()[0].with_level(7) {
        Ok(_) => println!("level 7: done"),
        Err(_) => println!("level 7: throws"),
    }

    section("3. Render, safe by default");

    let page = parse_markdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n", None);
    rendered("safe", &page.to_html());
    rendered("trusted", &MarkdownRenderer::new(None).with_raw_html_trusted().render(page.clone()));
    rendered(
        "trusted, GFM's filter",
        &MarkdownRenderer::new(None).with_raw_html_trusted().with_disallowed_raw_html_filtered().render(page.clone()),
    );

    section("4. GitHub Flavored Markdown");

    let gfm_text = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n";
    let gfm = MarkdownParser::gfm().parse(gfm_text);
    rendered("GFM", &gfm.to_html());
    let cell = &gfm.tables()[0].rows()[0].cells()[1];
    println!("cell {}: column {}, {}", cell.text(), cell.column(), cell.alignment());
    let plain = MarkdownParser::common_mark().parse(gfm_text);
    println!("as CommonMark: tables {}, task items {}", plain.tables().len(), plain.task_list_items().len());
    let tables_only = MarkdownParser::common_mark().with_tables(true).parse(gfm_text);
    println!("tables alone: tables {}, task items {}", tables_only.tables().len(), tables_only.task_list_items().len());
    let checked = gfm.task_list_items()[0].with_checked(true);
    println!("checked: {}", shown(&checked.task_list_items()[0].as_written()));

    section("5. Footnotes");

    let notes = MarkdownParser::gfm().parse("Lossless[^1], always.\n\n[^1]: Every byte.\n");
    let reference = &notes.footnote_references()[0];
    println!("reference {} -> definition {}", reference.label(), label_of(reference.definition()));
    rendered("html", &notes.to_html());
    let mut renamed = notes.footnote_definitions()[0].with_label("bytes").expect("a label");
    println!("definition renamed: reference finds {}", label_of(renamed.footnote_references()[0].definition()));
    renamed = renamed.footnote_references()[0].with_label("bytes").expect("a label");
    println!("reference renamed: reference finds {}", label_of(renamed.footnote_references()[0].definition()));
    println!("{}", shown(&renamed.as_written()));
    match notes.footnote_definitions()[0].with_label("two words") {
        Ok(_) => println!("label 'two words': done"),
        Err(_) => println!("label 'two words': throws"),
    }

    section("6. Walk and transform");

    let guide = "# Guide\n\nRead [this](start.md), [that][t], and [top](#top).\n\n## More\n\n[t]: api.md\n";
    let guide_doc = parse_markdown(guide, None);
    // Every view inside the document, in order, each knowing its depth.
    let views = guide_doc.descendants();
    for view in views.iter() {
        if let Some(heading) = cast::<Heading>(view.clone()) {
            println!("depth {}, heading {}: {}", heading.depth(), heading.level(), heading.text());
        } else if let Some(link) = cast::<Link>(view.clone()) {
            println!("depth {}, link {} -> {}", link.depth(), link.text(), link.destination().expect("defined").url());
        }
    }
    // Many edits, one new document: headings a level down, relative links absolute.
    let base = "https://example.com/docs/";
    let editor = guide_doc.editor();
    for view in views.iter() {
        if let Some(heading) = cast::<Heading>(view.clone()) {
            editor.set_level(heading.clone(), heading.level() + 1).expect("a level from 1 to 6");
        } else if let Some(link) = cast::<Link>(view.clone()) {
            let url = link.destination().expect("defined").url();
            if link.style().as_str() == "inline" && !url.starts_with('#') {
                editor.set_destination(view.clone(), LinkTarget::new(format!("{base}{url}"))).expect("one line");
            }
        } else if let Some(definition) = cast::<LinkReferenceDefinition>(view.clone()) {
            let url = definition.destination().url();
            editor.set_destination(view.clone(), LinkTarget::new(format!("{base}{url}"))).expect("one line");
        }
    }
    changes(guide, &editor.to_document().expect("no overlapping edits").as_written());

    section("7. Build from plain strings");

    // Text from anywhere, escaped so it reads back as written.
    let name = "<Ana> #1";
    let said = "*really*";
    let b = MarkdownBuilder::new();
    b.heading(2, Inlines::empty().text(format!("Report for {name}"))).expect("a level from 1 to 6");
    b.paragraph(
        Inlines::empty().text("Said: ").emphasis(Inlines::empty().text(said)).text(" see ").link(
            Inlines::empty().text("the [docs]"),
            LinkTarget::new("docs/read me.md"),
            None::<String>,
        ),
    );
    let first = MarkdownBuilder::new();
    first.paragraph(Inlines::empty().text("1. first, `x`"));
    let second = MarkdownBuilder::new();
    second.code_block("py", "print('```')\n");
    b.bullet_list(vec![first, second]);
    rendered("markdown", &b.to_markdown());
    let built = b.to_document();
    println!("heading: {}", built.headings()[0].text());
    let link = built.links()[0].clone();
    println!("link: {} -> {}", link.text(), link.destination().expect("inline").url());
    rendered("html", &built.to_html());

    section("8. Insert, replace, and remove blocks");

    let advice = "# Notes\n\n> Old advice.\n> # Tip\n\n- one\n- two\n\nDraft, remove me.\n\nThe end.\n";
    let advice_doc = parse_markdown(advice, None);
    let warning = MarkdownBuilder::new();
    warning.paragraph(Inlines::empty().strong(Inlines::empty().text("Careful:")).text(" it's *hot*."));
    let also = MarkdownBuilder::new();
    also.paragraph(Inlines::empty().text("Also: *this*."));
    // Blocks from a builder, where they go, with the prefixes of the block
    // quote or list item around them; the rest stays as written.
    let advice_editor = advice_doc.editor();
    for view in advice_doc.descendants().iter() {
        if let Some(paragraph) = cast::<Paragraph>(view.clone()) {
            match paragraph.text().as_str() {
                "Old advice." => advice_editor.replace(view.clone(), warning.clone()).expect("a block"),
                "two" => advice_editor.insert_after(view.clone(), also.clone()).expect("a block"),
                "Draft, remove me." => advice_editor.remove(view.clone()).expect("a block"),
                _ => {}
            }
        } else if let Some(heading) = cast::<Heading>(view.clone()) {
            if heading.text().as_str() == "Tip" {
                advice_editor.set_content(view.clone(), Inlines::empty().text("Tip ").code("#1")).expect("a heading");
            }
        }
    }
    let advised = advice_editor.to_document().expect("edits that fit");
    rendered("markdown", &advised.as_written());
    println!("heading: {}", advised.headings()[1].text());

    section("9. Parse HTML, as browsers do");

    // The HTML standard's tokenizer and tree construction, lossless too.
    let html_text = "<p id=a id=b>One<p>Two<table><td>x</table>";
    let html_doc = parse_html(html_text);
    println!("printed back exactly: {}", html_doc.as_written().as_str() == html_text);
    rendered("html", &html_doc.html());
    let paragraphs: Vec<Element> = html_doc.body().expect("a body").children().iter().filter_map(|node| cast::<Element>(node.clone())).collect();
    let names: Vec<String> = paragraphs.iter().map(|p| p.name().to_string()).collect();
    println!("body: {}, the first with id {}", names.join(", "), paragraphs[0].attribute("id").expect("an id"));
    for error in html_doc.errors().iter() {
        println!("error: {} at {}", error.code(), error.offset());
    }
    // A fragment, as innerHTML parses it: where it goes decides what it is.
    println!("in a tr: {}", parse_html_fragment("<td>1<td>2", inside("tr")).html());
    println!("in a div: {}", parse_html_fragment("<td>1<td>2", inside("div")).html());
    // Tokens edit like Markdown: one part changes, the rest stays as written.
    let anchor = tokenize_html("<a href='/old' class=x>Go</a>").start_tags()[0].clone();
    println!("edited: {}", anchor.attribute("href").expect("an href").with_value("/new").as_written());

    section("10. Markdown and raw HTML, one tree");

    // The tree a browser builds from the rendering, each element knowing
    // where it came from.
    let mixed = parse_markdown_with_html("a <b>bold\n\nstill bold</b>\n\n<table><td>x</table>\n");
    let tree = build_html(mixed, None, None);
    rendered("html", &tree.html());
    origins(&tree.children(), 0);

    section("11. Render Markdown from anyone");

    // That tree, sanitized: only what the policy allows, with every URL checked.
    let untrusted = parse_markdown_with_html("[a](javascript:alert(1)) <b onclick=x>b</b><script>alert(2)</script>\n");
    rendered("safe", &render_safe(untrusted, None, None).html());
    let text_only = render_safe(parse_markdown_with_html("# *a* [b](/c)\n"), Some(SanitizerPolicy::text_only()), None);
    rendered("text only", &text_only.html());
}
