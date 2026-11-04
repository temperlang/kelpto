from functools import lru_cache

from kelpto import parse_markdown_with_html, render_safe
from markupsafe import Markup  # HTML that's already safe, as htpy and Jinja take it


@lru_cache(maxsize=500)
def post_html(markdown: str) -> Markup:
    """Parsed and sanitized once per text, not on every render."""
    return Markup(render_safe(parse_markdown_with_html(markdown)).html)


def view(state):
    """The page from state, as htpy views go: Kelpto renders the post, not the page."""
    return layout(nav(state.user), post_html(state.post.markdown))
