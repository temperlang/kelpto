use kelpto_md::{Emphasis, Link, LinkTarget, MarkdownParser, Paragraph};
use temper_core::cast;

fn main() {
    let text = "
# Say \"hi\" \\\\o/ \"\"\" `x` ${y} ??= )\" ]] ]=] [h](/h)\t

> *see [here](/a \"t\")*  
> next\\\\
end \"q\"";
    let mut doc = MarkdownParser::common_mark().parse(text);
    doc = cast::<Link>(doc.headings()[0].children()[3].clone()).unwrap().with_destination(LinkTarget::new("/h?a=\"b\"&c=\\d")).expect("one line");
    doc = cast::<Link>(cast::<Emphasis>(cast::<Paragraph>(doc.blocks()[4].clone()).unwrap().children()[0].clone()).unwrap().children()[1].clone()).unwrap().with_destination(LinkTarget::new("/b`${c}`??=)\"]]")).expect("one line");
    doc = doc.headings()[0].with_text("Tab\there, \"quotes\" \\ ??= ]] )\"");
    println!("{}", doc.as_written());
}
