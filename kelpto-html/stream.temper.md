# Parsing in pieces

A fragment parse fed a piece at a time, for HTML that's put together
from parts, as the `kelpto` library renders Markdown with raw HTML in
it: synthetic tokens for what the caller makes (`startTag`, `endTag`,
and `characters`), and HTML text it has as written (`write`), tokenized in
the state the last piece left, with the last start tag carried over.
One tree builder takes them all, so the tree is what parsing the whole
HTML at once gives, and each node points back at its origin: a token
of a piece, or whatever red node the caller gave for it.

```temper inert
let stream = new FragmentStream(new FragmentContext("body"));
stream.write("<b class=x>", pieceNode);   // tokenized
stream.characters("a < b", textNode);           // read as the text "a < b"
stream.endTag("b", endNode);
stream.end();
stream.html;                              // "<b class=\"x\">a &lt; b</b>"
```

**When a piece leaves the tokenizer inside something** (raw text,
RCDATA, PLAINTEXT, script data, a comment, or a tag cut off at the
piece's end), what follows can't be synthetic tokens: a `<textarea>`
reads the `<p>` after it as text. So from there on the stream keeps
the HTML text of everything it's given (synthetic tokens written as
`<name>`, `</name>`, and escaped text, as the caller would write them)
and tokenizes it all at the end, from the start of what the piece left
open, each token pointing at the origin of the piece it starts in.
That's rare in real documents, but it's exactly what a sanitizer must
not miss.

A piece's tokens point at the tokens of `origin`, when it's an
`HtmlTokens` node holding the same tokens (as kelpto puts them in the
Markdown tree); if the piece reads otherwise here (in SVG, say, where
`<title>` isn't RCDATA), they point at `origin` itself.

    export class FragmentStream {
      public context: FragmentContext;
      private builder: TreeBuilder;
      private sink: StreamSink;

Whether the stream keeps text to tokenize at the end, from
`carryState`, rather than taking tokens as they come.

      private var carrying: Boolean = false;
      private var carryState: Int = 0;
      private carried: StringBuilder = new StringBuilder();
      private var carriedWidth: Int = 0;

Whether the last text or piece taken ended in `\r`, so a `\n` next
makes one line break, as `\r\n` in the input does.

      private var afterCr: Boolean = false;
      private var ended: Boolean = false;

As in a context element, with scripting on unless `scripting` is
false (see `HtmlParser`).

      public constructor(context: FragmentContext, scripting: Boolean = true) {
        let builder = new TreeBuilder(scripting);
        builder.tree.joined = true;
        let state = builder.startFragment(context);
        this.context = context;
        this.builder = builder;
        this.sink = new StreamSink(builder);
        if (state != 0) {
          carrying = true;
          carryState = state;
        }
      }

A start tag without attributes, written `<name>`, or `<name />` if
`selfClosing`. For one with attributes, `write` the tag.

      public startTag(name: String, selfClosing: Boolean, origin: RedNode): Void {
        afterCr = false;
        if (carrying) {
          carry(if (selfClosing) { "<${name} />" } else { "<${name}>" }, origin);
          return;
        }
        let state = builder.takeStart(name, selfClosing, sink.addOrigin(origin));
        if (state != 0) {
          carrying = true;
          carryState = state;
          sink.lastStartTag = name;
        }
      }

      public endTag(name: String, origin: RedNode): Void {
        afterCr = false;
        if (carrying) {
          carry("</${name}>", origin);
        } else {
          builder.takeEnd(name, sink.addOrigin(origin));
        }
      }

Text, as it reads, not escaped: `a < b` is three characters and two
spaces. Written escaped (`&lt;`) where it has to be read as HTML.

      public characters(text: String, origin: RedNode): Void {
        if (text.isEmpty) { return; }
        let wasAfterCr = afterCr;
        afterCr = text[text.prev(text.end)] == char'\r';
        if (carrying) {
          carry(escapeHtml(text), origin);
          return;
        }
        var decoded = text;
        if (wasAfterCr && text[String.begin] == char'\n') {
          decoded = text.slice(text.next(String.begin), text.end);
        }
        builder.takeText(normalizedLineEndings(decoded), sink.addOrigin(origin));
      }

HTML as written, tokenized from where the last piece left off.

      public write(html: String, origin: RedNode): Void {
        if (html.isEmpty) { return; }
        afterCr = html[html.prev(html.end)] == char'\r';
        if (carrying) {
          carry(html, origin);
          return;
        }
        sink.startPiece(html, origin);
        let machine = new Tokenizer(html, sink.lastStartTag, true, sink);
        machine.run(0);
        if (sink.carryFrom >= 0) {
          carrying = true;
          carryState = sink.carryState;
          carry(html.slice(html.step(String.begin, sink.carryFrom), html.end), origin);
        }
      }

      private carry(html: String, origin: RedNode): Void {
        sink.segmentStarts.add(carriedWidth);
        sink.segmentOrigins.add(origin);
        carried.append(html);
        carriedWidth += html.countBetween(String.begin, html.end);
      }

The end of the input: tokenizes what's kept, if anything, and
finishes the tree. Read the tree after this.

      public end(): Void {
        if (ended) { return; }
        ended = true;
        if (carrying) {
          sink.holding = false;
          let machine = new Tokenizer(carried.toString(), sink.lastStartTag, true, sink);
          machine.run(carryState);
        } else {
          builder.end();
        }
      }

The nodes built, as `HtmlFragment.children`, each with its `origin`.

      public get children(): List<BuiltNode> {
        childrenOf(builder.tree, noTokens, builder.tree.fragmentRoot)
      }

The nodes serialized, as `HtmlFragment.html`.

      public get html(): String {
        let out = new StringBuilder();
        serializeChildren(builder.tree, builder.tree.fragmentRoot, out);
        out.toString()
      }

The nodes sanitized by `policy` for the context (see `sanitizeHtml`).
The tree judged is the one built, so pieces that only do harm
together (a `<b title="` in one, `">` in the next) are judged as the
browser joins them.

      public sanitize(policy: SanitizerPolicy = SanitizerPolicy.standard): SafeHtml {
        sanitizeTree(builder.tree, null, builder.tree.fragmentRoot, context, policy)
      }
    }

    let noTokens: HtmlTokens = tokenizeHtml("");

Line endings as the input stream reads them: `\r\n` and `\r` as `\n`.

    let normalizedLineEndings(text: String): String {
      var i = String.begin;
      while (text.hasIndex(i) && text[i] != char'\r') { i = text.next(i); }
      if (!text.hasIndex(i)) { return text; }
      let out = new StringBuilder();
      var runStart = String.begin;
      while (text.hasIndex(i)) {
        let next = text.next(i);
        if (text[i] == char'\r') {
          out.append(text.slice(runStart, i));
          out.append("\n");
          runStart = if (text.hasIndex(next) && text[next] == char'\n') { text.next(next) } else { next };
        }
        i = next;
      }
      out.append(text.slice(runStart, text.end));
      out.toString()
    }

## Taking a piece's tokens

Between the tokenizer and tree construction: each token gets an
origin, and, while pieces come one at a time, the last token of a
piece waits until the piece ends (start tags excepted, since the
tokenizer needs the state after them at once), in case the piece
leaves it unfinished: a tag, comment, DOCTYPE, or CDATA section cut
off, or text in raw text, RCDATA, script data, or PLAINTEXT. Then
it isn't taken, and the stream keeps the piece's text from there.

    class StreamSink extends TokenSink {
      private builder: TreeBuilder;
      private origins: ListBuilder<RedNode>;
      public var holding: Boolean = true;

The state the tokenizer is in after what's taken, the last start tag
that switched it, and, when a piece ends unfinished, where in it (in
code points) the text not taken starts, and the state there.

      public var state: Int = 0;
      public var lastStartTag: String = "";
      public var carryFrom: Int = -1;
      public var carryState: Int = 0;

The piece: its text, its origin, and the tokens to point at, while
they match.

      private var piece: String = "";
      private var origin: RedNode? = null;
      private var matching: Boolean = false;
      private var held: GreenNode? = null;
      private var heldOffset: Int = 0;
      private var heldIndex: Int = 0;

Once the stream keeps text, where each part of it starts, and its
origin.

      public segmentStarts: ListBuilder<Int> = new ListBuilder<Int>();
      public segmentOrigins: ListBuilder<RedNode> = new ListBuilder<RedNode>();
      private var segment: Int = 0;

      public constructor(builder: TreeBuilder) {
        this.builder = builder;
        this.origins = builder.tree.origins;
      }

      public addOrigin(red: RedNode): Int {
        let index = origins.length;
        origins.add(red);
        index
      }

      public startPiece(text: String, red: RedNode): Void {
        piece = text;
        origin = red;
        matching = red.hasKind(htmlTokensKind);
        carryFrom = -1;
      }

      public take(green: GreenNode, offset: Int, index: Int): Int {
        if (!holding) { return forward(green, offset, index); }
        flush();
        if (green.kind.id == startTagKind.id) { return forward(green, offset, index); }
        held = green;
        heldOffset = offset;
        heldIndex = index;
        0
      }

Whether CDATA is allowed depends on what came before, so anything
held is taken first.

      public cdataAllowed(): Boolean {
        flush();
        builder.cdataAllowed()
      }

      public end(): Void {
        if (!holding) {
          builder.end();
          return;
        }
        let last = held;
        held = null;
        if (last == null) {
          if (state != 0) {
            carryFrom = piece.countBetween(String.begin, piece.end);
            carryState = state;
          }
          // A second statement, so C# keeps the braces (dangling `else`;
          // see notes/temper-fixes.md).
          return;
        }
        let token = last as GreenNode orelse panic();
        if (state == 0 && !unfinished(token)) {
          forward(token, heldOffset, heldIndex);
        } else {
          carryFrom = heldOffset;
          carryState = state;
        }
      }

      private flush(): Void {
        let last = held;
        if (last != null) {
          held = null;
          forward(last, heldOffset, heldIndex);
        }
      }

      private forward(green: GreenNode, offset: Int, index: Int): Int {
        let next = builder.take(green, offset, addOrigin(originFor(green, offset, index)));
        let id = green.kind.id;
        if (id == startTagKind.id) {
          state = next;
          if (next != 0) { lastStartTag = new StartTag(new RedNode(green, null, 0, 0)).name; }
        } else if (id != htmlTextKind.id) {
          state = 0;
        }
        next
      }

      private originFor(green: GreenNode, offset: Int, index: Int): RedNode {
        if (!holding) {
          while (segment + 1 < segmentStarts.length && segmentStarts[segment + 1] <= offset) {
            segment += 1;
          }
          return segmentOrigins[segment];
        }
        let red = origin as RedNode orelse panic();
        if (matching) {
          let kids = red.green.children;
          if (index < kids.length) {
            let kid = kids[index];
            if (kid is GreenNode) {
              if (kid.kind.id == green.kind.id && kid.width == green.width) {
                return new RedNode(kid, red, red.offset + offset, index);
              }
            }
          }
          matching = false;
        }
        red
      }

A piece's last token, cut off by the piece's end: a tag or processing
instruction (dropped), a comment or DOCTYPE without its `>`, a CDATA
section without its `]]>`, or `<` or `</` at the very end, which
what follows might make a tag.

      private unfinished(green: GreenNode): Boolean {
        let id = green.kind.id;
        let kids = green.children;
        let last = if (kids.isEmpty) { -1 } else { kids[kids.length - 1].kind.id };
        if (id == droppedTagKind.id) { return true; }
        if (id == commentKind.id) { return last != commentCloseKind.id; }
        if (id == doctypeKind.id || id == quirksDoctypeKind.id) { return last != tagCloseKind.id; }
        var inCdata = false;
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i].kind.id;
          if (kid == cdataOpenKind.id) { inCdata = true; }
          if (kid == cdataCloseKind.id) { inCdata = false; }
        }
        if (inCdata) { return true; }
        let before = piece.prev(piece.end);
        if (piece[before] == char'<') { return true; }
        piece[before] == char'/' && before > String.begin && piece[piece.prev(before)] == char'<'
      }
    }

## Tests

    let joinedHtml(pieces: List<String>, context: FragmentContext): String {
      let stream = new FragmentStream(context);
      let origin = tokenizeHtml("").node;
      for (var i = 0; i < pieces.length; i += 1) {
        let piece = pieces[i];
        if (i % 2 == 0) { stream.write(piece, origin); } else { stream.characters(piece, origin); }
      }
      stream.end();
      stream.html
    }

    let wholeHtml(pieces: List<String>, context: FragmentContext): String {
      let out = new StringBuilder();
      for (var i = 0; i < pieces.length; i += 1) {
        out.append(if (i % 2 == 0) { pieces[i] } else { escapeHtml(pieces[i]) });
      }
      parseHtmlFragment(out.toString(), context).html
    }

    test("a fragment fed in pieces, pointing back at them") {
      let piece = tokenizeHtml("<p><b class=x>a");
      let stream = new FragmentStream(new FragmentContext("body"));
      stream.write("<p><b class=x>a", piece.node);
      stream.characters("1 < 2\r", piece.node);
      stream.characters("\n", piece.node);
      stream.startTag("p", false, piece.node);
      stream.characters("c", piece.node);
      stream.endTag("b", piece.node);
      stream.end();
      let html = stream.html;
      assert(html == "<p><b class=\"x\">a1 &lt; 2\n</b></p><p><b class=\"x\">c</b></p>") { html };
      let p = stream.children[0] as Element orelse panic();
      let b = p.children[0] as Element orelse panic();
      let tag = b.startTag as StartTag orelse panic();
      let tokens = tag.node.parent as RedNode orelse panic();
      assert(tag.asWritten == "<b class=x>" && tokens.hasKind(htmlTokensKind) && tag.span.toString() == "3+11") {
        "the piece's token"
      };
      let remade = (stream.children[1] as Element orelse panic()).children[0] as Element orelse panic();
      assert(remade.startTag?.asWritten == "<b class=x>") { "remade, sharing its start tag" };
    }

    test("pieces left inside raw text, RCDATA, comments, and tags") {
      let body = new FragmentContext("body");
      let cases = [
        ["<textarea>a", "<p>x</p>", "</textarea", "<", ">b"],
        ["<script>a", "<!", "-- </script> --", "&", "></script>c"],
        ["<!-- a", "-->b", "-->", "c", ""],
        ["<b class=\"", "x\"", "\">y<plaintext>", "</plaintext>", "z"],
        ["a <", "b>", "", "", "</"],
        ["<svg><title><b>", "t", "</title><![CDATA[x", "]]>", "y]]><title>&amp;"],
      ];
      for (var i = 0; i < cases.length; i += 1) {
        let joined = joinedHtml(cases[i], body);
        let whole = wholeHtml(cases[i], body);
        assert(joined == whole) { "${i.toString()}: ${joined} != ${whole}" };
      }
      let rcdata = joinedHtml(["a", "<b>"], new FragmentContext("textarea"));
      assert(rcdata == "a&lt;b&gt;") { rcdata };
    }
