// The opening demo: Markdown in, rendered HTML out, and edits through
// kelpto-md's API on what's clicked in the preview, with the output shown
// as a diff against the input. Each edit is a step (editcode.js), which the
// code panel shows in every language. kelpto-md comes from Temper's JS
// output, as plain ES modules named by the page's import map.

import {
  Autolink, BlockQuote, Emphasis, FootnoteReference, Heading, Link, ListBlock, MarkdownRenderer, Paragraph,
  Strikethrough, Strong, Table, normalizeLabel,
} from "kelpto-md";
import { applyStep, parserFor } from "./editcode.js";

const SAMPLE = `Release notes
=============

Kelpto keeps   *every* byte, ~~mostly~~ always.
Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.

| Library     | Status |   Since |
|:------------|:------:|--------:|
| kelpto-md   | ready  |     0.1 |
| kelpto-html | early  |         |

* [x] CommonMark
* [ ] HTML trees
    * [ ] html5lib's tests

## Links

Read [the docs][docs], or the [FAQ](https://example.com/faq "FAQ").
Footnotes work too.[^why]

[docs]:   https://example.com/old
[^why]: GitHub has them.
`;

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const encoder = new TextEncoder();
/** @param {string} s */
const bytes = (s) => encoder.encode(s).length;
/** @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

// The parts of a document that the preview can edit, in the order they
// render, leaving out footnote definitions, which render at the end. Each
// has the path the API takes to it from the document (see editcode.js):
// through `headings`, `tables`, `taskListItems`, and `links`, which list
// every one, footnote definitions' too.

/**
 * @typedef {import("./editcode.js").PathPart} PathPart
 * @typedef {{ node: any, path: PathPart[] }} Part
 * @typedef {{ headings: Part[], tables: Part[], tasks: Part[], anchors: Part[] }} Parts
 */

/**
 * Where a node is in a list of the document's, by its span, counting only
 * nodes that `keep` keeps.
 *
 * @param {any[]} list
 * @param {(node: any) => boolean} [keep]
 */
function spans(list, keep = () => true) {
  const key = (/** @type {any} */ node) => `${node.span.start}+${node.span.length}`;
  /** @type {Map<string, number>} */
  const at = new Map();
  list.forEach((node, i) => {
    if (keep(node)) at.set(key(node), i);
  });
  return (/** @type {any} */ node) => /** @type {number} */ (at.get(key(node)));
}

/** @param {any} doc @returns {Parts} */
function partsOf(doc) {
  /** @type {Parts} */
  const parts = { headings: [], tables: [], tasks: [], anchors: [] };
  const index = {
    headings: spans(doc.headings),
    tables: spans(doc.tables),
    tasks: spans(doc.taskListItems),
    links: spans(doc.links),
  };

  /** @param {any[]} blocks */
  function walkBlocks(blocks) {
    for (const block of blocks) {
      if (block instanceof Heading) {
        const path = /** @type {PathPart[]} */ ([["headings", index.headings(block)]]);
        parts.headings.push({ node: block, path });
        walkInlines(block.children);
      } else if (block instanceof Paragraph) {
        walkInlines(block.children);
      } else if (block instanceof BlockQuote) {
        walkBlocks(block.children);
      } else if (block instanceof ListBlock) {
        for (const item of block.items) {
          if (item.task) parts.tasks.push({ node: item.task, path: [["taskListItems", index.tasks(item.task)]] });
          walkBlocks(item.children);
        }
      } else if (block instanceof Table) {
        const path = /** @type {PathPart[]} */ ([["tables", index.tables(block)]]);
        parts.tables.push({ node: block, path });
        for (const row of [block.header, ...block.rows]) {
          for (const cell of row.cells) walkInlines(cell.children);
        }
      }
    }
  }

  /** @param {any[]} inlines */
  function walkInlines(inlines) {
    for (const inline of inlines) {
      if (inline instanceof Link) {
        parts.anchors.push({ node: inline, path: [["links", index.links(inline)]] });
        walkInlines(inline.children);
      } else if (inline instanceof Autolink) {
        parts.anchors.push({ node: inline, path: [] });
      } else if (inline instanceof FootnoteReference) {
        if (inline.definition) parts.anchors.push({ node: inline, path: [] });
      } else if (inline instanceof Emphasis || inline instanceof Strong || inline instanceof Strikethrough) {
        walkInlines(inline.children);
      }
    }
  }

  walkBlocks(doc.children);
  return parts;
}

// A line diff, with what changed inside each changed line.

/**
 * Line by line: the same, removed, or added.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{ op: "same" | "del" | "add", text: string }[]}
 */
function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  /** @type {{ op: "same" | "del" | "add", text: string }[]} */
  const middle = [];
  if (midA.length * midB.length > 4_000_000) {
    for (const text of midA) middle.push({ op: "del", text });
    for (const text of midB) middle.push({ op: "add", text });
  } else {
    // Longest common subsequence, from the end.
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        middle.push({ op: "same", text: midA[i++] });
        j++;
      } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
        middle.push({ op: "del", text: midA[i++] });
      } else {
        middle.push({ op: "add", text: midB[j++] });
      }
    }
  }
  return [
    ...a.slice(0, start).map((text) => ({ op: /** @type {const} */ ("same"), text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ op: /** @type {const} */ ("same"), text })),
  ];
}

/**
 * Where two lines differ: the shared start and end, in code points.
 *
 * @param {string[]} a
 * @param {string[]} b
 */
function within(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { start, end };
}

/** Text with tabs shown, as HTML. @param {string} s */
const shown = (s) => escapeHtml(s).replace(/\t/g, '<span class="tab" title="tab">→\t</span>');

/**
 * The output as HTML, each line marked, with runs of unchanged lines
 * folded, and how many bytes changed.
 *
 * @param {string} input
 * @param {string} output
 */
function diffView(input, output) {
  const ops = diffLines(input.split("\n"), output.split("\n"));
  // split gives a last, empty line after a final newline; it isn't a line.
  if (input.endsWith("\n") && output.endsWith("\n")) ops.pop();
  // Folds unchanged runs only around changes; with none, shows it all.
  const changed = ops.some((op) => op.op !== "same");
  /** @type {string[]} */
  const lines = [];
  let removed = 0;
  let changedLines = 0;
  /** @type {{ op: string, text: string }[]} */
  let dels = [];
  /** @type {{ op: string, text: string }[]} */
  let adds = [];
  /** @type {string[]} */
  let same = [];
  const flushSame = (/** @type {boolean} */ last) => {
    const first = lines.length === 0;
    const keepBefore = first ? 0 : 2;
    const keepAfter = last ? 0 : 2;
    if (changed && same.length > keepBefore + keepAfter + 3) {
      for (const text of same.slice(0, keepBefore)) lines.push(`<span class="ln same">  ${shown(text)}</span>`);
      lines.push(`<span class="ln fold">  ⋯ ${count(same.length - keepBefore - keepAfter, "unchanged line")}</span>`);
      for (const text of same.slice(same.length - keepAfter)) lines.push(`<span class="ln same">  ${shown(text)}</span>`);
    } else {
      for (const text of same) lines.push(`<span class="ln same">  ${shown(text)}</span>`);
    }
    same = [];
  };
  const flushChanges = () => {
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const a = Array.from(dels[k].text);
      const b = Array.from(adds[k].text);
      const { start, end } = within(a, b);
      const cut = (/** @type {string[]} */ s, /** @type {string} */ tag) => {
        const middle = s.slice(start, s.length - end).join("");
        return shown(s.slice(0, start).join("")) + (middle ? `<${tag}>${shown(middle)}</${tag}>` : "") + shown(s.slice(s.length - end).join(""));
      };
      lines.push(`<span class="ln del">- ${cut(a, "del")}</span>`);
      lines.push(`<span class="ln add">+ ${cut(b, "ins")}</span>`);
      removed += bytes(a.slice(start, a.length - end).join(""));
    }
    for (const { text } of dels.slice(pairs)) {
      lines.push(`<span class="ln del">- <del>${shown(text)}</del></span>`);
      removed += bytes(text) + 1;
    }
    for (const { text } of adds.slice(pairs)) lines.push(`<span class="ln add">+ <ins>${shown(text)}</ins></span>`);
    changedLines += Math.max(dels.length, adds.length);
    dels = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.op === "same") {
      if (dels.length || adds.length) flushChanges();
      same.push(op.text);
    } else {
      if (same.length) flushSame(false);
      (op.op === "del" ? dels : adds).push(op);
    }
  }
  if (dels.length || adds.length) flushChanges();
  if (same.length) flushSame(true);
  return { html: lines.join(""), kept: bytes(input) - removed, changedLines };
}

// The preview's own styles, from the page's colors, since it's a separate
// document.

function previewCss() {
  const style = getComputedStyle(document.documentElement);
  const v = (/** @type {string} */ name) => style.getPropertyValue(name).trim();
  return `
    :root { color-scheme: ${matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"}; }
    body { margin: 0; padding: 0.75rem 1rem; background: ${v("--surface")}; color: ${v("--text")};
      font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow-wrap: anywhere; }
    a { color: ${v("--accent")}; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 0.8em 0 0.4em; }
    h1:first-child, h2:first-child { margin-top: 0.2em; }
    code, pre, kbd { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; }
    pre, code, kbd { background: ${v("--code-bg")}; border-radius: 0.3rem; }
    code, kbd { padding: 0.05em 0.3em; }
    kbd { border: 1px solid ${v("--border")}; }
    pre { padding: 0.6rem 0.8rem; overflow: auto; }
    pre code { padding: 0; background: none; }
    blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid ${v("--border")}; color: ${v("--muted")}; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid ${v("--border")}; padding: 0.25rem 0.6rem; }
    ul, ol { padding-left: 1.4rem; }
    li:has(> input[type=checkbox]), li:has(> p > input[type=checkbox]) { list-style: none; }
    li > input[type=checkbox], li > p > input[type=checkbox] { margin: 0 0.45em 0 -1.35em; }
    img { max-width: 100%; }
    .footnotes { font-size: 0.9em; color: ${v("--muted")}; border-top: 1px solid ${v("--border")}; margin-top: 1rem; }
    [data-edit] { cursor: pointer; border-radius: 0.2rem; }
    [data-edit]:hover, [data-edit]:focus-visible { outline: 2px dashed ${v("--accent")}; outline-offset: 2px; }
    [data-edit].just-edited { background: ${v("--ins-bg")}; }
  `;
}

/** Elements outside the footnotes section. @param {Document} d @param {string} selector */
const outsideFootnotes = (d, selector) =>
  /** @type {HTMLElement[]} */ ([...d.querySelectorAll(selector)]).filter((el) => !el.closest("section.footnotes"));

/**
 * Starts the demo. `onProgram` gets the input, parser, and edits so far
 * each time they change.
 *
 * @param {(program: import("./editcode.js").Program) => void} [onProgram]
 */
export function initDemo(onProgram = () => {}) {
  const input = /** @type {HTMLTextAreaElement} */ ($("md-input"));
  const gfmOption = /** @type {HTMLInputElement} */ ($("opt-gfm"));
  const trustedOption = /** @type {HTMLInputElement} */ ($("opt-trusted"));
  const preview = /** @type {HTMLIFrameElement} */ ($("preview"));
  const editor = /** @type {HTMLFormElement} */ ($("editor"));
  const editValue = /** @type {HTMLInputElement} */ ($("edit-value"));
  const resetButton = /** @type {HTMLButtonElement} */ ($("reset"));

  input.value = SAMPLE;
  /** The document as parsed from the input, and as edited since. */
  let parsed = parserFor({ input: SAMPLE, gfm: true, steps: [] }).parse(SAMPLE);
  let current = parsed;
  /** The edits since the input was parsed, in order. */
  /** @type {import("./editcode.js").Step[]} */
  let steps = [];
  /** @type {Parts} */
  let parts = partsOf(current);
  /** What the editor form changes: a function from its value to a step. */
  /** @type {((value: string) => import("./editcode.js").Step) | null} */
  let pending = null;
  /** Which element to focus and mark once the preview reloads. */
  /** @type {{ kind: string, index: string } | null} */
  let refocus = null;

  const parser = () => parserFor({ input: input.value, gfm: gfmOption.checked, steps: [] });
  const renderer = () => (trustedOption.checked ? new MarkdownRenderer().withRawHtmlTrusted() : new MarkdownRenderer());

  function parseInput() {
    parsed = parser().parse(input.value);
    current = parsed;
    steps = [];
    closeEditor();
    const exact = parsed.asWritten === input.value;
    $("roundtrip").innerHTML = exact
      ? `<span class="ok" aria-hidden="true">✓</span> Parsed and printed back exactly: ${count(bytes(input.value), "byte")}.`
      : `<span class="bad" aria-hidden="true">✗</span> Printed back differently. That's a bug; please report it.`;
    show();
  }

  function show() {
    parts = partsOf(current);
    const html = renderer().render(current);
    $("html-out").textContent = html;
    $("render-note").textContent = trustedOption.checked
      ? "Raw HTML is trusted here, so it renders; the preview is sandboxed, so scripts don't run."
      : "Raw HTML is escaped, as it is by default.";
    preview.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${previewCss()}</style></head><body>${html}</body></html>`;
    const diff = diffView(input.value, current.asWritten);
    $("diff").innerHTML = diff.html;
    resetButton.disabled = steps.length === 0;
    onProgram({ input: input.value, gfm: gfmOption.checked, steps: [...steps] });
    const total = bytes(input.value);
    $("diff-summary").innerHTML =
      steps.length === 0
        ? `No edits yet, so the output is your input, all ${count(total, "byte")}.`
        : `<span class="ok" aria-hidden="true">✓</span> ${count(steps.length, "edit")} changed ${count(diff.changedLines, "line")}. ` +
          `The other ${count(diff.kept, "byte")} of your ${total.toLocaleString("en")} are exactly as you wrote them.`;
  }

  // Wires up the preview's editable parts once it loads: each heading,
  // table cell, task box, and link that matches a part of the document.
  preview.addEventListener("load", () => {
    const d = preview.contentDocument;
    if (!d) return;
    const editable = (/** @type {HTMLElement} */ el, /** @type {string} */ kind, /** @type {number} */ index, /** @type {string} */ name) => {
      el.dataset.edit = kind;
      el.dataset.index = String(index);
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${name}: edit`);
      el.title = `Edit this ${name.toLowerCase()}`;
    };
    /** @type {string[]} */
    const skipped = [];
    const headings = outsideFootnotes(d, "h1, h2, h3, h4, h5, h6");
    if (headings.length === parts.headings.length) {
      headings.forEach((el, i) => editable(el, "heading", i, `Heading “${el.textContent}”`));
    } else if (headings.length) skipped.push("headings");
    const tables = /** @type {HTMLTableElement[]} */ (outsideFootnotes(d, "table"));
    if (tables.length === parts.tables.length) {
      tables.forEach((table, t) => {
        const rows = [parts.tables[t].node.header, ...parts.tables[t].node.rows];
        [...table.rows].forEach((tr, r) => {
          [...tr.cells].forEach((td, c) => {
            if (r < rows.length && c < rows[r].cells.length) {
              editable(td, "cell", 0, `Table cell “${td.textContent}”`);
              td.dataset.index = `${t},${r},${c}`;
            }
          });
        });
      });
    } else if (tables.length) skipped.push("tables");
    const boxes = /** @type {HTMLInputElement[]} */ (outsideFootnotes(d, "input[type=checkbox]"));
    if (boxes.length === parts.tasks.length) {
      boxes.forEach((box, i) => {
        // Rendered disabled, as GitHub does; here, a click toggles it in
        // the Markdown instead.
        box.disabled = false;
        editable(box, "task", i, parts.tasks[i].node.checked ? "Checked task" : "Unchecked task");
      });
    } else if (boxes.length) skipped.push("task boxes");
    const anchors = outsideFootnotes(d, "a");
    if (anchors.length === parts.anchors.length) {
      anchors.forEach((a, i) => {
        if (parts.anchors[i].node instanceof Link) editable(a, "link", i, `Link “${a.textContent}”`);
      });
    } else if (anchors.length) skipped.push("links");
    $("editor-hint").textContent = skipped.length
      ? `Raw HTML adds ${skipped.join(" and ")} here that aren't Markdown, so those can't be edited in the preview.`
      : "Click a heading, table cell, task box, or link in the preview, or tab to one and press Enter.";

    d.addEventListener("click", (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      // Nothing in the preview navigates.
      if (target.closest("a")) event.preventDefault();
      const el = /** @type {HTMLElement | null} */ (target.closest("[data-edit]"));
      if (!el) return;
      event.preventDefault();
      startEdit(el);
    });
    d.addEventListener("keydown", (event) => {
      const el = /** @type {HTMLElement} */ (event.target);
      if (!el.dataset?.edit || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      startEdit(el);
    });

    if (refocus) {
      const { kind, index } = refocus;
      const el = /** @type {HTMLElement | null} */ (d.querySelector(`[data-edit="${kind}"][data-index="${index}"]`));
      if (el) {
        el.classList.add("just-edited");
        el.focus({ preventScroll: false });
      }
      refocus = null;
    }
  });

  /** @param {HTMLElement} el */
  function startEdit(el) {
    const kind = /** @type {string} */ (el.dataset.edit);
    const index = /** @type {string} */ (el.dataset.index);
    if (kind === "task") {
      const { node: task, path } = parts.tasks[Number(index)];
      apply({ kind: "task", path, value: !task.checked }, { kind, index });
      return;
    }
    if (kind === "heading") {
      const { node: heading, path } = parts.headings[Number(index)];
      openEditor("Heading text", heading.text, "heading.withText(text)", (value) => ({ kind: "heading", path, value }), el);
    } else if (kind === "cell") {
      const [t, r, c] = index.split(",").map(Number);
      const { node: table, path } = parts.tables[t];
      const cell = (r === 0 ? table.header : table.rows[r - 1]).cells[c];
      /** @type {PathPart[]} */
      const cellPath = [...path, r === 0 ? ["header"] : ["rows", r - 1], ["cells", c]];
      openEditor("Cell text", cell.text, "cell.withText(text)", (value) => ({ kind: "cell", path: cellPath, value }), el);
    } else if (kind === "link") {
      const { node: link, path } = parts.anchors[Number(index)];
      if (link.style === "inline") {
        openEditor(
          "Link destination",
          link.destination?.url ?? "",
          "link.withDestination(new LinkTarget(url))",
          (value) => ({ kind: "link", path, value }),
          el,
        );
      } else {
        // A reference link's destination is its definition's.
        const label = normalizeLabel(link.label ?? "");
        const definitions = current.linkReferenceDefinitions;
        const d = definitions.findIndex((/** @type {any} */ def) => normalizeLabel(def.label) === label);
        if (d < 0) return;
        openEditor(
          `Destination of [${definitions[d].label}], in its definition`,
          definitions[d].destination.url,
          "definition.withDestination(new LinkTarget(url))",
          (value) => ({ kind: "definition", path: [["linkReferenceDefinitions", d]], value }),
          el,
        );
      }
    }
  }

  /** @type {{ kind: string, index: string } | null} */
  let editing = null;

  /**
   * @param {string} label
   * @param {string} value
   * @param {string} call
   * @param {(value: string) => import("./editcode.js").Step} edit
   * @param {HTMLElement} el
   */
  function openEditor(label, value, call, edit, el) {
    pending = edit;
    editing = { kind: /** @type {string} */ (el.dataset.edit), index: /** @type {string} */ (el.dataset.index) };
    $("edit-label").textContent = label;
    $("edit-call").innerHTML = `Calls <code>${escapeHtml(call)}</code>, which gives a new document.`;
    editValue.value = value;
    editValue.removeAttribute("aria-invalid");
    editor.hidden = false;
    $("editor-hint").hidden = true;
    editValue.focus();
    editValue.select();
  }

  function closeEditor() {
    pending = null;
    editing = null;
    editor.hidden = true;
    $("editor-hint").hidden = false;
  }

  /**
   * Makes an edit, then shows the new document.
   *
   * @param {import("./editcode.js").Step} step
   * @param {{ kind: string, index: string }} at
   */
  function apply(step, at) {
    try {
      current = applyStep(current, step);
    } catch {
      $("edit-call").textContent = "kelpto-md refused that value here, such as a line break in a destination.";
      editValue.setAttribute("aria-invalid", "true");
      return false;
    }
    steps.push(step);
    refocus = at;
    show();
    return true;
  }

  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pending || !editing) return;
    const edit = pending;
    const value = editValue.value;
    const at = editing;
    if (apply(edit(value), at)) closeEditor();
  });
  $("edit-cancel").addEventListener("click", closeEditor);
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeEditor();
  });
  resetButton.addEventListener("click", () => {
    current = parsed;
    steps = [];
    closeEditor();
    show();
  });

  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(parseInput, 150);
  });
  gfmOption.addEventListener("change", parseInput);
  trustedOption.addEventListener("change", show);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", show);

  // Preview and HTML views.
  const views = [$("view-preview"), $("view-html")];
  const select = (/** @type {number} */ i) => {
    views.forEach((tab, j) => {
      tab.setAttribute("aria-selected", String(i === j));
      tab.tabIndex = i === j ? 0 : -1;
    });
    $("preview-panel").hidden = i !== 0;
    $("html-panel").hidden = i !== 1;
  };
  views.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const next = 1 - i;
        select(next);
        views[next].focus();
      }
    });
  });

  parseInput();
}
