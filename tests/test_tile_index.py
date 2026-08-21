#!/usr/bin/env python3
"""Checks that the tile index survives being written from several threads.

content/cache/tiles/index.json maps a tile fingerprint back to the symbol it
was made from - it is what turns "removed: t3bd7....bin" into "removed:
tile ja.png". It is read, changed and written back on every tile.

Which happens on request threads: the preview grid asks the server for five
tiles of a set at once, and ThreadingHTTPServer answers each one in a thread
of its own. So the interesting case is not one caller but five, and two
mistakes are possible there. Threads that read the same dict and write it
back one after another keep only the last change. Worse, a reader that
catches the file half written gets a JSONDecodeError, which load_tile_index()
answers with {} - and the next write would persist that empty dict over
everything the index knew.

Neither shows up in normal use: nothing breaks, the log just gets less
readable. That is exactly why it needs a test - nobody would notice.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Set before the build modules are imported: config.py resolves the content
# directory at import time, and this test writes a cache. Without this it
# would be the developer's own.
WORKSPACE = tempfile.TemporaryDirectory()
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name
os.environ.pop("VORLAUT_DATA", None)
os.environ.pop("VORLAUT_METACOM_DIR", None)

import manifest  # noqa: E402
import tiles  # noqa: E402
from builder import prune_cache  # noqa: E402
from layout import load_layout, save_layout  # noqa: E402

failures: list[str] = []

# Enough of both that the threads really overlap: with one symbol they would
# only race once, and with one thread not at all.
SYMBOLS = 24
WRITERS = 6
READERS = 3
ROUNDS = 3


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def make_symbols() -> list[str]:
    """One small PNG per symbol, each with content of its own.

    The fingerprint is taken from the file content, so symbols that look alike
    would share one entry and the index would stay short for a legitimate
    reason - which is the one thing this test must not confuse with the bug.
    """
    from PIL import Image

    tiles.SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    names = []
    for i in range(SYMBOLS):
        name = f"sym{i:02d}.png"
        colour = (i * 9 % 256, (i * 37 + 20) % 256, (i * 71 + 90) % 256)
        Image.new("RGB", (16 + i, 16), colour).save(tiles.SYMBOLS_DIR / name)
        names.append(name)
    return names


def hammer(names: list[str]) -> list[list[int]]:
    """Every symbol through every writer, while readers watch the file.

    The readers are the second half of the test: each one records how many
    entries the index held every time it looked. Entries are only ever added
    here, so a count that goes down means that reader saw a file that was not
    whole. One list per reader - counts from three threads in one list say
    nothing about the order they happened in.
    """
    seen: list[list[int]] = [[] for _ in range(READERS)]
    done = threading.Event()
    start = threading.Barrier(WRITERS + READERS)

    def write(offset: int) -> None:
        start.wait()
        for round_number in range(ROUNDS):
            # A different order per thread, so they do not simply queue up
            # behind each other doing the same work at the same time.
            for i in range(len(names)):
                turn = (i * (offset + 1) + round_number) % len(names)
                tiles.tile_bytes(names[turn])

    def read(number: int) -> None:
        start.wait()
        while not done.is_set():
            seen[number].append(len(tiles.load_tile_index()))

    readers = [threading.Thread(target=read, args=(n,)) for n in range(READERS)]
    writers = [threading.Thread(target=write, args=(n,)) for n in range(WRITERS)]
    for thread in readers + writers:
        thread.start()
    for thread in writers:
        thread.join()
    done.set()
    for thread in readers:
        thread.join()
    return seen


def main() -> int:
    with WORKSPACE:
        try:
            names = make_symbols()
        except ImportError:
            print("  Pillow is missing - install requirements.txt")
            return 1

        seen = hammer(names)
        index = tiles.load_tile_index()
        expected = {tiles.tile_fingerprint(name): name for name in names}

        check("every symbol has an entry", index == expected,
              f"{len(index)} of {len(expected)}")
        check("and a tile file to go with it",
              len(list(tiles.TILE_CACHE.glob("*.bin"))) == len(expected))

        shrank = [
            (before, after)
            for counts in seen
            for before, after in zip(counts, counts[1:])
            if after < before
        ]
        check("no reader ever saw the index shrink", not shrank,
              f"{shrank[:3]}" if shrank else "")
        check("and none saw it empty once it had entries",
              not [counts for counts in seen
                   if any(later == 0 for later in counts[counts.index(1):])
                   if 1 in counts])
        check("the readers looked often enough to mean something",
              all(len(counts) > SYMBOLS for counts in seen),
              f"{[len(counts) for counts in seen]}")
        check("nothing is left half written",
              not list(tiles.TILE_CACHE.glob("*.part")))

        # --- pruning takes the entries with it -----------------------------
        keep = names[:2]
        save_layout({
            "sleep_timeout_seconds": 600,
            "sets": [{
                "name": "Test", "symbol": keep[0], "color": "#3B5BDB",
                "slots": [{"text": "Ja", "symbol": keep[1]}]
                + [{"text": "", "symbol": ""}] * 3,
            }],
        })
        prune_cache()
        after = tiles.load_tile_index()
        check("pruning keeps what the layout still names",
              all(tiles.tile_fingerprint(name) in after for name in keep),
              f"{sorted(after.values())}")
        check("and drops the rest",
              not any(tiles.tile_fingerprint(name) in after
                      for name in names[2:]))
        check("without leaving a half written index",
              not list(tiles.TILE_CACHE.glob("*.part")))

        # --- the build note ------------------------------------------------
        # Written on every build and read by /api/status on a request thread,
        # so it has the same half-file problem even though nothing changes it.
        layout = load_layout()
        manifest._remember_build(layout)
        try:
            stored = json.loads(manifest.BUILD_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            stored = {}
        check("the build note is written whole",
              stored.get("fingerprint") == manifest.built_fingerprint(layout))
        check("and leaves nothing behind",
              not list(manifest.BUILD_STATE.parent.glob("*.part")))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
