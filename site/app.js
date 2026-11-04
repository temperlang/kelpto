// Kelpto's site: the opening demo (demo.js), with its edits as code in each
// language (editcode.js); the HTML side, with a parser to try and the
// sanitizer's gallery (htmlside.js); Kelpto in a view function; and the
// tour in each language, with the JavaScript one run in the page. Kelpto
// comes from Temper's JS output, as plain ES modules named by the page's
// import map.

import * as kelptoMd from "kelpto-md";
import { initDemo } from "./demo.js";
import { codeFor, programFor } from "./editcode.js";
import { initHtmlSection, initSafeGallery } from "./htmlside.js";
import { loadHtmlSide } from "./tree.js";
import { runTour } from "./tourrun.js";

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// Code tabs for the demo's edits, the view function, and the tour, in each
// language, with a small highlighter, as on Hrefine's site. Alphabetical,
// with Python first chosen. Every row of tabs shares the choice.

/** Name, tour file extension, run command, line comment. */
const LANGUAGES = [
  ["C++", "cpp", "cmake -B build && cmake --build build && ./build/tour", "//"],
  ["C#", "cs", "dotnet run", "//"],
  ["Java", "java", "./gradlew run", "//"],
  ["JavaScript", "js", "npm ci && npm start", "//"],
  ["Lua", "lua", "lua -l paths tour.lua", "--"],
  ["Python", "py", "uv run tour.py", "#"],
  ["Rust", "rs", "cargo run", "//"],
];
const DEFAULT_LANGUAGE = "py";

const KEYWORDS = new Set(
  ("and as async auto await bool break case catch class const continue def do else elif end except export " +
    "false fn for foreach from function if import in int let local match mut new None nil not null " +
    "of or private public return self static string struct then this throw true True False try " +
    "use using var void while is Some Ok Err")
    .split(" "),
);

/**
 * Source as HTML, with comments, strings, numbers, keywords, and type-like
 * names in spans.
 *
 * @param {string} source
 * @param {string} comment
 */
function highlight(source, comment) {
  const commentPattern = comment === "#" ? "#[^\\n]*" : comment === "--" ? "--[^\\n]*" : "//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  const token = new RegExp(
    `(${commentPattern})|("""[\\s\\S]*?"""|'''[\\s\\S]*?'''|\\[\\[[\\s\\S]*?\\]\\]|R"\\([\\s\\S]*?\\)"|@"(?:[^"]|"")*"|` +
      `"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`[^\`]*\`)|` +
      `\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b|([A-Za-z_]\\w*)`,
    "g",
  );
  let out = "";
  let last = 0;
  for (const m of source.matchAll(token)) {
    out += escapeHtml(source.slice(last, m.index));
    const [text, isComment, isString, isNumber, word] = m;
    const cls = isComment
      ? "comment"
      : isString
        ? "string"
        : isNumber
          ? "number"
          : KEYWORDS.has(word)
            ? "keyword"
            : /^[A-Z][a-z]/.test(word)
              ? "type"
              : null;
    out += cls ? `<span class="tok-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
    last = (m.index ?? 0) + text.length;
  }
  return out + escapeHtml(source.slice(last));
}

/** Fetched files, by path. @type {Map<string, Promise<string>>} */
const sources = new Map();
let selected = DEFAULT_LANGUAGE;
const tabRows = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-tabs]")]);

/** @param {string} file */
const commentOf = (file) => /** @type {string[]} */ (LANGUAGES.find(([, f]) => f === file))[3];

/** @param {string} file */
async function selectLanguage(file) {
  selected = file;
  const [, , run, comment] = /** @type {string[]} */ (LANGUAGES.find(([, f]) => f === file));
  for (const button of tabRows.flatMap((row) => /** @type {HTMLElement[]} */ ([...row.querySelectorAll("button")]))) {
    const on = button.dataset.file === file;
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
  }
  showCode();
  $("run-command").textContent = run;
  // Only JavaScript runs here; on another tab, the button switches to it.
  const runButton = $("tour-run");
  runButton.textContent = file === "js" ? "Run in your browser" : "Run the JavaScript tour";
  runButton.classList.toggle("outline", file !== "js");
  $("tour-output").hidden = true;
  $("tour-run-note").textContent =
    file === "js"
      ? "Runs the JavaScript tour in this page."
      : file === "rs"
        ? "Only JavaScript runs in this page. Rust's doesn't build yet: Temper's Rust backend has a bug that rustc rejects in kelpto-md."
        : "Only JavaScript runs in this page. Run this one locally with the command above.";
  const [source, view] = await Promise.all([
    loadSource(`tour/tour.${file}`).catch(() => `${comment} Couldn't load this tour.`),
    loadSource(`view/view.${file}`).catch(() => `${comment} Couldn't load this example.`),
  ]);
  if (selected !== file) return;
  $("tour-source").innerHTML = highlight(source, comment);
  $("view-source").innerHTML = highlight(view, comment);
}

/**
 * A file's text, fetched once, or again after a failure.
 *
 * @param {string} file
 * @returns {Promise<string>}
 */
function loadSource(file) {
  let source = sources.get(file);
  if (!source) {
    source = fetch(file)
      .then((response) => {
        if (!response.ok) throw new Error(`Couldn't load ${file} (${response.status}).`);
        return response.text();
      })
      .catch((error) => {
        sources.delete(file);
        throw error;
      });
    sources.set(file, source);
  }
  return source;
}

for (const tabRow of tabRows) {
  for (const [i, [name, file]] of LANGUAGES.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", /** @type {string} */ (tabRow.dataset.tabs));
    button.dataset.file = file;
    button.textContent = name;
    button.addEventListener("click", () => selectLanguage(file));
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (step) {
        const next = (i + step + LANGUAGES.length) % LANGUAGES.length;
        selectLanguage(LANGUAGES[next][1]);
        /** @type {HTMLElement} */ (tabRow.children[next]).focus();
      }
    });
    tabRow.append(button);
  }
}

// The demo's edits as code: the input as a literal, folded when it's long,
// and one line per edit. Copy gives the whole program.

/** @type {import("./editcode.js").Program | null} */
let program = null;
/** Whether the input's literal shows in full, until the input changes. */
let literalOpen = false;

/**
 * A literal as HTML, folded to its first and last lines, or its start and
 * end, behind a button that shows the rest.
 *
 * @param {string} literal
 */
function foldedLiteral(literal) {
  const string = (/** @type {string} */ s) => `<span class="tok-string">${escapeHtml(s)}</span>`;
  const lines = literal.split("\n");
  const button = (/** @type {string} */ label) => `<button type="button" class="fold" aria-expanded="false">${label}</button>`;
  if (literalOpen) return string(literal);
  if (lines.length > 4) {
    const n = lines.length - 2;
    return `${string(lines[0])}\n${button(`⋯ ${n.toLocaleString("en")} more lines`)}\n${string(lines[lines.length - 1])}`;
  }
  const chars = Array.from(literal);
  if (lines.length === 1 && chars.length > 72) {
    const n = chars.length - 52;
    return `${string(chars.slice(0, 48).join(""))}${button(`⋯ ${n.toLocaleString("en")} more characters`)}${string(chars.slice(-4).join(""))}`;
  }
  return string(literal);
}

function showCode() {
  if (!program) return;
  const { before, literal, after } = codeFor(selected, program);
  const comment = commentOf(selected);
  $("edit-code").innerHTML = highlight(before, comment) + foldedLiteral(literal) + highlight(after, comment);
  const edits = program.steps.length;
  $("code-note").textContent = edits
    ? "One line per edit, with the same calls this page made. Every language prints the same output."
    : "Click something in the preview, and each edit shows here as a line of code.";
}

$("edit-code").addEventListener("click", (event) => {
  if (!(/** @type {HTMLElement} */ (event.target).closest("button.fold"))) return;
  literalOpen = true;
  showCode();
  $("edit-code").parentElement?.focus();
});

$("code-copy").addEventListener("click", async () => {
  if (!program) return;
  const name = /** @type {string[]} */ (LANGUAGES.find(([, f]) => f === selected))[0];
  try {
    await navigator.clipboard.writeText(programFor(selected, program));
    $("code-note").textContent = `Copied the ${name} program.`;
  } catch {
    // Shows the whole program, selected, to copy by hand.
    literalOpen = true;
    showCode();
    getSelection()?.selectAllChildren($("edit-code"));
    $("code-note").textContent = "Couldn't copy here, so the code is selected: copy it from your keyboard.";
  }
});

const demo = initDemo((next) => {
  if (next.input !== program?.input) literalOpen = false;
  program = next;
  showCode();
});
selectLanguage(DEFAULT_LANGUAGE);
initHtmlSection();
initSafeGallery(demo);

// The JavaScript tour runs in the page (tourrun.js, which the build also
// runs in Node), with Kelpto from this page's copy, and its output is
// compared with the text every language's tour prints.

$("tour-run").addEventListener("click", async () => {
  if (selected !== "js") selectLanguage("js");
  const output = $("tour-output");
  const note = $("tour-run-note");
  output.hidden = false;
  output.textContent = "Running…";
  try {
    // Waits for the source, in case the click beat it.
    const { html, kelpto } = await loadHtmlSide();
    const modules = { "kelpto-md": kelptoMd, "kelpto-html": html, kelpto };
    const out = await runTour(await loadSource("tour/tour.js"), modules);
    output.textContent = out;
    const expected = await (await fetch("tour/expected.txt")).text();
    note.textContent =
      out === expected ? "✓ The same output as every other language." : "✗ The output differs from the other languages.";
  } catch (error) {
    output.textContent = String(error);
    note.textContent = "";
  }
});

// What the page loads for Kelpto, measured when the site was built.

fetch("sizes.json")
  .then((response) => response.json())
  .then((/** @type {{ name: string, raw: number, gzip: number }[]} */ sizes) => {
    const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(0)} KB`;
    $("sizes").textContent = sizes
      .map(({ name, raw, gzip }) => `This page loads ${name}: ${kb(raw)}, or ${kb(gzip)} gzipped.`)
      .join(" ");
  })
  .catch(() => {});
