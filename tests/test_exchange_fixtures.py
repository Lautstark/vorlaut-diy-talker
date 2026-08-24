#!/usr/bin/env python3
"""The board package fixtures regenerate to exactly the bytes that are committed.

`exchange/fixtures/*.obz` are checked in, and a consumer repo pins them by tag
and runs its importer against them. That only works if regenerating produces
the same bytes: otherwise every run of `make_fixtures.mjs` is a diff nobody can
read, a reviewer stops reading them, and a fixture that changed on purpose looks
exactly like one that changed because somebody upgraded node.

So the generator was built to be reproducible, and this is what holds it to it.
Two things make that possible and both are worth knowing before changing them:

  * Nothing is really compressed. The deflate streams in the zip are made of
    *stored* blocks, because zlib's actual output is a property of the zlib
    build rather than of the input. Stored blocks are valid method-8 data, so
    an importer's inflate path is still exercised.
  * The images and audio are not generated here at all. PNG's IDAT depends on
    zlib and Opus depends on libopus, so those are rendered once by
    `exchange/tools/make_assets.mjs` and committed under `exchange/assets/`.

The regeneration happens in a temporary copy, not in the working tree. Running
this must never leave anything behind, and a developer with deliberate
uncommitted fixture edits should get a clear failure rather than having them
silently overwritten.

That also makes this check say something slightly stronger than "the output is
stable": the copy contains only `tools/`, `assets/` and `fixtures/source/`, so
if the generator reads anything else, it fails here.
"""

from __future__ import annotations

import filecmp
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCHANGE = ROOT / "exchange"
FIXTURES = EXCHANGE / "fixtures"

# What the generator is allowed to read. Anything else and the copy below is
# missing it, which is the point.
INPUTS = [Path("tools"), Path("assets"), Path("fixtures") / "source"]


def regenerate(into: Path) -> subprocess.CompletedProcess[str]:
    """Runs make_fixtures.mjs against a copy holding only its declared inputs."""
    for relative in INPUTS:
        shutil.copytree(EXCHANGE / relative, into / relative)
    (into / "fixtures").mkdir(exist_ok=True)
    return subprocess.run(
        ["node", str(into / "tools" / "make_fixtures.mjs")],
        capture_output=True, text=True, cwd=ROOT)


def main() -> int:
    if shutil.which("node") is None:
        print("  node is not on PATH, and the generator is JavaScript")
        return 1

    problems: list[str] = []

    with tempfile.TemporaryDirectory() as scratch:
        fresh = Path(scratch) / "exchange"
        fresh.mkdir()
        run = regenerate(fresh)
        if run.returncode != 0:
            print("  make_fixtures.mjs failed:")
            for line in (run.stderr or run.stdout).splitlines()[:20]:
                print(f"    {line}")
            return 1

        committed = sorted(p.name for p in FIXTURES.iterdir() if p.is_file())
        rebuilt = sorted(p.name for p in (fresh / "fixtures").iterdir() if p.is_file())

        for name in sorted(set(committed) - set(rebuilt)):
            problems.append(f"{name}: committed, but regenerating does not produce it")
        for name in sorted(set(rebuilt) - set(committed)):
            problems.append(f"{name}: regenerating produces it, but it is not committed")

        same = 0
        for name in sorted(set(committed) & set(rebuilt)):
            if filecmp.cmp(FIXTURES / name, fresh / "fixtures" / name, shallow=False):
                same += 1
            else:
                problems.append(
                    f"{name}: regenerating changes it - "
                    f"{(FIXTURES / name).stat().st_size} bytes committed, "
                    f"{(fresh / 'fixtures' / name).stat().st_size} rebuilt")
        if not problems:
            print(f"  ok    {same} file(s) regenerate byte for byte")

    # Every package is paired and listed. A fixture nobody can find is a fixture
    # nobody runs.
    packages = sorted(p.stem for p in FIXTURES.glob("*.obz"))
    for name in packages:
        if not (FIXTURES / f"{name}.expected.json").exists():
            problems.append(f"{name}.obz: no {name}.expected.json beside it")

    index = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
    listed = sorted(entry["fixture"] for entry in index["fixtures"])
    for name in sorted(set(packages) - set(listed)):
        problems.append(f"{name}: not listed in index.json")
    for name in sorted(set(listed) - set(packages)):
        problems.append(f"{name}: listed in index.json but has no .obz")
    if not problems:
        print(f"  ok    {len(packages)} package(s), each paired and listed")

    # The README's table enumerates the fixtures, and an enumeration drifts the
    # same way a count does - which is why no count is written down anywhere any
    # more. This is the guard for the one list that is still spelled out in
    # prose, so it cannot quietly fall behind index.json.
    readme = (EXCHANGE / "README.md").read_text(encoding="utf-8")
    tabled: dict[str, str] = {}
    for line in readme.splitlines():
        match = re.match(r"^\|\s*`([a-z0-9-]+)`\s*\|\s*(?:\*\*)?(accepted|rejected)(?:\*\*)?\s*\|", line)
        if match:
            tabled[match.group(1)] = match.group(2)

    outcomes = {entry["fixture"]: entry["outcome"] for entry in index["fixtures"]}
    for name in sorted(set(outcomes) - set(tabled)):
        problems.append(f"{name}: in index.json, missing from the README table")
    for name in sorted(set(tabled) - set(outcomes)):
        problems.append(f"{name}: in the README table, not in index.json")
    for name in sorted(set(tabled) & set(outcomes)):
        if tabled[name] != outcomes[name]:
            problems.append(
                f"{name}: README table says {tabled[name]}, index.json says {outcomes[name]}")
    if not problems:
        print(f"  ok    the README table matches index.json")

    if problems:
        for problem in problems[:40]:
            print(f"  {problem}")
        print()
        print("  Regenerate with:  node exchange/tools/make_fixtures.mjs")
        print("  and commit the result if the change was intended.")
        return 1

    print()
    print("  All good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
