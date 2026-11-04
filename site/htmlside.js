// The page's HTML side: the #html section's parser, which shows the tree
// kelpto-html builds from any HTML (tree.js), and the #safe gallery's
// buttons, which load a case into the demo, sanitized. The gallery itself
// is in the page, rendered when the site was built (build.py).

import { highlighter, loadHtmlSide, treeHtml, treeView } from "./tree.js";

const SAMPLE = `<!doctype html>
<title>Fixed up as browsers do</title>
<p>One<p>Two
<table><td>a cell</table>
<b>bold <i>both</b> italic</i>
<a href=/x id=a id=b>a link</a>
`;

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/**
 * Where a code point offset is, as `line:column`, counting columns in
 * code points.
 *
 * @param {string} text
 * @param {number} offset
 */
function lineColumn(text, offset) {
  let line = 1;
  let column = 1;
  let k = 0;
  for (const ch of text) {
    if (k++ >= offset) break;
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return `${line}:${column}`;
}

/** Starts the #html section's parser. */
export function initHtmlSection() {
  const input = /** @type {HTMLTextAreaElement} */ ($("html-input"));
  const context = /** @type {HTMLSelectElement} */ ($("html-context"));
  const marks = highlighter(input);
  const tree = treeView(
    $("html-tree"),
    $("html-tree-note"),
    (span, reveal) => (span ? marks.show(span, reveal) : marks.clear()),
    (span) => Array.from(input.value).slice(span.from, span.to).join(""),
  );
  input.value = SAMPLE;

  /** @type {{ html: any, kelpto: any } | null} */
  let side = null;
  function parse() {
    if (!side) return;
    const { FragmentContext, parseHtml, parseHtmlFragment } = side.html;
    const text = input.value;
    let parsed;
    if (context.value) {
      const [name, space] = context.value.split(" ").reverse();
      parsed = parseHtmlFragment(text, space ? new FragmentContext(name, space) : new FragmentContext(name));
    } else {
      parsed = parseHtml(text);
    }
    tree.show(treeHtml(parsed.children, side, false), "Nothing: no nodes at all.");
    $("html-serialized").textContent = parsed.html;
    const exact = parsed.asWritten === text;
    const errors = /** @type {any[]} */ (parsed.errors);
    const listed = errors
      .slice(0, 4)
      .map((e) => `<code>${escapeHtml(e.code)}</code> at ${lineColumn(text, e.offset)}`)
      .join(", ");
    $("html-status").innerHTML =
      (exact
        ? `<span class="ok" aria-hidden="true">✓</span> Printed back exactly.`
        : `<span class="bad" aria-hidden="true">✗</span> Printed back differently. That's a bug; please report it.`) +
      (errors.length
        ? ` ${count(errors.length, "parse error")} from the tokenizer: ${listed}${errors.length > 4 ? ", …" : ""}.`
        : " No tokenizer parse errors.");
  }

  $("html-tree").textContent = "Loading the HTML parser…";
  loadHtmlSide().then((loaded) => {
    side = loaded;
    parse();
  });
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(parse, 150);
  });
  context.addEventListener("change", parse);

  // Tree and Serialized views.
  const views = [$("html-view-tree"), $("html-view-html")];
  const panels = [$("html-tree-panel"), $("html-html-panel")];
  const select = (/** @type {number} */ i) => {
    views.forEach((tab, j) => {
      tab.setAttribute("aria-selected", String(i === j));
      tab.tabIndex = i === j ? 0 : -1;
      panels[j].hidden = i !== j;
    });
    marks.clear();
  };
  views.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        select(1 - i);
        views[1 - i].focus();
      }
    });
  });
}

/**
 * Wires the #safe gallery's buttons: each loads its case into the demo,
 * sanitized, as CommonMark, as the gallery renders it.
 *
 * @param {import("./demo.js").Demo} demo
 */
export function initSafeGallery(demo) {
  $("show-tree").addEventListener("click", () => demo.showTree());
  $("safe").addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("button[data-markdown]");
    if (!(button instanceof HTMLElement)) return;
    demo.load(button.dataset.markdown ?? "", { gfm: false, raw: "sanitize" });
    $("try").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    $("md-input").focus({ preventScroll: true });
  });
}
