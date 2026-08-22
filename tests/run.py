#!/usr/bin/env python3
"""Runs the checks that need a C++ compiler, and says what failed.

    python3 tests/run.py              # all of them
    python3 tests/run.py pairing      # only the ones whose name contains this

**This is no longer the whole suite, and that is the point.** Most of what
vorlaut checks is JavaScript, and the JavaScript checks live where JavaScript
tooling can run them:

    npm test         vitest - the frozen references for the tile renderer, the
                     OBF converter, the recording chain and the text table, and
                     the walk that says every module under src/ is one the page
                     reaches. They import src/ directly, which is why they are
                     here and not in this file: the modules are TypeScript, and
                     putting a build between a frozen reference and the source
                     it names is how it quietly stops measuring it.
    npm run test:e2e Playwright - the page, built and opened in a real browser,
                     under the base a project site is served from. The check
                     whose absence let a page that rendered nothing ship green.

What is left here is the half that no JavaScript runner can do: compiling the
firmware's own readers from firmware/vorlaut/*.h and replaying the browser's
bytes into them. layout.bin, the cable protocol, the pairing codes and the
panel's text all have two implementations that have to agree, one of them C++,
and g++ is the only thing that can hold them together. Plus the two checks on
the repository itself - that no German is left in the code, and that no link in
the docs points at nothing.

Each test is a separate process on purpose. Several compile something and write
into a temporary directory of their own; importing them all into one
interpreter would let those settings leak into each other, and the first test to
call sys.exit would take the rest with it.

**Run this AFTER `git add`, not before, when you have added files.**
test_language.py and test_links.py take their file list from `git ls-files`, so
anything still untracked is invisible to them: the suite comes up green, and
then goes red the moment you commit. That reads exactly like a real regression
caused by the commit, and it is not one - it is the first time those two saw the
file at all. It has now caught three people.

The exit code is what CI reads: 0 only if every test passed.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def tests_matching(needles: list[str]) -> list[Path]:
    """Every test file, or the ones whose name contains one of the arguments.

    A substring rather than the whole name, so that "pairing" finds
    test_pairing.py without anybody typing the prefix and the suffix.
    """
    found = sorted(HERE.glob("test_*.py"))
    if not needles:
        return found
    return [t for t in found if any(n in t.name for n in needles)]


def main(argv: list[str]) -> int:
    tests = tests_matching(argv[1:])
    if not tests:
        print("No test matches that.", file=sys.stderr)
        return 2

    failed: list[str] = []
    started = time.time()
    for test in tests:
        print(f"\n=== {test.name} " + "=" * max(0, 60 - len(test.name)), flush=True)
        # Output goes straight through rather than being captured: what these
        # tests print is prose meant to be read, and holding it back until the
        # end would turn a run that hangs into a run that says nothing.
        result = subprocess.run([sys.executable, str(test)], cwd=HERE.parent)
        if result.returncode != 0:
            failed.append(test.name)

    print("\n" + "=" * 68)
    print(f"{len(tests)} test file(s) in {time.time() - started:.0f}s")
    if failed:
        print(f"{len(failed)} failed:")
        for name in failed:
            print(f"  {name}")
        return 1
    print("All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
