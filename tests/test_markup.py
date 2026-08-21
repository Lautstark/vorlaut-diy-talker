#!/usr/bin/env python3
"""Checks that no module builds markup out of values it did not write itself.

Assigning a composed string to .innerHTML hands whatever is in that string to
the HTML parser. When part of it comes from layout.json - a set colour, a
symbol file name - the file decides what tags the page gets:

    tab.innerHTML = '<span class="dot" style="background:' + entry.color + '"></span>';

The same job done safely is one line longer and was already sitting directly
above that one (tab.style.borderColor = entry.color), and picker.js says in a
comment why its captions use textContent. So the codebase knew; it just had no
way of noticing where it had stopped doing it. Both of those sites survived
being lifted out of app.py and then split into static/ modules, because a
refactor moves lines without reading them.

Hence this file. The rule is narrow on purpose: .innerHTML may be assigned a
plain string literal and nothing else. Clearing an element with

    box.innerHTML = "";

is the common case here and stays fine, as does a fixed piece of markup with
no values in it - what is banned is composition, whether by +, by a template
substitution, or by handing over a bare variable.

Only .innerHTML is looked at. insertAdjacentHTML, outerHTML and document.write
have the same hole in them and none of them appear in this project; if one
turns up, it belongs in HANDS_OVER_MARKUP rather than in a second test file.

scripts() refuses to run on a short list and check_no_composed_markup() refuses
to pass having found no .innerHTML at all, so a scan that stops finding the
front end fails instead of reporting a clean page it never read - the way
tests/test_ui_texts.py guards the same glob.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import app  # noqa: E402

# The property this is about. A second one would be added here.
HANDS_OVER_MARKUP = ("innerHTML",)

# `.innerHTML =` or `.innerHTML +=`, and neither `==` nor `!=`.
ASSIGN = re.compile(r"\.(" + "|".join(HANDS_OVER_MARKUP) + r")\s*(\+?)=(?!=)")

STRING = re.compile(r"""^(["'])(?:\\.|(?!\1)[^\\])*\1""", re.S)
TEMPLATE = re.compile(r"^`(?:\\.|[^\\`])*`", re.S)

# Where a / starts a regular expression rather than a division. Used only to
# keep the masker below from reading a regex as code; getting it wrong costs
# accuracy in this file, not in the page.
REGEX_FOLLOWS = set("(,=:[!&|?{};+-*%~^") | {""}

# Uses of .innerHTML that compose and have to, each with the reason it has to.
# Matched as a substring of the offending line, the way tests/test_language.py
# forgives its German - an entry says what it forgives and nothing wider.
#
# Empty, and that is the finding: every site in the front end today either
# clears an element or writes a fixed literal. An entry here should be an
# argument, not a way to make this file quiet.
ALLOWED: list[tuple[str, str]] = []

failures: list[str] = []
composed = False        # a real composition was found, not just a broken scan


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def scripts() -> list[Path]:
    """Every JavaScript module the page loads."""
    return sorted(app.STATIC.glob("*.js"))


def masked(text: str) -> str:
    """The same source, character for character, with the inside of every
    comment and every literal replaced by spaces.

    Line and column numbers therefore still line up with the real file, while
    a `;` inside a string or the word innerHTML inside a comment - picker.js
    has one - can no longer be mistaken for code.
    """
    out = list(text)
    end = len(text)
    previous = ""                        # last significant character in code

    def blank(start: int, stop: int) -> None:
        for index in range(start, min(stop, end)):
            if out[index] != "\n":
                out[index] = " "

    index = 0
    while index < end:
        char = text[index]
        pair = text[index:index + 2]
        if pair == "//":
            stop = text.find("\n", index)
            stop = end if stop < 0 else stop
            blank(index, stop)
            index = stop
        elif pair == "/*":
            stop = text.find("*/", index + 2)
            stop = end if stop < 0 else stop + 2
            blank(index, stop)
            index = stop
        elif char == "/" and previous in REGEX_FOLLOWS:
            stop, in_class = index + 1, False
            while stop < end:
                here = text[stop]
                if here == "\\":
                    stop += 2
                    continue
                if here == "[":
                    in_class = True
                elif here == "]":
                    in_class = False
                elif here == "\n" or (here == "/" and not in_class):
                    break
                stop += 1
            blank(index + 1, stop)       # the delimiters stay
            index, previous = stop + 1, "/"
        elif char in "\"'`":
            stop = index + 1
            while stop < end:
                here = text[stop]
                if here == "\\":
                    stop += 2
                    continue
                if here == char or (here == "\n" and char != "`"):
                    break
                stop += 1
            blank(index + 1, stop)       # the delimiters stay
            index, previous = stop + 1, char
        else:
            if not char.isspace():
                previous = char
            index += 1
    return "".join(out)


def why_composed(right: str) -> str | None:
    """What is wrong with this right-hand side, or None if it is a literal."""
    rest = right.strip()
    if not rest:
        return "nothing is assigned"
    if rest[0] == "`":
        found = TEMPLATE.match(rest)
        if not found:
            return "an unterminated template literal"
        if "${" in found.group(0):
            return "a template literal with a substitution in it"
        trailing = rest[found.end():].strip()
        return None if not trailing else f"a template literal joined to {trailing[:32]}"
    if rest[0] in "\"'":
        found = STRING.match(rest)
        if not found:
            return "an unterminated string"
        trailing = rest[found.end():].strip()
        return None if not trailing else f"a literal joined to {trailing[:32]}"
    return f"an expression, not a literal: {rest[:48]}"


def sites(path: str, text: str) -> tuple[int, list[str]]:
    """Every assignment to .innerHTML in one module, and what is wrong with it.

    The statement is read from the real text but delimited using the masked
    copy, so it ends at a `;` that is actually a `;` and may run over as many
    lines as it likes.
    """
    hidden = masked(text)
    found, problems = 0, []
    for match in ASSIGN.finditer(hidden):
        found += 1
        number = text.count("\n", 0, match.start()) + 1
        line = text.split("\n")[number - 1].strip()
        if any(fragment in line for fragment, _ in ALLOWED):
            continue
        stop = hidden.find(";", match.end())
        stop = len(text) if stop < 0 else stop
        right = text[match.end():stop]
        if match.group(2) == "+":
            # Appending re-serialises what is already there and parses the
            # whole lot again, literal or not.
            problems.append(f"{path}:{number}: .{match.group(1)} += adds to "
                            f"markup instead of replacing it")
            continue
        reason = why_composed(right)
        if reason:
            problems.append(f"{path}:{number}: .{match.group(1)} is given {reason}")
    return found, problems


def check_no_composed_markup() -> None:
    modules = scripts()
    # The page is a dozen modules. Anything close to none of them means the
    # glob is looking where the front end no longer is, and without this the
    # run below would pass having read nothing - the same guard, and for the
    # same reason, as check_no_leftovers() in tests/test_ui_texts.py.
    if len(modules) < 2:
        check(f"{len(modules)} module(s) found in {app.STATIC}", False,
              "the scan is looking in the wrong place")
        return

    global composed
    total = 0
    for path in modules:
        found, problems = sites(path.name, path.read_text(encoding="utf-8"))
        total += found
        if found or problems:
            check(f"{path.name}: {found} assignment(s) to .innerHTML",
                  not problems)
            for problem in problems:
                print(f"          {problem}")
                composed = True

    # The other half of the guard. Every one of these files could stop being
    # matched, or the masker could blank the whole page by accident, and the
    # loop above would print nothing at all and be taken for a clean result.
    check(f"{total} assignment(s) seen across {len(modules)} module(s)",
          total > 0,
          "" if total else "no .innerHTML anywhere - the scan found no code")


def main() -> int:
    check_no_composed_markup()

    if failures:
        print(f"\n  {len(failures)} problem(s)")
        if composed:
            print("  Build the element and set .textContent, or set the "
                  "property (el.style.background = ...) instead of composing "
                  "an attribute.")
        return 1
    print(f"\n  no module builds markup out of a value it did not write, "
          f"{len(ALLOWED)} exception(s) allowed")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
