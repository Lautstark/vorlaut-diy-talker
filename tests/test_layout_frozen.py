#!/usr/bin/env python3
"""Checks the browser's layout.bin writer against frozen bytes and the firmware.

One of a pair with tests/test_layout_format.py, and the difference was what
each needed installed:

  test_layout_format.py   wrote every case with layout_format.py as well,
                          and compared all three. The most thorough check
                          there was, and it went with the Python half,
                          2026-08-22.
  this one                needs the lock file, node and a C compiler - which
                          is why it is the one still here. No layout.py, no
                          layout_format.py, no tiles.py.

That distinction is the whole reason this file exists. The C reader really is
independent of Python - it is firmware/vorlaut/layout_format.h, the header
vorlaut.ino includes, calling the parseLayout the device calls - so the
instinct is that the layout check survives on its own. It does not. The reader
survives; what it was compared against did not. normalize_layout() built the
inputs, expected() built the fields, and render_layout_bin() was the only
opinion on whether the JavaScript bytes were right.

So tools/layoutfreeze.py wrote all three down while they were still here to
ask. The tool imported what it froze, so it went with the Python half and only
git history has it now; the lock is what remains, and nothing in the
repository can write it again. If the format ever changes on purpose,
refreezing means restoring layout.py, layout_format.py and the tool from git
for as long as that takes, not editing the lock by hand
(docs/frozen-references.md, "The layout binary"). What is left to ask is the
question that matters afterwards: does the browser still write the bytes the
firmware reads, and does the firmware still read them into the same fields?

Two independent things have to agree for this to pass, which is what keeps it
from being a mirror. The bytes are checked against a value frozen from the
Python writer - that is a captured answer, and on its own it would only say
that the browser has not changed. The C reader then parses those same bytes
and its output is checked field by field. That half is not captured from
anything the browser did: it is compiled from the firmware's source on the
machine running the test, and it is the reason a frozen byte string means
something rather than merely being self-consistent.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The browser half is TypeScript now, so plain `node` cannot run these
# harnesses. vite-node can - it is vitest's own loader, already installed, and
# it resolves imports exactly the way the bundle does. Deliberately no build
# step in between: a frozen reference compared against compiled output has
# stopped measuring the source it names.
#
# The binary rather than `npx vite-node`, because npx reads its first argument
# as a command name and would try to execute the harness itself.
JS_RUNNER = str(ROOT / "node_modules" / ".bin" / "vite-node")


def have_js() -> bool:
    """Whether the loader is installed. `npm install` puts it there."""
    return Path(JS_RUNNER).exists()

LOCK = ROOT / "tests" / "reference" / "layout.lock.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def build_reader(target: Path) -> bool:
    """The firmware's own reader, compiled here.

    Not frozen and deliberately not: a frozen binary would only say that the
    bytes have not changed. Compiling the header the device includes is what
    makes this an outside opinion, and it is also the only thing that would
    notice the structure being changed underneath a fleet that is already
    reading it.
    """
    compiler = shutil.which("g++") or shutil.which("clang++")
    if not compiler:
        return False
    result = subprocess.run(
        [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "layout_dump.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("the firmware's reader compiles", False, result.stderr.strip()[:400])
        return False
    check("the firmware's reader compiles", True)
    return True


def read_back(reader: Path, tmp: Path, name: str, data: bytes) -> list[str] | str:
    """What the firmware's reader makes of these bytes.

    Decoded leniently, because one of the frozen cases cuts a name in the
    middle of a character on purpose. The device draws those 32 bytes as they
    are, so the reader here takes them rather than falling over them.
    """
    path = tmp / name
    path.write_bytes(data)
    result = subprocess.run([str(reader), str(path)], capture_output=True)
    output = result.stdout.decode("utf-8", "replace")
    if result.returncode != 0:
        return f"the C reader reports {output.strip()}"
    return [l for l in output.strip().split("\n") if not l.startswith("bytes")]


def render_with_node(cases: list[dict]) -> list[bytes | str] | None:
    """Every frozen layout, written by src/data/layout_format.ts.

    All of them in one run: starting node costs more than writing every case.
    A case the writer refused comes back as its message instead of as bytes,
    so one bad case reads as one failure rather than as a missing line for
    every case after it.
    """
    node = JS_RUNNER
    if not node:
        return None
    payload = [{"layout": c["layout"], "label": c["label"],
                "images": c["images"], "sounds": c["sounds"]} for c in cases]
    result = subprocess.run([node, str(ROOT / "tests" / "layout_node.mjs")],
                            input=json.dumps(payload), capture_output=True,
                            text=True)
    if result.returncode != 0:
        check("the JavaScript writer runs", False, result.stderr.strip()[:400])
        return []
    check("the JavaScript writer runs", True)
    lines = result.stdout.strip().split("\n")
    if len(lines) != len(cases):
        check("it answers once per case", False,
              f"{len(lines)} lines for {len(cases)} cases")
        return []
    return [line if line.startswith("error ") else bytes.fromhex(line)
            for line in lines]


def difference(frozen: bytes, js: bytes | str) -> str | None:
    """What is wrong with what JavaScript wrote, or None if nothing is."""
    if isinstance(js, str):
        return f"the writer refused it - {js[6:]}"
    if js == frozen:
        return None
    if len(js) != len(frozen):
        return f"{len(js)} bytes instead of {len(frozen)}"
    for i, (a, b) in enumerate(zip(frozen, js)):
        if a != b:
            return (f"first difference at byte {i}: frozen {a:02x}, "
                    f"JavaScript {b:02x}")
    return None


def main() -> int:
    if not LOCK.is_file():
        print(f"  {LOCK} is missing - restore it from git. It is frozen "
              f"layout_format.py output, the tool that wrote it went with "
              f"the Python half, and there is nothing to compare against "
              f"without it.")
        return 1
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    cases = lock["cases"]

    # The frozen bytes are the reference, so they have to be the bytes that
    # were measured. A hex string is easy to hand-edit into agreement with
    # whatever is failing, which is exactly the move this file exists to catch.
    tampered = [c["name"] for c in cases
                if hashlib.sha256(bytes.fromhex(c["bytes"])).hexdigest() != c["sha256"]]
    check("every frozen case still hashes to what was frozen", not tampered,
          "" if not tampered else
          f"changed: {', '.join(tampered)} - restore the lock from git "
          f"rather than editing. Refreezing means restoring layout.py, "
          f"layout_format.py and tools/layoutfreeze.py from git for as "
          f"long as that takes - docs/frozen-references.md, under The "
          f"layout binary")

    from_js = render_with_node(cases)
    if from_js is None:
        print("  skipped: node is not installed, so the browser writer was "
              "not run. That is the half this file is about, so nothing "
              "below means much without it.")
        from_js = []

    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        reader = tmp / "layout_dump"
        have_reader = build_reader(reader)
        if not have_reader:
            print("  skipped: no C++ compiler, so the firmware's reader was "
                  "not built. The frozen bytes were still checked, but "
                  "nothing independent confirmed what they mean.")

        for index, case in enumerate(cases):
            frozen = bytes.fromhex(case["bytes"])

            if from_js:
                problem = difference(frozen, from_js[index])
                check(f"{case['name']}: JavaScript writes the frozen "
                      f"{len(frozen)} bytes", problem is None, problem or "")

            if not have_reader:
                continue

            # The firmware on the bytes JavaScript just wrote, not on the
            # frozen copy of them: if the two differ the line above has
            # already said so, and reading the frozen bytes instead would
            # quietly make this check about nothing.
            subject = from_js[index] if from_js and isinstance(from_js[index], bytes) \
                else frozen
            got = read_back(reader, tmp, "case.bin", subject)
            if isinstance(got, str):
                check(f"{case['name']}: the firmware accepts them", False, got)
                continue
            if case["kind"] == "fields":
                check(f"{case['name']}: and reads them into the same "
                      f"{len(case['fields'])} fields",
                      got == case["fields"],
                      "" if got == case["fields"] else
                      "\n".join(f"      frozen: {a}\n      reader: {b}"
                                for a, b in zip(case["fields"], got) if a != b))
            else:
                # A name cut mid-character is not text any more, so there is
                # nothing to compare field by field. What has to hold is that
                # the firmware takes the file at all - a length or a set count
                # that did not add up would be refused here.
                check(f"{case['name']}: the firmware takes them", True,
                      f"{len(subject)} bytes")

        if have_reader:
            older = lock["older_file"]
            got = read_back(reader, tmp, "old.bin", bytes.fromhex(older["bytes"]))
            check("a layout.bin from before the language byte still reads as "
                  "English",
                  not isinstance(got, str) and got == older["reader"],
                  "" if not isinstance(got, str) and got == older["reader"]
                  else str(got))

        # The structure is a sum, and the sum is the thing that has to keep
        # agreeing. Checked against the frozen strides rather than against
        # layout_format.py, so it still means something without one.
        for case in cases:
            if case["kind"] != "fields":
                continue
            sets = len(case["label"])
            want = lock["header_bytes"] + sets * lock["set_bytes"]
            if case["length"] != want:
                check(f"{case['name']}: {sets} sets is {want} bytes", False,
                      f"frozen at {case['length']}")
        check(f"every frozen length is {lock['header_bytes']} + sets * "
              f"{lock['set_bytes']}", True)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
