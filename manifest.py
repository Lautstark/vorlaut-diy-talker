#!/usr/bin/env python3
"""What is actually lying in data/, and whether it still matches layout.json.

Split out of the layout module rather than left in it, because the question is
the other way round. Everything in layout.py answers "what did somebody type";
everything here answers "what did the last build leave behind" - and the two
disagreeing is the normal state of affairs, not a fault. That gap is the whole
point: it is what lets the page say "there is something newer" instead of
quietly handing the device yesterday's files.

The fingerprint is the hinge. It is taken from the layout, written into
cache/build-state.json when a build finishes, and compared back against the
layout on every query. The manifest is that same stamp plus the file list, in
the line format the device reads.
"""

from __future__ import annotations

import hashlib
import json

import config
import layout_format
import tiles
from buildbase import BuildError, write_json
from layout import (DEFAULT_LANGUAGE, Layout, active_sets, chosen_voice,
                    load_layout)

# Records which state was last built into data/.
BUILD_STATE = config.CONTENT / "cache" / "build-state.json"


def built_fingerprint(layout: Layout) -> str:
    """Identifier of what actually ends up in data/.

    Deliberately the active sets only: working on a switched-off set changes
    nothing on the device and should therefore not be reported as a rebuild.
    """
    payload = {
        "sleep": layout["sleep_timeout_seconds"],
        "language": layout.get("language", DEFAULT_LANGUAGE),
        # Another voice means other WAVs, even though not a letter of the
        # text changed. Without this the page would claim the device was up
        # to date while it still speaks in the old one.
        "voice": chosen_voice(layout),
        "sets": active_sets(layout),
        "pipeline": tiles.TILE_PIPELINE,
        "format": layout_format.LAYOUT_VERSION,
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def built_version() -> str:
    """The stamp of what is actually lying in data/ - empty if nothing is.

    Deliberately read from BUILD_STATE and not derived from layout.json. The
    stamp has to describe the FILES, because that is what the device compares
    against and then stores.

    It used to be built from the layout, and that was wrong in a way that only
    showed up in use: edit without releasing, and the manifest advertised a new
    version over the old files. The device fetched them, stored the new stamp -
    and after the release the stamp did not change any more, because the layout
    had not changed since. From then on the device saw its own version, thought
    it was up to date, and never fetched anything again.
    """
    if not (config.DATA_DIR / layout_format.LAYOUT_BIN).exists():
        return ""
    try:
        return json.loads(BUILD_STATE.read_text(encoding="utf-8"))["fingerprint"]
    except (OSError, json.JSONDecodeError, KeyError):
        return ""


def manifest_text(manifest: dict) -> str:
    """The manifest as lines, because the device has no JSON parser.

    That is the same reason layout.bin is binary: on the ESP32 a parser is a
    library, a heap and a class of failure that a fixed line format does not
    have. One keyword per line, values separated by single spaces:

        version 3f2a...
        current 1
        sets 5
        bytes 950272
        file t3bd7....bin 26912
        file a8c1....wav 41008

    Unknown keywords are meant to be skipped by the reader, so a field can be
    added later without the firmware in the field falling over.
    """
    lines = [
        f"version {manifest['version']}",
        f"current {1 if manifest['current'] else 0}",
        f"sets {manifest['sets']}",
        f"bytes {manifest['bytes']}",
    ]
    lines += [f"file {entry['name']} {entry['size']}"
              for entry in manifest["files"]]
    return "\n".join(lines) + "\n"


def device_manifest() -> dict:
    """What should sit on the device: version stamp and file list.

    The file names are hashes of their content - so this list is all the
    device needs to know what it is missing and what it can throw away. Only
    layout.bin always has the same name and gets fetched every time.
    """
    layout = load_layout()
    files = [
        {"name": f.name, "size": f.stat().st_size}
        for f in sorted(config.DATA_DIR.iterdir()) if f.is_file()
    ] if config.DATA_DIR.is_dir() else []
    return {
        "version": built_version(),
        # Whether what lies here is still what the layout says. The device can
        # use it to say "there is something newer" instead of silently
        # fetching yesterday's state.
        "current": build_is_current(layout),
        "sets": len(active_sets(layout)),
        "files": files,
        "bytes": sum(f["size"] for f in files),
    }


def _remember_build(layout: Layout) -> None:
    """Records which state has just been built into data/."""
    try:
        # No lock needed - this writes a fresh note rather than changing the
        # one that is there. Written whole all the same: /api/status reads it
        # on a request thread while a build is running, and half a file reads
        # back as "not current".
        write_json(BUILD_STATE, {"fingerprint": built_fingerprint(layout)})
    except OSError:
        pass   # without the note the interface says "rebuild" more often


def build_is_current(layout: Layout | None = None) -> bool:
    """Does data/ match the current layout?

    What goes undetected is a symbol file changing under the same name - that
    would mean hashing every image on every query.
    """
    if not (config.DATA_DIR / "layout.bin").exists():
        return False
    try:
        stored = json.loads(BUILD_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if layout is None:
        try:
            layout = load_layout()
        except BuildError:
            return False
    return stored.get("fingerprint") == built_fingerprint(layout)
