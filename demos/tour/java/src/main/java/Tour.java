// A tour of Kelpto's Markdown library, from Java.
//
// The same tour exists for each language Kelpto supports, and they all print
// the same text. See demos/README.md for how to run them.

import static kelpto_md.KelptoMdGlobal.parseMarkdown;

import java.util.List;
import java.util.stream.Collectors;
import kelpto_md.FootnoteDefinition;
import kelpto_md.FootnoteReference;
import kelpto_md.Heading;
import kelpto_md.Link;
import kelpto_md.LinkReferenceDefinition;
import kelpto_md.LinkTarget;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownEditor;
import kelpto_md.MarkdownNode;
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

    public static void main(String[] args) {
        System.out.println("# Kelpto tour");

        section("1. Parse and print, losslessly");

        String text = """
            # Release notes

            Kelpto keeps *every*   byte.

            | Library     | Status |
            |:------------|-------:|
            | kelpto-md   | ready  |
            | kelpto-html | early  |

            - [x] CommonMark
            - [ ] HTML trees

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
        edited = edited.getTables().get(0).getRows().get(1).getCells().get(1).withText("ready");
        edited = edited.getTaskListItems().get(1).withChecked(true);
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
    }
}
