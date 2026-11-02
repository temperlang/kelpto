// The demo's edits as steps, and each step as code in every language.
//
// A step is what one edit changes, by the index path kelpto-md's API takes
// to reach it: `{ kind, path, value }`, where each part of `path` is a
// property and an index into it if it's a list. The document's own lists
// (`headings`, `tables`, `taskListItems`, `linkReferenceDefinitions`, and
// `links`) are typed, so no path needs a cast. The page edits through
// `applyStep`, and the code panel shows `codeFor`, so the code says what
// the page did. `build.py` runs the JavaScript (and Python) code and
// checks that it prints what `applyStep` gives.

import { LinkTarget, MarkdownParser } from "kelpto-md";

/**
 * @typedef {[name: string, index?: number]} PathPart
 * @typedef {"heading" | "cell" | "task" | "definition" | "link"} StepKind
 * @typedef {{ kind: StepKind, path: PathPart[], value: string | boolean }} Step
 * @typedef {{ input: string, gfm: boolean, steps: Step[] }} Program
 */

/** Each kind's method, as in JavaScript. @type {Record<StepKind, string>} */
const METHODS = { heading: "withText", cell: "withText", task: "withChecked", definition: "withDestination", link: "withDestination" };

/**
 * The node a path reaches in a document.
 *
 * @param {any} doc
 * @param {PathPart[]} path
 */
function reach(doc, path) {
  let node = doc;
  for (const [name, index] of path) {
    node = node[name];
    if (index !== undefined) node = node[index];
    if (node === undefined || node === null) throw new Error(`Nothing at ${name}${index ?? ""}.`);
  }
  return node;
}

/**
 * The document after one step, as the page makes it.
 *
 * @param {any} doc
 * @param {Step} step
 */
export function applyStep(doc, step) {
  const node = reach(doc, step.path);
  const value = step.kind === "definition" || step.kind === "link" ? new LinkTarget(String(step.value)) : step.value;
  return node[METHODS[step.kind]](value);
}

/** @param {Program} program */
export const parserFor = (program) => (program.gfm ? MarkdownParser.gfm : MarkdownParser.commonMark);

// String literals. Each language has an escaped one-line form that takes any
// text, and most have a readable multiline form, used when it's safe.

/** @param {string} s */
const codePoints = (s) => Array.from(s, (ch) => /** @type {number} */ (ch.codePointAt(0)));
/** @param {number} cp */
const isControl = (cp) => cp < 0x20 || cp === 0x7f;
/** @param {number} cp */
const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;
/** @param {number} n @param {number} width */
const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, "0");
/** @param {number} n */
const octal = (n) => `\\${n.toString(8).padStart(3, "0")}`;

/**
 * Text escaped by `escape`, which maps one code point (with the text and
 * where it is) to its form inside the literal.
 *
 * @param {string} s
 * @param {(cp: number, ch: string, rest: string) => string} escape
 */
function escapeEach(s, escape) {
  let out = "";
  let i = 0;
  for (const ch of s) {
    i += ch.length;
    out += escape(/** @type {number} */ (ch.codePointAt(0)), ch, s.slice(i));
  }
  return out;
}

/** Common escapes, or null to fall through. @param {number} cp */
function basic(cp) {
  if (cp === 0x5c) return "\\\\";
  if (cp === 0x0a) return "\\n";
  if (cp === 0x0d) return "\\r";
  if (cp === 0x09) return "\\t";
  return null;
}

/** Text split into lines, each with its line feed. @param {string} s */
const linesOf = (s) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [""];

/** Whether text has nothing a raw literal can't hold: no controls but tabs and line feeds. @param {string} s */
const plain = (s) => codePoints(s).every((cp) => cp === 0x09 || cp === 0x0a || (!isControl(cp) && !isSurrogate(cp)));

/** Python: escaped, or triple-quoted for text with a line feed. */
function pyString(/** @type {string} */ s, multiline = false) {
  return (multiline ? '"""' : '"') + escapeEach(s, (cp, ch, rest) => {
    if (multiline && cp === 0x0a) return "\n";
    if (cp === 0x22) return !multiline || rest === "" || rest.startsWith('"') ? '\\"' : '"';
    return basic(cp) ?? (isControl(cp) ? `\\x${hex(cp, 2)}` : isSurrogate(cp) ? `\\u${hex(cp, 4)}` : ch);
  }) + (multiline ? '"""' : '"');
}

/** JavaScript: escaped, or a template literal for text with a line feed. */
function jsString(/** @type {string} */ s, multiline = false) {
  const q = multiline ? "`" : '"';
  return q + escapeEach(s, (cp, ch, rest) => {
    if (multiline && cp === 0x0a) return "\n";
    if (ch === q) return `\\${q}`;
    if (multiline && ch === "$" && rest.startsWith("{")) return "\\$";
    if (cp === 0x2028 || cp === 0x2029) return `\\u${hex(cp, 4)}`;
    return basic(cp) ?? (isControl(cp) ? `\\x${hex(cp, 2)}` : isSurrogate(cp) ? `\\u${hex(cp, 4)}` : ch);
  }) + q;
}

/** Rust: one string, with line feeds as written when multiline. */
function rsString(/** @type {string} */ s, multiline = false) {
  return '"' + escapeEach(s, (cp, ch) => {
    if (multiline && cp === 0x0a) return "\n";
    if (cp === 0x22) return '\\"';
    if (cp === 0) return "\\0";
    return basic(cp) ?? (isControl(cp) ? `\\u{${hex(cp, 2)}}` : isSurrogate(cp) ? "\\u{FFFD}" : ch);
  }) + '"';
}

/** C++: escaped, with control characters and non-ASCII as UTF-8 bytes in octal. */
function cppEscaped(/** @type {string} */ s) {
  const utf8 = new TextEncoder();
  return '"' + escapeEach(s, (cp, ch, rest) => {
    if (cp === 0x22) return '\\"';
    // Not a trigraph, in C++14.
    if (cp === 0x3f && rest.startsWith("?")) return "?\\";
    return basic(cp) ?? (isControl(cp) || cp > 0x7e ? Array.from(utf8.encode(ch), octal).join("") : ch);
  }) + '"';
}

/** Java: escaped, with control characters in octal. */
function javaEscaped(/** @type {string} */ s) {
  return '"' + escapeEach(s, (cp, ch) => {
    if (cp === 0x22) return '\\"';
    return basic(cp) ?? (isControl(cp) ? octal(cp) : ch);
  }) + '"';
}

/** C#: escaped, with control characters as \u. */
function csEscaped(/** @type {string} */ s) {
  return '"' + escapeEach(s, (cp, ch) => {
    if (cp === 0x22) return '\\"';
    if (cp === 0) return "\\0";
    return basic(cp) ?? (isControl(cp) || isSurrogate(cp) ? `\\u${hex(cp, 4)}` : ch);
  }) + '"';
}

/** Lua: escaped, with control characters in decimal. */
function luaEscaped(/** @type {string} */ s) {
  return '"' + escapeEach(s, (cp, ch) => {
    if (cp === 0x22) return '\\"';
    return basic(cp) ?? (isControl(cp) ? `\\${String(cp).padStart(3, "0")}` : isSurrogate(cp) ? `\\u{${hex(cp, 4)}}` : ch);
  }) + '"';
}

/**
 * Lines joined into one expression, as `join` puts them, each line
 * escaped by `escape`.
 *
 * @param {string} s
 * @param {(line: string) => string} escape
 * @param {string} join
 */
const joined = (s, escape, join) => linesOf(s).map(escape).join(join);

/** C++: a raw string for plain ASCII, else one string per line. */
function cppText(/** @type {string} */ s) {
  if (s.includes("\n") && plain(s) && codePoints(s).every((cp) => cp < 0x7f)) {
    let delimiter = "";
    for (let n = 1; s.includes(`)${delimiter}"`); n++) delimiter = n === 1 ? "md" : `md${n}`;
    return `R"${delimiter}(${s})${delimiter}"`;
  }
  return joined(s, cppEscaped, "\n      ");
}

/** Java: a text block when it can hold the text exactly, else one string per line. */
function javaText(/** @type {string} */ s, /** @type {string} */ indent) {
  const lines = linesOf(s);
  // Text blocks strip trailing white space; spaces and tabs can be escaped.
  const safe = s.includes("\n") && plain(s.replaceAll("\r", "")) && lines.every((line) => !/[^ \t\r\n\S]\n?$/u.test(line));
  if (!safe) return joined(s, javaEscaped, `\n${indent}    + `);
  const body = lines.map((line) => {
    const feed = line.endsWith("\n");
    const content = feed ? line.slice(0, -1) : line;
    const escaped = escapeEach(content, (cp, ch, rest) => {
      if (cp === 0x5c) return "\\\\";
      if (cp === 0x09) return "\\t";
      if (cp === 0x0d) return "\\r";
      if (cp === 0x22 && rest.startsWith('"')) return '\\"';
      if (cp === 0x20 && rest === "") return "\\s";
      return ch;
    });
    return `${indent}${escaped}${feed ? "" : "\\"}\n`;
  });
  return `"""\n${body.join("")}${indent}"""`;
}

/** C#: a verbatim string when it can hold the text, else one string per line. */
function csText(/** @type {string} */ s) {
  if (s.includes("\n") && plain(s)) return `@"${s.replaceAll('"', '""')}"`;
  return joined(s, csEscaped, " +\n    ");
}

/** Lua: a long string when it can hold the text, else one string per line. */
function luaText(/** @type {string} */ s) {
  if (s.includes("\n") && plain(s)) {
    let level = "";
    // The closing bracket must first appear at the end.
    while ((s + `]${level}]`).indexOf(`]${level}]`) !== s.length) level += "=";
    // A line feed right after the opening bracket isn't part of the string.
    return `[${level}[\n${s}]${level}]`;
  }
  return joined(s, luaEscaped, "\n  .. ");
}

// Each language's spelling of the API, after its tour.

/** @param {string} name */
const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** @param {string} name */
const pascal = (name) => name[0].toUpperCase() + name.slice(1);

/**
 * @typedef {{
 *   imports: (names: string[]) => string,
 *   open: string, close: string,
 *   text: [string, (s: string) => string, string],
 *   parse: (gfm: boolean, edits: boolean) => string,
 *   part: (expr: string, name: string, index?: number) => string,
 *   call: (expr: string, method: string, arg: string) => string,
 *   value: (s: string) => string,
 *   bool: (b: boolean) => string,
 *   target: (arg: string) => string,
 *   check: (kind: StepKind) => string,
 *   assign: (expr: string) => string,
 *   print: string,
 *   indent: string,
 * }} Spelling
 */

/** @type {Record<string, Spelling>} */
const SPELLINGS = {
  cpp: {
    imports: (names) =>
      `#include <iostream>\n#include <string>\n\n#include "kelpto-md/init.hpp"\n\n` +
      names.map((n) => `using kelpto_md::${n};\n`).join(""),
    open: "\nint main() {\n",
    close: "}\n",
    text: ["  std::string text = ", cppText, ";\n"],
    parse: (gfm) => `  auto doc = MarkdownParser::${gfm ? "gfm" : "commonMark"}()->parse(text);\n`,
    part: (expr, name, index) => `${expr}->get_${name}()${index === undefined ? "" : `->at(${index})`}`,
    call: (expr, method, arg) => `${expr}->${method}(${arg})`,
    value: cppEscaped,
    bool: String,
    target: (arg) => `LinkTarget::make(${arg})`,
    check: () => "",
    assign: (expr) => `  doc = ${expr};\n`,
    print: '  std::cout << doc->get_asWritten() << "\\n";\n',
    indent: "  ",
  },
  cs: {
    imports: () => "using System;\nusing KelptoMd;\n",
    open: "\n",
    close: "",
    text: ["var text = ", csText, ";\n"],
    parse: (gfm) => `var doc = MarkdownParser.${gfm ? "Gfm" : "CommonMark"}.Parse(text);\n`,
    part: (expr, name, index) => `${expr}.${pascal(name)}${index === undefined ? "" : `[${index}]`}`,
    call: (expr, method, arg) => `${expr}.${pascal(method)}(${arg})`,
    value: csEscaped,
    bool: String,
    target: (arg) => `new LinkTarget(${arg})`,
    check: () => "",
    assign: (expr) => `doc = ${expr};\n`,
    print: "Console.WriteLine(doc.AsWritten);\n",
    indent: "",
  },
  java: {
    imports: (names) => [...names, "MarkdownDocument"].sort().map((n) => `import kelpto_md.${n};\n`).join(""),
    open: "\npublic class Edits {\n    public static void main(String[] args) {\n",
    close: "    }\n}\n",
    text: ["        String text = ", (s) => javaText(s, "        "), ";\n"],
    parse: (gfm) => `        MarkdownDocument doc = MarkdownParser.${gfm ? "gfm" : "commonMark"}.parse(text);\n`,
    part: (expr, name, index) => `${expr}.get${pascal(name)}()${index === undefined ? "" : `.get(${index})`}`,
    call: (expr, method, arg) => `${expr}.${method}(${arg})`,
    value: javaEscaped,
    bool: String,
    target: (arg) => `new LinkTarget(${arg})`,
    check: () => "",
    assign: (expr) => `        doc = ${expr};\n`,
    print: "        System.out.println(doc.getAsWritten());\n",
    indent: "        ",
  },
  js: {
    imports: (names) => `import { ${names.join(", ")} } from "kelpto-md";\n`,
    open: "\n",
    close: "",
    text: ["const text = ", (s) => jsString(s, s.includes("\n")), ";\n"],
    parse: (gfm, edits) => `${edits ? "let" : "const"} doc = MarkdownParser.${gfm ? "gfm" : "commonMark"}.parse(text);\n`,
    part: (expr, name, index) => `${expr}.${name}${index === undefined ? "" : `[${index}]`}`,
    call: (expr, method, arg) => `${expr}.${method}(${arg})`,
    value: (s) => jsString(s),
    bool: String,
    target: (arg) => `new LinkTarget(${arg})`,
    check: () => "",
    assign: (expr) => `doc = ${expr};\n`,
    print: "console.log(doc.asWritten);\n",
    indent: "",
  },
  lua: {
    imports: (names) => `local md = require("kelpto-md")\nlocal ${names.join(", ")} = ${names.map((n) => `md.${n}`).join(", ")}\n`,
    open: "\n",
    close: "",
    text: ["local text = ", luaText, "\n"],
    parse: (gfm) => `local doc = MarkdownParser.${gfm ? "gfm" : "commonMark"}:parse(text)\n`,
    part: (expr, name, index) => `${expr}.${name}${index === undefined ? "" : `[${index + 1}]`}`,
    call: (expr, method, arg) => `${expr}:${method}(${arg})`,
    value: luaEscaped,
    bool: String,
    target: (arg) => `LinkTarget(${arg})`,
    check: () => "",
    assign: (expr) => `doc = ${expr}\n`,
    print: "print(doc.asWritten)\n",
    indent: "",
  },
  py: {
    imports: (names) => `from kelpto_md import ${names.join(", ")}\n`,
    open: "\n",
    close: "",
    text: ["text = ", (s) => pyString(s, s.includes("\n")), "\n"],
    parse: (gfm) => `doc = MarkdownParser.${gfm ? "gfm" : "common_mark"}.parse(text)\n`,
    part: (expr, name, index) => `${expr}.${snake(name)}${index === undefined ? "" : `[${index}]`}`,
    call: (expr, method, arg) => `${expr}.${snake(method)}(${arg})`,
    value: (s) => pyString(s),
    bool: (b) => (b ? "True" : "False"),
    target: (arg) => `LinkTarget(${arg})`,
    check: () => "",
    assign: (expr) => `doc = ${expr}\n`,
    print: "print(doc.as_written)\n",
    indent: "",
  },
  rs: {
    imports: (names) => `use kelpto_md::${names.length > 1 ? `{${names.join(", ")}}` : names[0]};\n`,
    open: "\nfn main() {\n",
    close: "}\n",
    text: ["    let text = ", (s) => rsString(s, s.includes("\n")), ";\n"],
    parse: (gfm, edits) => `    let ${edits ? "mut " : ""}doc = MarkdownParser::${gfm ? "gfm" : "common_mark"}().parse(text);\n`,
    part: (expr, name, index) => `${expr}.${snake(name)}()${index === undefined ? "" : `[${index}]`}`,
    call: (expr, method, arg) => `${expr}.${snake(method)}(${arg})`,
    value: (s) => rsString(s),
    bool: String,
    target: (arg) => `LinkTarget::new(${arg})`,
    check: (kind) => (kind === "definition" || kind === "link" ? '.expect("one line")' : ""),
    assign: (expr) => `    doc = ${expr};\n`,
    print: '    println!("{}", doc.as_written());\n',
    indent: "    ",
  },
};

export const CODE_LANGUAGES = Object.keys(SPELLINGS);

/**
 * A program that makes the same edits, in one language: the code before
 * the input's literal, the literal, and the code after it.
 *
 * @param {string} language
 * @param {Program} program
 * @returns {{ before: string, literal: string, after: string }}
 */
export function codeFor(language, { input, gfm, steps }) {
  const s = SPELLINGS[language];
  const names = new Set(["MarkdownParser"]);
  const edits = steps.map((step) => {
    let expr = "doc";
    for (const [name, index] of step.path) expr = s.part(expr, name, index);
    let arg = typeof step.value === "boolean" ? s.bool(step.value) : s.value(step.value);
    if (step.kind === "definition" || step.kind === "link") {
      arg = s.target(arg);
      names.add("LinkTarget");
    }
    return s.assign(s.call(expr, METHODS[step.kind], arg) + s.check(step.kind));
  });
  const [prefix, literalOf, suffix] = s.text;
  const before = s.imports([...names].sort()) + s.open + prefix;
  const literal = literalOf(input);
  const after = suffix + s.parse(gfm, steps.length > 0) + edits.join("") + s.print + s.close;
  return { before, literal, after };
}

/** The whole program, as Copy gives it. @param {string} language @param {Program} program */
export function programFor(language, program) {
  const { before, literal, after } = codeFor(language, program);
  return before + literal + after;
}
