#!/usr/bin/env python3
"""Keeps the browser's METACOM reference in step with this one.

static/symbols.js is the browser half of symbol search. Unlike tiles.js it is
not a port — bildhaft had already written the search, so it was lifted into a
package the two projects share and symbols.js is only the adapter. Most of it
therefore has no Python to be compared against, and the package has tests of
its own.

One thing does have to agree, and it is the thing that would break quietly.
metacom.py keys the collection by file stem (`files.setdefault(path.stem, …)`),
layout.json writes that stem as `metacom:<name>`, and obf.py reads it back the
same way. The package identifies a symbol by its path inside the chosen folder
instead, so symbols.js derives the stem from that path — and if the two ever
disagree, every existing layout points at symbols nobody can find, the build
fails on boards that used to build, and nothing in either half would notice.

So this reads the real function out of symbols.js rather than a copy of it and
runs it against the Python. Skipped, not failed, where node is missing: this
must not be the reason a machine without node cannot run the suite.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYMBOLS_JS = ROOT / "static" / "symbols.js"

# Paths as the package reports them: relative to the folder somebody chose,
# nested, and with the variants METACOM really ships.
CASES = [
    "Apfel.png",
    "METACOM_Symbole/Symbole_PNG/PNG_ohne_Rahmen/essen.png",
    "PNG_ohne_Rahmen/wuetend.png",
    "PNG_ohne_Rahmen/wuetendSW.png",       # the black-and-white rendition
    "PNG_ohne_Rahmen/wuetend2.png",        # an alternative of the same symbol
    "PNG_ohne_Rahmen/Guten_Morgen.png",    # multi-part keyword
    "PNG_ohne_Rahmen/gross.jpeg",
    "a/b/c/tief_verschachtelt.webp",
    "PNG_ohne_Rahmen/zwei.punkte.png",     # a dot that is not the extension
]


def javascript_reference(paths: list[str]) -> list[str]:
    """What symbols.js makes of each path, run in node.

    The function is read out of the file rather than restated here. A copy
    would agree with itself for ever, which is the one thing this must not do.
    """
    source = SYMBOLS_JS.read_text(encoding="utf-8")
    prefix = re.search(r'const METACOM_PREFIX = "([^"]*)"', source)
    body = re.search(r"^const referenceFor = .*?;$", source, re.M)
    if not prefix or not body:
        print("  FAIL  could not find METACOM_PREFIX and referenceFor in "
              "static/symbols.js — has the adapter been renamed?")
        return []

    driver = (f'const METACOM_PREFIX = "{prefix.group(1)}";\n'
              f"{body.group(0)}\n"
              f"console.log(JSON.stringify({json.dumps(paths)}.map(referenceFor)));")
    done = subprocess.run([shutil.which("node"), "--input-type=module", "-e", driver],
                          capture_output=True, text=True, check=True)
    return json.loads(done.stdout)


def main() -> int:
    print("static/symbols.js writes the same metacom: reference as metacom.py")
    if not shutil.which("node"):
        print("  SKIP  node is not installed")
        return 0

    from_js = javascript_reference(CASES)
    if not from_js:
        return 1

    failures = 0
    for path, actual in zip(CASES, from_js):
        # What metacom.py keys the collection by, and what layout.json holds.
        wanted = "metacom:" + Path(path).stem
        if actual == wanted:
            print(f"  ok    {path} -> {actual}")
        else:
            print(f"  FAIL  {path} -> {actual}, but metacom.py calls it {wanted}")
            failures += 1

    print()
    print("  All good." if not failures else f"  {failures} problem(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
