#!/usr/bin/env python3
"""Checks that the METACOM search index is built once, and not again for the
same collection under a different name.

Building it means walking 17,114 files and opening a 143 MB archive to read the
keyword database out of it - half a minute on a mounted folder. Everything that
touches a metacom: symbol waits for that: resolving one for a preview tile,
/api/sources, /api/settings. So it is cached, and the two ways of getting the
cache wrong both cost that half minute rather than breaking anything, which is
why neither was noticed.

The first was the fingerprint. It began with the absolute path of the symbol
folder - and the same download is /Users/you/METACOM_9_Desktop from a terminal
and /metacom inside the container, while both write the same content/cache.
Every hop between the two therefore looked like a different collection and
rebuilt an index that came out identical.

The second was that nothing serialised the build. _cache is only assigned once
_build_index() returns, so the five keys of a set, plus the two endpoints the
page asks on load, each found an empty cache and started their own - six walks
of the same collection, six writes of the same file.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Set before metacom is imported: config.py resolves the content directory at
# import time and CACHE_FILE is derived from it, so without this the test would
# read and overwrite the developer's own index.
WORKSPACE = tempfile.TemporaryDirectory()
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name

import metacom  # noqa: E402

failures: list[str] = []

# Six is what the page really asks with: one per key of a set, plus
# /api/sources and /api/settings. Enough that they overlap for certain.
CALLERS = 6


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def build_collection(where: Path, symbols: list[str]) -> Path:
    """A collection with the structure metacom.py looks for.

    Not a real one: the archive is a few bytes of nonsense, which _load_database
    answers by carrying on without keywords. That is a supported case in its own
    right - "a different METACOM, a different packaging format" - and it is the
    file's identity this test is about, not its contents.
    """
    folder = where / metacom.SYMBOL_SUBDIR
    folder.mkdir(parents=True, exist_ok=True)
    for name in symbols:
        (folder / f"{name}.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    archive = where / "MetaSearch" / "app.asar"
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_bytes(b"not really an asar")
    return where


def use(where: Path) -> None:
    """Point at a collection, and forget everything about the last one."""
    os.environ["VORLAUT_METACOM_DIR"] = str(where)
    metacom._cache = None
    metacom.CACHE_FILE.unlink(missing_ok=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as scratch:
        home = Path(scratch)
        symbols = [f"symbol{n}" for n in range(12)]

        # --- the fingerprint does not move with the mount -------------------
        # Two paths, one collection - the case that is a terminal and a
        # container looking at the same folder.
        here = build_collection(home / "METACOM_9_Desktop", symbols)
        there = build_collection(home / "metacom", symbols)
        # Same file, byte for byte and second for second: what differs between
        # the two is only where it is.
        stamp = (here / "MetaSearch" / "app.asar").stat()
        os.utime(there / "MetaSearch" / "app.asar", (stamp.st_atime, stamp.st_mtime))

        use(here)
        native = metacom._fingerprint()
        use(there)
        mounted = metacom._fingerprint()

        check("the same collection fingerprints the same under two paths",
              native == mounted, native)
        check("and the path is not in it",
              str(home) not in native, native)

        # A changed collection still has to be noticed - the whole point of a
        # fingerprint. A newer archive is what a METACOM update looks like.
        os.utime(there / "MetaSearch" / "app.asar",
                 (stamp.st_atime, stamp.st_mtime + 3600))
        check("a changed archive still invalidates it",
              metacom._fingerprint() != mounted)

        # --- one build, however many ask -----------------------------------
        use(here)
        builds = []
        real_build = metacom._build_index

        def counted() -> dict:
            builds.append(1)
            time.sleep(0.2)     # long enough that the others really pile up
            return real_build()

        metacom._build_index = counted
        try:
            answers: list[dict] = [None] * CALLERS      # type: ignore[list-item]
            start = threading.Barrier(CALLERS)

            def ask(slot: int) -> None:
                start.wait()
                answers[slot] = metacom.index()

            threads = [threading.Thread(target=ask, args=(n,))
                       for n in range(CALLERS)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        finally:
            metacom._build_index = real_build

        check(f"{CALLERS} callers at once build the index once",
              len(builds) == 1, f"{len(builds)} build(s)")
        check("and every one of them gets it",
              all(a is not None and len(a.get("entries") or []) == len(symbols)
                  for a in answers))
        check("all of them the same object, not a copy each",
              all(a is answers[0] for a in answers))

        # --- and it survives to the next start ------------------------------
        try:
            stored = json.loads(metacom.CACHE_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            stored = {}
        check("the cache file is written whole",
              stored.get("version") == metacom.CACHE_VERSION
              and stored.get("fingerprint") == native)

        # A fresh process finds it and does not build again - and neither does
        # the same file reached under the other path, which is the half minute
        # this is all about.
        metacom._cache = None
        os.environ["VORLAUT_METACOM_DIR"] = str(there)
        os.utime(there / "MetaSearch" / "app.asar", (stamp.st_atime, stamp.st_mtime))
        builds.clear()
        metacom._build_index = counted
        try:
            reused = metacom.index()
        finally:
            metacom._build_index = real_build
        check("the other path reads that same cache instead of rebuilding",
              not builds and len(reused.get("entries") or []) == len(symbols))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
