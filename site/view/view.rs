use kelpto::{parse_markdown_with_html, render_safe};
use maud::{Markup, PreEscaped};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Parsed and sanitized once per text, not on every render.
fn post_html(markdown: &str) -> Arc<String> {
    static POSTS: Mutex<Option<HashMap<String, Arc<String>>>> = Mutex::new(None);
    let mut guard = POSTS.lock().unwrap();
    let posts = guard.get_or_insert_with(HashMap::new);
    if let Some(html) = posts.get(markdown) {
        return html.clone();
    }
    if posts.len() >= 500 {
        posts.clear();
    }
    let html = render_safe(parse_markdown_with_html(markdown), None, None).html();
    posts.insert(markdown.to_string(), html.clone());
    html
}

/// The page from state, as maud views go: Kelpto renders the post, not the page.
fn view(state: &State) -> Markup {
    layout(nav(&state.user), PreEscaped(post_html(&state.post.markdown).to_string()))
}
