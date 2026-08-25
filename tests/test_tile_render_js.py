#!/usr/bin/env python3
"""Checks that src/data/tiles.ts still renders the tiles tiles.py rendered.

The app moved into the browser, and render_symbol() existed twice while it
did. Two implementations of one thing drift, and this one drifting is
expensive in a particular way: the tile file name is a hash over the symbol and
TILE_PIPELINE, so the day the JavaScript starts producing different bytes
under the same name, every device carries a mixture of old and new tiles and
nothing says so.

What changed here, and why. This test used to build its inputs with
Image.new() and take its expected bytes from tiles.render_symbol(), which made
both sides of the comparison things Pillow worked out afresh on every run -
fine while Pillow was installed, and nothing at all once it was not. So
tools/tilefreeze.py wrote down what a known Pillow produced while there was
still one to ask, and this reads that. The tool and the renderer went with the
Python half, 2026-08-22; the recording is what is left of them, its provenance
is in tests/reference/tiles.lock.json, and nothing in the repository can write
it again. If TILE_PIPELINE ever bumps on purpose, refreezing means restoring
tiles.py and the tool from git for as long as that takes, not editing the lock
by hand (docs/frozen-references.md, "Tile rendering").

The Python half is now gone, and this is what is left of that comparison:

  node against the frozen bytes     the whole of it. Needs nothing but node.
  the constants                     TILE_PIPELINE and the sizes, read out of
                                    src/data/tiles.ts as text. Needs not even
                                    that.

There used to be a third, tiles.py against the same bytes, which is what
caught the renderer and the fixtures drifting apart in opposite directions.
Nothing replaces it: from here the frozen bytes are the only opinion there is
about what a tile should look like, and they only answer for the fourteen
symbols in tests/reference/tiles/.

tools/tilecheck.py was the thorough version, in a real browser: the one step
left out here is decoding the PNG, which the fixtures are frozen after. It
measured that lossless for these symbols - once, by hand - and it went with
the Python half too, so the decode is now checked by nothing.
docs/frozen-references.md lists that among the gaps.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The browser half is TypeScript now, so plain `node` cannot run these
# harnesses. vite-node can - it is vitest's own loader, already installed, and
# it resolves imports exactly the way the bundle does. Deliberately no build
# step in between: a frozen reference compared against compiled output has
# stopped measuring the source it names.
#
# The binary rather than `npx vite-node`, because npx reads its first argument
# as a command name and would try to execute the harness itself.
JS_RUNNER = str(ROOT / "node_modules" / ".bin" / "vite-node")


def have_js() -> bool:
    """Whether the loader is installed. `npm install` puts it there."""
    return Path(JS_RUNNER).exists()

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

MODULE = ROOT / "src" / "data" / "tiles.ts"
REFERENCE = ROOT / "tests" / "reference"
LOCK = REFERENCE / "tiles.lock.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def constant(source: str, name: str, depth: int = 4) -> str | None:
    """The literal a `export const NAME = ...;` line gives.

    Read out of the text rather than out of node, so that this half of the
    test still runs where node does not. Trailing comments are ordinary on
    these lines, so the value ends at the semicolon, not at the newline.

    One constant may be spelled as another - TILE_SIZE is IMG_SIZE, which is
    how the module says the tile is the whole display rather than a square
    inside it - so a value that is itself a name here is followed. Bounded,
    because a file that has managed to define two constants as each other
    should fail rather than hang.
    """
    for _ in range(depth):
        found = re.search(rf"^export const {name} = ([^;]+);", source, re.M)
        if not found:
            return None
        value = found.group(1).strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", value):
            return value
        name = value
    return None


def check_constants(lock: dict) -> None:
    source = MODULE.read_text(encoding="utf-8")
    check("the JavaScript declares TILE_PIPELINE",
          constant(source, "TILE_PIPELINE") is not None)
    # Against the lock file rather than against tiles.py, so this keeps
    # working when there is no tiles.py. The number in the lock file came from
    # tiles.py when the fixtures were frozen, and a bump on either side is
    # meant to invalidate them - which is exactly what this reports.
    agrees = constant(source, "TILE_PIPELINE") == str(lock["tile_pipeline"])
    check("and it is the number the frozen tiles were rendered under", agrees,
          "" if agrees else
          f"js {constant(source, 'TILE_PIPELINE')} vs frozen "
          f"{lock['tile_pipeline']} - if the bump is deliberate, refreezing "
          f"means restoring tiles.py and tools/tilefreeze.py from git for as "
          f"long as that takes - docs/frozen-references.md, under Tile "
          f"rendering")
    check("IMG_SIZE agrees", constant(source, "IMG_SIZE") == str(lock["img_size"]))
    # TILE_SIZE rather than the BORDER that used to be checked here. The tile
    # was the square inside a six-pixel border and is the whole display area
    # now, so there is no border to agree about - and the size is the constant
    # that actually decides the bytes, which the border only ever did by
    # subtraction.
    check("TILE_SIZE agrees", constant(source, "TILE_SIZE") == str(lock["tile_size"]),
          f"js {constant(source, 'TILE_SIZE')} vs frozen {lock['tile_size']}")


# What node runs. Everything the browser contributes - decoding the PNG - is
# replaced by the pixels the fixture holds, because the point here is the
# arithmetic after that, and a PNG decoder in node would be a third thing to
# keep honest. gunzip is in node's standard library, so this still needs
# nothing installed.
DRIVER = """
import fs from "node:fs";
import zlib from "node:zlib";
const tiles = await import(process.argv[2]);
const plan = JSON.parse(fs.readFileSync(process.argv[3], "utf-8"));
for (const item of plan) {
  let bytes;
  if (item.pixels === null) {
    bytes = tiles.toRgb565Be(tiles.placeholder());
  } else {
    const data = new Uint8ClampedArray(zlib.gunzipSync(fs.readFileSync(item.pixels)));
    const pixels = { data, width: item.width, height: item.height };
    const ground = tiles.fillColour(pixels);
    const [w, h] = tiles.thumbnailSize(item.width, item.height);
    const offset = [
      Math.floor((tiles.TILE_SIZE - w) / 2),
      Math.floor((tiles.TILE_SIZE - h) / 2),
    ];
    bytes = tiles.toRgb565Be(tiles.compose(tiles.thumbnail(pixels, w, h), ground, offset));
  }
  fs.writeFileSync(item.out, bytes);
}
console.log("done");
"""


def differing_pixels(expected: bytes, actual: bytes) -> int:
    return sum(1 for i in range(0, len(expected), 2)
               if expected[i:i + 2] != actual[i:i + 2])


def compare(name: str, who: str, expected: bytes, actual: bytes, total: int) -> None:
    if len(actual) != len(expected):
        check(f"{name} is the right size, from {who}", False,
              f"{len(actual)} bytes, expected {len(expected)}")
        return
    differing = differing_pixels(expected, actual)
    check(f"{name} is byte for byte the frozen tile, from {who}", differing == 0,
          f"{differing} of {total} pixels differ")


def check_fixtures_are_intact(lock: dict) -> None:
    """The frozen answer is about these pixels and no others."""
    bad = []
    for entry in lock["fixtures"]:
        if entry["pixels"] is None:
            continue
        raw = gzip.decompress((REFERENCE / entry["pixels"]).read_bytes())
        if hashlib.sha256(raw).hexdigest() != entry["pixels_sha256"]:
            bad.append(entry["name"])
        elif len(raw) != entry["width"] * entry["height"] * 4:
            bad.append(entry["name"] + " (size)")
    check("every frozen input is the picture that was rendered", not bad,
          "" if not bad else
          f"changed: {', '.join(bad)} - restore them from git rather than "
          f"editing. A deliberately different input is a refreeze - restore "
          f"tiles.py and tools/tilefreeze.py from git for as long as that "
          f"takes - and the tiles change with it")


def check_against_node(lock: dict, work: Path) -> None:
    plan = []
    for entry in lock["fixtures"]:
        plan.append({
            "name": entry["name"],
            "pixels": None if entry["pixels"] is None
                      else str(REFERENCE / entry["pixels"]),
            "width": entry["width"], "height": entry["height"],
            "out": str(work / f"{entry['name']}.js.bin"),
        })
    plan_file = work / "plan.json"
    plan_file.write_text(json.dumps(plan), encoding="utf-8")
    driver = work / "driver.mjs"
    driver.write_text(DRIVER, encoding="utf-8")

    result = subprocess.run(
        [JS_RUNNER, str(driver), MODULE.as_uri(), str(plan_file)],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("node ran src/data/tiles.ts", False, result.stderr.strip()[:400])
        return
    check("node ran src/data/tiles.ts", True)

    total = lock["tile_size"] ** 2
    for entry in lock["fixtures"]:
        expected = (REFERENCE / entry["expected"]).read_bytes()
        compare(entry["name"], "node",
                expected, (work / f"{entry['name']}.js.bin").read_bytes(), total)


def main() -> int:
    if not MODULE.is_file():
        print(f"  {MODULE} is missing")
        return 1
    if not LOCK.is_file():
        print(f"  {LOCK} is missing - restore it from git. It is frozen "
              f"Pillow output, the tool that wrote it went with the Python "
              f"half, and there is nothing to compare against without it.")
        return 1

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    check_constants(lock)
    check_fixtures_are_intact(lock)

    if not have_js():
        print("  skipped: node is not installed, so src/data/tiles.ts was not "
              "run. Only the constants were checked.")
    else:
        with tempfile.TemporaryDirectory() as work:
            check_against_node(lock, Path(work))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
