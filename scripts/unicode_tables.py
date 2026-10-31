# /// script
# requires-python = ">=3.11"
# ///
"""Writes kelpto-core/unicode-tables.temper.md, the Unicode data CommonMark
needs, from the files scripts/unicode_data.py gets and pins.

    uv run scripts/unicode_tables.py

Three tables, as CommonMark 0.31.2 defines them:

- Case folding, full (CaseFolding.txt's C and F entries), to match link
  labels ("Unicode case fold").
- Unicode punctuation: general categories P and S (UnicodeData.txt), for
  the emphasis rules.
- Unicode whitespace: Zs, plus tab, line feed, form feed, and carriage
  return.

The tables are read where they are, with no decoding ahead. Punctuation
and case folding are each split into chunks of CHUNK entries: a list of
the code point each chunk starts at, and a string per chunk, read from its
start. Each string is numbers in base 32, most significant digit first:
U+0060 to U+007F for each digit but the last, and U+0040 to U+005F for the
last, as Hrefine's tables are, so only `\\` and U+007F need escapes.

- Punctuation, per range: the gap since the last range's end (from the
  chunk's start for the first), and the length.
- Case folding, per entry: the gap since the last entry's end, then a
  count. A count of 1 or more is a run of that many code points, every
  `stride` (1 or 2) apart, each folding to itself plus `delta`
  (zigzag-encoded: 0, -1, 1, -2, … as 0, 1, 2, 3, …): the numbers after
  it are the stride and the delta. A count of 0 is one code point folding to several: the
  number of them, then each as a zigzag delta from the code point.
- Whitespace is short, so it's a list of ranges, first and last.

The script checks every code point's lookups, read as the Temper code
reads them, against the Unicode files.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import unicode_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "kelpto-core" / "unicode-tables.temper.md"
FILES = ["CaseFolding.txt", "UnicodeData.txt"]
N = 0x110000
CHUNK = 16


def categories(folder: Path) -> dict[int, str]:
    cats: dict[int, str] = {}
    first = 0
    for line in (folder / "UnicodeData.txt").read_text(encoding="utf-8").splitlines():
        fields = line.split(";")
        code, name, category = int(fields[0], 16), fields[1], fields[2]
        if name.endswith(", First>"):
            first = code
        elif name.endswith(", Last>"):
            for c in range(first, code + 1):
                cats[c] = category
        else:
            cats[code] = category
    return cats


def folds(folder: Path) -> dict[int, list[int]]:
    """Full case folding: the C and F entries."""
    out: dict[int, list[int]] = {}
    for line in (folder / "CaseFolding.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        code, status, mapping = [x.strip() for x in line.split(";")[:3]]
        if status in ("C", "F"):
            out[int(code, 16)] = [int(x, 16) for x in mapping.split()]
    return out


def ranges(codes: list[int]) -> list[tuple[int, int]]:
    """Sorted code points as (first, last) ranges."""
    out: list[list[int]] = []
    for c in codes:
        if out and out[-1][1] == c - 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return [(a, b) for a, b in out]


def zigzag(n: int) -> int:
    return n * 2 if n >= 0 else -n * 2 - 1


def unzigzag(n: int) -> int:
    return n >> 1 if n % 2 == 0 else -(n >> 1) - 1


def encode(numbers: list[int]) -> str:
    out = []
    for n in numbers:
        assert n >= 0, n
        digits = [n & 31]
        n >>= 5
        while n:
            digits.append(n & 31)
            n >>= 5
        out.append("".join(chr(0x60 + d) for d in reversed(digits[1:])) + chr(0x40 + digits[0]))
    return "".join(out)


def decode(text: str) -> list[int]:
    out, value = [], 0
    for ch in text:
        c = ord(ch)
        value = value << 5 | c & 31
        if c < 0x60:
            out.append(value)
            value = 0
    return out


def punctuation_chunks(rs: list[tuple[int, int]]) -> tuple[list[int], list[str]]:
    starts, strings = [], []
    for k in range(0, len(rs), CHUNK):
        chunk = rs[k:k + CHUNK]
        pos = chunk[0][0]
        starts.append(pos)
        numbers = []
        for first, last in chunk:
            numbers += [first - pos, last - first + 1]
            pos = last + 1
        strings.append(encode(numbers))
    return starts, strings


def fold_entries(fold: dict[int, list[int]]) -> list[tuple]:
    """Runs (start, count, stride, delta) and multi entries (start, 0, targets)."""
    entries: list[list] = []
    for c in sorted(fold):
        target = fold[c]
        if len(target) > 1:
            entries.append([c, 0, target])
            continue
        delta = target[0] - c
        if entries and entries[-1][1] > 0 and entries[-1][3] == delta:
            start, count, stride, _ = entries[-1]
            if count == 1 and c - start <= 2:
                entries[-1] = [start, 2, c - start, delta]
                continue
            if count > 1 and c == start + count * stride:
                entries[-1][1] += 1
                continue
        entries.append([c, 1, 1, delta])
    return [tuple(e) for e in entries]


def entry_end(entry: tuple) -> int:
    if entry[1] == 0:
        return entry[0] + 1
    start, count, stride, _ = entry
    return start + (count - 1) * stride + 1


def fold_chunks(entries: list[tuple]) -> tuple[list[int], list[str]]:
    starts, strings = [], []
    for k in range(0, len(entries), CHUNK):
        chunk = entries[k:k + CHUNK]
        pos = chunk[0][0]
        starts.append(pos)
        numbers = []
        for e in chunk:
            numbers.append(e[0] - pos)
            if e[1] == 0:
                numbers += [0, len(e[2])] + [zigzag(t - e[0]) for t in e[2]]
            else:
                numbers += [e[1], e[2], zigzag(e[3])]
            pos = entry_end(e)
        strings.append(encode(numbers))
    return starts, strings


def chunk_index(starts: list[int], c: int) -> int:
    """The last chunk starting at or before `c`, or -1, as the Temper code finds it."""
    low, high = 0, len(starts) - 1
    if c < starts[0]:
        return -1
    while low < high:
        middle = (low + high + 1) // 2
        if starts[middle] <= c:
            low = middle
        else:
            high = middle - 1
    return low


def is_punctuation(starts: list[int], strings: list[str], c: int) -> bool:
    k = chunk_index(starts, c)
    if k < 0:
        return False
    numbers = decode(strings[k])
    pos = starts[k]
    for i in range(0, len(numbers), 2):
        start = pos + numbers[i]
        if c < start:
            return False
        pos = start + numbers[i + 1]
        if c < pos:
            return True
    return False


def fold_of(starts: list[int], strings: list[str], c: int) -> list[int]:
    k = chunk_index(starts, c)
    if k < 0:
        return [c]
    numbers = decode(strings[k])
    pos, i = starts[k], 0
    while i < len(numbers):
        start = pos + numbers[i]
        count = numbers[i + 1]
        if c < start:
            return [c]
        if count == 0:
            m = numbers[i + 2]
            targets = [start + unzigzag(t) for t in numbers[i + 3:i + 3 + m]]
            if c == start:
                return targets
            pos, i = start + 1, i + 3 + m
        else:
            stride, delta = numbers[i + 2], unzigzag(numbers[i + 3])
            pos = start + (count - 1) * stride + 1
            if c < pos:
                return [c + delta] if (c - start) % stride == 0 else [c]
            i += 4
    return [c]


def literal(s: str) -> str:
    """A Temper string literal for `s`, escaping anything but plain ASCII."""
    out = []
    for ch in s:
        if " " <= ch <= "~" and ch not in '"\\$':
            out.append(ch)
        else:
            out.append(f"\\u{{{ord(ch):X}}}")
    return '"' + "".join(out) + '"'


def items(values: list[str], indent: str, width: int = 90) -> list[str]:
    lines, line = [], indent
    for v in values:
        item = f" {v},"
        if len(line) + len(item) > width and line != indent:
            lines.append(line)
            line = indent
        line += item
    lines.append(line)
    return lines


def hexes(values: list[int]) -> list[str]:
    return [f"0x{v:X}" for v in values]


def write(p_starts, p_strings, f_starts, f_strings, whitespace) -> None:
    v = unicode_data.VERSION
    out = [
        "# Unicode tables",
        "",
        f"Generated by `scripts/unicode_tables.py` from Unicode {v}'s",
        "UnicodeData.txt and CaseFolding.txt (see NOTICE). Don't edit by hand;",
        "the script's notes say how they're encoded, and `unicode.temper.md`",
        "reads them.",
        "",
        "Punctuation, general categories P and S: where each chunk starts, and",
        "its ranges.",
        "",
        "    let punctuationStarts: List<Int> = [",
        *items(hexes(p_starts), "     "),
        "    ];",
        "",
        "    let punctuationRuns: List<String> = [",
        *[f"      {literal(s)}," for s in p_strings],
        "    ];",
        "",
        "Full case folding, CaseFolding.txt's C and F entries: where each chunk",
        "starts, and its entries.",
        "",
        "    let foldStarts: List<Int> = [",
        *items(hexes(f_starts), "     "),
        "    ];",
        "",
        "    let foldRuns: List<String> = [",
        *[f"      {literal(s)}," for s in f_strings],
        "    ];",
        "",
        "Whitespace, Zs plus tab, line feed, form feed, and carriage return:",
        "ranges, first and last.",
        "",
        "    let whitespaceRanges: List<Int> = [",
        *items(hexes([x for r in whitespace for x in r]), "     "),
        "    ];",
    ]
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> None:
    folder = unicode_data.ensure(FILES)
    cats = categories(folder)
    fold = folds(folder)
    punct = ranges(sorted(c for c, g in cats.items() if g[0] in "PS"))
    space = ranges(sorted([c for c, g in cats.items() if g == "Zs"] + [0x9, 0xA, 0xC, 0xD]))
    p_starts, p_strings = punctuation_chunks(punct)
    entries = fold_entries(fold)
    f_starts, f_strings = fold_chunks(entries)
    for c in range(N):
        want = cats.get(c, "Cn")[0] in "PS"
        assert is_punctuation(p_starts, p_strings, c) == want, hex(c)
        assert fold_of(f_starts, f_strings, c) == fold.get(c, [c]), hex(c)
    write(p_starts, p_strings, f_starts, f_strings, space)
    chars = sum(len(s) for s in p_strings + f_strings)
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(punct)} punctuation ranges, {len(entries)} "
          f"case folding entries ({len(fold)} code points), {len(space)} whitespace ranges; "
          f"{len(p_starts) + len(f_starts)} chunks, {chars} characters of strings, "
          f"{OUT.stat().st_size} bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
