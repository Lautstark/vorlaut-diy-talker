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

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))
import german  # noqa: E402
import app  # noqa: E402
import texts  # noqa: E402
from buildbase import BuildError  # noqa: E402

PLACEHOLDER = re.compile(r"\{(\w+)\}")


# Modules that live in static/ without ui.html ever loading them.
#
# All of them are the same thing and all of them are meant to be temporary:
# the app is being turned into a static site, and the browser halves of what
# the server does today are landing one at a time, ahead of the page that will
# import them. None of it is unreachable code - each entry names the test that
# runs it against the Python it was ported from - it is code whose page has
# not arrived. An entry comes off this list the moment main.js reaches it.
#
# This was two lists a moment ago, NOT_ON_THE_PAGE and NOT_LOADED_YET, one per
# module, written by two people who each needed the same exception and neither
# of whom could see the other's. A third would have made it three. The value
# is the test that runs the module instead.
NOT_ON_THE_PAGE = {
    "tiles.js": "tests/test_tile_render_js.py",
    "layout_format.js": "tests/test_layout_format.py",
    # The speech pipeline: level.js is the browser's ffmpeg and speak.js is
    # its piper and its Azure. They sit in a folder of their own because there
    # are three of them with voices.json, which is the one file here meant to
    # be copied into mitreden rather than kept twice.
    "tts/level.js": "tests/test_browser_tts.py",
    "tts/speak.js": "tests/test_browser_tts.py",
}


def scripts() -> list[Path]:
    """Every JavaScript module under static/, however deep.

    rglob rather than glob, which is a fix and not a tidy-up: this used to
    look only at the top level, so a module in a subfolder was not checked for
    being valid JavaScript, not checked for being reachable, and not checked
    for asking after a text that does not exist. It was exempt from all of it
    by being one directory down, and nothing said so.
    """
    return sorted(app.STATIC.rglob("*.js"))


def module_name(path: Path) -> str:
    """How a module is referred to here: its path under static/, not its bare
    name. Two folders could hold a level.js one day, and one of them being
    silently taken for the other is the failure this whole check is about."""
    return path.relative_to(app.STATIC).as_posix()


def frontend_sources() -> list[Path]:
    """Everything that can put a word in front of somebody.

    Named by shape rather than one by one. This used to be the literal list
    ("app.py", "ui.html"), with a comment saying that scanning app.py alone
    would let the check pass while looking at none of the page - which came
    true about ui.html the moment the script moved into static/. A glob cannot
    go stale that way: a module added tomorrow is scanned tomorrow.

    check_no_leftovers() refuses to run on a short list, so a glob that stops
    matching fails rather than quietly narrowing what is looked at.
    """
    return [ROOT / "app.py", ROOT / "ui.html",
            *sorted(app.STATIC.glob("*.css")), *scripts()]

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

    Two passes, because either alone misses things. The first is German left
    in the front end, recognised by tests/german.py rather than by a look for
    umlauts - most German has none, which is how a half-translated comment sat
    in ui.css for a whole release. The second catches a label that is not
    German at all but is still a literal - "Set deleted" is English and still
    a string that will never be translated.
    """
    sources = frontend_sources()
    # The page is a stylesheet and a dozen modules; anything close to none of
    # them means the glob is looking somewhere the front end no longer is.
    # Without this the check would still pass, having read almost nothing.
    if len(scripts()) < 2:
        print(f"  FAIL  only {len(scripts())} script(s) found in "
              f"{app.STATIC} - the scan is looking in the wrong place")
        return 1

    failures = 0
    for path in sources:
        text = path.read_text(encoding="utf-8")
        german_lines = {n for n, _, _ in german.findings(path, text)}
        for number, line in enumerate(text.split("\n"), start=1):
            stripped = line.strip()
            if number in german_lines:
                print(f"  FAIL  {path.name}:{number} still holds German: "
                      f"{stripped[:60]}")
                failures += 1
                continue
            match = SHOWS_TEXT.search(line)
            if match and not harmless(line[match.end() - 1:]):
                print(f"  FAIL  {path.name}:{number} shows a literal instead "
                      f"of a key: {stripped[:60]}")
                failures += 1
    return failures


def check_page_renders() -> int:
    """The page has to come out complete in every language.

    What the page needs from the server now arrives as one JSON block rather
    than as five substitutions into live script, so this asks app.bootstrap()
    for it and reads it back the way static/boot.js does.
    """
    failures = 0
    served = app.read_ui().replace("__BOOTSTRAP__", app.bootstrap(texts.DEFAULT))
    leftover = re.findall(r"__[A-Z_]+__", served)
    if leftover:
        print(f"  FAIL  placeholders left in the page: {leftover}")
        failures += 1

    # Every key the modules ask for has to exist in what was handed over.
    # Read from the files rather than out of the page: the script is no longer
    # in it, and a regex over <script> would find nothing and check nothing.
    asked = set()
    for path in scripts():
        asked |= set(re.findall(r't\("(ui\.[\w.]+)"',
                                path.read_text(encoding="utf-8")))
    if not asked:
        print("  FAIL  no t() call found in any module - the scan is looking "
              "in the wrong place")
        return failures + 1

    for lang in sorted(texts.TEXTS):
        handed = json.loads(app.bootstrap(lang).replace("\\u003c", "<"))
        if handed["lang"] != lang:
            print(f"  FAIL  {lang}: the bootstrap block says "
                  f"{handed['lang']!r}")
            failures += 1
        for key in sorted(asked):
            if key not in handed["texts"]:
                print(f"  FAIL  {lang}: the page asks for {key}, which is not "
                      f"in the table")
                failures += 1
    return failures


def check_bootstrap_cannot_escape() -> int:
    """A text holding </script> must not be able to end the block early.

    json.dumps does not escape it, and the five holes this replaced fed
    straight into live script.

    The hostile value is put through the real bootstrap(), because no text in
    texts.py contains a < today: checking the payload as it stands would pass
    just as happily with the escaping deleted, which is the failure this whole
    task was about. The table is swapped for one sentence and put back.
    """
    hostile = "</script><script>alert(1)</script>"
    original = texts.ui_texts

    def poisoned(lang):
        table = dict(original(lang))
        table["ui.close"] = hostile
        return table

    texts.ui_texts = poisoned
    try:
        payload = app.bootstrap(texts.DEFAULT)
    finally:
        texts.ui_texts = original

    if "<" in payload:
        where = payload.index("<")
        print(f"  FAIL  a text holding </script> reaches the page with a raw "
              f"<, so it can close the block: "
              f"{payload[max(0, where - 20):where + 40]!r}")
        return 1
    # Escaped, and still the same sentence: \\u003c is a < to any JSON reader,
    # so this is an escape rather than a rejection.
    if json.loads(payload)["texts"]["ui.close"] != hostile:
        print("  FAIL  escaping < changed what the value says")
        return 1
    return 0


def check_modules_are_valid_js() -> int:
    """Every module has to parse, as a module.

    Only if node is around: it is not a dependency of this project, and
    everything else in this file is worth running without it.

    Checked one file at a time now, and as .mjs - `import` at the top of a
    plain .js is not something `node --check` will accept.
    """
    if not shutil.which("node"):
        return 0
    failures = 0
    for path in scripts():
        with tempfile.NamedTemporaryFile("w", suffix=".mjs",
                                         delete=False) as tmp:
            tmp.write(path.read_text(encoding="utf-8"))
            name = tmp.name
        result = subprocess.run(["node", "--check", name],
                                capture_output=True, text=True)
        Path(name).unlink()
        if result.returncode != 0:
            print(f"  FAIL  {module_name(path)} is not valid JavaScript\n"
                  f"{result.stderr}")
            failures += 1
    return failures


def check_every_module_is_reachable() -> int:
    """No module may sit in static/ without the page ever loading it.

    ui.html names main.js and nothing else; everything else arrives because
    something imports it. A file that nothing imports is dead code that looks
    exactly like working code - and, the other way round, a typo in an import
    path is a module that silently never loads. The browser shows that as a
    button that does nothing, which no test above would notice.

    NOT_ON_THE_PAGE is the one deliberate exception, and it is checked too:
    the loop below fails if a name on that list is not a file any more, so
    the exception cannot outlive the module it was written for.
    """
    imported = {"main.js"} | set(NOT_ON_THE_PAGE)
    for path in scripts():
        # Resolved against the importing file rather than taken as a name:
        # "./level.js" in static/tts/speak.js is static/tts/level.js, and in a
        # flat reading it would have been a top-level level.js that is not
        # there - or, worse, one that is and is a different file.
        for target in re.findall(r'from\s+"(\.\.?/[\w./-]+\.js)"',
                                 path.read_text(encoding="utf-8")):
            resolved = (path.parent / target).resolve()
            try:
                imported.add(resolved.relative_to(app.STATIC).as_posix())
            except ValueError:
                print(f"  FAIL  {module_name(path)} imports {target}, which is "
                      f"outside static/")
    failures = 0
    for path in scripts():
        if module_name(path) not in imported:
            print(f"  FAIL  nothing imports {module_name(path)}, so the page never "
                  f"loads it")
            failures += 1
    for name in sorted(imported):
        if not (app.STATIC / name).is_file():
            print(f"  FAIL  something imports {name}, which is not in "
                  f"{app.STATIC}")
            failures += 1
    return failures


def check_cli_stays_english() -> int:
    """A build error reads English on the command line, whatever the layout says."""
    failures = 0
    try:
        raise BuildError("build.err.too_many_sets", max=25, found=30)
    except BuildError as exc:
        if german.looks_german(str(exc)):
            print(f"  FAIL  str(BuildError) is not English: {exc}")
            failures += 1
        if not german.looks_german(exc.message("de")):
            print(f"  FAIL  BuildError.message('de') is not German: "
                  f"{exc.message('de')}")
            failures += 1
    return failures


def main() -> int:
    failures = (check_keys() + check_placeholders() + check_no_leftovers()
                + check_page_renders() + check_bootstrap_cannot_escape()
                + check_modules_are_valid_js()
                + check_every_module_is_reachable()
                + check_cli_stays_english())
    if failures:
        print(f"\n  {failures} problem(s)")
        return 1
    print(f"  {len(texts.TEXTS[texts.DEFAULT])} keys in "
          f"{len(texts.TEXTS)} languages, in step")
    print(f"  the page renders in {', '.join(sorted(texts.TEXTS))} and asks "
          f"for no key that is missing")
    # Counted out loud: a run that scanned nothing would otherwise look
    # exactly like a run that found nothing wrong.
    print(f"  {len(frontend_sources())} front-end file(s) scanned, "
          f"{len(scripts())} of them modules, and every one of them reached "
          f"from main.js"
          + (f" except {', '.join(sorted(NOT_ON_THE_PAGE))}, which the "
             f"static-site rewrite has not wired up yet"
             if NOT_ON_THE_PAGE else ""))
    print("  the bootstrap block cannot be closed by anything inside it")
    print("  the command line stays English, the interface does not")
    if not shutil.which("node"):
        print("  (node is not here, so the page was not syntax-checked)")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
