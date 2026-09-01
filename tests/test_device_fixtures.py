#!/usr/bin/env python3
"""The device fixtures regenerate to exactly the bytes that are committed.

The same check tests/test_exchange_fixtures.py makes of the board package
fixtures, and for the same reason: `device/fixtures/` is checked in and both
ends are run against it, which only works if regenerating produces the same
bytes. Otherwise every run of `make_fixtures.mjs` is a diff nobody can read,
a reviewer stops reading them, and a fixture that changed on purpose looks
exactly like one that changed because somebody upgraded node.

Reproducibility is cheap here and it is worth saying why, because the reason is
a rule rather than a piece of luck: nothing the generator imports has an opinion
of its own. No compressor, no image codec, no `src/`, no `loader/`, no
`firmware/`. Two fixed functions out of node - CRC-32 and SHA-256 - and every
other byte laid out by hand from the field values, so there is nothing in it
whose output could be a property of the toolchain. That is also why the `.obz`
fixtures under `package/` are stored rather than deflated: deflate output *is* a
property of whichever zlib is installed, and a committed artefact that must
regenerate byte for byte cannot depend on one.

The regeneration happens in a temporary copy, not in the working tree. Running
this must never leave anything behind, and a developer with deliberate
uncommitted fixture edits should get a clear failure rather than having them
silently overwritten.

The copy holds only `tools/` and `fixtures/source/`, which makes this say
something slightly stronger than "the output is stable": if the generator ever
reads anything else - a committed artefact, a module under src/ - it fails
here. That is the "never reads its own output back" rule, enforced rather than
asked for.

One thing here is not about reproducibility at all: the version the index
calls the interface. It lives in this file because it is a statement about the
fixture set rather than about either implementation, and the two runners are
the two implementations' halves. See the note beside it.

Needs node. The other half of the fixtures - what they actually say about the
two implementations - is tests/test_device_host.py and
tests/unit/device_fixtures.test.ts.
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
    for kind in ("layout", "tile", "audio", "cable", "package"):
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

    # The version the fixture set calls itself, which can go wrong two ways.
    #
    # The first is index.json and make_fixtures.mjs disagreeing about it, and
    # that is already covered above rather than here: the generator is the only
    # writer of index.json, so a version moved in one place and not the other
    # arrives as "index.json: regenerating changes it". Comparing the two by
    # reading the number back out of the generator's source would be the thing
    # ADR 0009 counts as one of the four gaps it closed - tests/test_texts.py
    # reading LANGUAGE_CODES out of another module with a regular expression.
    #
    # The second is the suffix, and nothing caught that at all. This said
    # 0.1.0-draft from the day it was written until 2026-08-27; both runners
    # PRINT the string and neither asserts it, so device-v1 could have been cut
    # over a fixture set that called itself a draft with nothing red anywhere.
    # ADR 0009 makes this the version of the whole interface rather than
    # LAYOUT_VERSION or CABLE_VERSION, which is what makes a pre-release suffix
    # on it a claim about the interface instead of a label on a file.
    #
    # Stated here for the same reason the kinds below are: it is a statement
    # about the fixture set itself, and neither runner is the fixture set's
    # half. Whether the interface is ratified is the tag's business - see
    # device/README.md, "The tag".
    version = index.get("device_interface_version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+",
                                                       version):
        problems.append(
            f"device_interface_version is {version!r}: ADR 0009 makes it "
            f"MAJOR.MINOR.PATCH over the whole interface, and a fixture set "
            f"that calls itself a draft is one no device-v* tag can be cut "
            f"over")
    else:
        print(f"  ok    the interface calls itself {version}, with no "
              f"pre-release suffix")

    # Every fixture is reachable from the index, and everything the index names
    # is there. A fixture nobody can find is a fixture nobody runs, and an
    # index naming a file that is gone is a runner that stops at the first one.
    for entry in listed:
        for key in ("expected", "file"):
            named = entry.get(key)
            if named and not (FIXTURES / named).exists():
                problems.append(f"{entry['fixture']}: index.json names "
                                f"{named}, which is not there")

    # One name per fixture, across every kind. Both runners key their
    # expectations by name, so a second fixture called one-set does not
    # collide - it REPLACES, and the first one is then checked against the
    # second one's expectation. That went green for exactly as long as it took
    # to add a kind whose author reached for an obvious name.
    seen: dict[str, str] = {}
    for entry in listed:
        already = seen.get(entry["fixture"])
        if already:
            problems.append(f"{entry['fixture']}: two fixtures have this name, "
                            f"one of kind {already!r} and one of kind "
                            f"{entry['kind']!r}. A runner keying by name reads "
                            f"one of them twice and the other never")
        seen[entry["fixture"]] = entry["kind"]

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
    KINDS = {"layout", "tile", "audio", "cable", "names", "language", "sleep",
             "press", "collections", "package"}
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
