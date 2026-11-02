// Times Markdown parsers in C++, for scripts/bench.py.
//
//     ./build/bench time PLAN
//     ./build/bench mem LIBRARY TASK FILE
//
// See ../README.md for the plan format and what each task does.

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "cmark.h"
#include "kelpto-md/init.hpp"

using kelpto_md::Heading;
using kelpto_md::MarkdownParser;
using kelpto_md::MarkdownRenderer;

using Op = std::function<long(std::string const &)>;
using Tasks = std::map<std::string, Op>;

static Tasks kelpto() {
  auto renderer = MarkdownRenderer::make()->withRawHtmlTrusted();
  return {
      {"parse", [](std::string const &text) { return long(MarkdownParser::commonMark()->parse(text)->get_span()->get_end()); }},
      {"render", [renderer](std::string const &text) { return long(renderer->render(MarkdownParser::commonMark()->parse(text)).size()); }},
      {"walk",
       [](std::string const &text) {
         auto doc = MarkdownParser::commonMark()->parse(text);
         auto views = doc->get_descendants();
         long headings = 0;
         for (auto const &view : *views) {
           if (std::dynamic_pointer_cast<Heading>(view)) headings += 1;
         }
         return long(views->size()) + headings + long(doc->get_asWritten().size());
       }},
      {"transform",
       [](std::string const &text) {
         auto doc = MarkdownParser::commonMark()->parse(text);
         auto editor = doc->editor();
         auto headings = doc->get_headings();  // Kept alive: the loop would outlive a temporary.
         for (auto const &heading : *headings) {
           auto level = heading->get_level();
           if (level < 6 && !(level == 2 && heading->get_style() == "setext")) editor->setLevel(heading, level + 1);
         }
         return long(editor->toDocument()->get_asWritten().size());
       }},
  };
}

static Tasks cmark() {
  return {
      {"parse",
       [](std::string const &text) {
         cmark_node *root = cmark_parse_document(text.data(), text.size(), CMARK_OPT_DEFAULT);
         long check = cmark_node_first_child(root) != nullptr;
         cmark_node_free(root);
         return check;
       }},
      {"render",
       [](std::string const &text) {
         cmark_node *root = cmark_parse_document(text.data(), text.size(), CMARK_OPT_DEFAULT);
         // Raw HTML passes through, as in the others here.
         char *html = cmark_render_html(root, CMARK_OPT_UNSAFE);
         long check = long(std::string(html).size());
         free(html);
         cmark_node_free(root);
         return check;
       }},
  };
}

static Tasks library(std::string const &name) {
  if (name == "kelpto") return kelpto();
  if (name == "cmark") return cmark();
  if (name == "none") return {{"read", [](std::string const &text) { return long(text.size()); }}};
  std::cerr << "unknown library " << name << "\n";
  std::exit(2);
}

static std::string read(std::string const &path) {
  std::ifstream in(path, std::ios::binary);
  std::stringstream out;
  out << in.rdbuf();
  return out.str();
}

static volatile long sink;

int main(int argc, char **argv) {
  std::string mode = argv[1];
  if (mode == "mem") {
    std::cout << library(argv[2])[argv[3]](read(argv[4])) << "\n";
    return 0;
  }
  std::ifstream plan(argv[2]);
  double warmupMs, sampleMs, budgetMs;
  int maxSamples;
  plan >> warmupMs >> sampleMs >> maxSamples >> budgetMs;
  std::string line;
  std::getline(plan, line);
  std::map<std::string, Tasks> made;
  using Clock = std::chrono::steady_clock;
  while (std::getline(plan, line)) {
    if (line.empty()) continue;
    std::vector<std::string> job;
    std::stringstream fields(line);
    std::string field;
    while (std::getline(fields, field, '\t')) job.push_back(field);
    if (!made.count(job[0])) made[job[0]] = library(job[0]);
    Op &op = made[job[0]][job[1]];
    std::string text = read(job[2]);
    long check = 0;
    int count = 0;
    double elapsed;
    auto start = Clock::now();
    for (;;) {
      check = op(text);
      count += 1;
      elapsed = std::chrono::duration<double>(Clock::now() - start).count();
      if (elapsed * 1000 >= warmupMs && count >= 2) break;
    }
    double perOp = elapsed / count;
    long inner = std::max(1L, std::lround(sampleMs / 1000 / perOp));
    int samples = std::max(3, std::min(maxSamples, int(budgetMs / 1000 / (perOp * inner))));
    std::cout << job[0] << "\t" << job[1] << "\t" << job[2] << "\t" << inner << "\t" << check << "\t";
    for (int i = 0; i < samples; i += 1) {
      auto begin = Clock::now();
      for (long j = 0; j < inner; j += 1) sink = op(text);
      double t = std::chrono::duration<double>(Clock::now() - begin).count() / inner;
      char shown[32];
      std::snprintf(shown, sizeof shown, "%s%.9e", i ? " " : "", t);
      std::cout << shown;
    }
    std::cout << "\n" << std::flush;
  }
}
