#!/usr/bin/env python3
"""Checks the browser's METACOM reference against frozen names.

The companion to tests/test_symbol_reference.py, and the difference is what
each needs installed:

  test_symbol_reference.py  asks metacom.py what a file is filed under and
                            compares. Goes when metacom.py goes.
  this one                  needs tests/reference/symbols.lock.json and node.

A symbol lives in layout.json as `metacom:essen`. metacom.py keys the
collection by the file's stem and obf.py reads it back that way; the browser
gets a path out of the vendored bildquelle package and src/data/symbols.ts turns
it into the same reference. Those two agreeing is the whole of it - if they
drift, every layout that exists points at symbols nobody can find, the build
fails on boards that used to build, and neither half says anything.

The names here came from metacom._scan_files() itself rather than from a
restatement of what it does - see tools/symbolfreeze.py, which explains why
that distinction is not pedantry. The function under test is read out of
src/data/symbols.ts rather than copied, for the same reason: a copy would agree
with itself for ever, which is the one thing this must not do.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SYMBOLS_JS = ROOT / "src" / "data" / "symbols.ts"
LOCK = ROOT / "tests" / "reference" / "symbols.lock.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def javascript_reference(paths: list[str]) -> list[str] | None:
    """What symbols.js makes of each path, run in node.

    The adapter is one line and it is lifted out of the file as text, so what
    runs here is what ships rather than something resembling it.
    """
    source = SYMBOLS_JS.read_text(encoding="utf-8")
    prefix = re.search(r'const METACOM_PREFIX = "([^"]*)"', source)
    body = re.search(r"^const referenceFor = .*?;$", source, re.M)
    if not prefix or not body:
        check("src/data/symbols.ts still has METACOM_PREFIX and referenceFor",
              False, "has the adapter been renamed or moved? Nothing else in "
                     "this file can run until it is found again")
        return None
    check("src/data/symbols.ts still has METACOM_PREFIX and referenceFor", True)

    driver = (f'const METACOM_PREFIX = "{prefix.group(1)}";\n'
              f"{body.group(0)}\n"
              f"console.log(JSON.stringify({json.dumps(paths)}.map(referenceFor)));")
    # Plain node, not the TypeScript loader the other frozen tests need: the
    # adapter is lifted out of symbols.ts as text and has no imports, so what
    # runs here is one self-contained snippet rather than a module graph.
    done = subprocess.run([shutil.which("node"), "--input-type=module", "-e", driver],
                          capture_output=True, text=True)
    if done.returncode != 0:
        check("the adapter runs", False, done.stderr.strip()[:300])
        return None
    return json.loads(done.stdout)


def main() -> int:
    if not LOCK.is_file():
        print(f"  {LOCK} is missing - tools/symbolfreeze.py writes it, and "
              f"there is nothing to compare against without it.")
        return 1
    lock = json.loads(LOCK.read_text(encoding="utf-8"))

    if not shutil.which("node"):
        print("  skipped: node is not installed, so the adapter was not run. "
              "That is the half this file is about, so nothing was checked.")
        print("\n  All good.")
        return 0

    # Every case, including the ones metacom.py files under nothing: the
    # adapter is still asked, so that what it does with them is on the record
    # even where there is no right answer to hold it to.
    cases = lock["cases"]
    from_js = javascript_reference([c["path"] for c in cases])
    if from_js is None:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1

    unindexed = set(lock["unindexed"]["paths"])
    for case, actual in zip(cases, from_js):
        right = actual == case["reference"]
        # Every case is compared, including the ones _scan_files() never
        # reached. Their expected name came from Python too - path.stem is the
        # expression metacom.py files a symbol with, and only the "*.png" in
        # front of it kept these out - so there is a real answer to hold the
        # adapter to. What is different about them is that nothing resolves
        # afterwards, which is a fact about the collection and not about the
        # name.
        where = "" if case["indexed"] else "  [not in the index; name only]"
        check(f"{case['path']} -> {case['reference']}{where}", right,
              "" if right else
              f"the adapter says {actual!r}, metacom.py files it under "
              f"{case['reference']!r}   ({case['why']})")

    # Asserted rather than left in a docstring. Every PNG makes "strip the
    # last suffix" and "drop four characters" the same rule, so the cases with
    # a longer extension are the only ones that can tell those apart - and
    # they are exactly the ones _scan_files() does not reach. If they ever
    # stop being listed here, that discrimination has gone with them.
    check("some case still has an extension the PNG glob does not reach",
          bool(unindexed),
          "" if unindexed else
          "none are listed - without one, a rule that drops four characters "
          "passes every check above. Refreeze with tools/symbolfreeze.py")

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
