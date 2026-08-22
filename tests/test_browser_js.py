#!/usr/bin/env python3
"""Runs the browser tests, which are JavaScript.

The app is a static site, so most of what there is to check is written in
JavaScript, and the checks are too. They run under plain node with nothing
installed - the same rule the rest of this folder follows - so this file is
only the bridge, and exists so that `python3 tests/run.py` covers everything
and CI needs to know about one command.

Every tests/browser/*.test.mjs runs. At the time of writing:

  level.test.mjs      the recording chain in static/vendor/stimmquelle, held
                      against numbers real ffmpeg gave for the same inputs
                      while there was still an ffmpeg half of this project to
                      ask. Frozen in tests/reference/tts.lock.json.
  boot_data.test.mjs  static/boot_data.js, which used to be generated from
                      texts.py and is the source itself now that texts.py is
                      gone.
  reachable.test.mjs  that every module under static/ is one ui.html actually
                      loads, following the import map the way the page does.
                      This walk used to be in tests/test_ui_texts.py.
  page.test.mjs       the page, opened in a real Chrome, with a board on it.
                      The only check here that runs the front end rather than
                      reading it - see its own docstring for why that gap cost
                      a release.

Skipped, not failed, where node is missing - and that is a real gap rather
than a formality now, so it says so plainly. There is no Python half left to
fall back on: without node, almost nothing in this repository is checked.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITES = sorted((ROOT / "tests" / "browser").glob("*.test.mjs"))


def missing_module(stderr: str) -> str | None:
    """A readable explanation when the thing being checked is not there.

    node reports a moved module as ERR_MODULE_NOT_FOUND and a stack trace,
    which is true and unhelpful: the reader has to work out that the failure
    is about the subject of the test rather than about the test. It is worth
    spelling out, because the static-site rewrite is actively moving these
    files - level.js is a candidate to be replaced by a vendored package - and
    whoever moves one will meet this message before they meet anything else.
    """
    found = re.search(r"Cannot find module '([^']+)'", stderr or "")
    if not found:
        return None
    return (f"\n  {found.group(1)} is not there.\n\n"
            f"  If it moved or was replaced, point this suite at wherever it\n"
            f"  lives now. The frozen references in tests/reference/tts.lock.json\n"
            f"  are not invalidated by that - they are measurements of what real\n"
            f"  ffmpeg said about fixed inputs, not of any particular file, and\n"
            f"  holding a replacement to them is how it gets shown to be\n"
            f"  faithful. Deleting them because the module moved would throw\n"
            f"  away the only external check the speech chain has.\n")


def main() -> int:
    if not SUITES:
        print("  FAIL  no *.test.mjs under tests/browser")
        return 1

    node = shutil.which("node")
    if not node:
        print("  skipped: node is not installed, so the browser tests cannot "
              "run - which means the speech chain, the text tables, the "
              "import graph and the page itself are not checked at all.")
        print("\n  All good.")
        return 0

    failed = []
    for suite in SUITES:
        print(f"  --- {suite.relative_to(ROOT)}")
        done = subprocess.run([node, str(suite)], capture_output=True, text=True)
        for line in (done.stdout or "").splitlines():
            if line.strip() and "All good" not in line:
                print(f"  {line}")
        if done.returncode:
            print(missing_module(done.stderr) or "", end="")
            sys.stderr.write(done.stderr)
            failed.append(suite.name)

    if failed:
        print(f"\n  {len(failed)} suite(s) failed: {', '.join(failed)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
