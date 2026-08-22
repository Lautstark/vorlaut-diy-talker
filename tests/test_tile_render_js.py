#!/usr/bin/env python3
"""Checks that static/tiles.js still renders the same tiles as tiles.py.

The app is moving into the browser, so render_symbol() exists twice now. Two
implementations of one thing drift, and this one drifting is expensive in a
particular way: the tile file name is a hash over the symbol and
TILE_PIPELINE, so the day the JavaScript starts producing different bytes
under the same name, every device carries a mixture of old and new tiles and
nothing says so.

tools/tilecheck.py is the thorough version of this and needs a browser. This
is the part that can run in CI: everything in static/tiles.js except decoding
a PNG is plain arithmetic on plain arrays, so node can run it against Pillow
directly. The one step left out is the decode itself - the browser has to do
that - and tilecheck measured it as lossless for the symbols we render.

Skipped, not failed, where node is missing: this must not be the reason a
machine without it cannot run the suite.
"""

from __future__ import annotations

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

WORKSPACE = tempfile.TemporaryDirectory()
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name
os.environ.pop("VORLAUT_DATA", None)
os.environ.pop("VORLAUT_METACOM_DIR", None)

import tiles  # noqa: E402

MODULE = ROOT / "static" / "tiles.js"
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


def check_constants() -> None:
    source = MODULE.read_text(encoding="utf-8")
    check("the JavaScript declares TILE_PIPELINE",
          constant(source, "TILE_PIPELINE") is not None)
    check("and it is the number tiles.py hashes into every file name",
          constant(source, "TILE_PIPELINE") == str(tiles.TILE_PIPELINE),
          f"js {constant(source, 'TILE_PIPELINE')} vs py {tiles.TILE_PIPELINE}")
    check("IMG_SIZE agrees", constant(source, "IMG_SIZE") == str(tiles.IMG_SIZE))
    check("BORDER agrees", constant(source, "BORDER") == str(tiles.BORDER))


def fixtures(target: Path) -> list[str]:
    """The example symbols, plus the shapes they do not happen to cover."""
    from PIL import Image

    target.mkdir(parents=True, exist_ok=True)
    names = []
    for source in sorted((ROOT / "example" / "symbols").glob("*.png")):
        shutil.copy(source, target / source.name)
        names.append(source.name)

    def write(name, image):
        image.save(target / name)
        names.append(name)

    # Wider than tall and opaque to the edge: the case where the leftover
    # strip takes the symbol's own colour instead of white.
    wide = Image.new("RGBA", (706, 589), (36, 122, 84, 255))
    pixels = wide.load()
    for y in range(120, 470):
        for x in range(150, 560):
            pixels[x, y] = ((x * 3) % 256, (y * 5) % 256, ((x ^ y) * 7) % 256, 255)
    write("wide-opaque.png", wide)

    # Smaller than a tile: thumbnail() must leave it alone rather than enlarge.
    small = Image.new("RGBA", (61, 44), (0, 0, 0, 0))
    tiny = small.load()
    for y in range(6, 38):
        for x in range(8, 53):
            tiny[x, y] = ((x * 4) % 256, 90, (y * 6) % 256, 255 if (x + y) % 3 else 90)
    write("small-wider.png", small)

    # Soft edges throughout, so every alpha between 0 and 255 is exercised.
    tall = Image.new("RGBA", (240, 460))
    soft = tall.load()
    for y in range(460):
        for x in range(240):
            edge = min(x, 239 - x, y, 459 - y)
            soft[x, y] = ((x * 7) % 256, (y * 3) % 256, 200, min(255, edge * 9))
    write("tall-soft.png", tall)

    names.append("does-not-exist.png")   # resolves to nothing: the placeholder
    return names


# What node runs. Everything the browser contributes - decoding the PNG - is
# replaced by the raw pixels Pillow read, because the point here is the
# arithmetic after that, and a PNG decoder in node would be a third thing to
# keep honest.
DRIVER = """
import fs from "node:fs";
const tiles = await import(process.argv[2]);
const plan = JSON.parse(fs.readFileSync(process.argv[3], "utf-8"));
const out = {};
for (const item of plan) {
  let bytes;
  if (item.missing) {
    bytes = tiles.toRgb565Be(tiles.placeholder());
  } else {
    const data = new Uint8ClampedArray(fs.readFileSync(item.raw));
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
  out[item.name] = true;
}
console.log(JSON.stringify(out));
"""


def check_rendering(names: list[str], work: Path) -> None:
    from PIL import Image

    plan = []
    for name in names:
        item = {"name": name, "out": str(work / f"{name}.js.bin")}
        source = tiles.symbol_path(name)
        if source is None:
            item["missing"] = True
        else:
            with Image.open(source) as opened:
                picture = opened.convert("RGBA")
            raw = work / f"{name}.rgba"
            raw.write_bytes(picture.tobytes("raw", "RGBA"))
            item |= {"raw": str(raw), "width": picture.width,
                     "height": picture.height}
        plan.append(item)

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

    for name in names:
        expected = tiles.render_symbol(name)
        actual = (work / f"{name}.js.bin").read_bytes()
        if len(actual) != len(expected):
            check(f"{name} is the right size", False,
                  f"{len(actual)} bytes, expected {len(expected)}")
            continue
        differing = sum(1 for i in range(0, len(expected), 2)
                        if expected[i:i + 2] != actual[i:i + 2])
        check(f"{name} is byte for byte what tiles.py makes", differing == 0,
              f"{differing} of {len(expected) // 2} pixels differ")


def main() -> int:
    if not MODULE.is_file():
        print(f"  {MODULE} is missing")
        return 1

    check_constants()

    if not shutil.which("node"):
        print("  skipped: node is not installed, so only the constants "
              "were checked")
    else:
        with WORKSPACE:
            try:
                names = fixtures(Path(WORKSPACE.name) / "symbols")
            except ImportError:
                print("  Pillow is missing - install requirements.txt")
                return 1
            with tempfile.TemporaryDirectory() as work:
                check_rendering(names, Path(work))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
