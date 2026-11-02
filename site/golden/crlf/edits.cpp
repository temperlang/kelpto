#include <iostream>
#include <string>

#include "kelpto-md/init.hpp"

using kelpto_md::LinkTarget;
using kelpto_md::MarkdownParser;

int main() {
  std::string text = "Title\r\n"
      "=====\r\n"
      "\r\n"
      "Caf\303\251 \342\200\224 na\303\257ve \360\237\230\200 ?\?( \001 ctrl\r\n"
      "\r\n"
      "| a | [l](/x) |\r\n"
      "|---|---|\r\n"
      "| 1 | 2 |\r\n"
      "\r\n"
      "- [ ] t\303\244sk\r\n";
  auto doc = MarkdownParser::gfm()->parse(text);
  doc = doc->get_links()->at(0)->withDestination(LinkTarget::make("/\303\274n\303\257 \360\237\230\200"));
  doc = doc->get_tables()->at(0)->get_rows()->at(0)->get_cells()->at(0)->withText("na\303\257ve \342\230\225");
  doc = doc->get_taskListItems()->at(0)->withChecked(true);
  doc = doc->get_headings()->at(0)->withText("Caf\303\251 \342\200\224 \360\237\230\200");
  std::cout << doc->get_asWritten() << "\n";
}
