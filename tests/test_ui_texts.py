#!/usr/bin/env python3
"""Checks that the languages in texts.py stay in step, and that nothing is left
outside the table.

Three things go wrong with a table like this, and none of them show until
somebody switches language and looks at the right screen:

  * A key exists in one language and not in the other.
  * A translation lost a placeholder, so {max} shows up literally - or gained
    one that nobody fills in.
  * A string was added to app.py directly and never made it into the table.

The last one is the one that keeps happening, so it is checked against the
real file rather than trusted.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import app  # noqa: E402
import build  # noqa: E402
import texts  # noqa: E402

PLACEHOLDER = re.compile(r"\{(\w+)\}")

# The page is served in one language at a time; these are the only words in it
# that belong to no language. Everything else has to come from the table.
ALLOWED = {"vorlaut", "ARASAAC", "METACOM", "SET", "KEY"}


def check_keys() -> int:
    failures = 0
    base = set(texts.TEXTS[texts.DEFAULT])
    for lang, table in texts.TEXTS.items():
        for missing in sorted(base - set(table)):
            print(f"  FAIL  {lang} is missing {missing}")
            failures += 1
        for extra in sorted(set(table) - base):
            print(f"  FAIL  {lang} has {extra}, which {texts.DEFAULT} does not")
            failures += 1
    return failures


def check_placeholders() -> int:
    failures = 0
    for key, value in texts.TEXTS[texts.DEFAULT].items():
        want = set(PLACEHOLDER.findall(value))
        for lang, table in texts.TEXTS.items():
            if key not in table:
                continue
            got = set(PLACEHOLDER.findall(table[key]))
            if got != want:
                print(f"  FAIL  {lang} {key}: placeholders {sorted(got)}, "
                      f"{texts.DEFAULT} has {sorted(want)}")
                failures += 1
    return failures


# The places in the page that put words in front of somebody. A literal here
# instead of a t() call is a string that will never be translated.
SHOWS_TEXT = re.compile(
    r"""(?:\.textContent|\.title|\.placeholder|\.innerHTML)\s*=\s*(["'])"""
    r"""|(?:status|confirm|alert|say)\(\s*(["'])""")

LITERAL = re.compile(r"""^(["'])((?:\\.|(?!\1)[^\\])*)\1""")


def harmless(rest: str) -> bool:
    """A literal with no words in it - markup, an escaped glyph, "".

    The drag handle is written "\\u283F" and the placeholder tiles are built
    from HTML; neither belongs in a translation table.
    """
    match = LITERAL.match(rest.lstrip())
    if not match:
        return True                      # not a plain literal - a t() call
    body = re.sub(r"\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\\.", "", match.group(2))
    if body.lstrip().startswith("<"):
        return True                      # markup, filled in separately
    return not re.search(r"[A-Za-zÄÖÜäöüß]", body)


def check_no_leftovers() -> int:
    """Nothing may say words to the user from outside the table.

    Two passes, because either alone misses things. Umlauts catch German that
    was never keyed; the second pass catches a label that happens to have no
    umlaut in it - "Set deleted" would sail straight through the first.
    """
    # Both files. The interface moved to ui.html, and that is where nearly
    # every string a user reads now lives - scanning app.py alone would let
    # this check pass while looking at none of the page.
    watched = []
    for name in ("app.py", "ui.html"):
        text = (ROOT / name).read_text(encoding="utf-8")
        watched += [(name, n, l)
                    for n, l in enumerate(text.split("\n"), start=1)]
    failures = 0
    for name, number, line in watched:
        stripped = line.strip()
        # The transliteration table in slugify is data, not a message.
        if "replacement" in line:
            continue
        if re.search(r"[äöüßÄÖÜ]", line):
            print(f"  FAIL  {name}:{number} still holds German: {stripped[:60]}")
            failures += 1
            continue
        match = SHOWS_TEXT.search(line)
        if match and not harmless(line[match.end() - 1:]):
            print(f"  FAIL  {name}:{number} shows a literal instead of a "
                  f"key: {stripped[:60]}")
            failures += 1
    return failures


def check_page_renders() -> int:
    """The page has to come out complete in every language, and stay valid JS."""
    failures = 0
    for lang in sorted(texts.TEXTS):
        page = (app.read_ui()
                .replace("__LANG__", lang)
                .replace("__TEXTS__", json.dumps(texts.ui_texts(lang),
                                                 ensure_ascii=False))
                .replace("__LANGUAGES__", json.dumps(sorted(texts.TEXTS)))
                .replace("__PALETTE__", json.dumps(build.DEFAULT_PALETTE))
                .replace("__LIMITS__", json.dumps({"maxSets": build.MAX_SETS,
                                                   "maxActive": build.MAX_ACTIVE_SETS})))
        if "__" in re.sub(r"__[a-z]", "", page):
            leftover = [m for m in re.findall(r"__[A-Z_]+__", page)]
            if leftover:
                print(f"  FAIL  {lang}: placeholders left in the page: {leftover}")
                failures += 1

        # Every key the JS asks for has to exist in what was handed over.
        script = re.search(r"<script>(.*)</script>", page, re.S).group(1)
        handed = texts.ui_texts(lang)
        for key in sorted(set(re.findall(r't\("(ui\.[\w.]+)"', script))):
            if key not in handed:
                print(f"  FAIL  {lang}: the page asks for {key}, which is not "
                      f"in the table")
                failures += 1

        # Whether the page is still valid JavaScript. Only if node is around:
        # it is not a dependency of this project, and everything else in this
        # file is worth running without it.
        if shutil.which("node"):
            with tempfile.NamedTemporaryFile("w", suffix=".js",
                                             delete=False) as tmp:
                tmp.write(script)
                name = tmp.name
            result = subprocess.run(["node", "--check", name],
                                    capture_output=True, text=True)
            Path(name).unlink()
            if result.returncode != 0:
                print(f"  FAIL  {lang}: the page is not valid JavaScript\n"
                      f"{result.stderr}")
                failures += 1
    return failures


def check_cli_stays_english() -> int:
    """A build error reads English on the command line, whatever the layout says."""
    failures = 0
    try:
        raise build.BuildError("build.err.too_many_sets", max=25, found=30)
    except build.BuildError as exc:
        if re.search(r"[äöüßÄÖÜ]", str(exc)):
            print(f"  FAIL  str(BuildError) is not English: {exc}")
            failures += 1
        if not re.search(r"[äöüß]", exc.message("de")):
            print(f"  FAIL  BuildError.message('de') is not German: "
                  f"{exc.message('de')}")
            failures += 1
    return failures


def main() -> int:
    failures = (check_keys() + check_placeholders() + check_no_leftovers()
                + check_page_renders() + check_cli_stays_english())
    if failures:
        print(f"\n  {failures} problem(s)")
        return 1
    print(f"  {len(texts.TEXTS[texts.DEFAULT])} keys in "
          f"{len(texts.TEXTS)} languages, in step")
    print(f"  the page renders in {', '.join(sorted(texts.TEXTS))} and asks "
          f"for no key that is missing")
    print("  the command line stays English, the interface does not")
    if not shutil.which("node"):
        print("  (node is not here, so the page was not syntax-checked)")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
