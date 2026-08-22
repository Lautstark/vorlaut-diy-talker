#!/usr/bin/env python3
"""The command: `python build.py --no-audio` and the rest of its flags.

There is no logic in this file, and no longer any surface either. The build
was 1181 lines doing four unrelated jobs - the layout, the pictures, the
binary format, the flashing - and those are now seven modules that can be
read one at a time:

    config.py          where content/ and data/ are
    buildbase.py       the error, and how files get written
    layout.py          layout.json - read, checked, written back
    tiles.py           a symbol reference, and the picture it becomes
    layout_format.py   layout.bin, the table the firmware reads
    manifest.py        what is in data/, and whether it is still current
    builder.py         the build itself, and the command line
    flashing.py        LittleFS image and esptool

For a while this file also re-exported all 81 names the old build.py had, so
that app.py and the tests could be left alone while the split was reviewed.
That scaffolding is gone: every caller now imports the module that owns the
name, and `import tiles` says where tile_bytes lives in a way that
`import build` never did.

What stays is the name of the command. The README, the docs and the workflows
all say `build.py`, and every habit agrees with them. The
argument parsing behind it is in builder.py, next to the build it starts.
"""

from __future__ import annotations

import sys

from builder import main

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
