# /// script
# requires-python = ">=3.11"
# ///
"""Builds Kelpto's site into `site/build/`.

    temper build -b js
    uv run site/build.py
    python3 -m http.server --bind 127.0.0.1 -d site/build

Copies Temper's JS output for kelpto-md and kelpto-core, with Temper's JS
runtime, as plain ES modules, which the page's import map names, so the
page parses, edits, and renders live with the same library as every other
language. No bundler, so nothing to install; the cost is size (see
`sizes.json`).

Runs CommonMark's and GFM's examples (`tests/*/spec.json`) in Node
through the built library (`conformance-node.mjs`), and fails unless
every one passes; the counts go in the page. The examples themselves
aren't copied, as they're CC-BY-SA 4.0.

Runs the JavaScript tour in Node as the page's "Run in your browser"
does (`tour-node.mjs` and `tourrun.js`), against the built `lib/`,
failing unless it prints `demos/tour/expected.txt`. The tours go in
`tour/`.
"""

import difflib
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "build"
JS = ROOT / "temper.out" / "js"
TOUR = ROOT / "demos" / "tour"
TESTS = ROOT / "tests"

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
LIBRARIES = {"kelpto-md": "kelpto-md", "kelpto-core": "kelpto-core", "@temperlang/core": "temper-core"}


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


def conformance():
    """Each suite's passed and total, run in Node on the built library.
    Fails unless every example passes."""
    scores = json.loads(node("conformance-node.mjs", str(TESTS / "commonmark" / "spec.json"), str(TESTS / "gfm" / "spec.json")))
    for name, score in scores.items():
        if score["passed"] != score["total"]:
            raise SystemExit(f"{name}: {score['passed']} of {score['total']} examples pass; failing: {score['failing'][:20]}")
    return scores


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
    if not (JS / "kelpto-md" / "kelpto_md.internal.js").exists():
        raise SystemExit("Build the JS library first: temper build -b js")
    expected = (TOUR / "expected.txt").read_text(encoding="utf-8")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    # GitHub Pages serves files as they are, without Jekyll.
    (OUT / ".nojekyll").touch()
    for name in ["style.css", "app.js", "demo.js", "tourrun.js"]:
        copy(SITE / name, OUT / name)
    link_modules("app.js")

    lib = []
    for folder in LIBRARIES.values():
        for path in sorted((JS / folder).glob("*.js")):
            copy_module(path, OUT / "lib" / folder / path.name)
            lib.append(OUT / "lib" / folder / path.name)
    measured = [sizes("kelpto-md and Temper's JS runtime, as ES modules, unminified", lib)]
    (OUT / "sizes.json").write_text(json.dumps(measured, indent=2) + "\n")

    (OUT / "tour").mkdir(parents=True, exist_ok=True)
    for ext, path in TOURS.items():
        copy(TOUR / path, OUT / "tour" / f"tour.{ext}")
    copy(TOUR / "expected.txt", OUT / "tour" / "expected.txt")
    check_tour_run(expected)
    scores = conformance()

    page = (SITE / "index.html").read_text(encoding="utf-8")
    parts = {
        "COMMONMARK_COUNT": f"{scores['commonmark']['total']:,}",
        "GFM_COUNT": f"{scores['gfm']['total']:,}",
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
    for name, s in scores.items():
        print(f"{name}: {s['passed']} of {s['total']} examples pass")
    print(f"Built {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
