# Sanitizing

A sanitizer for HTML from people you don't trust, judging the tree a
browser builds (an `HtmlFragment`'s, an `HtmlDocument`'s body, or a
`FragmentStream`'s), never the text as written, so nothing written to
confuse a parser gets past it: what's kept is what a browser would
see. It keeps only what a `SanitizerPolicy` allows, checks every URL
it keeps, and gives `SafeHtml`, serialized from what it kept, with
a list of what it removed.

```temper inert
let safe = sanitizeHtml("<a href='java&#x09;script:alert(1)' onclick=x>Hi</a><script>alert(2)</script>");
safe.html;                                  // "<a>Hi</a>"
let strict = SanitizerPolicy.standard.withoutElements(["img"]).withSchemes(["https"]);
parseHtmlFragment("<img src=x.png><a href=http://a.example>a</a>", new FragmentContext("div"))
  .sanitize(strict).html;                   // "<a>a</a>"
let removed = parseHtmlFragment("<b style=x onclick=y>b</b>", new FragmentContext("div")).sanitize().removals;
removed[0].name;                            // "style", its origin the <b> start tag
```

## What it guarantees

- **Only what the policy allows:** each element is kept (with only its
  allowed attributes), dropped with everything in it (`script`,
  `style`, `template`, `iframe`, `object`, `embed`, `noscript`,
  `textarea`, `title`, and the rest of `dropsContents`, and any SVG or
  MathML element not allowed), or else replaced by its children, which
  are judged in turn. Comments, processing instructions, and DOCTYPEs
  are dropped. Text stays, escaped.
- **Every URL checked:** each URL attribute kept (`href`, `src`,
  `srcset`'s every candidate, `cite`, `action`, `formaction`, `poster`,
  `xlink:href`, and the others in `urlAttributes`) goes through the
  policy's `UrlCheck`, and is dropped if the check says no.
- **What it gives parses back to itself:** the output is parsed again,
  as a fragment in the same context with scripting on (as `innerHTML`
  parses), and sanitized again; it's returned only when that changes
  nothing and serializes to the same text. Otherwise the second
  result goes round again (up to 4 times), and if it never settles,
  only the text is kept. So what a browser builds from the output is
  exactly the tree the output was serialized from, all of it allowed,
  whatever mutation XSS trick the input tries (a `<p>` the browser
  closes, a `<form>` it ignores, a namespace it switches). The cost is
  one more fragment parse of the output, and a walk of it: about half
  of `renderSafe`'s time (see "Sanitizing" in docs/design.md).
- **For one context:** the output is safe to put where it was
  sanitized for, as the contents of the context element (`body` by
  default, or any `div`-like element). Elsewhere (inside a `table`, a
  `textarea`, or SVG) it can read otherwise. A context whose contents
  aren't HTML (`script`, `style`, `textarea`, `title`, and the other
  elements dropped with their contents, or SVG or MathML, unless the
  policy allows them) gives nothing.

Foreign content (SVG and MathML) is dropped by default, since it's
parsed otherwise than HTML (CDATA sections, `<style>` holding
elements, and elements such as `mglyph` and `annotation-xml` that
switch namespaces), which is what namespace confusion and mutation XSS
attacks on sanitizers use. A policy can allow it by namespaced names
(`svg:svg`, `svg:circle`), but SVG's `script` and animation elements
(`animate`, `set`, and the rest, which can rewrite an `href`) are never
kept.

    let svgNever = nameSet("svg:script svg:animate svg:animateMotion svg:animateTransform svg:animateColor svg:set svg:discard");

The HTML elements dropped with what's in them, unless the policy
allows them: those whose contents aren't plain HTML text and elements
(scripts, styles, raw text, templates, plug-ins, frames), or that
would show something other than the text (a `title`, a `textarea`'s
value), or change the page around them (`base`, `meta`, `link`); and
`selectedcontent`, whose contents are copies of the selected `option`'s
(see "Customizable select" in build.temper.md), so they'd show twice
once the `option` is replaced by its children, as forms are.

    let dropsContents = nameSet(
      "script style template iframe object embed applet noscript noembed noframes xmp plaintext textarea title frameset frame param base basefont bgsound link meta head selectedcontent"
    );

Attributes never kept, even if allowed: `srcdoc` is a whole HTML
document, unchecked.

    let attributesNever = nameSet("srcdoc");

Attributes holding URLs, checked by the `UrlCheck`; `srcset` holds a
list of image candidates, and `ping` and `archive` space-separated URLs.

    let urlAttributes = nameSet(
      "href src srcset action formaction poster cite xlink:href background longdesc lowsrc dynsrc data codebase classid manifest ping icon profile archive itemtype"
    );

## Safe HTML

HTML this library sanitized: a type of its own, so code can ask for it
by type rather than trusting any string. Only the sanitizer makes one.
`removals` lists what it removed, in document order (see `Removal`).

    export class SafeHtml {
      public html: String;
      public removals: List<Removal>;
      private constructor(html: String, removals: List<Removal>) {
        this.html = html;
        this.removals = removals;
      }
      public toString(): String { html }
    }

## What was removed

One thing the sanitizer removed, for showing people what happened to
their HTML. Cheap: made only when something is removed, so a document
with nothing to remove costs nothing more. `kind` is one of:

- `"element"`: an element dropped with everything in it (nothing in it
  is listed apart).
- `"tag"`: an element replaced by its children, which are judged in
  turn.
- `"attribute"`: an attribute the policy doesn't allow.
- `"url"`: a URL attribute the policy's `UrlCheck` refused, so dropped.
- `"comment"`, `"doctype"`, or `"processing instruction"`: a node of
  that kind, dropped.

`name` is the element's name as policies name it (`img`, `svg:circle`)
or the attribute's (`onclick`, `xlink:href`), or `""`; `element` is
the element's name (the same as `name` for an element or tag), or `""`
for other nodes; and `value` is the attribute's value, or `""`.
`origin` is the element's or node's, as `BuiltNode.origin` gives it
(the start tag, or in kelpto the Markdown node, that made it). It's
null for an element the standard implies, for `sanitizeHtml`, which
keeps no tokens (parse with `parseHtmlFragment` and `sanitize` to
have them), and for anything removed only when the output was parsed
again (see "What it guarantees"; in that rare case, the last such
parse may remove every tag, and each is listed). A context that isn't
allowed gives nothing, with nothing listed.

    export class Removal(
      public kind: String,
      public name: String,
      public element: String,
      public value: String,
      public origin: RedNode?,
    ) {}

## Checking URLs

How the sanitizer checks each URL it keeps: the URL to write, or null
to drop the attribute. `element` is the element's name (`svg:a` in
SVG) and `attribute` the attribute's (`xlink:href` with a prefix).

This is where Hrefine plugs in: a `UrlCheck` that parses the URL as
browsers do and checks its scheme, host, and anything else, and may
give it back normalized. A check that changes a URL in a `srcset`,
`ping`, or `archive` list drops the attribute, for now.

    export interface UrlCheck {
      public checkUrl(url: String, element: String, attribute: String): String?;
    }

The default check: a URL is kept if its scheme, read as browsers read
it (`urlScheme`), is one of `schemes`, or, if `relative`, if it has
none. Nothing else about the URL is checked or changed.

    export class SchemeUrlCheck extends UrlCheck {
      public schemes: List<String>;
      public relative: Boolean;

      public constructor(schemes: List<String>, relative: Boolean = true) {
        this.schemes = schemes;
        this.relative = relative;
      }

      public checkUrl(url: String, element: String, attribute: String): String? {
        let scheme = urlScheme(url);
        if (scheme == null) {
          if (relative) { url } else { null }
        } else {
          var found = false;
          for (var i = 0; i < schemes.length; i += 1) {
            if (asciiLowercase(schemes[i]) == scheme) { found = true; }
          }
          if (found) { url } else { null }
        }
      }
    }

A URL's scheme as the URL standard's parser reads it, lowercase, or
null if it has none (a relative URL, such as `/a`, `//host/a`, `#x`,
or `a:b` where `a` couldn't be a scheme): leading and trailing C0
controls and spaces are skipped, tabs and line breaks anywhere are
ignored, and a scheme is an ASCII letter, then letters, digits, `+`,
`-`, and `.`, up to a `:`. So `" JaVa\tScript:x"` has the scheme
`javascript`. Character references are already decoded in the built
tree's attributes, so `java&#x09;script:` reads the same.

    export let urlScheme(url: String): String? {
      var start = String.begin;
      var end = url.end;
      while (url.hasIndex(start) && url[start] <= 0x20) { start = url.next(start); }
      while (end > start && url[url.prev(end)] <= 0x20) { end = url.prev(end); }
      let scheme = new StringBuilder();
      var first = true;
      var i = start;
      while (i < end) {
        let c = url[i];
        if (c == char'\t' || c == char'\n' || c == char'\r') {
          i = url.next(i);
        } else if (c == char':') {
          return if (first) { null } else { scheme.toString() };
        } else if (isAsciiAlpha(c) || (!first && (isAsciiDigit(c) || c == char'+' || c == char'-' || c == char'.'))) {
          scheme.appendCodePoint(if (c >= char'A' && c <= char'Z') { c + 32 } else { c }) orelse panic();
          first = false;
          i = url.next(i);
        } else {
          return null;
        }
      }
      null
    }

The URLs in a `srcset`, as the standard's "parse a srcset attribute"
splits it: candidates apart by commas, each a URL then descriptors
(which may hold commas inside parentheses).

    let srcsetUrls(value: String): List<String> {
      let urls = new ListBuilder<String>();
      var i = String.begin;
      while (value.hasIndex(i)) {
        while (value.hasIndex(i) && (isAsciiWhitespace(value[i]) || value[i] == char',')) { i = value.next(i); }
        if (!value.hasIndex(i)) { break; }
        let start = i;
        while (value.hasIndex(i) && !isAsciiWhitespace(value[i])) { i = value.next(i); }
        var end = i;
        if (value[value.prev(end)] == char',') {
          while (end > start && value[value.prev(end)] == char',') { end = value.prev(end); }
        } else {
          var depth = 0;
          while (value.hasIndex(i) && (depth > 0 || value[i] != char',')) {
            if (value[i] == char'(') { depth += 1; }
            if (value[i] == char')' && depth > 0) { depth -= 1; }
            i = value.next(i);
          }
        }
        if (end > start) { urls.add(value.slice(start, end)); }
      }
      urls.toList()
    }

    let spacedUrls(value: String): List<String> {
      let urls = new ListBuilder<String>();
      var i = String.begin;
      while (value.hasIndex(i)) {
        while (value.hasIndex(i) && isAsciiWhitespace(value[i])) { i = value.next(i); }
        let start = i;
        while (value.hasIndex(i) && !isAsciiWhitespace(value[i])) { i = value.next(i); }
        if (i > start) { urls.add(value.slice(start, i)); }
      }
      urls.toList()
    }

## The policy

What the sanitizer keeps: elements by name, attributes by element
(`"*"` for any), and a `UrlCheck`. A value, like `MarkdownParser`:
each `with…` gives a new policy. Names are as the built tree has them:
lowercase in HTML, and SVG and MathML ones prefixed with their
namespace, in SVG's mixed case (`svg:foreignObject`); an attribute
with a prefix as `xlink:href`.

`standard` keeps what Markdown and GFM render, and common formatting
that can't run anything or change the page around it, as listed
below. `input` is kept
only as a checkbox (GFM's task list items), so no form can be faked.
`id` and `class` are kept: footnotes need ids, and code blocks their
`language-` class. An `id` can still clash with the page's own (DOM
clobbering, if the page's scripts read `window.someId`); a prefix for
user ids, as GitHub's `user-content-`, isn't here yet.

`github` is `standard` and the presentational attributes GitHub keeps
in READMEs: `align`, `valign`, `width`, `height`, `border`,
`cellpadding`, `cellspacing`, `nowrap`, `hspace`, `vspace`, `clear`,
`noshade`, `colspan`, `rowspan`, `headers`, `scope`, `abbr`, and
`axis` on any element, and `tt` and `strike`, for a centered logo or a
table laid out as on GitHub. Like `standard`, and GitHub, it drops
`style` (which can restyle the page), comments, and attributes GitHub
doesn't know, such as Python-Markdown's `markdown`; unlike GitHub, it
keeps `id` and `class`, which Kelpto's own HTML needs.

`textOnly` keeps only text: build a policy up from nothing with it.

    export class SanitizerPolicy {
      private elements: Map<String, Boolean>;
      private attributes: Map<String, Boolean>;
      public urlCheck: UrlCheck;

      private constructor(elements: Map<String, Boolean>, attributes: Map<String, Boolean>, urlCheck: UrlCheck) {
        this.elements = elements;
        this.attributes = attributes;
        this.urlCheck = urlCheck;
      }

      // Built by `named`, with the names inline, since in Python and
      // Lua a static's initializer can't call module-level functions
      // or read module-level values.
      public static standard: SanitizerPolicy = SanitizerPolicy.named(
        "a abbr b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp section small source span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr",
        "*=id,class,title,lang,dir a=href,aria-label,data-footnote-ref,data-footnote-backref,data-footnote-backref-idx img=src,srcset,alt,width,height source=srcset,media,type,width,height ol=start,reversed,type li=value td=align,colspan,rowspan th=align,colspan,rowspan,scope col=span colgroup=span input=type,checked,disabled section=data-footnotes blockquote=cite q=cite del=cite,datetime ins=cite,datetime time=datetime details=open",
      );

      public static github: SanitizerPolicy = SanitizerPolicy.named(
        "a abbr b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp section small source span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr",
        "*=id,class,title,lang,dir,align,valign,width,height,border,cellpadding,cellspacing,nowrap,hspace,vspace,clear,noshade,colspan,rowspan,headers,scope,abbr,axis a=href,aria-label,data-footnote-ref,data-footnote-backref,data-footnote-backref-idx img=src,srcset,alt source=srcset,media,type ol=start,reversed,type li=value input=type,checked,disabled section=data-footnotes blockquote=cite q=cite del=cite,datetime ins=cite,datetime time=datetime details=open col=span colgroup=span",
      );

      public static textOnly: SanitizerPolicy = SanitizerPolicy.named("", "");

Elements apart by spaces, and attributes as `element=attribute,…`
groups apart by spaces.

      private static named(elementNames: String, attributeGroups: String): SanitizerPolicy {
        let elements = new MapBuilder<String, Boolean>();
        let attributes = new MapBuilder<String, Boolean>();
        if (!elementNames.isEmpty) {
          let names = elementNames.split(" ");
          for (var i = 0; i < names.length; i += 1) { elements[names[i]] = true; }
        }
        if (!attributeGroups.isEmpty) {
          let groups = attributeGroups.split(" ");
          for (var i = 0; i < groups.length; i += 1) {
            let parts = groups[i].split("=");
            let names = parts[1].split(",");
            for (var j = 0; j < names.length; j += 1) { attributes["${parts[0]} ${names[j]}"] = true; }
          }
        }
        new SanitizerPolicy(elements.toMap(), attributes.toMap(), new SchemeUrlCheck(["http", "https", "mailto"]))
      }

Also keeps these elements.

      public withElements(names: List<String>): SanitizerPolicy {
        new SanitizerPolicy(withKeys(elements, names, "", true, true), attributes, urlCheck)
      }

No longer keeps these elements (which may then be dropped with their
contents, or replaced by them, as above).

      public withoutElements(names: List<String>): SanitizerPolicy {
        new SanitizerPolicy(withKeys(elements, names, "", false, true), attributes, urlCheck)
      }

Also keeps these attributes on `element` (`"*"` for any element).

      public withAttributes(element: String, names: List<String>): SanitizerPolicy {
        new SanitizerPolicy(elements, withKeys(attributes, names, "${elementKey(element)} ", true, isHtmlKey(element)), urlCheck)
      }

No longer keeps these attributes on `element`, as given to
`withAttributes` (so removing one from `"*"` takes `"*"`).

      public withoutAttributes(element: String, names: List<String>): SanitizerPolicy {
        new SanitizerPolicy(elements, withKeys(attributes, names, "${elementKey(element)} ", false, isHtmlKey(element)), urlCheck)
      }

Checks URLs with `check` instead.

      public withUrlCheck(check: UrlCheck): SanitizerPolicy {
        new SanitizerPolicy(elements, attributes, check)
      }

Keeps URLs with these schemes, and relative ones, instead (the
default is `http`, `https`, and `mailto`).

      public withSchemes(schemes: List<String>): SanitizerPolicy {
        withUrlCheck(new SchemeUrlCheck(schemes))
      }

      public allowsElement(name: String): Boolean { elements.getOr(name, false) }

      public allowsAttribute(element: String, attribute: String): Boolean {
        attributes.getOr("${element} ${attribute}", false) || attributes.getOr("* ${attribute}", false)
      }
    }

HTML names lowercase; namespaced ones, and attributes of SVG and
MathML elements (such as `viewBox`), as given.

    let isHtmlKey(name: String): Boolean { name.split(":").length == 1 }

    let elementKey(name: String): String { if (isHtmlKey(name)) { asciiLowercase(name) } else { name } }

    let withKeys(map: Map<String, Boolean>, names: List<String>, prefix: String, on: Boolean, lower: Boolean): Map<String, Boolean> {
      let out = map.toMapBuilder();
      for (var i = 0; i < names.length; i += 1) {
        let name = names[i];
        out["${prefix}${if (lower && isHtmlKey(name)) { asciiLowercase(name) } else { name }}"] = on;
      }
      out.toMap()
    }

## The walk

One pass over the built tree in document order, writing what's kept as
the standard's serialization writes it, with a stack rather than
recursion, so deep nesting can't overflow the call stack. `changes`
counts what it dropped or changed, so the reparse check can tell an
output that's already settled; each removal goes in `removals`, with
its origin from `tokens` (null for a tree without them).

    class Sanitizer {
      private tree: BuiltTree;
      private tokens: HtmlTokens?;
      private policy: SanitizerPolicy;
      private removals: ListBuilder<Removal>;
      public out: StringBuilder = new StringBuilder();
      public var changes: Int = 0;

      public constructor(tree: BuiltTree, tokens: HtmlTokens?, policy: SanitizerPolicy, removals: ListBuilder<Removal>) {
        this.tree = tree;
        this.tokens = tokens;
        this.policy = policy;
        this.removals = removals;
      }

      private removed(kind: String, name: String, element: String, value: String, id: Int): Void {
        changes += 1;
        removals.add(new Removal(kind, name, element, value, originAt(id)));
      }

      private originAt(id: Int): RedNode? {
        let index = tree.tokenIndexes[id];
        if (index < 0) { return null; }
        if (tree.joined) { return tree.origins[index]; }
        let known = tokens;
        if (known != null) { return originOf(tree, known, id); }
        null
      }

The children of `root`, in a context whose text is raw (not escaped)
if `rawContext`.

      public run(root: Int, rawContext: Boolean): Void {
        let ids = new ListBuilder<Int>();
        let kept = new ListBuilder<Boolean>();
        let raws = new ListBuilder<Boolean>();
        var raw = rawContext;
        var node = tree.firsts[root];
        while (true) {
          if (node < 0) {
            if (ids.isEmpty) { break; }
            let id = ids.removeLast();
            if (kept.removeLast()) { out.append("</${tree.names[id]}>"); }
            raws.removeLast();
            raw = if (raws.isEmpty) { rawContext } else { raws[raws.length - 1] };
            node = tree.nexts[id];
            continue;
          }
          let kind = tree.kinds[node];
          if (kind == elementNode) {
            let decision = decide(node);
            if (decision == keepIt) {
              let name = tree.names[node];
              out.append("<${name}");
              writeAttributes(node);
              out.append(">");
              if (tree.spaces[node] == htmlNs && voidNames.has(name)) {
                node = tree.nexts[node];
                continue;
              }
              raw = tree.spaces[node] == htmlNs && rawTextParents.has(name);
            } else {
              let key = elementKeyOf(node);
              removed(if (decision == dropIt) { "element" } else { "tag" }, key, key, "", node);
              if (decision == dropIt) {
                node = tree.nexts[node];
                continue;
              }
            }
            ids.add(node);
            kept.add(decision == keepIt);
            raws.add(raw);
            let container = tree.contents[node];
            node = tree.firsts[if (container >= 0) { container } else { node }];
            continue;
          }
          if (kind == textNode) {
            out.append(if (raw) { tree.datas[node] } else { escapeText(tree.datas[node], false) });
          } else {
            let what = if (kind == commentNode) { "comment" } else if (kind == doctypeNode) { "doctype" } else { "processing instruction" };
            removed(what, "", "", "", node);
          }
          node = tree.nexts[node];
        }
      }

      private elementKeyOf(id: Int): String {
        let space = tree.spaces[id];
        if (space == svgNs) {
          "svg:${tree.names[id]}"
        } else if (space == mathNs) {
          "math:${tree.names[id]}"
        } else {
          tree.names[id]
        }
      }

      private decide(id: Int): Int {
        let name = tree.names[id];
        let space = tree.spaces[id];
        if (space != htmlNs) {
          let key = elementKeyOf(id);
          return if (policy.allowsElement(key) && !svgNever.has(key)) { keepIt } else { dropIt };
        }
        if (policy.allowsElement(name)) {
          if (name == "input" && asciiLowercase(attributeOf(id, "type")) != "checkbox") { return dropIt; }
          return keepIt;
        }
        if (dropsContents.has(name)) { dropIt } else { unwrapIt }
      }

      private attributeOf(id: Int, name: String): String {
        let triples = tree.attributeLists[id];
        for (var i = 0; i + 2 < triples.length; i += 3) {
          if (triples[i].isEmpty && triples[i + 1] == name) { return triples[i + 2]; }
        }
        ""
      }

      private writeAttributes(id: Int): Void {
        let element = elementKeyOf(id);
        let triples = tree.attributeLists[id];
        for (var i = 0; i + 2 < triples.length; i += 3) {
          let prefix = triples[i];
          let name = triples[i + 1];
          let value = triples[i + 2];
          let key = if (prefix.isEmpty) { name } else { "${prefix}:${name}" };
          if (attributesNever.has(key) || !policy.allowsAttribute(element, key)) {
            removed("attribute", key, element, value, id);
            continue;
          }
          let checked = if (urlAttributes.has(key)) { checkUrls(value, element, key) } else { value };
          if (checked == null) {
            removed("url", key, element, value, id);
          } else {
            if (checked != value) { changes += 1; }
            let qualified = if (prefix == "xmlns" && name == "xmlns") { "xmlns" } else { key };
            out.append(" ${qualified}=\"${escapeText(checked, true)}\"");
          }
        }
      }

      private checkUrls(value: String, element: String, attribute: String): String? {
        let check = policy.urlCheck;
        if (attribute != "srcset" && attribute != "ping" && attribute != "archive") {
          return check.checkUrl(value, element, attribute);
        }
        let urls = if (attribute == "srcset") { srcsetUrls(value) } else { spacedUrls(value) };
        for (var i = 0; i < urls.length; i += 1) {
          let url = urls[i];
          if (check.checkUrl(url, element, attribute) != url) { return null; }
        }
        value
      }
    }

    let dropIt = 0;
    let unwrapIt = 1;
    let keepIt = 2;

## Sanitizing a tree

The children of `root` in `tree`, sanitized for `context`, checked by
parsing the output again (see "What it guarantees", above), with
origins from `tokens` (null if the tree has none, or is joined).

    let sanitizeTree(tree: BuiltTree, tokens: HtmlTokens?, root: Int, context: FragmentContext, policy: SanitizerPolicy): SafeHtml {
      let space = context.namespace;
      let name = if (space == "html") { asciiLowercase(context.name) } else { "${space}:${context.name}" };
      let allowed = if (space == "html") {
        policy.allowsElement(name) || !dropsContents.has(name)
      } else {
        policy.allowsElement(name) && !svgNever.has(name)
      };
      if (root < 0 || !allowed) { return new SafeHtml("", []); }
      let raw = space == "html" && rawTextParents.has(name);
      let removals = new ListBuilder<Removal>();
      let first = new Sanitizer(tree, tokens, policy, removals);
      first.run(root, raw);
      var html = first.out.toString();
      for (var round = 0; round < 4; round += 1) {
        let reparsed = fragmentTree(html, context);
        let again = new Sanitizer(reparsed, null, policy, removals);
        again.run(reparsed.fragmentRoot, raw);
        let next = again.out.toString();
        if (again.changes == 0 && next == html) { return new SafeHtml(html, removals.toList()); }
        html = next;
      }
      let last = fragmentTree(html, context);
      let text = new Sanitizer(last, null, SanitizerPolicy.textOnly, removals);
      text.run(last.fragmentRoot, raw);
      new SafeHtml(text.out.toString(), removals.toList())
    }

The built tree of `text` parsed as a fragment in `context`, with
scripting on, as browsers parse `innerHTML`.

    let fragmentTree(text: String, context: FragmentContext): BuiltTree {
      let builder = new TreeBuilder(true);
      let state = builder.startFragment(context);
      let machine = new Tokenizer(text, "", true, builder, false);
      machine.run(state);
      builder.tree
    }

Parses `text` as a fragment in `context` (`body` by default), as
`innerHTML` does, and sanitizes it by `policy`.

    export let sanitizeHtml(
      text: String,
      policy: SanitizerPolicy = SanitizerPolicy.standard,
      context: FragmentContext = new FragmentContext("body"),
    ): SafeHtml {
      let tree = fragmentTree(text, context);
      sanitizeTree(tree, null, tree.fragmentRoot, context, policy)
    }

## Tests

Copies `selectedcontent` made are built nodes like any other, so
they're judged as the original is, and listed apart in `removals`
with the original's origin. `select`, `option`, `button`, and
`selectedcontent` aren't in `standard` (no forms), so by default the
options' text stays and the copies go.

    test("selectedcontent copies are sanitized as their original") {
      let text = "<select><button><selectedcontent></selectedcontent></button><option><img src=a.png onerror=x()><script>y()</script>A</option></select>";
      let body = new FragmentContext("body");
      let byDefault = parseHtmlFragment(text, body).sanitize();
      assert(byDefault.html == "<img src=\"a.png\">A") { byDefault.html };
      let removed = removalsOf(byDefault);
      assert(removed == "tag select select= @0+8 | tag button button= @8+8 | element selectedcontent selectedcontent= @16+17 | tag option option= @60+8 | attribute img onerror=x() @68+27 | element script script= @95+8") { removed };
      let forms = SanitizerPolicy.standard.withElements(["select", "option", "button", "selectedcontent"]);
      let allowed = parseHtmlFragment(text, body).sanitize(forms);
      let both = "<img src=\"a.png\">A";
      assert(allowed.html == "<select><button><selectedcontent>${both}</selectedcontent></button><option>${both}</option></select>") { allowed.html };
      let twice = removalsOf(allowed);
      assert(twice == "attribute img onerror=x() @68+27 | element script script= @95+8 | attribute img onerror=x() @68+27 | element script script= @95+8") { twice };
      let reparsed = parseHtmlFragment(allowed.html, body);
      assert(reparsed.html == allowed.html && reparsed.sanitize(forms).html == allowed.html) { "reparses to itself" };
    }

    test("schemes, read as browsers read them") {
      let cases = [
        ["javascript:x", "javascript"], ["JaVaScRiPt:x", "javascript"], [" \u{1}java\tscr\nipt:x", "javascript"],
        ["java\r\nscript:x", "javascript"], ["\u{1F}vbscript:x ", "vbscript"], ["data:text/html,x", "data"],
        ["a+b-c.d:x", "a+b-c.d"], ["/a:b", ""], ["//host/x", ""], ["#a:b", ""], ["?a:b", ""], ["1a:b", ""],
        ["java script:x", ""], ["\u{A0}javascript:x", ""], [":x", ""], ["", ""], ["https", ""], ["c:\\x", "c"],
      ];
      for (var i = 0; i < cases.length; i += 1) {
        let scheme = urlScheme(cases[i][0]) ?? "";
        assert(scheme == cases[i][1]) { "${i.toString()}: ${scheme}" };
      }
      let urls = srcsetUrls(" a.png 1x,b.png,, c(1).png 2x, d.png (x, y) 3x ,e.png").join("|") { (s: String): String => s };
      assert(urls == "a.png|b.png|c(1).png|d.png|e.png") { urls };
    }

HTML alone: each input sanitized as a fragment in `body`, and the
output checked to parse back to itself.

    test("sanitizing HTML") {
      let cases = [
        ["<p onclick=x>Hi <b>there</b><script>alert(1)</script></p>", "<p>Hi <b>there</b></p>"],
        ["<a href='java&#x09;script:alert(1)' title=t>a</a> <a href=\"https://x.example/\">b</a>", "<a title=\"t\">a</a> <a href=\"https://x.example/\">b</a>"],
        ["<unknown-element>kept <i>text</i></unknown-element><object><b>gone</b></object>", "kept <i>text</i>"],
        ["<table><td>a<td>b</table>x", "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>x"],
        ["<svg><circle r=1></circle></svg><math><mi>x</mi></math>", ""],
        ["<!-- c --><!DOCTYPE html><?pi x?>text", "text"],
        ["<input type=checkbox checked disabled> <input type=password> <input>", "<input type=\"checkbox\" checked=\"\" disabled=\"\">  "],
        ["<a href=\"&#x6A;avascript:alert(1)\" ping=\"/p https://x.example/\">a</a>", "<a>a</a>"],
        ["a&nbsp;&lt;b&gt;&amp;\"'", "a&nbsp;&lt;b&gt;&amp;\"'"],
      ];
      let body = new FragmentContext("body");
      for (var i = 0; i < cases.length; i += 1) {
        let html = sanitizeHtml(cases[i][0]).html;
        assert(html == cases[i][1]) { "${i.toString()}: ${html}" };
        let reparsed = parseHtmlFragment(html, body);
        assert(reparsed.html == html && reparsed.sanitize().html == html) { "${i.toString()}: reparses otherwise" };
      }
    }

    test("documents, contexts, and policies") {
      let doc = parseHtml("<!DOCTYPE html><title>T</title><base href=/x><p>One<p>Two <img src=a.png alt=A>");
      assert(doc.sanitize().html == "<p>One</p><p>Two <img src=\"a.png\" alt=\"A\"></p>") { doc.sanitize().html };
      assert(parseHtml("<frameset></frameset>").sanitize().html == "") { "a frameset has no body" };
      let script = parseHtmlFragment("alert(1)", new FragmentContext("script")).sanitize().html;
      assert(script == "") { script };
      let svg = parseHtmlFragment("<circle/>", new FragmentContext("svg", "svg")).sanitize().html;
      assert(svg == "") { svg };
      let row = parseHtmlFragment("<td>1<td onclick=x>2", new FragmentContext("tr")).sanitize().html;
      assert(row == "<td>1</td><td>2</td>") { row };
      let withSvg = SanitizerPolicy.standard.withElements(["svg:svg", "svg:circle", "svg:animate", "svg:a"])
        .withAttributes("svg:svg", ["viewBox"]).withAttributes("svg:circle", ["r"]).withAttributes("svg:a", ["xlink:href"]);
      let drawn = sanitizeHtml("<svg viewbox='0 0 2 2'><circle r=1 onload=x></circle><animate attributeName=href to=javascript:x></animate><a xlink:href=javascript:x>a</a></svg>", withSvg).html;
      assert(drawn == "<svg viewBox=\"0 0 2 2\"><circle r=\"1\"></circle><a>a</a></svg>") { drawn };
      let noImages = sanitizeHtml("<img src=a.png><p class=x>p</p>", SanitizerPolicy.standard.withoutElements(["img"]).withoutAttributes("*", ["class"])).html;
      assert(noImages == "<p>p</p>") { noImages };
      let https = sanitizeHtml("<a href=http://a.example>a</a><a href=https://b.example>b</a><a href=/c>c</a>", SanitizerPolicy.standard.withSchemes(["https"])).html;
      assert(https == "<a>a</a><a href=\"https://b.example\">b</a><a href=\"/c\">c</a>") { https };
      let strictRelative = sanitizeHtml("<a href=/c>c</a>", SanitizerPolicy.standard.withUrlCheck(new SchemeUrlCheck(["https"], false))).html;
      assert(strictRelative == "<a>c</a>") { strictRelative };
    }

What was removed, each as kind, element, name, value, and origin,
with the output unchanged.

    let removalsOf(safe: SafeHtml): String {
      safe.removals.join(" | ") { (r: Removal): String =>
        "${r.kind} ${r.element} ${r.name}=${r.value} @${r.origin?.span?.toString() ?? "-"}"
      }
    }

    test("what sanitizing removed") {
      let body = new FragmentContext("body");
      let text = "<p onclick=x>Hi <span style=\"color: red\">there</span><script>a()</script><!--c--> <a href=javascript:x title=t>a</a><u-x>u</u-x><svg><circle/></svg>";
      let safe = parseHtmlFragment(text, body).sanitize();
      assert(safe.html == sanitizeHtml(text).html) { safe.html };
      assert(safe.html == "<p>Hi <span>there</span> <a title=\"t\">a</a>u</p>") { safe.html };
      let removed = removalsOf(safe);
      assert(removed == "attribute p onclick=x @0+13 | attribute span style=color: red @16+25 | element script script= @53+8 | comment  = @73+8 | url a href=javascript:x @82+29 | tag u-x u-x= @116+5 | element svg:svg svg:svg= @128+5") { removed };
      let plain = removalsOf(sanitizeHtml(text));
      assert(plain.split(" @-").length == 8) { "no origins from text: ${plain}" };
      assert(sanitizeHtml("<p title=t>ok</p>").removals.isEmpty) { "nothing removed" };
      let doc = parseHtml("<!DOCTYPE html><p><button><div>x</div></button></p><?pi?>");
      let page = removalsOf(doc.sanitize());
      assert(page == "tag button button= @18+8 | processing instruction  = @51+6") { page };
      let stream = new FragmentStream(body);
      stream.write("<b title=\"", parseHtmlFragment("a", body).tokens.node);
      stream.write("\"onclick=x>b</b>", parseHtmlFragment("bc", body).tokens.node);
      stream.end();
      let joined = removalsOf(stream.sanitize());
      assert(joined == "attribute b onclick=x @0+1") { joined };
    }

Deep nesting doesn't overflow the stack, since the walk doesn't
recurse.

    test("deep nesting") {
      let deep = new StringBuilder();
      for (var i = 0; i < 3000; i += 1) { deep.append("<span>"); }
      deep.append("x");
      let html = sanitizeHtml(deep.toString()).html;
      assert(html.split("<span>").length == 3001 && html.split("</span>").length == 3001) { "spans kept" };
    }
