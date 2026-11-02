"""Times Markdown parsers in Python, for scripts/bench.py.

    uv run --group bench bench/py/bench.py time PLAN
    uv run --group bench bench/py/bench.py mem LIBRARY TASK FILE

See bench/README.md for the plan format and what each task does.
"""

import gc
import sys
import time

import markdown_it
import mistune
from kelpto_md import Heading, MarkdownParser, MarkdownRenderer


def kelpto_tasks():
    parser = MarkdownParser.common_mark
    renderer = MarkdownRenderer().with_raw_html_trusted()

    def parse(text):
        return parser.parse(text).span.end

    def render(text):
        return len(renderer.render(parser.parse(text)))

    def walk(text):
        doc = parser.parse(text)
        headings = 0
        views = doc.descendants
        for view in views:
            if isinstance(view, Heading):
                headings += 1
        return len(views) + headings + len(doc.as_written)

    def transform(text):
        doc = parser.parse(text)
        editor = doc.editor()
        for heading in doc.headings:
            level = heading.level
            if level < 6 and not (level == 2 and heading.style == "setext"):
                editor.set_level(heading, level + 1)
        return len(editor.to_document().as_written)

    return {"parse": parse, "render": render, "walk": walk, "transform": transform}


def markdown_it_tasks():
    md = markdown_it.MarkdownIt("commonmark")
    return {
        "parse": lambda text: len(md.parse(text)),
        "render": lambda text: len(md.render(text)),
    }


def mistune_tasks():
    # No plugins: mistune's closest to CommonMark. escape=False passes raw
    # HTML through, as the others here do.
    ast = mistune.create_markdown(renderer=None)
    html = mistune.create_markdown(escape=False)
    return {
        "parse": lambda text: len(ast(text)),
        "render": lambda text: len(html(text)),
    }


LIBRARIES = {
    "kelpto": kelpto_tasks,
    "markdown-it-py": markdown_it_tasks,
    "mistune": mistune_tasks,
    "none": lambda: {"read": len},
}


def read(path):
    with open(path, encoding="utf-8", newline="") as file:
        return file.read()


def measure(op, text, warmup_ms, sample_ms, samples, budget_ms):
    """Per-op seconds for each sample, the ops per sample, and a checksum."""
    count = 0
    start = time.perf_counter()
    while True:
        check = op(text)
        count += 1
        elapsed = time.perf_counter() - start
        if elapsed * 1000 >= warmup_ms and count >= 2:
            break
    per_op = elapsed / count
    inner = max(1, round(sample_ms / 1000 / per_op))
    samples = max(3, min(samples, int(budget_ms / 1000 / (per_op * inner))))
    times = []
    for _ in range(samples):
        gc.collect()
        start = time.perf_counter()
        for _ in range(inner):
            op(text)
        times.append((time.perf_counter() - start) / inner)
    return times, inner, check


def main():
    mode = sys.argv[1]
    if mode == "mem":
        library, task, path = sys.argv[2:5]
        print(LIBRARIES[library]()[task](read(path)))
        return
    with open(sys.argv[2], encoding="utf-8") as plan:
        warmup_ms, sample_ms, samples, budget_ms = (int(x) for x in plan.readline().split())
        jobs = [line.split("\t") for line in plan.read().splitlines() if line]
    made = {}
    for library, task, path in jobs:
        if library not in made:
            made[library] = LIBRARIES[library]()
        times, inner, check = measure(made[library][task], read(path), warmup_ms, sample_ms, samples, budget_ms)
        print(library, task, path, inner, check, " ".join(f"{t:.9g}" for t in times), sep="\t", flush=True)


if __name__ == "__main__":
    main()
