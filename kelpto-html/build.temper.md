# Tree construction

The HTML standard's tree construction, building the tree a browser
builds from the tokens, as the tokens are made: the tokenizer hands
each top-level token on as soon as it's done (through `TokenSink`),
and tree construction tells it the state to go on in after each start
tag, and whether `<![CDATA[` starts CDATA (in SVG and MathML).

It uses kelpto-core's `GreenNode`, `RedNode`, `asciiLowercase`,
`isAsciiWhitespace`, and `redRoot`, imported once for the library in
`tokenize.temper.md` (a second import of the same names leaves them
nil in Lua).

```temper inert
let doc = parseHtml("<p>One<p>Two<table><td>x</table>");
doc.body?.children.length;          // 2: the two p elements
let p = doc.body?.children[0] as Element orelse panic();
p.startTag?.asWritten;               // "<p>", the token it came from
doc.tokens.asWritten;                // the input, exactly
```

## How it relates to the tokens

The tokens stay the lossless tree (`HtmlTokens`), and the built tree
is separate, built beside it in one pass, and pointing back at it:
each element knows its start tag (none for elements the standard
implies, such as `<tbody>`), and each comment, DOCTYPE, and processing
instruction its token. A built tree differs from the source's nesting
(implied elements, adopted formatting elements, foster parented table
content), so it can't be a view over the token tree; and keeping it
apart means editing tokens (`Attribute.withValue`) works as before.

The built tree is an arena: parallel lists of each node's kind, name,
namespace, parent, children (as first, last, next, and previous
sibling), token, attributes, and text, with nodes as `Int`s. Moving a
node, as the adoption agency algorithm and foster parenting do, is a
few list writes; there are no node objects to garbage collect, and no
parent links to make a cycle, which reference-counted backends would
leak. Views (`Element`, `BuiltText`, and the others) wrap the arena
and a node number.

## Kinds of node, and namespaces

    let documentNode = 0;
    let elementNode = 1;
    let textNode = 2;
    let commentNode = 3;
    let doctypeNode = 4;
    let piNode = 5;
    let fragmentNode = 6;

    let htmlNs = 0;
    let svgNs = 1;
    let mathNs = 2;

## The arena

Exported only because the views hold it; read the tree through them.

    export class BuiltTree {
      public kinds: ListBuilder<Int> = new ListBuilder<Int>();
      public names: ListBuilder<String> = new ListBuilder<String>();
      public spaces: ListBuilder<Int> = new ListBuilder<Int>();
      public datas: ListBuilder<String> = new ListBuilder<String>();
      public parents: ListBuilder<Int> = new ListBuilder<Int>();
      public firsts: ListBuilder<Int> = new ListBuilder<Int>();
      public lasts: ListBuilder<Int> = new ListBuilder<Int>();
      public nexts: ListBuilder<Int> = new ListBuilder<Int>();
      public prevs: ListBuilder<Int> = new ListBuilder<Int>();
      public tokenIndexes: ListBuilder<Int> = new ListBuilder<Int>();
      public tokenOffsets: ListBuilder<Int> = new ListBuilder<Int>();

Attributes as (namespace designator, local name, value) triples, as
the standard's foreign attributes have them: `""` for most, or
`"xlink"`, `"xml"`, or `"xmlns"`.

      public attributeLists: ListBuilder<List<String>> = new ListBuilder<List<String>>();

A template element's contents, a fragment node, or -1.

      public contents: ListBuilder<Int> = new ListBuilder<Int>();

The document's quirks mode, once parsed. For a fragment, the `html`
element whose children are the fragment, and the context element
(detached, so not in the tree), each -1 for a document, and whether
the context is inside a form.

      public var quirksMode: String = "no-quirks";
      public var fragmentRoot: Int = -1;
      public var fragmentContext: Int = -1;
      public var contextInsideForm: Boolean = false;

For a parse fed in pieces (a `FragmentStream`), `joined` is set and
each node's token index is into `origins`: the red node it came from,
a token in any tree, or a node of another tree, such as the Markdown
node a synthetic token stands for. Empty otherwise.

      public var joined: Boolean = false;
      public origins: ListBuilder<RedNode> = new ListBuilder<RedNode>();

Nodes copied into a `selectedcontent` from the selected `option` (see
"Customizable select"), each to the parsed node it copies. They share
its token, so its origin; few documents have any, hence a map.

      public clones: MapBuilder<Int, Int> = new MapBuilder<Int, Int>();

      public constructor() {}

      public add(kind: Int, name: String, space: Int, data: String, tokenIndex: Int, tokenOffset: Int, attributes: List<String>): Int {
        let id = kinds.length;
        kinds.add(kind);
        names.add(name);
        spaces.add(space);
        datas.add(data);
        parents.add(-1);
        firsts.add(-1);
        lasts.add(-1);
        nexts.add(-1);
        prevs.add(-1);
        tokenIndexes.add(tokenIndex);
        tokenOffsets.add(tokenOffset);
        attributeLists.add(attributes);
        contents.add(-1);
        id
      }

Inserts `child` into `parent` before `before`, or last for -1.

      public insert(parent: Int, child: Int, before: Int): Void {
        detach(child);
        parents.set(child, parent);
        if (before < 0) {
          let last = lasts[parent];
          prevs.set(child, last);
          if (last >= 0) { nexts.set(last, child); } else { firsts.set(parent, child); }
          lasts.set(parent, child);
        } else {
          let prev = prevs[before];
          prevs.set(child, prev);
          nexts.set(child, before);
          prevs.set(before, child);
          if (prev >= 0) { nexts.set(prev, child); } else { firsts.set(parent, child); }
        }
      }

      public detach(child: Int): Void {
        let parent = parents[child];
        if (parent < 0) { return; }
        let prev = prevs[child];
        let next = nexts[child];
        if (prev >= 0) { nexts.set(prev, next); } else { firsts.set(parent, next); }
        if (next >= 0) { prevs.set(next, prev); } else { lasts.set(parent, prev); }
        parents.set(child, -1);
        prevs.set(child, -1);
        nexts.set(child, -1);
      }

      public isHtml(id: Int, name: String): Boolean {
        spaces[id] == htmlNs && kinds[id] == elementNode && names[id] == name
      }
    }

## Names the rules check

    let nameSet(names: String): Map<String, Boolean> {
      let set = new MapBuilder<String, Boolean>();
      let all = names.split(" ");
      for (var i = 0; i < all.length; i += 1) { set[all[i]] = true; }
      set.toMap()
    }

Lowercase to mixed-case names, from the mixed-case ones.

    let caseMap(names: String): Map<String, String> {
      let map = new MapBuilder<String, String>();
      let all = names.split(" ");
      for (var i = 0; i < all.length; i += 1) { map[asciiLowercase(all[i])] = all[i]; }
      map.toMap()
    }

    let specialHtml = nameSet(
      "address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp"
    );
    let formattingNames = nameSet("a b big code em font i nobr s small strike strong tt u");
    let impliedEndNames = nameSet("dd dt li optgroup option p rb rp rt rtc");
    let thoroughEndNames = nameSet("caption colgroup dd dt li optgroup option p rb rp rt rtc tbody td tfoot th thead tr");
    let eofAllowedNames = nameSet("dd dt li optgroup option p rb rp rt rtc tbody td tfoot th thead tr body html");
    let closesPNames = nameSet(
      "address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p search section summary ul"
    );
    let blockEndNames = nameSet(
      "address article aside blockquote button center details dialog dir div dl fieldset figcaption figure footer header hgroup listing main menu nav ol pre search section select summary ul"
    );
    let headingNames = nameSet("h1 h2 h3 h4 h5 h6");
    let inHeadStartNames = nameSet("base basefont bgsound link meta noframes script style template title");
    let ignoredInBodyNames = nameSet("caption col colgroup frame head tbody td tfoot th thead tr");
    let tableSectionNames = nameSet("tbody tfoot thead");
    let tableContextNames = nameSet("table tbody template tfoot thead tr");
    let breakoutNames = nameSet(
      "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var"
    );
    let svgTagNames = caseMap(
      "altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath"
    );
    let svgAttributeNames = caseMap(
      "attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits diffuseConstant edgeMode filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan"
    );

## Insertion modes

    let initialMode = 0;
    let beforeHtmlMode = 1;
    let beforeHeadMode = 2;
    let inHeadMode = 3;
    let inHeadNoscriptMode = 4;
    let afterHeadMode = 5;
    let inBodyMode = 6;
    let textMode = 7;
    let inTableMode = 8;
    let inTableTextMode = 9;
    let inCaptionMode = 10;
    let inColumnGroupMode = 11;
    let inTableBodyMode = 12;
    let inRowMode = 13;
    let inCellMode = 14;
    let inTemplateMode = 15;
    let afterBodyMode = 16;
    let inFramesetMode = 17;
    let afterFramesetMode = 18;
    let afterAfterBodyMode = 19;
    let afterAfterFramesetMode = 20;

## Tokens, as tree construction reads them

One object, reused for every token. Text is the decoded text of a run
(what `Text.text` gives), so references, `\r\n`, and NUL are as the
standard's character tokens have them; the rules take it a run at a
time, splitting off what they treat differently.

    let charToken = 1;
    let commentToken = 2;
    let doctypeToken = 3;
    let startToken = 4;
    let endToken = 5;
    let eofToken = 6;
    let piToken = 7;

    class TreeToken {
      public var kind: Int = 0;
      public var name: String = "";
      public var text: String = "";
      public var selfClosing: Boolean = false;
      public var tokenAttributes: List<String> = noStrings;
      public var index: Int = -1;
      public var offset: Int = 0;
      public var doctype: Doctype? = null;
      public constructor() {}

      public attribute(name: String): String? {
        for (var i = 0; i + 2 < tokenAttributes.length; i += 3) {
          if (tokenAttributes[i + 1] == name) { return tokenAttributes[i + 2]; }
        }
        null
      }
    }

An attribute's name (`isName`) or value, as `Attribute` reads it.

    let greenAttributePart(attribute: GreenNode, kind: Kind, isName: Boolean): String {
      let kids = attribute.children;
      for (var i = 0; i < kids.length; i += 1) {
        if (kids[i].kind.id == kind.id) {
          let text = (kids[i] as GreenToken orelse panic()).text;
          return if (isName) { htmlName(text) } else { decodeAttributeValue(unquote(text)) };
        }
      }
      if (isName) { htmlName("") } else { "" }
    }

    let whitespaceEnd(text: String): StringIndex {
      var i = String.begin;
      while (text.hasIndex(i) && isAsciiWhitespace(text[i])) { i = text.next(i); }
      i
    }

    let noStrings: List<String> = new ListBuilder<String>().toList();

    let allWhitespace(text: String): Boolean { !text.hasIndex(whitespaceEnd(text)) }

    let startsWith(text: String, prefix: String): Boolean {
      var i = String.begin;
      var j = String.begin;
      while (prefix.hasIndex(j)) {
        if (!text.hasIndex(i) || text[i] != prefix[j]) { return false; }
        i = text.next(i);
        j = prefix.next(j);
      }
      true
    }

## The builder

    class TreeBuilder extends TokenSink {
      public tree: BuiltTree = new BuiltTree();
      public scripting: Boolean;
      public var quirks: String = "no-quirks";
      private token: TreeToken = new TreeToken();
      private stack: ListBuilder<Int> = new ListBuilder<Int>();

The list of active formatting elements; -1 is a marker.

      private formatting: ListBuilder<Int> = new ListBuilder<Int>();
      private templateModes: ListBuilder<Int> = new ListBuilder<Int>();
      private var mode: Int = initialMode;
      private var originalMode: Int = initialMode;
      private var head: Int = -1;
      private var form: Int = -1;
      private var framesetOk: Boolean = true;
      private var fosterParenting: Boolean = false;
      private var skipNewline: Boolean = false;
      private var nextState: Int = 0;
      private var pendingText: StringBuilder = new StringBuilder();
      private var pendingNonSpace: Boolean = false;

Where the next node goes, as the appropriate place for inserting a
node gives it: a parent and the child to go before, or -1 for last.

      private var placeParent: Int = 0;
      private var placeBefore: Int = -1;

The context element when parsing a fragment, or -1.

      private var contextNode: Int = -1;

For customizable select: whether any `select`, and any `selectedcontent`
a `select` updates, has been inserted (so documents without them pay
one check per element); each `option`'s select and each select's
selected option, and the `selectedcontent` elements of each select,
as lists in `contentLists`, by index.

      private var sawSelect: Boolean = false;
      private var sawSelectedContent: Boolean = false;
      private optionSelects: MapBuilder<Int, Int> = new MapBuilder<Int, Int>();
      private selectedOptions: MapBuilder<Int, Int> = new MapBuilder<Int, Int>();
      private contentListOf: MapBuilder<Int, Int> = new MapBuilder<Int, Int>();
      private contentLists: ListBuilder<ListBuilder<Int>> = new ListBuilder<ListBuilder<Int>>();

      public constructor(scripting: Boolean) {
        this.scripting = scripting;
        tree.add(documentNode, "", htmlNs, "", -1, 0, noStrings);
      }

### Starting a fragment

The standard's fragment parsing algorithm, before the tokens: an
`html` root on the stack, the context element known but not in the
tree, the insertion mode reset from it, the form element pointer set
if it's in a form, and the tokenizer's state from it, which this gives
(as a `ContentState`'s id). The context's document's quirks mode
carries over, which matters only for `<table>` closing a `<p>`.

      public startFragment(context: FragmentContext): Int {
        quirks = context.quirksMode;
        let space = if (context.namespace == "svg") { svgNs } else if (context.namespace == "math") { mathNs } else { htmlNs };
        let root = tree.add(elementNode, "html", htmlNs, "", -1, 0, noStrings);
        tree.insert(0, root, -1);
        stack.add(root);
        let triples = new ListBuilder<String>();
        let attributes = context.attributes;
        for (var i = 0; i < attributes.length; i += 1) {
          triples.add(attributes[i].prefix);
          triples.add(attributes[i].name);
          triples.add(attributes[i].value);
        }
        let name = if (space == htmlNs) { asciiLowercase(context.name) } else { context.name };
        contextNode = tree.add(elementNode, name, space, "", -1, 0, triples.toList());
        tree.fragmentRoot = root;
        tree.fragmentContext = contextNode;
        tree.contextInsideForm = context.insideForm;
        let htmlName = if (space == htmlNs) { name } else { "" };
        if (htmlName == "template") { templateModes.add(inTemplateMode); }
        resetMode();
        if (htmlName == "form") {
          form = contextNode;
        } else if (context.insideForm) {
          form = tree.add(elementNode, "form", htmlNs, "", -1, 0, noStrings);
        }
        if (htmlName == "title" || htmlName == "textarea") {
          ContentState.rcdata.id
        } else if (
          htmlName == "style" || htmlName == "xmp" || htmlName == "iframe" || htmlName == "noembed" ||
          htmlName == "noframes" || (htmlName == "noscript" && scripting)
        ) {
          ContentState.rawtext.id
        } else if (htmlName == "script") {
          ContentState.scriptData.id
        } else if (htmlName == "plaintext") {
          ContentState.plaintext.id
        } else {
          ContentState.data.id
        }
      }

### Taking tokens

      public take(green: GreenNode, offset: Int, index: Int): Int {
        let t = token;
        t.index = index;
        t.offset = offset;
        t.selfClosing = false;
        t.tokenAttributes = noStrings;
        nextState = 0;
        if (readGreen(green, t)) {
          if (t.kind != charToken || !t.text.isEmpty) { process(t); }
          return nextState;
        }
        let red = new RedNode(green, null, offset, index);
        let view = htmlTokenOf(red);
        when (view) {
          is StartTag -> do {
            t.kind = startToken;
            t.name = view.name;
            t.selfClosing = view.selfClosing;
            let attributes = view.attributes;
            if (!attributes.isEmpty) {
              let triples = new ListBuilder<String>();
              for (var i = 0; i < attributes.length; i += 1) {
                triples.add("");
                triples.add(attributes[i].name);
                triples.add(attributes[i].value);
              }
              t.tokenAttributes = triples.toList();
            }
          }
          is EndTag -> do {
            t.kind = endToken;
            t.name = view.name;
          }
          is Comment -> do {
            t.kind = commentToken;
            t.text = view.text;
          }
          is ProcessingInstruction -> do {
            t.kind = piToken;
            t.name = view.target;
            t.text = view.data;
          }
          is Doctype -> do {
            t.kind = doctypeToken;
            t.name = view.name ?? "";
            t.doctype = view;
          }
          is Text -> do {
            t.kind = charToken;
            t.text = view.text;
            if (t.text.isEmpty) { return 0; }
          }
          else -> return 0;
        }
        process(t);
        nextState
      }

Tags and plain text, the most of most documents, read from the green
tree directly, as the views would read them, without making views:
whether `green` was one of those.

      private readGreen(green: GreenNode, t: TreeToken): Boolean {
        let id = green.kind.id;
        let kids = green.children;
        if (id == htmlTextKind.id) {
          if (kids.length != 1 || kids[0].kind.id != charsKind.id) { return false; }
          t.kind = charToken;
          t.text = normalizeText((kids[0] as GreenToken orelse panic()).text, false);
          return true;
        }
        if (id != startTagKind.id && id != endTagKind.id) { return false; }
        t.kind = if (id == startTagKind.id) { startToken } else { endToken };
        var name = "";
        var named = false;
        let triples = new ListBuilder<String>();
        for (var i = 0; i < kids.length; i += 1) {
          let kid = kids[i];
          let kidId = kid.kind.id;
          if (kidId == tagNameKind.id && !named) {
            name = htmlName((kid as GreenToken orelse panic()).text);
            named = true;
          } else if (kidId == selfClosingKind.id && id == startTagKind.id) {
            // One condition: C# drops braces around a lone inner `if`,
            // so a following `else` would go with it.
            t.selfClosing = true;
          } else if (kidId == attributeKind.id && id == startTagKind.id) {
            let attribute = kid as GreenNode orelse panic();
            triples.add("");
            triples.add(greenAttributePart(attribute, attributeNameKind, true));
            triples.add(greenAttributePart(attribute, attributeValueKind, false));
          }
        }
        t.name = name;
        if (!triples.isEmpty) { t.tokenAttributes = triples.toList(); }
        true
      }

Synthetic tokens, for a parse fed in pieces: a start tag without
attributes, giving the state the tokenizer goes on in, an end tag,
and text as decoded, each with its index among the stream's origins.

      public takeStart(name: String, selfClosing: Boolean, index: Int): Int {
        let t = token;
        t.kind = startToken;
        t.name = name;
        t.selfClosing = selfClosing;
        t.tokenAttributes = noStrings;
        t.index = index;
        t.offset = 0;
        nextState = 0;
        process(t);
        nextState
      }

      public takeEnd(name: String, index: Int): Void {
        let t = token;
        t.kind = endToken;
        t.name = name;
        t.selfClosing = false;
        t.tokenAttributes = noStrings;
        t.index = index;
        t.offset = 0;
        process(t);
      }

      public takeText(text: String, index: Int): Void {
        if (text.isEmpty) { return; }
        let t = token;
        t.kind = charToken;
        t.text = text;
        t.index = index;
        t.offset = 0;
        process(t);
      }

      public cdataAllowed(): Boolean {
        !stack.isEmpty && tree.spaces[adjustedCurrent()] != htmlNs
      }

      public end(): Void {
        let t = token;
        t.kind = eofToken;
        t.index = -1;
        process(t);
        while (!stack.isEmpty) {
          let node = stack.removeLast();
          if (sawSelectedContent) { optionClosed(node); }
        }
        tree.quirksMode = quirks;
      }

The tree construction dispatcher: each rule gives whether to
reprocess the token, in whatever mode it switched to.

      private process(t: TreeToken): Void {
        if (skipNewline) {
          skipNewline = false;
          if (t.kind == charToken && t.text.hasIndex(String.begin) && t.text[String.begin] == char'\n') {
            t.text = t.text.slice(t.text.next(String.begin), t.text.end);
            if (t.text.isEmpty) { return; }
          }
        }
        var again = true;
        while (again) {
          again = if (inHtmlContent(t)) { byMode(t, mode) } else { inForeign(t) };
        }
      }

      private inHtmlContent(t: TreeToken): Boolean {
        if (stack.isEmpty || t.kind == eofToken) { return true; }
        let node = adjustedCurrent();
        let space = tree.spaces[node];
        if (space == htmlNs) { return true; }
        let name = tree.names[node];
        if (space == mathNs && isMathTextPoint(name)) {
          if (t.kind == charToken) { return true; }
          if (t.kind == startToken && t.name != "mglyph" && t.name != "malignmark") { return true; }
        }
        if (space == mathNs && name == "annotation-xml" && t.kind == startToken && t.name == "svg") { return true; }
        if (isHtmlIntegrationPoint(node) && (t.kind == startToken || t.kind == charToken)) { return true; }
        false
      }

      private byMode(t: TreeToken, m: Int): Boolean {
        when (m) {
          initialMode -> initial(t);
          beforeHtmlMode -> beforeHtml(t);
          beforeHeadMode -> beforeHead(t);
          inHeadMode -> inHead(t);
          inHeadNoscriptMode -> inHeadNoscript(t);
          afterHeadMode -> afterHead(t);
          inBodyMode -> inBody(t);
          textMode -> inText(t);
          inTableMode -> inTable(t);
          inTableTextMode -> inTableText(t);
          inCaptionMode -> inCaption(t);
          inColumnGroupMode -> inColumnGroup(t);
          inTableBodyMode -> inTableBody(t);
          inRowMode -> inRow(t);
          inCellMode -> inCell(t);
          inTemplateMode -> inTemplate(t);
          afterBodyMode -> afterBody(t);
          inFramesetMode -> inFrameset(t);
          afterFramesetMode -> afterFrameset(t);
          afterAfterBodyMode -> afterAfterBody(t);
          else -> afterAfterFrameset(t);
        }
      }

### The stack and its scopes

      private current(): Int { stack[stack.length - 1] }

The context element stands in for the `html` root of a fragment.

      private adjustedCurrent(): Int {
        if (contextNode >= 0 && stack.length == 1) { contextNode } else { current() }
      }

      private currentIs(name: String): Boolean { !stack.isEmpty && tree.isHtml(current(), name) }

      private isSpecial(id: Int): Boolean {
        let name = tree.names[id];
        let space = tree.spaces[id];
        if (space == htmlNs) {
          specialHtml.has(name)
        } else if (space == mathNs) {
          isMathTextPoint(name) || name == "annotation-xml"
        } else {
          name == "foreignObject" || name == "desc" || name == "title"
        }
      }

      private isMathTextPoint(name: String): Boolean {
        name == "mi" || name == "mo" || name == "mn" || name == "ms" || name == "mtext"
      }

      private isHtmlIntegrationPoint(id: Int): Boolean {
        let space = tree.spaces[id];
        let name = tree.names[id];
        if (space == svgNs) {
          return name == "foreignObject" || name == "desc" || name == "title";
        }
        if (space == mathNs && name == "annotation-xml") {
          let attributes = tree.attributeLists[id];
          for (var i = 0; i + 2 < attributes.length; i += 3) {
            if (attributes[i + 1] == "encoding") {
              let value = asciiLowercase(attributes[i + 2]);
              return value == "text/html" || value == "application/xhtml+xml";
            }
          }
        }
        false
      }

Scopes: 0 the plain one, 1 list item, 2 button, 3 table. Whether an
HTML element named `name` is in that scope.

      private inScope(name: String, scope: Int): Boolean {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          let node = stack[i];
          if (tree.isHtml(node, name)) { return true; }
          if (isScopeEdge(node, scope)) { return false; }
        }
        false
      }

      private isScopeEdge(node: Int, scope: Int): Boolean {
        let n = tree.names[node];
        let space = tree.spaces[node];
        if (space == htmlNs) {
          if (n == "html" || n == "table" || n == "template") { return true; }
          if (scope == 3) { return false; }
          if (
            n == "applet" || n == "caption" || n == "td" || n == "th" || n == "marquee" ||
            n == "object" || n == "select"
          ) { return true; }
          if (scope == 1) { return n == "ol" || n == "ul"; }
          if (scope == 2) { return n == "button"; }
          return false;
        }
        scope != 3 && (isSpecial(node))
      }

      private nodeInScope(target: Int): Boolean {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          let node = stack[i];
          if (node == target) { return true; }
          if (isScopeEdge(node, 0)) { return false; }
        }
        false
      }

      private headingInScope(): Boolean {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          let node = stack[i];
          if (tree.spaces[node] == htmlNs && headingNames.has(tree.names[node])) { return true; }
          if (isScopeEdge(node, 0)) { return false; }
        }
        false
      }

      private stackIndexOf(node: Int): Int {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          if (stack[i] == node) { return i; }
        }
        -1
      }

      private hasTemplate(): Boolean {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          if (tree.isHtml(stack[i], "template")) { return true; }
        }
        false
      }

Whether in a `template`, or in a fragment whose context is one, as
the form element pointer's rules ask.

      private parsingTemplateContents(): Boolean {
        hasTemplate() || contextIs("template")
      }

      private contextIs(name: String): Boolean { contextNode >= 0 && tree.isHtml(contextNode, name) }

      private popUntil(name: String): Void {
        while (!stack.isEmpty) {
          let node = pop();
          if (tree.isHtml(node, name)) { return; }
        }
      }

      private popUntilHeading(): Void {
        while (!stack.isEmpty) {
          let node = pop();
          if (tree.spaces[node] == htmlNs && headingNames.has(tree.names[node])) { return; }
        }
      }

      private removeFromStack(node: Int): Void {
        let at = stackIndexOf(node);
        if (at >= 0) { removeFromStackAt(at); }
      }

Every element leaves the stack through `pop` or `removeFromStackAt`,
so an `option` leaving it can update `selectedcontent` (see
"Customizable select", below). The standard says "popped"; the
adoption agency algorithm's removals count too, as in browsers, which
finish an element either way.

      private pop(): Int {
        let node = stack.removeLast();
        if (sawSelectedContent) { optionClosed(node); }
        node
      }

      private removeFromStackAt(at: Int): Void {
        let node = stack[at];
        stack.splice(at, 1);
        if (sawSelectedContent) { optionClosed(node); }
      }

Generates implied end tags, except for HTML elements named `except`.

      private impliedEnd(except: String): Void {
        while (!stack.isEmpty) {
          let node = current();
          let name = tree.names[node];
          if (tree.spaces[node] != htmlNs || name == except || !impliedEndNames.has(name)) { return; }
          pop();
        }
      }

      private impliedEndThoroughly(): Void {
        while (!stack.isEmpty) {
          let node = current();
          if (tree.spaces[node] != htmlNs || !thoroughEndNames.has(tree.names[node])) { return; }
          pop();
        }
      }

      private closeP(): Void {
        impliedEnd("p");
        popUntil("p");
      }

      private closePInButtonScope(): Void {
        if (inScope("p", 2)) { closeP(); }
      }

### Inserting

The appropriate place for inserting a node, with foster parenting.

      private place(target: Int): Void {
        placeBefore = -1;
        placeParent = target;
        if (
          fosterParenting && tree.spaces[target] == htmlNs && tree.kinds[target] == elementNode &&
          tableContextNames.has(tree.names[target]) && tree.names[target] != "template"
        ) {
          var lastTemplate = -1;
          var lastTable = -1;
          for (var i = stack.length - 1; i >= 0; i -= 1) {
            if (lastTemplate < 0 && tree.isHtml(stack[i], "template")) { lastTemplate = i; }
            if (lastTable < 0 && tree.isHtml(stack[i], "table")) { lastTable = i; }
          }
          if (lastTemplate >= 0 && (lastTable < 0 || lastTemplate > lastTable)) {
            placeParent = stack[lastTemplate];
          } else if (lastTable < 0) {
            placeParent = stack[0];
          } else {
            let table = stack[lastTable];
            let parent = tree.parents[table];
            if (parent >= 0) {
              placeParent = parent;
              placeBefore = table;
              return;
            }
            placeParent = stack[lastTable - 1];
          }
        }
        if (tree.isHtml(placeParent, "template")) { placeParent = tree.contents[placeParent]; }
      }

      private createElement(t: TreeToken, name: String, space: Int): Int {
        let id = tree.add(elementNode, name, space, "", t.index, t.offset, t.tokenAttributes);
        if (space == htmlNs && name == "template") {
          tree.contents.set(id, tree.add(fragmentNode, "", htmlNs, "", -1, 0, noStrings));
        }
        id
      }

      private insertElement(t: TreeToken, name: String, space: Int): Int {
        let id = createElement(t, name, space);
        place(current());
        tree.insert(placeParent, id, placeBefore);
        stack.add(id);
        if (space == htmlNs) {
          if (name == "select") {
            sawSelect = true;
          } else if (sawSelect) {
            if (name == "option") {
              optionInserted(id);
            } else if (name == "selectedcontent") {
              selectedContentInserted(id);
            }
          }
        }
        id
      }

      private insertHtml(t: TreeToken): Int { insertElement(t, t.name, htmlNs) }

An element the standard implies, from no token.

      private insertImplied(name: String): Int {
        let id = tree.add(elementNode, name, htmlNs, "", -1, 0, noStrings);
        place(current());
        tree.insert(placeParent, id, placeBefore);
        stack.add(id);
        id
      }

      private insertForeign(t: TreeToken, space: Int): Void {
        var name = t.name;
        if (space == svgNs) { name = svgTagNames.getOr(name, name); }
        adjustAttributes(t, space);
        insertElement(t, name, space);
        if (t.selfClosing) { pop(); }
      }

Adjusts MathML or SVG attribute names, and foreign ones.

      private adjustAttributes(t: TreeToken, space: Int): Void {
        let attributes = t.tokenAttributes;
        if (attributes.isEmpty) { return; }
        let out = new ListBuilder<String>();
        for (var i = 0; i + 2 < attributes.length; i += 3) {
          var prefix = "";
          var name = attributes[i + 1];
          if (space == mathNs && name == "definitionurl") {
            name = "definitionURL";
          } else if (space == svgNs) {
            name = svgAttributeNames.getOr(name, name);
          }
          if (startsWith(name, "xlink:")) {
            let local = name.slice(name.step(String.begin, 6), name.end);
            if (
              local == "actuate" || local == "arcrole" || local == "href" || local == "role" ||
              local == "show" || local == "title" || local == "type"
            ) {
              prefix = "xlink";
              name = local;
            }
          } else if (name == "xml:lang" || name == "xml:space") {
            prefix = "xml";
            name = name.slice(name.step(String.begin, 4), name.end);
          } else if (name == "xmlns") {
            prefix = "xmlns";
          } else if (name == "xmlns:xlink") {
            prefix = "xmlns";
            name = "xlink";
          }
          out.add(prefix);
          out.add(name);
          out.add(attributes[i + 2]);
        }
        t.tokenAttributes = out.toList();
      }

      private insertText(text: String): Void {
        place(current());
        insertTextAt(text);
      }

      private insertTextAt(text: String): Void {
        let parent = placeParent;
        if (tree.kinds[parent] == documentNode) { return; }
        let previous = if (placeBefore >= 0) { tree.prevs[placeBefore] } else { tree.lasts[parent] };
        if (previous >= 0 && tree.kinds[previous] == textNode) {
          tree.datas.set(previous, "${tree.datas[previous]}${text}");
        } else {
          let id = tree.add(textNode, "", htmlNs, text, token.index, token.offset, noStrings);
          tree.insert(parent, id, placeBefore);
        }
      }

Inserts a comment or processing instruction, into `parent` if not
-1, otherwise at the appropriate place.

      private insertOther(t: TreeToken, parent: Int): Void {
        let kind = if (t.kind == piToken) { piNode } else { commentNode };
        let id = tree.add(kind, if (kind == piNode) { t.name } else { "" }, htmlNs, t.text, t.index, t.offset, noStrings);
        if (parent >= 0) {
          tree.insert(parent, id, -1);
        } else {
          place(current());
          tree.insert(placeParent, id, placeBefore);
        }
      }

      private rawText(t: TreeToken, state: Int): Void {
        insertHtml(t);
        nextState = state;
        originalMode = mode;
        mode = textMode;
      }

### Active formatting elements

      private pushFormatting(id: Int): Void {
        var count = 0;
        var earliest = -1;
        for (var i = formatting.length - 1; i >= 0; i -= 1) {
          let entry = formatting[i];
          if (entry < 0) { break; }
          if (sameElement(entry, id)) {
            count += 1;
            earliest = i;
          }
        }
        if (count >= 3) { formatting.splice(earliest, 1); }
        formatting.add(id);
      }

      private sameElement(a: Int, b: Int): Boolean {
        if (tree.names[a] != tree.names[b] || tree.spaces[a] != tree.spaces[b]) { return false; }
        let x = tree.attributeLists[a];
        let y = tree.attributeLists[b];
        if (x.length != y.length) { return false; }
        for (var i = 0; i + 2 < x.length; i += 3) {
          var found = false;
          for (var j = 0; j + 2 < y.length; j += 3) {
            if (x[i] == y[j] && x[i + 1] == y[j + 1] && x[i + 2] == y[j + 2]) { found = true; }
          }
          if (!found) { return false; }
        }
        true
      }

      private reconstruct(): Void {
        if (formatting.isEmpty) { return; }
        let last = formatting[formatting.length - 1];
        if (last < 0 || stackIndexOf(last) >= 0) { return; }
        var at = formatting.length - 1;
        while (at > 0) {
          let entry = formatting[at - 1];
          if (entry < 0 || stackIndexOf(entry) >= 0) { break; }
          at -= 1;
        }
        while (at < formatting.length) {
          let copy = cloneElement(formatting[at]);
          place(current());
          tree.insert(placeParent, copy, placeBefore);
          stack.add(copy);
          formatting.set(at, copy);
          at += 1;
        }
      }

A new element for the token `old` was made for, without children.

      private cloneElement(old: Int): Int {
        tree.add(
          elementNode, tree.names[old], tree.spaces[old], "", tree.tokenIndexes[old],
          tree.tokenOffsets[old], tree.attributeLists[old],
        )
      }

      private clearFormattingToMarker(): Void {
        while (!formatting.isEmpty) {
          if (formatting.removeLast() < 0) { return; }
        }
      }

      private formattingIndexOf(node: Int): Int {
        for (var i = formatting.length - 1; i >= 0; i -= 1) {
          if (formatting[i] == node) { return i; }
        }
        -1
      }

The adoption agency algorithm. Gives false where the standard says
to act as for any other end tag.

      private adoption(subject: String): Boolean {
        let top = current();
        if (tree.isHtml(top, subject) && formattingIndexOf(top) < 0) {
          pop();
          return true;
        }
        for (var outer = 0; outer < 8; outer += 1) {
          var formattingAt = -1;
          for (var i = formatting.length - 1; i >= 0; i -= 1) {
            let entry = formatting[i];
            if (entry < 0) { break; }
            if (tree.isHtml(entry, subject)) {
              formattingAt = i;
              break;
            }
          }
          if (formattingAt < 0) { return false; }
          let element = formatting[formattingAt];
          let stackAt = stackIndexOf(element);
          if (stackAt < 0) {
            formatting.splice(formattingAt, 1);
            return true;
          }
          if (!nodeInScope(element)) { return true; }
          var furthestAt = -1;
          for (var i = stackAt + 1; i < stack.length; i += 1) {
            if (isSpecial(stack[i])) {
              furthestAt = i;
              break;
            }
          }
          if (furthestAt < 0) {
            while (stack.length > stackAt) { pop(); }
            formatting.splice(formattingAt, 1);
            return true;
          }
          let furthest = stack[furthestAt];
          let commonAncestor = stack[stackAt - 1];
          var bookmark = formattingAt;
          var node = furthest;
          var lastNode = furthest;
          var nodeAt = furthestAt;
          var inner = 0;
          while (true) {
            inner += 1;
            nodeAt -= 1;
            node = stack[nodeAt];
            if (node == element) { break; }
            var nodeFormattingAt = formattingIndexOf(node);
            if (inner > 3 && nodeFormattingAt >= 0) {
              formatting.splice(nodeFormattingAt, 1);
              if (nodeFormattingAt < bookmark) { bookmark -= 1; }
              nodeFormattingAt = -1;
            }
            if (nodeFormattingAt < 0) {
              removeFromStackAt(nodeAt);
              continue;
            }
            let copy = cloneElement(node);
            formatting.set(nodeFormattingAt, copy);
            stack.set(nodeAt, copy);
            node = copy;
            if (lastNode == furthest) { bookmark = nodeFormattingAt + 1; }
            tree.insert(node, lastNode, -1);
            lastNode = node;
          }
          place(commonAncestor);
          tree.insert(placeParent, lastNode, placeBefore);
          let copy = cloneElement(element);
          var child = tree.firsts[furthest];
          while (child >= 0) {
            let next = tree.nexts[child];
            tree.insert(copy, child, -1);
            child = next;
          }
          tree.insert(furthest, copy, -1);
          let oldAt = formattingIndexOf(element);
          formatting.splice(oldAt, 1);
          if (oldAt < bookmark) { bookmark -= 1; }
          formatting.add(copy, bookmark);
          removeFromStack(element);
          stack.add(copy, stackIndexOf(furthest) + 1);
        }
        true
      }

### Customizable select

A `selectedcontent` in a `select`'s `button` shows a copy of the
selected `option`'s contents. The standard does this in the DOM, as
options are inserted and as the parser pops each one off the stack;
here, as the parser goes, from what it has built so far, in the order
the standard runs it:

- **An `option` inserted** finds its select (the nearest `select`
  ancestor, unless a `datalist`, `hr`, `option`, or a second
  `optgroup` comes first) and runs the selectedness setting
  algorithm: one with `selected` becomes the selected option (the last
  such wins), and if none is yet, the first that isn't disabled, if
  the select's display size is 1. If it's the selected one, the
  select's `selectedcontent` elements copy it (empty, so far).
- **A `selectedcontent` inserted** finds its select (none if inside an
  `option`, another `selectedcontent`, or two `select`s) and copies the
  selected option, if any.
- **An `option` popped** that's its select's selected option is copied
  again, now with its contents.

Nothing is done for a `select` with `multiple`, as the standard says.
Copies replace a `selectedcontent`'s children, and are new nodes in
`BuiltTree.clones`. Not done: the standard's later updates as script
moves or removes options (nothing in a parse does that but the
adoption agency algorithm moving a block with options in it, so rare
that it's left out), and options inside a copy, which take no part.

      private optionInserted(option: Int): Void {
        let select = nearestSelect(option);
        if (select < 0) { return; }
        optionSelects[option] = select;
        if (hasAttribute(select, "multiple")) { return; }
        if (hasAttribute(option, "selected")) {
          selectedOptions[select] = option;
        } else if (selectedOptions.getOr(select, -1) < 0 && displaySizeIsOne(select) && !optionDisabled(option)) {
          selectedOptions[select] = option;
        }
        if (selectedOptions.getOr(select, -1) == option) { updateSelectedContents(select); }
      }

      private selectedContentInserted(content: Int): Void {
        var select = -1;
        var node = tree.parents[content];
        while (node >= 0) {
          if (tree.isHtml(node, "select")) {
            if (select >= 0) { return; }
            select = node;
          } else if (tree.isHtml(node, "option") || tree.isHtml(node, "selectedcontent")) {
            return;
          }
          node = tree.parents[node];
        }
        if (select < 0) { return; }
        sawSelectedContent = true;
        var at = contentListOf.getOr(select, -1);
        if (at < 0) {
          at = contentLists.length;
          contentListOf[select] = at;
          contentLists.add(new ListBuilder<Int>());
        }
        contentLists[at].add(content);
        if (!hasAttribute(select, "multiple")) { copyOption(selectedOptions.getOr(select, -1), content); }
      }

      private optionClosed(node: Int): Void {
        if (!tree.isHtml(node, "option")) { return; }
        let select = optionSelects.getOr(node, -1);
        if (select >= 0 && selectedOptions.getOr(select, -1) == node) { updateSelectedContents(select); }
      }

      private updateSelectedContents(select: Int): Void {
        let at = contentListOf.getOr(select, -1);
        if (at < 0) { return; }
        let option = selectedOptions.getOr(select, -1);
        let contents = contentLists[at];
        for (var i = 0; i < contents.length; i += 1) { copyOption(option, contents[i]); }
      }

The standard's nearest ancestor `select` of an `option`, or -1.

      private nearestSelect(option: Int): Int {
        var optgroup = false;
        var node = tree.parents[option];
        while (node >= 0) {
          if (tree.kinds[node] == elementNode && tree.spaces[node] == htmlNs) {
            let name = tree.names[node];
            if (name == "datalist" || name == "hr" || name == "option") { return -1; }
            if (name == "optgroup") {
              if (optgroup) { return -1; }
              optgroup = true;
            }
            if (name == "select") { return node; }
          }
          node = tree.parents[node];
        }
        -1
      }

Whether an option is disabled: its own `disabled`, or that of the
`optgroup` it's in.

      private optionDisabled(option: Int): Boolean {
        if (hasAttribute(option, "disabled")) { return true; }
        var node = tree.parents[option];
        while (node >= 0) {
          if (tree.kinds[node] == elementNode && tree.spaces[node] == htmlNs) {
            let name = tree.names[node];
            if (name == "select" || name == "hr" || name == "datalist" || name == "option") { return false; }
            if (name == "optgroup") { return hasAttribute(node, "disabled"); }
          }
          node = tree.parents[node];
        }
        false
      }

Whether a `select` without `multiple` shows one option: its `size`,
by the rules for parsing non-negative integers, is 1, or isn't one.

      private displaySizeIsOne(select: Int): Boolean {
        // Absent reads as "", which isn't a number either.
        let size = attributeValue(select, "size") ?? "";
        var i = whitespaceEnd(size);
        var negative = false;
        if (size.hasIndex(i) && (size[i] == char'-' || size[i] == char'+')) {
          negative = size[i] == char'-';
          i = size.next(i);
        }
        var value = 0;
        var digits = 0;
        while (size.hasIndex(i) && size[i] >= char'0' && size[i] <= char'9') {
          if (value < 10) { value = value * 10 + (size[i] - char'0'); }
          digits += 1;
          i = size.next(i);
        }
        digits == 0 || (negative && value != 0) || value == 1
      }

      private attributeValue(id: Int, name: String): String? {
        let triples = tree.attributeLists[id];
        for (var i = 0; i + 2 < triples.length; i += 3) {
          if (triples[i].isEmpty && triples[i + 1] == name) { return triples[i + 2]; }
        }
        null
      }

      private hasAttribute(id: Int, name: String): Boolean { attributeValue(id, name) != null }

Replaces `content`'s children with copies of `option`'s (none for -1).

      private copyOption(option: Int, content: Int): Void {
        while (tree.firsts[content] >= 0) { tree.detach(tree.firsts[content]); }
        if (option >= 0) { copyChildren(option, content); }
      }

Copies `from`'s children, and theirs, into `to`, without recursing
(but for a `template`'s contents).

      private copyChildren(from: Int, to: Int): Void {
        var source = tree.firsts[from];
        if (source < 0) { return; }
        var parent = to;
        while (true) {
          let copy = tree.add(
            tree.kinds[source], tree.names[source], tree.spaces[source], tree.datas[source],
            tree.tokenIndexes[source], tree.tokenOffsets[source], tree.attributeLists[source],
          );
          tree.clones[copy] = tree.clones.getOr(source, source);
          tree.insert(parent, copy, -1);
          let contents = tree.contents[source];
          if (contents >= 0) {
            let copied = tree.add(fragmentNode, "", htmlNs, "", -1, 0, noStrings);
            tree.contents.set(copy, copied);
            copyChildren(contents, copied);
          }
          if (tree.firsts[source] >= 0) {
            parent = copy;
            source = tree.firsts[source];
            continue;
          }
          while (tree.nexts[source] < 0) {
            source = tree.parents[source];
            if (source == from) { return; }
            parent = tree.parents[parent];
          }
          source = tree.nexts[source];
        }
      }

### Resetting the insertion mode

In a fragment, the context element stands in for the root.

      private resetMode(): Void {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          let last = i == 0;
          let node = if (last && contextNode >= 0) { contextNode } else { stack[i] };
          let name = if (tree.spaces[node] == htmlNs) { tree.names[node] } else { "" };
          if ((name == "td" || name == "th") && !last) {
            mode = inCellMode;
            return;
          }
          if (name == "tr") { mode = inRowMode; return; }
          if (tableSectionNames.has(name)) { mode = inTableBodyMode; return; }
          if (name == "caption") { mode = inCaptionMode; return; }
          if (name == "colgroup") { mode = inColumnGroupMode; return; }
          if (name == "table") { mode = inTableMode; return; }
          if (name == "template") { mode = templateModes[templateModes.length - 1]; return; }
          if (name == "head" && !last) { mode = inHeadMode; return; }
          if (name == "body") { mode = inBodyMode; return; }
          if (name == "frameset") { mode = inFramesetMode; return; }
          if (name == "html") {
            mode = if (head < 0) { beforeHeadMode } else { afterHeadMode };
            return;
          }
          if (last) { mode = inBodyMode; return; }
        }
        mode = inBodyMode;
      }

### The modes before body

      private initial(t: TreeToken): Boolean {
        if (t.kind == charToken) {
          let ws = whitespaceEnd(t.text);
          t.text = t.text.slice(ws, t.text.end);
          if (t.text.isEmpty) { return false; }
        } else if (t.kind == commentToken || t.kind == piToken) {
          insertOther(t, 0);
          return false;
        } else if (t.kind == doctypeToken) {
          let doctype = t.doctype as Doctype orelse panic();
          let id = tree.add(doctypeNode, t.name, htmlNs, "", t.index, t.offset, [
            doctype.publicId ?? "", doctype.systemId ?? "",
          ]);
          tree.insert(0, id, -1);
          quirks = quirksOf(doctype);
          mode = beforeHtmlMode;
          return false;
        }
        quirks = "quirks";
        mode = beforeHtmlMode;
        true
      }

      private beforeHtml(t: TreeToken): Boolean {
        if (t.kind == doctypeToken) { return false; }
        if (t.kind == commentToken || t.kind == piToken) {
          insertOther(t, 0);
          return false;
        }
        if (t.kind == charToken) {
          t.text = t.text.slice(whitespaceEnd(t.text), t.text.end);
          if (t.text.isEmpty) { return false; }
        }
        if (t.kind == startToken && t.name == "html") {
          let id = createElement(t, "html", htmlNs);
          tree.insert(0, id, -1);
          stack.add(id);
          mode = beforeHeadMode;
          return false;
        }
        if (t.kind == endToken && !(t.name == "head" || t.name == "body" || t.name == "html" || t.name == "br")) {
          return false;
        }
        let id = tree.add(elementNode, "html", htmlNs, "", -1, 0, noStrings);
        tree.insert(0, id, -1);
        stack.add(id);
        mode = beforeHeadMode;
        true
      }

      private beforeHead(t: TreeToken): Boolean {
        if (t.kind == charToken) {
          t.text = t.text.slice(whitespaceEnd(t.text), t.text.end);
          if (t.text.isEmpty) { return false; }
        } else if (t.kind == commentToken || t.kind == piToken) {
          insertOther(t, -1);
          return false;
        } else if (t.kind == doctypeToken) {
          return false;
        } else if (t.kind == startToken && t.name == "html") {
          return inBody(t);
        } else if (t.kind == startToken && t.name == "head") {
          head = insertHtml(t);
          mode = inHeadMode;
          return false;
        } else if (t.kind == endToken && !(t.name == "head" || t.name == "body" || t.name == "html" || t.name == "br")) {
          return false;
        }
        head = insertImplied("head");
        mode = inHeadMode;
        true
      }

Inserts leading whitespace and keeps the rest of the text in `t`,
giving whether any is left.

      private insertLeadingWhitespace(t: TreeToken): Boolean {
        let ws = whitespaceEnd(t.text);
        if (ws != String.begin) {
          insertText(t.text.slice(String.begin, ws));
          t.text = t.text.slice(ws, t.text.end);
        }
        !t.text.isEmpty
      }

      private inHead(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          // Two statements: C# drops the braces around a lone `if`,
          // and the `else` below would bind to it.
          let more = insertLeadingWhitespace(t);
          if (!more) { return false; }
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
          return false;
        } else if (kind == doctypeToken) {
          return false;
        } else if (kind == startToken) {
          if (name == "html") { return inBody(t); }
          if (name == "base" || name == "basefont" || name == "bgsound" || name == "link" || name == "meta") {
            insertHtml(t);
            pop();
            return false;
          }
          if (name == "title") {
            rawText(t, ContentState.rcdata.id);
            return false;
          }
          if ((name == "noscript" && scripting) || name == "noframes" || name == "style") {
            rawText(t, ContentState.rawtext.id);
            return false;
          }
          if (name == "noscript") {
            insertHtml(t);
            mode = inHeadNoscriptMode;
            return false;
          }
          if (name == "script") {
            rawText(t, ContentState.scriptData.id);
            return false;
          }
          if (name == "template") {
            insertHtml(t);
            formatting.add(-1);
            framesetOk = false;
            mode = inTemplateMode;
            templateModes.add(inTemplateMode);
            return false;
          }
          if (name == "head") { return false; }
        } else if (kind == endToken) {
          if (name == "head") {
            pop();
            mode = afterHeadMode;
            return false;
          }
          if (name == "template") {
            if (!hasTemplate()) { return false; }
            impliedEndThoroughly();
            popUntil("template");
            clearFormattingToMarker();
            templateModes.removeLast();
            resetMode();
            return false;
          }
          if (!(name == "body" || name == "html" || name == "br")) { return false; }
        }
        pop();
        mode = afterHeadMode;
        true
      }

      private inHeadNoscript(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == doctypeToken) { return false; }
        if (kind == startToken && name == "html") { return inBody(t); }
        if (kind == endToken && name == "noscript") {
          pop();
          mode = inHeadMode;
          return false;
        }
        if (kind == charToken) {
          // Two statements: C# drops the braces around a lone `if`,
          // and the `else` below would bind to it.
          let more = insertLeadingWhitespace(t);
          if (!more) { return false; }
        } else if (
          kind == commentToken || kind == piToken ||
          (kind == startToken && (name == "basefont" || name == "bgsound" || name == "link" || name == "meta" || name == "noframes" || name == "style"))
        ) {
          return inHead(t);
        } else if ((kind == startToken && (name == "head" || name == "noscript")) || (kind == endToken && name != "br")) {
          return false;
        }
        pop();
        mode = inHeadMode;
        true
      }

      private afterHead(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          // Two statements: C# drops the braces around a lone `if`,
          // and the `else` below would bind to it.
          let more = insertLeadingWhitespace(t);
          if (!more) { return false; }
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
          return false;
        } else if (kind == doctypeToken) {
          return false;
        } else if (kind == startToken) {
          if (name == "html") { return inBody(t); }
          if (name == "body") {
            insertHtml(t);
            framesetOk = false;
            mode = inBodyMode;
            return false;
          }
          if (name == "frameset") {
            insertHtml(t);
            mode = inFramesetMode;
            return false;
          }
          if (inHeadStartNames.has(name)) {
            stack.add(head);
            let again = inHead(t);
            removeFromStack(head);
            return again;
          }
          if (name == "head") { return false; }
        } else if (kind == endToken) {
          if (name == "template") { return inHead(t); }
          if (!(name == "body" || name == "html" || name == "br")) { return false; }
        }
        insertImplied("body");
        framesetOk = true;
        mode = inBodyMode;
        true
      }

### In body

      private inBody(t: TreeToken): Boolean {
        let kind = t.kind;
        if (kind == charToken) {
          bodyText(t.text);
          return false;
        }
        if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
          return false;
        }
        if (kind == doctypeToken) { return false; }
        if (kind == eofToken) {
          if (!templateModes.isEmpty) { return inTemplate(t); }
          return false;
        }
        if (kind == startToken) { return bodyStart(t); }
        bodyEnd(t)
      }

Text in body: NUL dropped, the rest inserted.

      private bodyText(text: String): Void {
        let end = text.end;
        var i = firstAt(text, "\u{0}", String.begin, end);
        if (i == end) {
          insertBodyRun(text);
          return;
        }
        var start = String.begin;
        while (i < end) {
          let c = text[i];
          if (c == 0) {
            if (start < i) { insertBodyRun(text.slice(start, i)); }
            start = text.next(i);
          }
          i = text.next(i);
        }
        if (start == String.begin) {
          insertBodyRun(text);
        } else if (start < end) {
          insertBodyRun(text.slice(start, end));
        }
      }

      private insertBodyRun(text: String): Void {
        reconstruct();
        insertText(text);
        if (framesetOk && !allWhitespace(text)) { framesetOk = false; }
      }

      private mergeAttributes(t: TreeToken, element: Int): Void {
        let existing = tree.attributeLists[element];
        let add = new ListBuilder<String>();
        add.addAll(existing);
        var changed = false;
        for (var i = 0; i + 2 < t.tokenAttributes.length; i += 3) {
          var found = false;
          for (var j = 0; j + 2 < existing.length; j += 3) {
            if (existing[j + 1] == t.tokenAttributes[i + 1]) { found = true; }
          }
          if (!found) {
            add.add(t.tokenAttributes[i]);
            add.add(t.tokenAttributes[i + 1]);
            add.add(t.tokenAttributes[i + 2]);
            changed = true;
          }
        }
        if (changed) { tree.attributeLists.set(element, add.toList()); }
      }

      private bodyStart(t: TreeToken): Boolean {
        let name = t.name;
        if (name == "html") {
          if (!hasTemplate()) { mergeAttributes(t, stack[0]); }
          return false;
        }
        if (inHeadStartNames.has(name)) { return inHead(t); }
        if (name == "body") {
          if (stack.length == 1 || !tree.isHtml(stack[1], "body") || hasTemplate()) { return false; }
          framesetOk = false;
          mergeAttributes(t, stack[1]);
          return false;
        }
        if (name == "frameset") {
          if (stack.length == 1 || !tree.isHtml(stack[1], "body") || !framesetOk) { return false; }
          tree.detach(stack[1]);
          while (stack.length > 1) { pop(); }
          insertHtml(t);
          mode = inFramesetMode;
          return false;
        }
        if (closesPNames.has(name)) {
          closePInButtonScope();
          insertHtml(t);
          return false;
        }
        if (headingNames.has(name)) {
          closePInButtonScope();
          let top = current();
          if (tree.spaces[top] == htmlNs && headingNames.has(tree.names[top])) { pop(); }
          insertHtml(t);
          return false;
        }
        if (name == "pre" || name == "listing") {
          closePInButtonScope();
          insertHtml(t);
          skipNewline = true;
          framesetOk = false;
          return false;
        }
        if (name == "form") {
          let inTemplate = parsingTemplateContents();
          if (form >= 0 && !inTemplate) { return false; }
          closePInButtonScope();
          let id = insertHtml(t);
          if (!inTemplate) { form = id; }
          return false;
        }
        if (name == "li" || name == "dd" || name == "dt") {
          framesetOk = false;
          for (var i = stack.length - 1; i >= 0; i -= 1) {
            let node = stack[i];
            let nodeName = tree.names[node];
            let matches = tree.spaces[node] == htmlNs && (
              if (name == "li") { nodeName == "li" } else { nodeName == "dd" || nodeName == "dt" }
            );
            if (matches) {
              impliedEnd(nodeName);
              popUntil(nodeName);
              break;
            }
            if (isSpecial(node) && !(tree.spaces[node] == htmlNs && (nodeName == "address" || nodeName == "div" || nodeName == "p"))) {
              break;
            }
          }
          closePInButtonScope();
          insertHtml(t);
          return false;
        }
        if (name == "plaintext") {
          closePInButtonScope();
          insertHtml(t);
          nextState = ContentState.plaintext.id;
          return false;
        }
        if (name == "button") {
          if (inScope("button", 0)) {
            impliedEnd("");
            popUntil("button");
          }
          reconstruct();
          insertHtml(t);
          framesetOk = false;
          return false;
        }
        if (name == "a") {
          for (var i = formatting.length - 1; i >= 0; i -= 1) {
            let entry = formatting[i];
            if (entry < 0) { break; }
            if (tree.isHtml(entry, "a")) {
              if (!adoption("a")) { anyOtherEnd("a"); }
              let at = formattingIndexOf(entry);
              if (at >= 0) { formatting.splice(at, 1); }
              removeFromStack(entry);
              break;
            }
          }
          reconstruct();
          pushFormatting(insertHtml(t));
          return false;
        }
        if (name == "nobr") {
          reconstruct();
          if (inScope("nobr", 0)) {
            if (!adoption("nobr")) { anyOtherEnd("nobr"); }
            reconstruct();
          }
          pushFormatting(insertHtml(t));
          return false;
        }
        if (formattingNames.has(name)) {
          reconstruct();
          pushFormatting(insertHtml(t));
          return false;
        }
        if (name == "applet" || name == "marquee" || name == "object") {
          reconstruct();
          insertHtml(t);
          formatting.add(-1);
          framesetOk = false;
          return false;
        }
        if (name == "table") {
          if (quirks != "quirks") { closePInButtonScope(); }
          insertHtml(t);
          framesetOk = false;
          mode = inTableMode;
          return false;
        }
        if (name == "area" || name == "br" || name == "embed" || name == "img" || name == "keygen" || name == "wbr") {
          reconstruct();
          insertHtml(t);
          pop();
          framesetOk = false;
          return false;
        }
        if (name == "input") {
          if (contextIs("select")) { return false; }
          if (inScope("select", 0)) { popUntil("select"); }
          reconstruct();
          insertHtml(t);
          pop();
          let inputType = t.attribute("type");
          if (inputType == null || asciiLowercase(inputType) != "hidden") { framesetOk = false; }
          return false;
        }
        if (name == "param" || name == "source" || name == "track") {
          insertHtml(t);
          pop();
          return false;
        }
        if (name == "hr") {
          closePInButtonScope();
          if (inScope("select", 0)) { impliedEnd(""); }
          insertHtml(t);
          pop();
          framesetOk = false;
          return false;
        }
        if (name == "image") {
          t.name = "img";
          return true;
        }
        if (name == "textarea") {
          insertHtml(t);
          skipNewline = true;
          nextState = ContentState.rcdata.id;
          originalMode = mode;
          framesetOk = false;
          mode = textMode;
          return false;
        }
        if (name == "xmp") {
          closePInButtonScope();
          reconstruct();
          framesetOk = false;
          rawText(t, ContentState.rawtext.id);
          return false;
        }
        if (name == "iframe") {
          framesetOk = false;
          rawText(t, ContentState.rawtext.id);
          return false;
        }
        if (name == "noembed" || (name == "noscript" && scripting)) {
          rawText(t, ContentState.rawtext.id);
          return false;
        }
        if (name == "select") {
          if (contextIs("select")) { return false; }
          if (inScope("select", 0)) {
            popUntil("select");
          } else {
            reconstruct();
            insertHtml(t);
            framesetOk = false;
          }
          return false;
        }
        if (name == "option") {
          if (inScope("select", 0)) {
            impliedEnd("optgroup");
          } else if (currentIs("option")) {
            pop();
          }
          reconstruct();
          insertHtml(t);
          return false;
        }
        if (name == "optgroup") {
          if (inScope("select", 0)) {
            impliedEnd("");
          } else if (currentIs("option")) {
            pop();
          }
          reconstruct();
          insertHtml(t);
          return false;
        }
        if (name == "rb" || name == "rtc") {
          if (inScope("ruby", 0)) { impliedEnd(""); }
          insertHtml(t);
          return false;
        }
        if (name == "rp" || name == "rt") {
          if (inScope("ruby", 0)) { impliedEnd("rtc"); }
          insertHtml(t);
          return false;
        }
        if (name == "math" || name == "svg") {
          reconstruct();
          insertForeign(t, if (name == "math") { mathNs } else { svgNs });
          return false;
        }
        if (ignoredInBodyNames.has(name)) { return false; }
        reconstruct();
        insertHtml(t);
        false
      }

      private bodyEnd(t: TreeToken): Boolean {
        let name = t.name;
        if (name == "template") { return inHead(t); }
        if (name == "body" || name == "html") {
          if (!inScope("body", 0)) { return false; }
          mode = afterBodyMode;
          return name == "html";
        }
        if (blockEndNames.has(name)) {
          if (!inScope(name, 0)) { return false; }
          impliedEnd("");
          popUntil(name);
          return false;
        }
        if (name == "form") {
          if (!parsingTemplateContents()) {
            let node = form;
            form = -1;
            if (node < 0 || !nodeInScope(node)) { return false; }
            impliedEnd("");
            removeFromStack(node);
          } else {
            if (!inScope("form", 0)) { return false; }
            impliedEnd("");
            popUntil("form");
          }
          return false;
        }
        if (name == "p") {
          if (!inScope("p", 2)) { insertImplied("p"); }
          closeP();
          return false;
        }
        if (name == "li") {
          if (!inScope("li", 1)) { return false; }
          impliedEnd("li");
          popUntil("li");
          return false;
        }
        if (name == "dd" || name == "dt") {
          if (!inScope(name, 0)) { return false; }
          impliedEnd(name);
          popUntil(name);
          return false;
        }
        if (headingNames.has(name)) {
          if (!headingInScope()) { return false; }
          impliedEnd("");
          popUntilHeading();
          return false;
        }
        if (formattingNames.has(name)) {
          if (!adoption(name)) { anyOtherEnd(name); }
          return false;
        }
        if (name == "applet" || name == "marquee" || name == "object") {
          if (!inScope(name, 0)) { return false; }
          impliedEnd("");
          popUntil(name);
          clearFormattingToMarker();
          return false;
        }
        if (name == "br") {
          t.kind = startToken;
          t.tokenAttributes = noStrings;
          t.selfClosing = false;
          return bodyStart(t);
        }
        anyOtherEnd(name);
        false
      }

      private anyOtherEnd(name: String): Void {
        for (var i = stack.length - 1; i >= 0; i -= 1) {
          let node = stack[i];
          if (tree.isHtml(node, name)) {
            impliedEnd(name);
            while (stack.length > i) { pop(); }
            return;
          }
          if (isSpecial(node)) { return; }
        }
      }

### Text

      private inText(t: TreeToken): Boolean {
        if (t.kind == charToken) {
          insertText(t.text);
          return false;
        }
        if (t.kind == eofToken) {
          pop();
          mode = originalMode;
          return true;
        }
        if (t.kind == endToken) {
          pop();
          mode = originalMode;
        }
        false
      }

### Tables

      private clearToTableContext(names: String): Void {
        while (!stack.isEmpty) {
          let node = current();
          if (tree.spaces[node] == htmlNs) {
            let n = tree.names[node];
            if (n == "html" || n == "template") { return; }
            if (names == "table" && n == "table") { return; }
            if (names == "body" && tableSectionNames.has(n)) { return; }
            if (names == "row" && n == "tr") { return; }
          }
          pop();
        }
      }

      private inTable(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          let top = current();
          if (tree.spaces[top] == htmlNs && tableContextNames.has(tree.names[top])) {
            pendingText = new StringBuilder();
            pendingNonSpace = false;
            originalMode = mode;
            mode = inTableTextMode;
            return true;
          }
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
          return false;
        } else if (kind == doctypeToken) {
          return false;
        } else if (kind == startToken) {
          if (name == "caption") {
            clearToTableContext("table");
            formatting.add(-1);
            insertHtml(t);
            mode = inCaptionMode;
            return false;
          }
          if (name == "colgroup") {
            clearToTableContext("table");
            insertHtml(t);
            mode = inColumnGroupMode;
            return false;
          }
          if (name == "col") {
            clearToTableContext("table");
            insertImplied("colgroup");
            mode = inColumnGroupMode;
            return true;
          }
          if (tableSectionNames.has(name)) {
            clearToTableContext("table");
            insertHtml(t);
            mode = inTableBodyMode;
            return false;
          }
          if (name == "td" || name == "th" || name == "tr") {
            clearToTableContext("table");
            insertImplied("tbody");
            mode = inTableBodyMode;
            return true;
          }
          if (name == "table") {
            if (!inScope("table", 3)) { return false; }
            popUntil("table");
            resetMode();
            return true;
          }
          if (name == "style" || name == "script" || name == "template") { return inHead(t); }
          if (name == "input") {
            let inputType = t.attribute("type");
            if (inputType != null && asciiLowercase(inputType) == "hidden") {
              insertHtml(t);
              pop();
              return false;
            }
          }
          if (name == "form") {
            let inTemplate = parsingTemplateContents();
            if (form >= 0 && !inTemplate) { return false; }
            let id = insertHtml(t);
            if (!inTemplate) { form = id; }
            pop();
            return false;
          }
        } else if (kind == endToken) {
          if (name == "table") {
            if (!inScope("table", 3)) { return false; }
            popUntil("table");
            resetMode();
            return false;
          }
          if (
            name == "body" || name == "caption" || name == "col" || name == "colgroup" || name == "html" ||
            tableSectionNames.has(name) || name == "td" || name == "th" || name == "tr"
          ) {
            return false;
          }
          if (name == "template") { return inHead(t); }
        } else if (kind == eofToken) {
          return inBody(t);
        }
        fosterParenting = true;
        let again = inBody(t);
        fosterParenting = false;
        again
      }

      private inTableText(t: TreeToken): Boolean {
        if (t.kind == charToken) {
          let text = t.text;
          var i = String.begin;
          var start = String.begin;
          while (text.hasIndex(i)) {
            let c = text[i];
            if (c == 0) {
              pendingText.append(text.slice(start, i));
              start = text.next(i);
            } else if (!isAsciiWhitespace(c)) {
              pendingNonSpace = true;
            }
            i = text.next(i);
          }
          pendingText.append(text.slice(start, text.end));
          return false;
        }
        let pending = pendingText.toString();
        pendingText = new StringBuilder();
        if (!pending.isEmpty) {
          if (pendingNonSpace) {
            fosterParenting = true;
            reconstruct();
            insertText(pending);
            framesetOk = false;
            fosterParenting = false;
          } else {
            insertText(pending);
          }
        }
        mode = originalMode;
        true
      }

      private inCaption(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (
          (kind == endToken && (name == "caption" || name == "table")) ||
          (kind == startToken && (
            name == "caption" || name == "col" || name == "colgroup" || tableSectionNames.has(name) ||
            name == "td" || name == "th" || name == "tr"
          ))
        ) {
          if (!inScope("caption", 3)) { return false; }
          impliedEnd("");
          popUntil("caption");
          clearFormattingToMarker();
          mode = inTableMode;
          return !(kind == endToken && name == "caption");
        }
        if (kind == endToken && (
          name == "body" || name == "col" || name == "colgroup" || name == "html" ||
          tableSectionNames.has(name) || name == "td" || name == "th" || name == "tr"
        )) {
          return false;
        }
        inBody(t)
      }

      private inColumnGroup(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          // Two statements: C# drops the braces around a lone `if`,
          // and the `else` below would bind to it.
          let more = insertLeadingWhitespace(t);
          if (!more) { return false; }
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
          return false;
        } else if (kind == doctypeToken) {
          return false;
        } else if (kind == startToken) {
          if (name == "html") { return inBody(t); }
          if (name == "col") {
            insertHtml(t);
            pop();
            return false;
          }
          if (name == "template") { return inHead(t); }
        } else if (kind == endToken) {
          if (name == "colgroup") {
            if (!currentIs("colgroup")) { return false; }
            pop();
            mode = inTableMode;
            return false;
          }
          if (name == "col") { return false; }
          if (name == "template") { return inHead(t); }
        } else if (kind == eofToken) {
          return inBody(t);
        }
        if (!currentIs("colgroup")) { return false; }
        pop();
        mode = inTableMode;
        true
      }

      private inTableBody(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == startToken && name == "tr") {
          clearToTableContext("body");
          insertHtml(t);
          mode = inRowMode;
          return false;
        }
        if (kind == startToken && (name == "th" || name == "td")) {
          clearToTableContext("body");
          insertImplied("tr");
          mode = inRowMode;
          return true;
        }
        if (kind == endToken && tableSectionNames.has(name)) {
          if (!inScope(name, 3)) { return false; }
          clearToTableContext("body");
          pop();
          mode = inTableMode;
          return false;
        }
        if (
          (kind == startToken && (name == "caption" || name == "col" || name == "colgroup" || tableSectionNames.has(name))) ||
          (kind == endToken && name == "table")
        ) {
          if (!(inScope("tbody", 3) || inScope("thead", 3) || inScope("tfoot", 3))) { return false; }
          clearToTableContext("body");
          pop();
          mode = inTableMode;
          return true;
        }
        if (kind == endToken && (
          name == "body" || name == "caption" || name == "col" || name == "colgroup" || name == "html" ||
          name == "td" || name == "th" || name == "tr"
        )) {
          return false;
        }
        inTable(t)
      }

      private inRow(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == startToken && (name == "th" || name == "td")) {
          clearToTableContext("row");
          insertHtml(t);
          mode = inCellMode;
          formatting.add(-1);
          return false;
        }
        if (kind == endToken && name == "tr") {
          if (!inScope("tr", 3)) { return false; }
          clearToTableContext("row");
          pop();
          mode = inTableBodyMode;
          return false;
        }
        if (
          (kind == startToken && (name == "caption" || name == "col" || name == "colgroup" || tableSectionNames.has(name) || name == "tr")) ||
          (kind == endToken && name == "table")
        ) {
          if (!inScope("tr", 3)) { return false; }
          clearToTableContext("row");
          pop();
          mode = inTableBodyMode;
          return true;
        }
        if (kind == endToken && tableSectionNames.has(name)) {
          if (!inScope(name, 3)) { return false; }
          if (!inScope("tr", 3)) { return false; }
          clearToTableContext("row");
          pop();
          mode = inTableBodyMode;
          return true;
        }
        if (kind == endToken && (
          name == "body" || name == "caption" || name == "col" || name == "colgroup" || name == "html" ||
          name == "td" || name == "th"
        )) {
          return false;
        }
        inTable(t)
      }

      private closeCell(): Void {
        impliedEnd("");
        while (!stack.isEmpty) {
          let node = pop();
          if (tree.isHtml(node, "td") || tree.isHtml(node, "th")) { break; }
        }
        clearFormattingToMarker();
        mode = inRowMode;
      }

      private inCell(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == endToken && (name == "td" || name == "th")) {
          if (!inScope(name, 3)) { return false; }
          impliedEnd("");
          popUntil(name);
          clearFormattingToMarker();
          mode = inRowMode;
          return false;
        }
        if (kind == startToken && (
          name == "caption" || name == "col" || name == "colgroup" || tableSectionNames.has(name) ||
          name == "td" || name == "th" || name == "tr"
        )) {
          if (!inScope("td", 3) && !inScope("th", 3)) { return false; }
          closeCell();
          return true;
        }
        if (kind == endToken && (name == "body" || name == "caption" || name == "col" || name == "colgroup" || name == "html")) {
          return false;
        }
        if (kind == endToken && (tableSectionNames.has(name) || name == "table" || name == "tr")) {
          if (!inScope(name, 3)) { return false; }
          closeCell();
          return true;
        }
        inBody(t)
      }

### Templates

      private inTemplate(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken || kind == commentToken || kind == piToken || kind == doctypeToken) {
          return inBody(t);
        }
        if (kind == startToken) {
          if (inHeadStartNames.has(name)) { return inHead(t); }
          let next = if (name == "caption" || name == "colgroup" || tableSectionNames.has(name)) {
            inTableMode
          } else if (name == "col") {
            inColumnGroupMode
          } else if (name == "tr") {
            inTableBodyMode
          } else if (name == "td" || name == "th") {
            inRowMode
          } else {
            inBodyMode
          };
          templateModes.removeLast();
          templateModes.add(next);
          mode = next;
          return true;
        }
        if (kind == endToken) {
          if (name == "template") { return inHead(t); }
          return false;
        }
        if (!hasTemplate()) { return false; }
        popUntil("template");
        clearFormattingToMarker();
        templateModes.removeLast();
        resetMode();
        true
      }

### After body, and framesets

      private afterBody(t: TreeToken): Boolean {
        let kind = t.kind;
        if (kind == charToken) {
          let ws = whitespaceEnd(t.text);
          if (ws == t.text.end) { return inBody(t); }
          if (ws != String.begin) {
            bodyText(t.text.slice(String.begin, ws));
            t.text = t.text.slice(ws, t.text.end);
          }
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, stack[0]);
          return false;
        } else if (kind == doctypeToken || kind == eofToken) {
          return false;
        } else if (kind == startToken && t.name == "html") {
          return inBody(t);
        } else if (kind == endToken && t.name == "html") {
          if (contextNode < 0) { mode = afterAfterBodyMode; }
          return false;
        }
        mode = inBodyMode;
        true
      }

Keeps only the whitespace of text, as the frameset modes do.

      private framesetText(t: TreeToken): Void {
        let text = t.text;
        var i = String.begin;
        var start = String.begin;
        let out = new StringBuilder();
        while (text.hasIndex(i)) {
          if (!isAsciiWhitespace(text[i])) {
            out.append(text.slice(start, i));
            start = text.next(i);
          }
          i = text.next(i);
        }
        out.append(text.slice(start, text.end));
        let kept = out.toString();
        if (!kept.isEmpty) { insertText(kept); }
      }

      private inFrameset(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          framesetText(t);
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
        } else if (kind == startToken) {
          if (name == "html") { return inBody(t); }
          if (name == "frameset") {
            insertHtml(t);
          } else if (name == "frame") {
            insertHtml(t);
            pop();
          } else if (name == "noframes") {
            return inHead(t);
          }
        } else if (kind == endToken && name == "frameset") {
          if (stack.length > 1) {
            pop();
            if (contextNode < 0 && !currentIs("frameset")) { mode = afterFramesetMode; }
          }
        }
        false
      }

      private afterFrameset(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          framesetText(t);
        } else if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
        } else if (kind == startToken) {
          if (name == "html") { return inBody(t); }
          if (name == "noframes") { return inHead(t); }
        } else if (kind == endToken && name == "html") {
          mode = afterAfterFramesetMode;
        }
        false
      }

      private afterAfterBody(t: TreeToken): Boolean {
        let kind = t.kind;
        if (kind == commentToken || kind == piToken) {
          insertOther(t, 0);
          return false;
        }
        if (kind == doctypeToken || kind == eofToken || (kind == startToken && t.name == "html")) {
          return inBody(t);
        }
        if (kind == charToken) {
          let ws = whitespaceEnd(t.text);
          if (ws == t.text.end) { return inBody(t); }
          if (ws != String.begin) {
            bodyText(t.text.slice(String.begin, ws));
            t.text = t.text.slice(ws, t.text.end);
          }
        }
        mode = inBodyMode;
        true
      }

      private afterAfterFrameset(t: TreeToken): Boolean {
        let kind = t.kind;
        if (kind == commentToken || kind == piToken) {
          insertOther(t, 0);
        } else if (kind == doctypeToken || kind == eofToken || (kind == startToken && t.name == "html")) {
          return inBody(t);
        } else if (kind == charToken) {
          let ws = whitespaceEnd(t.text);
          if (ws != String.begin) { bodyText(t.text.slice(String.begin, ws)); }
        } else if (kind == startToken && t.name == "noframes") {
          return inHead(t);
        }
        false
      }

### Foreign content

      private inForeign(t: TreeToken): Boolean {
        let kind = t.kind;
        let name = t.name;
        if (kind == charToken) {
          let text = t.text;
          var i = String.begin;
          var start = String.begin;
          let out = new StringBuilder();
          var nonSpace = false;
          while (text.hasIndex(i)) {
            let c = text[i];
            if (c == 0) {
              out.append(text.slice(start, i));
              out.append("\u{FFFD}");
              start = text.next(i);
            } else if (!isAsciiWhitespace(c)) {
              nonSpace = true;
            }
            i = text.next(i);
          }
          if (start == String.begin) {
            insertText(text);
          } else {
            out.append(text.slice(start, text.end));
            insertText(out.toString());
          }
          if (nonSpace) { framesetOk = false; }
          return false;
        }
        if (kind == commentToken || kind == piToken) {
          insertOther(t, -1);
          return false;
        }
        if (kind == doctypeToken) { return false; }
        if (
          (kind == startToken && (
            breakoutNames.has(name) ||
            (name == "font" && (t.attribute("color") != null || t.attribute("face") != null || t.attribute("size") != null))
          )) ||
          (kind == endToken && (name == "br" || name == "p"))
        ) {
          while (!stack.isEmpty) {
            let node = current();
            if (
              tree.spaces[node] == htmlNs || isHtmlIntegrationPoint(node) ||
              (tree.spaces[node] == mathNs && isMathTextPoint(tree.names[node]))
            ) { break; }
            pop();
          }
          return byMode(t, mode);
        }
        if (kind == startToken) {
          insertForeign(t, tree.spaces[adjustedCurrent()]);
          return false;
        }
        if (kind == endToken) {
          var i = stack.length - 1;
          var node = stack[i];
          while (i > 0) {
            if (asciiLowercase(tree.names[node]) == name) {
              while (stack.length > i) { pop(); }
              return false;
            }
            i -= 1;
            node = stack[i];
            if (tree.spaces[node] == htmlNs) { return byMode(t, mode); }
          }
        }
        false
      }
    }

Quirks mode from a DOCTYPE, as the standard's lists give it.

    let quirksOf(doctype: Doctype): String {
      if (doctype.forceQuirks || doctype.name != "html") { return "quirks"; }
      let publicId = asciiLowercase(doctype.publicId ?? "");
      let systemId = doctype.systemId;
      let system = asciiLowercase(systemId ?? "");
      if (
        publicId == "-//w3o//dtd w3 html strict 3.0//en//" || publicId == "-/w3c/dtd html 4.0 transitional/en" ||
        publicId == "html" || system == "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd"
      ) {
        return "quirks";
      }
      for (var i = 0; i < quirksPrefixes.length; i += 1) {
        if (startsWith(publicId, quirksPrefixes[i])) { return "quirks"; }
      }
      let html401 = startsWith(publicId, "-//w3c//dtd html 4.01 frameset//") ||
        startsWith(publicId, "-//w3c//dtd html 4.01 transitional//");
      if (systemId == null && html401) { return "quirks"; }
      if (
        startsWith(publicId, "-//w3c//dtd xhtml 1.0 frameset//") ||
        startsWith(publicId, "-//w3c//dtd xhtml 1.0 transitional//") || (systemId != null && html401)
      ) {
        return "limited-quirks";
      }
      "no-quirks"
    }

    let quirksPrefixes: List<String> = [
      "+//silmaril//dtd html pro v0r11 19970101//", "-//as//dtd html 3.0 aswedit + extensions//",
      "-//advasoft ltd//dtd html 3.0 aswedit + extensions//", "-//ietf//dtd html 2.0 level 1//",
      "-//ietf//dtd html 2.0 level 2//", "-//ietf//dtd html 2.0 strict level 1//",
      "-//ietf//dtd html 2.0 strict level 2//", "-//ietf//dtd html 2.0 strict//", "-//ietf//dtd html 2.0//",
      "-//ietf//dtd html 2.1e//", "-//ietf//dtd html 3.0//", "-//ietf//dtd html 3.2 final//",
      "-//ietf//dtd html 3.2//", "-//ietf//dtd html 3//", "-//ietf//dtd html level 0//",
      "-//ietf//dtd html level 1//", "-//ietf//dtd html level 2//", "-//ietf//dtd html level 3//",
      "-//ietf//dtd html strict level 0//", "-//ietf//dtd html strict level 1//",
      "-//ietf//dtd html strict level 2//", "-//ietf//dtd html strict level 3//", "-//ietf//dtd html strict//",
      "-//ietf//dtd html//", "-//metrius//dtd metrius presentational//",
      "-//microsoft//dtd internet explorer 2.0 html strict//", "-//microsoft//dtd internet explorer 2.0 html//",
      "-//microsoft//dtd internet explorer 2.0 tables//", "-//microsoft//dtd internet explorer 3.0 html strict//",
      "-//microsoft//dtd internet explorer 3.0 html//", "-//microsoft//dtd internet explorer 3.0 tables//",
      "-//netscape comm. corp.//dtd html//", "-//netscape comm. corp.//dtd strict html//",
      "-//o'reilly and associates//dtd html 2.0//", "-//o'reilly and associates//dtd html extended 1.0//",
      "-//o'reilly and associates//dtd html extended relaxed 1.0//",
      "-//sq//dtd html 2.0 hotmetal + extensions//",
      "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
      "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
      "-//spyglass//dtd html 2.0 extended//", "-//sun microsystems corp.//dtd hotjava html//",
      "-//sun microsystems corp.//dtd hotjava strict html//", "-//w3c//dtd html 3 1995-03-24//",
      "-//w3c//dtd html 3.2 draft//", "-//w3c//dtd html 3.2 final//", "-//w3c//dtd html 3.2//",
      "-//w3c//dtd html 3.2s draft//", "-//w3c//dtd html 4.0 frameset//", "-//w3c//dtd html 4.0 transitional//",
      "-//w3c//dtd html experimental 19960712//", "-//w3c//dtd html experimental 970421//",
      "-//w3c//dtd w3 html//", "-//w3o//dtd w3 html 3.0//", "-//webtechs//dtd mozilla html 2.0//",
      "-//webtechs//dtd mozilla html//",
    ];

## Parsing

The element a fragment is parsed as if inside: its local name (SVG's
in mixed case, as `Element.name` gives it), its namespace (`"html"`,
`"svg"`, or `"math"`), its attributes (which matter only for MathML's
`annotation-xml`, whose `encoding` can make it HTML inside), whether
it's inside a `form` (so a `<form>` in the fragment is ignored, as the
standard's form element pointer has it), and its document's quirks
mode. `Element.fragmentContext` gives all of these for an element
already parsed.

    export class FragmentContext {
      public name: String;
      // A getter over `namespaceName`, not a field or parameter named
      // `namespace`: Temper's C# backend doesn't escape that keyword in
      // fields and parameters.
      private namespaceName: String;
      public attributes: List<BuiltAttribute>;
      public insideForm: Boolean;
      public quirksMode: String;

      public constructor(
        name: String,
        namespaceName: String = "html",
        attributes: List<BuiltAttribute> = [],
        insideForm: Boolean = false,
        quirksMode: String = "no-quirks",
      ) {
        this.name = name;
        this.namespaceName = namespaceName;
        this.attributes = attributes;
        this.insideForm = insideForm;
        this.quirksMode = quirksMode;
      }

      public get namespace(): String { namespaceName }

      public withAttributes(attributes: List<BuiltAttribute>): FragmentContext {
        new FragmentContext(name, namespaceName, attributes, insideForm, quirksMode)
      }

      public withInsideForm(on: Boolean): FragmentContext {
        new FragmentContext(name, namespaceName, attributes, on, quirksMode)
      }

`"no-quirks"`, `"quirks"`, or `"limited-quirks"`.

      public withQuirksMode(mode: String): FragmentContext {
        new FragmentContext(name, namespaceName, attributes, insideForm, mode)
      }
    }

How to parse: with scripting on (the default, as in browsers), or
off, which changes how `<noscript>` reads.

    export class HtmlParser {
      public scripting: Boolean;
      public constructor(scripting: Boolean) { this.scripting = scripting; }

      public static html: HtmlParser = new HtmlParser(true);

      public withScripting(on: Boolean): HtmlParser { new HtmlParser(on) }

      public parse(text: String): HtmlDocument {
        let builder = new TreeBuilder(scripting);
        let machine = new Tokenizer(text, "", true, builder, true);
        machine.run(0);
        let tokens = new HtmlTokens(redRoot(machine.green()));
        new HtmlDocument(tokens, builder.tree, builder.quirks, machine.parseErrors())
      }

Parses a fragment as the standard's fragment parsing algorithm does,
as `innerHTML` does in browsers: as if inside `context`, which decides
how the text reads (`<td>` alone is a cell in a `tr`, ignored in a
`div`; text is raw text in a `textarea`). Never fails.

      public parseFragment(text: String, context: FragmentContext): HtmlFragment {
        let builder = new TreeBuilder(scripting);
        let state = builder.startFragment(context);
        let machine = new Tokenizer(text, "", true, builder, true);
        machine.run(state);
        let tokens = new HtmlTokens(redRoot(machine.green()));
        new HtmlFragment(tokens, builder.tree, context, machine.parseErrors())
      }
    }

Parses a whole document as browsers do. Never fails: any text is
some HTML.

    export let parseHtml(text: String): HtmlDocument { HtmlParser.html.parse(text) }

Parses a fragment as browsers do for `innerHTML`, with scripting on.

    export let parseHtmlFragment(text: String, context: FragmentContext): HtmlFragment {
      HtmlParser.html.parseFragment(text, context)
    }

## The built tree's views

    export sealed interface BuiltNode {
      public get children(): List<BuiltNode>;

The node and what's in it, written by the standard's HTML
serialization: normalized, not as written (see `asWritten` on the
tokens for that).

      public get html(): String;

The red node this came from: its token (for an element, its start
tag), or, in a parse fed in pieces, whatever the stream was given for
it, such as a Markdown node. Null for an element the standard implies.
A copy a `selectedcontent` made has the origin of the node it copies.

      public get origin(): RedNode?;

For a node a `selectedcontent` copied from the selected `option` (see
"Customizable select"), the parsed node it copies; null for the rest.
The copy is in the built tree only: the tokens, the lossless tree,
have the original alone.

      public get clonedFrom(): BuiltNode?;
    }

    let clonedFromOf(tree: BuiltTree, tokens: HtmlTokens, id: Int): BuiltNode? {
      let original = tree.clones.getOr(id, -1);
      if (original < 0) { null } else { builtNodeOf(tree, tokens, original) }
    }

    let originOf(tree: BuiltTree, tokens: HtmlTokens, id: Int): RedNode? {
      let index = tree.tokenIndexes[id];
      if (index < 0) { return null; }
      if (tree.joined) { return tree.origins[index]; }
      let green = tokens.node.green.children[index] as GreenNode orelse panic();
      new RedNode(green, tokens.node, tree.tokenOffsets[id], index)
    }

    let childrenOf(tree: BuiltTree, tokens: HtmlTokens, parent: Int): List<BuiltNode> {
      let out = new ListBuilder<BuiltNode>();
      var child = tree.firsts[parent];
      while (child >= 0) {
        out.add(builtNodeOf(tree, tokens, child));
        child = tree.nexts[child];
      }
      out.toList()
    }

    let builtNodeOf(tree: BuiltTree, tokens: HtmlTokens, id: Int): BuiltNode {
      let kind = tree.kinds[id];
      if (kind == elementNode) {
        new Element(tree, tokens, id)
      } else if (kind == textNode) {
        new BuiltText(tree, tokens, id)
      } else if (kind == commentNode) {
        new BuiltComment(tree, tokens, id)
      } else if (kind == doctypeNode) {
        new BuiltDoctype(tree, tokens, id)
      } else {
        new BuiltProcessingInstruction(tree, tokens, id)
      }
    }

The parse: the tokens as written, the tree as built, and the
tokenizer's parse errors (tree construction's aren't kept yet).

    export class HtmlDocument {
      public tokens: HtmlTokens;
      private tree: BuiltTree;

`"no-quirks"`, `"quirks"`, or `"limited-quirks"`, as the DOCTYPE (or
its absence) sets it.

      public quirksMode: String;
      public errors: List<HtmlParseError>;

      public constructor(tokens: HtmlTokens, tree: BuiltTree, quirksMode: String, errors: List<HtmlParseError>) {
        this.tokens = tokens;
        this.tree = tree;
        this.quirksMode = quirksMode;
        this.errors = errors;
      }

      public get asWritten(): String { tokens.asWritten }
      public get children(): List<BuiltNode> { childrenOf(tree, tokens, 0) }

      public get documentElement(): Element? {
        var child = tree.firsts[0];
        while (child >= 0) {
          if (tree.kinds[child] == elementNode) { return new Element(tree, tokens, child); }
          child = tree.nexts[child];
        }
        null
      }

      public get head(): Element? { documentElement?.child("head") }
      public get body(): Element? { documentElement?.child("body") }

      public get html(): String {
        let out = new StringBuilder();
        serializeChildren(tree, 0, out);
        out.toString()
      }

The body's contents, sanitized by `policy` (see `sanitizeHtml`) for
a `body` in this document's quirks mode. Empty for a frameset.

      public sanitize(policy: SanitizerPolicy = SanitizerPolicy.standard): SafeHtml {
        var root = tree.firsts[0];
        while (root >= 0 && tree.kinds[root] != elementNode) { root = tree.nexts[root]; }
        var body = if (root >= 0) { tree.firsts[root] } else { -1 };
        while (body >= 0 && !tree.isHtml(body, "body")) { body = tree.nexts[body]; }
        sanitizeTree(tree, tokens, body, new FragmentContext("body", "html", [], false, quirksMode), policy)
      }
    }

A fragment as parsed: the tokens as written, the nodes as built (what
`innerHTML` would put in the context element), and the tokenizer's
parse errors.

    export class HtmlFragment {
      public tokens: HtmlTokens;
      private tree: BuiltTree;
      public context: FragmentContext;
      public errors: List<HtmlParseError>;

      public constructor(tokens: HtmlTokens, tree: BuiltTree, context: FragmentContext, errors: List<HtmlParseError>) {
        this.tokens = tokens;
        this.tree = tree;
        this.context = context;
        this.errors = errors;
      }

      public get asWritten(): String { tokens.asWritten }
      public get children(): List<BuiltNode> { childrenOf(tree, tokens, tree.fragmentRoot) }

The nodes serialized as the context element's contents (so text in a
`script` context isn't escaped).

      public get html(): String {
        let out = new StringBuilder();
        serializeChildren(tree, tree.fragmentRoot, out);
        out.toString()
      }

The nodes sanitized by `policy` for the context (see `sanitizeHtml`).

      public sanitize(policy: SanitizerPolicy = SanitizerPolicy.standard): SafeHtml {
        sanitizeTree(tree, tokens, tree.fragmentRoot, context, policy)
      }
    }

An attribute as built: a namespace designator (`""`, or `"xlink"`,
`"xml"`, or `"xmlns"` on SVG and MathML), a name, and a value.

    export class BuiltAttribute(public prefix: String, public name: String, public value: String) {}

An element: its local name (lowercase in HTML; SVG's mixed case, such
as `foreignObject`, restored), its namespace, its attributes, and its
children. `startTag` is the token it came from, or null for one the
standard implies, such as `<tbody>`; elements remade by the adoption
agency algorithm, and copies a `selectedcontent` made, share their
original's start tag.

    export class Element extends BuiltNode {
      private tree: BuiltTree;
      private tokens: HtmlTokens;
      private id: Int;
      public constructor(tree: BuiltTree, tokens: HtmlTokens, id: Int) {
        this.tree = tree;
        this.tokens = tokens;
        this.id = id;
      }

      public get name(): String { tree.names[id] }

`"html"`, `"svg"`, or `"math"`.

      public get namespace(): String {
        let space = tree.spaces[id];
        if (space == svgNs) { "svg" } else if (space == mathNs) { "math" } else { "html" }
      }

      public get attributes(): List<BuiltAttribute> {
        let triples = tree.attributeLists[id];
        let out = new ListBuilder<BuiltAttribute>();
        for (var i = 0; i + 2 < triples.length; i += 3) {
          out.add(new BuiltAttribute(triples[i], triples[i + 1], triples[i + 2]));
        }
        out.toList()
      }

The value of the attribute named `name` (with no namespace), or null.

      public attribute(name: String): String? {
        let triples = tree.attributeLists[id];
        for (var i = 0; i + 2 < triples.length; i += 3) {
          if (triples[i].isEmpty && triples[i + 1] == name) { return triples[i + 2]; }
        }
        null
      }

      public get children(): List<BuiltNode> { childrenOf(tree, tokens, id) }

The first child element named `name`, or null.

      public child(name: String): Element? {
        var child = tree.firsts[id];
        while (child >= 0) {
          if (tree.kinds[child] == elementNode && tree.names[child] == name) {
            return new Element(tree, tokens, child);
          }
          child = tree.nexts[child];
        }
        null
      }

How to parse a fragment as if inside this element, as setting its
`innerHTML` does: its name, namespace, attributes, whether it or an
element it's in is a `form`, and its document's quirks mode.

      public get fragmentContext(): FragmentContext {
        var insideForm = false;
        var node = tree.parents[id];
        while (node >= 0 && !insideForm) {
          if (tree.isHtml(node, "form")) { insideForm = true; }
          if (node == tree.fragmentRoot) {
            if (tree.contextInsideForm || tree.isHtml(tree.fragmentContext, "form")) { insideForm = true; }
            node = -1;
          } else {
            node = tree.parents[node];
          }
        }
        new FragmentContext(name, namespace, attributes, insideForm, tree.quirksMode)
      }

A `template`'s contents, which aren't its children.

      public get templateContents(): List<BuiltNode> {
        let contents = tree.contents[id];
        if (contents < 0) { [] } else { childrenOf(tree, tokens, contents) }
      }

      public get startTag(): StartTag? {
        let origin = originOf(tree, tokens, id);
        if (origin != null) {
          if (origin.hasKind(startTagKind)) { return new StartTag(origin); }
        }
        null
      }

      public get origin(): RedNode? { originOf(tree, tokens, id) }
      public get clonedFrom(): BuiltNode? { clonedFromOf(tree, tokens, id) }

      public get html(): String {
        let out = new StringBuilder();
        serializeNode(tree, id, out);
        out.toString()
      }
    }

Text, joined as the standard joins adjacent text.

    export class BuiltText extends BuiltNode {
      private tree: BuiltTree;
      private tokens: HtmlTokens;
      private id: Int;
      public constructor(tree: BuiltTree, tokens: HtmlTokens, id: Int) {
        this.tree = tree;
        this.tokens = tokens;
        this.id = id;
      }
      public get origin(): RedNode? { originOf(tree, tokens, id) }
      public get clonedFrom(): BuiltNode? { clonedFromOf(tree, tokens, id) }
      public get text(): String { tree.datas[id] }
      public get children(): List<BuiltNode> { [] }
      public get html(): String {
        let out = new StringBuilder();
        serializeNode(tree, id, out);
        out.toString()
      }
    }

    export class BuiltComment extends BuiltNode {
      private tree: BuiltTree;
      private tokens: HtmlTokens;
      private id: Int;
      public constructor(tree: BuiltTree, tokens: HtmlTokens, id: Int) {
        this.tree = tree;
        this.tokens = tokens;
        this.id = id;
      }
      public get origin(): RedNode? { originOf(tree, tokens, id) }
      public get clonedFrom(): BuiltNode? { clonedFromOf(tree, tokens, id) }
      public get text(): String { tree.datas[id] }
      public get children(): List<BuiltNode> { [] }
      public get html(): String { "<!--${tree.datas[id]}-->" }
    }

    export class BuiltDoctype extends BuiltNode {
      private tree: BuiltTree;
      private tokens: HtmlTokens;
      private id: Int;
      public constructor(tree: BuiltTree, tokens: HtmlTokens, id: Int) {
        this.tree = tree;
        this.tokens = tokens;
        this.id = id;
      }
      public get origin(): RedNode? { originOf(tree, tokens, id) }
      public get clonedFrom(): BuiltNode? { clonedFromOf(tree, tokens, id) }
      public get name(): String { tree.names[id] }
      public get publicId(): String { tree.attributeLists[id][0] }
      public get systemId(): String { tree.attributeLists[id][1] }
      public get children(): List<BuiltNode> { [] }
      public get html(): String { "<!DOCTYPE ${tree.names[id]}>" }
    }

A processing instruction, written fresh with `?>`, which HTML and
XML both read.

    export class BuiltProcessingInstruction extends BuiltNode {
      private tree: BuiltTree;
      private tokens: HtmlTokens;
      private id: Int;
      public constructor(tree: BuiltTree, tokens: HtmlTokens, id: Int) {
        this.tree = tree;
        this.tokens = tokens;
        this.id = id;
      }
      public get origin(): RedNode? { originOf(tree, tokens, id) }
      public get clonedFrom(): BuiltNode? { clonedFromOf(tree, tokens, id) }
      public get target(): String { tree.names[id] }
      public get data(): String { tree.datas[id] }
      public get children(): List<BuiltNode> { [] }
      public get html(): String { "<?${tree.names[id]} ${tree.datas[id]}?>" }
    }

## Serializing

The standard's HTML fragment serialization, for a node and what's in
it. Recursive, so a tree deeper than the call stack allows would
overflow it; fine for now.

    let voidNames = nameSet("area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr");
    let rawTextParents = nameSet("style script xmp iframe noembed noframes plaintext");

    let serializeChildren(tree: BuiltTree, parent: Int, out: StringBuilder): Void {
      let container = if (tree.isHtml(parent, "template")) { tree.contents[parent] } else { parent };
      var child = tree.firsts[container];
      while (child >= 0) {
        serializeNode(tree, child, out);
        child = tree.nexts[child];
      }
    }

    let serializeNode(tree: BuiltTree, id: Int, out: StringBuilder): Void {
      let kind = tree.kinds[id];
      if (kind == elementNode) {
        let name = tree.names[id];
        out.append("<${name}");
        let triples = tree.attributeLists[id];
        for (var i = 0; i + 2 < triples.length; i += 3) {
          let prefix = triples[i];
          let qualified = if (prefix.isEmpty) {
            triples[i + 1]
          } else if (prefix == "xmlns" && triples[i + 1] == "xmlns") {
            "xmlns"
          } else {
            "${prefix}:${triples[i + 1]}"
          };
          out.append(" ${qualified}=\"${escapeText(triples[i + 2], true)}\"");
        }
        out.append(">");
        if (tree.spaces[id] == htmlNs && voidNames.has(name)) { return; }
        serializeChildren(tree, id, out);
        out.append("</${name}>");
      } else if (kind == textNode) {
        var parent = tree.parents[id];
        if (parent >= 0 && parent == tree.fragmentRoot) { parent = tree.fragmentContext; }
        if (parent >= 0 && tree.spaces[parent] == htmlNs && tree.kinds[parent] == elementNode && rawTextParents.has(tree.names[parent])) {
          out.append(tree.datas[id]);
        } else {
          out.append(escapeText(tree.datas[id], false));
        }
      } else if (kind == commentNode) {
        out.append("<!--${tree.datas[id]}-->");
      } else if (kind == piNode) {
        out.append("<?${tree.names[id]} ${tree.datas[id]}?>");
      } else if (kind == doctypeNode) {
        out.append("<!DOCTYPE ${tree.names[id]}>");
      }
    }

`&`, NBSP, and `<` and `>` (in text) or `"` (in attributes), escaped
as the standard's serialization escapes them.

    let escapeText(text: String, inAttribute: Boolean): String {
      let end = text.end;
      var amp = firstAt(text, "&", String.begin, end);
      var nbsp = firstAt(text, "\u{A0}", String.begin, end);
      var quot = if (inAttribute) { firstAt(text, "\"", String.begin, end) } else { end };
      var lt = if (inAttribute) { end } else { firstAt(text, "<", String.begin, end) };
      var gt = if (inAttribute) { end } else { firstAt(text, ">", String.begin, end) };
      var at = earlier(earlier(amp, nbsp), earlier(quot, earlier(lt, gt)));
      if (at == end) { return text; }
      let out = new StringBuilder();
      var start = String.begin;
      while (at < end) {
        out.append(text.slice(start, at));
        let c = text[at];
        start = text.next(at);
        if (c == char'&') {
          out.append("&amp;");
          amp = firstAt(text, "&", start, end);
        } else if (c == 0xA0) {
          out.append("&nbsp;");
          nbsp = firstAt(text, "\u{A0}", start, end);
        } else if (c == char'"') {
          out.append("&quot;");
          quot = firstAt(text, "\"", start, end);
        } else if (c == char'<') {
          out.append("&lt;");
          lt = firstAt(text, "<", start, end);
        } else {
          out.append("&gt;");
          gt = firstAt(text, ">", start, end);
        }
        at = earlier(earlier(amp, nbsp), earlier(quot, earlier(lt, gt)));
      }
      out.append(text.slice(start, end));
      out.toString()
    }

    let earlier(a: StringIndex, b: StringIndex): StringIndex { if (b < a) { b } else { a } }

## Tests

    test("a document, as built") {
      let doc = parseHtml("<!DOCTYPE html><title>T</title><p>One<p>Two<b>bold<i>both</b>italic</i>");
      assert(doc.asWritten == "<!DOCTYPE html><title>T</title><p>One<p>Two<b>bold<i>both</b>italic</i>") { "lossless" };
      let html = doc.html;
      assert(html == "<!DOCTYPE html><html><head><title>T</title></head><body><p>One</p><p>Two<b>bold<i>both</i></b><i>italic</i></p></body></html>") {
        html
      };
      assert(doc.quirksMode == "no-quirks") { doc.quirksMode };
      let body = doc.body as Element orelse panic();
      let p = body.children[1] as Element orelse panic();
      assert((p.startTag as StartTag orelse panic()).asWritten == "<p>") { "start tag" };
      assert(doc.head?.startTag == null) { "implied head" };
    }

    test("tables, foreign content, and processing instructions") {
      let doc = parseHtml("<table>x<tr><td>1</table><svg viewbox='0 0 1 1'><foreignobject><p>a</svg><![CDATA[c]]><?pi data>");
      let html = doc.html;
      // `</svg>` is ignored: the `p` in between is special.
      assert(
        html == "<html><head></head><body>x<table><tbody><tr><td>1</td></tr></tbody></table><svg viewBox=\"0 0 1 1\"><foreignObject><p>a<!--[CDATA[c]]--><?pi data?></p></foreignObject></svg></body></html>"
      ) { html };
      let math = parseHtml("<math><![CDATA[a<b]]></math>").html;
      assert(math == "<html><head></head><body><math>a&lt;b</math></body></html>") { math };
      let script = parseHtml("<script>a<b</script><textarea>\n<x></textarea>").html;
      assert(script == "<html><head><script>a<b</script></head><body><textarea>&lt;x&gt;</textarea></body></html>") { script };
    }

    test("fragments, in context") {
      let cells = parseHtmlFragment("<td>1<td>2", new FragmentContext("tr"));
      assert(cells.html == "<td>1</td><td>2</td>") { cells.html };
      assert(cells.asWritten == "<td>1<td>2") { "lossless" };
      let td = cells.children[0] as Element orelse panic();
      assert((td.startTag as StartTag orelse panic()).asWritten == "<td>") { "start tag" };
      let ignored = parseHtmlFragment("<td>1<td>2", new FragmentContext("div")).html;
      assert(ignored == "12") { ignored };
      let raw = parseHtmlFragment("a<b>&amp;</textarea>", new FragmentContext("textarea")).html;
      assert(raw == "a&lt;b&gt;&amp;&lt;/textarea&gt;") { raw };
      let script = parseHtmlFragment("a<b", new FragmentContext("script")).html;
      assert(script == "a<b") { script };
      let svg = parseHtmlFragment("<foreignobject/><p>x", new FragmentContext("g", "svg")).html;
      assert(svg == "<foreignObject></foreignObject><p>x</p>") { svg };
    }

    test("fragment contexts from elements") {
      let doc = parseHtml("<form><div id=a></div></form><table><tr><td>x</table>");
      let body = doc.body as Element orelse panic();
      let div = (body.child("form") as Element orelse panic()).child("div") as Element orelse panic();
      let context = div.fragmentContext;
      assert(context.name == "div" && context.insideForm && context.quirksMode == "quirks") { "div context" };
      let nested = parseHtmlFragment("<form><input>", context).html;
      assert(nested == "<input>") { nested };
      let tr = (body.child("table") as Element orelse panic()).child("tbody")?.child("tr") as Element orelse panic();
      let row = parseHtmlFragment("<td>y", tr.fragmentContext).html;
      assert(row == "<td>y</td>") { row };
    }

The selected option, copied into `selectedcontent` (see "Customizable
select"): the copies are built nodes with the origin of what they copy
and `clonedFrom` pointing at it, while the tokens stay as written.

    let selectedContentOf(text: String): Element {
      let select = (parseHtml(text).body as Element orelse panic()).child("select") as Element orelse panic();
      (select.child("button") as Element orelse panic()).child("selectedcontent") as Element orelse panic()
    }

    test("selectedcontent copies the selected option") {
      let text = "<select><button><selectedcontent>old</selectedcontent></button><option>A<option selected>B<b class=c>b</b><!--n--></select>";
      let doc = parseHtml(text);
      assert(doc.asWritten == text) { "lossless" };
      let select = (doc.body as Element orelse panic()).child("select") as Element orelse panic();
      let content = (select.child("button") as Element orelse panic()).child("selectedcontent") as Element orelse panic();
      assert(content.html == "<selectedcontent>B<b class=\"c\">b</b><!--n--></selectedcontent>") { content.html };
      assert(content.clonedFrom == null) { "parsed, not copied" };
      let options = select.children;
      let chosen = options[options.length - 1] as Element orelse panic();
      let copies = content.children;
      let originals = chosen.children;
      assert(copies.length == 3 && originals.length == 3) { "three copied" };
      for (var i = 0; i < copies.length; i += 1) {
        let copy = copies[i];
        let original = originals[i];
        assert(original.clonedFrom == null) { "an original" };
        let from = copy.clonedFrom as BuiltNode orelse panic();
        assert(from.html == original.html && from.origin?.span?.toString() == original.origin?.span?.toString()) { "clonedFrom ${i.toString()}" };
        assert(copy.origin?.span?.toString() == original.origin?.span?.toString()) { "origin ${i.toString()}" };
      }
      let b = copies[1] as Element orelse panic();
      assert((b.startTag as StartTag orelse panic()).asWritten == "<b class=c>") { "start tag shared" };
      let inner = b.children[0];
      assert(inner.clonedFrom?.html == "b") { "copies inside copies point back too" };
    }

    test("which option selectedcontent copies") {
      let cases = [
        ["<select><button><selectedcontent></button><option>X", "X"],
        ["<select><button><selectedcontent></button><option disabled>X<option>Y", "Y"],
        ["<select><button><selectedcontent></button><optgroup disabled><option>X</optgroup><option>Y", "Y"],
        ["<select><button><selectedcontent></button><option>X<option selected>Y<option selected>Z<option>W", "Z"],
        ["<select size=3><button><selectedcontent></button><option>X<option>Y", ""],
        ["<select size=3><button><selectedcontent></button><option>X<option selected>Y", "Y"],
        ["<select size=' +1x'><button><selectedcontent></button><option>X", "X"],
        ["<select multiple><button><selectedcontent>kept</button><option selected>X", "kept"],
        ["<select><option>X</option><button><selectedcontent></button>", "X"],
        ["<select><button><selectedcontent></button><datalist><option>X</datalist><option>Y", "Y"],
      ];
      for (var i = 0; i < cases.length; i += 1) {
        let got = selectedContentOf(cases[i][0]).html;
        let want = "<selectedcontent>${cases[i][1]}</selectedcontent>";
        assert(got == want) { "${i.toString()}: ${got}" };
      }
      let nested = parseHtml("<select><option><selectedcontent></selectedcontent>X</option></select>").html;
      assert(nested == "<html><head></head><body><select><option><selectedcontent></selectedcontent>X</option></select></body></html>") { nested };
      let plain = parseHtml("<button><selectedcontent></selectedcontent></button><option>X").html;
      assert(plain == "<html><head></head><body><button><selectedcontent></selectedcontent></button><option>X</option></body></html>") { plain };
    }
