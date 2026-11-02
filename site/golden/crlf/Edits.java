import kelpto_md.LinkTarget;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownParser;

public class Edits {
    public static void main(String[] args) {
        String text = "Title\r\n"
            + "=====\r\n"
            + "\r\n"
            + "Café — naïve 😀 ??( \001 ctrl\r\n"
            + "\r\n"
            + "| a | [l](/x) |\r\n"
            + "|---|---|\r\n"
            + "| 1 | 2 |\r\n"
            + "\r\n"
            + "- [ ] täsk\r\n";
        MarkdownDocument doc = MarkdownParser.gfm.parse(text);
        doc = doc.getLinks().get(0).withDestination(new LinkTarget("/ünï 😀"));
        doc = doc.getTables().get(0).getRows().get(0).getCells().get(0).withText("naïve ☕");
        doc = doc.getTaskListItems().get(0).withChecked(true);
        doc = doc.getHeadings().get(0).withText("Café — 😀");
        System.out.println(doc.getAsWritten());
    }
}
