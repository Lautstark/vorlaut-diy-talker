#!/usr/bin/env python3
"""layout.bin - the binary the firmware reads its table out of.

The table - how many sets, which colours, which file per key - sits with
the content and not in the firmware. Otherwise a new set would mean
reflashing over a cable.

Deliberately a fixed binary structure and not JSON: it lets the firmware
read field by field, without a parser.

  header  4  magic "MTRD"
          1  version
          1  number of sets
          1  keys per set
          1  language (index into LANGUAGES in firmware/vorlaut/texts.h)
          4  sleep timeout in seconds
  per set 2  colour as RGB565
         32  name, padded with null bytes
         16  hash of the set tile
            per key (4x):
         16     hash of the image
         16     hash of the audio
          1     1 = audio present
          1     reserved

This is the one contract in the project that is written down twice - here and
in firmware/vorlaut/layout_format.h. tests/test_layout_format.py compiles the
firmware's reader and compares it field by field with what this module writes,
which is why the strides below are spelled out as sums rather than as numbers:
the sum is the thing that has to keep agreeing.
"""

from __future__ import annotations

import struct
from pathlib import Path

import tiles
from layout import (
    DEFAULT_LANGUAGE,
    LANGUAGE_CODES,
    SLOTS_PER_SET,
    active_sets,
    hex_to_rgb,
)

LAYOUT_BIN = "layout.bin"
LAYOUT_MAGIC = b"MTRD"
LAYOUT_VERSION = 1

NAME_BYTES = 32
HASH_BYTES = 16
# Fixed strides - the firmware works with the same numbers.
SLOT_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1        # 34
SET_BYTES = 2 + NAME_BYTES + HASH_BYTES + SLOTS_PER_SET * SLOT_BYTES   # 186
HEADER_BYTES = 4 + 4 + 4                            # 12


def _hash_bytes(filename: str) -> bytes:
    """The 16 raw hash bytes out of "t3bd7a62….bin"."""
    if not filename:
        return b"\x00" * HASH_BYTES
    core = Path(filename).stem[1:]           # drop the leading t or a
    return bytes.fromhex(core)[:HASH_BYTES].ljust(HASH_BYTES, b"\x00")


def render_layout_bin(layout: dict, label_files, tile_files, audio_files) -> bytes:
    # The active sets only - the file lists are built the same way, and
    # setCount in the header has to match them.
    sets = active_sets(layout)
    data = bytearray()
    data += LAYOUT_MAGIC
    language = LANGUAGE_CODES.get(layout.get("language", DEFAULT_LANGUAGE),
                                  LANGUAGE_CODES[DEFAULT_LANGUAGE])
    data += struct.pack("<BBBB", LAYOUT_VERSION, len(sets), SLOTS_PER_SET,
                        language)
    data += struct.pack("<I", layout["sleep_timeout_seconds"])
    for index, entry in enumerate(sets):
        data += struct.pack("<H", tiles.rgb_to_565(*hex_to_rgb(entry["color"])))
        data += entry["name"].encode("utf-8")[:NAME_BYTES].ljust(NAME_BYTES, b"\x00")
        data += _hash_bytes(label_files[index])
        for slot in range(SLOTS_PER_SET):
            ton = audio_files[index][slot]
            data += _hash_bytes(tile_files[index][slot])
            data += _hash_bytes(ton)
            data += struct.pack("<BB", 1 if ton else 0, 0)
    return bytes(data)
