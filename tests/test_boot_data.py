#!/usr/bin/env python3
"""Checks that static/boot_data.js still says what texts.py says.

The page's labels come from texts.py, which app.py reads and injects. A static
site has nobody to inject them, so tools/bootdata.py writes the same subset out
as a module - and a generated file that nothing checks is a copy, which is the
thing generating it was meant to avoid.

This is the check. It regenerates in memory and compares; it never writes, so a
failure here is a reminder to run the generator rather than something that
fixes itself quietly on the next test run.

The failure it exists for is not a missing key - tests/test_ui_texts.py already
holds the two languages level and fails on a key the page asks for and has not
got. It is a *changed* one: correct an awkward German label in texts.py, forget
the generator, and the server page shows the new wording while the static page
shows the old, with both tables full and neither complaining.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "bootdata.py"), "--check"],
        capture_output=True, text=True, cwd=ROOT)
    said = (result.stdout + result.stderr).strip()
    ok = result.returncode == 0
    print(f"  {'ok  ' if ok else 'FAIL'}  {said}")
    if not ok:
        print("\n  1 problem(s): static/boot_data.js is out of step with texts.py")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
