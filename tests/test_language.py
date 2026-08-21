#!/usr/bin/env python3
"""Finds German that is left where English belongs.

This exists because the checks before it did not work. They looked for
umlauts, and most German has none in it:

    // [M] wie weit die Kappe vor der Front steht

Not one umlaut, and a whole file passed as translated on the strength of it.
So this one counts function words instead - two on a line is German, and no
English sentence collects two of them by accident.

Three files are German on purpose and are skipped whole: the README as the way
into the project, and the two tables that hold the German translations.
Everything else is checked, including the shell scripts and the Compose file -
they are read while somebody is setting the thing up, which is the same
readership as the code.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# German on purpose.
GERMAN_BY_DESIGN = {
    "README.md",                      # the way into the project
    "texts.py",                       # holds the German interface texts
    "firmware/vorlaut/texts.h",       # holds the German device labels
}

SKIP_SUFFIX = {".png", ".svg", ".json", ".bin", ".stl", ".ico"}
SKIP_PREFIX = ("content/", "example/symbols/")

# Function words that are German and do not occur in English. Two on one line
# is prose, not a coincidence.
GERMAN = re.compile(
    r"\b(der|die|das|dem|den|des|und|oder|nicht|kein|keine|eine|einen|einem|"
    r"eines|ist|sind|wird|werden|kann|muss|soll|sollte|darf|damit|dann|wenn|"
    r"weil|aber|auch|noch|schon|nur|hier|dort|steht|liegt|gibt|macht|sich|"
    r"vom|zum|zur|mit|bei|aus|fuer|für|durch|gegen|ohne|nach|hinter|zwischen|"
    r"Gerät|Geraet|Datei|Ordner|Rechner|beim|einer|ihre|seine|diese|dieser)\b",
    re.I)
UMLAUT = re.compile(r"[äöüßÄÖÜ]")

# Lines that look German but are not - a quoted example, a character table, a
# regular expression. Matched as a substring, so each entry says exactly what
# it forgives.
ALLOWED = [
    # Transliteration tables: data, not prose.
    ('("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")', "the umlaut table"),
    # English prose quoting a German word as its example.
    ('"Fuß" and "fuss"', "an example in a docstring"),
    ('("wut" in "wütend")', "an example in a comment"),
    ('for "ü", so the', "explains the encoding bug"),
    ('"zurück" came out as "zur├╝ck"', "explains the encoding bug"),
    ('says "zurück" would be', "explains why one setting, not two"),
    ("`ä ö ü ß é à ñ ç`", "which letters the font has"),
    # Test data that is German on purpose.
    ("Ein sehr langer Name", "a name with umlauts, to test the encoding"),
    # Regular expressions that match German.
    ('re.search(r"[äöüßÄÖÜ]"', "a check for German"),
    ('re.search(r"[äöüß]"', "a check for German"),
    ('r"[A-Za-zÄÖÜäöüß]"', "a check for letters"),
]


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT,
                         capture_output=True, text=True, check=True)
    return out.stdout.split()


def main() -> int:
    findings: list[tuple[str, int, str]] = []
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
        for number, line in enumerate(text.split("\n"), start=1):
            if not (len(GERMAN.findall(line)) >= 2 or UMLAUT.search(line)):
                continue
            if any(fragment in line for fragment, _ in ALLOWED):
                continue
            findings.append((name, number, line.strip()))

    if findings:
        for name, number, line in findings[:40]:
            print(f"  {name}:{number}: {line[:88]}")
        if len(findings) > 40:
            print(f"  ... and {len(findings) - 40} more")
        print(f"\n  {len(findings)} German line(s) where English belongs")
        return 1

    print(f"  {checked} files checked, {len(GERMAN_BY_DESIGN)} German on "
          f"purpose, {len(ALLOWED)} quoted examples allowed")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
