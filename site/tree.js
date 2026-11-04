// The tree a browser builds, as the page shows it: each node a row, with
// where it came from (raw HTML, a Markdown node, or implied by the HTML
// standard), and the source it came from highlighted on hover or focus.
// The HTML side (kelpto-html, and kelpto for Markdown) loads after the
// page's first render, so the Markdown demo doesn't wait for it.

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** @type {Promise<{ html: any, kelpto: any }> | null} */
let loading = null;

/** kelpto-html and kelpto, loaded once. */
export function loadHtmlSide() {
  loading ??= Promise.all([import("kelpto-html"), import("kelpto")]).then(([html, kelpto]) => ({ html, kelpto }));
  return loading;
}

/** At most this many rows, so a huge paste stays quick. */
const MAX_ROWS = 1500;

/**
 * A Markdown kind's name as words: `TableCell` as "table cell".
 *
 * @param {string} name
 */
const words = (name) => name.replace(/(?<=[a-z])(?=[A-Z])/g, " ").toLowerCase();

/** A text node's text, short, with line breaks and tabs shown. @param {string} text */
function shortText(text) {
  const chars = Array.from(text);
  const cut = chars.length > 48 ? `${chars.slice(0, 45).join("")}…` : text;
  return JSON.stringify(cut).slice(1, -1).replace(/\\"/g, '"');
}

/**
 * @typedef {{ from: number, to: number }} Span
 * @typedef {{ label: string, where: string, span: Span | null, removed?: string }} Row
 * @typedef {Map<string, any[]>} Removed
 */

// What sanitizing removed (kelpto-html's `SafeHtml.removals`), matched to
// the built nodes it came from by origin: the origin's kind and span, and
// the element's name, since one Markdown node can make more than one
// element. Elements the parser reopened share their start tag, and so
// what was removed from it.

/** @param {any} origin @param {string} element */
const removalKey = (origin, element) => `${origin.green.kind.id}:${origin.span.start}+${origin.span.length}:${element}`;

/** A built node's name as policies name it, or "" if not an element. @param {any} node @param {any} Element */
const elementKey = (node, Element) =>
  node instanceof Element ? (node.namespace === "html" ? node.name : `${node.namespace}:${node.name}`) : "";

/**
 * Removals by the node they came from; those without an origin are left
 * out.
 *
 * @param {any[]} removals
 * @returns {Removed}
 */
export function removedByNode(removals) {
  /** @type {Removed} */
  const by = new Map();
  for (const r of removals) {
    if (!r.origin) continue;
    const key = removalKey(r.origin, r.element);
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  return by;
}

/** What was removed from a node. @param {Removed | null} removed @param {any} node @param {any} Element */
const removedFrom = (removed, node, Element) =>
  removed && node.origin ? removed.get(removalKey(node.origin, elementKey(node, Element))) ?? [] : [];

/** A removal's group, for the summary, in the order they're listed. */
const GROUPS = ["element", "tag", "attribute", "style", "link", "URL", "comment", "DOCTYPE", "processing instruction"];

/** @param {any} r */
function groupOf(r) {
  if (r.kind === "attribute") return r.name === "style" ? "style" : "attribute";
  if (r.kind === "url") return r.name === "href" || r.name === "xlink:href" ? "link" : "URL";
  if (r.kind === "doctype") return "DOCTYPE";
  return r.kind;
}

/** Why a removal went, in a line, for its tooltip and the Tree view's note. @param {any} r */
function reason(r) {
  if (r.kind === "element") return `Removed: <${r.name}> isn't allowed, nor what's in it.`;
  if (r.kind === "tag") return `Removed: <${r.name}> isn't allowed; what's in it stays.`;
  if (r.kind === "url") {
    return /^\s*javascript:/i.test(r.value)
      ? `Removed: a javascript: ${r.name} runs code when followed. Trust keeps it; the preview can't run it, but your page would.`
      : `Removed: ${r.name}'s URL isn't an allowed one (http, https, mailto, or relative).`;
  }
  if (r.name === "style") return "Removed: style is dropped, since CSS can overlay or disguise the page, and Kelpto doesn't check CSS yet.";
  if (/^on/i.test(r.name)) {
    return `Removed: ${r.name} is a script. Trust keeps it; the preview is sandboxed so it can't run here, but on your page it would.`;
  }
  if (r.kind === "attribute") return `Removed: ${r.name} isn't allowed on <${r.element}>.`;
  return `Removed: no ${groupOf(r)}s are kept.`;
}

/**
 * What was removed, in words: "1 attribute, 1 style, and 1 link".
 *
 * @param {any[]} removals
 */
export function removalSummary(removals) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of removals) counts.set(groupOf(r), (counts.get(groupOf(r)) ?? 0) + 1);
  const parts = GROUPS.filter((g) => counts.has(g)).map((g) => {
    const n = /** @type {number} */ (counts.get(g));
    return `${n.toLocaleString("en")} ${n === 1 ? g : `${g}s`}`;
  });
  if (parts.length < 3) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const VOIDS = new Set("area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr".split(" "));
const RAW_TEXT = new Set("style script xmp iframe noembed noframes plaintext noscript".split(" "));

/** @param {string} s @param {boolean} attribute */
const serialized = (s, attribute) =>
  s.replace(attribute ? /[&\u00A0"]/g : /[&\u00A0<>]/g, (c) => ({ "&": "&amp;", "\u00A0": "&nbsp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

/**
 * The built nodes serialized as the standard writes them, with what
 * sanitizing removed struck through: as HTML to show, and the text left
 * once what's struck goes, which is the sanitized output when nothing
 * else changed (the caller checks).
 *
 * @param {any[]} nodes
 * @param {{ html: any }} side
 * @param {Removed} removed
 */
export function markedHtml(nodes, side, removed) {
  const { Element, BuiltText } = side.html;
  let shown = "";
  let kept = "";
  const both = (/** @type {string} */ s) => {
    shown += escapeHtml(s);
    kept += s;
  };
  const gone = (/** @type {string} */ s, /** @type {string} */ why) => {
    shown += `<del class="removed" title="${escapeHtml(why)}">${escapeHtml(s)}</del>`;
  };
  /** @param {any[]} list @param {boolean} raw */
  function walk(list, raw) {
    for (const node of list) {
      const from = removedFrom(removed, node, Element);
      if (node instanceof BuiltText) {
        both(raw ? node.text : serialized(node.text, false));
      } else if (!(node instanceof Element)) {
        gone(node.html, from[0] ? reason(from[0]) : "Removed.");
      } else if (from.some((r) => r.kind === "element")) {
        gone(node.html, reason(/** @type {any} */ (from.find((r) => r.kind === "element"))));
      } else {
        const tag = from.find((r) => r.kind === "tag");
        const write = tag ? (/** @type {string} */ s) => gone(s, reason(tag)) : both;
        write(`<${node.name}`);
        for (const a of node.attributes) {
          const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
          const qualified = a.prefix === "xmlns" && a.name === "xmlns" ? "xmlns" : name;
          const text = ` ${qualified}="${serialized(a.value, true)}"`;
          const r = from.find((r) => (r.kind === "attribute" || r.kind === "url") && r.name === name);
          if (r || tag) gone(text, reason(r ?? tag));
          else both(text);
        }
        write(">");
        if (node.namespace === "html" && VOIDS.has(node.name)) continue;
        const contents = node.templateContents;
        walk(contents.length ? contents : node.children, node.namespace === "html" && RAW_TEXT.has(node.name));
        write(`</${node.name}>`);
      }
    }
  }
  walk(nodes, false);
  return { html: shown, kept };
}

/**
 * The built nodes as rows of HTML, and what each row came from. With
 * `markdown`, each node's origin is named: a Markdown node, raw HTML, or
 * implied; without, only implied and reopened elements are.
 *
 * @param {any[]} nodes
 * @param {{ html: any, kelpto: any }} side
 * @param {boolean} markdown
 * @param {Removed | null} [removed] what sanitizing removed, struck through
 * @returns {{ html: string, rows: Row[], more: number }}
 */
export function treeHtml(nodes, side, markdown, removed = null) {
  const { Element, BuiltText, BuiltComment, BuiltDoctype, BuiltProcessingInstruction } = side.html;
  /** @type {Row[]} */
  const rows = [];
  /** Start tags seen, by span, to mark elements the parser reopened. */
  const seen = new Set();
  let more = 0;

  /** @param {any} node @returns {{ badge: string, cls: string, where: string, span: Span | null }} */
  function originOf(node) {
    const origin = node.origin;
    if (!origin) return { badge: "implied", cls: "implied", where: "Implied by the HTML standard: nothing in the source.", span: null };
    const span = { from: origin.span.start, to: origin.span.start + origin.span.length };
    const id = origin.green.kind.id;
    // kelpto-html's kinds take ids 200 to 299.
    if (id >= 200 && id < 300) {
      if (node instanceof Element) {
        const key = `${span.from}+${span.to}`;
        if (seen.has(key)) return { badge: "reopened", cls: "reopened", where: "Reopened by the parser, from the start tag:", span };
        seen.add(key);
      }
      return markdown ? { badge: "raw HTML", cls: "raw", where: "From raw HTML:", span } : { badge: "", cls: "", where: "From:", span };
    }
    const name = words(origin.kind.name);
    return { badge: `Markdown ${name}`, cls: "md", where: `From Markdown's ${name}:`, span };
  }

  /** @param {any} node @param {any[]} from what was removed from it */
  function label(node, from) {
    if (node instanceof Element) {
      const space = node.namespace === "html" ? "" : `${node.namespace} `;
      const attributes = node.attributes
        .map((/** @type {any} */ a) => {
          const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
          const text = `<span class="t-attr">${escapeHtml(name)}</span>=<span class="t-value">"${escapeHtml(shortText(a.value))}"</span>`;
          const r = from.find((r) => (r.kind === "attribute" || r.kind === "url") && r.name === name);
          return r ? ` <del class="removed" title="${escapeHtml(reason(r))}">${text}</del>` : ` ${text}`;
        })
        .join("");
      return `<span class="t-tag">&lt;${escapeHtml(space + node.name)}</span>${attributes}<span class="t-tag">&gt;</span>`;
    }
    if (node instanceof BuiltText) {
      const space = /^\s*$/.test(node.text) ? " space" : "";
      return `<span class="t-text${space}">"${escapeHtml(shortText(node.text))}"</span>`;
    }
    if (node instanceof BuiltComment) return `<span class="t-comment">&lt;!--${escapeHtml(shortText(node.text))}--&gt;</span>`;
    if (node instanceof BuiltDoctype) return `<span class="t-tag">&lt;!DOCTYPE ${escapeHtml(node.name)}&gt;</span>`;
    if (node instanceof BuiltProcessingInstruction) return `<span class="t-tag">&lt;?${escapeHtml(node.target)} ${escapeHtml(shortText(node.data))}?&gt;</span>`;
    return "?";
  }

  /** @param {any[]} list */
  function walk(list) {
    let out = "";
    for (const node of list) {
      if (rows.length >= MAX_ROWS) {
        more += 1;
        continue;
      }
      const origin = originOf(node);
      const index = rows.length;
      const from = removedFrom(removed, node, Element);
      const text = label(node, from);
      // What sanitizing removed here: the whole node, its tags, or attributes.
      const whole = from.find((r) => r.kind !== "tag" && r.kind !== "attribute" && r.kind !== "url");
      const tag = from.find((r) => r.kind === "tag");
      const names = from.filter((r) => r.kind === "attribute" || r.kind === "url").map((r) => r.name);
      const gone = whole ?? tag;
      const shown = gone ? `<del class="removed" title="${escapeHtml(reason(gone))}">${text}</del>` : text;
      const why = gone
        ? reason(gone)
        : from.filter((r) => r.kind === "attribute" || r.kind === "url").map(reason).join(" ");
      rows.push({ label: text, where: origin.where, span: origin.span, removed: why });
      // Text and comments name their origin only on hover, to keep the tree quiet.
      const badged = origin.badge && (node instanceof Element || origin.cls === "implied");
      let badge = badged ? ` <span class="badge ${origin.cls}">${escapeHtml(origin.badge)}</span>` : "";
      if (whole) badge += ' <span class="badge removed">removed</span>';
      else if (tag) badge += ' <span class="badge removed">tag removed</span>';
      else if (names.length) badge += ` <span class="badge removed">removed: ${escapeHtml(names.join(", "))}</span>`;
      let inner = "";
      if (node instanceof Element) {
        const contents = node.templateContents;
        if (contents.length) inner += `<li class="t-content">content</li>${walk(contents)}`;
        inner += walk(node.children);
      }
      out += `<li${whole ? ' class="gone"' : ""}><span class="row" data-row="${index}" tabindex="${index === 0 ? 0 : -1}">${shown}${badge}</span>` +
        (inner ? `<ul>${inner}</ul>` : "") + "</li>";
    }
    return out;
  }

  const html = walk(nodes);
  return { html: html ? `<ul class="tree-root">${html}</ul>` : "", rows, more };
}

/**
 * Code point offsets into `text` as UTF-16 offsets, as the page's strings
 * count.
 *
 * @param {string} text
 * @param {Span} span
 */
export function utf16Span(text, span) {
  if (!/[\uD800-\uDFFF]/.test(text)) return span;
  let units = 0;
  let points = 0;
  let from = -1;
  for (const ch of text) {
    if (points === span.from) from = units;
    if (points === span.to) return { from, to: units };
    units += ch.length;
    points += 1;
  }
  return { from: from < 0 ? units : from, to: units };
}

/**
 * Highlights a span of a textarea's text, behind it: the textarea's
 * background is clear, and a copy of its text, with the span marked,
 * scrolls with it.
 *
 * @param {HTMLTextAreaElement} textarea
 */
export function highlighter(textarea) {
  const back = /** @type {HTMLElement} */ (textarea.previousElementSibling);
  const sync = () => {
    back.scrollTop = textarea.scrollTop;
    back.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener("scroll", sync);
  textarea.addEventListener("input", () => {
    back.textContent = "";
  });
  return {
    /** @param {Span} span @param {boolean} reveal */
    show(span, reveal) {
      const text = textarea.value;
      const { from, to } = utf16Span(text, span);
      back.innerHTML =
        escapeHtml(text.slice(0, from)) + `<mark>${escapeHtml(text.slice(from, to)) || " "}</mark>` + escapeHtml(text.slice(to)) + "\n";
      if (reveal) {
        const mark = /** @type {HTMLElement} */ (back.querySelector("mark"));
        const top = mark.offsetTop;
        if (top < textarea.scrollTop || top + mark.offsetHeight > textarea.scrollTop + textarea.clientHeight) {
          textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 3);
        }
        const left = mark.offsetLeft;
        if (left < textarea.scrollLeft || left > textarea.scrollLeft + textarea.clientWidth - 40) {
          textarea.scrollLeft = Math.max(0, left - 40);
        }
      }
      sync();
    },
    clear() {
      back.textContent = "";
    },
  };
}

/**
 * Shows rows in `container`, and where each came from in `note` on hover
 * or focus, calling `onSpan` with its span (or null). Arrow keys move
 * between rows.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} note
 * @param {(span: Span | null, reveal: boolean) => void} onSpan
 * @param {(span: Span) => string} excerpt
 */
export function treeView(container, note, onSpan, excerpt) {
  /** @type {Row[]} */
  let rows = [];
  const idle = note.textContent ?? "";
  /** @param {Element | null} el @param {boolean} reveal */
  const point = (el, reveal) => {
    const row = /** @type {HTMLElement | null} */ (el?.closest(".row") ?? null);
    for (const on of container.querySelectorAll(".row.on")) on.classList.remove("on");
    if (!row) {
      note.textContent = idle;
      onSpan(null, false);
      return;
    }
    row.classList.add("on");
    const { where, span, removed } = rows[Number(row.dataset.row)];
    note.innerHTML = (span ? `${escapeHtml(where)} <code>${escapeHtml(excerpt(span))}</code>` : escapeHtml(where)) +
      (removed ? ` <span class="removed-note">${escapeHtml(removed)}</span>` : "");
    onSpan(span, reveal);
  };
  container.addEventListener("mouseover", (event) => point(/** @type {Element} */ (event.target), false));
  container.addEventListener("mouseleave", () => {
    if (!container.contains(document.activeElement)) point(null, false);
  });
  container.addEventListener("focusin", (event) => point(/** @type {Element} */ (event.target), true));
  container.addEventListener("focusout", (event) => {
    if (!container.contains(/** @type {Node | null} */ (event.relatedTarget))) point(null, false);
  });
  container.addEventListener("keydown", (event) => {
    const all = /** @type {HTMLElement[]} */ ([...container.querySelectorAll(".row")]);
    const at = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
    if (next === undefined || at < 0 || !all[next]) return;
    event.preventDefault();
    all[at].tabIndex = -1;
    all[next].tabIndex = 0;
    all[next].focus();
  });
  return {
    /** @param {{ html: string, rows: Row[], more: number }} tree @param {string} empty */
    show(tree, empty) {
      rows = tree.rows;
      container.innerHTML =
        (tree.html || `<p class="small-note">${escapeHtml(empty)}</p>`) +
        (tree.more ? `<p class="small-note">and ${tree.more.toLocaleString("en")} more nodes.</p>` : "");
      note.textContent = idle;
    },
  };
}
