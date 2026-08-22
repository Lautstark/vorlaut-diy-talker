#!/usr/bin/env python3
"""Runs every test in this folder and says what failed.

    python3 tests/run.py              # all of them
    python3 tests/run.py pairing      # only the ones whose name contains this

This exists because the list used to live in .github/workflows/ci-python.yml,
one step per file. That list had to be edited by hand for every new test, and
nothing checked it: a test file nobody added to it simply never ran, and looked
exactly like a test that passed. Four fixes landing at once also meant four
branches appending to the same twenty lines of YAML.

So the folder is the list now. A file named test_*.py runs, and that is the
whole rule.

Each test is a separate process on purpose. Several of them start the real
server, bind a fixed port and set environment variables for their own run;
importing them all into one interpreter would let those settings leak into
each other, and the first test to call sys.exit would take the rest with it.
The cost is a few seconds of interpreter startup, which is not worth the
class of failure it avoids.

Sequential for the same reason: the ones that bind a port each pick their own,
but they were written on the assumption that nothing else is listening.

**Run this AFTER `git add`, not before, when you have added files.**
test_language.py and test_links.py take their file list from `git ls-files`,
so anything still untracked is invisible to them: the suite comes up green,
and then goes red the moment you commit. That reads exactly like a real
regression caused by the commit, and it is not one - it is the first time
those two saw the file at all. It has now caught two people, once on a test
fixture with an umlaut in its name and once on a folder of new fixtures.

Everything else here reads the disk, which is why this is surprising.

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
