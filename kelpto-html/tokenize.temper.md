# Tokenizing

HTML's tokenizer, as the WHATWG HTML standard's tokenization section
gives it, writing a green tree that keeps every code point, so
`asWritten` gives the input back exactly, for any input. Parse errors
are kept as a list beside the tree, by code and position.

    let {
      GreenNode, GreenNodeBuilder, GreenToken, Kind, RedNode, asciiLowercase, isAsciiAlpha, isAsciiAlphanumeric,
      isAsciiDigit, isAsciiWhitespace, namedCharacterReference, redRoot, unknownKind,
    } = import("../kelpto-core");

```temper inert
let tokens = tokenizeHtml("<!DOCTYPE html><p class=note>Fish &amp; chips<!-- c --></p>");
let p = tokens.startTags[0];
p.name;                               // "p"
p.attributes[0].value;                // "note"
p.attributes[0].withValue("tip").asWritten; // "<!DOCTYPE html><p class=\"tip\">Fish &amp; chips…"
let result = HtmlTokenizer.html.tokenize("<p a=1 a=2>");
result.errors[0].code;                // "duplicate-attribute"
```

## How it fits the tree

Every state of the standard's state machine is here, run as one loop
over `StringIndex` positions, never decoding the input. Rather than
building each token's name and value a character at a time, it notes
where each part starts and ends and adds that slice of the input as a
token of the tree (through the builder's cache, so small ones are
shared), so nothing is allocated per character. What browsers read
from the tree is worked out when a view asks: names lowercased,
character references decoded, `\r\n` and `\r` read as `\n`, and NUL
replaced where the standard replaces it.

- **Text** is an `HtmlText` node of `Chars` tokens, with each
  character reference a `CharacterReference` token, each NUL the
  standard replaces (outside the data state) a `ReplacedChar` token,
  and a CDATA section's `<![CDATA[` and `]]>` `CdataOpen` and
  `CdataClose` tokens.
- **Tags** are `HtmlStartTag` and `HtmlEndTag` nodes: `TagOpen`,
  `TagName`, whitespace, an `HtmlAttribute` node for each attribute
  (name, `=`, and value with its quotes, as written), a stray `/` as
  `Unknown`, `SelfClosing`, and `TagClose`. A repeated attribute, which
  browsers drop, is an `HtmlDuplicateAttribute` node instead.
- **Comments** are `HtmlComment` nodes: `CommentOpen` (`<!--`, or
  `<!`, `</`, or `<` for a bogus comment), `CommentText`, and
  `CommentClose`, which holds what an unclosed comment ends with.
- **DOCTYPEs** are `HtmlDoctype` nodes, or `HtmlQuirksDoctype` when
  the standard sets the force-quirks flag: `DoctypeOpen`, `DoctypeName`,
  `DoctypeKeyword`, `DoctypePublicId`, `DoctypeSystemId` (with their
  quotes), anything bogus as `Unknown`, and `TagClose`.
- **Processing instructions** (`<?target data?>`, as the standard
  has read them since 2026) are `HtmlProcessingInstruction` nodes:
  `PiOpen` (`<?`), `PiTarget`, whitespace, `PiData`, and `PiClose`
  (`?>` or `>`). `<?` not followed by a target the standard takes
  (one starting with an ASCII letter or `_`, of letters, digits, `-`,
  and `_`, other than `xml` and `xml-stylesheet`) is a bogus comment,
  as all of `<?` used to be.
- **What browsers drop,** a tag or processing instruction cut off by
  the end of the input, and `</>`, is an `HtmlDroppedTag` node holding
  the tag's node, so its text stays but no view takes it for a tag.

Two parts of the standard belong to tree construction: switching to
the RCDATA, RAWTEXT, script data, and PLAINTEXT states after a start
tag, and reading `<![CDATA[` as CDATA in foreign content (SVG and
MathML). When tree construction runs (see `build.temper.md`), it
takes each token as it's done, through a `TokenSink`, and decides
both. On its own, `HtmlTokenizer.html` switches after the start tags
that tree construction switches after in HTML content (`title`,
`textarea`, `style`, `xmp`, `iframe`, `noembed`, `noframes`,
`noscript` with scripting on, `script`, and `plaintext`), and
`<![CDATA[` is always a bogus comment, as in HTML content.

## Kinds

    export let htmlTokensKind = new Kind(200, "HtmlTokens");
    export let startTagKind = new Kind(201, "HtmlStartTag");
    export let endTagKind = new Kind(202, "HtmlEndTag");
    export let commentKind = new Kind(203, "HtmlComment");
    export let htmlTextKind = new Kind(204, "HtmlText");
    export let attributeKind = new Kind(205, "HtmlAttribute");
    export let doctypeKind = new Kind(206, "HtmlDoctype");
    export let quirksDoctypeKind = new Kind(207, "HtmlQuirksDoctype");
    export let droppedTagKind = new Kind(208, "HtmlDroppedTag");
    export let duplicateAttributeKind = new Kind(209, "HtmlDuplicateAttribute");

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
    export let characterReferenceKind = new Kind(222, "CharacterReference");
    export let replacedCharKind = new Kind(223, "ReplacedChar");
    export let cdataCloseKind = new Kind(224, "CdataClose");
    export let doctypeOpenKind = new Kind(225, "DoctypeOpen");
    export let doctypeNameKind = new Kind(226, "DoctypeName");
    export let doctypeKeywordKind = new Kind(227, "DoctypeKeyword");
    export let publicIdKind = new Kind(228, "DoctypePublicId");
    export let systemIdKind = new Kind(229, "DoctypeSystemId");
    export let processingInstructionKind = new Kind(230, "HtmlProcessingInstruction");
    export let piOpenKind = new Kind(231, "PiOpen");
    export let piTargetKind = new Kind(232, "PiTarget");
    export let piDataKind = new Kind(233, "PiData");
    export let piCloseKind = new Kind(234, "PiClose");
    export let cdataOpenKind = new Kind(235, "CdataOpen");

## The entry points

Tokenizes `text` as browsers do in HTML content. Never fails: any text
is some HTML.

    export let tokenizeHtml(text: String): HtmlTokens {
      HtmlTokenizer.html.tokenize(text).tokens
    }

The green tree alone, for embedding in another tree, as the `kelpto`
library does for raw HTML in Markdown.

    export let tokenizeHtmlGreen(text: String): GreenNode {
      HtmlTokenizer.html.tokenizeGreen(text)
    }

A state the tokenizer can start in: the ones tree construction
switches to, and CDATA sections.

    export class ContentState {
      public id: Int;
      public name: String;
      private constructor(id: Int, name: String) { this.id = id; this.name = name; }
      public toString(): String { name }

      public static data: ContentState = new ContentState(0, "Data");
      public static rcdata: ContentState = new ContentState(1, "RCDATA");
      public static rawtext: ContentState = new ContentState(2, "RAWTEXT");
      public static scriptData: ContentState = new ContentState(3, "Script data");
      public static plaintext: ContentState = new ContentState(4, "PLAINTEXT");
      public static cdataSection: ContentState = new ContentState(68, "CDATA section");
    }

How to tokenize: where to start, the last start tag (for which end
tag ends RCDATA, RAWTEXT, and script data), and whether start tags
switch the state, as `html` does. html5lib-tests' tokenizer tests turn
switching off and set the other two.

    export class HtmlTokenizer {
      public initialState: ContentState;
      public lastStartTag: String;
      public switchesState: Boolean;

      public constructor(initialState: ContentState, lastStartTag: String, switchesState: Boolean) {
        this.initialState = initialState;
        this.lastStartTag = lastStartTag;
        this.switchesState = switchesState;
      }

Starting in the data state, switching after raw text elements' start
tags as tree construction does in HTML content.

      public static html: HtmlTokenizer = new HtmlTokenizer(ContentState.data, "", true);

      public withInitialState(state: ContentState): HtmlTokenizer {
        new HtmlTokenizer(state, lastStartTag, switchesState)
      }

The last start tag's name, lowercase, or empty for none.

      public withLastStartTag(name: String): HtmlTokenizer {
        new HtmlTokenizer(initialState, name, switchesState)
      }

      public withStateSwitching(on: Boolean): HtmlTokenizer {
        new HtmlTokenizer(initialState, lastStartTag, on)
      }

      public tokenize(text: String): TokenizedHtml {
        let machine = new Tokenizer(text, lastStartTag, switchesState, null, true);
        machine.run(initialState.id);
        new TokenizedHtml(new HtmlTokens(redRoot(machine.green())), machine.parseErrors())
      }

      public tokenizeGreen(text: String): GreenNode {
        let machine = new Tokenizer(text, lastStartTag, switchesState, null, false);
        machine.run(initialState.id);
        machine.green()
      }
    }

The tokens, and the parse errors, in order.

    export class TokenizedHtml(public tokens: HtmlTokens, public errors: List<HtmlParseError>) {}

A parse error: its code, as the standard names it, such as
`"duplicate-attribute"`, and where, in code points from the start of
the input (where the standard reports it: mostly the character being
read, or the end for errors at the end of the input).

    export class HtmlParseError(public code: String, public offset: Int) {
      public toString(): String { "${code}@${offset.toString()}" }
    }

## Handing tokens on

What tree construction implements to take each top-level token (a
tag, comment, DOCTYPE, processing instruction, dropped tag, or run of
text) as soon as it's done: its green node, where it starts in code
points, and its index among the tokens. For a start tag it gives the
state the tokenizer goes on in (a `ContentState`'s id), and before
`<![CDATA[` the tokenizer asks whether CDATA is allowed there.

    interface TokenSink {
      public take(green: GreenNode, offset: Int, index: Int): Int;
      public cdataAllowed(): Boolean;
      public end(): Void;
    }

For the tokenizer on its own.

    // Called from outside the class: in Temper's main since #625, a
    // `sink.end()` in a class with a property `end` reads that property
    // instead of calling the method.
    let endSink(sink: TokenSink): Void { sink.end(); }

    class NoTokenSink extends TokenSink {
      public constructor() {}
      public take(green: GreenNode, offset: Int, index: Int): Int { 0 }
      public cdataAllowed(): Boolean { false }
      public end(): Void {}
    }

## States

As the standard names them, as `Int`s for `when`. Character
references aren't states here: `charReference` reads one ahead, which
gives the same tokens and errors.

    let dataState = 0;
    let rcdataState = 1;
    let rawtextState = 2;
    let scriptDataState = 3;
    let plaintextState = 4;
    let tagOpenState = 5;
    let endTagOpenState = 6;
    let tagNameState = 7;
    let scriptEscapeStartState = 17;
    let scriptEscapeStartDashState = 18;
    let scriptEscapedState = 19;
    let scriptEscapedDashState = 20;
    let scriptEscapedDashDashState = 21;
    let scriptDoubleEscapedState = 26;
    let scriptDoubleEscapedDashState = 27;
    let scriptDoubleEscapedDashDashState = 28;
    let beforeAttributeNameState = 31;
    let attributeNameState = 32;
    let afterAttributeNameState = 33;
    let beforeAttributeValueState = 34;
    let attributeValueQuotedState = 35;
    let attributeValueUnquotedState = 37;
    let afterAttributeValueQuotedState = 38;
    let selfClosingStartTagState = 39;
    let bogusCommentState = 40;
    let markupDeclarationOpenState = 41;
    let commentStartState = 42;
    let commentStartDashState = 43;
    let commentState = 44;
    let commentLessThanSignState = 45;
    let commentLessThanSignBangState = 46;
    let commentLessThanSignBangDashState = 47;
    let commentLessThanSignBangDashDashState = 48;
    let commentEndDashState = 49;
    let commentEndState = 50;
    let commentEndBangState = 51;
    let doctypeState = 52;
    let beforeDoctypeNameState = 53;
    let doctypeNameState = 54;
    let afterDoctypeNameState = 55;
    let afterDoctypePublicKeywordState = 56;
    let beforeDoctypePublicIdState = 57;
    let doctypePublicIdState = 58;
    let afterDoctypePublicIdState = 60;
    let betweenDoctypeIdsState = 61;
    let afterDoctypeSystemKeywordState = 62;
    let beforeDoctypeSystemIdState = 63;
    let doctypeSystemIdState = 64;
    let afterDoctypeSystemIdState = 66;
    let bogusDoctypeState = 67;
    let cdataSectionState = 68;
    let cdataSectionBracketState = 69;
    let cdataSectionEndState = 70;
    let piOpenState = 71;
    let piTargetState = 72;
    let afterPiTargetState = 73;
    let piDataState = 74;
    let piQuestionableState = 75;
    let doneState = -1;

The less-than sign and end tag states of RCDATA, RAWTEXT, and script
data, and the double escape start and end states, are lookaheads in
the states before them (`appropriateEndTag` and `scriptWordEnd`): what
they read is only ever text, or the end tag they find.

## The machine

One per input. `run` holds the hot positions in locals, which every
backend reads fastest; the builder and the parts of the current token
that methods share are fields.

    class Tokenizer {
      private text: String;
      private end: StringIndex;
      private var lastStartTag: String;
      private switchesState: Boolean;
      private sink: TokenSink;
      private hasSink: Boolean;

Whether parse errors are kept. Without them, runs of text are found
with `indexOf`, unread.

      private reportsErrors: Boolean;
      private references: ReferenceMatcher;
      private builder: GreenNodeBuilder = new GreenNodeBuilder();
      private errorCodes: ListBuilder<String> = new ListBuilder<String>();
      private errorPositions: ListBuilder<StringIndex> = new ListBuilder<StringIndex>();

Where the input not yet in the tree starts, and whether an `HtmlText`
node is open.

      private var pending: StringIndex = String.begin;
      private var textOpen: Boolean = false;

Where the current markup's node and attribute start in the builder,
and the current tag's details. Attribute names map to the number of
the tag they were last seen in, so duplicates are found without
clearing anything.

      private var markupMark: Int = 0;
      private var attributeMark: Int = 0;
      private var attributeOpen: Boolean = false;
      private var tagIsEnd: Boolean = false;
      private var tagHasAttributes: Boolean = false;
      private var tagNumber: Int = 0;
      private attributeNames: MapBuilder<String, Int> = new MapBuilder<String, Int>();

How many top-level tokens the sink has, where the next starts, and
what it said after the last.

      private var delivered: Int = 0;
      private var deliveredWidth: Int = 0;
      private var sinkState: Int = 0;

      public constructor(
        text: String, lastStartTag: String, switchesState: Boolean, sink: TokenSink?, reportsErrors: Boolean,
      ) {
        this.text = text;
        this.end = text.end;
        this.references = new ReferenceMatcher(text);
        this.lastStartTag = lastStartTag;
        this.switchesState = switchesState;
        this.sink = sink ?? new NoTokenSink();
        this.hasSink = sink != null;
        this.reportsErrors = reportsErrors;
      }

Hands the sink every finished top-level token it doesn't have yet.
Called only when no node but the root is open.

      private deliver(): Void {
        if (!hasSink) { return; }
        let count = builder.checkpoint();
        while (delivered < count) {
          let green = builder.childAt(delivered) as GreenNode orelse panic();
          sinkState = sink.take(green, deliveredWidth, delivered);
          deliveredWidth += green.width;
          delivered += 1;
        }
      }

      public green(): GreenNode { builder.finish() }

The errors, with their positions as code point offsets, counted in
one pass, since they come in order.

      public parseErrors(): List<HtmlParseError> {
        let result = new ListBuilder<HtmlParseError>();
        var at = String.begin;
        var offset = 0;
        for (var k = 0; k < errorCodes.length; k += 1) {
          let position = errorPositions[k];
          if (position < at) {
            at = String.begin;
            offset = 0;
          }
          offset += text.countBetween(at, position);
          at = position;
          result.add(new HtmlParseError(errorCodes[k], offset));
        }
        result.toList()
      }

      private error(code: String, at: StringIndex): Void {
        if (!reportsErrors) { return; }
        errorCodes.add(code);
        errorPositions.add(at);
      }

### Emitting

Adds the input from `pending` to `upTo` as one token of `kind`.

      private seg(kind: Kind, upTo: StringIndex): Void {
        if (pending < upTo) {
          builder.token(kind, text.slice(pending, upTo));
          pending = upTo;
        }
      }

      private openText(): Void {
        if (!textOpen) {
          builder.startNode(htmlTextKind);
          textOpen = true;
        }
      }

A token inside text, such as a character reference, from `from` to
`to`, after the text before it.

      private textToken(kind: Kind, from: StringIndex, to: StringIndex): Void {
        openText();
        seg(charsKind, from);
        seg(kind, to);
      }

Ends the text before markup starting at `at`.

      private endText(at: StringIndex): Void {
        if (pending < at) {
          openText();
          seg(charsKind, at);
        }
        if (textOpen) {
          builder.finishNode();
          textOpen = false;
        }
      }

Markup's node starts at `at`; its kind is given when it ends, since
a tag cut off by the end of the input, or a DOCTYPE's quirks, is
known only then.

      private beginMarkup(at: StringIndex): Void {
        endText(at);
        deliver();
        markupMark = builder.checkpoint();
      }

      private finishMarkup(kind: Kind): Void {
        builder.startNodeAt(markupMark, kind);
        builder.finishNode();
      }

      private beginTag(at: StringIndex, isEnd: Boolean): Void {
        beginMarkup(at);
        tagIsEnd = isEnd;
        tagHasAttributes = false;
        tagNumber += 1;
      }

      private beginAttribute(at: StringIndex): Void {
        seg(htmlWhitespaceKind, at);
        attributeMark = builder.checkpoint();
        tagHasAttributes = true;
      }

When the attribute name state ends: the name, and the attribute's
node, a duplicate's if an earlier one had the same name.

      private endAttributeName(nameStart: StringIndex, at: StringIndex): Void {
        seg(attributeNameKind, at);
        let name = htmlName(text.slice(nameStart, at));
        let kind = if (attributeNames.getOr(name, 0) == tagNumber) {
          error("duplicate-attribute", at);
          duplicateAttributeKind
        } else {
          attributeNames[name] = tagNumber;
          attributeKind
        };
        builder.startNodeAt(attributeMark, kind);
        attributeOpen = true;
      }

      private closeAttribute(): Void {
        if (attributeOpen) {
          builder.finishNode();
          attributeOpen = false;
        }
      }

Emits the tag closed by the `>` at `at`, and gives the state after
it.

      private emitTag(at: StringIndex, nameStart: StringIndex, nameEnd: StringIndex, selfClosing: Boolean): Int {
        closeAttribute();
        seg(htmlWhitespaceKind, at);
        seg(tagCloseKind, text.next(at));
        if (tagIsEnd) {
          if (tagHasAttributes) { error("end-tag-with-attributes", at); }
          if (selfClosing) { error("end-tag-with-trailing-solidus", at); }
          finishMarkup(endTagKind);
          return dataState;
        }
        finishMarkup(startTagKind);
        if (!switchesState) { return dataState; }
        let state = if (hasSink) {
          deliver();
          sinkState
        } else {
          stateAfter(nameStart, nameEnd)
        };
        if (state != dataState) {
          lastStartTag = htmlName(text.slice(nameStart, nameEnd));
        }
        state
      }

The state tree construction switches to after a start tag in HTML
content, by its name.

      private stateAfter(nameStart: StringIndex, nameEnd: StringIndex): Int {
        if (!text.hasAtLeast(nameStart, nameEnd, 3) || text.hasAtLeast(nameStart, nameEnd, 10)) {
          return dataState;
        }
        if (nameIs(nameStart, nameEnd, "title") || nameIs(nameStart, nameEnd, "textarea")) {
          rcdataState
        } else if (nameIs(nameStart, nameEnd, "script")) {
          scriptDataState
        } else if (
          nameIs(nameStart, nameEnd, "style") || nameIs(nameStart, nameEnd, "xmp") ||
          nameIs(nameStart, nameEnd, "iframe") || nameIs(nameStart, nameEnd, "noembed") ||
          nameIs(nameStart, nameEnd, "noframes") || nameIs(nameStart, nameEnd, "noscript")
        ) {
          rawtextState
        } else if (nameIs(nameStart, nameEnd, "plaintext")) {
          plaintextState
        } else {
          dataState
        }
      }

Whether the input from `from` to `to` is `word` (lowercase), ignoring
ASCII case.

      private nameIs(from: StringIndex, to: StringIndex, word: String): Boolean {
        from < to && wordEnd(from, word) == to
      }

Where `word` (lowercase ASCII) ends if the input at `at` starts with
it, ignoring ASCII case, or else `at`.

      private wordEnd(at: StringIndex, word: String): StringIndex {
        var i = at;
        var j = String.begin;
        while (word.hasIndex(j)) {
          if (i >= end) { return at; }
          var c = text[i];
          if (c >= char'A' && c <= char'Z') { c += 32; }
          if (c != word[j]) { return at; }
          i = text.next(i);
          j = word.next(j);
        }
        i
      }

A tag cut off by the end of the input at `at`: its node, inside a
dropped tag's.

      private eofInTag(at: StringIndex, pendingKind: Kind): Void {
        closeAttribute();
        seg(pendingKind, at);
        finishMarkup(if (tagIsEnd) { endTagKind } else { startTagKind });
        finishMarkup(droppedTagKind);
        error("eof-in-tag", at);
      }

      private finishComment(dataEnd: StringIndex, closeEnd: StringIndex): Void {
        seg(commentTextKind, dataEnd);
        seg(commentCloseKind, closeEnd);
        finishMarkup(commentKind);
      }

A DOCTYPE closed by the `>` at `at`, or cut off there by the end of
the input.

      private finishDoctype(pendingKind: Kind, at: StringIndex, quirks: Boolean): Void {
        seg(pendingKind, at);
        if (at < end) { seg(tagCloseKind, text.next(at)); }
        finishMarkup(if (quirks) { quirksDoctypeKind } else { doctypeKind });
      }

### Lookaheads

If an end tag the current RCDATA, RAWTEXT, or script data ends starts
at the `<` at `lt` (its name the last start tag's, then whitespace,
`/`, or `>`), where its name ends; otherwise `lt`.

      private appropriateEndTag(lt: StringIndex): StringIndex {
        if (lastStartTag.isEmpty) { return lt; }
        let slash = text.next(lt);
        if (slash >= end || text[slash] != char'/') { return lt; }
        let nameStart = text.next(slash);
        var i = nameStart;
        while (i < end && isAsciiAlpha(text[i])) { i = text.next(i); }
        if (i >= end || !nameIs(nameStart, i, lastStartTag)) { return lt; }
        let c = text[i];
        if (isAsciiWhitespace(c) || c == char'/' || c == char'>') { i } else { lt }
      }

For the double escape start and end states: if `script` starts at
`at` (ignoring ASCII case), then whitespace, `/`, or `>`, where that
character ends; otherwise `at`.

      private scriptWordEnd(at: StringIndex): StringIndex {
        let i = wordEnd(at, "script");
        if (i == at || i >= end) { return at; }
        let c = text[i];
        if (isAsciiWhitespace(c) || c == char'/' || c == char'>') { text.next(i) } else { at }
      }

### Character references

Reads the character reference, if any, at the `&` at `amp`, and gives
where reading goes on. In text, a reference is a token of its own; in
an attribute value, the value stays one token, decoded when read, so
this only checks for errors.

      private charReference(amp: StringIndex, inAttribute: Boolean): StringIndex {
        let i = text.next(amp);
        let c = if (i < end) { text[i] } else { -1 };
        if (isAsciiAlphanumeric(c)) {
          var runEnd = i;
          while (runEnd < end && isAsciiAlphanumeric(text[runEnd])) { runEnd = text.next(runEnd); }
          let matchEnd = references.namedEnd(i, runEnd);
          if (matchEnd == i) {

The ambiguous ampersand state: the letters and digits are text.

            if (runEnd < end && text[runEnd] == char';') {
              error("unknown-named-character-reference", runEnd);
            }
            return runEnd;
          }
          if (text[text.prev(matchEnd)] != char';') {
            if (inAttribute && matchEnd < end) {
              let after = text[matchEnd];
              if (after == char'=' || isAsciiAlphanumeric(after)) { return matchEnd; }
            }
            error("missing-semicolon-after-character-reference", matchEnd);
          }
          if (!inAttribute) { textToken(characterReferenceKind, amp, matchEnd); }
          return matchEnd;
        }
        if (c != char'#') { return i; }
        var j = text.next(i);
        let x = if (j < end) { text[j] } else { -1 };
        let hex = x == char'x' || x == char'X';
        if (hex) { j = text.next(j); }
        let digitsStart = j;
        var value = 0;
        while (j < end) {
          let digit = digitValue(text[j], hex);
          if (digit < 0) { break; }
          value = value * (if (hex) { 16 } else { 10 }) + digit;
          if (value > 0x10FFFF) { value = 0x110000; }
          j = text.next(j);
        }
        if (j == digitsStart) {
          error("absence-of-digits-in-numeric-character-reference", j);
          return j;
        }
        var refEnd = j;
        if (j < end && text[j] == char';') {
          refEnd = text.next(j);
        } else {
          error("missing-semicolon-after-character-reference", j);
        }
        let problem = numericReferenceError(value);
        if (!problem.isEmpty) { error(problem, refEnd); }
        if (!inAttribute) { textToken(characterReferenceKind, amp, refEnd); }
        refEnd
      }

### The loop

      public run(initialState: Int): Void {
        let text = this.text;
        let end = this.end;
        builder.startNode(htmlTokensKind);
        var state = initialState;
        var i = String.begin;

Positions past which input-stream errors (controls, noncharacters)
have been reported, so a character read again isn't reported twice.
A character that ends a processing instruction's target, making it a
bogus comment, is reported in the bogus comment state, after the
error that says so, as html5lib-tests has it.

        var checkedTo = String.begin;
        var markupStart = String.begin;
        var nameStart = String.begin;
        var attributeStart = String.begin;
        var nameEnd = String.begin;
        var dataStart = String.begin;
        var closeStart = String.begin;
        var quote = 0;
        var quirks = false;

Without errors, where the next `<`, `&`, and NUL are, found ahead
with `indexOf` (each found again only once passed), so text in the
data state is skipped unread.

        var nextLt = String.begin;
        var nextAmp = String.begin;
        var nextNul = String.begin;
        while (state != doneState) {
          let c = if (i < end) { text[i] } else { -1 };
          if (
            ((c > 0 && c < 0x20 && c != char'\n') || c >= 0x7F) && i >= checkedTo &&
            state != piOpenState && state != piTargetState
          ) {
            inputError(c, i);
            checkedTo = text.next(i);
          }
          when (state) {
            dataState -> do {
              if (c == char'<') {
                markupStart = i;
                i = text.next(i);
                state = tagOpenState;
              } else if (c == char'&') {
                i = charReference(i, false);
              } else if (c == -1) {
                endText(i);
                state = doneState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
                if (reportsErrors) {
                  while (i < end) {
                    let d = text[i];
                    if (d == char'<' || d == char'&' || d == 0) { break; }
                    if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                    i = text.next(i);
                  }
                } else {
                  if (nextLt < i) { nextLt = firstAt(text, "<", i, end); }
                  if (nextAmp < i) { nextAmp = firstAt(text, "&", i, end); }
                  if (nextNul < i) { nextNul = firstAt(text, "\u{0}", i, end); }
                  i = earlier(nextLt, earlier(nextAmp, nextNul));
                }
                checkedTo = i;
              }
            }
            tagNameState -> do {
              if (isAsciiWhitespace(c)) {
                seg(tagNameKind, i);
                nameEnd = i;
                state = beforeAttributeNameState;
              } else if (c == char'/') {
                seg(tagNameKind, i);
                nameEnd = i;
                i = text.next(i);
                state = selfClosingStartTagState;
              } else if (c == char'>') {
                seg(tagNameKind, i);
                nameEnd = i;
                let after = text.next(i);
                state = emitTag(i, nameStart, nameEnd, false);
                i = after;
              } else if (c == -1) {
                seg(tagNameKind, i);
                eofInTag(i, htmlWhitespaceKind);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (isAsciiWhitespace(d) || d == char'/' || d == char'>' || d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            beforeAttributeNameState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else if (c == char'/' || c == char'>' || c == -1) {
                state = afterAttributeNameState;
              } else {
                if (c == char'=') { error("unexpected-equals-sign-before-attribute-name", i); }
                beginAttribute(i);
                attributeStart = i;
                if (c == char'=') { i = text.next(i); }
                state = attributeNameState;
              }
            }
            attributeNameState -> do {
              if (isAsciiWhitespace(c) || c == char'/' || c == char'>' || c == -1) {
                endAttributeName(attributeStart, i);
                state = afterAttributeNameState;
              } else if (c == char'=') {
                endAttributeName(attributeStart, i);
                i = text.next(i);
                seg(equalsKind, i);
                state = beforeAttributeValueState;
              } else {
                if (c == 0) {
                  error("unexpected-null-character", i);
                } else if (c == char'"' || c == char'\'' || c == char'<') {
                  error("unexpected-character-in-attribute-name", i);
                }
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (
                    isAsciiWhitespace(d) || d == char'/' || d == char'>' || d == char'=' || d == 0 ||
                    d == char'"' || d == char'\'' || d == char'<'
                  ) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            afterAttributeNameState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else if (c == char'/') {
                closeAttribute();
                seg(htmlWhitespaceKind, i);
                i = text.next(i);
                state = selfClosingStartTagState;
              } else if (c == char'=') {
                seg(htmlWhitespaceKind, i);
                i = text.next(i);
                seg(equalsKind, i);
                state = beforeAttributeValueState;
              } else if (c == char'>') {
                closeAttribute();
                let after = text.next(i);
                state = emitTag(i, nameStart, nameEnd, false);
                i = after;
              } else if (c == -1) {
                eofInTag(i, htmlWhitespaceKind);
                state = dataState;
              } else {
                closeAttribute();
                beginAttribute(i);
                attributeStart = i;
                state = attributeNameState;
              }
            }
            beforeAttributeValueState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else if (c == char'"' || c == char'\'') {
                seg(htmlWhitespaceKind, i);
                quote = c;
                i = text.next(i);
                state = attributeValueQuotedState;
              } else if (c == char'>') {
                error("missing-attribute-value", i);
                seg(htmlWhitespaceKind, i);
                let after = text.next(i);
                state = emitTag(i, nameStart, nameEnd, false);
                i = after;
              } else {
                seg(htmlWhitespaceKind, i);
                state = attributeValueUnquotedState;
              }
            }
            attributeValueQuotedState -> do {
              if (c == quote) {
                i = text.next(i);
                seg(attributeValueKind, i);
                closeAttribute();
                state = afterAttributeValueQuotedState;
              } else if (c == char'&') {
                i = charReference(i, true);
              } else if (c == -1) {
                seg(attributeValueKind, i);
                eofInTag(i, htmlWhitespaceKind);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
                if (reportsErrors) {
                  while (i < end) {
                    let d = text[i];
                    if (d == quote || d == char'&' || d == 0) { break; }
                    if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                    i = text.next(i);
                  }
                } else {
                  if (nextAmp < i) { nextAmp = firstAt(text, "&", i, end); }
                  if (nextNul < i) { nextNul = firstAt(text, "\u{0}", i, end); }
                  let closing = firstAt(text, if (quote == char'"') { "\"" } else { "'" }, i, end);
                  i = earlier(closing, earlier(nextAmp, nextNul));
                }
                checkedTo = i;
              }
            }
            afterAttributeValueQuotedState -> do {
              if (isAsciiWhitespace(c)) {
                state = beforeAttributeNameState;
              } else if (c == char'/') {
                i = text.next(i);
                state = selfClosingStartTagState;
              } else if (c == char'>') {
                let after = text.next(i);
                state = emitTag(i, nameStart, nameEnd, false);
                i = after;
              } else if (c == -1) {
                eofInTag(i, htmlWhitespaceKind);
                state = dataState;
              } else {
                error("missing-whitespace-between-attributes", i);
                state = beforeAttributeNameState;
              }
            }
            attributeValueUnquotedState -> do {
              if (isAsciiWhitespace(c)) {
                seg(attributeValueKind, i);
                closeAttribute();
                state = beforeAttributeNameState;
              } else if (c == char'&') {
                i = charReference(i, true);
              } else if (c == char'>') {
                seg(attributeValueKind, i);
                let after = text.next(i);
                state = emitTag(i, nameStart, nameEnd, false);
                i = after;
              } else if (c == -1) {
                seg(attributeValueKind, i);
                eofInTag(i, htmlWhitespaceKind);
                state = dataState;
              } else {
                if (c == 0) {
                  error("unexpected-null-character", i);
                } else if (c == char'"' || c == char'\'' || c == char'<' || c == char'=' || c == char'`') {
                  error("unexpected-character-in-unquoted-attribute-value", i);
                }
                i = text.next(i);
              }
            }
            tagOpenState -> do {
              if (isAsciiAlpha(c)) {
                beginTag(markupStart, false);
                seg(tagOpenKind, i);
                nameStart = i;
                state = tagNameState;
              } else if (c == char'/') {
                i = text.next(i);
                state = endTagOpenState;
              } else if (c == char'!') {
                i = text.next(i);
                state = markupDeclarationOpenState;
              } else if (c == char'?') {
                i = text.next(i);
                state = piOpenState;
              } else if (c == -1) {
                error("eof-before-tag-name", i);
                state = dataState;
              } else {
                error("invalid-first-character-of-tag-name", i);
                state = dataState;
              }
            }
            endTagOpenState -> do {
              if (isAsciiAlpha(c)) {
                beginTag(markupStart, true);
                seg(tagOpenKind, i);
                nameStart = i;
                state = tagNameState;
              } else if (c == char'>') {
                error("missing-end-tag-name", i);
                beginTag(markupStart, true);
                seg(tagOpenKind, i);
                i = text.next(i);
                seg(tagCloseKind, i);
                finishMarkup(endTagKind);
                finishMarkup(droppedTagKind);
                state = dataState;
              } else if (c == -1) {
                error("eof-before-tag-name", i);
                state = dataState;
              } else {
                error("invalid-first-character-of-tag-name", i);
                beginMarkup(markupStart);
                seg(commentOpenKind, i);
                state = bogusCommentState;
              }
            }
            selfClosingStartTagState -> do {
              if (c == char'>') {
                seg(selfClosingKind, i);
                let after = text.next(i);
                state = emitTag(i, nameStart, nameEnd, true);
                i = after;
              } else if (c == -1) {
                eofInTag(i, unknownKind);
                state = dataState;
              } else {
                error("unexpected-solidus-in-tag", i);
                seg(unknownKind, i);
                state = beforeAttributeNameState;
              }
            }
            rcdataState, rawtextState -> do {
              if (c == char'<') {
                let nameStop = appropriateEndTag(i);
                if (nameStop == i) {
                  i = text.next(i);
                } else {
                  beginTag(i, true);
                  nameStart = text.next(text.next(i));
                  seg(tagOpenKind, nameStart);
                  i = nameStart;
                  state = tagNameState;
                }
              } else if (c == char'&' && state == rcdataState) {
                i = charReference(i, false);
              } else if (c == 0) {
                error("unexpected-null-character", i);
                textToken(replacedCharKind, i, text.next(i));
                i = text.next(i);
              } else if (c == -1) {
                endText(i);
                state = doneState;
              } else {
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char'<' || d == char'&' || d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            commentState -> do {
              if (c == char'<') {
                i = text.next(i);
                state = commentLessThanSignState;
              } else if (c == char'-') {
                closeStart = i;
                i = text.next(i);
                state = commentEndDashState;
              } else if (c == -1) {
                error("eof-in-comment", i);
                finishComment(i, i);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char'<' || d == char'-' || d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            markupDeclarationOpenState -> do {
              let dashes = wordEnd(i, "--");
              let doctype = wordEnd(i, "doctype");
              if (dashes != i) {
                beginMarkup(markupStart);
                seg(commentOpenKind, dashes);
                i = dashes;
                dataStart = i;
                state = commentStartState;
              } else if (doctype != i) {
                beginMarkup(markupStart);
                seg(doctypeOpenKind, doctype);
                i = doctype;
                quirks = false;
                state = doctypeState;
              } else {
                let cdata = text.hasAtLeast(i, end, 7) && text.slice(i, text.step(i, 7)) == "[CDATA[";
                if (cdata) {
                  endText(markupStart);
                  deliver();
                }
                if (cdata && hasSink && sink.cdataAllowed()) {
                  i = text.step(i, 7);
                  textToken(cdataOpenKind, markupStart, i);
                  state = cdataSectionState;
                } else {
                  if (cdata) {
                    // Reported at the last `[`, as html5lib-tests has it.
                    error("cdata-in-html-content", text.step(i, 6));
                  } else {
                    error("incorrectly-opened-comment", i);
                  }
                  beginMarkup(markupStart);
                  seg(commentOpenKind, i);
                  state = bogusCommentState;
                }
              }
            }
            bogusCommentState -> do {
              if (c == char'>') {
                let after = text.next(i);
                finishComment(i, after);
                i = after;
                state = dataState;
              } else if (c == -1) {
                finishComment(i, i);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char'>' || d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            commentStartState -> do {
              if (c == char'-') {
                closeStart = i;
                i = text.next(i);
                state = commentStartDashState;
              } else if (c == char'>') {
                error("abrupt-closing-of-empty-comment", i);
                let after = text.next(i);
                finishComment(i, after);
                i = after;
                state = dataState;
              } else {
                state = commentState;
              }
            }
            commentStartDashState -> do {
              if (c == char'-') {
                i = text.next(i);
                state = commentEndState;
              } else if (c == char'>') {
                error("abrupt-closing-of-empty-comment", i);
                let after = text.next(i);
                finishComment(closeStart, after);
                i = after;
                state = dataState;
              } else if (c == -1) {
                error("eof-in-comment", i);
                finishComment(closeStart, i);
                state = dataState;
              } else {
                state = commentState;
              }
            }
            commentLessThanSignState -> do {
              if (c == char'!') {
                i = text.next(i);
                state = commentLessThanSignBangState;
              } else if (c == char'<') {
                i = text.next(i);
              } else {
                state = commentState;
              }
            }
            commentLessThanSignBangState -> do {
              if (c == char'-') {
                closeStart = i;
                i = text.next(i);
                state = commentLessThanSignBangDashState;
              } else {
                state = commentState;
              }
            }
            commentLessThanSignBangDashState -> do {
              if (c == char'-') {
                i = text.next(i);
                state = commentLessThanSignBangDashDashState;
              } else {
                state = commentEndDashState;
              }
            }
            commentLessThanSignBangDashDashState -> do {
              if (c != char'>' && c != -1) { error("nested-comment", i); }
              state = commentEndState;
            }
            commentEndDashState -> do {
              if (c == char'-') {
                i = text.next(i);
                state = commentEndState;
              } else if (c == -1) {
                error("eof-in-comment", i);
                finishComment(closeStart, i);
                state = dataState;
              } else {
                state = commentState;
              }
            }
            commentEndState -> do {
              if (c == char'>') {
                let after = text.next(i);
                finishComment(closeStart, after);
                i = after;
                state = dataState;
              } else if (c == char'!') {
                i = text.next(i);
                state = commentEndBangState;
              } else if (c == char'-') {
                closeStart = text.next(closeStart);
                i = text.next(i);
              } else if (c == -1) {
                error("eof-in-comment", i);
                finishComment(closeStart, i);
                state = dataState;
              } else {
                state = commentState;
              }
            }
            commentEndBangState -> do {
              if (c == char'-') {
                closeStart = i;
                i = text.next(i);
                state = commentEndDashState;
              } else if (c == char'>') {
                error("incorrectly-closed-comment", i);
                let after = text.next(i);
                finishComment(closeStart, after);
                i = after;
                state = dataState;
              } else if (c == -1) {
                error("eof-in-comment", i);
                finishComment(closeStart, i);
                state = dataState;
              } else {
                state = commentState;
              }
            }
            scriptDataState -> do {
              if (c == char'<') {
                let nameStop = appropriateEndTag(i);
                let after = text.next(i);
                if (nameStop != i) {
                  beginTag(i, true);
                  nameStart = text.next(after);
                  seg(tagOpenKind, nameStart);
                  i = nameStart;
                  state = tagNameState;
                } else if (after < end && text[after] == char'!') {
                  i = text.next(after);
                  state = scriptEscapeStartState;
                } else {
                  i = after;
                }
              } else if (c == 0) {
                error("unexpected-null-character", i);
                textToken(replacedCharKind, i, text.next(i));
                i = text.next(i);
              } else if (c == -1) {
                endText(i);
                state = doneState;
              } else {
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char'<' || d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            scriptEscapeStartState -> do {
              if (c == char'-') {
                i = text.next(i);
                state = scriptEscapeStartDashState;
              } else {
                state = scriptDataState;
              }
            }
            scriptEscapeStartDashState -> do {
              if (c == char'-') {
                i = text.next(i);
                state = scriptEscapedDashDashState;
              } else {
                state = scriptDataState;
              }
            }
            scriptEscapedState, scriptEscapedDashState, scriptEscapedDashDashState,
            scriptDoubleEscapedState, scriptDoubleEscapedDashState,
            scriptDoubleEscapedDashDashState -> do {
              let doubled = state >= scriptDoubleEscapedState;
              if (c == char'-') {
                i = text.next(i);
                if (state == scriptEscapedState || state == scriptDoubleEscapedState) {
                  state += 1;
                } else if (state == scriptEscapedDashState || state == scriptDoubleEscapedDashState) {
                  state += 1;
                }
              } else if (c == char'<') {
                let after = text.next(i);
                if (doubled) {
                  let slashed = after < end && text[after] == char'/';
                  let nameAt = if (slashed) { text.next(after) } else { after };
                  let stop = if (slashed) { scriptWordEnd(nameAt) } else { nameAt };
                  if (stop != nameAt) {
                    i = stop;
                    state = scriptEscapedState;
                  } else {
                    i = after;
                    state = scriptDoubleEscapedState;
                  }
                } else {
                  state = scriptEscapedState;
                  let nameStop = appropriateEndTag(i);
                  if (nameStop != i) {
                    beginTag(i, true);
                    nameStart = text.next(after);
                    seg(tagOpenKind, nameStart);
                    i = nameStart;
                    state = tagNameState;
                  } else {
                    let stop = scriptWordEnd(after);
                    if (stop != after) {
                      i = stop;
                      state = scriptDoubleEscapedState;
                    } else {
                      i = after;
                    }
                  }
                }
              } else if (c == char'>' && (state == scriptEscapedDashDashState || state == scriptDoubleEscapedDashDashState)) {
                i = text.next(i);
                state = scriptDataState;
              } else if (c == -1) {
                error("eof-in-script-html-comment-like-text", i);
                endText(i);
                state = doneState;
              } else {
                state = if (doubled) { scriptDoubleEscapedState } else { scriptEscapedState };
                if (c == 0) {
                  error("unexpected-null-character", i);
                  textToken(replacedCharKind, i, text.next(i));
                }
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char'<' || d == char'-' || d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            plaintextState -> do {
              if (c == 0) {
                error("unexpected-null-character", i);
                textToken(replacedCharKind, i, text.next(i));
                i = text.next(i);
              } else if (c == -1) {
                endText(i);
                state = doneState;
              } else {
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == 0) { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            doctypeState -> do {
              if (isAsciiWhitespace(c) || c == char'>') {
                state = beforeDoctypeNameState;
              } else if (c == -1) {
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                error("missing-whitespace-before-doctype-name", i);
                state = beforeDoctypeNameState;
              }
            }
            beforeDoctypeNameState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else if (c == char'>') {
                error("missing-doctype-name", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                seg(htmlWhitespaceKind, i);
                state = doctypeNameState;
              }
            }
            doctypeNameState -> do {
              if (isAsciiWhitespace(c)) {
                seg(doctypeNameKind, i);
                state = afterDoctypeNameState;
              } else if (c == char'>') {
                seg(doctypeNameKind, i);
                finishDoctype(htmlWhitespaceKind, i, quirks);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                seg(doctypeNameKind, i);
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
              }
            }
            afterDoctypeNameState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else if (c == char'>') {
                finishDoctype(htmlWhitespaceKind, i, quirks);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                let publicEnd = wordEnd(i, "public");
                let systemEnd = wordEnd(i, "system");
                seg(htmlWhitespaceKind, i);
                if (publicEnd != i) {
                  i = publicEnd;
                  seg(doctypeKeywordKind, i);
                  state = afterDoctypePublicKeywordState;
                } else if (systemEnd != i) {
                  i = systemEnd;
                  seg(doctypeKeywordKind, i);
                  state = afterDoctypeSystemKeywordState;
                } else {
                  error("invalid-character-sequence-after-doctype-name", i);
                  quirks = true;
                  state = bogusDoctypeState;
                }
              }
            }
            afterDoctypePublicKeywordState, beforeDoctypePublicIdState,
            afterDoctypeSystemKeywordState, beforeDoctypeSystemIdState -> do {
              let isPublic = state == afterDoctypePublicKeywordState || state == beforeDoctypePublicIdState;
              let afterKeyword = state == afterDoctypePublicKeywordState || state == afterDoctypeSystemKeywordState;
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
                state = if (isPublic) { beforeDoctypePublicIdState } else { beforeDoctypeSystemIdState };
              } else if (c == char'"' || c == char'\'') {
                if (afterKeyword) {
                  error(
                    if (isPublic) { "missing-whitespace-after-doctype-public-keyword" } else { "missing-whitespace-after-doctype-system-keyword" },
                    i,
                  );
                }
                seg(htmlWhitespaceKind, i);
                quote = c;
                i = text.next(i);
                state = if (isPublic) { doctypePublicIdState } else { doctypeSystemIdState };
              } else if (c == char'>') {
                error(if (isPublic) { "missing-doctype-public-identifier" } else { "missing-doctype-system-identifier" }, i);
                finishDoctype(htmlWhitespaceKind, i, true);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                error(
                  if (isPublic) { "missing-quote-before-doctype-public-identifier" } else { "missing-quote-before-doctype-system-identifier" },
                  i,
                );
                seg(htmlWhitespaceKind, i);
                quirks = true;
                state = bogusDoctypeState;
              }
            }
            doctypePublicIdState, doctypeSystemIdState -> do {
              let isPublic = state == doctypePublicIdState;
              let kind = if (isPublic) { publicIdKind } else { systemIdKind };
              if (c == quote) {
                i = text.next(i);
                seg(kind, i);
                state = if (isPublic) { afterDoctypePublicIdState } else { afterDoctypeSystemIdState };
              } else if (c == char'>') {
                error(if (isPublic) { "abrupt-doctype-public-identifier" } else { "abrupt-doctype-system-identifier" }, i);
                seg(kind, i);
                finishDoctype(htmlWhitespaceKind, i, true);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                seg(kind, i);
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
              }
            }
            afterDoctypePublicIdState, betweenDoctypeIdsState -> do {
              let between = state == betweenDoctypeIdsState;
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
                state = betweenDoctypeIdsState;
              } else if (c == char'>') {
                finishDoctype(htmlWhitespaceKind, i, quirks);
                i = text.next(i);
                state = dataState;
              } else if (c == char'"' || c == char'\'') {
                if (!between) {
                  error("missing-whitespace-between-doctype-public-and-system-identifiers", i);
                }
                seg(htmlWhitespaceKind, i);
                quote = c;
                i = text.next(i);
                state = doctypeSystemIdState;
              } else if (c == -1) {
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                error("missing-quote-before-doctype-system-identifier", i);
                seg(htmlWhitespaceKind, i);
                quirks = true;
                state = bogusDoctypeState;
              }
            }
            afterDoctypeSystemIdState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else if (c == char'>') {
                finishDoctype(htmlWhitespaceKind, i, quirks);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                error("eof-in-doctype", i);
                finishDoctype(htmlWhitespaceKind, i, true);
                state = dataState;
              } else {
                error("unexpected-character-after-doctype-system-identifier", i);
                seg(htmlWhitespaceKind, i);
                state = bogusDoctypeState;
              }
            }
            bogusDoctypeState -> do {
              if (c == char'>') {
                finishDoctype(unknownKind, i, quirks);
                i = text.next(i);
                state = dataState;
              } else if (c == -1) {
                finishDoctype(unknownKind, i, quirks);
                state = dataState;
              } else {
                if (c == 0) { error("unexpected-null-character", i); }
                i = text.next(i);
              }
            }
            cdataSectionState -> do {
              if (c == char']') {
                closeStart = i;
                i = text.next(i);
                state = cdataSectionBracketState;
              } else if (c == -1) {
                error("eof-in-cdata", i);
                endText(i);
                state = doneState;
              } else {
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char']') { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            cdataSectionBracketState -> do {
              if (c == char']') {
                i = text.next(i);
                state = cdataSectionEndState;
              } else {
                state = cdataSectionState;
              }
            }
            cdataSectionEndState -> do {
              if (c == char']') {
                closeStart = text.next(closeStart);
                i = text.next(i);
              } else if (c == char'>') {
                i = text.next(i);
                textToken(cdataCloseKind, closeStart, i);
                state = dataState;
              } else {
                state = cdataSectionState;
              }
            }
            piOpenState -> do {
              if (isAsciiAlpha(c) || c == char'_') {
                nameStart = i;
                state = piTargetState;
              } else if (c == -1) {
                error("eof-in-processing-instruction", i);
                beginMarkup(markupStart);
                seg(piOpenKind, i);
                finishMarkup(processingInstructionKind);
                finishMarkup(droppedTagKind);
                state = doneState;
              } else {
                error("invalid-first-character-of-processing-instruction-target", i);
                beginMarkup(markupStart);
                seg(commentOpenKind, text.prev(i));
                state = bogusCommentState;
              }
            }
            piTargetState -> do {
              if (isAsciiWhitespace(c) || c == char'?' || c == char'>') {
                beginMarkup(markupStart);
                if (nameIs(nameStart, i, "xml") || nameIs(nameStart, i, "xml-stylesheet")) {
                  error("disallowed-processing-instruction-target", i);
                  seg(commentOpenKind, text.prev(nameStart));
                  state = bogusCommentState;
                } else {
                  seg(piOpenKind, nameStart);
                  seg(piTargetKind, i);
                  nameEnd = i;
                  state = afterPiTargetState;
                }
              } else if (c == -1) {
                error("eof-in-processing-instruction", i);
                beginMarkup(markupStart);
                seg(piOpenKind, nameStart);
                seg(piTargetKind, i);
                finishMarkup(processingInstructionKind);
                finishMarkup(droppedTagKind);
                state = doneState;
              } else if (isAsciiAlphanumeric(c) || c == char'-' || c == char'_') {
                i = text.next(i);
              } else {
                error("invalid-processing-instruction-target", i);
                beginMarkup(markupStart);
                seg(commentOpenKind, text.prev(nameStart));
                state = bogusCommentState;
              }
            }
            afterPiTargetState -> do {
              if (isAsciiWhitespace(c)) {
                i = text.next(i);
              } else {
                seg(htmlWhitespaceKind, i);
                state = piDataState;
              }
            }
            piDataState, piQuestionableState -> do {
              if (c == char'>') {
                seg(piDataKind, if (state == piQuestionableState) { closeStart } else { i });
                i = text.next(i);
                seg(piCloseKind, i);
                finishMarkup(processingInstructionKind);
                state = dataState;
              } else if (c == -1) {
                // Where the target ends, as html5lib-tests has it.
                error("eof-in-processing-instruction", nameEnd);
                seg(piDataKind, i);
                finishMarkup(processingInstructionKind);
                finishMarkup(droppedTagKind);
                state = doneState;
              } else if (c == char'?') {
                closeStart = i;
                i = text.next(i);
                state = piQuestionableState;
              } else {
                state = piDataState;
                i = text.next(i);
                while (i < end) {
                  let d = text[i];
                  if (d == char'?' || d == char'>') { break; }
                  if ((d < 0x20 && d != char'\n') || d >= 0x7F) { inputError(d, i); }
                  i = text.next(i);
                }
                checkedTo = i;
              }
            }
            else -> panic();
          }
        }
        deliver();
        if (hasSink) { endSink(sink); }
        builder.finishNode();
      }

Input-stream errors: controls other than whitespace and NUL, and
noncharacters, each reported once, where read.

      private inputError(c: Int, at: StringIndex): Void {
        if ((c < 0x20 && c != 0 && !isAsciiWhitespace(c)) || (c >= 0x7F && c <= 0x9F)) {
          error("control-character-in-input-stream", at);
        } else if (isNoncharacter(c)) {
          error("noncharacter-in-input-stream", at);
        }
      }
    }

## Searching

Text is searched with `indexOf`, which every backend has natively
(`str.find` in Python, `string.find` in Lua), rather than a loop
reading each code point, which costs far more in Python and Lua and
no less elsewhere. Each search finds the first match from `from`, or
gives `limit` if there's none before it.

    let contains(text: String, target: String): Boolean { text.indexOf(target) is StringIndex }

    let firstAt(text: String, target: String, from: StringIndex, limit: StringIndex): StringIndex {
      let found = text.indexOf(target, from);
      when (found) {
        is StringIndex -> if (found < limit) { found } else { limit };
        else -> limit;
      }
    }

## Character references, shared with the views

    let isNoncharacter(c: Int): Boolean {
      (c >= 0xFDD0 && c <= 0xFDEF) || (c >= 0xFFFE && c % 0x10000 >= 0xFFFE)
    }

    let digitValue(c: Int, hex: Boolean): Int {
      if (c >= char'0' && c <= char'9') {
        c - char'0'
      } else if (!hex) {
        -1
      } else if (c >= char'a' && c <= char'f') {
        c - char'a' + 10
      } else if (c >= char'A' && c <= char'F') {
        c - char'A' + 10
      } else {
        -1
      }
    }

Finds named references in one string, held as a field so it isn't
passed (and, in C++, copied) for each `&`.

    class ReferenceMatcher {
      private text: String;
      private end: StringIndex;

      public constructor(text: String) {
        this.text = text;
        this.end = text.end;
      }

The longest named reference starting at `nameStart`, where `runEnd`
ends its letters and digits: the whole run and a `;`, or one of the
names HTML takes without one (none longer than 6). Gives where the
match ends, or `nameStart` for none.

      public namedEnd(nameStart: StringIndex, runEnd: StringIndex): StringIndex {
        if (runEnd < end && text[runEnd] == char';' && !text.hasAtLeast(nameStart, runEnd, 33)) {
          let withSemicolon = text.next(runEnd);
          if (namedCharacterReference(text.slice(nameStart, withSemicolon)) != null) {
            return withSemicolon;
          }
        }
        var stop = nameStart;
        var n = 0;
        while (stop < runEnd && n < 6) {
          stop = text.next(stop);
          n += 1;
        }
        while (n > 0) {
          if (namedCharacterReference(text.slice(nameStart, stop)) != null) { return stop; }
          stop = text.prev(stop);
          n -= 1;
        }
        nameStart
      }
    }

The error a numeric reference to `value` gives (where `value` past
U+10FFFF is 0x110000), or empty for none.

    let numericReferenceError(value: Int): String {
      if (value == 0) {
        "null-character-reference"
      } else if (value > 0x10FFFF) {
        "character-reference-outside-unicode-range"
      } else if (value >= 0xD800 && value <= 0xDFFF) {
        "surrogate-character-reference"
      } else if (isNoncharacter(value)) {
        "noncharacter-character-reference"
      } else if (value == 0xD || ((value < 0x20 || (value >= 0x7F && value <= 0x9F)) && !isAsciiWhitespace(value))) {
        "control-character-reference"
      } else {
        ""
      }
    }

What a numeric reference to `value` stands for: U+FFFD for 0, a
surrogate, or past U+10FFFF, and 0x80 to 0x9F read as Windows-1252,
as the standard's table says.

    let numericReferenceText(value: Int): String {
      var c = value;
      if (c == 0 || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF)) {
        c = 0xFFFD;
      } else if (c >= 0x80 && c <= 0x9F) {
        let mapped = windows1252[c - 0x80];
        if (mapped != 0) { c = mapped; }
      }
      String.fromCodePoint(c) orelse panic()
    }

    let windows1252: List<Int> = [
      0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
      0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0,
      0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
      0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178,
    ];

What a reference the tokenizer found stands for, given as written
from `&`: a name with or without `;`, or `#` and digits.

    let decodeReference(written: String): String {
      let afterAmpersand = written.next(String.begin);
      if (!written.hasIndex(afterAmpersand) || written[afterAmpersand] != char'#') {
        return namedCharacterReference(written.slice(afterAmpersand, written.end)) ?? written;
      }
      var i = written.next(afterAmpersand);
      let hex = written.hasIndex(i) && (written[i] == char'x' || written[i] == char'X');
      if (hex) { i = written.next(i); }
      var value = 0;
      while (written.hasIndex(i)) {
        let digit = digitValue(written[i], hex);
        if (digit < 0) { break; }
        value = value * (if (hex) { 16 } else { 10 }) + digit;
        if (value > 0x10FFFF) { value = 0x110000; }
        i = written.next(i);
      }
      numericReferenceText(value)
    }

An attribute value as browsers read it, from its text without quotes:
character references decoded (by the rules for attributes), line
endings read as `\n`, and NUL as U+FFFD.

    let decodeAttributeValue(raw: String): String {
      let end = raw.end;
      if (!contains(raw, "&") && !contains(raw, "\r") && !contains(raw, "\u{0}")) { return raw; }
      let out = new StringBuilder();
      var runStart = String.begin;
      var i = String.begin;
      while (i < end) {
        let c = raw[i];
        let next = raw.next(i);
        if (c == char'\r') {
          out.append(raw.slice(runStart, i));
          out.append("\n");
          runStart = if (next < end && raw[next] == char'\n') { raw.next(next) } else { next };
          i = runStart;
        } else if (c == 0) {
          out.append(raw.slice(runStart, i));
          out.append("\u{FFFD}");
          runStart = next;
          i = next;
        } else if (c == char'&') {
          let refEnd = attributeReferenceEnd(raw, i);
          if (refEnd != i) {
            out.append(raw.slice(runStart, i));
            out.append(decodeReference(raw.slice(i, refEnd)));
            runStart = refEnd;
            i = refEnd;
          } else {
            i = next;
          }
        } else {
          i = next;
        }
      }
      out.append(raw.slice(runStart, end));
      out.toString()
    }

The end of the reference at the `&` at `amp` in an attribute value,
or `amp` if it isn't one there.

    let attributeReferenceEnd(raw: String, amp: StringIndex): StringIndex {
      let end = raw.end;
      let i = raw.next(amp);
      if (i >= end) { return amp; }
      let c = raw[i];
      if (isAsciiAlphanumeric(c)) {
        var runEnd = i;
        while (runEnd < end && isAsciiAlphanumeric(raw[runEnd])) { runEnd = raw.next(runEnd); }
        let matchEnd = new ReferenceMatcher(raw).namedEnd(i, runEnd);
        if (matchEnd == i) { return amp; }
        if (raw[raw.prev(matchEnd)] != char';' && matchEnd < end) {
          let after = raw[matchEnd];
          if (after == char'=' || isAsciiAlphanumeric(after)) { return amp; }
        }
        return matchEnd;
      }
      if (c != char'#') { return amp; }
      var j = raw.next(i);
      let hex = j < end && (raw[j] == char'x' || raw[j] == char'X');
      if (hex) { j = raw.next(j); }
      let digitsStart = j;
      while (j < end && digitValue(raw[j], hex) >= 0) { j = raw.next(j); }
      if (j == digitsStart) { return amp; }
      if (j < end && raw[j] == char';') { raw.next(j) } else { j }
    }

Text as browsers read it, from comment text and identifiers: line
endings as `\n`, and NUL as U+FFFD if `replaceNul`.

    let normalizeText(raw: String, replaceNul: Boolean): String {
      let end = raw.end;
      if (!contains(raw, "\r") && !(replaceNul && contains(raw, "\u{0}"))) { return raw; }
      let out = new StringBuilder();
      var runStart = String.begin;
      var i = String.begin;
      while (i < end) {
        let c = raw[i];
        let next = raw.next(i);
        if (c == char'\r') {
          out.append(raw.slice(runStart, i));
          out.append("\n");
          runStart = if (next < end && raw[next] == char'\n') { raw.next(next) } else { next };
          i = runStart;
        } else if (c == 0 && replaceNul) {
          out.append(raw.slice(runStart, i));
          out.append("\u{FFFD}");
          runStart = next;
          i = next;
        } else {
          i = next;
        }
      }
      out.append(raw.slice(runStart, end));
      out.toString()
    }

A tag or attribute name as HTML compares it: ASCII lowercased, NUL as
U+FFFD.

    let htmlName(written: String): String {
      normalizeText(asciiLowercase(written), true)
    }

## Tests

    let roundtripCases(): List<String> {
      [
        "", "plain text", "<p>Hi</p>", "<P CLASS=a ID='b' data-x=\"c\" hidden>",
        "<br/><br /><img src=x />", "<a href=\"unclosed", "<a href='x'", "<a",
        "< p>", "<1>", "</ p>", "</>", "</b foo>", "</b\n>", "<!-- c -->", "<!-->",
        "<!--->", "<!-- open", "<!x>", "<!DOCTYPE html>", "a < b && c > d",
        "<p =x a=b=c / c>", "<script>if (a<b) {}</script>", "&amp; &bogus; &#x26;",
        "é😀\u{0}<b>\r\n</b>", "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\" 'x' y>",
        "<!doctype", "<!DOCTYPE a SYSTEM \"x", "<![CDATA[x]]>", "<?xml?>", "<title>a<b>&amp;</title>",
        "<script><!--<script></script>--></script>x", "<style>\u{0}</style", "<plaintext></plaintext>",
        "<a b='&notit;' c=&amp d=\"&#x80;\">", "<!--a--!>b<!--c--!d-->", "<a/ b>", "<textarea>\r\n</textarea>",
        "<?php x ?>", "<?a?>", "<?a", "<?", "<?a b?", "<?>", "<?_x-1\r\n?y>", "<?xml-stylesheet href=x?>", "<?a!>",
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

    test("what each part becomes") {
      let cases = [
        "<p>Hi</p>", "HtmlStartTag HtmlText HtmlEndTag",
        "<a href='x'", "HtmlDroppedTag",
        "< p></ p>", "HtmlText HtmlComment",
        "a<!-- c -->b<!-- open", "HtmlText HtmlComment HtmlText HtmlComment",
        "<br/>x</>", "HtmlStartTag HtmlText HtmlDroppedTag",
        "<!DOCTYPE html><!doctype>", "HtmlDoctype HtmlQuirksDoctype",
        "<title><b></title>", "HtmlStartTag HtmlText HtmlEndTag",
        "<script>a</script >b", "HtmlStartTag HtmlText HtmlEndTag HtmlText",
        "<?php ?>x<?xml?><?a", "HtmlProcessingInstruction HtmlText HtmlComment HtmlDroppedTag",
      ];
      for (var i = 0; i < cases.length; i += 2) {
        let kinds = kindsOf(cases[i]);
        assert(kinds == cases[i + 1]) { "${cases[i]}: ${kinds}" };
      }
    }

    test("parse errors, by code and offset") {
      let errors = HtmlTokenizer.html.tokenize("<p a=1 a=2>é&notit;</p x>").errors;
      let codes = errors.join(" ") { (e: HtmlParseError): String => e.toString() };
      assert(codes == "duplicate-attribute@8 missing-semicolon-after-character-reference@16 end-tag-with-attributes@24") {
        codes
      };
    }
