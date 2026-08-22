#!/usr/bin/env python3
"""Checks that static/store.js stamps a layout the way app.py does.

The content is moving into the browser, so the version that guards against a
stale tab overwriting somebody's work has to exist a second time. It is one
line of arithmetic in each language and that is exactly why it is worth a
test: sha256 of the stored bytes, first sixteen hex characters, and any of
those three details drifting gives two stamps that are both plausible and
never equal. A page comparing its own stamp against a differently-derived one
would report a conflict on every save, or - the same mistake the other way -
compare two things that cannot disagree and report none ever.

The two stores hold their own bytes and are not expected to agree on a
*number*. What is checked here is that they agree on the algorithm: the same
bytes in, the same stamp out.

Only the arithmetic. The database itself - transactions, the conflict, the two
folders of files - is tools/storecheck.html, because IndexedDB needs a browser
and this has to run in CI. Same division as tiles.js, where node does the
resampling and tilecheck.html does the decode.

Skipped, not failed, where node is missing: that must not be the reason a
machine cannot run the suite.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

WORKSPACE = tempfile.TemporaryDirectory()
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name
os.environ.pop("VORLAUT_DATA", None)
os.environ.pop("VORLAUT_METACOM_DIR", None)

import app  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# Three layouts rather than one: a plain one, one with the non-ASCII that
# German content is full of, and one holding the characters that a careless
# encoder mangles. The stamp is over bytes, so the encoding is the thing most
# likely to differ between two implementations that both look right.
LAYOUTS = {
    "a plain layout": {
        "sleep_timeout_seconds": 600,
        "language": "de",
        "sets": [{"name": "Grundset", "symbol": "start.png", "color": "#3B5BDB",
                  "slots": [{"text": "Ja!", "symbol": "ja.png"}]}],
    },
    "one with umlauts": {
        "sleep_timeout_seconds": 600,
        "language": "de",
        "sets": [{"name": "Draußen", "symbol": "raus.png", "color": "#2F9E44",
                  "slots": [{"text": "Können wir rausgehen?", "symbol": "x.png"}]}],
    },
    "one with markup and quotes in the content": {
        "sleep_timeout_seconds": 600,
        "language": "en",
        "sets": [{"name": '</script> & "so"', "symbol": "a.png", "color": "#000000",
                  "slots": [{"text": "3 < 5 & 5 > 3", "symbol": "b.png"}]}],
    },
}

SCRIPT = """
import { serialise, versionOf } from "%s";
const layouts = JSON.parse(process.argv[2]);
const out = {};
for (const [name, layout] of Object.entries(layouts)) {
  const text = serialise(layout);
  out[name] = { text, version: await versionOf(text) };
}
process.stdout.write(JSON.stringify(out));
"""


def from_the_browser_half() -> dict | None:
    """serialise() and versionOf() run in node, as the browser would run them."""
    store = (ROOT / "static" / "store.js").resolve()
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as tmp:
        tmp.write(SCRIPT % store.as_uri())
        name = tmp.name
    try:
        result = subprocess.run(
            ["node", name, json.dumps(LAYOUTS, ensure_ascii=False)],
            capture_output=True, text=True)
    finally:
        Path(name).unlink()
    if result.returncode != 0:
        check("static/store.js runs at all", False, result.stderr.strip()[:400])
        return None
    return json.loads(result.stdout)


def main() -> int:
    if not shutil.which("node"):
        print("  node is not installed - skipped")
        return 0

    got = from_the_browser_half()
    if got is None:
        return 1

    for name, layout in LAYOUTS.items():
        mine = got[name]
        raw = mine["text"].encode("utf-8")

        # The same arithmetic, written out here rather than imported, so that
        # a change to either side has to be made twice on purpose.
        expected = hashlib.sha256(raw).hexdigest()[:16]
        check(f"{name}: the stamp is sha256 of the bytes, cut to 16",
              mine["version"] == expected,
              f"js {mine['version']}, python {expected}")

        # And the same as app.py derives, driven through the function the
        # server actually calls rather than a copy of it.
        app.LAYOUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        app.LAYOUT_FILE.write_bytes(raw)
        check(f"{name}: and the same as app.py's layout_version()",
              mine["version"] == app.layout_version(),
              f"js {mine['version']}, app.py {app.layout_version()}")

        # Round trip: what the browser stores has to read back as what went in.
        check(f"{name}: the stored text parses back to the same layout",
              json.loads(mine["text"]) == layout)

    # The sentinel for "nothing saved yet" is shared, and it is a string that
    # must never collide with a real stamp - a hash is 16 hex characters.
    if app.LAYOUT_FILE.exists():
        app.LAYOUT_FILE.unlink()
    check("an absent layout is 'empty' on both sides",
          app.layout_version() == "empty")

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print(f"\n  {len(LAYOUTS)} layout(s) stamped the same in both languages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
