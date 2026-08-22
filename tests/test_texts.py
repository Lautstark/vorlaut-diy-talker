#!/usr/bin/env python3
"""Checks that every menu label actually fits on a display, and is drawable.

Two things can go wrong with a translation, and both stay invisible until a
device is standing on the table:

  * The word is too long. Text size 2 is 12 pixels per character and a display
    is 128 wide, so from the tenth character on it is drawn past the edge.
  * The word contains a letter the built-in font does not have. Code page 437
    covers the western European accents, but not the Polish, Turkish or
    Cyrillic ones - those would come out as a question mark.

So this compiles panel_text.h and texts.h with the same code the firmware
uses and checks what the panel would really receive.
"""

from __future__ import annotations

import subprocess
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def language_codes() -> dict[str, int]:
    """Which language rides in which byte, read out of the browser's writer.

    This used to come from layout.py, which no longer exists: the app is the
    static site now. src/data/layout_format.ts is the writer that puts the byte
    into layout.bin, so it is the right thing for the firmware's own table to
    be held against - and reading it as text rather than restating it here
    keeps the two from agreeing only with this file.
    """
    source = (ROOT / "src" / "data" / "layout_format.ts").read_text(encoding="utf-8")
    found = re.search(r"export const LANGUAGE_CODES = (\{[^}]*\});", source)
    if not found:
        raise SystemExit("src/data/layout_format.ts has no LANGUAGE_CODES - "
                         "it is what says which byte a language is")
    # `{ en: 0, de: 1 }` is not JSON until its keys are quoted.
    return json.loads(re.sub(r"(\w+):", r'"\1":', found.group(1)))


LANGUAGE_CODES = language_codes()


def dump() -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        binary = Path(tmp) / "texts_dump"
        result = subprocess.run(
            ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
             "-o", str(binary), str(ROOT / "tests" / "texts_dump.cpp")],
            capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit("texts_dump does not compile:\n" + result.stderr)
        return subprocess.run([str(binary)], capture_output=True,
                              text=True, check=True).stdout.strip().split("\n")


def main() -> int:
    lines = dump()
    limit = int(next(l for l in lines if l.startswith("max ")).split()[1])
    languages = int(next(l for l in lines if l.startswith("count ")).split()[1])
    entries = [l.split(" ", 4) for l in lines if l[0].isdigit()]

    failures = 0
    for lang, field, glyphs, hexed, value in entries:
        glyphs = int(glyphs)
        raw = bytes.fromhex(hexed)

        if glyphs > limit:
            print(f"  FAIL  language {lang} {field}: {value!r} is {glyphs} "
                  f"characters, at most {limit} fit")
            failures += 1
        if len(raw) != glyphs:
            print(f"  FAIL  language {lang} {field}: {len(raw)} bytes for "
                  f"{glyphs} glyphs - the conversion lost track")
            failures += 1
        if b"?" in raw and "?" not in value:
            missing = [c for c in value if ord(c) > 0x7F]
            print(f"  FAIL  language {lang} {field}: {value!r} needs "
                  f"{missing}, which the font does not have")
            failures += 1

    # Every field of the struct has to be in the dump. The list there is
    # written by hand, and a label that nobody dumps is a label that nobody
    # checks - a translation could be too long or undrawable and still pass.
    fields = int(next(l for l in lines if l.startswith("fields ")).split()[1])
    dumped = len(entries) // max(languages, 1)
    if dumped != fields:
        print(f"  FAIL  texts.h has {fields} labels, texts_dump.cpp prints "
              f"{dumped} - the missing ones are not checked at all")
        failures += 1

    # The two tables have to agree on how many languages there are - the file
    # carries an index into one of them and is written by the other.
    if languages != len(LANGUAGE_CODES):
        print(f"  FAIL  texts.h knows {languages} languages, layout.py "
              f"{len(LANGUAGE_CODES)}")
        failures += 1
    for name, code in LANGUAGE_CODES.items():
        if code >= languages:
            print(f"  FAIL  layout.py maps {name!r} to {code}, and texts.h "
                  f"has no table for it")
            failures += 1

    if failures:
        print(f"\n  {failures} problem(s)")
        return 1
    print(f"  {len(entries)} labels in {languages} languages, "
          f"all within {limit} characters and drawable")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
