// A tour of Kelpto's Markdown and HTML libraries, from Java.
//
// The same tour exists for each language Kelpto supports, and they all print
// the same text. See demos/README.md for how to run them.

import static kelpto.KelptoGlobal.buildHtml;
import static kelpto.KelptoGlobal.markdownNodeOf;
import static kelpto.KelptoGlobal.parseMarkdownWithHtml;
import static kelpto.KelptoGlobal.renderSafe;
import static kelpto_html.KelptoHtmlGlobal.parseHtml;
import static kelpto_html.KelptoHtmlGlobal.parseHtmlFragment;
import static kelpto_html.KelptoHtmlGlobal.tokenizeHtml;
import static kelpto_md.KelptoMdGlobal.parseMarkdown;

import java.util.List;
import java.util.stream.Collectors;
import kelpto.BuiltHtml;
import kelpto_html.BuiltNode;
import kelpto_html.Element;
import kelpto_html.FragmentContext;
import kelpto_html.HtmlDocument;
import kelpto_html.HtmlParseError;
import kelpto_html.SanitizerPolicy;
import kelpto_html.StartTag;
import kelpto_md.FootnoteDefinition;
import kelpto_md.FootnoteReference;
import kelpto_md.Heading;
import kelpto_md.Inlines;
import kelpto_md.Link;
import kelpto_md.LinkReferenceDefinition;
import kelpto_md.LinkTarget;
import kelpto_md.MarkdownBuilder;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownEditor;
import kelpto_md.MarkdownNode;
import kelpto_md.Paragraph;
import kelpto_md.MarkdownParser;
import kelpto_md.MarkdownRenderer;
import kelpto_md.Table;
import kelpto_md.TableCell;
import kelpto_md.TableRow;
import kelpto_md.TaskListItem;

public final class Tour {
    private Tour() {}

    static void section(String title) {
        System.out.println();
        System.out.println("## " + title);
    }

    /** Tabs and line endings made visible. */
    static String shown(String text) {
        return text.replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n");
    }

    /** Rendered HTML under a label, without its last newline. */
    static void rendered(String label, String html) {
        System.out.println(label + ":");
        System.out.println(html.endsWith("\n") ? html.substring(0, html.length() - 1) : html);
    }

    /** The lines an edit changed, and how many it left alone. */
    static void changes(String before, String after) {
        String[] oldLines = before.split("\n", -1);
        String[] newLines = after.split("\n", -1);
        int changed = 0;
        for (int i = 0; i < oldLines.length; i++) {
            if (!oldLines[i].equals(newLines[i])) {
                System.out.println("- " + oldLines[i]);
                System.out.println("+ " + newLines[i]);
                changed += 1;
            }
        }
        System.out.println(changed + " of " + (oldLines.length - 1) + " lines changed, the rest byte for byte");
    }

    static String texts(List<TableCell> cells) {
        return cells.stream().map(TableCell::getText).collect(Collectors.joining(", "));
    }

    static String labelOf(FootnoteDefinition definition) {
        return definition == null ? "nothing" : definition.getLabel();
    }

    /**
     * Each element, indented, and where it came from: its raw start tag, its
     * Markdown node, or neither.
     */
    static void origins(List<BuiltNode> nodes, int depth) {
        for (BuiltNode node : nodes) {
            if (node instanceof Element element) {
                StartTag tag = element.getStartTag();
                MarkdownNode markdown = markdownNodeOf(element);
                String source = tag != null ? tag.getAsWritten() : markdown != null ? markdown.getNode().getKind().getName() : "implied";
                System.out.println("  ".repeat(depth) + element.getName() + " <- " + source);
                origins(element.getChildren(), depth + 1);
            }
        }
    }

    public static void main(String[] args) {
        System.out.println("# Kelpto tour");

        section("1. Parse and print, losslessly");

        String text = """
            # Release notes

            Kelpto keeps *every*   byte.

            | Library     | Status |
            |:------------|-------:|
            | kelpto-md   | ready  |
            | kelpto-html | ready  |
            | Hrefine     | early  |

            - [x] CommonMark
            - [x] HTML trees
            - [ ] Hrefine links

            Read [the docs][docs].

            [docs]: https://example.com/old
            """;
        MarkdownDocument doc = MarkdownParser.gfm.parse(text);
        System.out.println("printed back exactly: " + doc.getAsWritten().equals(text));
        Heading heading = doc.getHeadings().get(0);
        System.out.println("heading " + heading.getLevel() + ": " + heading.getText());
        Table table = doc.getTables().get(0);
        System.out.println("table: " + texts(table.getHeader().getCells()) + " (" + String.join(", ", table.getAlignments()) + ")");
        for (TableRow row : table.getRows()) {
            System.out.println("row: " + texts(row.getCells()));
        }
        for (TaskListItem task : doc.getTaskListItems()) {
            System.out.println("task: " + task.getMarker() + " " + (task.isChecked() ? "checked" : "not checked"));
        }
        LinkReferenceDefinition definition = doc.getLinkReferenceDefinitions().get(0);
        System.out.println("definition: " + definition.getLabel() + " -> " + definition.getDestination().getUrl());

        // Odd input prints back as written too: tabs, line endings, and spacing.
        for (String odd : List.of("  #  Odd   heading  #\r\n", "*\ta\r\n\t- b\r\n", "> quote\nlazy\n***", "[x]: <a b> 'title'\n\n[x]\n")) {
            System.out.println(shown(odd) + " -> " + (parseMarkdown(odd).getAsWritten().equals(odd) ? "exactly" : "changed"));
        }

        section("2. Edit one part");

        // Each edit gives a new document; the old one stays as it was.
        MarkdownDocument edited = doc.getHeadings().get(0).withText("Release notes, 0.1");
        edited = edited.getTables().get(0).getRows().get(2).getCells().get(1).withText("ready");
        edited = edited.getTaskListItems().get(2).withChecked(true);
        edited = edited.getLinkReferenceDefinitions().get(0).withDestination(new LinkTarget("https://example.com/new"));
        changes(text, edited.getAsWritten());
        System.out.println("at level 2: " + shown(edited.getHeadings().get(0).withLevel(2).getHeadings().get(0).getAsWritten()));
        try {
            edited.getHeadings().get(0).withLevel(7);
            System.out.println("level 7: done");
        } catch (RuntimeException e) {
            System.out.println("level 7: throws");
        }

        section("3. Render, safe by default");

        MarkdownDocument page = parseMarkdown("Hi <b>there</b>!\n\n<script>alert(1)</script>\n");
        rendered("safe", page.toHtml());
        rendered("trusted", new MarkdownRenderer().withRawHtmlTrusted().render(page));
        rendered("trusted, GFM's filter", new MarkdownRenderer().withRawHtmlTrusted().withDisallowedRawHtmlFiltered().render(page));

        section("4. GitHub Flavored Markdown");

        String gfmText = "~~Old~~ New: www.example.com\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] ship it\n";
        MarkdownDocument gfm = MarkdownParser.gfm.parse(gfmText);
        rendered("GFM", gfm.toHtml());
        TableCell cell = gfm.getTables().get(0).getRows().get(0).getCells().get(1);
        System.out.println("cell " + cell.getText() + ": column " + cell.getColumn() + ", " + cell.getAlignment());
        MarkdownDocument plain = MarkdownParser.commonMark.parse(gfmText);
        System.out.println("as CommonMark: tables " + plain.getTables().size() + ", task items " + plain.getTaskListItems().size());
        MarkdownDocument tablesOnly = MarkdownParser.commonMark.withTables(true).parse(gfmText);
        System.out.println("tables alone: tables " + tablesOnly.getTables().size() + ", task items " + tablesOnly.getTaskListItems().size());
        MarkdownDocument checked = gfm.getTaskListItems().get(0).withChecked(true);
        System.out.println("checked: " + shown(checked.getTaskListItems().get(0).getAsWritten()));

        section("5. Footnotes");

        MarkdownDocument notes = MarkdownParser.gfm.parse("Lossless[^1], always.\n\n[^1]: Every byte.\n");
        FootnoteReference reference = notes.getFootnoteReferences().get(0);
        System.out.println("reference " + reference.getLabel() + " -> definition " + labelOf(reference.getDefinition()));
        rendered("html", notes.toHtml());
        MarkdownDocument renamed = notes.getFootnoteDefinitions().get(0).withLabel("bytes");
        System.out.println("definition renamed: reference finds " + labelOf(renamed.getFootnoteReferences().get(0).getDefinition()));
        renamed = renamed.getFootnoteReferences().get(0).withLabel("bytes");
        System.out.println("reference renamed: reference finds " + labelOf(renamed.getFootnoteReferences().get(0).getDefinition()));
        System.out.println(shown(renamed.getAsWritten()));
        try {
            notes.getFootnoteDefinitions().get(0).withLabel("two words");
            System.out.println("label 'two words': done");
        } catch (RuntimeException e) {
            System.out.println("label 'two words': throws");
        }
    
        section("6. Walk and transform");

        String guide = "# Guide\n\nRead [this](start.md), [that][t], and [top](#top).\n\n## More\n\n[t]: api.md\n";
        MarkdownDocument guideDoc = parseMarkdown(guide);
        // Every view inside the document, in order, each knowing its depth.
        for (MarkdownNode view : guideDoc.getDescendants()) {
            if (view instanceof Heading h) {
                System.out.println("depth " + h.getDepth() + ", heading " + h.getLevel() + ": " + h.getText());
            } else if (view instanceof Link link) {
                System.out.println("depth " + link.getDepth() + ", link " + link.getText() + " -> " + link.getDestination().getUrl());
            }
        }
        // Many edits, one new document: headings a level down, relative links absolute.
        String base = "https://example.com/docs/";
        MarkdownEditor editor = guideDoc.editor();
        for (MarkdownNode view : guideDoc.getDescendants()) {
            if (view instanceof Heading h) {
                editor.setLevel(h, h.getLevel() + 1);
            } else if (view instanceof Link link && link.getStyle().equals("inline") && !link.getDestination().getUrl().startsWith("#")) {
                editor.setDestination(link, new LinkTarget(base + link.getDestination().getUrl()));
            } else if (view instanceof LinkReferenceDefinition d) {
                editor.setDestination(d, new LinkTarget(base + d.getDestination().getUrl()));
            }
        }
        changes(guide, editor.toDocument().getAsWritten());
    
        section("7. Build from plain strings");

        // Text from anywhere, escaped so it reads back as written.
        String name = "<Ana> #1";
        String said = "*really*";
        MarkdownBuilder b = new MarkdownBuilder();
        b.heading(2, Inlines.empty.text("Report for " + name));
        b.paragraph(
            Inlines.empty.text("Said: ").emphasis(Inlines.empty.text(said)).text(" see ")
                .link(Inlines.empty.text("the [docs]"), new LinkTarget("docs/read me.md")));
        MarkdownBuilder first = new MarkdownBuilder();
        first.paragraph(Inlines.empty.text("1. first, `x`"));
        MarkdownBuilder second = new MarkdownBuilder();
        second.codeBlock("py", "print('```')\n");
        b.bulletList(List.of(first, second));
        rendered("markdown", b.toMarkdown());
        MarkdownDocument built = b.toDocument();
        System.out.println("heading: " + built.getHeadings().get(0).getText());
        Link link = built.getLinks().get(0);
        System.out.println("link: " + link.getText() + " -> " + link.getDestination().getUrl());
        rendered("html", built.toHtml());
    

        section("8. Insert, replace, and remove blocks");

        String advice = "# Notes\n\n> Old advice.\n> # Tip\n\n- one\n- two\n\nDraft, remove me.\n\nThe end.\n";
        MarkdownDocument adviceDoc = parseMarkdown(advice);
        MarkdownBuilder warning = new MarkdownBuilder();
        warning.paragraph(Inlines.empty.strong(Inlines.empty.text("Careful:")).text(" it's *hot*."));
        MarkdownBuilder also = new MarkdownBuilder();
        also.paragraph(Inlines.empty.text("Also: *this*."));
        // Blocks from a builder, where they go, with the prefixes of the block
        // quote or list item around them; the rest stays as written.
        MarkdownEditor adviceEditor = adviceDoc.editor();
        for (MarkdownNode view : adviceDoc.getDescendants()) {
            if (view instanceof Paragraph p && p.getText().equals("Old advice.")) {
                adviceEditor.replace(p, warning);
            } else if (view instanceof Paragraph p && p.getText().equals("two")) {
                adviceEditor.insertAfter(p, also);
            } else if (view instanceof Paragraph p && p.getText().equals("Draft, remove me.")) {
                adviceEditor.remove(p);
            } else if (view instanceof Heading h && h.getText().equals("Tip")) {
                adviceEditor.setContent(h, Inlines.empty.text("Tip ").code("#1"));
            }
        }
        MarkdownDocument advised = adviceEditor.toDocument();
        rendered("markdown", advised.getAsWritten());
        System.out.println("heading: " + advised.getHeadings().get(1).getText());

        section("9. Parse HTML, as browsers do");

        // The HTML standard's tokenizer and tree construction, lossless too.
        String htmlText = "<p id=a id=b>One<p>Two<table><td>x</table>";
        HtmlDocument htmlDoc = parseHtml(htmlText);
        System.out.println("printed back exactly: " + htmlDoc.getAsWritten().equals(htmlText));
        rendered("html", htmlDoc.getHtml());
        List<Element> paragraphs = htmlDoc.getBody().getChildren().stream()
            .filter(Element.class::isInstance).map(Element.class::cast).toList();
        System.out.println("body: " + paragraphs.stream().map(Element::getName).collect(Collectors.joining(", "))
            + ", the first with id " + paragraphs.get(0).attribute("id"));
        for (HtmlParseError error : htmlDoc.getErrors()) {
            System.out.println("error: " + error.getCode() + " at " + error.getOffset());
        }
        // A fragment, as innerHTML parses it: where it goes decides what it is.
        System.out.println("in a tr: " + parseHtmlFragment("<td>1<td>2", new FragmentContext("tr")).getHtml());
        System.out.println("in a div: " + parseHtmlFragment("<td>1<td>2", new FragmentContext("div")).getHtml());
        // Tokens edit like Markdown: one part changes, the rest stays as written.
        StartTag anchor = tokenizeHtml("<a href='/old' class=x>Go</a>").getStartTags().get(0);
        System.out.println("edited: " + anchor.attribute("href").withValue("/new").getAsWritten());

        section("10. Markdown and raw HTML, one tree");

        // The tree a browser builds from the rendering, each element knowing
        // where it came from.
        MarkdownDocument mixed = parseMarkdownWithHtml("a <b>bold\n\nstill bold</b>\n\n<table><td>x</table>\n");
        BuiltHtml tree = buildHtml(mixed);
        rendered("html", tree.getHtml());
        origins(tree.getChildren(), 0);

        section("11. Render Markdown from anyone");

        // That tree, sanitized: only what the policy allows, with every URL checked.
        MarkdownDocument untrusted = parseMarkdownWithHtml("[a](javascript:alert(1)) <b onclick=x>b</b><script>alert(2)</script>\n");
        rendered("safe", renderSafe(untrusted).getHtml());
        rendered("text only", renderSafe(parseMarkdownWithHtml("# *a* [b](/c)\n"), SanitizerPolicy.textOnly).getHtml());
    }
}
