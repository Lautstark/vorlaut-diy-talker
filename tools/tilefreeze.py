#!/usr/bin/env python3
"""Freezes the tiles Pillow renders, before Pillow stops being here to render them.

    python3 tools/tilefreeze.py              # rewrite the fixtures and the lock
    python3 tools/tilefreeze.py --check      # render again, change nothing, report
    python3 tools/tilefreeze.py --png out/   # write the inputs out to look at

tests/test_tile_render_js.py renders every fixture both ways and compares, and
that is a real comparison - it is why it can say 0 of 13456 pixels differ. But
it builds its inputs with Image.new() at run time and takes its expected bytes
from tiles.render_symbol(), so both sides of the comparison are recomputed by
Pillow on every run. Take Pillow away and the reference does not fail, it
evaporates: the test skips, prints that Pillow is missing, and the suite stays
green with nothing checking the renderer at all.

So this writes both sides down while Pillow is here. Afterwards the test reads
what a known Pillow actually produced instead of asking whatever Pillow is
installed today.

The inputs are frozen as decoded pixels rather than as PNGs, gzipped. Two
reasons. The obvious one is that then the test needs no PNG decoder in node
and no Pillow either - it needs nothing at all. The other is that decoding is
the one step of the pipeline that the browser does and this test does not, so
freezing after the decode changes nothing about what is being checked; that
step is tools/tilecheck.py's, and it measured it lossless for these symbols.

Which fixtures, and why these. The point is to catch a wrong renderer, not to
have a tidy set, so each one is here because some branch is only reachable
through it - and where two would prove the same thing, only one is here. The
five that ship are in as well, because a fixture nobody looks at is a worse
regression test than the picture on the device.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

REFERENCE = ROOT / "tests" / "reference"
FIXTURES = REFERENCE / "tiles"
LOCK = REFERENCE / "tiles.lock.json"
EXAMPLES = ROOT / "example" / "symbols"


def require_pillow():
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit(
            "This freezes what Pillow renders, so it needs Pillow.\n"
            "  .venv/bin/python -m pip install -r requirements.txt\n"
            "The fixtures already in tests/reference/tiles/ are the point of "
            "the exercise and are not regenerated from anything else.")
    return Image


# --- The pictures ------------------------------------------------------------
#
# Everything below is drawn rather than photographed, because a fixture has to
# say what it is for. Each builder is one branch of the renderer.

def build_pictures() -> dict:
    Image = require_pillow()

    def rgba(size, colour=(0, 0, 0, 0)):
        return Image.new("RGBA", size, colour)

    pictures = {}

    # Wider than tall, opaque to the edge, and all four corners the same: the
    # case where the strip left over above and below takes the symbol's own
    # colour rather than white. 706x589 is METACOM's actual size, so this is
    # the shape most tiles on a real device are made from.
    #
    # The middle is a fine checkerboard on purpose. Lanczos is the part of
    # this port most likely to be subtly wrong, and a checkerboard is the
    # hardest thing to resample - it is all the frequency the picture can
    # hold. A photograph would let a wrong kernel look nearly right.
    wide = rgba((706, 589), (36, 122, 84, 255))
    pixels = wide.load()
    for y in range(120, 470):
        for x in range(150, 560):
            if (x // 2 + y // 2) % 2:
                pixels[x, y] = (250, 240, 20, 255)
            else:
                pixels[x, y] = (10, 20, 90, 255)
    for y in range(470, 520):                     # a smooth ramp underneath it
        for x in range(150, 560):
            pixels[x, y] = (x % 256, 255 - (x % 256), 128, 255)
    pictures["wide-opaque"] = (wide,
        "706x589 like METACOM's own, opaque to the edge with all four corners "
        "one colour - so the leftover strip takes that colour instead of "
        "white. Checkerboard in the middle, which is the hardest thing there "
        "is to resample")

    # Soft edges the whole way round, so every alpha between 0 and 255 is
    # exercised, and taller than wide so the strip is at the sides.
    tall = rgba((240, 460))
    soft = tall.load()
    for y in range(460):
        for x in range(240):
            edge = min(x, 239 - x, y, 459 - y)
            soft[x, y] = ((x * 7) % 256, (y * 3) % 256, 200, min(255, edge * 9))
    pictures["tall-soft"] = (tall,
        "taller than wide and soft-edged all round, so the premultiply, the "
        "resample and the unpremultiply all see partial alpha - and the "
        "leftover strip is at the sides for once")

    # Smaller than a tile in both directions: thumbnail() has to leave it
    # alone rather than enlarge it, and both offsets are then large and odd.
    small = rgba((61, 44))
    tiny = small.load()
    for y in range(6, 38):
        for x in range(8, 53):
            tiny[x, y] = ((x * 4) % 256, 90, (y * 6) % 256, 255 if (x + y) % 3 else 90)
    pictures["small-wider"] = (small,
        "smaller than the tile in both directions, so nothing is resampled at "
        "all and the whole answer is where it gets centred")

    # Opaque, but the corners are not all one colour. fill_colour has to say
    # white - and this is the only fixture that makes it say so from the
    # corner test rather than from the alpha test.
    corners = rgba((400, 400), (240, 240, 240, 255))
    spot = corners.load()
    for y in range(400):
        for x in range(400):
            spot[x, y] = (240 - y // 4, 240 - x // 4, 200, 255)
    spot[399, 399] = (12, 12, 12, 255)
    pictures["corners-differ"] = (corners,
        "fully opaque, but one corner is a different colour from the other "
        "three - so the ground is white, decided by the corners and not by "
        "the alpha channel")

    # One pixel at alpha 254 in an otherwise opaque picture. The rule is "no
    # alpha channel", not "nearly none", and a renderer that rounded that off
    # would put a coloured strip round a symbol that wanted white.
    #
    # The four corners are deliberately the same colour, and that is the whole
    # design of this fixture. If they were not, a renderer that ignored the
    # alpha would still reach white by the corner test and the two answers
    # would agree - the fixture would look like it was checking something and
    # be checking nothing. With the corners in agreement the two paths give
    # different grounds, and 39 rows of leftover strip to show it in.
    nearly = rgba((300, 200), (200, 30, 30, 255))
    almost = nearly.load()
    for y in range(8, 192):
        for x in range(8, 292):
            almost[x, y] = (200, 30 + (x % 32), 30 + (y % 16), 255)
    almost[150, 100] = (200, 30, 30, 254)
    pictures["nearly-opaque"] = (nearly,
        "opaque everywhere except one pixel at alpha 254, with all four "
        "corners the same colour - so the ground is white only if the alpha "
        "is read as < 255 rather than as 'about 255'. Read the other way it "
        "comes out red, and the strip shows it")

    # 407x200 shrinks to 116x57, and 116 - 57 is odd. The offset is then
    # floor(59/2) = 29 above and 30 below, and a renderer that rounded instead
    # of flooring puts the symbol one row out.
    odd = rgba((407, 200), (255, 255, 255, 255))
    stripe = odd.load()
    for y in range(200):
        for x in range(407):
            stripe[x, y] = (255, 255, 255, 255) if (x + y) % 3 else (20, 60, 200, 255)
    pictures["odd-leftover"] = (odd,
        "shrinks to 116x57, leaving 59 rows to divide in two - so the "
        "symbol sits 29 above and 30 below, and rounding instead of flooring "
        "moves every pixel")

    # Exactly the tile's size: no resampling happens at all, which leaves the
    # colour conversion on its own. The values are chosen to sit either side
    # of where RGB565 throws bits away - 5 bits of red and blue, 6 of green -
    # so a conversion that rounded rather than truncated would show here and
    # only here.
    exact = rgba((116, 116), (255, 255, 255, 255))
    edge = exact.load()
    for y in range(116):
        for x in range(116):
            edge[x, y] = ([0, 7, 8, 15, 247, 248, 251, 252, 255][x % 9],
                          [0, 3, 4, 7, 251, 252, 253, 254, 255][y % 9],
                          [8, 16, 24, 255][(x + y) % 4], 255)
    pictures["quantisation"] = (exact,
        "already the tile's size, so nothing is resampled and the RGB565 "
        "conversion is alone. The values sit either side of every bit it "
        "throws away")

    # Nothing but transparency, with a colour underneath it that has to be
    # dropped rather than dragged into the result by the resampling.
    empty = rgba((200, 150), (220, 40, 160, 0))
    pictures["fully-transparent"] = (empty,
        "every pixel transparent, over a colour - which must be dropped, not "
        "smeared into the edges by the resample")

    return pictures


# --- Freezing ----------------------------------------------------------------

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def freeze(png_out: Path | None) -> dict:
    Image = require_pillow()
    import tiles

    FIXTURES.mkdir(parents=True, exist_ok=True)
    entries = []

    def record(name: str, picture, why: str) -> None:
        raw = picture.tobytes("raw", "RGBA")
        (FIXTURES / f"{name}.rgba.gz").write_bytes(
            # mtime=0, or the file changes every run and every freeze is a diff.
            gzip.compress(raw, compresslevel=9, mtime=0))
        if png_out is not None:
            png_out.mkdir(parents=True, exist_ok=True)
            picture.save(png_out / f"{name}.png")
        entries.append({
            "name": name, "why": why,
            "width": picture.width, "height": picture.height,
            "pixels": f"tiles/{name}.rgba.gz", "pixels_sha256": sha256(raw),
            "thumbnail": list(thumbnail_size(picture.width, picture.height)),
            "ground": list(tiles.fill_colour(picture)),
        })

    def thumbnail_size(width: int, height: int) -> tuple[int, int]:
        probe = Image.new("RGBA", (width, height))
        probe.thumbnail((tiles.TILE_SIZE, tiles.TILE_SIZE), Image.LANCZOS)
        return probe.width, probe.height

    # The pictures that ship. Frozen by their decoded pixels like the rest, so
    # the fixture also pins the symbol: change example/symbols/ja.png and this
    # says so, which is right, because the tile changes with it.
    for source in sorted(EXAMPLES.glob("*.png")):
        with Image.open(source) as opened:
            picture = opened.convert("RGBA")
        record(source.stem, picture,
               f"example/symbols/{source.name} - what a fresh clone ships and "
               f"what is actually on a device")

    for name, (picture, why) in build_pictures().items():
        record(name, picture, why)

    # And the answer to a symbol that resolves to nothing, which is not an
    # error here but a grey cross.
    entries.append({"name": "placeholder", "why":
                    "no symbol at all - the grey cross a reference that "
                    "resolves to nothing renders as",
                    "width": None, "height": None, "pixels": None,
                    "thumbnail": None, "ground": None})

    # Now the expected bytes, from the renderer that is about to be deleted.
    for entry in entries:
        name = entry["name"]
        if entry["pixels"] is None:
            expected = tiles.render_symbol("does-not-exist.png")
        else:
            expected = render_from_pixels(entry, tiles, Image)
        (FIXTURES / f"{name}.rgb565").write_bytes(expected)
        entry |= {"expected": f"tiles/{name}.rgb565",
                  "expected_bytes": len(expected),
                  "expected_sha256": sha256(expected)}
        print(f"  {name:<18} {str(entry['width'] or '-'):>4}x"
              f"{str(entry['height'] or '-'):<4} -> "
              f"{entry['expected_sha256'][:16]}...  {len(expected)} bytes")

    from PIL import Image as _Image
    return {
        "what": "The tiles Pillow renders for the inputs in "
                "tests/reference/tiles/, frozen so that static/tiles.js can be "
                "checked without a live Pillow deciding what the answer is.",
        "produced_by": "tools/tilefreeze.py",
        "produced_on": date.today().isoformat(),
        "pillow": _Image.__version__,
        "python": sys.version.split()[0],
        "tile_pipeline": tiles.TILE_PIPELINE,
        "tile_size": tiles.TILE_SIZE,
        "img_size": tiles.IMG_SIZE,
        "border": tiles.BORDER,
        "format": "16 bit RGB565, big-endian, row by row, no header - what the "
                  "ST7735 is handed. tile_size squared pixels, so "
                  "expected_bytes is 2 * tile_size * tile_size.",
        "pixel_format": "raw RGBA, 8 bits a channel, row by row, gzipped. "
                        "pixels_sha256 is over the ungzipped bytes, so it is "
                        "about the picture and not about the compression.",
        "invalidated_by": [
            "a bump of TILE_PIPELINE - that is the number whose whole job is "
            "to say the rendering changed, and every tile is named after it",
            "any change to render_symbol() in tiles.py, or to the Pillow it "
            "calls: these bytes are what that pair produced",
            "a change to a symbol under example/symbols/, which is why "
            "pixels_sha256 is here",
        ],
        "not_invalidated_by": [
            "changes to static/tiles.js - that is the thing being checked. "
            "Refreezing to make it pass would leave the test comparing the "
            "browser renderer against itself, which is what this file exists "
            "to stop",
        ],
        "fixtures": entries,
    }


def render_from_pixels(entry: dict, tiles, Image):
    """render_symbol(), but from decoded pixels rather than from a file.

    tiles.render_symbol() takes a symbol reference and resolves it through
    SYMBOLS_DIR, which would put the fixtures somewhere they do not belong.
    The steps are its steps, in its order; if that function changes, this has
    to change with it, and the lock file says as much under invalidated_by.
    """
    raw = gzip.decompress((FIXTURES / f"{entry['name']}.rgba.gz").read_bytes())
    picture = Image.frombytes("RGBA", (entry["width"], entry["height"]), raw)
    inner_size = tiles.TILE_SIZE
    ground = tiles.fill_colour(picture)
    inner = Image.new("RGB", (inner_size, inner_size), ground)
    picture.thumbnail((inner_size, inner_size), Image.LANCZOS)
    backdrop = Image.new("RGBA", picture.size, ground + (255,))
    backdrop.alpha_composite(picture)
    inner.paste(backdrop.convert("RGB"),
                ((inner_size - picture.width) // 2,
                 (inner_size - picture.height) // 2))
    return tiles.to_rgb565_be(inner)


def main(argv: list[str]) -> int:
    check = "--check" in argv
    png_out = None
    if "--png" in argv:
        png_out = Path(argv[argv.index("--png") + 1])

    if check:
        if not LOCK.exists():
            print("  nothing frozen yet - run without --check")
            return 1
        old = json.loads(LOCK.read_text(encoding="utf-8"))
        keep = {f["name"]: (FIXTURES / f"{f['name']}.rgb565").read_bytes()
                for f in old["fixtures"]}

    print("Rendering." if check else "Rendering and freezing.")
    fresh = freeze(png_out)

    if check:
        moved = [f["name"] for f in fresh["fixtures"]
                 if keep.get(f["name"]) != (FIXTURES / f"{f['name']}.rgb565").read_bytes()]
        # Put back whatever was there, so --check really changes nothing.
        for name, data in keep.items():
            (FIXTURES / f"{name}.rgb565").write_bytes(data)
        if moved:
            print(f"\n  this Pillow renders {len(moved)} of them differently: "
                  f"{', '.join(moved)}")
            print("  Work out why before refreezing. A moved reference and a "
                  "broken renderer look the same from here.")
            return 1
        print("\n  unchanged - this Pillow renders what the fixtures hold")
        return 0

    LOCK.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    print(f"\n  {len(fresh['fixtures'])} fixtures, and "
          f"{LOCK.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
