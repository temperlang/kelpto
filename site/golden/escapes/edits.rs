use kelpto_md::{LinkTarget, MarkdownParser};

fn main() {
    let text = "
# Say \"hi\" \\\\o/ \"\"\" `x` ${y} ??= )\" ]] ]=] [h](/h)\t

> *see [here](/a \"t\")*  
> next\\\\
end \"q\"";
    let mut doc = MarkdownParser::common_mark().parse(text);
    doc = doc.links()[0].with_destination(LinkTarget::new("/h?a=\"b\"&c=\\d")).expect("one line");
    doc = doc.links()[1].with_destination(LinkTarget::new("/b`${c}`??=)\"]]")).expect("one line");
    doc = doc.headings()[0].with_text("Tab\there, \"quotes\" \\ ??= ]] )\"");
    println!("{}", doc.as_written());
}
