#!/usr/bin/env python3
"""The one place that touches .env, and where the shared paths live.

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

The paths below are here for a related reason. VORLAUT_CONTENT decides where
your content sits, and build, tts and metacom all have to arrive at the same
answer. They used to work it out separately, three copies of one line, and
metacom carried a comment explaining that importing build would make a cycle.
This module imports nothing from the project, so nobody has to weigh that
trade-off any more: the paths are read once, here, and everything else asks.
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Everything that belongs to you - layout, symbols, spoken sentences - sits
# content/ and is deliberately not versioned. The location can be moved,
# for instance onto a network share:  VORLAUT_CONTENT=/volume1/talker
CONTENT = Path(os.environ.get("VORLAUT_CONTENT") or ROOT / "content").resolve()

# Arduino requires the sketch folder to have the same name as the .ino file,
# and the LittleFS uploader looks for data/ right next to it. Hence this level.
SKETCH_DIR = ROOT / "firmware" / "vorlaut"
# What the device gets. Normally next to the sketch, because Arduino's LittleFS
# uploader looks for data/ there.
#
# But it follows VORLAUT_CONTENT: whoever points the content somewhere else is
# working on a copy, and a build must not then overwrite the real device data.
# Without this, testing against a copy quietly wiped the actual firmware/
# vorlaut/data/ - it happened three times before it was noticed, and nothing
# in the output said so.
#
# VORLAUT_DATA overrides both, for the case where the two really do belong
# apart.
DATA_DIR = Path(
    os.environ.get("VORLAUT_DATA")
    or (CONTENT / "data" if os.environ.get("VORLAUT_CONTENT")
        else SKETCH_DIR / "data")
).resolve()

# Overridable so a test can run against a file that is not the developer's
# own - see tests/test_pairing.py.
ENV_FILE = Path(os.environ.get("VORLAUT_ENV_FILE") or ROOT / ".env")

# KEY=value, with the key optionally commented out. Leading whitespace is
# allowed because people indent things.
LINE = re.compile(r"^(\s*)(#\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")

# Writing is: read the whole file, change a line, put it back. The interface
# answers on a threading server, so two settings dialogs saving at the same
# moment would both start from the file as it was before either of them, and
# one of the two saves would vanish without anything to show for it. One lock
# for the one writer there is - nothing outside this process writes .env while
# the server is running.
LOCK = threading.Lock()


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def one_line(value: str) -> str:
    """A value that cannot break the line it is written on.

    read() takes the file apart with splitlines(), so a break anywhere in a
    value would leave the rest of it standing as a line of its own - a line
    that belongs to no entry and that nothing reads again. Values arrive from
    a form now, which is exactly where a stray break comes from: a key pasted
    across two lines is stored as the one key it is, and since the interface
    shows the file back afterwards, whoever saved it sees what was stored.
    """
    return "".join(value.splitlines())


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


def from_environment(name: str) -> bool:
    """Whether this setting is being handed in rather than read from .env.

    The other side of value()'s precedence, and the question anything writing
    .env has to ask first: a line written under a set environment variable
    never reaches the process that wrote it. It is not a saved setting, it is
    a note in a file nobody rereads.
    """
    return bool(os.environ.get(name, "").strip())


def needs_quotes(value: str) -> bool:
    """A value that would not survive being read back plainly."""
    if not value:
        # Spelled out because "" is in every string: without this, an empty
        # value would ask for quotes it has no ends to put them on.
        return False
    return value != value.strip() or (value[0] in "\"'" and value[-1] in "\"'")


def render(name: str, value: str) -> str:
    return f'{name}="{value}"' if needs_quotes(value) else f"{name}={value}"


def write(updates: dict[str, str], path: Path | None = None) -> None:
    """Sets values, leaving everything else in the file exactly as it was.

    An entry that is already there is replaced where it stands. One that is
    commented out is woken up in place, under the paragraph that explains it.
    Anything genuinely new goes at the end. A value of "" removes the entry
    rather than writing an empty one, because empty and absent mean the same
    thing everywhere this file is read, and an empty line reads like a mistake.

    A key can stand in the file more than once - people were told to add live
    entries by hand, and the example above theirs is still in .env.example.
    The value goes on the last live one, because that is the one read()
    answers with, and any earlier live one goes back to being an example.
    Writing the first while reading the last would mean a save that quietly
    does nothing: the interface reads the file back instead of echoing, so it
    would show the old value with no error anywhere.
    """
    file = path or ENV_FILE
    updates = {name: one_line(wanted) for name, wanted in updates.items()}

    with LOCK:
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

        # Where each key already stands, live and commented out kept apart.
        live: dict[str, list[int]] = {}
        commented: dict[str, list[int]] = {}
        for index, line in enumerate(lines):
            found = LINE.match(line)
            if found and found.group(3) in updates:
                where = commented if found.group(2) else live
                where.setdefault(found.group(3), []).append(index)

        # Decided before anything is written: which line carries the value
        # afterwards, and which lines stop being live.
        carries: dict[int, str] = {}
        retire: set[int] = set()
        for name, wanted in updates.items():
            here = live.get(name, [])
            if not wanted:
                # Every copy, or the key is still set after being removed.
                retire.update(here)
            elif here:
                carries[here[-1]] = name
                retire.update(here[:-1])
            elif name in commented:
                carries[commented[name][0]] = name

        out: list[str] = []
        for index, line in enumerate(lines):
            found = LINE.match(line)
            if index in carries:
                name = carries[index]
                out.append(found.group(1) + render(name, updates[name]))
            elif index in retire:
                # A line that was live goes back to being an example, so the
                # paragraph above it still has something to point at.
                out.append(f"#{render(found.group(3), unquote(found.group(4)))}")
            else:
                out.append(line)

        # Whatever the file did not already know about.
        fresh = [(name, wanted) for name, wanted in updates.items()
                 if wanted and name not in live and name not in commented]
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
