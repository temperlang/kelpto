import kelpto_md.LinkTarget;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownParser;

public class Edits {
    public static void main(String[] args) {
        String text = """
        Release notes
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
        """;
        MarkdownDocument doc = MarkdownParser.gfm.parse(text);
        doc = doc.getHeadings().get(0).withText("Release notes, “0.2” \"final\" \\ ok");
        doc = doc.getTables().get(0).getHeader().getCells().get(1).withText("State");
        doc = doc.getTables().get(0).getRows().get(1).getCells().get(2).withText("0.2");
        doc = doc.getTaskListItems().get(2).withChecked(true);
        doc = doc.getLinkReferenceDefinitions().get(0).withDestination(new LinkTarget("https://example.com/new?q=é"));
        doc = doc.getLinks().get(1).withDestination(new LinkTarget("https://example.com/faq#ünï"));
        doc = doc.getLinks().get(2).withDestination(new LinkTarget("#top"));
        doc = doc.getHeadings().get(1).withText("Links 🔗");
        System.out.println(doc.getAsWritten());
    }
}
