#!/usr/bin/env python3
"""Finds German that is left where English belongs.

How German is recognised is in tests/german.py, together with the reasons -
including the one thing it deliberately does not try to catch. This file is
the sweep: which files are read, and which are German on purpose.

Four files are German on purpose and are skipped whole: the two tables that
hold the German translations, the word lists that recognise German, and this
file. Everything else is checked, including the shell scripts and the Compose
file - they are read while somebody is setting the thing up, which is the same
readership as the code.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import german  # noqa: E402

# German on purpose.
# The repo is English throughout. What is left is the two translation tables
# and the two files that are made of German by definition.
#
# The German introduction that used to be README.md is not gone, it is in the
# history - it is the raw material for a landing page aimed at families rather
# than at people rebuilding the device. Those are two different documents, so
# there is deliberately no README.de.md to drift out of step.
GERMAN_BY_DESIGN = {
    "texts.py",                       # holds the German interface texts
    "static/boot_data.js",            # the same table, written out for the
                                      # page that has no server to inject it
    "firmware/vorlaut/texts.h",       # holds the German device labels
    "tests/german.py",                # the word lists themselves
    "tests/test_language.py",         # this file - it quotes them
}

SKIP_SUFFIX = {".png", ".svg", ".json", ".bin", ".stl", ".ico"}
# static/vendor/ is somebody else's code, kept as built copies with their
# provenance in a VENDORED.md beside them. English-in-the-code is a rule about
# what we write; a vendored package agreed to none of our rules, and the German
# in it is a default the host is meant to translate rather than a string that
# escaped review. Editing it would be edited over on the next refresh anyway.
SKIP_PREFIX = ("content/", "example/symbols/", "static/vendor/")


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT,
                         capture_output=True, text=True, check=True)
    return out.stdout.split()


def main() -> int:
    findings: list[tuple[str, int, str, str]] = []
    checked = 0
    for name in tracked_files():
        if (name in GERMAN_BY_DESIGN or name.startswith(SKIP_PREFIX)
                or Path(name).suffix in SKIP_SUFFIX):
            continue
        try:
            text = (ROOT / name).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        checked += 1
        for number, line, why in german.findings(Path(name), text):
            findings.append((name, number, line, why))

    if findings:
        for name, number, line, why in findings[:40]:
            print(f"  {name}:{number}: {line[:78]}")
            print(f"      {why}")
        if len(findings) > 40:
            print(f"  ... and {len(findings) - 40} more")
        print(f"\n  {len(findings)} German line(s) where English belongs")
        return 1

    print(f"  {checked} files checked, {len(GERMAN_BY_DESIGN)} German on "
          f"purpose, {len(german.ALLOWED)} quoted examples allowed")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
