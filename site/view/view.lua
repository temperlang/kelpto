local kelpto = require("kelpto")

-- Parsed and sanitized once per text, not on every render.
local posts, count = {}, 0
local function postHtml(markdown)
  local html = posts[markdown]
  if not html then
    if count >= 500 then posts, count = {}, 0 end
    html = kelpto.renderSafe(kelpto.parseMarkdownWithHtml(markdown)).html
    posts[markdown], count = html, count + 1
  end
  return html
end

-- The page from state, as views that build strings go: Kelpto renders the
-- post, not the page.
local function view(state)
  return layout(nav(state.user), postHtml(state.post.markdown))
end
