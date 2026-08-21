#!/usr/bin/env python3
"""The name the rest of the project still calls the build by.

There is no logic in this file. It was 1181 lines doing four unrelated jobs -
the layout, the pictures, the binary format, the flashing - and those are now
four modules that can be read one at a time:

    config.py          where content/ and data/ are
    buildbase.py       the error, and how files get written
    layout.py          layout.json - read, checked, written back
    tiles.py           a symbol reference, and the picture it becomes
    layout_format.py   layout.bin, the table the firmware reads
    manifest.py        what is in data/, and whether it is still current
    builder.py         the build itself, and the command line
    flashing.py        LittleFS image and esptool

What kept the split from being a rewrite is this file. Six modules reach into
build - app.py and five tests - for 45 different names, private ones included,
and rewriting all six in the same commit would have made the change
unreviewable. So every name that was here is still here, bound to the module
it moved to. `import build` and `build.load_layout` work exactly as before.

New code should import the module it actually means. This one stays for as
long as the callers do, and there is no rush about that: a facade over a clean
split costs nothing to keep.
"""

from __future__ import annotations

import sys

from buildbase import BuildError, short, write_json
from builder import build, main, prune_cache
from config import CONTENT, DATA_DIR, ROOT, SKETCH_DIR
from flashing import (
    FS_IMAGE,
    FS_OFFSET,
    FS_SIZE,
    build_fs_image,
    find_tool,
    merge_fs_image,
)
from layout import (
    BACKUP_DIR,
    BACKUP_MIN_INTERVAL,
    DEFAULT_COLOR,
    DEFAULT_LANGUAGE,
    DEFAULT_PALETTE,
    DEFAULT_SLEEP_TIMEOUT,
    EXAMPLE,
    EXAMPLE_SPEECH,
    KEEP_BACKUPS,
    LANGUAGE_CODES,
    LAYOUT_FILE,
    MAX_ACTIVE_SETS,
    MAX_SETS,
    SLOTS_PER_SET,
    Layout,
    SetEntry,
    Slot,
    active_sets,
    backup_layout,
    chosen_voice,
    empty_set,
    ensure_content,
    example_voice,
    hex_to_rgb,
    load_layout,
    normalize_color,
    normalize_layout,
    save_layout,
    seed_example_speech,
)
from layout_format import (
    HASH_BYTES,
    HEADER_BYTES,
    LAYOUT_BIN,
    LAYOUT_MAGIC,
    LAYOUT_VERSION,
    NAME_BYTES,
    SET_BYTES,
    SLOT_BYTES,
    _hash_bytes,
    render_layout_bin,
)
from manifest import (
    BUILD_STATE,
    _remember_build,
    build_is_current,
    built_fingerprint,
    built_version,
    device_manifest,
    manifest_text,
)
from tiles import (
    BORDER,
    IMG_SIZE,
    METACOM_PREFIX,
    SYMBOLS_DIR,
    TILE_CACHE,
    TILE_INDEX,
    TILE_PIPELINE,
    TILE_SIZE,
    _index_lock,
    _require_pillow,
    fill_colour,
    load_tile_index,
    missing_hint,
    render_symbol,
    rgb_to_565,
    symbol_path,
    tile_bytes,
    tile_fingerprint,
    to_rgb565_be,
)

# Spelled out rather than left to the imports above, for two reasons. It says
# which names are the surface and which are incidental, and it stops a linter
# from tidying away imports that look unused because the users of them are in
# other files.
__all__ = [
    "Layout",
    "SetEntry",
    "Slot",
    "BACKUP_DIR", "BACKUP_MIN_INTERVAL", "BORDER", "BUILD_STATE", "BuildError",
    "CONTENT", "DATA_DIR", "DEFAULT_COLOR", "DEFAULT_LANGUAGE",
    "DEFAULT_PALETTE", "DEFAULT_SLEEP_TIMEOUT", "EXAMPLE", "EXAMPLE_SPEECH",
    "FS_IMAGE", "FS_OFFSET", "FS_SIZE", "HASH_BYTES", "HEADER_BYTES",
    "IMG_SIZE", "KEEP_BACKUPS", "LANGUAGE_CODES", "LAYOUT_BIN", "LAYOUT_FILE",
    "LAYOUT_MAGIC", "LAYOUT_VERSION", "MAX_ACTIVE_SETS", "MAX_SETS",
    "METACOM_PREFIX", "NAME_BYTES", "ROOT", "SET_BYTES", "SKETCH_DIR",
    "SLOTS_PER_SET", "SLOT_BYTES", "SYMBOLS_DIR", "TILE_CACHE", "TILE_INDEX",
    "TILE_PIPELINE", "TILE_SIZE", "active_sets", "backup_layout", "build",
    "build_fs_image", "build_is_current", "built_fingerprint", "built_version",
    "chosen_voice", "device_manifest", "empty_set", "ensure_content",
    "example_voice", "fill_colour", "find_tool", "hex_to_rgb", "load_layout",
    "load_tile_index", "main", "manifest_text", "merge_fs_image",
    "missing_hint", "normalize_color", "normalize_layout", "prune_cache",
    "render_layout_bin", "render_symbol", "rgb_to_565", "save_layout",
    "seed_example_speech", "short", "symbol_path", "tile_bytes",
    "tile_fingerprint", "to_rgb565_be", "write_json",
    # Private by name, and reached into all the same - by app.py for Pillow,
    # by tests/test_tile_index.py and tests/test_layout_format.py. Listed
    # because leaving them out would say they had gone away.
    "_hash_bytes", "_index_lock", "_remember_build", "_require_pillow",
]

# `python build.py --no-audio` is what the README, the docs and every habit
# say, so the entry point stays where it has always been. The argument parsing
# behind it is in builder.py with the build it starts.
if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
