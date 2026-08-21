#!/usr/bin/env python3
"""Checks that the layout types describe the dictionary that really comes out.

layout.py declares Slot, SetEntry and Layout as TypedDicts. There is no type
checker in this project, so nothing enforces them at import time - an
annotation on its own is a comment with a colon in it, and it goes stale the
first time somebody adds a field without touching it.

This is what enforces them. It runs a layout through normalize_layout() and
compares the keys that actually come out with the keys the types promise, in
both directions: a field added to the layout and not to the type is caught,
and so is a type that promises a field the layout no longer has.

Deliberately keys and not values. Checking that "active" is a bool is what a
type checker is for; what goes wrong here in practice is a field appearing on
one side and not the other, and that is what this catches.

The other half is that normalize_layout() completes a partial layout - the web
interface can post half a form. So the input below is deliberately ragged: a
set with no name, a slot missing entirely, a colour in short form. What comes
out still has to match the types exactly.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import layout  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def keys_of(typed_dict) -> set[str]:
    return set(typed_dict.__annotations__)


# Ragged on purpose - this is the shape the web interface is allowed to post.
RAW = {
    "sets": [
        {
            "name": "  Grundset  ",
            "color": "#abc",
            "slots": [
                {"text": " Ja ", "symbol": "ja.png"},
                {"text": "Nein"},
            ],
        },
        {"active": False},
    ],
}


def main() -> int:
    done = layout.normalize_layout(RAW)

    # --- the top level ---------------------------------------------------
    check("Layout names exactly the keys that come out",
          set(done) == keys_of(layout.Layout),
          f"extra={sorted(set(done) - keys_of(layout.Layout))} "
          f"missing={sorted(keys_of(layout.Layout) - set(done))}")

    # --- a set -----------------------------------------------------------
    entry = done["sets"][0]
    check("SetEntry names exactly the keys of a set",
          set(entry) == keys_of(layout.SetEntry),
          f"extra={sorted(set(entry) - keys_of(layout.SetEntry))} "
          f"missing={sorted(keys_of(layout.SetEntry) - set(entry))}")

    # --- a slot ----------------------------------------------------------
    slot = entry["slots"][0]
    check("Slot names exactly the keys of a slot",
          set(slot) == keys_of(layout.Slot),
          f"extra={sorted(set(slot) - keys_of(layout.Slot))} "
          f"missing={sorted(keys_of(layout.Slot) - set(slot))}")

    # --- every set and slot, not just the first ---------------------------
    ragged = [i for i, e in enumerate(done["sets"])
              if set(e) != keys_of(layout.SetEntry)]
    check("every set has the same keys", not ragged, f"differing: {ragged}")
    odd = [(i, j) for i, e in enumerate(done["sets"])
           for j, s in enumerate(e["slots"]) if set(s) != keys_of(layout.Slot)]
    check("every slot has the same keys", not odd, f"differing: {odd}")

    # --- what normalize_layout promises the rest of the build -------------
    # The docstring in layout.py says the shape is complete whatever the file
    # was missing. These are the parts everything downstream stops checking.
    check("the missing slot was filled in",
          len(entry["slots"]) == layout.SLOTS_PER_SET,
          f"{len(entry['slots'])} slots")
    check("a set with nothing in it still comes out whole",
          set(done["sets"][1]) == keys_of(layout.SetEntry)
          and len(done["sets"][1]["slots"]) == layout.SLOTS_PER_SET)

    # --- empty_set is annotated SetEntry, so it has to be one -------------
    check("empty_set() matches SetEntry",
          set(layout.empty_set(0)) == keys_of(layout.SetEntry))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
