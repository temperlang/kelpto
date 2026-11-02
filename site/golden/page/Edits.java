import kelpto_md.LinkTarget;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownParser;

public class Edits {
    public static void main(String[] args) {
        String text = """
        Release notes
        =============
        
        Kelpto keeps   *every* byte, ~~mostly~~ always.
        Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.
        
        | Library     | Status |   Since |
        |:------------|:------:|--------:|
        | kelpto-md   | ready  |     0.1 |
        | kelpto-html | early  |         |
        
        * [x] CommonMark
        * [ ] HTML trees
            * [ ] html5lib's tests
        
        ## Links
        
        Read [the docs][docs], or the [FAQ](https://example.com/faq "FAQ").
        Footnotes work too.[^why]
        
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
        doc = doc.getHeadings().get(1).withText("Links 🔗");
        System.out.println(doc.getAsWritten());
    }
}
