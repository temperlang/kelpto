use kelpto_md::{LinkTarget, MarkdownParser};

fn main() {
    let text = "Release notes
=============

Kelpto keeps   *every* byte, ~~mostly~~ always.
Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, <span style=\"color: crimson\" onmouseover=\"alert('hi')\">often</span>.

| Library     | Status |   Since |
|:------------|:------:|--------:|
| kelpto-md   | ready  |     0.1 |
| kelpto-html | ready  |     0.1 |
| Hrefine     | early  |         |

* [x] CommonMark
* [x] HTML trees
    * [x] html5lib's and WPT's tests
* [ ] Hrefine links

## Links

Read [the docs][docs], or the [FAQ](https://example.com/faq \"FAQ\").
Footnotes work too.[^why]

[Back to top](javascript:scrollTo(0,0))

[docs]:   https://example.com/old
[^why]: GitHub has them.
";
    let mut doc = MarkdownParser::gfm().parse(text);
    doc = doc.headings()[0].with_text("Release notes, “0.2” \"final\" \\ ok");
    doc = doc.tables()[0].header().cells()[1].with_text("State");
    doc = doc.tables()[0].rows()[1].cells()[2].with_text("0.2");
    doc = doc.task_list_items()[2].with_checked(true);
    doc = doc.link_reference_definitions()[0].with_destination(LinkTarget::new("https://example.com/new?q=é")).expect("one line");
    doc = doc.links()[1].with_destination(LinkTarget::new("https://example.com/faq#ünï")).expect("one line");
    doc = doc.links()[2].with_destination(LinkTarget::new("#top")).expect("one line");
    doc = doc.headings()[1].with_text("Links 🔗");
    println!("{}", doc.as_written());
}
