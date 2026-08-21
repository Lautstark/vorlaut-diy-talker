#!/usr/bin/env python3
"""The one place that touches .env.

Four things used to read this file: tts.py for the Azure settings, metacom.py
for the collection, app.py for the device key, and doctor.py with a loop of
its own. Now that the interface can write it too, four readers and one writer
would be four chances to disagree about what the file means.

The writing is the reason this module exists at all. .env is not only
configuration, it is also the documentation of its own settings - every entry
in .env.example carries the paragraph that explains it. So writing a value has
to leave the comments, the order and the blank lines exactly as they were.
Dumping a dictionary back out would produce a working file that nobody can
read afterwards.

Which is also why a commented-out entry gets uncommented rather than appended
to the end: the explanation above

    # Optional. Path to a licensed METACOM collection (the unpacked download).
    #VORLAUT_METACOM_DIR=/Users/you/METACOM_9_Desktop

belongs to that line, and a second VORLAUT_METACOM_DIR at the bottom of the
file would leave the paragraph pointing at nothing.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Overridable so a test can run against a file that is not the developer's
# own - see tests/test_pairing.py.
ENV_FILE = Path(os.environ.get("VORLAUT_ENV_FILE") or ROOT / ".env")

# KEY=value, with the key optionally commented out. Leading whitespace is
# allowed because people indent things.
LINE = re.compile(r"^(\s*)(#\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def read(path: Path | None = None) -> dict[str, str]:
    """Every live entry. Commented-out ones are not set and do not appear."""
    file = path or ENV_FILE
    values: dict[str, str] = {}
    try:
        text = file.read_text(encoding="utf-8")
    except OSError:
        return values
    for line in text.splitlines():
        found = LINE.match(line)
        if found and not found.group(2):
            values[found.group(3)] = unquote(found.group(4))
    return values


def value(name: str, standard: str = "") -> str:
    """From the environment, else from .env, else the default.

    A set environment variable wins - that way a single run can try something
    different without touching the file, and the container can hand things in
    without one existing at all.
    """
    found = os.environ.get(name, "").strip()
    if found:
        return found
    return read().get(name, "").strip() or standard


def needs_quotes(value: str) -> bool:
    """A value that would not survive being read back plainly."""
    return value != value.strip() or (value[:1] in "\"'" and value[-1:] in "\"'")


def render(name: str, value: str) -> str:
    return f'{name}="{value}"' if needs_quotes(value) else f"{name}={value}"


def write(updates: dict[str, str], path: Path | None = None) -> None:
    """Sets values, leaving everything else in the file exactly as it was.

    An entry that is already there is replaced where it stands. One that is
    commented out is woken up in place, under the paragraph that explains it.
    Anything genuinely new goes at the end. A value of "" removes the entry
    rather than writing an empty one, because empty and absent mean the same
    thing everywhere this file is read, and an empty line reads like a mistake.
    """
    file = path or ENV_FILE
    try:
        lines = file.read_text(encoding="utf-8").splitlines()
    except OSError:
        # A file written by the interface holds only what the interface set.
        # Deliberately not copied from .env.example: the entries there carry
        # placeholder values, and a copied "put-your-own-key-here" would read
        # back as a key that is set. A line pointing at the example does the
        # same job without that.
        lines = ["# Written by the vorlaut interface. Every setting there is,",
                 "# with the paragraph explaining it, is in .env.example.",
                 ""]

    remaining = dict(updates)
    out: list[str] = []
    for line in lines:
        found = LINE.match(line)
        name = found.group(3) if found else None
        if name is None or name not in remaining:
            out.append(line)
            continue
        wanted = remaining.pop(name)
        commented = bool(found.group(2))
        if not wanted:
            # Removing: a line that was live goes back to being an example,
            # so the paragraph above it still has something to point at.
            out.append(line if commented else f"#{render(name, found.group(4).strip())}")
            continue
        out.append(found.group(1) + render(name, wanted))

    # Whatever the file did not already know about.
    fresh = [(name, wanted) for name, wanted in remaining.items() if wanted]
    if fresh:
        if out and out[-1].strip():
            out.append("")
        for name, wanted in fresh:
            out.append(render(name, wanted))

    file.parent.mkdir(parents=True, exist_ok=True)
    # Written whole and moved into place: a half-written .env would take the
    # Azure key with it, and the next start would blame the key.
    interim = file.with_suffix(file.suffix + ".part")
    interim.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")
    interim.replace(file)
