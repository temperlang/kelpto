use kelpto_md::{LinkTarget, MarkdownParser};

fn main() {
    let text = "Title\r
=====\r
\r
Café — naïve 😀 ??( \u{01} ctrl\r
\r
| a | [l](/x) |\r
|---|---|\r
| 1 | 2 |\r
\r
- [ ] täsk\r
";
    let mut doc = MarkdownParser::gfm().parse(text);
    doc = doc.links()[0].with_destination(LinkTarget::new("/ünï 😀")).expect("one line");
    doc = doc.tables()[0].rows()[0].cells()[0].with_text("naïve ☕");
    doc = doc.task_list_items()[0].with_checked(true);
    doc = doc.headings()[0].with_text("Café — 😀");
    println!("{}", doc.as_written());
}
