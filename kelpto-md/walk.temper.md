# Walking and editing many nodes

Two things for working on a whole document, not one node at a time:

- **`descendants`:** every typed view inside a node, in document
  order, each before what it holds, as one flat list. Filter it with
  each language's own tools: a `for` loop and a type test, a list
  comprehension, streams, LINQ, or iterators. Each view's `parent` and
  `depth` say where it is.
- **`MarkdownEditor`:** collects edits to many nodes, then builds one
  new document from them all, copying each node on a path to an edit
  once, with every other byte as written.

A flat list rather than a visitor or callback: it reads the same in
every language, it can be filtered, indexed, and counted, and it
needs no closure that mutates captured state, which Rust's `Fn` and
Java's lambdas make awkward. It costs one view per node, which
walking makes anyway, and one list.

```temper inert
let doc = parseMarkdown("# Intro\n\nSee [a](a.md) and [b][].\n\n[b]: b.md\n");
let editor = doc.editor();
let all = doc.descendants;
for (var i = 0; i < all.length; i += 1) {
  let view = all[i];
  when (view) {
    is Heading -> editor.setLevel(view, view.level + 1) orelse panic();
    is Link -> if (view.style == "inline") {
      editor.setDestination(view, new LinkTarget("/docs/${view.destination?.url ?? ""}")) orelse panic();
    };
    is LinkReferenceDefinition -> editor.setDestination(view, new LinkTarget("/docs/${view.destination.url}")) orelse panic();
    else -> do {};
  }
}
(editor.toDocument() orelse panic()).asWritten; // "## Intro\n\nSee [a](/docs/a.md) and [b][].\n\n[b]: /docs/b.md\n"
```

## Walking

What a view holds, by kind: blocks in a document, block quote, list
item, or footnote definition; items and blank lines in a list; rows in
a table (the header first; the delimiter row is markup) and cells in a
row; inlines in a heading, paragraph, table cell, emphasis, strong,
strikethrough, link, or image. The rest hold no views: code, HTML,
autolinks, and the like. A reference link's definition is where it's
written, not under the link.

This makes views straight from the green children, without lists of
children along the way.

    let addDescendants(node: RedNode, out: ListBuilder<MarkdownNode>): Void {
      let id = node.green.kind.id;
      if (
        node.parent == null || id == blockQuoteKind.id || id == listItemKind.id ||
        id == footnoteDefinitionKind.id || id == listKind.id || id == tableKind.id ||
        id == tableHeaderRowKind.id || id == tableRowKind.id
      ) {
        addViews(node, id, false, out);
      } else if (
        id == headingKind.id || id == setextHeadingKind.id || id == paragraphKind.id ||
        id == tableCellKind.id
      ) {
        var at = node.offset;
        let kids = node.green.children;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid.kind.id == inlineContentKind.id) {
            if (kid is GreenNode) { addViews(new RedNode(kid, node, at, i), id, true, out); }
            break;
          }
          at += kid.width;
        }
      } else if (
        id == emphasisKind.id || id == strongKind.id || id == strikethroughKind.id ||
        id == linkKind.id || id == imageKind.id
      ) {
        addViews(node, id, true, out);
      }
    }

The views among `holder`'s children, inlines or else as `viewInside`
gives them, each followed by what it holds. No early returns here or
in `viewInside`, which some backends make costly.

    let addViews(holder: RedNode, id: Int, inlines: Boolean, out: ListBuilder<MarkdownNode>): Void {
      var at = holder.offset;
      let kids = holder.green.children;
      for (var i = 0; i < kids.length; i += 1) {
        let kid = kids[i];

A link's or image's text ends at its `]`; its label and title are
markup.

        if (inlines && kid.kind.id == linkCloseKind.id) { break; }
        if (kid is GreenNode) {
          let red = new RedNode(kid, holder, at, i);
          let view: MarkdownNode? = if (inlines) { inlineOf(red) } else { viewInside(id, red) };
          if (view != null) {
            out.add(view);
            addDescendants(red, out);
          }
        }
        at += kid.width;
      }
    }

The view of `child`, a node in a block container, list, table, or row
(`parentId` says which), or null for markup such as a table's
delimiter row.

    let viewInside(parentId: Int, child: RedNode): MarkdownNode? {
      if (parentId == listKind.id) {
        if (child.hasKind(listItemKind)) { new ListItem(child) } else { new BlankLine(child) }
      } else if (parentId == tableKind.id) {
        if (child.hasKind(tableHeaderRowKind) || child.hasKind(tableRowKind)) { new TableRow(child) } else { null }
      } else if (parentId == tableHeaderRowKind.id || parentId == tableRowKind.id) {
        new TableCell(child)
      } else {
        blockChildOf(child)
      }
    }

Only `InlineContent` nodes stand between a view and the view holding
it, so a view's parent is its nearest other ancestor, and its depth
counts the others.

    let parentViewOf(node: RedNode): MarkdownNode? {
      var up = node.parent;
      while (up != null) {
        let red = up as RedNode orelse panic();
        if (red.parent == null) { return new MarkdownDocument(red); }
        if (!red.hasKind(inlineContentKind)) { return holderViewOf(red); }
        up = red.parent;
      }
      null
    }

    let depthOf(node: RedNode): Int {
      var depth = 0;
      var up = node.parent;
      while (up != null) {
        let red = up as RedNode orelse panic();
        if (!red.hasKind(inlineContentKind)) { depth += 1; }
        up = red.parent;
      }
      depth
    }

The view of a node that holds views, below the root.

    let holderViewOf(node: RedNode): MarkdownNode {
      if (node.hasKind(listItemKind)) { return new ListItem(node); }
      if (node.hasKind(tableHeaderRowKind) || node.hasKind(tableRowKind)) { return new TableRow(node); }
      if (node.hasKind(tableCellKind)) { return new TableCell(node); }
      if (
        node.hasKind(emphasisKind) || node.hasKind(strongKind) || node.hasKind(strikethroughKind) ||
        node.hasKind(linkKind) || node.hasKind(imageKind)
      ) {
        return inlineOf(node);
      }
      blockChildOf(node)
    }

## Editing many nodes at once

Each `with…` edit on a view gives a new document at once, so a second
edit needs views of that new document, found again. An editor instead
takes many edits of views of one document, each worked out against
that document, and `toDocument()` builds the new one in one pass (see
kelpto-core's `replaceAll`). Its methods match the views' edits, and
bubble where those do, or for a view that has no such edit.

    export class MarkdownEditor {
      private root: RedNode;
      private edits: ListBuilder<Replacement>;

      public constructor(document: MarkdownDocument) {
        this.root = document.node;
        this.edits = new ListBuilder<Replacement>();
      }

How many edits it holds.

      public get length(): Int { edits.length }

As `Heading.withText` or `TableCell.withText`.

      public setText(view: MarkdownNode, text: String): Void throws Bubble {
        when (view) {
          is Heading -> edits.add(headingTextEdit(view.node, text));
          is TableCell -> edits.add(cellTextEdit(view.node, text));
          else -> bubble();
        }
      }

As `Heading.withLevel`.

      public setLevel(heading: Heading, level: Int): Void throws Bubble {
        edits.add(headingLevelEdit(heading.node, level));
      }

As `CodeBlock.withInfo`.

      public setInfo(block: CodeBlock, info: String): Void throws Bubble {
        edits.add(infoEdit(block.node, info));
      }

As `withDestination` on a `Link`, an `Image`, or a
`LinkReferenceDefinition`.

      public setDestination(view: MarkdownNode, target: LinkTarget): Void throws Bubble {
        when (view) {
          is Link -> edits.add(linkDestinationEdit(view.node, target));
          is Image -> edits.add(linkDestinationEdit(view.node, target));
          is LinkReferenceDefinition -> edits.add(destinationEdit(view.node, target));
          else -> bubble();
        }
      }

As `TaskListItem.withChecked`; nothing if it already is.

      public setChecked(task: TaskListItem, checked: Boolean): Void {
        let edit = checkedEdit(task.node, checked);
        if (edit != null) { edits.add(edit); }
      }

As `withLabel` on a `FootnoteDefinition` or a `FootnoteReference`.

      public setLabel(view: MarkdownNode, label: String): Void throws Bubble {
        when (view) {
          is FootnoteDefinition -> edits.add(footnoteDefinitionLabelEdit(view.node, label));
          is FootnoteReference -> edits.add(footnoteReferenceLabelEdit(view.node, label));
          else -> bubble();
        }
      }

The new document, with every edit made. The editor's document is
unchanged. Bubbles if two edits overlap, such as `setText` and
`setLevel` on one heading, or the same edit twice, or if a view came
from another document.

      public toDocument(): MarkdownDocument throws Bubble {
        new MarkdownDocument(replaceAll(root, edits.toList()))
      }
    }

## Tests

    let kindsOf(views: List<MarkdownNode>): String {
      views.join(" ") { (view: MarkdownNode): String =>
        let name = view.node.green.kind.name;
        "${view.depth.toString()}${name}"
      }
    }

    test("descendants: every view, in document order, with depths") {
      let doc = MarkdownParser.gfm.parse(
        "# A *b*\n\n> - x [l](/u)\n>\n>   ![i](/i)\n\n| c |\n|---|\n| **d** |\n\n[^n]: e\n",
      );
      let all = doc.descendants;
      let expected = [
        "1Heading 2Text 2Emphasis 3Text 1BlankLine 1BlockQuote 2List 3ListItem 4Paragraph",
        "5Text 5Link 6Text 4BlankLine 4Paragraph 5Image 6Text 1BlankLine 1Table 2TableHeaderRow",
        "3TableCell 4Text 2TableRow 3TableCell 4Strong 5Text 1BlankLine 1FootnoteDefinition",
        "2Paragraph 3Text",
      ].join(" ") { (s: String): String => s };
      assert(kindsOf(all) == expected) { kindsOf(all) };
      assert(doc.depth == 0 && doc.parent == null) { "the document" };
      for (var i = 0; i < all.length; i += 1) {
        let view = all[i];
        let parent = view.parent as MarkdownNode orelse panic();
        assert(parent.depth == view.depth - 1) { view.asWritten };
        let span = view.span;
        assert(parent.span.start <= span.start && span.end <= parent.span.end) { view.asWritten };
        if (i > 0) { assert(all[i - 1].span.start <= span.start) { "in order" }; }
      }
      let link = all[10] as Link orelse panic();
      assert(link.text == "l" && (link.parent as Paragraph orelse panic()).text == "x l") { link.text };
      assert(kindsOf(link.descendants) == "6Text") { kindsOf(link.descendants) };
      assert(doc.headings[0].descendants.length == 3) { "a heading's inlines" };
      assert(parseMarkdown("").descendants.isEmpty) { "an empty document" };
    }

    test("descendants: leaves hold nothing, and HTML stays HTML") {
      let doc = parseMarkdown("```\n# no\n```\n\n<div>\n*no*\n</div>\n\n`*no*` <b>*x*</b> <https://x.test>\n");
      let names = kindsOf(doc.descendants);
      let expected = "1CodeBlock 1BlankLine 1HtmlBlock 1BlankLine 1Paragraph 2CodeSpan 2Text 2RawHtml 2Emphasis 3Text 2RawHtml 2Text 2Autolink";
      assert(names == expected) { names };
    }

    test("MarkdownEditor makes many edits at once, changing only their bytes") {
      let text = "# One\n\n- [ ] task [a](/a)\n\n| x |\n|---|\n| y |\n\nTwo\n===\n\n```js\nz\n```\n\n[r]: /r\nHi[^n].\n\n[^n]: Note.\n";
      let doc = MarkdownParser.gfm.parse(text);
      let editor = doc.editor();
      let headings = doc.headings;
      for (var i = 0; i < headings.length; i += 1) {
        editor.setLevel(headings[i], headings[i].level + 1) orelse panic();
      }
      editor.setDestination(doc.links[0], new LinkTarget("/b")) orelse panic();
      editor.setDestination(doc.linkReferenceDefinitions[0], new LinkTarget("/s")) orelse panic();
      editor.setChecked(doc.taskListItems[0], false);
      editor.setChecked(doc.taskListItems[0], true);
      editor.setText(doc.tables[0].rows[0].cells[0], "w|v") orelse panic();
      editor.setInfo(doc.codeBlocks[0], "ts") orelse panic();
      editor.setLabel(doc.footnoteDefinitions[0], "m") orelse panic();
      editor.setLabel(doc.footnoteReferences[0], "m") orelse panic();
      assert(editor.length == 9) { editor.length.toString() };
      let edited = editor.toDocument() orelse panic();
      let expected = "## One\n\n- [x] task [a](/b)\n\n| x |\n|---|\n| w\\|v |\n\nTwo\n---\n\n```ts\nz\n```\n\n[r]: /s\nHi[^m].\n\n[^m]: Note.\n";
      assert(edited.asWritten == expected) { edited.asWritten };
      assert(doc.asWritten == text) { "the old document is unchanged" };
      assert(edited.footnoteReferences[0].definition?.label == "m") { "references follow" };
      let again = do { editor.setText(headings[0], "x"); editor.toDocument(); "accepted" } orelse "bubbled";
      assert(again == "bubbled") { "setText and setLevel on one heading overlap" };
      let wrong = do { editor.setText(doc.links[0], "x"); "accepted" } orelse "bubbled";
      assert(wrong == "bubbled") { "a link has no setText" };
      let other = parseMarkdown("# One\n");
      let foreign = do { other.editor().setLevel(headings[1], 1); "accepted" } orelse "bubbled";
      assert(foreign == "accepted") { "setLevel alone can't tell" };
      let mixed = other.editor();
      mixed.setLevel(headings[1], 1) orelse panic();
      let caught = do { mixed.toDocument(); "accepted" } orelse "bubbled";
      assert(caught == "bubbled") { "toDocument checks views come from its document" };
      assert((doc.editor().toDocument() orelse panic()).asWritten == text) { "no edits" };
    }

    test("the README's example: walk once, edit many, build once") {
      let doc = parseMarkdown("# Guide\n\nRead [this](start.md) and [that][t].\n\n[t]: /api\n");
      let editor = doc.editor();
      let all = doc.descendants;
      for (var i = 0; i < all.length; i += 1) {
        let view = all[i];
        when (view) {
          is Heading -> editor.setLevel(view, view.level + 1) orelse panic();
          is Link -> if (view.style == "inline") {
            editor.setDestination(view, new LinkTarget("https://x.test/${view.destination?.url ?? ""}")) orelse panic();
          };
          is LinkReferenceDefinition -> editor.setDestination(view, new LinkTarget("https://x.test${view.destination.url}")) orelse panic();
          else -> do {};
        }
      }
      let written = (editor.toDocument() orelse panic()).asWritten;
      assert(written == "## Guide\n\nRead [this](https://x.test/start.md) and [that][t].\n\n[t]: https://x.test/api\n") { written };
    }
