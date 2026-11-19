"""Writes test data into Temper source as text, in string literals
joined and parsed once at test start, rather than as thousands of
constructor calls, which every backend would translate and compile one
by one.

A table's rows are joined by one separator and each row's fields by
another, both chosen from the Private Use Area so that no field holds
them; the Temper side gets them back with `split`, which every
backend's runtime does natively. The text is cut into literals of at
most PIECE_BUDGET, counted at the most any backend might spend on each
character. That keeps each literal far under the strictest backend's
limit (MSVC's 16,380 bytes per literal piece; Java's is 65,535 bytes of
modified UTF-8 per constant), and short literals also translate faster:
Temper's C++, C#, Java, and Lua backends slow down sharply on long
literals full of escapes (12,000 took C++ three times as long as 1,000).

Imported by the generators in scripts/, which `uv run` from there.
"""

import unicodedata
from collections.abc import Iterable, Sequence

PIECE_BUDGET = 1_000

# Written as escapes rather than as themselves.
SHORT_ESCAPES = {"\n": "\\n", "\t": "\\t", "\r": "\\r", '"': '\\"', "\\": "\\\\"}


def printable(ch: str, wide: bool) -> bool:
    """Whether `ch` goes into a literal as itself: printable ASCII, or
    with `wide` letters, marks, numbers, punctuation, and symbols past
    it, but U+FEFF."""
    if " " <= ch <= "~":
        return ch != "$"
    return wide and ord(ch) > 0xA0 and unicodedata.category(ch)[0] in "LMNPS" and ch != "\uFEFF"


def literal(s: str, wide: bool = False) -> str:
    """A Temper string literal for `s`."""
    out = []
    for ch in s:
        if ch in SHORT_ESCAPES:
            out.append(SHORT_ESCAPES[ch])
        elif printable(ch, wide):
            out.append(ch)
        else:
            out.append(f"\\u{{{ord(ch):X}}}")
    return '"' + "".join(out) + '"'


def cost(ch: str) -> int:
    """The most any backend spends on `ch` in a literal: one byte for
    printable ASCII, two for a short escape, and otherwise at most ten
    (`\\U0001F600`, or six bytes of Java's modified UTF-8)."""
    if " " <= ch <= "~" and ch not in '"\\':
        return 1
    if ch in SHORT_ESCAPES:
        return 2
    return 10


def pieces(text: str) -> list[str]:
    """`text` cut into pieces of at most PIECE_BUDGET each."""
    out = []
    start = 0
    spent = 0
    for i, ch in enumerate(text):
        c = cost(ch)
        if spent + c > PIECE_BUDGET:
            out.append(text[start:i])
            start = i
            spent = 0
        spent += c
    if start < len(text) or not out:
        out.append(text[start:])
    return out


def text_function(name: str, text: str, wide: bool = False) -> list[str]:
    """Temper lines for `let name(): String`, giving `text`."""
    out = [f"    let {name}(): String {{", "      let out = new StringBuilder();"]
    for piece in pieces(text):
        out.append(f"      out.append({literal(piece, wide)});")
    out += ["      out.toString()", "    }"]
    return out


def separators(rows: Iterable[Sequence[str]]) -> tuple[str, str]:
    """A row separator and a field separator that no field holds."""
    used: set[str] = set()
    for row in rows:
        for field in row:
            used.update(field)
    free = (chr(c) for c in range(0xE001, 0xF900) if chr(c) not in used)
    return next(free), next(free)


def table(
    name: str, rows: Sequence[Sequence[str]], type_name: str, make: str, wide: bool = False,
) -> list[str]:
    """Temper lines for `let nameText(): String`, holding `rows`, and
    `export let name(): List<type_name>`, making each row's value with
    `make`, an expression of the row's fields `f[0]`, `f[1]`, ....
    """
    if not rows:
        raise ValueError(f"{name}: no rows")
    row_sep, field_sep = separators(rows)
    text = row_sep.join(field_sep.join(row) for row in rows)
    out = text_function(f"{name}Text", text, wide)
    out += [
        "",
        f"    export let {name}(): List<{type_name}> {{",
        f"      let all = new ListBuilder<{type_name}>();",
        f"      let rows = {name}Text().split({literal(row_sep)});",
        "      for (var i = 0; i < rows.length; i += 1) {",
        f"        let f = rows[i].split({literal(field_sep)});",
        f"        all.add({make});",
        "      }",
        "      all.toList()",
        "    }",
    ]
    return out
