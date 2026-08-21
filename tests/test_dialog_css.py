#!/usr/bin/env python3
"""Checks that no stylesheet rule displays a dialog the browser has closed.

A <dialog> is hidden by the browser's own stylesheet, with a rule that reads
dialog:not([open]) { display: none }. That rule lives in the user agent
stylesheet, which loses against anything written here - so an unqualified

    dialog.sheet { display: flex; }

quietly takes the hiding away. The dialog is then in the page from the moment
it loads: not centred and not on top, but in normal flow, which for these two
means underneath everything else at the very bottom. Closing it takes the open
attribute off and changes nothing on the screen, because the display never
depended on the attribute in the first place.

That is what happened to the settings sheet when it was given a scrolling
body: the flex column it needed for that also displayed it while it was shut.
Nothing about it looks wrong in the file, which is why it is checked here.

Only the dialog itself is the subject. Rules for things inside one - the head,
the foot, the scrolling body - are free to set display however they like,
since a closed dialog hides its children with it.

The rules are read from static/*.css and from any <style> left in ui.html -
see stylesheet(). Both halves of the input are checked for being empty, so
that a stylesheet this can no longer find fails instead of passing.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import app  # noqa: E402

COMMENT = re.compile(r"/\*.*?\*/", re.S)
# The innermost blocks only: neither capture can cross a brace, so the prelude
# of an @media is left behind and the rules inside it are still seen.
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
DECLARES_DISPLAY = re.compile(r"(?:^|;)\s*display\s*:", re.M)


def stylesheet() -> str:
    """Every rule the page carries, from wherever the page now keeps them.

    This used to pull the CSS out of the served page with a regex over
    <style>...</style>. When the stylesheet moved to static/ui.css that regex
    matched nothing, and this test went on checking zero rules and printing
    "All good" - the settings-dialog bug it exists to catch would have come
    back with the suite still green.

    So it follows the files instead of naming them: every .css in static/,
    plus anything still inline in ui.html. Add a second stylesheet and it is
    checked without this line being touched. check_dialogs_stay_closed()
    refuses to pass on an empty result, which is what makes the difference
    between finding no problems and finding nothing.
    """
    parts = [path.read_text(encoding="utf-8")
             for path in sorted(app.STATIC.glob("*.css"))]
    parts += re.findall(r"<style>(.*?)</style>", app.read_ui(), re.S)
    return "\n".join(parts)


def dialog_handles() -> tuple[set[str], set[str]]:
    """The ids and classes that name a <dialog> in the markup."""
    ids, classes = set(), set()
    for attributes in re.findall(r"<dialog\b([^>]*)>", app.read_ui()):
        found = re.search(r'\bid="([^"]+)"', attributes)
        if found:
            ids.add(found.group(1))
        found = re.search(r'\bclass="([^"]+)"', attributes)
        if found:
            classes.update(found.group(1).split())
    return ids, classes


def names_a_dialog(compound: str, ids: set[str], classes: set[str]) -> bool:
    if re.match(r"^dialog\b", compound):
        return True
    if set(re.findall(r"#([\w-]+)", compound)) & ids:
        return True
    return bool(set(re.findall(r"\.([\w-]+)", compound)) & classes)


def check_dialogs_stay_closed() -> int:
    ids, classes = dialog_handles()
    if not ids:
        print("  FAIL  no <dialog> found in the page at all")
        return 1

    rules = RULE.findall(COMMENT.sub("", stylesheet()))
    # The same guard as the one above, for the other half of the input. A
    # stylesheet this cannot find is not a stylesheet without problems, and
    # the two are indistinguishable from the exit code alone.
    if not rules:
        print("  FAIL  no CSS rule found at all - stylesheet() is looking in "
              "the wrong place, not the page in the clear")
        return 1

    failures = 0
    for selectors, body in rules:
        if not DECLARES_DISPLAY.search(body):
            continue
        for selector in selectors.split(","):
            selector = selector.strip()
            if not selector or selector.startswith("@"):
                continue
            # What the rule is actually about is its last compound; anything
            # before that is an ancestor, and ::backdrop is not the dialog.
            subject = re.split(r"\s+|(?<=[\w\])])\s*[>+~]\s*", selector)[-1]
            subject = re.sub(r"::[\w-]+$", "", subject)
            if not names_a_dialog(subject, ids, classes):
                continue
            if "[open]" not in subject:
                print(f"  FAIL  {selector} sets display without asking for "
                      f"[open], so a closed dialog stays on the page")
                failures += 1
    return failures


def main() -> int:
    failures = check_dialogs_stay_closed()
    if failures:
        print(f"\n  {failures} problem(s)")
        return 1
    ids, classes = dialog_handles()
    rules = RULE.findall(COMMENT.sub("", stylesheet()))
    print(f"  {len(ids)} dialog(s) in the page: "
          f"{', '.join('#' + name for name in sorted(ids))}")
    # The rule count is printed so that a run which found nothing to look at
    # says so on its face, rather than only in the exit code.
    print(f"  {len(rules)} rule(s) read from "
          f"{', '.join(p.name for p in sorted(app.STATIC.glob('*.css')))}"
          f" and ui.html")
    print("  none of them is displayed by a rule that does not ask for [open]")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
