# /// script
# requires-python = ">=3.11"
# ///
"""Gets the Unicode data files that kelpto's character tables are
generated from, into data/unicode-<version>/, and checks each against its
pinned SHA-256.

    uv run scripts/unicode_data.py           # get missing files, check all
    uv run scripts/unicode_data.py --repin   # after raising VERSION, or to
                                             # pin newly added files

CommonMark needs two: case folding, to match link labels
(CaseFolding.txt), and general categories, for Unicode punctuation and
whitespace in emphasis rules (UnicodeData.txt). The files aren't in git;
the tables generated from them are. A generating script calls `ensure()`
first, so one command refreshes everything. To move to a new Unicode
version, raise VERSION, run with --repin (which downloads the files and
records their hashes here), regenerate the tables, and update NOTICE.

A file listed with an empty hash isn't pinned yet: run --repin where
unicode.org is reachable (not from the dev container), and commit the
hashes it writes here. Until then, ensure() skips it.
"""

import argparse
import hashlib
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = "18.0.0"
PUBLIC = "https://www.unicode.org/Public"
# File name to (directory under PUBLIC/VERSION, SHA-256).
FILES = {
    "CaseFolding.txt": ("ucd", "a004797658a457bec4dc11683e39f69249ea3b595b752dbea6721c4c9f587b0d"),
    "UnicodeData.txt": ("ucd", "0736451de439ae7baf1425136617da495e09ee5afbe6e394374db7009ea08950"),
}


def data_dir() -> Path:
    return ROOT / "data" / f"unicode-{VERSION}"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(name: str) -> Path:
    path = data_dir() / name
    url = f"{PUBLIC}/{VERSION}/{FILES[name][0]}/{name}"
    print(f"Getting {url}", file=sys.stderr)
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response:
        path.write_bytes(response.read())
    return path


def ensure(names: list[str] | None = None) -> Path:
    """Gets any missing file and checks every file's hash; returns the
    directory holding them. Given names, it handles just those, and fails
    on one not yet pinned; otherwise it skips files not yet pinned."""
    for name in names or FILES:
        expected = FILES[name][1]
        if expected == "":
            if names:
                sys.exit(f"{name} isn't pinned yet: run this script with --repin "
                         "where unicode.org is reachable, and commit the hashes")
            continue
        path = data_dir() / name
        if not path.exists():
            download(name)
        actual = sha256(path)
        if actual != expected:
            sys.exit(f"{path} has SHA-256 {actual}, not the pinned {expected}; "
                     "delete it to download it again, or --repin after raising VERSION")
    return data_dir()


def repin() -> None:
    """Downloads every file for VERSION and records its hash in this script."""
    script = Path(__file__)
    text = script.read_text(encoding="utf-8")
    for name in FILES:
        digest = sha256(download(name))
        text, count = re.subn(rf'("{re.escape(name)}": \("[^"]+", ")[0-9a-f]*(")', rf"\g<1>{digest}\g<2>", text)
        assert count == 1, name
    script.write_text(text, encoding="utf-8")
    print(f"Pinned the Unicode {VERSION} files' hashes", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repin", action="store_true", help="download every file and record new hashes")
    if p.parse_args().repin:
        repin()
    else:
        print(ensure())


if __name__ == "__main__":
    main()
