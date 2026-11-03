# /// script
# requires-python = ">=3.11"
# ///
"""Writes tests/html5lib-tokenizer/, kelpto-html's tests from
html5lib-tests' tokenizer tests.

    uv run scripts/html5lib_tokenizer.py

The test files are downloaded once, at COMMIT, into data/ (not in git),
and checked against their pinned SHA-256s. To move to a newer commit,
change COMMIT and the hashes together and regenerate.

Each test becomes one Temper value per initial state it names: its
file, description, input, the state, the last start tag (or ""), and
the expected tokens and errors, each written as one string in the
canonical form tests/html5lib-tokenizer/tokenizer-tests.temper.md
writes kelpto-html's output in:

- tokens joined by U+001E, each token's fields by U+001F: `Character`
  and its text (adjacent ones joined), `StartTag`, its name, then each
  attribute's name and value, then U+001D if self-closing, `EndTag` and
  its name, `Comment` and its text, and `DOCTYPE`, its name, public and
  system identifiers (U+0000 alone for none), and `true` or `false`
  for the force-quirks flag being off; and `ProcessingInstruction`, its
  target, and its data, which some tests expect for `<?`, though the
  standard Kelpto follows reads that as a bogus comment;
- errors as `code:line:col`, joined by `,`.

Tests whose input, once `doubleEscaped` is undone, holds a lone
surrogate are left out, since Temper strings can't hold one, and so is
xmlViolation.test, which expects the XML infoset coercions an XML
writer makes, not the tokenizer's output. The script prints how many.
"""

import hashlib
import json
import re
import unicodedata
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMIT = "c777c408b61078ea2eb4acefc2535f54dbc8b28a"
DATA = ROOT / "data" / f"html5lib-tests-{COMMIT[:12]}" / "tokenizer"
OUT_DIR = ROOT / "tests" / "html5lib-tokenizer"
CHUNK = 100  # Tests per function, keeping each function small.

FILES = {
    "contentModelFlags.test": "77784a505a528950761cfb3c76617afade28b27c3be2a8c37dce3c3d8988391d",
    "domjs.test": "3273e7861bbdb094571e4b0813ffdd934fe2bfd65864600fef62e8e3b807131a",
    "entities.test": "fe17483810a00247579f5f129ca9c007fbab6755ba839523e29aa9f8875f4085",
    "escapeFlag.test": "edbd2e070a14fc67f6bbc104e50207f0fe206a21891c260deea3d227b32c93c9",
    "namedEntities.test": "a7f0e59ff7653820330548776cb3031c18e45f5fd1481a9813d9c7acee89bd6e",
    "numericEntities.test": "679296c976252322ece27e2b113a5358a0aa3b0b8ecd2d6d9b365f9d1b0f9632",
    "pendingSpecChanges.test": "6b56d81ca09afa47d8cb0f33e3fb7169010c3a64493e608ebec921ac098ff8e9",
    "test1.test": "524fcfa4d561a14f0c4e72e0573549abe6341fd4dfb8e16bc2dcf59a608a7219",
    "test2.test": "f0e2bf7d21de13a8e930d350d0a5ad364e2546ce9ca8e938ab8cb63a5bbe417d",
    "test3.test": "87817f985e6b137562b6f50c1b92b65db63514f800426b5e42b0d184ca59e846",
    "test4.test": "c4967118aecbf8eb2ca34d5c5306f536614acca03e58610f75fbd9efa89fbb42",
    "unicodeChars.test": "22b7263a840da38179b13693bbfe72f0507dcd41951622456a0d3f5300ba42bd",
    "unicodeCharsProblematic.test": "3c166d5cfa24ee60fd7310ff0f5057e4ae0c649842ec446b5949215759e19a68",
}
SKIPPED_FILES = ["xmlViolation.test"]

# namedEntities.test, 4,210 tests, gets a file of its own.
SEPARATE = {"namedEntities.test": "named-entities"}


def ensure(name: str) -> Path:
    path = DATA / name
    if not path.exists():
        url = f"https://raw.githubusercontent.com/html5lib/html5lib-tests/{COMMIT}/tokenizer/{name}"
        print(f"Getting {url}", file=sys.stderr)
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url) as response:
            path.write_bytes(response.read())
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != FILES[name]:
        sys.exit(f"{path} has SHA-256 {actual}, not the pinned {FILES[name]}")
    return path


def unescape(s: str) -> str:
    """Undoes `doubleEscaped`, joining surrogate pairs."""
    raw = re.sub(r"\\u([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), s)
    return raw.encode("utf-16", "surrogatepass").decode("utf-16", "surrogatepass")


def has_lone_surrogate(s: str) -> bool:
    return any(0xD800 <= ord(ch) <= 0xDFFF for ch in s)


def canonical_tokens(output: list, fix) -> str:
    tokens: list[str] = []
    for token in output:
        kind = token[0]
        if kind == "Character":
            data = fix(token[1])
            if tokens and tokens[-1].startswith("Character\x1f"):
                tokens[-1] += data
            else:
                tokens.append("Character\x1f" + data)
        elif kind == "StartTag":
            fields = ["StartTag", fix(token[1])]
            for name, value in token[2].items():
                fields += [fix(name), fix(value)]
            text = "\x1f".join(fields)
            if len(token) > 3 and token[3]:
                text += "\x1d"
            tokens.append(text)
        elif kind == "EndTag":
            tokens.append("EndTag\x1f" + fix(token[1]))
        elif kind == "Comment":
            tokens.append("Comment\x1f" + fix(token[1]))
        elif kind == "DOCTYPE":
            def opt(x):
                return "\x00" if x is None else fix(x)
            tokens.append("\x1f".join([
                "DOCTYPE", opt(token[1]), opt(token[2]), opt(token[3]),
                "true" if token[4] else "false",
            ]))
        elif kind == "ProcessingInstruction":
            tokens.append("\x1f".join(["ProcessingInstruction", fix(token[1]), fix(token[2])]))
        else:
            raise ValueError(kind)
    return "\x1e".join(tokens)


def canonical_errors(errors: list) -> str:
    return ",".join(f"{e['code']}:{e['line']}:{e['col']}" for e in errors)


def literal(s: str) -> str:
    """A Temper string literal for `s`, escaping anything but printable
    characters (ASCII, or letters, marks, numbers, punctuation, and
    symbols past it)."""
    out = []
    for ch in s:
        printable = " " <= ch <= "~" or (
            ord(ch) > 0xA0 and unicodedata.category(ch)[0] in "LMNPS" and ch != "\ufeff"
        )
        if printable and ch not in '"\\$':
            out.append(ch)
        else:
            out.append(f"\\u{{{ord(ch):X}}}")
    return '"' + "".join(out) + '"'


def cases(name: str) -> tuple[list[tuple], int]:
    tests = json.loads(ensure(name).read_text(encoding="utf-8"))["tests"]
    result = []
    skipped = 0
    for test in tests:
        fix = unescape if test.get("doubleEscaped") else (lambda s: s)
        text = fix(test["input"])
        expected = canonical_tokens(test["output"], fix)
        if has_lone_surrogate(text) or has_lone_surrogate(expected):
            skipped += 1
            continue
        errors = canonical_errors(test.get("errors", []))
        # namedEntities.test's descriptions only restate the input.
        description = "" if name in SEPARATE else test["description"]
        for state in test.get("initialStates", ["Data state"]):
            result.append((
                name, description, text, state, test.get("lastStartTag", ""), expected, errors,
            ))
    return result, skipped


HEADER = """\
Generated by `scripts/html5lib_tokenizer.py` from html5lib-tests'
tokenizer tests, commit {commit}, under the MIT license (see
NOTICE at the top of the repo). Don't edit by hand.
"""


def functions(prefix: str, all_cases: list[tuple], export_name: str, short: bool = False) -> list[str]:
    """Temper functions giving `all_cases`; `short` writes each as
    `named(input, tokens, errors)`, for namedEntities.test, whose other
    fields never change."""
    out = []
    names = []
    for start in range(0, len(all_cases), CHUNK):
        name = f"{prefix}{start // CHUNK}"
        names.append(name)
        out.append(f"    let {name}(): List<TokenizerTest> {{")
        out.append("      [")
        for case in all_cases[start:start + CHUNK]:
            if short:
                fields = [case[2], case[5], case[6]]
                out.append(f"        named({', '.join(literal(x) for x in fields)}),")
            else:
                out.append(f"        new TokenizerTest({', '.join(literal(x) for x in case)}),")
        out.append("      ]")
        out.append("    }")
        out.append("")
    out.append(f"    export let {export_name}(): List<TokenizerTest> {{")
    out.append("      let all = new ListBuilder<TokenizerTest>();")
    for name in names:
        out.append(f"      all.addAll({name}());")
    out.append("      all.toList()")
    out.append("    }")
    return out


def main() -> None:
    main_cases: list[tuple] = []
    separate: dict[str, list[tuple]] = {}
    total_skipped = 0
    for name in FILES:
        found, skipped = cases(name)
        total_skipped += skipped
        if name in SEPARATE:
            separate[name] = found
        else:
            main_cases += found
        print(f"{name}: {len(found)} runs, {skipped} tests left out")
    out = [
        "# html5lib-tests' tokenizer tests",
        "",
        HEADER.format(commit=COMMIT[:12]),
        "One test in one initial state: its file, its description, the",
        "input, the state's name as the test gives it, the last start tag",
        "(or empty), and the expected tokens and errors in canonical form",
        "(see `tokenizer-tests.temper.md`).",
        "",
        "    export class TokenizerTest(",
        "      public file: String,",
        "      public description: String,",
        "      public input: String,",
        "      public state: String,",
        "      public lastStartTag: String,",
        "      public tokens: String,",
        "      public errors: String,",
        "    ) {}",
        "",
        "In functions rather than a module-level list, and in chunks, so each",
        "backend compiles them easily. Every file but namedEntities.test,",
        "which is in `named-entities.temper.md`.",
        "",
    ]
    out += functions("tests", main_cases, "tokenizerTests")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "tests.temper.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    for name, found in separate.items():
        out = [
            f"# html5lib-tests' {name}",
            "",
            HEADER.format(commit=COMMIT[:12]),
            "Each named character reference, with and without its semicolon.",
            "",
            "    let named(input: String, tokens: String, errors: String): TokenizerTest {",
            f"      new TokenizerTest({literal(name)}, \"\", input, \"Data state\", \"\", tokens, errors)",
            "    }",
            "",
        ]
        out += functions("namedTests", found, "namedEntityTests", short=True)
        (OUT_DIR / f"{SEPARATE[name]}.temper.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"{total_skipped} tests left out for lone surrogates; skipped files: {', '.join(SKIPPED_FILES)}")


if __name__ == "__main__":
    main()
