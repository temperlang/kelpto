#include <iostream>
#include <string>

#include "kelpto-md/init.hpp"

using kelpto_md::LinkTarget;
using kelpto_md::MarkdownParser;

int main() {
  std::string text = R"md(Release notes
=============

Kelpto keeps   *every* byte, ~~mostly~~ always.
Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, <span style="color: crimson" onmouseover="alert('hi')">often</span>.

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

Read [the docs][docs], or the [FAQ](https://example.com/faq "FAQ").
Footnotes work too.[^why]

[Back to top](javascript:scrollTo(0,0))

[docs]:   https://example.com/old
[^why]: GitHub has them.
)md";
  auto doc = MarkdownParser::gfm()->parse(text);
  doc = doc->get_headings()->at(0)->withText("Release notes, \342\200\2340.2\342\200\235 \"final\" \\ ok");
  doc = doc->get_tables()->at(0)->get_header()->get_cells()->at(1)->withText("State");
  doc = doc->get_tables()->at(0)->get_rows()->at(1)->get_cells()->at(2)->withText("0.2");
  doc = doc->get_taskListItems()->at(2)->withChecked(true);
  doc = doc->get_linkReferenceDefinitions()->at(0)->withDestination(LinkTarget::make("https://example.com/new?q=\303\251"));
  doc = doc->get_links()->at(1)->withDestination(LinkTarget::make("https://example.com/faq#\303\274n\303\257"));
  doc = doc->get_links()->at(2)->withDestination(LinkTarget::make("#top"));
  doc = doc->get_headings()->at(1)->withText("Links \360\237\224\227");
  std::cout << doc->get_asWritten() << "\n";
}
