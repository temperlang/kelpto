# Tokenizing

Splits HTML into start tags (with attributes), end tags, comments, and
text, as a green tree that keeps every code point, so `asWritten` gives
the input back exactly, for any input. What it doesn't understand stays
text.

    let {
      GreenNode, GreenNodeBuilder, Kind, RedNode, isAsciiAlpha,
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
      let builder = new GreenNodeBuilder();
      builder.startNode(htmlTokensKind);
      let end = text.end;
      var textStart = String.begin;
      var i = String.begin;
      while (i < end) {
        let markup = if (text[i] == char'<') { markupAt(text, i) } else { null };
        if (markup == null) {
          i = text.next(i);
        } else {
          addText(builder, text, textStart, i);
          builder.element(markup);
          i = text.step(i, markup.width);
          textStart = i;
        }
      }
      addText(builder, text, textStart, end);
      builder.finishNode();
      builder.finish()
    }

    let addText(builder: GreenNodeBuilder, text: String, start: StringIndex, end: StringIndex): Void {
      if (start < end) {
        builder.startNode(htmlTextKind);
        builder.token(charsKind, text.slice(start, end));
        builder.finishNode();
      }
    }

## Markup

Each scanner reads `text` by `StringIndex`, builds its node apart, and
gives null if the markup at `at` isn't one it understands, so it stays
text.

    let markupAt(text: String, at: StringIndex): GreenNode? {
      let next = codeAt(text, text.next(at));
      if (isAsciiAlpha(next)) {
        startTagAt(text, at)
      } else if (next == char'/') {
        endTagAt(text, at)
      } else if (next == char'!') {
        commentAt(text, at)
      } else {
        null
      }
    }

The code point at `at`, or -1 at the end.

    let codeAt(text: String, at: StringIndex): Int {
      if (text.hasIndex(at)) { text[at] } else { -1 }
    }

    let tokenOf(builder: GreenNodeBuilder, kind: Kind, text: String, start: StringIndex, end: StringIndex): Void {
      if (start < end) {
        builder.token(kind, text.slice(start, end));
      }
    }

    let skipWhitespace(text: String, from: StringIndex): StringIndex {
      var i = from;
      while (isAsciiWhitespace(codeAt(text, i))) {
        i = text.next(i);
      }
      i
    }

A tag name runs to whitespace, `/`, or `>`, as browsers read it.

    let nameEnd(text: String, from: StringIndex): StringIndex {
      var i = from;
      while (text.hasIndex(i)) {
        let c = text[i];
        if (isAsciiWhitespace(c) || c == char'/' || c == char'>') { break; }
        i = text.next(i);
      }
      i
    }

    let startTagAt(text: String, at: StringIndex): GreenNode? {
      let builder = new GreenNodeBuilder();
      builder.startNode(startTagKind);
      let nameStart = text.next(at);
      let nameStop = nameEnd(text, nameStart);
      tokenOf(builder, tagOpenKind, text, at, nameStart);
      tokenOf(builder, tagNameKind, text, nameStart, nameStop);
      var i = nameStop;
      while (true) {
        let next = skipWhitespace(text, i);
        tokenOf(builder, htmlWhitespaceKind, text, i, next);
        i = next;
        let c = codeAt(text, i);
        let after = text.next(i);
        if (c == -1) {
          return null;
        } else if (c == char'>') {
          tokenOf(builder, tagCloseKind, text, i, after);
          break;
        } else if (c == char'/' && codeAt(text, after) == char'>') {
          tokenOf(builder, selfClosingKind, text, i, after);
          tokenOf(builder, tagCloseKind, text, after, text.next(after));
          break;
        } else if (c == char'/') {

A stray `/` inside a tag: browsers skip it.

          tokenOf(builder, unknownKind, text, i, after);
          i = after;
        } else {
          let attributeEnd = attributeAt(builder, text, i);
          if (attributeEnd == null) { return null; }
          i = attributeEnd as StringIndex orelse panic();
        }
      }
      builder.finishNode();
      builder.finish()
    }

An attribute: a name, then optionally `=` and a value. Gives where it
ends, or null if the input ends inside a quoted value.

    let attributeAt(builder: GreenNodeBuilder, text: String, at: StringIndex): StringIndex? {
      builder.startNode(attributeKind);

A name may start with `=`, and then runs to whitespace, `/`, `>`, or
`=`.

      let end = text.end;
      var i = text.next(at);
      while (i < end) {
        let c = text[i];
        if (isAsciiWhitespace(c) || c == char'/' || c == char'>' || c == char'=') { break; }
        i = text.next(i);
      }
      tokenOf(builder, attributeNameKind, text, at, i);
      let equals = skipWhitespace(text, i);
      if (codeAt(text, equals) == char'=') {
        let afterEquals = text.next(equals);
        tokenOf(builder, htmlWhitespaceKind, text, i, equals);
        tokenOf(builder, equalsKind, text, equals, afterEquals);
        let valueStart = skipWhitespace(text, afterEquals);
        tokenOf(builder, htmlWhitespaceKind, text, afterEquals, valueStart);
        let quote = codeAt(text, valueStart);
        var valueEnd = valueStart;
        if (quote == char'"' || quote == char'\'') {
          valueEnd = text.next(valueStart);
          while (valueEnd < end && text[valueEnd] != quote) {
            valueEnd = text.next(valueEnd);
          }
          if (valueEnd >= end) { return null; }
          valueEnd = text.next(valueEnd);
        } else {
          while (valueEnd < end) {
            let c = text[valueEnd];
            if (isAsciiWhitespace(c) || c == char'>') { break; }
            valueEnd = text.next(valueEnd);
          }
        }
        tokenOf(builder, attributeValueKind, text, valueStart, valueEnd);
        i = valueEnd;
      }
      builder.finishNode();
      i
    }

An end tag: `</`, a name, optional whitespace, and `>`.

    let endTagAt(text: String, at: StringIndex): GreenNode? {
      let nameStart = text.step(at, 2);
      if (!isAsciiAlpha(codeAt(text, nameStart))) { return null; }
      let nameStop = nameEnd(text, nameStart);
      let close = skipWhitespace(text, nameStop);
      if (codeAt(text, close) != char'>') { return null; }
      let builder = new GreenNodeBuilder();
      builder.startNode(endTagKind);
      tokenOf(builder, tagOpenKind, text, at, nameStart);
      tokenOf(builder, tagNameKind, text, nameStart, nameStop);
      tokenOf(builder, htmlWhitespaceKind, text, nameStop, close);
      tokenOf(builder, tagCloseKind, text, close, text.next(close));
      builder.finishNode();
      builder.finish()
    }

A comment, `<!--` to `-->`, or to the end of the input.

    let commentAt(text: String, at: StringIndex): GreenNode? {
      let dash = text.step(at, 2);
      if (codeAt(text, dash) != char'-' || codeAt(text, text.next(dash)) != char'-') {
        return null;
      }
      let end = text.end;
      let textStart = text.step(dash, 2);
      let first = codeAt(text, textStart);
      let second = codeAt(text, text.next(textStart));
      var textEnd = end;
      var closeEnd = end;
      if (first == char'>') {
        textEnd = textStart;
        closeEnd = text.next(textStart);
      } else if (first == char'-' && second == char'>') {
        textEnd = textStart;
        closeEnd = text.step(textStart, 2);
      } else {
        let close = text.indexOf("-->", textStart);
        if (close is StringIndex) {
          textEnd = close;
          closeEnd = text.step(close, 3);
        }
      }
      let builder = new GreenNodeBuilder();
      builder.startNode(commentKind);
      tokenOf(builder, commentOpenKind, text, at, textStart);
      tokenOf(builder, commentTextKind, text, textStart, textEnd);
      tokenOf(builder, commentCloseKind, text, textEnd, closeEnd);
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
