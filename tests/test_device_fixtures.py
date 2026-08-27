#!/usr/bin/env python3
"""The device fixtures regenerate to exactly the bytes that are committed.

The same check tests/test_exchange_fixtures.py makes of the board package
fixtures, and for the same reason: `device/fixtures/` is checked in and both
ends are run against it, which only works if regenerating produces the same
bytes. Otherwise every run of `make_fixtures.mjs` is a diff nobody can read,
a reviewer stops reading them, and a fixture that changed on purpose looks
exactly like one that changed because somebody upgraded node.

Reproducibility is cheap here and it is worth saying why, because the reason is
a rule rather than a piece of luck: this generator imports nothing. No zlib, no
image codec, no `src/`, no `firmware/`. Every byte is laid out by hand from the
field values, so there is nothing in it whose output could be a property of the
toolchain.

The regeneration happens in a temporary copy, not in the working tree. Running
this must never leave anything behind, and a developer with deliberate
uncommitted fixture edits should get a clear failure rather than having them
silently overwritten.

The copy holds only `tools/` and `fixtures/source/`, which makes this say
something slightly stronger than "the output is stable": if the generator ever
reads anything else - a committed artefact, a module under src/ - it fails
here. That is the "never reads its own output back" rule, enforced rather than
asked for.

Needs node. The other half of the fixtures - what they actually say about the
two implementations - is tests/test_device_host.py and
tests/unit/device_fixtures.test.ts.
"""

from __future__ import annotations

import filecmp
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEVICE = ROOT / "device"
FIXTURES = DEVICE / "fixtures"

# What the generator is allowed to read. Anything else and the copy below is
# missing it, which is the point.
INPUTS = [Path("tools"), Path("fixtures") / "source"]


def files_under(root: Path) -> set[str]:
    """Every file below a directory, as a path relative to it."""
    return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}


def regenerate(into: Path) -> subprocess.CompletedProcess[str]:
    """Runs make_fixtures.mjs against a copy holding only its declared inputs."""
    for relative in INPUTS:
        shutil.copytree(DEVICE / relative, into / relative)
    # The directories it writes into, empty. It creates no directory of its
    # own, so a fixture kind added without one fails here rather than in CI.
    for kind in ("layout", "tile", "audio", "cable"):
        (into / "fixtures" / kind).mkdir(parents=True, exist_ok=True)
    return subprocess.run(
        ["node", str(into / "tools" / "make_fixtures.mjs")],
        capture_output=True, text=True, cwd=ROOT)


def main() -> int:
    if shutil.which("node") is None:
        print("  node is not on PATH, and the generator is JavaScript")
        return 1

    problems: list[str] = []

    with tempfile.TemporaryDirectory() as scratch:
        fresh = Path(scratch) / "device"
        fresh.mkdir()
        run = regenerate(fresh)
        if run.returncode != 0:
            print("  make_fixtures.mjs failed:")
            for line in (run.stderr or run.stdout).splitlines()[:20]:
                print(f"    {line}")
            return 1

        # source/ is an input rather than an output, so it is not compared.
        committed = {n for n in files_under(FIXTURES) if not n.startswith("source/")}
        rebuilt = {n for n in files_under(fresh / "fixtures")
                   if not n.startswith("source/")}

        for name in sorted(committed - rebuilt):
            problems.append(f"{name}: committed, but regenerating does not "
                            f"produce it")
        for name in sorted(rebuilt - committed):
            problems.append(f"{name}: regenerating produces it, but it is not "
                            f"committed")

        same = 0
        for name in sorted(committed & rebuilt):
            if filecmp.cmp(FIXTURES / name, fresh / "fixtures" / name,
                           shallow=False):
                same += 1
            else:
                problems.append(
                    f"{name}: regenerating changes it - "
                    f"{(FIXTURES / name).stat().st_size} bytes committed, "
                    f"{(fresh / 'fixtures' / name).stat().st_size} rebuilt")
        if not problems:
            print(f"  ok    {same} file(s) regenerate byte for byte")

    index = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
    listed = index["fixtures"]

    # Every fixture is reachable from the index, and everything the index names
    # is there. A fixture nobody can find is a fixture nobody runs, and an
    # index naming a file that is gone is a runner that stops at the first one.
    for entry in listed:
        for key in ("expected", "file"):
            named = entry.get(key)
            if named and not (FIXTURES / named).exists():
                problems.append(f"{entry['fixture']}: index.json names "
                                f"{named}, which is not there")

    reachable = {entry[key] for entry in listed for key in ("expected", "file")
                 if entry.get(key)}
    on_disk = {n for n in files_under(FIXTURES)
               if not n.startswith("source/") and n != "index.json"}
    for name in sorted(on_disk - reachable):
        problems.append(f"{name}: not reached from index.json")

    if not problems:
        print(f"  ok    {len(listed)} fixture(s), each reachable from "
              f"index.json")

    # Both runners walk the index by kind, and a kind neither of them knows is
    # a fixture that is silently never run. Stated here rather than in either
    # runner, because a runner can only say what it does not recognise once it
    # has been taught the ones it does.
    KINDS = {"layout", "tile", "audio", "cable", "names", "language", "sleep"}
    for entry in listed:
        if entry["kind"] not in KINDS:
            problems.append(f"{entry['fixture']}: kind {entry['kind']!r} is "
                            f"one neither runner knows")

    if problems:
        for problem in problems[:40]:
            print(f"  FAIL  {problem}")
        print(f"\n  {len(problems)} problem(s)")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
