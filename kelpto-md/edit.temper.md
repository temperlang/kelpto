# Inserting, removing, and replacing blocks

What `MarkdownEditor`'s block edits (`insertBefore`, `insertAfter`,
`replace`, and `remove`) and `Paragraph.withContent` need: blocks
written by a `MarkdownBuilder`, made into green nodes that sit in a
container (the document, a block quote, a list item, or a footnote
definition) just as parsing the edited text would give them, with
every other byte as written.

- **Container prefixes:** every line after a container's first needs
  its prefix: `> ` in a block quote, spaces to the content's column in
  a list item, four spaces in a footnote definition, outermost first.
  New lines get them, written plainly; existing lines keep theirs.
- **Parsed in place:** the new lines are parsed inside the same
  containers, opened on a first line of their own, between two empty
  headings, and the nodes between those are what the edit puts in.
  Builders write no raw HTML, link definitions, or tables, so the
  default parser reads them as any parser would.
- **Blank lines between blocks:** new blocks are set apart from
  their neighbors by blank lines, so nothing joins a paragraph, a
  table, or an HTML block, and nothing reads as a lazy continuation
  line. In a tight list that makes the list loose. Removing a block
  leaves one blank line where blocks would otherwise touch.
- **What could still join:** lists with the same marker, and an
  indented block after a list, a footnote definition, or indented
  code, which would read as part of it. The builder picks a list's
  marker to differ from its neighbors'; otherwise such an edit bubbles,
  as does adding after an unclosed fence or HTML block, which would
  swallow what follows, and removing the only definition of a label a
  link or footnote reference uses.

Edits are worked out per container when the editor builds the
document, so neighbors are judged as they will be, whatever else in
that container is inserted or removed.

## Container prefixes

How to open a container's line, and continue one: the container
prefixes of `container` and those around it, outermost first, and the
kinds that hold them, to find the same container in a parse.

    class Prefixes(public open: String, public cont: String, public kinds: List<Int>) {}

    let prefixesOf(container: RedNode): Prefixes throws Bubble {
      let opens = new ListBuilder<String>();
      let conts = new ListBuilder<String>();
      let kinds = new ListBuilder<Int>();
      var node = container;
      while (node.parent != null) {
        let id = node.green.kind.id;
        if (id == blockQuoteKind.id) {
          opens.add("> ");
          conts.add("> ");
          kinds.add(id);
        } else if (id == listItemKind.id) {
          let width = itemContentWidth(node);
          opens.add(markerOfWidth(width));
          conts.add(spacesOf(width));
          kinds.add(id);
        } else if (id == footnoteDefinitionKind.id) {
          opens.add("[^x]: ");
          conts.add("    ");
          kinds.add(id);
        } else if (id != listKind.id) {
          bubble();
        }
        node = node.parent as RedNode orelse panic();
      }
      let open = new StringBuilder();
      let cont = new StringBuilder();
      let outerFirst = new ListBuilder<Int>();
      for (var i = opens.length - 1; i >= 0; i -= 1) {
        open.append(opens[i]);
        cont.append(conts[i]);
        outerFirst.add(kinds[i]);
      }
      new Prefixes(open.toString(), cont.toString(), outerFirst.toList())
    }

The column of a list item's content after its own start: its
indentation, marker, and the spaces after (one if none, or if its
first line is blank). Bubbles for tabs, whose width depends on where
the line starts.

    let itemContentWidth(item: RedNode): Int throws Bubble {
      let kids = item.green.children;
      var width = 0;
      var i = 0;
      if (i < kids.length && kids[i].kind.id == indentKind.id) {
        if (hasTab(kids[i])) { bubble(); }
        width += kids[i].width;
        i += 1;
      }
      if (i >= kids.length || kids[i].kind.id != listMarkerKind.id) { bubble(); }
      width += kids[i].width;
      i += 1;
      if (i < kids.length && kids[i].kind.id == whitespaceKind.id) {
        if (hasTab(kids[i])) { bubble(); }
        width += kids[i].width;
      } else {
        width += 1;
      }
      width
    }

    let hasTab(element: GreenElement): Boolean {
      when (element) {
        is GreenToken -> longestRun(element.text, char'\t') > 0;
        else -> true;
      }
    }

A list marker opening content at `width`: a bullet and spaces, or for
wider items, a number padded with zeros, `.`, and four spaces.

    let markerOfWidth(width: Int): String throws Bubble {
      if (width <= 5) { return "-${spacesOf(width - 1)}"; }
      let digits = width - 5;
      if (digits > 9) { bubble(); }
      let out = new StringBuilder();
      for (var i = 1; i < digits; i += 1) { out.append("0"); }
      out.append("1.    ");
      out.toString()
    }

    let spacesOf(n: Int): String {
      let out = new StringBuilder();
      for (var i = 0; i < n; i += 1) { out.append(" "); }
      out.toString()
    }

## Parsing in place

The green elements for `body`, whole lines ending `\n` ("" for
none), as they'd be among `container`'s children: each line with
the container's prefix (a blank one trimmed), parsed between two
empty headings in the same containers. With `atStart`, the first
line goes where the container's first line has its prefix already, so
the parse's prefix for it is left out; with `endPrefix`, the prefix
for the line after is kept, for a block whose line had none.

    let parsedInContainer(
      container: RedNode, body: String, atStart: Boolean, endPrefix: Boolean,
    ): List<GreenElement> throws Bubble {
      let prefixes = prefixesOf(container);
      let text = "${prefixes.open}#\n${prefixed(body, prefixes.cont, prefixes.cont)}${prefixes.cont}#\n";
      let extensions = inlineExtensionsOf(container);
      var node = redRoot(parseWith(text, opaqueRawHtml, extensions));
      let kinds = prefixes.kinds;
      for (var k = 0; k < kinds.length; k += 1) {
        if (kinds[k] == listItemKind.id) {
          node = firstNodeOf(node, listKind.id);
          node = firstNodeOf(node, listItemKind.id);
        } else {
          node = firstNodeOf(node, kinds[k]);
        }
      }
      let kids = node.green.children;
      var first = -1;
      var last = -1;
      for (var i = 0; i < kids.length; i += 1) {
        if (kids[i] is GreenNode) {
          if (first < 0) { first = i; }
          last = i;
        }
      }
      if (first < 0 || first == last || kids[first].kind.id != headingKind.id) { bubble(); }
      var from = first + 1;
      var to = last;
      if (!endPrefix) {
        while (to > from && !(kids[to - 1] is GreenNode)) { to -= 1; }
      }
      if (atStart) {
        while (from < to && !(kids[from] is GreenNode)) { from += 1; }
      }
      kids.slice(from, to)
    }

    let firstNodeOf(node: RedNode, kindId: Int): RedNode throws Bubble {
      let kids = node.childNodes;
      for (var i = 0; i < kids.length; i += 1) {
        if (kids[i].green.kind.id == kindId) { return kids[i]; }
      }
      bubble()
    }

A paragraph with new content, written as the builder writes it, in
place of `node`: its leading spaces and whether it ends a line kept.
Bubbles for empty content, since a paragraph can't be empty.

    let paragraphContentEdit(node: RedNode, content: Inlines): Replacement throws Bubble {
      let text = writeInlines(content.pieces, paragraphContext);
      if (text.isEmpty) { bubble(); }
      let parsed = parsedInContainer(node.parent as RedNode orelse panic(), "${text}\n", true, false);
      if (parsed.length != 1 || parsed[0].kind.id != paragraphKind.id) { bubble(); }
      let made = (parsed[0] as GreenNode orelse panic()).children;
      let kids = new ListBuilder<GreenElement>();
      let old = node.green.children;
      if (!old.isEmpty && old[0].kind.id == whitespaceKind.id) { kids.add(old[0]); }
      let endsLine = !old.isEmpty && old[old.length - 1].kind.id == lineEndingKind.id;
      let end = if (!endsLine && made[made.length - 1].kind.id == lineEndingKind.id) { made.length - 1 } else { made.length };
      for (var i = 0; i < end; i += 1) { kids.add(made[i]); }
      new Replacement(node, new GreenNode(node.kind, kids.toList()))
    }

## Block edits

One block edit, as the editor keeps it until it builds the document.

    let insertBeforeEdit = 0;
    let insertAfterEdit = 1;
    let replaceEdit = 2;
    let removeEdit = 3;

    class BlockEdit(public kind: Int, public node: RedNode, public content: MarkdownBuilder?) {}

Whether `node` is a block an edit can be put beside: a block in a
container, other than a blank line.

    let isEditableBlock(node: RedNode): Boolean {
      if (node.parent == null || node.hasKind(blankLineKind)) { return false; }
      let parent = node.parent as RedNode orelse panic();
      let id = parent.green.kind.id;
      parent.parent == null || id == blockQuoteKind.id || id == listItemKind.id || id == footnoteDefinitionKind.id
    }

The splices for all of `edits`, grouped by container, each worked out
against the blocks that container will hold.

    let blockSplices(root: RedNode, edits: List<BlockEdit>): List<Splice> throws Bubble {
      let splices = new ListBuilder<Splice>();
      let keys = new ListBuilder<String>();
      let groups = new MapBuilder<String, ListBuilder<BlockEdit>>();
      for (var i = 0; i < edits.length; i += 1) {
        let edit = edits[i];
        let key = pathKey(edit.node.parent as RedNode orelse panic());
        if (!groups.has(key)) {
          keys.add(key);
          groups[key] = new ListBuilder<BlockEdit>();
        }
        (groups[key] orelse panic()).add(edit);
      }
      let removed = new ListBuilder<RedNode>();
      for (var k = 0; k < keys.length; k += 1) {
        let group = (groups[keys[k]] orelse panic()).toList();
        new ContainerEdits(root, group[0].node.parent as RedNode orelse panic(), group, splices, removed).make();
      }
      checkDefinitionsKept(root, removed.toList());
      splices.toList()
    }

    let pathKey(node: RedNode): String {
      let out = new StringBuilder();
      var at = node;
      while (at.parent != null) {
        out.append(at.index.toString());
        out.append("/");
        at = at.parent as RedNode orelse panic();
      }
      out.toString()
    }

The edits of one container. Its blocks (children other than blank
lines and prefixes) each have what goes before and after them, and
whether they stay; each run of changes between two kept blocks, or
at the start or end, becomes one splice.

    class ContainerEdits {
      private root: RedNode;
      private container: RedNode;
      private edits: List<BlockEdit>;
      private splices: ListBuilder<Splice>;
      private removedBlocks: ListBuilder<RedNode>;
      private kids: List<GreenElement>;
      private blocks: ListBuilder<Int> = new ListBuilder<Int>();

      public constructor(
        root: RedNode, container: RedNode, edits: List<BlockEdit>, splices: ListBuilder<Splice>,
        removedBlocks: ListBuilder<RedNode>,
      ) {
        this.root = root;
        this.container = container;
        this.edits = edits;
        this.splices = splices;
        this.removedBlocks = removedBlocks;
        this.kids = container.green.children;
      }

      public make(): Void throws Bubble {
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          if (kid is GreenNode && kid.kind.id != blankLineKind.id) { blocks.add(i); }
        }
        let n = blocks.length;
        let befores = new ListBuilder<ListBuilder<MarkdownBuilder>>();
        let afters = new ListBuilder<ListBuilder<MarkdownBuilder>>();
        let removed = new ListBuilder<Boolean>();
        let middles = new ListBuilder<MarkdownBuilder?>();
        for (var p = 0; p < n; p += 1) {
          befores.add(new ListBuilder<MarkdownBuilder>());
          afters.add(new ListBuilder<MarkdownBuilder>());
          removed.add(false);
          middles.add(null);
        }
        for (var e = 0; e < edits.length; e += 1) {
          let edit = edits[e];
          let p = positionOf(edit.node);
          let content = edit.content;
          if (edit.kind == insertBeforeEdit) {
            befores[p].add(content as MarkdownBuilder orelse panic());
          } else if (edit.kind == insertAfterEdit) {
            afters[p].add(content as MarkdownBuilder orelse panic());
          } else {
            if (removed[p]) { bubble(); }
            removed.set(p, true);
            middles.set(p, content);
          }
        }
        var lastKept = -1;
        var chunks = new ListBuilder<MarkdownBuilder>();
        var anyRemoved = false;
        for (var p = 0; p < n; p += 1) {
          addAll(chunks, befores[p]);
          if (removed[p]) {
            anyRemoved = true;
            removedBlocks.add(childAt(blocks[p]));
            let middle = middles[p];
            if (middle != null) { chunks.add(middle); }
            addAll(chunks, afters[p]);
            continue;
          }
          if (!chunks.isEmpty || anyRemoved) { gap(lastKept, p, chunks.toList()); }
          chunks = new ListBuilder<MarkdownBuilder>();
          anyRemoved = false;
          addAll(chunks, afters[p]);
          lastKept = p;
        }
        if (!chunks.isEmpty || anyRemoved) { gap(lastKept, -1, chunks.toList()); }
      }

      private positionOf(node: RedNode): Int throws Bubble {
        for (var p = 0; p < blocks.length; p += 1) {
          if (blocks[p] == node.index) { return p; }
        }
        bubble()
      }

      private childAt(index: Int): RedNode {
        var at = container.offset;
        for (var i = 0; i < index; i += 1) { at += kids[i].width; }
        new RedNode(kids[index] as GreenNode orelse panic(), container, at, index)
      }

The splice for the blocks between kept blocks `a` and `b` (positions,
or -1 at the start or end): `chunks` in order, set apart by blank
lines, in place of everything between.

      private gap(a: Int, b: Int, chunks: List<MarkdownBuilder>): Void throws Bubble {
        let first = blocks[0];
        let last = blocks[blocks.length - 1];
        let before: RedNode? = if (a >= 0) { childAt(blocks[a]) } else { null };
        let after: RedNode? = if (b >= 0) { childAt(blocks[b]) } else { null };
        let combined = new MarkdownBuilder();
        for (var c = 0; c < chunks.length; c += 1) {
          let blocksOf = chunks[c].blocks;
          for (var k = 0; k < blocksOf.length; k += 1) { combined.addBuilt(blocksOf[k]); }
        }
        let starItem = before == null && container.hasKind(listItemKind) &&
          (container.childOfKind(listMarkerKind)?.asWritten ?? "") == "*";
        let chunkText = combined.markdownBetween(listMarkerOf(before), listMarkerOf(after), starItem);
        if (before == null && container.childOfKind(taskMarkerKind) != null) {

A task list item's first block is its task's text, after its marker.

          bubble();
        }
        if (chunkText.isEmpty && before == null && after == null && container.parent != null) {

A block quote, list item, or footnote definition can't be left
empty; remove it instead.

          bubble();
        }

What follows `before` in this container can't join it.

        if (before != null) {
          if (opensToEnd(before) && (!chunkText.isEmpty || after != null)) { bubble(); }
          if (chunkText.isEmpty && after != null) {
            let next = after as RedNode orelse panic();
            if (absorbsIndented(before) && startsIndented(next)) { bubble(); }
            let beforeMarker = listMarkerOf(before);
            if (beforeMarker != 0 && beforeMarker == listMarkerOf(next)) { bubble(); }
          }
        }
        if (after != null && combined.endsWithList && startsIndented(after)) { bubble(); }

The lines in place, and a blank line after `before`, unless it ends
with one, which in a list or footnote definition goes inside it, as
parsing puts it.

        let endBlank = after == null && needsEndBlank();
        let body = new StringBuilder();
        if (before != null) {
          let needsBlank = (after != null || !chunkText.isEmpty || endBlank) && !endsWithBlankLine(before);
          if (!endsLine(before) && (needsBlank || !chunkText.isEmpty || endBlank)) { lineEndAt(before); }
          if (needsBlank) {
            if (holdsBlankAfter(before)) { blankInside(before, 1); } else { body.append("\n"); }
          }
        }
        body.append(chunkText);
        if (!chunkText.isEmpty && (after != null || endBlank)) { body.append("\n"); }

Blank lines ending the container go inside a list (or footnote
definition) that now comes last, as parsing puts them, so they're
written again in place.

        var trailingBlanks = 0;
        for (var i = last + 1; i < kids.length; i += 1) {
          if (kids[i].kind.id == blankLineKind.id) { trailingBlanks += 1; }
        }
        let blanksMove = after == null && trailingBlanks > 0 && (
          if (chunkText.isEmpty) { before != null && holdsBlankAfter(before) } else {
            combined.endsWithList
          }
        );
        if (blanksMove) {
          if (chunkText.isEmpty) {
            blankInside(before as RedNode orelse panic(), trailingBlanks);
          } else {
            for (var i = 0; i < trailingBlanks; i += 1) { body.append("\n"); }
          }
        }
        let bodyText = body.toString();

The range it replaces: from after `before` (or the first block) to
`after`'s line prefix (or to it, if `after` was the first block, or
there's nothing new, or past the last block).

        let from = if (before != null) { before.index + 1 } else { first };
        var to = if (blanksMove) { kids.length } else { last + 1 };
        var endPrefix = false;
        if (after != null) {
          to = after.index;
          if (after.index == first) {
            endPrefix = !bodyText.isEmpty;
          } else if (before != null || !bodyText.isEmpty) {
            while (to > from && !(kids[to - 1] is GreenNode)) { to -= 1; }
          }
        }
        let elements: List<GreenElement> = if (bodyText.isEmpty) { [] } else {
          parsedInContainer(container, bodyText, before == null, endPrefix)
        };
        splices.add(new Splice(container, from, to, elements));
      }

Whether blocks ending this container need a blank line after them,
so the next line can't continue a paragraph lazily: in a container
other than the document, with no blank lines of its own at its end,
when a line other than a blank one or a sibling list item follows.

      private needsEndBlank(): Boolean {
        if (container.parent == null) { return false; }
        let last = blocks[blocks.length - 1];
        for (var i = last + 1; i < kids.length; i += 1) {
          if (kids[i] is GreenNode) { return false; }
        }
        var node = container;
        while (node.parent != null) {
          let parent = node.parent as RedNode orelse panic();
          let siblings = parent.green.children;
          for (var i = node.index + 1; i < siblings.length; i += 1) {
            let sibling = siblings[i];
            if (sibling is GreenNode) {
              return !(
                sibling.kind.id == blankLineKind.id ||
                (node.hasKind(listItemKind) && sibling.kind.id == listItemKind.id)
              );
            }
          }
          node = parent;
        }
        false
      }

A line ending added at the end of `node`, the document's last block,
which has none.

      private lineEndAt(node: RedNode): Void {
        var at = node;
        while (true) {
          let id = at.green.kind.id;
          let kids = at.childNodes;
          if (kids.isEmpty) { break; }
          let lastKid = kids[kids.length - 1];
          if (lastKid.index != at.green.children.length - 1) { break; }
          if (
            id == blockQuoteKind.id || id == listKind.id || id == listItemKind.id ||
            id == footnoteDefinitionKind.id || id == tableKind.id ||
            (id == codeBlockKind.id && lastKid.hasKind(closingFenceKind))
          ) {
            at = lastKid;
          } else {
            break;
          }
        }
        let end = at.green.children.length;
        splices.add(new Splice(at, end, end, [new GreenToken(lineEndingKind, "\n")]));
      }

`count` blank lines at the end of the list item or footnote
definition that holds `node`'s last line, as parsing puts blank lines
after one.

      private blankInside(node: RedNode, count: Int): Void throws Bubble {
        var at = node;
        while (at.hasKind(listKind) || at.hasKind(listItemKind) || at.hasKind(footnoteDefinitionKind)) {
          let kids = at.childNodes;
          if (kids.isEmpty) { break; }
          let lastKid = kids[kids.length - 1];
          if (at.hasKind(listKind) || lastKid.hasKind(listKind) || lastKid.hasKind(footnoteDefinitionKind)) {
            at = lastKid;
          } else {
            break;
          }
        }
        let end = at.green.children.length;
        let blanks = new StringBuilder();
        for (var i = 0; i < count; i += 1) { blanks.append("\n"); }
        splices.add(new Splice(at, end, end, parsedInContainer(at, blanks.toString(), false, false)));
      }
    }

    let addAll(to: ListBuilder<MarkdownBuilder>, from: ListBuilder<MarkdownBuilder>): Void {
      for (var i = 0; i < from.length; i += 1) { to.add(from[i]); }
    }

A list's marker character (`-`, `+`, or `*`, or `.` or `)` after the
numbers), or 0 for other blocks and none.

    let listMarkerOf(node: RedNode?): Int {
      if (node == null) { return 0; }
      let list = node as RedNode orelse panic();
      if (!list.hasKind(listKind)) { return 0; }
      let marker = new ListBlock(list).marker;
      if (marker.isEmpty) { 0 } else { marker[String.begin] }
    }

    let endsLine(node: RedNode): Boolean {
      let c = lastCodeOf(node.asWritten);
      c == char'\n' || c == char'\r'
    }

Whether a blank line after `node` is parsed inside it: lists and
footnote definitions stay open across one.

    let holdsBlankAfter(node: RedNode): Boolean {
      node.hasKind(listKind) || node.hasKind(footnoteDefinitionKind)
    }

Whether an indented block after `node` would read as part of it.

    let absorbsIndented(node: RedNode): Boolean {
      node.hasKind(listKind) || node.hasKind(footnoteDefinitionKind) || node.hasKind(indentedCodeKind)
    }

    let startsIndented(node: RedNode): Boolean {
      let c = firstCodeOf(node.asWritten);
      c == char' ' || c == char'\t'
    }

Whether `node` runs to the end of its container, taking whatever
follows: a fence never closed, or an HTML block of kinds 1 to 5 whose
end text never came.

    let opensToEnd(node: RedNode): Boolean {
      if (node.hasKind(codeBlockKind)) {
        return node.childOfKind(openingFenceKind) != null && node.childOfKind(closingFenceKind) == null;
      }
      if (!node.hasKind(htmlBlockKind)) { return false; }
      let text = node.asWritten;
      let start = skipBlanksAt(text, String.begin, text.end);
      let firstEnd = indexOrEnd(text, "\n", start);
      let type = htmlBlockStart(text, start, firstEnd, true);
      if (type < 1 || type > 5) { return false; }
      var end = text.end;
      while (end > String.begin && (text[text.prev(end)] == char'\n' || text[text.prev(end)] == char'\r')) {
        end = text.prev(end);
      }
      var lineStart = end;
      while (lineStart > String.begin && text[text.prev(lineStart)] != char'\n' && text[text.prev(lineStart)] != char'\r') {
        lineStart = text.prev(lineStart);
      }
      if (lineStart < start) { lineStart = start; }
      !htmlBlockEnds(text, type, lineStart, end)
    }

Removing a block bubbles if it holds the only definition of a label
that a link or footnote reference outside the removed blocks uses,
since that would turn the reference into text.

    let checkDefinitionsKept(root: RedNode, removed: List<RedNode>): Void throws Bubble {
      if (removed.isEmpty) { return; }
      let document = new MarkdownDocument(root);
      let gone = new ListBuilder<MarkdownNode>();
      for (var r = 0; r < removed.length; r += 1) {
        let block = blockChildOf(removed[r]);
        if (block is LinkReferenceDefinition || block is FootnoteDefinition) { gone.add(block); }
        let inside = block.descendants;
        for (var i = 0; i < inside.length; i += 1) {
          let view = inside[i];
          if (view is LinkReferenceDefinition || view is FootnoteDefinition) { gone.add(view); }
        }
      }
      if (gone.isEmpty) { return; }
      let definitions = document.linkReferenceDefinitions;
      let links = document.links;
      let footnotes = document.footnoteDefinitions;
      let references = document.footnoteReferences;
      for (var g = 0; g < gone.length; g += 1) {
        let view = gone[g];
        when (view) {
          is LinkReferenceDefinition -> do {
            let label = normalizeLabel(view.label);
            var kept = false;
            for (var i = 0; i < definitions.length; i += 1) {
              let other = definitions[i];
              if (normalizeLabel(other.label) == label && !inAny(other.node, removed)) { kept = true; }
            }
            if (!kept) {
              for (var i = 0; i < links.length; i += 1) {
                let link = links[i];
                let linkLabel = link.label;
                if (linkLabel != null && normalizeLabel(linkLabel) == label && !inAny(link.node, removed)) { bubble(); }
              }
            }
          };
          is FootnoteDefinition -> do {
            let label = normalizeLabel(view.label);
            var kept = false;
            for (var i = 0; i < footnotes.length; i += 1) {
              let other = footnotes[i];
              if (normalizeLabel(other.label) == label && !inAny(other.node, removed)) { kept = true; }
            }
            if (!kept) {
              for (var i = 0; i < references.length; i += 1) {
                let reference = references[i];
                let found = reference.definition;
                if (found != null && found.node.offset == view.node.offset && !inAny(reference.node, removed)) {
                  bubble();
                }
              }
            }
          };
          else -> do {};
        }
      }
    }

    let inAny(node: RedNode, blocks: List<RedNode>): Boolean {
      for (var i = 0; i < blocks.length; i += 1) {
        let span = blocks[i].span;
        if (span.start <= node.offset && node.offset < span.end) { return true; }
      }
      false
    }

## Tests

The green tree as text, kinds and tokens, to compare an edited tree
with what parsing its text gives.

    let treeShape(green: GreenElement): String {
      let out = new StringBuilder();
      addTreeShape(green, out);
      out.toString()
    }

    let addTreeShape(green: GreenElement, out: StringBuilder): Void {
      when (green) {
        is GreenNode -> do {
          out.append(green.kind.name);
          out.append("(");
          for (var i = 0; i < green.children.length; i += 1) { addTreeShape(green.children[i], out); }
          out.append(")");
        };
        is GreenToken -> do {
          out.append(green.kind.name);
          out.append("'");
          out.append(green.text);
          out.append("'");
        };
      }
    }

Whether `edited` is the tree parsing its text gives, as a message for
`assert`, or "" if it is.

    let reparseDiffers(edited: MarkdownDocument, parser: MarkdownParser): String {
      let made = treeShape(edited.node.green);
      let parsed = treeShape(parser.parseGreen(edited.asWritten));
      if (made == parsed) { "" } else { "${edited.asWritten}\n made ${made}\nparsed ${parsed}" }
    }

    let paragraphOf(text: String): MarkdownBuilder {
      let b = new MarkdownBuilder();
      b.paragraph(Inlines.empty.text(text));
      b
    }

The edited text, or what differs from parsing it.

    let editedWith(doc: MarkdownDocument, editor: MarkdownEditor, parser: MarkdownParser): String {
      let edited = editor.toDocument() orelse panic();
      let differs = reparseDiffers(edited, parser);
      if (differs == "") { edited.asWritten } else { "differs from its parse: ${differs}" }
    }

    let startsWithText(text: String, prefix: String): Boolean {
      var i = String.begin;
      var j = String.begin;
      while (prefix.hasIndex(j)) {
        if (!text.hasIndex(i) || text[i] != prefix[j]) { return false; }
        i = text.next(i);
        j = prefix.next(j);
      }
      true
    }

    let endsWithText(text: String, suffix: String): Boolean {
      var i = text.end;
      var j = suffix.end;
      while (j > String.begin) {
        if (i <= String.begin) { return false; }
        i = text.prev(i);
        j = suffix.prev(j);
        if (text[i] != suffix[j]) { return false; }
      }
      true
    }

    test("setContent and withContent write rich content in place") {
      let parser = MarkdownParser.gfm;
      let doc = parser.parse("# Old #\n\n> One\n> two\nlazy\n\n| a | b |\n|---|---|\n| c | d |\n");
      let rich = Inlines.empty.text("New ").emphasis(Inlines.empty.text("*x*")).text(" | ")
        .link(Inlines.empty.text("l"), new LinkTarget("/u v"));
      let heading = doc.headings[0].withContent(rich);
      assert(startsWithText(heading.asWritten, "# New *\\*x\\** | [l](</u v>) #\n")) { heading.asWritten };
      assert(reparseDiffers(heading, parser) == "") { reparseDiffers(heading, parser) };
      let quote = doc.children[2] as BlockQuote orelse panic();
      let paragraph = quote.children[0] as Paragraph orelse panic();
      let lines = paragraph.withContent(Inlines.empty.text("# a").lineBreak().strong(Inlines.empty.text("b")))
        orelse panic();
      let expected = "# Old #\n\n> \\# a\\\n> **b**\n\n| a | b |\n|---|---|\n| c | d |\n";
      assert(lines.asWritten == expected) { lines.asWritten };
      assert(reparseDiffers(lines, parser) == "") { reparseDiffers(lines, parser) };
      let plain = paragraph.withText("- not a list") orelse panic();
      assert(startsWithText(plain.asWritten, "# Old #\n\n> \\- not a list\n\n|")) { plain.asWritten };
      let cell = doc.tables[0].rows[0].cells[1].withContent(Inlines.empty.code("a|b").text(" c|d"));
      assert(endsWithText(cell.asWritten, "| c | `a\\|b` c\\|d |\n")) { cell.asWritten };
      assert(cell.tables[0].rows[0].cells[1].text == "a|b c|d") { cell.tables[0].rows[0].cells[1].text };
      assert(reparseDiffers(cell, parser) == "") { reparseDiffers(cell, parser) };
      let empty = do { paragraph.withContent(Inlines.empty); "accepted" } orelse "bubbled";
      assert(empty == "bubbled") { "a paragraph can't be empty" };
      let editor = doc.editor();
      editor.setContent(doc.headings[0], Inlines.empty.text("H")) orelse panic();
      editor.setText(paragraph, "P") orelse panic();
      editor.setContent(doc.tables[0].header.cells[0], Inlines.empty.strong(Inlines.empty.text("A"))) orelse panic();
      let all = editedWith(doc, editor, parser);
      assert(all == "# H #\n\n> P\n\n| **A** | b |\n|---|---|\n| c | d |\n") { all };
      let wrong = do { doc.editor().setContent(quote, Inlines.empty); "accepted" } orelse "bubbled";
      assert(wrong == "bubbled") { "a block quote has no content of its own" };
    }

    test("insertBefore, insertAfter, replace, and remove at the top level") {
      let parser = MarkdownParser.gfm;
      let text = "# Title\nIntro\n\n- a\n- b\n\n```\ncode\n```\nlast";
      let doc = parser.parse(text);
      let blocks = blocksOf(doc);
      let heading = blocks[0];
      let intro = blocks[1];
      let list = blocks[2];
      let code = blocks[3];
      let last = blocks[4];
      var editor = doc.editor();
      let note = new MarkdownBuilder();
      note.heading(2, Inlines.empty.text("Note")) orelse panic();
      note.paragraph(Inlines.empty.text("*Read* this."));
      editor.insertBefore(heading, note) orelse panic();
      editor.insertAfter(last, paragraphOf("The end")) orelse panic();
      var written = editedWith(doc, editor, parser);
      assert(written == "## Note\n\n\\*Read\\* this.\n\n${text}\n\nThe end\n") { written };
      editor = doc.editor();
      editor.insertAfter(heading, paragraphOf("Between")) orelse panic();
      editor.remove(code) orelse panic();
      written = editedWith(doc, editor, parser);
      assert(written == "# Title\n\nBetween\n\nIntro\n\n- a\n- b\n\nlast") { written };
      editor = doc.editor();
      let bullets = new MarkdownBuilder();
      bullets.bulletList([paragraphOf("c")]);
      editor.insertAfter(list, bullets) orelse panic();
      editor.replace(intro, bullets) orelse panic();
      written = editedWith(doc, editor, parser);
      assert(written == "# Title\n\n+ c\n\n- a\n- b\n\n+ c\n\n```\ncode\n```\nlast") { written };
      editor = doc.editor();
      editor.remove(heading) orelse panic();
      editor.remove(list) orelse panic();
      editor.remove(last) orelse panic();
      written = editedWith(doc, editor, parser);
      assert(written == "Intro\n\n```\ncode\n```\n") { written };
      assert(doc.asWritten == text) { "the old document is unchanged" };
    }

    test("block edits inside block quotes, list items, and footnote definitions") {
      let parser = MarkdownParser.gfm;
      let doc = parser.parse("> a\n> # H\nafter\n\n- one\n- two\n\n  more\n\n1.  > q\n\n[^n]: Note.\n\nRef[^n].\n");
      let blocks = blocksOf(doc);
      let quote = blocks[0] as BlockQuote orelse panic();
      let list = blocks[2] as ListBlock orelse panic();
      let ordered = blocks[3] as ListBlock orelse panic();
      let note = doc.footnoteDefinitions[0];
      let editor = doc.editor();
      editor.insertAfter(quote.children[1], paragraphOf("q2")) orelse panic();
      editor.insertBefore(list.items[0].children[0], paragraphOf("first")) orelse panic();
      editor.remove(list.items[1].children[2]) orelse panic();
      let inner = (ordered.items[0].children[0] as BlockQuote orelse panic()).children[0];
      let quoted = new MarkdownBuilder();
      quoted.codeBlock("", "x\n");
      editor.insertAfter(inner, quoted) orelse panic();
      editor.insertAfter(note.children[0], paragraphOf("More.")) orelse panic();
      let written = editedWith(doc, editor, parser);
      let expected = [
        "> a\n> # H\n>\n> q2\n>\nafter\n",
        "- first\n\n  one\n- two\n",
        "1.  > q\n    >\n    > ```\n    > x\n    > ```\n",
        "[^n]: Note.\n\n    More.\n",
        "Ref[^n].\n",
      ].join("\n") { (s: String): String => s };
      assert(written == expected) { written };
      let removeOnly = do {
        let e = doc.editor();
        e.remove(note.children[0]);
        e.toDocument();
        "accepted"
      } orelse "bubbled";
      assert(removeOnly == "bubbled") { "a footnote definition can't be left empty" };
      let lazy = doc.editor();
      lazy.remove(quote.children[1]) orelse panic();
      let lazyWritten = editedWith(doc, lazy, parser);
      assert(startsWithText(lazyWritten, "> a\n>\nafter\n")) { lazyWritten };
    }

    test("block edits that can't sit as asked bubble") {
      let parser = MarkdownParser.gfm;
      let doc = parser.parse("[x]\n\n[x]: /u\n\n- a\n\n# H\n\n- b\n\n```\nopen\n");
      let blocks = blocksOf(doc);
      let attempts = [
        "remove definition", "remove between lists", "after open fence", "list item", "blank line",
        "remove twice", "remove and edit", "inline",
      ];
      for (var i = 0; i < attempts.length; i += 1) {
        let result = do {
          let editor = doc.editor();
          when (i) {
            0 -> editor.remove(blocks[1]);
            1 -> editor.remove(blocks[3]);
            2 -> editor.insertAfter(blocks[5], paragraphOf("x"));
            3 -> editor.remove((blocks[2] as ListBlock orelse panic()).items[0]);
            4 -> editor.remove(doc.children[1]);
            5 -> do { editor.remove(blocks[0]); editor.remove(blocks[0]); };
            6 -> do { editor.remove(blocks[3]); editor.setLevel(blocks[3] as Heading orelse panic(), 2); };
            else -> editor.remove(doc.descendants[1]);
          }
          editor.toDocument();
          "accepted"
        } orelse "bubbled";
        assert(result == "bubbled") { attempts[i] };
      }
      let both = doc.editor();
      both.remove(blocks[0]) orelse panic();
      both.remove(blocks[1]) orelse panic();
      let written = editedWith(doc, both, parser);
      assert(written == "- a\n\n# H\n\n- b\n\n```\nopen\n") { "a definition can go with its links" };
    }

    test("a batch mixing edits of every kind") {
      let parser = MarkdownParser.gfm;
      let text = "# One\n\nSee [a](/a).\n\n> ## Two\n> Text\n\n| x |\n|---|\n| y |\n\nGone.\n";
      let doc = parser.parse(text);
      let editor = doc.editor();
      let headings = doc.headings;
      for (var i = 0; i < headings.length; i += 1) {
        editor.setLevel(headings[i], headings[i].level + 1) orelse panic();
      }
      editor.setDestination(doc.links[0], new LinkTarget("/b")) orelse panic();
      editor.setContent(doc.tables[0].rows[0].cells[0], Inlines.empty.emphasis(Inlines.empty.text("z"))) orelse panic();
      let quote = blocksOf(doc)[2] as BlockQuote orelse panic();
      editor.setText(quote.children[1], "Changed") orelse panic();
      editor.insertBefore(quote.children[1], paragraphOf("Added")) orelse panic();
      let rule = new MarkdownBuilder();
      rule.thematicBreak();
      editor.insertAfter(blocksOf(doc)[1], rule) orelse panic();
      editor.remove(blocksOf(doc)[4]) orelse panic();
      assert(editor.length == 8) { editor.length.toString() };
      let written = editedWith(doc, editor, parser);
      let expected = "## One\n\nSee [a](/b).\n\n***\n\n> ### Two\n>\n> Added\n>\n> Changed\n\n| x |\n|---|\n| *z* |\n";
      assert(written == expected) { written };
    }

Random block edits in one container of sample documents: what's
outside the container stays byte for byte, the blocks kept stay as
written and in order, among as many new ones as were built, and the
tree is what parsing its text gives. Some edits bubble, as they should
(two at one block, an empty container, a task's first block). The
documents come from a function, since Temper's Rust backend leaves
test-only module values out of tests (2026-10-30).

    let fuzzDocuments(): List<String> { [
      "# T\nIntro\n\n- a\n- b\n\n  more\n\n> q\n> # h\nlazy?\n\n```\nc\n```\n\n    ind\n\nlast",
      "> a\n>\n> - x\n>   - y\n>\n> b\n\n1. one\n2. two\n   > nested\n\n***\n[d]: /u\n\n[^n]: Note.\n\n    more\n\nRef[^n] [d].\n",
      "- a\n- b\n\n+ c\n\npara\n# H\nnext\n<div>\nhtml\n</div>\n\n| a | b |\n|---|---|\n| c | d |\n\n",
      " - a\n   - b\n\n     c\n> > deep\n> > more\n\ntext\n===\n\n- [ ] task\n- [x] done\n\n\n",
    ] }

    let randomBlocks(random: Random): MarkdownBuilder {
      let b = new MarkdownBuilder();
      let n = random.below(4);
      for (var i = 0; i < n; i += 1) {
        let kind = random.below(7);
        let texts = ["x", "- y", "a\nb", "*z*", "1. q", "  lead", "> no"];
        if (kind == 0) {
          b.paragraph(Inlines.empty.text(texts[random.below(texts.length)]));
        } else if (kind == 1) {
          b.heading(1 + random.below(6), Inlines.empty.text("h")) orelse panic();
        } else if (kind == 2) {
          b.codeBlock("py", "x\n");
        } else if (kind == 3) {
          b.thematicBreak();
        } else if (kind == 4) {
          b.blockQuote(paragraphOf("q"));
        } else if (kind == 5) {
          b.bulletList([paragraphOf("i"), randomBlocks(random)]);
        } else {
          b.orderedList(random.below(3), [paragraphOf("o")]) orelse panic();
        }
      }
      b
    }

    let blocksOf(view: MarkdownNode): List<BlockChild> {
      let none: List<BlockChild> = [];
      let all = when (view) {
        is MarkdownDocument -> view.children;
        is BlockQuote -> view.children;
        is ListItem -> view.children;
        is FootnoteDefinition -> view.children;
        else -> none;
      };
      all.filter { (block: BlockChild): Boolean => !(block is BlankLine) }
    }

The code points of `text` from `start` to `end` (or its end, for -1).

    let codePointsOf(text: String, start: Int, end: Int): String {
      var i = String.begin;
      var n = 0;
      while (n < start && text.hasIndex(i)) {
        i = text.next(i);
        n += 1;
      }
      var j = i;
      while ((end < 0 || n < end) && text.hasIndex(j)) {
        j = text.next(j);
        n += 1;
      }
      text.slice(i, j)
    }

    test("random block edits keep the rest as written") {
      let random = new Random(7);
      var made = 0;
      for (var round = 0; round < 300; round += 1) {
        let documents = fuzzDocuments();
        let text = documents[random.below(documents.length)];
        let parser = MarkdownParser.gfm;
        let doc = parser.parse(text);
        let containers = new ListBuilder<MarkdownNode>();
        containers.add(doc);
        let all = doc.descendants;
        for (var i = 0; i < all.length; i += 1) {
          let view = all[i];
          if (view is BlockQuote || view is ListItem || view is FootnoteDefinition) { containers.add(view); }
        }
        let container = containers[random.below(containers.length)];
        let blocks = blocksOf(container);
        let gone = new ListBuilder<Int>();
        var added = 0;
        let editor = doc.editor();
        let ops = 1 + random.below(3);
        for (var k = 0; k < ops; k += 1) {
          let at = random.below(blocks.length);
          let block = blocks[at];
          let content = randomBlocks(random);
          let op = random.below(4);
          if (op == 0) {
            editor.insertBefore(block, content) orelse panic();
          } else if (op == 1) {
            editor.insertAfter(block, content) orelse panic();
          } else if (op == 2) {
            editor.replace(block, content) orelse panic();
            gone.add(at);
          } else {
            editor.remove(block) orelse panic();
            gone.add(at);
          }
          if (op != 3) { added += content.blocks.length; }
        }
        let maybe: MarkdownDocument? = editor.toDocument() orelse null;
        if (maybe == null) { continue; }
        let edited = maybe as MarkdownDocument orelse panic();
        made += 1;
        let differs = reparseDiffers(edited, parser);
        assert(differs == "") { differs };
        let written = edited.asWritten;
        let span = container.span;
        let before = codePointsOf(text, 0, span.start);
        let after = codePointsOf(text, span.end, -1);
        assert(startsWithText(written, before) && endsWithText(written, after)) { "${text}\n=> ${written}" };
        var node = edited.node;
        let path = new ListBuilder<Int>();
        var up = container.node;
        while (up.parent != null) {
          path.add(up.index);
          up = up.parent as RedNode orelse panic();
        }
        for (var i = path.length - 1; i >= 0; i -= 1) {
          node = new RedNode(node.green.children[path[i]] as GreenNode orelse panic(), node, 0, path[i]);
        }
        let now = blocksOf(if (path.isEmpty) { edited } else { holderViewOf(node) });
        let kept = new ListBuilder<String>();
        for (var i = 0; i < blocks.length; i += 1) {
          var removed = false;
          for (var g = 0; g < gone.length; g += 1) { if (gone[g] == i) { removed = true; } }
          if (!removed) { kept.add(blocks[i].asWritten); }
        }
        assert(now.length == kept.length + added) { "${text}\n=> ${written}" };
        var next = 0;
        for (var i = 0; i < now.length && next < kept.length; i += 1) {
          if (now[i].asWritten == kept[next]) { next += 1; }
        }
        assert(next == kept.length) { "kept blocks in order: ${text}\n=> ${written}" };
      }
      assert(made > 150) { made.toString() };
    }
