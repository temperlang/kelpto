import static j2html.TagCreator.rawHtml;
import static kelpto.KelptoGlobal.parseMarkdownWithHtml;
import static kelpto.KelptoGlobal.renderSafe;

import j2html.tags.DomContent;
import java.util.LinkedHashMap;
import java.util.Map;

final class Views {
    /** Parsed and sanitized once per text, not on every render: the last 500 used. */
    private static final Map<String, String> POSTS = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
            return size() > 500;
        }
    };

    static synchronized String postHtml(String markdown) {
        return POSTS.computeIfAbsent(markdown, md -> renderSafe(parseMarkdownWithHtml(md)).getHtml());
    }

    /** The page from state, as j2html views go: Kelpto renders the post, not the page. */
    static DomContent view(State state) {
        return layout(nav(state.user()), rawHtml(postHtml(state.post().markdown())));
    }
}
