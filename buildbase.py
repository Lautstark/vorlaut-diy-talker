#!/usr/bin/env python3
"""What every part of the build stands on: its error, and how it writes files.

Three things, and they are here rather than in one of the modules above
because all of those need them and none of them owns them. BuildError is
raised from the layout, from the tiles and from the flashing tools alike;
write_json is what the tile index, the build state and the speech index are
all written with; short() is how any of them names a path in the log.

The alternative was for one module to hold them and the others to import that
one sideways - which would have made whichever module drew the short straw
look like the base of the build without being it.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import config
import texts


def write_json(path: Path, data: dict) -> None:
    """Writes the file whole and moves it into place.

    A lock only reaches the threads of one process. `--prune-cache` runs in a
    second one while the server is up, and a reader that catches a
    half-written index gets a JSONDecodeError - which tiles.load_tile_index()
    and tts.load_index() both answer with {}. The next write then persists
    that empty dict over every entry there was. os.replace swaps the finished
    file in in one step, so a reader sees either the whole old index or the
    whole new one.

    The interim file carries process and thread in its name for the same
    reason: one shared .part would be the race again, one step further down.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    interim = path.with_name(f"{path.name}.{os.getpid()}-{threading.get_ident()}.part")
    interim.write_text(
        json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(interim, path)


def short(path: Path) -> str:
    """A path as it reads best in the log.

    Relative to the project as long as it lies inside it - that is the normal
    case and the short one. Once VORLAUT_CONTENT points somewhere else it does
    not, and then the full path is the useful thing anyway: it says which copy
    was just written.
    """
    try:
        return str(path.relative_to(config.ROOT))
    except ValueError:
        return str(path)


class BuildError(RuntimeError):
    """A build that stopped, in a form that can still be translated.

    The message is carried as a key and its values, not as a finished
    sentence: the same error goes to a terminal in English and into the web
    interface in whatever language layout.json asks for. str() renders
    English, so tracebacks and the command line stay readable without anyone
    having to think about it.
    """

    def __init__(self, key: str, **params):
        self.key = key
        self.params = params
        super().__init__(texts.t(key, **params))

    def message(self, lang: str) -> str:
        return texts.t(self.key, lang, **self.params)
