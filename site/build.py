# /// script
# requires-python = ">=3.11"
# ///
"""Builds Kelpto's site into `site/build/`.

    temper build -b js
    uv run site/build.py
    python3 -m http.server --bind 127.0.0.1 -d site/build

Copies Temper's JS output for Kelpto's libraries, with Temper's JS
runtime, as plain ES modules, which the page's import map names, so the
page parses, edits, and renders live with the same libraries as every
other language. No bundler, so nothing to install; the cost is size (see
`sizes.json`).

Runs CommonMark's and GFM's examples (`tests/*/spec.json`) in Node
through the built library (`conformance-node.mjs`), and fails unless
every one passes; the counts go in the page. The examples themselves
aren't copied, as they're CC-BY-SA 4.0.

Runs html5lib-tests' tokenizer tests and web-platform-tests' tree
construction tests the same way (`html-conformance-node.mjs`), from
their test libraries' JS builds, and fails unless every tokenizer test
passes and at least as many tree tests as their runner checks for, with
none failing but the known `<selectedcontent>` ones; the counts go in
the page.

Renders the #safe gallery, `safeGallery()` in `kelpto/kelpto.temper.md`,
in Node (`safe-node.mjs`), failing unless each case gives what the
library's tests expect and parses back to itself; the page shows what
this build gives. Runs the JavaScript view function example
(`view/view.js`) too (`view-node.mjs`).

Runs the JavaScript tour in Node as the page's "Run in your browser"
does (`tour-node.mjs` and `tourrun.js`), against the built `lib/`,
failing unless it prints `demos/tour/expected.txt`. The tours go in
`tour/`.

Checks the demo's code panel (`editcode.js`) on the samples in
`golden/samples.json` (`editcode-node.mjs`): the JavaScript it writes
must print what the page's own edits give, the other languages' code must
match `golden/`, and, once `temper build -b py` has run, the Python code
runs too and must print the same. `--update-golden` rewrites `golden/`.
"""

import argparse
import difflib
import gzip
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "build"
JS = ROOT / "temper.out" / "js"
TOUR = ROOT / "demos" / "tour"
TESTS = ROOT / "tests"
GOLDEN = SITE / "golden"
# The HTML tests, from their test libraries' JS builds.
TOKENIZER_TESTS = JS / "kelpto-html5lib-tokenizer-tests" / "index.js"
TREE_TESTS = JS / "kelpto-wpt-tree-construction-tests" / "index.js"
# Where the gallery's cases and the tree tests' floors are written.
KELPTO_MD = ROOT / "kelpto" / "kelpto.temper.md"
TREE_RUNNER = TESTS / "wpt-tree-construction" / "tree-tests.temper.md"
# Shown first in the gallery, by label; the rest fold away.
FEATURED = [
    "a tab, as a reference",
    "event handlers",
    "an unclosed comment swallows Markdown",
    "math mXSS",
    "foster parenting",
    "textarea breakout",
]

# Each language's file for the code panel's golden programs, by the key
# `editcode.js` uses. JavaScript's runs instead.
GOLDEN_FILES = {
    "cpp": "edits.cpp",
    "cs": "edits.cs",
    "java": "Edits.java",
    "lua": "edits.lua",
    "py": "edits.py",
    "rs": "edits.rs",
}

# Each tour's source, by the extension the page asks for.
TOURS = {
    "cpp": "cpp/tour.cpp",
    "cs": "csharp/Program.cs",
    "java": "java/src/main/java/Tour.java",
    "js": "js/tour.js",
    "lua": "lua/tour.lua",
    "py": "py/tour.py",
    "rs": "rust/src/main.rs",
}

# The libraries the page loads, by import map name and folder.
LIBRARIES = {
    "kelpto": "kelpto",
    "kelpto-html": "kelpto-html",
    "kelpto-md": "kelpto-md",
    "kelpto-core": "kelpto-core",
    "@temperlang/core": "temper-core",
}


def node(script, *args):
    """Runs one of the site's Node scripts on the built site."""
    try:
        run = subprocess.run(
            ["node", str(SITE / script), str(OUT), *args], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise SystemExit("The build needs Node (24 or later).")
    if run.returncode:
        raise SystemExit(f"{script} failed:\n{run.stderr}{run.stdout}")
    return run.stdout


def check_tour_run(expected):
    """Fails unless the built JS tour, run as the page runs it, prints
    what every tour prints."""
    out = node("tour-node.mjs")
    if out != expected:
        diff = difflib.unified_diff(expected.splitlines(keepends=True), out.splitlines(keepends=True), "expected.txt", "in the page")
        raise SystemExit(f"The JS tour, run as the page runs it, prints otherwise:\n{''.join(diff)}")


def check_edit_code(update):
    """Fails unless the code panel's programs print what the page's edits
    give: JavaScript's in Node, and Python's when it's built. The rest must
    match `golden/`, or are written there with `update`."""
    results = json.loads(node("editcode-node.mjs", str(GOLDEN / "samples.json")))
    stale = []
    for sample, result in results.items():
        for language, file in GOLDEN_FILES.items():
            path = GOLDEN / sample / file
            code = result["code"][language]
            if update:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(code, encoding="utf-8", newline="")
            elif not path.exists() or path.read_bytes().decode("utf-8") != code:
                stale.append(str(path.relative_to(ROOT)))
    if stale:
        raise SystemExit(
            "The code panel writes otherwise than golden/ for "
            + ", ".join(stale)
            + ". Check the new code, then run with --update-golden."
        )
    if not (ROOT / "temper.out" / "py" / "kelpto-md").exists():
        print("Python code panel check skipped: temper build -b py first")
        return len(results)
    project = ROOT / "demos" / "tour" / "py"
    for sample, result in results.items():
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "edits.py"
            script.write_text(result["code"]["py"], encoding="utf-8", newline="")
            run = subprocess.run(
                ["uv", "run", "-q", "--project", str(project), "python", str(script)],
                capture_output=True,
                env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
            )
        out = run.stdout.decode("utf-8", errors="replace")
        if run.returncode or out != result["output"]:
            raise SystemExit(
                f"{sample}: the Python code prints otherwise than the page's edits:\n"
                f"page: {result['output']!r}\ncode: {out!r}\n{run.stderr.decode('utf-8', errors='replace')}"
            )
    return len(results)


def conformance():
    """Each suite's passed and total, run in Node on the built library.
    Fails unless every example passes."""
    scores = json.loads(node("conformance-node.mjs", str(TESTS / "commonmark" / "spec.json"), str(TESTS / "gfm" / "spec.json")))
    for name, score in scores.items():
        if score["passed"] != score["total"]:
            raise SystemExit(f"{name}: {score['passed']} of {score['total']} examples pass; failing: {score['failing'][:20]}")
    return scores


def html_conformance():
    """The tokenizer's and tree construction's passed and total, run in
    Node on the built library, and the line the page says them in. Fails
    unless every tokenizer test passes, and the tree tests pass at least as
    their runner checks, with none failing but the known ones."""
    scores = json.loads(node("html-conformance-node.mjs", str(TOKENIZER_TESTS), str(TREE_TESTS)))
    tokenizer = scores["tokenizer"]
    if tokenizer["passed"] != tokenizer["total"]:
        raise SystemExit(f"tokenizer: {tokenizer['passed']} of {tokenizer['total']} pass; failing: {tokenizer['failing'][:20]}")
    runner = TREE_RUNNER.read_text(encoding="utf-8")
    for kind, floor in [("documents", "documentFloor"), ("fragments", "fragmentFloor")]:
        least = int(re.search(rf"let {floor}\(\): Int {{ (\d+) }}", runner)[1])
        score = scores[kind]
        if score["passed"] < least:
            raise SystemExit(f"tree {kind}: {score['passed']} pass, fewer than {least}; failing: {score['failing'][:20]}")
        # The only known failures: <selectedcontent> copying the selected
        # <option>, which kelpto-html doesn't do yet.
        unknown = [f for f in score["failing"] if "<selectedcontent>" not in f]
        if unknown:
            raise SystemExit(f"tree {kind}: newly failing: {unknown[:20]}")
    documents, fragments = scores["documents"], scores["fragments"]
    total = documents["total"] + fragments["total"]
    left = total - documents["passed"] - fragments["passed"]
    counted = lambda score, what: (
        f"all {score['total']:,} {what}" if score["passed"] == score["total"] else f"{score['passed']:,} of {score['total']:,} {what}"
    )
    parts = f"{counted(documents, 'documents')} and {counted(fragments, 'fragments')}, as <code>innerHTML</code> parses them"
    if left == 0:
        line = f"all <strong>{total:,}</strong> of web-platform-tests' tree construction tests: {parts}."
    else:
        line = (
            f"all but {left} of web-platform-tests' <strong>{total:,}</strong> tree construction tests: {parts}. "
            f"The {left} left expect <code>&lt;selectedcontent&gt;</code>, not in yet."
        )
    return scores, line


def gallery_cases():
    """The #safe gallery's cases, as `safeGallery()` lists them: a label,
    the Markdown, and the HTML its tests expect."""
    text = KELPTO_MD.read_text(encoding="utf-8")
    body = re.search(r"let safeGallery\(\): List<List<String>> \{\n\s*\[\n(.*?)\n\s*\]\n\s*\}", text, re.S)
    if not body:
        raise SystemExit(f"No safeGallery() in {KELPTO_MD.relative_to(ROOT)}")
    # Temper's string literals here read as JSON's.
    cases = json.loads("[" + body[1].strip().rstrip(",") + "]")
    if not cases or any(len(case) != 3 for case in cases):
        raise SystemExit("safeGallery() reads otherwise than label, Markdown, and HTML")
    return cases


def safe_gallery():
    """The gallery's cases, as this build renders them. Fails unless each
    gives what the library's tests expect and parses back to itself."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "gallery.json"
        path.write_text(json.dumps(gallery_cases()), encoding="utf-8")
        results = json.loads(node("safe-node.mjs", str(path)))
    wrong = [r for r in results if r["html"] != r["expected"] or not r["reparses"]]
    if wrong:
        raise SystemExit("The #safe gallery renders otherwise:\n" + "\n".join(f"{r['label']}: {r['html']!r}" for r in wrong))
    return results


def gallery_html(results):
    """The gallery as HTML for the page: the featured cases, then the rest
    behind a disclosure."""

    def case(result):
        esc = lambda s: html.escape(s, quote=True)
        shown = result["html"].removesuffix("\n")
        out = f"<code>{esc(shown)}</code>" if shown else '<code class="nothing">nothing</code>'
        return (
            '          <li class="case">\n'
            '            <div class="case-head">\n'
            f'              <p class="case-label">{esc(result["label"])}</p>\n'
            f'              <button type="button" class="plain try" data-markdown="{esc(result["markdown"])}">Try it</button>\n'
            "            </div>\n"
            f'            <pre class="case-in" aria-label="Markdown"><code>{esc(result["markdown"])}</code></pre>\n'
            f'            <pre class="case-out" aria-label="What Kelpto renders">{out}</pre>\n'
            "          </li>\n"
        )

    featured = [r for label in FEATURED for r in results if r["label"] == label]
    rest = [r for r in results if r not in featured]
    out = '        <ol class="gallery">\n' + "".join(case(r) for r in featured) + "        </ol>\n"
    if rest:
        out += (
            '        <details class="gallery-more">\n'
            f"          <summary>Show the other {len(rest)}</summary>\n"
            '        <ol class="gallery">\n' + "".join(case(r) for r in rest) + "        </ol>\n"
            "        </details>\n"
        )
    return out


def check_view():
    """Fails unless the JavaScript view example gives what renderSafe does."""
    node("view-node.mjs")


def link_modules(name):
    """Gives each `./x.js` that a built module imports its file's hash, as
    the page's references get theirs."""
    path = OUT / name
    text = path.read_text(encoding="utf-8")

    def hashed(m):
        digest = hashlib.sha256((OUT / m[2]).read_bytes()).hexdigest()[:10]
        return f'{m[1]}"./{m[2]}?v={digest}";'

    path.write_text(re.sub(r'^(import .* from )"\./([\w-]+\.js)";$', hashed, text, flags=re.M), encoding="utf-8")


def copy(source, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, dest)


def copy_module(source, dest):
    """A JS module without its source map comment, as the maps aren't copied."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    text = source.read_text(encoding="utf-8")
    dest.write_text(re.sub(r"\n//# sourceMappingURL=\S+\s*$", "\n", text), encoding="utf-8")


def sizes(name, files):
    data = b"".join(f.read_bytes() for f in files)
    return {"name": name, "raw": len(data), "gzip": len(gzip.compress(data, 9))}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--update-golden", action="store_true", help="rewrite site/golden/ from the code panel")
    args = parser.parse_args()
    if not (JS / "kelpto-md" / "kelpto_md.internal.js").exists():
        raise SystemExit("Build the JS library first: temper build -b js")
    expected = (TOUR / "expected.txt").read_text(encoding="utf-8")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    # GitHub Pages serves files as they are, without Jekyll.
    (OUT / ".nojekyll").touch()
    for name in ["style.css", "app.js", "demo.js", "editcode.js", "htmlside.js", "tourrun.js", "tree.js"]:
        copy(SITE / name, OUT / name)
    # Imported modules first, so each hash is of the final file.
    link_modules("demo.js")
    link_modules("htmlside.js")
    link_modules("app.js")

    # The page loads kelpto-md first, then the HTML side once it's up.
    first, then = [], []
    for name, folder in LIBRARIES.items():
        for path in sorted((JS / folder).glob("*.js")):
            copy_module(path, OUT / "lib" / folder / path.name)
            (then if name in ("kelpto", "kelpto-html") else first).append(OUT / "lib" / folder / path.name)
    measured = [
        sizes("kelpto-md and Temper's JS runtime, as ES modules, unminified", first),
        sizes("kelpto-html and kelpto once it's up", then),
    ]
    (OUT / "sizes.json").write_text(json.dumps(measured, indent=2) + "\n")

    (OUT / "tour").mkdir(parents=True, exist_ok=True)
    for ext, path in TOURS.items():
        copy(TOUR / path, OUT / "tour" / f"tour.{ext}")
    copy(TOUR / "expected.txt", OUT / "tour" / "expected.txt")
    for path in sorted((SITE / "view").glob("view.*")):
        copy(path, OUT / "view" / path.name)
    check_tour_run(expected)
    check_view()
    samples = check_edit_code(args.update_golden)
    scores = conformance()
    html_scores, tree_line = html_conformance()
    gallery = safe_gallery()

    page = (SITE / "index.html").read_text(encoding="utf-8")
    parts = {
        "COMMONMARK_COUNT": f"{scores['commonmark']['total']:,}",
        "GFM_COUNT": f"{scores['gfm']['total']:,}",
        "TOKENIZER_COUNT": f"{html_scores['tokenizer']['total']:,}",
        "TREE_LINE": tree_line,
        "SAFE_COUNT": str(len(gallery)),
        "SAFE_GALLERY": gallery_html(gallery),
        "IMPORT_MAP": json.dumps({"imports": {name: f"./lib/{folder}/index.js" for name, folder in LIBRARIES.items()}}),
    }
    for key, value in parts.items():
        page = page.replace(f"<!--{key}-->", value)
    left = re.findall(r"<!--[A-Z_]+-->", page)
    if left:
        raise SystemExit(f"Unfilled in index.html: {', '.join(left)}")
    # Each reference gets its file's hash, so browsers fetch changed files
    # instead of reusing cached ones.
    for ref in ["style.css", "app.js"]:
        digest = hashlib.sha256((OUT / ref).read_bytes()).hexdigest()[:10]
        page = page.replace(f'"{ref}"', f'"{ref}?v={digest}"')
    (OUT / "index.html").write_text(page, encoding="utf-8")
    for m in measured:
        print(f"{m['name']}: {m['raw']} bytes, {m['gzip']} gzipped")
    print(f"Code panel: {samples} samples print what the page's edits give")
    for name, s in scores.items():
        print(f"{name}: {s['passed']} of {s['total']} examples pass")
    for name, s in html_scores.items():
        print(f"html {name}: {s['passed']} of {s['total']} tests pass")
    print(f"#safe gallery: {len(gallery)} cases render as their tests expect")
    print(f"Built {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
