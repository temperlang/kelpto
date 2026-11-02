#include <iostream>
#include <string>

#include "kelpto-md/init.hpp"

using kelpto_md::LinkTarget;
using kelpto_md::MarkdownParser;

int main() {
  std::string text = R"md(
# Say "hi" \\o/ """ `x` ${y} ??= )" ]] ]=] [h](/h)	

> *see [here](/a "t")*  
> next\\
end "q")md";
  auto doc = MarkdownParser::commonMark()->parse(text);
  doc = doc->get_links()->at(0)->withDestination(LinkTarget::make("/h?a=\"b\"&c=\\d"));
  doc = doc->get_links()->at(1)->withDestination(LinkTarget::make("/b`${c}`?\?=)\"]]"));
  doc = doc->get_headings()->at(0)->withText("Tab\there, \"quotes\" \\ ?\?= ]] )\"");
  std::cout << doc->get_asWritten() << "\n";
}
