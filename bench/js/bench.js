// Times Markdown parsers in JavaScript, for scripts/bench.py.
//
//     node --expose-gc bench.js time PLAN
//     node bench.js mem LIBRARY TASK FILE
//
// See ../README.md for the plan format and what each task does.

import { readFileSync } from "node:fs";
import * as commonmark from "commonmark";
import MarkdownIt from "markdown-it";
import { Heading, MarkdownParser, MarkdownRenderer } from "kelpto-md";

function kelptoTasks() {
  const parser = MarkdownParser.commonMark;
  const renderer = new MarkdownRenderer().withRawHtmlTrusted();
  return {
    parse: (text) => parser.parse(text).span.end,
    render: (text) => renderer.render(parser.parse(text)).length,
    walk: (text) => {
      const doc = parser.parse(text);
      const views = doc.descendants;
      let headings = 0;
      for (const view of views) {
        if (view instanceof Heading) headings += 1;
      }
      return views.length + headings + doc.asWritten.length;
    },
    transform: (text) => {
      const doc = parser.parse(text);
      const editor = doc.editor();
      for (const heading of doc.headings) {
        const level = heading.level;
        if (level < 6 && !(level === 2 && heading.style === "setext")) {
          editor.setLevel(heading, level + 1);
        }
      }
      return editor.toDocument().asWritten.length;
    },
  };
}

function commonmarkTasks() {
  const reader = new commonmark.Parser();
  const writer = new commonmark.HtmlRenderer();
  return {
    parse: (text) => (reader.parse(text).firstChild ? 1 : 0),
    render: (text) => writer.render(reader.parse(text)).length,
  };
}

function markdownItTasks() {
  const md = new MarkdownIt("commonmark");
  return {
    parse: (text) => md.parse(text, {}).length,
    render: (text) => md.render(text).length,
  };
}

const libraries = {
  kelpto: kelptoTasks,
  "commonmark.js": commonmarkTasks,
  "markdown-it": markdownItTasks,
  none: () => ({ read: (text) => text.length }),
};

const read = (path) => readFileSync(path, "utf8");

function measure(op, text, warmupMs, sampleMs, samples, budgetMs) {
  let count = 0;
  let check;
  let elapsed;
  const start = performance.now();
  for (;;) {
    check = op(text);
    count += 1;
    elapsed = performance.now() - start;
    if (elapsed >= warmupMs && count >= 2) break;
  }
  const perOp = elapsed / count;
  const inner = Math.max(1, Math.round(sampleMs / perOp));
  samples = Math.max(3, Math.min(samples, Math.floor(budgetMs / (perOp * inner))));
  const times = [];
  for (let i = 0; i < samples; i += 1) {
    globalThis.gc?.();
    const begin = performance.now();
    for (let j = 0; j < inner; j += 1) op(text);
    times.push((performance.now() - begin) / 1000 / inner);
  }
  return { times, inner, check };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "mem") {
  const [library, task, path] = args;
  console.log(libraries[library]()[task](read(path)));
} else {
  const lines = read(args[0]).split("\n").filter((line) => line);
  const [warmupMs, sampleMs, samples, budgetMs] = lines[0].split(" ").map(Number);
  const made = new Map();
  for (const line of lines.slice(1)) {
    const [library, task, path] = line.split("\t");
    if (!made.has(library)) made.set(library, libraries[library]());
    const { times, inner, check } = measure(made.get(library)[task], read(path), warmupMs, sampleMs, samples, budgetMs);
    const shown = times.map((t) => t.toPrecision(9)).join(" ");
    process.stdout.write(`${library}\t${task}\t${path}\t${inner}\t${check}\t${shown}\n`);
  }
}
