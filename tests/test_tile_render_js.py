#!/usr/bin/env python3
"""Checks that static/tiles.js still renders the tiles tiles.py rendered.

The app is moving into the browser, so render_symbol() exists twice now. Two
implementations of one thing drift, and this one drifting is expensive in a
particular way: the tile file name is a hash over the symbol and
TILE_PIPELINE, so the day the JavaScript starts producing different bytes
under the same name, every device carries a mixture of old and new tiles and
nothing says so.

What changed here, and why. This test used to build its inputs with
Image.new() and take its expected bytes from tiles.render_symbol(), which made
both sides of the comparison things Pillow worked out afresh on every run.
That is a real comparison while Pillow is installed and nothing at all once it
is not: the test skips, says Pillow is missing, and the suite stays green with
the renderer unchecked. Since the Python half is on its way out, that is the
wrong way round. So tools/tilefreeze.py wrote down what a known Pillow
produced, and this reads it.

Three comparisons, and it is worth being clear about which of them survives:

  node against the frozen bytes     needs nothing but node. This is the one
                                    that still means something after the
                                    Python half is deleted.
  tiles.py against the frozen bytes catches the Python renderer drifting away
                                    from what it was frozen at - a Pillow
                                    upgrade, most likely. Skipped without
                                    Pillow, and says so.
  the constants                     TILE_PIPELINE and the sizes, read out of
                                    both files as text. Needs neither.

tools/tilecheck.py is still the thorough version and still needs a browser:
the one step left out here is decoding the PNG, which the fixtures are frozen
after. That measured lossless for these symbols.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

MODULE = ROOT / "static" / "tiles.js"
REFERENCE = ROOT / "tests" / "reference"
LOCK = REFERENCE / "tiles.lock.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def constant(source: str, name: str) -> str | None:
    """The literal a `export const NAME = ...;` line gives.

    Read out of the text rather than out of node, so that this half of the
    test still runs where node does not. Trailing comments are ordinary on
    these lines, so the value ends at the semicolon, not at the newline.
    """
    found = re.search(rf"^export const {name} = ([^;]+);", source, re.M)
    return found.group(1).strip() if found else None


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
          f"{lock['tile_pipeline']} - if the bump is deliberate, refreeze with "
          f"tools/tilefreeze.py")
    check("IMG_SIZE agrees", constant(source, "IMG_SIZE") == str(lock["img_size"]))
    check("BORDER agrees", constant(source, "BORDER") == str(lock["border"]))


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
          f"changed: {', '.join(bad)} - regenerate with tools/tilefreeze.py "
          f"rather than editing, and expect the tiles to change with them")


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
        [shutil.which("node"), str(driver), MODULE.as_uri(), str(plan_file)],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("node ran static/tiles.js", False, result.stderr.strip()[:400])
        return
    check("node ran static/tiles.js", True)

    total = lock["tile_size"] ** 2
    for entry in lock["fixtures"]:
        expected = (REFERENCE / entry["expected"]).read_bytes()
        compare(entry["name"], "node",
                expected, (work / f"{entry['name']}.js.bin").read_bytes(), total)


def check_against_pillow(lock: dict) -> None:
    """Is tiles.py still rendering what it was frozen rendering?

    A separate question from the one above, and the answer stops mattering the
    day tiles.py goes. Until then it is the thing that would catch a Pillow
    upgrade quietly changing every tile on every device - which the
    fingerprint would not, because it hashes the symbol and the pipeline
    number and not the bytes.
    """
    try:
        from PIL import Image
    except ImportError:
        print("  skipped: Pillow is missing, so tiles.py was not asked. The "
              "frozen tiles were still checked against node, which is the "
              "comparison that has to outlive it.")
        return

    # tiles.py resolves a symbol through SYMBOLS_DIR, so the shipped ones are
    # rendered the way the build renders them - through render_symbol() and
    # the placeholder - and only the drawn fixtures go the short way round.
    workspace = tempfile.TemporaryDirectory()
    os.environ["VORLAUT_CONTENT"] = workspace.name
    os.environ.pop("VORLAUT_DATA", None)
    os.environ.pop("VORLAUT_METACOM_DIR", None)
    with workspace:
        symbols = Path(workspace.name) / "symbols"
        symbols.mkdir(parents=True, exist_ok=True)
        shipped = {}
        for source in sorted((ROOT / "example" / "symbols").glob("*.png")):
            shutil.copy(source, symbols / source.name)
            shipped[source.stem] = source.name

        import tiles
        import tilefreeze

        same = lock["tile_pipeline"] == tiles.TILE_PIPELINE
        check("the frozen tiles were rendered at this TILE_PIPELINE", same,
              "" if same else
              f"frozen at {lock['tile_pipeline']}, tiles.py says "
              f"{tiles.TILE_PIPELINE} - refreeze with tools/tilefreeze.py")

        total = lock["tile_size"] ** 2
        for entry in lock["fixtures"]:
            name = entry["name"]
            expected = (REFERENCE / entry["expected"]).read_bytes()
            if entry["pixels"] is None:
                actual = tiles.render_symbol("does-not-exist.png")
            elif name in shipped:
                actual = tiles.render_symbol(shipped[name])
            else:
                actual = tilefreeze.render_from_pixels(entry, tiles, Image)
            compare(name, "tiles.py", expected, actual, total)


def main() -> int:
    if not MODULE.is_file():
        print(f"  {MODULE} is missing")
        return 1
    if not LOCK.is_file():
        print(f"  {LOCK} is missing - the frozen tiles are the reference, and "
              f"there is nothing to compare against without them. "
              f"tools/tilefreeze.py writes them.")
        return 1

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    check_constants(lock)
    check_fixtures_are_intact(lock)

    if not shutil.which("node"):
        print("  skipped: node is not installed, so static/tiles.js was not "
              "run. Only the constants were checked.")
    else:
        with tempfile.TemporaryDirectory() as work:
            check_against_node(lock, Path(work))

    check_against_pillow(lock)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
