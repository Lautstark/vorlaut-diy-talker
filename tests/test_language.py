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
    "firmware/vorlaut/texts.h",       # holds the German device labels
    "tests/german.py",                # the word lists themselves
    "tests/test_language.py",         # this file - it quotes them
}

# Not translated yet - which is not the same thing as German on purpose.
# These three are supposed to be English and are not. case/ is the enclosure:
# an OpenSCAD model and the two scripts that check it, and it was never part
# of the translation pass. Its German is not prose to be swapped word for
# word, it is dimension talk - Falz, Freistiche, Domkante, Drucklage - where
# the wrong word puts a wrong number into a part somebody prints.
#
# They are listed rather than skipped quietly, so that the sweep is green
# without claiming they are clean: the debt is printed on every run, and a
# file that has been translated has to come off this list or the run fails.
# The list can only shrink.
NOT_TRANSLATED_YET = {
    "case/vorlaut-case.scad",
    "case/verify.py",
    "case/check-stl.py",
}

SKIP_SUFFIX = {".png", ".svg", ".json", ".bin", ".stl", ".ico"}
SKIP_PREFIX = ("content/", "example/symbols/")


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT,
                         capture_output=True, text=True, check=True)
    return out.stdout.split()


def main() -> int:
    findings: list[tuple[str, int, str, str]] = []
    debt: dict[str, int] = {}
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
        found = german.findings(Path(name), text)
        if name in NOT_TRANSLATED_YET:
            debt[name] = len(found)
            continue
        for number, line, why in found:
            findings.append((name, number, line, why))

    # A file on the list that has come clean has to come off it, or the list
    # outlives the debt and starts hiding German again.
    for name in sorted(NOT_TRANSLATED_YET):
        if debt.get(name) == 0:
            print(f"  {name} has no German left - take it out of "
                  f"NOT_TRANSLATED_YET")
            return 1

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
    if debt:
        total = sum(debt.values())
        print(f"  {total} German line(s) still owed in {len(debt)} file(s) "
              f"not yet translated:")
        for name in sorted(debt):
            print(f"      {debt[name]:3}  {name}")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
