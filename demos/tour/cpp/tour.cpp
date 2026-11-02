// A tour of Kelpto's Markdown library, from C++.
//
// The same tour exists for each language Kelpto supports, and they all print
// the same text. See demos/README.md for how to run them.

#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "kelpto-md/init.hpp"

using kelpto_md::FootnoteDefinition;
using kelpto_md::LinkTarget;
using kelpto_md::MarkdownParser;
using kelpto_md::MarkdownRenderer;
using kelpto_md::TableCell;
using kelpto_md::parseMarkdown;
using temper::core::TemperBubble;

void section(std::string const &title) { std::cout << "\n## " << title << "\n"; }

// Tabs and line endings made visible.
std::string shown(std::string const &text) {
  std::string out;
  for (char c : text) {
    out += c == '\t' ? "\\t" : c == '\r' ? "\\r" : c == '\n' ? "\\n" : std::string(1, c);
  }
  return out;
}

// Rendered HTML under a label, without its last newline.
void rendered(std::string const &label, std::string const &html) {
  std::cout << label << ":\n" << html;
  if (html.empty() || html.back() != '\n') std::cout << "\n";
}

std::vector<std::string> lines(std::string const &text) {
  std::vector<std::string> out;
  std::stringstream stream(text);
  for (std::string line; std::getline(stream, line);) out.push_back(line);
  return out;
}

// The lines an edit changed, and how many it left alone.
void changes(std::string const &before, std::string const &after) {
  auto old = lines(before);
  auto now = lines(after);
  int changed = 0;
  for (size_t i = 0; i < old.size(); i++) {
    if (old[i] != now[i]) {
      std::cout << "- " << old[i] << "\n+ " << now[i] << "\n";
      changed += 1;
    }
  }
  std::cout << changed << " of " << old.size() << " lines changed, the rest byte for byte\n";
}

std::string joined(std::vector<std::string> const &parts) {
  std::string out;
  for (auto const &part : parts) out += (out.empty() ? "" : ", ") + part;
  return out;
}

std::string texts(std::vector<std::shared_ptr<TableCell>> const &cells) {
  std::vector<std::string> out;
  for (auto const &cell : cells) out.push_back(cell->get_text());
  return joined(out);
}

std::string labelOf(std::shared_ptr<FootnoteDefinition> const &definition) {
  return definition ? definition->get_label() : "nothing";
}

int main() {
  std::cout << "# Kelpto tour\n";

  section("1. Parse and print, losslessly");

  std::string text = R"(# Release notes

Kelpto keeps *every*   byte.

| Library     | Status |
|:------------|-------:|
| kelpto-md   | ready  |
| kelpto-html | early  |

- [x] CommonMark
- [ ] HTML trees

Read [the docs][docs].

[docs]: https://example.com/old
)";
  auto doc = MarkdownParser::gfm()->parse(text);
  std::cout << "printed back exactly: " << (doc->get_asWritten() == text ? "true" : "false") << "\n";
  auto heading = doc->get_headings()->at(0);
  std::cout << "heading " << heading->get_level() << ": " << heading->get_text() << "\n";
  auto table = doc->get_tables()->at(0);
  std::cout << "table: " << texts(*table->get_header()->get_cells()) << " (" << joined(*table->get_alignments()) << ")\n";
  // Keep each list in a variable to loop over it: a range-for over
  // *f() would outlive the shared_ptr that f() returns.
  auto rows = table->get_rows();
  for (auto const &row : *rows) {
    std::cout << "row: " << texts(*row->get_cells()) << "\n";
  }
  auto tasks = doc->get_taskListItems();
  for (auto const &task : *tasks) {
    std::cout << "task: " << task->get_marker() << " " << (task->get_checked() ? "checked" : "not checked") << "\n";
  }
  auto definition = doc->get_linkReferenceDefinitions()->at(0);
  std::cout << "definition: " << definition->get_label() << " -> " << definition->get_destination()->get_url() << "\n";

  // Odd input prints back as written too: tabs, line endings, and spacing.
  for (std::string odd : {"  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n"}) {
    std::cout << shown(odd) << " -> " << (parseMarkdown(odd)->get_asWritten() == odd ? "exactly" : "changed") << "\n";
  }

  section("2. Edit one part");

  // Each edit gives a new document; the old one stays as it was.
  auto edited = doc->get_headings()->at(0)->withText("Release notes, 0.1");
  edited = edited->get_tables()->at(0)->get_rows()->at(1)->get_cells()->at(1)->withText("ready");
  edited = edited->get_taskListItems()->at(1)->withChecked(true);
  edited = edited->get_linkReferenceDefinitions()->at(0)->withDestination(LinkTarget::make("https://example.com/new"));
  changes(text, edited->get_asWritten());
  std::cout << "at level 2: " << shown(edited->get_headings()->at(0)->withLevel(2)->get_headings()->at(0)->get_asWritten()) << "\n";
  try {
    edited->get_headings()->at(0)->withLevel(7);
    std::cout << "level 7: done\n";
  } catch (TemperBubble const &) {
    std::cout << "level 7: throws\n";
  }

  section("3. Render, safe by default");

  auto page = parseMarkdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n");
  rendered("safe", page->toHtml());
  rendered("trusted", MarkdownRenderer::make()->withRawHtmlTrusted()->render(page));
  rendered("trusted, GFM's filter", MarkdownRenderer::make()->withRawHtmlTrusted()->withDisallowedRawHtmlFiltered()->render(page));

  section("4. GitHub Flavored Markdown");

  std::string gfmText = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n";
  auto gfm = MarkdownParser::gfm()->parse(gfmText);
  rendered("GFM", gfm->toHtml());
  auto cell = gfm->get_tables()->at(0)->get_rows()->at(0)->get_cells()->at(1);
  std::cout << "cell " << cell->get_text() << ": column " << cell->get_column() << ", " << cell->get_alignment() << "\n";
  auto plain = MarkdownParser::commonMark()->parse(gfmText);
  std::cout << "as CommonMark: tables " << plain->get_tables()->size() << ", task items " << plain->get_taskListItems()->size() << "\n";
  auto tablesOnly = MarkdownParser::commonMark()->withTables(true)->parse(gfmText);
  std::cout << "tables alone: tables " << tablesOnly->get_tables()->size() << ", task items " << tablesOnly->get_taskListItems()->size() << "\n";
  auto checked = gfm->get_taskListItems()->at(0)->withChecked(true);
  std::cout << "checked: " << shown(checked->get_taskListItems()->at(0)->get_asWritten()) << "\n";

  section("5. Footnotes");

  auto notes = MarkdownParser::gfm()->parse("Lossless[^1], always.\n\n[^1]: Every byte.\n");
  auto reference = notes->get_footnoteReferences()->at(0);
  std::cout << "reference " << reference->get_label() << " -> definition " << labelOf(reference->get_definition()) << "\n";
  rendered("html", notes->toHtml());
  auto renamed = notes->get_footnoteDefinitions()->at(0)->withLabel("bytes");
  std::cout << "definition renamed: reference finds " << labelOf(renamed->get_footnoteReferences()->at(0)->get_definition()) << "\n";
  renamed = renamed->get_footnoteReferences()->at(0)->withLabel("bytes");
  std::cout << "reference renamed: reference finds " << labelOf(renamed->get_footnoteReferences()->at(0)->get_definition()) << "\n";
  std::cout << shown(renamed->get_asWritten()) << "\n";
  try {
    notes->get_footnoteDefinitions()->at(0)->withLabel("two words");
    std::cout << "label 'two words': done\n";
  } catch (TemperBubble const &) {
    std::cout << "label 'two words': throws\n";
  }
}
