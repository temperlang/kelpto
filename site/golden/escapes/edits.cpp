#include <iostream>
#include <memory>
#include <string>

#include "kelpto-md/init.hpp"

using kelpto_md::Emphasis;
using kelpto_md::Link;
using kelpto_md::LinkTarget;
using kelpto_md::MarkdownParser;
using kelpto_md::Paragraph;

int main() {
  std::string text = R"md(
# Say "hi" \\o/ """ `x` ${y} ??= )" ]] ]=] [h](/h)	

> *see [here](/a "t")*  
> next\\
end "q")md";
  auto doc = MarkdownParser::commonMark()->parse(text);
  doc = std::dynamic_pointer_cast<Link>(doc->get_headings()->at(0)->get_children()->at(3))->withDestination(LinkTarget::make("/h?a=\"b\"&c=\\d"));
  doc = std::dynamic_pointer_cast<Link>(std::dynamic_pointer_cast<Emphasis>(std::dynamic_pointer_cast<Paragraph>(doc->get_blocks()->at(4))->get_children()->at(0))->get_children()->at(1))->withDestination(LinkTarget::make("/b`${c}`?\?=)\"]]"));
  doc = doc->get_headings()->at(0)->withText("Tab\there, \"quotes\" \\ ?\?= ]] )\"");
  std::cout << doc->get_asWritten() << "\n";
}
