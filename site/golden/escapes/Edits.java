import kelpto_md.LinkTarget;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownParser;

public class Edits {
    public static void main(String[] args) {
        String text = """
        
        # Say "hi" \\\\o/ \"\"" `x` ${y} ??= )" ]] ]=] [h](/h)\t
        
        > *see [here](/a "t")* \s
        > next\\\\
        end "q"\
        """;
        MarkdownDocument doc = MarkdownParser.commonMark.parse(text);
        doc = doc.getLinks().get(0).withDestination(new LinkTarget("/h?a=\"b\"&c=\\d"));
        doc = doc.getLinks().get(1).withDestination(new LinkTarget("/b`${c}`??=)\"]]"));
        doc = doc.getHeadings().get(0).withText("Tab\there, \"quotes\" \\ ??= ]] )\"");
        System.out.println(doc.getAsWritten());
    }
}
