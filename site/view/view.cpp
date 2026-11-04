#include <map>
#include <string>

#include "kelpto/init.hpp"

// Parsed and sanitized once per text, not on every render.
std::string postHtml(std::string const &markdown) {
  static std::map<std::string, std::string> posts;
  auto found = posts.find(markdown);
  if (found == posts.end()) {
    if (posts.size() >= 500) posts.clear();
    auto html = kelpto::renderSafe(kelpto::parseMarkdownWithHtml(markdown))->get_html();
    found = posts.emplace(markdown, html).first;
  }
  return found->second;
}

// The page from state, as views that build strings go: Kelpto renders the
// post, not the page.
std::string view(State const &state) { return layout(nav(state.user), postHtml(state.post.markdown)); }
