#!/usr/bin/env python3
"""From a symbol reference in layout.json to the bytes the display shows.

One concern, deliberately, although the section comments this came out of
had it as two. Resolving "ja.png" or "metacom:essen" to a file and turning
that file into a 116x116 tile are the same question asked twice: what picture
belongs on this key. They share the placeholder - a reference that resolves to
nothing is not an error here, it is a grey cross - and separating them would
have meant a module whose only job was to hand a Path to the next one.

Nothing in here knows what a set is. A tile depends on its symbol and on
nothing else, which is what lets the same picture in two differently coloured
sets be exactly one file on the device.
"""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path

import config
import metacom
from buildbase import BuildError, write_json

SYMBOLS_DIR = config.CONTENT / "symbols"
IMG_SIZE = 128           # display area
BORDER = 6               # border width, drawn by the firmware
TILE_SIZE = IMG_SIZE - 2 * BORDER   # 116, what actually ends up as a file
TILE_CACHE = config.CONTENT / "cache" / "tiles"
TILE_INDEX = TILE_CACHE / "index.json"
# Bump when the rendering changes - every tile is named after this, so a bump
# renames all of them and costs one full re-sync per device. static/tiles.js
# renders the same tiles for the browser and carries the same number; bumping
# one and not the other is the failure nothing would report, so
# tests/test_tile_render_js.py checks that they agree. Why the two can be
# identical at all: docs/tile-rendering.md.
TILE_PIPELINE = 2

METACOM_PREFIX = "metacom:"

# Held around every read-modify-write of the tile index. The web interface
# renders a preview per tile on ThreadingHTTPServer request threads, so five
# threads reading the same dict and writing it back one after another is the
# normal case, not a rare one - and the last write would be the only one that
# survived. Same reasoning and same shape as tts._index_lock.
_index_lock = threading.Lock()


def symbol_path(symbol: str) -> Path | None:
    """The image file for a symbol reference - or None when it does not exist.

    Two origins: a bare file name means symbols/ and therefore something that
    belongs to you. The prefix "metacom:" means the licensed collection, which
    lives outside the project and is only reachable through
    VORLAUT_METACOM_DIR. If that is missing, None comes back just like for any
    other missing symbol - the placeholder gets rendered instead.
    """
    if not symbol:
        return None
    if symbol.startswith(METACOM_PREFIX):
        return metacom.resolve(symbol[len(METACOM_PREFIX):])
    # The name comes from layout.json: discard everything but the file name,
    # so that "../" cannot lead out of symbols/.
    candidate = SYMBOLS_DIR / Path(symbol).name
    return candidate if candidate.exists() else None


def missing_hint(symbol: str) -> str:
    """Why a symbol cannot be resolved - as a key for the build log."""
    if symbol.startswith(METACOM_PREFIX):
        if not metacom.available():
            return "build.missing_metacom_off"
        return "build.missing_metacom"
    return "build.missing_symbol"


def require_pillow():
    """Pillow, or a BuildError saying it is missing.

    Public because app.py needs it too: the web interface draws its own
    previews and accepts uploads, and both want the same failure - a message
    key the page can translate rather than an ImportError.
    """
    try:
        from PIL import Image, ImageDraw  # noqa: F401
    except ImportError as exc:
        raise BuildError("build.err.no_pillow") from exc
    from PIL import Image, ImageDraw
    return Image, ImageDraw


def fill_colour(picture) -> tuple[int, int, int]:
    """The colour for the area left over next to a symbol.

    Not every symbol is square - METACOM ships 706x589 - so in the square tile
    a strip remains at the top and bottom. White is right there as long as the
    symbol is drawn on a light background. With the edge-to-edge coloured
    symbols - "ja" is green throughout, "nein" red - it would instead produce
    a visible white bar.

    Hence: no alpha channel and all four corners the same colour means
    edge-to-edge coloured, and that colour continues into the strip.
    Otherwise it stays white - dark line art needs the light ground, and a
    colourful ground would take the contrast away.
    """
    if picture.getchannel("A").getextrema()[0] < 255:
        return (255, 255, 255)
    width, height = picture.size
    corners = {picture.getpixel(xy)[:3] for xy in
               ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))}
    return corners.pop() if len(corners) == 1 else (255, 255, 255)


def render_symbol(symbol: str) -> bytes:
    """116x116 symbol area on white, without a border.

    The coloured border does not go into the image - the firmware draws it
    from SET_COLORS. That makes this file depend on the symbol alone: the same
    picture in two differently coloured sets is exactly one file.

    Returns raw RGB565 data, big-endian, in the form the ST7735 panel
    expected_size.
    """
    Image, ImageDraw = require_pillow()

    inner_size = TILE_SIZE
    inner = Image.new("RGB", (inner_size, inner_size), (255, 255, 255))

    source_path = symbol_path(symbol)
    if source_path:
        with Image.open(source_path) as raw:
            picture = raw.convert("RGBA")
        ground = fill_colour(picture)
        inner = Image.new("RGB", (inner_size, inner_size), ground)
        picture.thumbnail((inner_size, inner_size), Image.LANCZOS)
        # Composite transparency onto the ground, otherwise it turns black.
        backdrop = Image.new("RGBA", picture.size, ground + (255,))
        backdrop.alpha_composite(picture)
        offset = (
            (inner_size - picture.width) // 2,
            (inner_size - picture.height) // 2,
        )
        inner.paste(backdrop.convert("RGB"), offset)
    else:
        # Placeholder: empty field with a grey cross, so one sees at once
        # that a symbol is still missing here.
        draw = ImageDraw.Draw(inner)
        pad = inner_size // 4
        grey = (200, 200, 200)
        draw.line((pad, pad, inner_size - pad, inner_size - pad), fill=grey, width=4)
        draw.line((inner_size - pad, pad, pad, inner_size - pad), fill=grey, width=4)

    return to_rgb565_be(inner)


def tile_fingerprint(symbol: str) -> str:
    """Depends on the symbol's content alone, not on name, set or colour."""
    source = symbol_path(symbol)
    if source:
        content = hashlib.sha256(source.read_bytes()).hexdigest()
    else:
        content = "platzhalter"
    raw = json.dumps(
        {"content": content, "size": TILE_SIZE, "pipeline": TILE_PIPELINE},
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def load_tile_index() -> dict:
    if not TILE_INDEX.exists():
        return {}
    try:
        data = json.loads(TILE_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def tile_bytes(symbol: str) -> bytes:
    """The rendered symbol area, from the cache or freshly made."""
    key = tile_fingerprint(symbol)
    path = TILE_CACHE / f"{key}.bin"
    # Reading, changing and writing back is one step - see _index_lock. The
    # rendering below stays outside it: it is the slow part, and two threads
    # making the same tile at once cost time, not correctness.
    with _index_lock:
        index = load_tile_index()
        if index.get(key) != (symbol or ""):
            index[key] = symbol or ""
            write_json(TILE_INDEX, index)
    if path.exists():
        return path.read_bytes()
    data = render_symbol(symbol)
    TILE_CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def rgb_to_565(r: int, g: int, b: int) -> int:
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def to_rgb565_be(image) -> bytes:
    width, height = image.size
    pixels = image.tobytes("raw", "RGB")
    out = bytearray(width * height * 2)
    write = 0
    for read in range(0, len(pixels), 3):
        value = rgb_to_565(pixels[read], pixels[read + 1], pixels[read + 2])
        out[write] = value >> 8
        out[write + 1] = value & 0xFF
        write += 2
    return bytes(out)
