// Kelpto's site: the opening demo (demo.js), and the tour in each language,
// with the JavaScript one run in the page. kelpto-md comes from Temper's JS
// output, as plain ES modules named by the page's import map.

import * as kelptoMd from "kelpto-md";
import { initDemo } from "./demo.js";
import { runTour } from "./tourrun.js";

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

initDemo();

// Code tabs for the tour, in each language, with a small highlighter, as on
// Hrefine's site. Alphabetical, with Python first chosen.

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

/** @type {Map<string, Promise<string>>} */
const sources = new Map();
let selected = DEFAULT_LANGUAGE;
const tabRow = /** @type {HTMLElement} */ (document.querySelector("[data-tabs]"));

/** @param {string} file */
async function selectLanguage(file) {
  selected = file;
  const [, , run, comment] = /** @type {string[]} */ (LANGUAGES.find(([, f]) => f === file));
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (tabRow.querySelectorAll("button"))) {
    const on = button.dataset.file === file;
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
  }
  $("run-command").textContent = run;
  // Only JavaScript runs here; on another tab, the button switches to it.
  const runButton = $("tour-run");
  runButton.textContent = file === "js" ? "Run in your browser" : "Run the JavaScript tour";
  runButton.classList.toggle("outline", file !== "js");
  $("tour-output").hidden = true;
  $("tour-run-note").textContent =
    file === "js"
      ? "Runs the JavaScript tour in this page."
      : "Only JavaScript runs in this page. Run this one locally with the command above.";
  const source = await loadSource(file).catch(() => "// Couldn't load this tour.");
  if (selected === file) $("tour-source").innerHTML = highlight(source, comment);
}

/**
 * A tour's source, fetched once, or again after a failure.
 *
 * @param {string} file
 * @returns {Promise<string>}
 */
function loadSource(file) {
  let source = sources.get(file);
  if (!source) {
    source = fetch(`tour/tour.${file}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Couldn't load the tour (${response.status}).`);
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

for (const [i, [name, file]] of LANGUAGES.entries()) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", "tour-source");
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
selectLanguage(DEFAULT_LANGUAGE);

// The JavaScript tour runs in the page (tourrun.js, which the build also
// runs in Node), with kelpto-md from this page's copy, and its output is
// compared with the text every language's tour prints.

$("tour-run").addEventListener("click", async () => {
  if (selected !== "js") selectLanguage("js");
  const output = $("tour-output");
  const note = $("tour-run-note");
  output.hidden = false;
  output.textContent = "Running…";
  try {
    // Waits for the source, in case the click beat it.
    const out = await runTour(await loadSource("js"), { "kelpto-md": kelptoMd });
    output.textContent = out;
    const expected = await (await fetch("tour/expected.txt")).text();
    note.textContent =
      out === expected ? "✓ The same output as every other language." : "✗ The output differs from the other languages.";
  } catch (error) {
    output.textContent = String(error);
    note.textContent = "";
  }
});

// What the page loads for kelpto-md, measured when the site was built.

fetch("sizes.json")
  .then((response) => response.json())
  .then((/** @type {{ name: string, raw: number, gzip: number }[]} */ sizes) => {
    const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(0)} KB`;
    $("sizes").textContent = sizes
      .map(({ name, raw, gzip }) => `This page loads ${name}: ${kb(raw)}, or ${kb(gzip)} gzipped.`)
      .join(" ");
  })
  .catch(() => {});
