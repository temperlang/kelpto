#include <iostream>
#include <memory>
#include <string>

#include "kelpto-md/init.hpp"

using kelpto_md::Link;
using kelpto_md::LinkTarget;
using kelpto_md::MarkdownParser;
using kelpto_md::Paragraph;

int main() {
  std::string text = R"(Release notes
=============

Kelpto keeps   *every* byte, ~~mostly~~ always.
Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.

| Library     | Status |   Since |
|:------------|:------:|--------:|
| kelpto-md   | ready  |     0.1 |
| kelpto-html | early  |         |

* [x] CommonMark
* [ ] HTML trees
    * [ ] html5lib's tests

## Links

Read [the docs][docs], or the [FAQ](https://example.com/faq "FAQ").
Footnotes work too.[^why]

[docs]:   https://example.com/old
[^why]: GitHub has them.
)";
  auto doc = MarkdownParser::gfm()->parse(text);
  doc = doc->get_headings()->at(0)->withText("Release notes, \342\200\2340.2\342\200\235 \"final\" \\ ok");
  doc = doc->get_tables()->at(0)->get_header()->get_cells()->at(1)->withText("State");
  doc = doc->get_tables()->at(0)->get_rows()->at(1)->get_cells()->at(2)->withText("0.2");
  doc = doc->get_taskListItems()->at(2)->withChecked(true);
  doc = doc->get_linkReferenceDefinitions()->at(0)->withDestination(LinkTarget::make("https://example.com/new?q=\303\251"));
  doc = std::dynamic_pointer_cast<Link>(std::dynamic_pointer_cast<Paragraph>(doc->get_blocks()->at(14))->get_children()->at(3))->withDestination(LinkTarget::make("https://example.com/faq#\303\274n\303\257"));
  doc = doc->get_headings()->at(1)->withText("Links \360\237\224\227");
  std::cout << doc->get_asWritten() << "\n";
}
