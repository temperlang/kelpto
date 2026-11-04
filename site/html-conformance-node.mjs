// Runs html5lib-tests' tokenizer tests and web-platform-tests' tree
// construction tests through the built site's kelpto-html in Node, as the
// libraries' own runners do (tests/html5lib-tokenizer and
// tests/wpt-tree-construction), and prints the counts as JSON. The tests
// come from those test libraries' JS builds in `temper.out/js`; `build.py`
// fails unless enough pass, and puts the counts in the page.
//
//     node site/html-conformance-node.mjs site/build TOKENIZER_TESTS_JS TREE_TESTS_JS

import { pathToFileURL } from "node:url";
import { loadLibrary } from "./lib-node.mjs";

const [build, tokenizerPath, treePath] = process.argv.slice(2);
const html = await loadLibrary(build, "kelpto-html");
const { tokenizerTests, namedEntityTests } = await import(pathToFileURL(tokenizerPath).href);
const { treeTests } = await import(pathToFileURL(treePath).href);
const {
  BuiltComment, BuiltDoctype, BuiltProcessingInstruction, BuiltText, Comment, ContentState, Doctype, DroppedTag, Element,
  EndTag, FragmentContext, HtmlParser, HtmlTokenizer, ProcessingInstruction, StartTag, Text,
} = html;

// The tokenizer, as tests/html5lib-tokenizer/tokenizer-tests.temper.md
// checks it: tokens and errors in the canonical form the generator wrote.

const FIELD = "\u{1F}";

/** @param {string} name */
function stateFor(name) {
  /** @type {Record<string, any>} */
  const states = {
    "RCDATA state": ContentState.rcdata,
    "RAWTEXT state": ContentState.rawtext,
    "Script data state": ContentState.scriptData,
    "PLAINTEXT state": ContentState.plaintext,
    "CDATA section state": ContentState.cdataSection,
  };
  return states[name] ?? ContentState.data;
}

/** @param {any} token */
function tokenString(token) {
  if (token instanceof StartTag) {
    let out = `StartTag${FIELD}${token.name}`;
    for (const a of token.attributes) out += `${FIELD}${a.name}${FIELD}${a.value}`;
    return token.selfClosing ? `${out}\u{1D}` : out;
  }
  if (token instanceof EndTag) return `EndTag${FIELD}${token.name}`;
  if (token instanceof Comment) return `Comment${FIELD}${token.text}`;
  if (token instanceof ProcessingInstruction) return `ProcessingInstruction${FIELD}${token.target}${FIELD}${token.data}`;
  if (token instanceof Doctype) {
    const orNone = (/** @type {string | null} */ s) => s ?? "\u{0}";
    return ["DOCTYPE", orNone(token.name), orNone(token.publicId), orNone(token.systemId), token.forceQuirks ? "false" : "true"].join(FIELD);
  }
  return "?";
}

/** @param {any} result */
function tokenStrings(result) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let chars = null;
  for (const child of result.tokens.children) {
    if (child instanceof Text) {
      chars = (chars ?? "") + child.text;
    } else if (!(child instanceof DroppedTag)) {
      if (chars !== null) out.push(`Character${FIELD}${chars}`);
      chars = null;
      out.push(tokenString(child));
    }
  }
  if (chars !== null) out.push(`Character${FIELD}${chars}`);
  return out;
}

/** An error as `code:line:col`, columns in UTF-16 units. @param {string} input @param {any} error */
function errorString(input, error) {
  let line = 1;
  let column = 1;
  const points = Array.from(input);
  for (let k = 0; k < error.offset && k < points.length; k++) {
    const c = points[k];
    if (c === "\n" || (c === "\r" && points[k + 1] !== "\n")) {
      line += 1;
      column = 1;
    } else if (c !== "\r") {
      column += c.length;
    }
  }
  return `${error.code}:${line}:${column}`;
}

/** As the runner reads three of domjs.test's expected errors. @param {any} test */
function expectedErrors(test) {
  if (test.file !== "domjs.test") return test.errors;
  return test.errors
    .split("unexpected-question-mark-instead-of-tag-name:1:2")
    .join("invalid-first-character-of-processing-instruction-target:1:3");
}

/** @param {any} test */
function tokenizerPasses(test) {
  const tokenizer = HtmlTokenizer.html
    .withStateSwitching(false)
    .withInitialState(stateFor(test.state))
    .withLastStartTag(test.lastStartTag);
  const result = tokenizer.tokenize(test.input);
  if (result.tokens.asWritten !== test.input) return false;
  if (tokenStrings(result).join("\u{1E}") !== test.tokens) return false;
  return result.errors.map((/** @type {any} */ e) => errorString(test.input, e)).join(",") === expectedErrors(test);
}

// Tree construction, as tests/wpt-tree-construction/tree-tests.temper.md
// checks it: the tree in the .dat files' dump format.

/** By code point, as the runner sorts. @param {string} a @param {string} b */
function before(a, b) {
  const x = Array.from(a, (c) => /** @type {number} */ (c.codePointAt(0)));
  const y = Array.from(b, (c) => /** @type {number} */ (c.codePointAt(0)));
  for (let i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return x.length < y.length;
}

/** @param {any[]} nodes @param {number} depth @param {string[]} out */
function dump(nodes, depth, out) {
  const pad = "  ".repeat(depth);
  for (const node of nodes) {
    if (node instanceof Element) {
      const space = node.namespace;
      out.push(`${pad}<${space === "html" ? "" : `${space} `}${node.name}>`);
      const attributes = node.attributes.map((/** @type {any} */ a) => ({
        name: a.prefix ? `${a.prefix} ${a.name}` : a.name,
        value: a.value,
      }));
      attributes.sort((/** @type {any} */ a, /** @type {any} */ b) => (before(a.name, b.name) ? -1 : before(b.name, a.name) ? 1 : 0));
      for (const a of attributes) out.push(`${pad}  ${a.name}="${a.value}"`);
      if (space === "html" && node.name === "template") {
        out.push(`${pad}  content`);
        dump(node.templateContents, depth + 2, out);
      }
      dump(node.children, depth + 1, out);
    } else if (node instanceof BuiltText) {
      out.push(`${pad}"${node.text}"`);
    } else if (node instanceof BuiltComment) {
      out.push(`${pad}<!-- ${node.text} -->`);
    } else if (node instanceof BuiltDoctype) {
      out.push(
        node.publicId || node.systemId
          ? `${pad}<!DOCTYPE ${node.name} "${node.publicId}" "${node.systemId}">`
          : `${pad}<!DOCTYPE ${node.name}>`,
      );
    } else if (node instanceof BuiltProcessingInstruction) {
      out.push(`${pad}<?${node.target} ${node.data}?>`);
    } else {
      out.push(`${pad}?`);
    }
  }
}

/** @param {any} test @param {boolean} scripting */
function treeFor(test, scripting) {
  const parser = HtmlParser.html.withScripting(scripting);
  /** @type {string[]} */
  const out = [];
  if (!test.fragment) {
    const doc = parser.parse(test.input);
    if (doc.asWritten !== test.input) return "not lossless";
    out.push("#document");
    dump(doc.children, 0, out);
  } else {
    const parts = test.fragment.split(" ");
    const context = parts.length === 2 ? new FragmentContext(parts[1], parts[0]) : new FragmentContext(test.fragment);
    const fragment = parser.parseFragment(test.input, context);
    if (fragment.asWritten !== test.input) return "not lossless";
    dump(fragment.children, 0, out);
  }
  return out.join("\n");
}

/** @param {any} test */
function treePasses(test) {
  const expected = test.fragment ? test.tree : `#document\n${test.tree}`;
  if (test.scripting !== "off" && treeFor(test, true) !== expected) return false;
  if (test.scripting !== "on" && treeFor(test, false) !== expected) return false;
  return true;
}

/** @param {any[]} tests @param {(test: any) => boolean} passes @param {(test: any) => string} label */
function score(tests, passes, label) {
  const failing = tests.filter((test) => !passes(test)).map(label);
  return { passed: tests.length - failing.length, total: tests.length, failing };
}

const trees = treeTests();
/** @param {any} test */
const treeLabel = (test) => `${test.file}: ${test.input}${test.fragment ? ` (in ${test.fragment})` : ""}`;
const results = {
  tokenizer: score([...tokenizerTests(), ...namedEntityTests()], tokenizerPasses, (test) => `${test.file} ${test.description}`),
  documents: score(trees.filter((/** @type {any} */ t) => !t.fragment), treePasses, treeLabel),
  fragments: score(trees.filter((/** @type {any} */ t) => t.fragment), treePasses, treeLabel),
};
process.stdout.write(JSON.stringify(results) + "\n");
