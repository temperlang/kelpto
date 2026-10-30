# Tokenizing

Splits HTML into start tags (with attributes), end tags, comments, and
text, as a green tree that keeps every code point, so `asWritten` gives
the input back exactly, for any input. What it doesn't understand stays
text.

    let {
      GreenNode, GreenNodeBuilder, Kind, RedNode, SourceText, isAsciiAlpha,
      isAsciiWhitespace, redRoot, unknownKind,
    } = import("../kelpto-core");

```temper inert
let tokens = tokenizeHtml("<p class=note>Hi <!-- c --></p>");
let p = tokens.startTags[0];
p.name;                               // "p"
p.attributes[0].value;                // "note"
p.attributes[0].withValue("tip").asWritten; // "<p class=\"tip\">Hi <!-- c --></p>"
```

## What it understands so far

The as-written view of HTML, after the WHATWG tokenizer's rules, but
much simpler:

- **Start tags** with attributes, quoted, unquoted, or bare, and `/>`.
- **End tags,** a name and optional whitespace.
- **Comments,** `<!-- … -->`, including `<!-->` and `<!--->`, and one
  left open runs to the end, as browsers read it.
- **Text,** everything else, character references left as written.

Not yet, so these stay text: DOCTYPEs, bogus comments (`<!x>`, `</ x>`),
CDATA, end tags with attributes, tags cut off by the end of the input
(browsers drop those), and the raw text of `<script>`, `<style>`, and
`<textarea>`. The WHATWG tree construction (implied and misnested
elements, the element tree a browser builds) comes later, as a second
view over the same parse.

## Kinds

    export let htmlTokensKind = new Kind(200, "HtmlTokens");
    export let startTagKind = new Kind(201, "HtmlStartTag");
    export let endTagKind = new Kind(202, "HtmlEndTag");
    export let commentKind = new Kind(203, "HtmlComment");
    export let htmlTextKind = new Kind(204, "HtmlText");
    export let attributeKind = new Kind(205, "HtmlAttribute");

    export let tagOpenKind = new Kind(210, "TagOpen");
    export let tagNameKind = new Kind(211, "TagName");
    export let htmlWhitespaceKind = new Kind(212, "HtmlWhitespace");
    export let attributeNameKind = new Kind(213, "AttributeName");
    export let equalsKind = new Kind(214, "Equals");
    export let attributeValueKind = new Kind(215, "AttributeValue");
    export let selfClosingKind = new Kind(216, "SelfClosing");
    export let tagCloseKind = new Kind(217, "TagClose");
    export let commentOpenKind = new Kind(218, "CommentOpen");
    export let commentTextKind = new Kind(219, "CommentText");
    export let commentCloseKind = new Kind(220, "CommentClose");
    export let charsKind = new Kind(221, "Chars");

## The entry points

Tokenizes `text`. Never fails: any text is some HTML.

    export let tokenizeHtml(text: String): HtmlTokens {
      new HtmlTokens(redRoot(tokenizeHtmlGreen(text)))
    }

The green tree alone, for embedding in another tree, as the `kelpto`
library does for raw HTML in Markdown.

    export let tokenizeHtmlGreen(text: String): GreenNode {
      let source = new SourceText(text);
      let builder = new GreenNodeBuilder();
      builder.startNode(htmlTokensKind);
      var textStart = 0;
      var i = 0;
      while (i < source.length) {
        let markup = if (source.codeAt(i) == char'<') { markupAt(source, i) } else { null };
        if (markup == null) {
          i += 1;
        } else {
          addText(builder, source, textStart, i);
          builder.element(markup);
          i += markup.width;
          textStart = i;
        }
      }
      addText(builder, source, textStart, source.length);
      builder.finishNode();
      builder.finish()
    }

    let addText(builder: GreenNodeBuilder, source: SourceText, start: Int, end: Int): Void {
      if (start < end) {
        builder.startNode(htmlTextKind);
        builder.token(charsKind, source.slice(start, end));
        builder.finishNode();
      }
    }

## Markup

Each scanner builds its node apart, and gives null if the markup at
`at` isn't one it understands, so it stays text.

    let markupAt(source: SourceText, at: Int): GreenNode? {
      let next = source.codeAt(at + 1);
      if (isAsciiAlpha(next)) {
        startTagAt(source, at)
      } else if (next == char'/') {
        endTagAt(source, at)
      } else if (next == char'!') {
        commentAt(source, at)
      } else {
        null
      }
    }

    let tokenOf(builder: GreenNodeBuilder, kind: Kind, source: SourceText, start: Int, end: Int): Void {
      if (start < end) {
        builder.token(kind, source.slice(start, end));
      }
    }

    let skipWhitespace(source: SourceText, from: Int): Int {
      var i = from;
      while (isAsciiWhitespace(source.codeAt(i))) {
        i += 1;
      }
      i
    }

A tag name runs to whitespace, `/`, or `>`, as browsers read it.

    let nameEnd(source: SourceText, from: Int): Int {
      var i = from;
      while (i < source.length) {
        let c = source.codeAt(i);
        if (isAsciiWhitespace(c) || c == char'/' || c == char'>') { break; }
        i += 1;
      }
      i
    }

    let startTagAt(source: SourceText, at: Int): GreenNode? {
      let builder = new GreenNodeBuilder();
      builder.startNode(startTagKind);
      let nameStop = nameEnd(source, at + 1);
      tokenOf(builder, tagOpenKind, source, at, at + 1);
      tokenOf(builder, tagNameKind, source, at + 1, nameStop);
      var i = nameStop;
      while (true) {
        let next = skipWhitespace(source, i);
        tokenOf(builder, htmlWhitespaceKind, source, i, next);
        i = next;
        let c = source.codeAt(i);
        if (c == -1) {
          return null;
        } else if (c == char'>') {
          tokenOf(builder, tagCloseKind, source, i, i + 1);
          break;
        } else if (c == char'/' && source.codeAt(i + 1) == char'>') {
          tokenOf(builder, selfClosingKind, source, i, i + 1);
          tokenOf(builder, tagCloseKind, source, i + 1, i + 2);
          break;
        } else if (c == char'/') {

A stray `/` inside a tag: browsers skip it.

          tokenOf(builder, unknownKind, source, i, i + 1);
          i += 1;
        } else {
          i = attributeAt(builder, source, i);
          if (i < 0) { return null; }
        }
      }
      builder.finishNode();
      builder.finish()
    }

An attribute: a name, then optionally `=` and a value. Gives where it
ends, or -1 if the input ends inside a quoted value.

    let attributeAt(builder: GreenNodeBuilder, source: SourceText, at: Int): Int {
      builder.startNode(attributeKind);

A name may start with `=`, and then runs to whitespace, `/`, `>`, or
`=`.

      var i = at + 1;
      while (i < source.length) {
        let c = source.codeAt(i);
        if (isAsciiWhitespace(c) || c == char'/' || c == char'>' || c == char'=') { break; }
        i += 1;
      }
      tokenOf(builder, attributeNameKind, source, at, i);
      let equals = skipWhitespace(source, i);
      if (source.codeAt(equals) == char'=') {
        tokenOf(builder, htmlWhitespaceKind, source, i, equals);
        tokenOf(builder, equalsKind, source, equals, equals + 1);
        let valueStart = skipWhitespace(source, equals + 1);
        tokenOf(builder, htmlWhitespaceKind, source, equals + 1, valueStart);
        let quote = source.codeAt(valueStart);
        var valueEnd = valueStart;
        if (quote == char'"' || quote == char'\'') {
          valueEnd = valueStart + 1;
          while (valueEnd < source.length && source.codeAt(valueEnd) != quote) {
            valueEnd += 1;
          }
          if (valueEnd >= source.length) { return -1; }
          valueEnd += 1;
        } else {
          while (valueEnd < source.length) {
            let c = source.codeAt(valueEnd);
            if (isAsciiWhitespace(c) || c == char'>') { break; }
            valueEnd += 1;
          }
        }
        tokenOf(builder, attributeValueKind, source, valueStart, valueEnd);
        i = valueEnd;
      }
      builder.finishNode();
      i
    }

An end tag: `</`, a name, optional whitespace, and `>`.

    let endTagAt(source: SourceText, at: Int): GreenNode? {
      if (!isAsciiAlpha(source.codeAt(at + 2))) { return null; }
      let nameStop = nameEnd(source, at + 2);
      let close = skipWhitespace(source, nameStop);
      if (source.codeAt(close) != char'>') { return null; }
      let builder = new GreenNodeBuilder();
      builder.startNode(endTagKind);
      tokenOf(builder, tagOpenKind, source, at, at + 2);
      tokenOf(builder, tagNameKind, source, at + 2, nameStop);
      tokenOf(builder, htmlWhitespaceKind, source, nameStop, close);
      tokenOf(builder, tagCloseKind, source, close, close + 1);
      builder.finishNode();
      builder.finish()
    }

A comment, `<!--` to `-->`, or to the end of the input.

    let commentAt(source: SourceText, at: Int): GreenNode? {
      if (
        source.codeAt(at + 2) != char'-' || source.codeAt(at + 3) != char'-'
      ) {
        return null;
      }
      let textStart = at + 4;
      var textEnd = source.length;
      var closeEnd = source.length;
      if (source.codeAt(textStart) == char'>') {
        textEnd = textStart;
        closeEnd = textStart + 1;
      } else if (source.codeAt(textStart) == char'-' && source.codeAt(textStart + 1) == char'>') {
        textEnd = textStart;
        closeEnd = textStart + 2;
      } else {
        for (var i = textStart; i + 2 < source.length; i += 1) {
          if (
            source.codeAt(i) == char'-' && source.codeAt(i + 1) == char'-' &&
            source.codeAt(i + 2) == char'>'
          ) {
            textEnd = i;
            closeEnd = i + 3;
            break;
          }
        }
      }
      let builder = new GreenNodeBuilder();
      builder.startNode(commentKind);
      tokenOf(builder, commentOpenKind, source, at, textStart);
      tokenOf(builder, commentTextKind, source, textStart, textEnd);
      tokenOf(builder, commentCloseKind, source, textEnd, closeEnd);
      builder.finishNode();
      builder.finish()
    }

## Tests

    let roundtripCases(): List<String> {
      [
        "", "plain text", "<p>Hi</p>", "<P CLASS=a ID='b' data-x=\"c\" hidden>",
        "<br/><br /><img src=x />", "<a href=\"unclosed", "<a href='x'", "<a",
        "< p>", "<1>", "</ p>", "</>", "</b foo>", "</b\n>", "<!-- c -->", "<!-->",
        "<!--->", "<!-- open", "<!x>", "<!DOCTYPE html>", "a < b && c > d",
        "<p =x a=b=c / c>", "<script>if (a<b) {}</script>", "&amp; &bogus; &#x26;",
        "é😀\u{0}<b>\r\n</b>",
      ]
    }

    test("roundtrip: asWritten gives the input back") {
      let cases = roundtripCases();
      for (var i = 0; i < cases.length; i += 1) {
        let text = cases[i];
        let written = tokenizeHtml(text).asWritten;
        assert(written == text) { "${i.toString()}: ${written}" };
      }
    }

    let kindsOf(text: String): String {
      let children = tokenizeHtml(text).node.childNodes;
      children.join(" ") { (child: RedNode): String => child.kind.name }
    }

    test("what's understood, and what stays text") {
      let cases = [
        "<p>Hi</p>", "HtmlStartTag HtmlText HtmlEndTag",
        "<a href='x'", "HtmlText",
        "< p></ p>", "HtmlText",
        "a<!-- c -->b<!-- open", "HtmlText HtmlComment HtmlText HtmlComment",
        "<br/>x", "HtmlStartTag HtmlText",
      ];
      for (var i = 0; i < cases.length; i += 2) {
        let kinds = kindsOf(cases[i]);
        assert(kinds == cases[i + 1]) { "${cases[i]}: ${kinds}" };
      }
    }
