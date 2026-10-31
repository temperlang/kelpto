# /// script
# requires-python = ">=3.11"
# ///
"""Writes kelpto-core/entities.temper.md, HTML's named character
references, from html5lib-tests' tokenizer/namedEntities.test, which lists
every name with its expansion.

    uv run scripts/character_references.py

The file is downloaded once, at COMMIT, into data/ (not in git), and
checked against its pinned SHA-256. To move to a newer commit, change
COMMIT and SHA256 together and regenerate.

HTML's table has 2,231 names: 2,125 with a trailing semicolon, and 106 of
the same without one, which HTML still accepts in text for old pages
(`&amp` as well as `&amp;`). CommonMark takes only the forms with a
semicolon. The table holds each name once, with a flag for whether the
form without a semicolon counts too, so it serves both.

The names are sorted and front-coded, in strings of CHUNK entries. Per
entry: one character for how many characters it shares with the name
before it, U+0040 plus that number (each chunk starts afresh), then the
rest of the name, then a marker, then the expansion: `;` for one code
point, `:` for two, and `,` for one code point when the form without a
semicolon counts too (no such name expands to two). The Temper code reads
them into a map when the library loads.
"""

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMIT = "c777c408b61078ea2eb4acefc2535f54dbc8b28a"
SHA256 = "a7f0e59ff7653820330548776cb3031c18e45f5fd1481a9813d9c7acee89bd6e"
URL = f"https://raw.githubusercontent.com/html5lib/html5lib-tests/{COMMIT}/tokenizer/namedEntities.test"
DATA = ROOT / "data" / f"html5lib-tests-{COMMIT[:12]}" / "namedEntities.test"
OUT = ROOT / "kelpto-core" / "entities.temper.md"
CHUNK = 100


def ensure() -> Path:
    if not DATA.exists():
        print(f"Getting {URL}", file=sys.stderr)
        DATA.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL) as response:
            DATA.write_bytes(response.read())
    actual = hashlib.sha256(DATA.read_bytes()).hexdigest()
    if actual != SHA256:
        sys.exit(f"{DATA} has SHA-256 {actual}, not the pinned {SHA256}")
    return DATA


def entities(path: Path) -> tuple[dict[str, str], set[str]]:
    """Names with a semicolon and their expansions, and the names also
    valid without one."""
    with_semicolon: dict[str, str] = {}
    without: dict[str, str] = {}
    for test in json.loads(path.read_text(encoding="utf-8"))["tests"]:
        given = test["input"]
        output = "".join(token[1] for token in test["output"] if token[0] == "Character")
        if output == given:
            continue  # Not a reference: the text stays as it was.
        assert given.startswith("&"), given
        if given.endswith(";"):
            with_semicolon[given[1:-1]] = output
        else:
            without[given[1:]] = output
    for name, value in without.items():
        assert with_semicolon.get(name) == value, name
        assert len(value) == 1, name
    return with_semicolon, set(without)


def shared(a: str, b: str) -> int:
    n = 0
    while n < len(a) and n < len(b) and a[n] == b[n]:
        n += 1
    return n


def encode(table: dict[str, str], legacy: set[str]) -> list[str]:
    names = sorted(table)
    chunks = []
    for k in range(0, len(names), CHUNK):
        out, previous = [], ""
        for name in names[k:k + CHUNK]:
            assert name.isascii() and name.isalnum(), name
            n = shared(previous, name)
            assert n < 32
            value = table[name]
            marker = ":" if len(value) == 2 else "," if name in legacy else ";"
            out.append(chr(0x40 + n) + name[n:] + marker + value)
            previous = name
        chunks.append("".join(out))
    return chunks


def decode(chunks: list[str]) -> tuple[dict[str, str], set[str]]:
    """As the Temper code reads them."""
    table, legacy = {}, set()
    for chunk in chunks:
        i, previous = 0, ""
        while i < len(chunk):
            n = ord(chunk[i]) - 0x40
            j = i + 1
            while chunk[j].isascii() and chunk[j].isalnum():
                j += 1
            name = previous[:n] + chunk[i + 1:j]
            marker = chunk[j]
            size = 2 if marker == ":" else 1
            table[name] = chunk[j + 1:j + 1 + size]
            if marker == ",":
                legacy.add(name)
            previous, i = name, j + 1 + size
    return table, legacy


def literal(s: str) -> str:
    """A Temper string literal for `s`, escaping anything but plain ASCII."""
    out = []
    for ch in s:
        if " " <= ch <= "~" and ch not in '"\\$':
            out.append(ch)
        else:
            out.append(f"\\u{{{ord(ch):X}}}")
    return '"' + "".join(out) + '"'


def main() -> None:
    table, legacy = entities(ensure())
    chunks = encode(table, legacy)
    assert decode(chunks) == (table, legacy)
    out = [
        "# Named character references",
        "",
        "Generated by `scripts/character_references.py` from html5lib-tests'",
        f"tokenizer/namedEntities.test, commit {COMMIT[:12]}, under the MIT",
        "license (see NOTICE). Don't edit by hand; the script's notes say how",
        "they're encoded, and `character-references.temper.md` reads them.",
        "",
        "    let namedReferenceChunks: List<String> = [",
        *[f"      {literal(chunk)}," for chunk in chunks],
        "    ];",
    ]
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    chars = sum(len(chunk) for chunk in chunks)
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(table)} names, {len(legacy)} also without a "
          f"semicolon; {len(chunks)} chunks, {chars} characters, {OUT.stat().st_size} bytes",
          file=sys.stderr)


if __name__ == "__main__":
    main()
