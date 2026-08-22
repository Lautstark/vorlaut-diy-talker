#!/usr/bin/env python3
"""Freezes layout.bin, its fields and the layouts they came from.

    python3 tools/layoutfreeze.py            # rewrite tests/reference/layout.lock.json
    python3 tools/layoutfreeze.py --check    # render again, change nothing, report

Of the three subsystems that exist twice, this is the one in the best shape.
tests/test_layout_format.py compiles the firmware's own C reader - the same
layout_format.h that vorlaut.ino includes, calling the same parseLayout - and
holds every case against it. That reader owes Python nothing, so the obvious
conclusion is that this check survives the Python half being deleted and needs
no help.

The conclusion is wrong, and the reason is worth writing down. The reader
survives; the test around it does not. Three things it needs are Python:

  the inputs        every case goes through normalize_layout() in layout.py,
                    which fills in slots, clamps the sleep timeout and
                    supplies defaults. static/layout_format.js has activeSets
                    and normalizeColor and nothing else - there is no
                    normalizeLayout on that side, and the cases are written in
                    the shape that comes out of the Python one.
  the expectation   expected() builds the lines the C reader is compared
                    against, out of LANGUAGE_CODES, active_sets, hex_to_rgb
                    and _hash_bytes. Without them the reader still prints its
                    fields and there is nothing to say whether they are right.
  the bytes         the JavaScript writer is compared byte for byte against
                    render_layout_bin(). That is the whole check on it.

Delete Python and what is left is a C reader that parses whatever it is given
and a test with nothing to compare. So the bytes are frozen here, and the
fields the reader made of them, and the normalized layouts that produced them.
Afterwards tests/test_layout_frozen.py can ask the real question - does the
browser writer still produce the bytes the firmware reads correctly - with
nothing but node and a C compiler.

The cases are not written out again here. They are the ones in
tests/test_layout_format.py, imported, so that there is one list and not two
drifting copies of it. That file stays as it is and keeps doing the live
three-way comparison for as long as there is a Python half to compare.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

REFERENCE = ROOT / "tests" / "reference"
LOCK = REFERENCE / "layout.lock.json"

import test_layout_format as suite  # noqa: E402
from layout_format import HEADER_BYTES, SET_BYTES, render_layout_bin  # noqa: E402


def freeze(tmp: Path) -> dict:
    reader = tmp / "layout_dump"
    suite.build_reader(reader)

    frozen = []
    for kind, group in (("fields", suite.prepared(suite.cases())),
                        ("bytes", suite.writer_cases())):
        for name, layout, label, images, sounds in group:
            data = render_layout_bin(layout, label, images, sounds)
            entry = {
                "name": name,
                # "fields" cases are compared field by field with the C reader
                # as well as byte for byte. "bytes" cases are the writer's own
                # edges - a name cut mid-character is not text any more, so
                # only the bytes and the fact that the reader accepts them mean
                # anything. The distinction is the one the test already makes.
                "kind": kind,
                "layout": layout, "label": label,
                "images": images, "sounds": sounds,
                "bytes": data.hex(),
                "sha256": hashlib.sha256(data).hexdigest(),
                "length": len(data),
            }
            read = suite.read_back(reader, tmp, "frozen.bin", data)
            if isinstance(read, str):
                raise SystemExit(f"the C reader refuses {name}: {read}")
            entry["reader"] = read
            if kind == "fields":
                want = suite.expected(layout, label, images, sounds)
                if read != want:
                    raise SystemExit(
                        f"the C reader and Python already disagree on {name} - "
                        f"fix that before freezing anything")
                entry["fields"] = want
            frozen.append(entry)
            print(f"  {name:<45} {len(data):>4} bytes, "
                  f"{len(read)} field line(s)")

    # The one case that is not a layout anybody wrote: a layout.bin from
    # before the language byte existed, which still has to read as English.
    from layout import normalize_layout
    old = bytearray(render_layout_bin(
        normalize_layout({"sleep_timeout_seconds": 600, "sets": []}), [], [], []))
    old[7] = 0                      # what the reserved byte always held
    read = suite.read_back(reader, tmp, "old.bin", bytes(old))
    if isinstance(read, str) or "language 0" not in "\n".join(read):
        raise SystemExit("a layout.bin from before the language byte no longer "
                         "reads as English")
    older = {"name": "a layout.bin from before the language byte",
             "bytes": bytes(old).hex(),
             "sha256": hashlib.sha256(bytes(old)).hexdigest(),
             "reader": read}
    print(f"  {older['name']:<45} {len(old):>4} bytes")

    return {
        "what": "layout.bin as layout_format.py writes it, the fields the "
                "firmware's own reader makes of those bytes, and the "
                "normalized layouts both came from - frozen so that the "
                "browser writer can still be checked once the Python one is "
                "gone.",
        "produced_by": "tools/layoutfreeze.py",
        "produced_on": date.today().isoformat(),
        "python": sys.version.split()[0],
        "reader": "tests/layout_dump.cpp against firmware/vorlaut/layout_format.h",
        "header_bytes": HEADER_BYTES,
        "set_bytes": SET_BYTES,
        "invalidated_by": [
            "a change to the structure in firmware/vorlaut/layout_format.h - "
            "which is the one change that is supposed to be impossible, "
            "because the devices in the field are already reading this",
            "a change to render_layout_bin() in layout_format.py",
            "a change to normalize_layout() in layout.py, which decides what "
            "the writers are handed. The frozen layouts are its output, and "
            "tests/test_layout_format.py checks they still are",
        ],
        "not_invalidated_by": [
            "changes to static/layout_format.js - that is the thing being "
            "checked. There is exactly one right answer for these bytes and "
            "the firmware decides it, not the browser",
        ],
        "cases": frozen,
        "older_file": older,
    }


def main(argv: list[str]) -> int:
    check = "--check" in argv
    with tempfile.TemporaryDirectory() as raw:
        print("Rendering." if check else "Rendering and freezing.")
        fresh = freeze(Path(raw))

    if not check:
        REFERENCE.mkdir(parents=True, exist_ok=True)
        LOCK.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        print(f"\n  {len(fresh['cases'])} cases in {LOCK.relative_to(ROOT)}")
        return 0

    if not LOCK.exists():
        print("\n  nothing frozen yet - run without --check")
        return 1
    old = json.loads(LOCK.read_text(encoding="utf-8"))
    moved = [b["name"] for a, b in zip(old["cases"], fresh["cases"])
             if a["sha256"] != b["sha256"] or a["reader"] != b["reader"]]
    if len(old["cases"]) != len(fresh["cases"]):
        print(f"\n  {len(old['cases'])} cases frozen, {len(fresh['cases'])} now")
        return 1
    if moved:
        print(f"\n  {len(moved)} case(s) come out differently: {', '.join(moved)}")
        return 1
    print("\n  unchanged - Python and the C reader still say what is frozen")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
