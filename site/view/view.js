import { parseMarkdownWithHtml, renderSafe } from "kelpto";

// Parsed and sanitized once per text, not on every render.
const posts = new Map();
function postHtml(markdown) {
  let html = posts.get(markdown);
  if (html === undefined) {
    html = renderSafe(parseMarkdownWithHtml(markdown)).html;
    if (posts.size >= 500) posts.delete(posts.keys().next().value);
    posts.set(markdown, html);
  }
  return html;
}

// The page from state, as React-style views go: Kelpto renders the post,
// not the page. `raw` is your framework's mark for HTML that's already
// safe, such as lit-html's unsafeHTML or React's dangerouslySetInnerHTML.
const view = (state) => layout(nav(state.user), raw(postHtml(state.post.markdown)));
