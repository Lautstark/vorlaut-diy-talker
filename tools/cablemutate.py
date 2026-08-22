#!/usr/bin/env python3
"""Breaks the cable protocol on purpose and checks that the test notices.

    python3 tools/cablemutate.py

tests/test_cable_format.py says the two halves of the cable agree. That claim
is only worth what its fixtures catch, and a fixture that catches nothing looks
exactly like one that catches everything - it passes either way. The only way
to tell them apart is to introduce the faults on purpose and watch.

Five of these were missed the first time this was run, and each was a real
hole rather than a missing assertion:

  * A checksum that lost its zero padding. Every value in the fixture happened
    to have eight significant digits, so "%lx" and "%08lx" agreed on all of
    them. Fixed by adding a checksum with leading zeros.
  * "done" being sent after an abort. The check inside the loop caught every
    case except aborting on the very last step, which is the only one the
    guard in front of "done" exists for.
  * layout.bin no longer being sent last. Nothing looked at the order at all -
    and that order is what stops the device reading a layout whose files have
    not arrived.
  * The browser no longer skipping keywords it does not know. It read the
    device's timing line where it expected "ok", took the number out of it,
    and nothing compared that number with what was sent.
  * The device no longer reporting its timings, which nothing asked for.

What this cannot reach is firmware/vorlaut/cable.h: it needs Arduino and
LittleFS, so it is not compiled here. That is the half holding the .part rule,
the timeouts and the drain - the same half a bench run has to answer for.

The working tree has to be clean. Each mutation is written into a tracked file
and undone afterwards, and doing that on top of unsaved work is not a risk
worth taking for a check that can wait until after a commit.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FORMAT = ROOT / "firmware" / "vorlaut" / "cable_format.h"
CLIENT = ROOT / "tools" / "cable.js"
MOCK = ROOT / "tools" / "cable_mock.js"

# (file, what to find, what to put there, what that would mean)
MUTANTS: list[tuple[pathlib.Path, str, str, str]] = [
    (FORMAT, "#define CABLE_VERSION 1", "#define CABLE_VERSION 2",
     "the protocol version moves"),
    (FORMAT, "#define CABLE_HOST_SIGIL '>'", "#define CABLE_HOST_SIGIL '@'",
     "the host sigil changes"),
    (FORMAT, "#define CABLE_NAME_MAX 63", "#define CABLE_NAME_MAX 31",
     "the name limit shrinks"),
    (FORMAT, "#define CABLE_CRC_INIT 0u", "#define CABLE_CRC_INIT 0xffffffffu",
     "the checksum starts from the wrong value"),
    (FORMAT, "0x76dc4190u, 0x6b6b51f4u", "0x76dc4191u, 0x6b6b51f4u",
     "one entry of the checksum table is wrong"),
    (FORMAT, "if (c <= ' ' || c >= 0x7f || c == '/') return false;",
     "if (c <= ' ' || c >= 0x7f) return false;",
     "a slash is allowed in a name"),
    (FORMAT, "if (name[0] == '.') return false;", "if (false) return false;",
     "a leading dot is allowed in a name"),
    (FORMAT, "if (length == 0 || length > CABLE_NAME_MAX) return false;",
     "if (length > CABLE_NAME_MAX) return false;", "an empty name is allowed"),
    (FORMAT, "if (strcmp(name, &CABLE_VERSION_FILE[1]) == 0) return false;", "",
     "the Wi-Fi sync's own note becomes writable"),
    (FORMAT, "if (digits != 8) return false;", "if (digits > 8) return false;",
     "a checksum shorter than eight digits is accepted"),
    (FORMAT, "          words == 1 &&", "          words >= 1 &&",
     "rm acts on the first of several words"),
    (FORMAT, "    if (number > 0xffffffffull) return false;",
     "    if (number > 0xffffffffull) number = 0;",
     "a byte count past 32 bits wraps instead of being refused"),
    (FORMAT, '"%c %s %s %08lx\\n"', '"%c %s %s %lx\\n"',
     "a checksum loses its zero padding"),
    (FORMAT, "  if (!command->complete) {\n    command->name[0] = '\\0';",
     "  if (false) {\n    command->name[0] = '\\0';",
     "a refused command keeps its half-read fields"),
    (CLIENT, "present.get(name).size === size", "true",
     "the browser keeps a file on its name alone"),
    (CLIENT, "  signal?.throwIfAborted();\n  return await cable.done();",
     "  return await cable.done();", "done is sent even after an abort"),
    (CLIENT,
     "put.sort((a, b) => (a.name === LAYOUT_FILE) - (b.name === LAYOUT_FILE));",
     "", "layout.bin is no longer sent last"),
    (CLIENT, "if (want.includes(answer.key)) return answer;", "return answer;",
     "the browser stops skipping keywords it does not know"),
    (CLIENT, "  if (theplan.tight) await sweep();", "  if (false) await sweep();",
     "a tight fit no longer clears out first"),
    (CLIENT, "  if (!theplan.tight) await sweep();",
     "  if (false) await sweep();", "the sweep after sending never runs"),
    (CLIENT,
     "const remove = have.map((f) => f.name).filter((name) => !want.has(name));",
     "const remove = [];", "stale files are never removed"),
    (CLIENT, 'parseInt(rest.slice(rest.lastIndexOf(" ") + 1), 16)',
     'parseInt(rest.slice(rest.lastIndexOf(" ") + 1), 10)',
     "a checksum is read as decimal"),
    (MOCK, "await this.reply(`gap ${pending.gap ?? 0}`);", "",
     "the device stops reporting its timings"),
]

# Changes that alter no behaviour. These SHOULD survive: a run in which
# everything fails proves only that the harness is broken.
CONTROLS: list[tuple[pathlib.Path, str, str, str]] = [
    (CLIENT, "chunk = 4096", "chunk = 997", "the write chunk size changes"),
    (CLIENT, "const DEFAULT_TIMEOUT = 5000;", "const DEFAULT_TIMEOUT = 6000;",
     "the timeout is more generous"),
]


def suite_passes() -> bool:
    return subprocess.run(
        [sys.executable, "tests/test_cable_format.py"],
        cwd=ROOT, capture_output=True, text=True).returncode == 0


def apply(case: tuple[pathlib.Path, str, str, str]) -> bool | None:
    """True if the test noticed, False if not, None if the text has moved."""
    path, find, replace, _ = case
    original = path.read_text(encoding="utf-8")
    if find not in original:
        return None
    path.write_text(original.replace(find, replace, 1), encoding="utf-8")
    try:
        return not suite_passes()
    finally:
        # Whatever happened, including a keyboard interrupt on the way past.
        path.write_text(original, encoding="utf-8")


def main() -> int:
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
    if dirty:
        print("The working tree is not clean. This edits tracked files and "
              "puts them back,\nand it should not be doing that on top of "
              "changes you have not saved:\n")
        print(dirty)
        return 2

    if not suite_passes():
        print("tests/test_cable_format.py does not pass to begin with, so "
              "nothing here would mean anything.")
        return 2

    missed, moved = [], []
    print(f"{len(MUTANTS)} faults, one at a time:\n")
    for case in MUTANTS:
        caught = apply(case)
        what = case[3]
        if caught is None:
            moved.append(what)
            print(f"  ?       {what} - the code to change has moved")
        elif caught:
            print(f"  caught  {what}")
        else:
            missed.append(what)
            print(f"  MISSED  {what}")

    print(f"\n{len(CONTROLS)} changes that should NOT be noticed:\n")
    wrongly = []
    for case in CONTROLS:
        caught = apply(case)
        if caught:
            wrongly.append(case[3])
            print(f"  WRONGLY CAUGHT  {case[3]}")
        else:
            print(f"  survived        {case[3]}")

    caught = len(MUTANTS) - len(missed) - len(moved)
    print(f"\n{caught} of {len(MUTANTS) - len(moved)} faults caught.")
    if moved:
        print(f"{len(moved)} could not be applied - this file has drifted from "
              f"the code and wants updating.")
    if missed:
        print("\nWhat went unnoticed is the interesting part: each of these is "
              "a fault\nthe suite would let through today.")
    if wrongly:
        print("\nA control was caught, which means the suite is failing for a "
              "reason\nthat has nothing to do with the change made.")
    return 1 if (missed or wrongly or moved) else 0


if __name__ == "__main__":
    raise SystemExit(main())
