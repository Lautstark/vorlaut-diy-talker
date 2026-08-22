#!/usr/bin/env python3
"""Measures how far the browser's tiles are from the ones tiles.py makes.

    python3 tools/tilecheck.py            # then open the address it prints

The app half is moving into the browser, so render_symbol() had to be written
a second time in JavaScript (static/tiles.js). Two implementations of the same
thing are worth nothing without a number saying how far apart they are, and
"looks the same" is not that number: what reaches the panel is RGB565, and the
question is how many of those 13456 pixels come out different.

So the Python here is the oracle. It renders every fixture with the real
tiles.render_symbol(), the page renders the same fixtures with every renderer
static/tiles.js offers, PUTs its bytes back, and this compares them. The PUT
is the only reason a server is needed at all - a page cannot hand a file to a
shell, and http.server cannot take one. Same trick as docs/spike/serve.py in
mitreden, where it was audio rather than pixels.

The fixtures are not only example/symbols/. Those five are all 500x500 with
transparency, which leaves most of the code untested - nothing there is
non-square, nothing is smaller than a tile, nothing is opaque to the edge. The
synthetic ones below cover the branches the real corpus happens to miss, and
content/symbols/ is picked up too when it exists.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Before tiles is imported: config.py resolves the content directory once, at
# import time, and the fixtures have to be what it finds. This is also what
# keeps the run from touching the developer's own symbols or tile cache.
WORKSPACE = tempfile.TemporaryDirectory(prefix="tilecheck-")
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name
os.environ.pop("VORLAUT_DATA", None)
os.environ.pop("VORLAUT_METACOM_DIR", None)

import tiles  # noqa: E402

# The renderers static/tiles.js offers, and what each is for.
RENDERERS = {
    "lanczos": "the filter written out in JavaScript, Pillow step for step",
    "canvas": "drawImage, whatever the browser does with imageSmoothingQuality",
}

MISSING = "does-not-exist.png"   # resolves to nothing, so: the placeholder


def build_fixtures(target: Path) -> list[str]:
    """The symbol files to compare, written where tiles.py will find them."""
    from PIL import Image

    target.mkdir(parents=True, exist_ok=True)
    names: list[str] = []

    for source in sorted((ROOT / "example" / "symbols").glob("*.png")):
        shutil.copy(source, target / source.name)
        names.append(source.name)

    # Whatever the developer actually has, if anything - a real corpus says
    # more than any fixture, and on a machine without one this is simply empty.
    own = Path(os.environ.get("VORLAUT_TILECHECK_SYMBOLS")
               or ROOT / "content" / "symbols")
    if own.is_dir():
        for source in sorted(own.glob("*.png"))[:8]:
            name = f"own-{source.name}"
            shutil.copy(source, target / name)
            names.append(name)

    # --- the branches example/symbols/ does not reach ----------------------
    def write(name: str, image) -> None:
        image.save(target / name)
        names.append(name)

    # METACOM's shape: wider than tall, so a strip is left top and bottom, and
    # opaque to the edge with one corner colour - which is the case where
    # fill_colour() returns something other than white.
    wide = Image.new("RGBA", (706, 589), (36, 122, 84, 255))
    pixels = wide.load()
    for y in range(120, 470):
        for x in range(150, 560):
            pixels[x, y] = ((x * 3) % 256, (y * 5) % 256, ((x ^ y) * 7) % 256, 255)
    write("wide-opaque.png", wide)

    # Opaque, but the four corners disagree - white ground, not corner colour.
    corners = Image.new("RGBA", (400, 400), (255, 240, 200, 255))
    corners.load()[399, 399] = (10, 10, 10, 255)
    write("corners-differ.png", corners)

    # Smaller than a tile in both directions: thumbnail() must not enlarge it.
    small = Image.new("RGBA", (61, 44), (0, 0, 0, 0))
    tiny = small.load()
    for y in range(6, 38):
        for x in range(8, 53):
            tiny[x, y] = ((x * 4) % 256, 90, (y * 6) % 256, 255 if (x + y) % 3 else 90)
    write("small-wider.png", small)

    # Tall and soft edged, so the alpha rounding has somewhere to show.
    tall = Image.new("RGBA", (240, 460))
    soft = tall.load()
    for y in range(460):
        for x in range(240):
            edge = min(x, 239 - x, y, 459 - y)
            soft[x, y] = ((x * 7) % 256, (y * 3) % 256, 200, min(255, edge * 9))
    write("tall-soft.png", tall)

    names.append(MISSING)
    return names


def rgb565_channels(data: bytes, at: int) -> tuple[int, int, int]:
    value = (data[at] << 8) | data[at + 1]
    return (value >> 11) & 0x1F, (value >> 5) & 0x3F, value & 0x1F


def compare(expected: bytes, actual: bytes) -> dict:
    """Per-pixel agreement between two RGB565 tiles.

    The deltas are in RGB565's own units - 0..31 for red and blue, 0..63 for
    green - because that is what the panel is handed. Counting in 8-bit would
    make differences look bigger than they are: three of the eight bits are
    thrown away on the way here, so two pictures can be visibly different and
    still produce the same bytes.
    """
    if len(expected) != len(actual):
        return {"error": f"{len(actual)} bytes, expected {len(expected)}"}

    total = len(expected) // 2
    differing = 0
    worst = [0, 0, 0]
    over_one = 0
    sum_delta = 0
    for at in range(0, len(expected), 2):
        if expected[at] == actual[at] and expected[at + 1] == actual[at + 1]:
            continue
        differing += 1
        want = rgb565_channels(expected, at)
        got = rgb565_channels(actual, at)
        deltas = [abs(a - b) for a, b in zip(want, got)]
        # Green counts double so that a step of one means the same amount of
        # colour in all three - it has six bits where the others have five.
        scaled = [deltas[0], deltas[1] / 2, deltas[2]]
        for i in range(3):
            worst[i] = max(worst[i], deltas[i])
        if max(scaled) > 1:
            over_one += 1
        sum_delta += max(scaled)

    return {
        "pixels": total,
        "differing": differing,
        "percent": 100.0 * differing / total,
        "max_delta": {"r": worst[0], "g": worst[1], "b": worst[2]},
        "over_one_step": over_one,
        "over_one_percent": 100.0 * over_one / total,
        "mean_delta": sum_delta / total,
    }


def write_pictures(out: Path, name: str, renderer: str,
                   expected: bytes, actual: bytes) -> None:
    """Python, browser and the difference between them, side by side.

    The numbers say how much differs, not where, and where is what tells you
    whether it is the edges of the symbol or the whole picture.
    """
    from PIL import Image

    size = tiles.TILE_SIZE

    def to_image(data: bytes):
        image = Image.new("RGB", (size, size))
        pixels = image.load()
        for i in range(size * size):
            r, g, b = rgb565_channels(data, i * 2)
            pixels[i % size, i // size] = (r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2)
        return image

    left, right = to_image(expected), to_image(actual)
    diff = Image.new("RGB", (size, size))
    marks = diff.load()
    lp, rp = left.load(), right.load()
    for y in range(size):
        for x in range(size):
            gap = max(abs(a - b) for a, b in zip(lp[x, y], rp[x, y]))
            # Black where they agree, brighter the further apart they are.
            marks[x, y] = (min(255, gap * 8), min(255, gap * 8), min(255, gap * 8))

    sheet = Image.new("RGB", (size * 3 + 16, size), (255, 255, 255))
    sheet.paste(left, (0, 0))
    sheet.paste(right, (size + 8, 0))
    sheet.paste(diff, (size * 2 + 16, 0))
    out.mkdir(parents=True, exist_ok=True)
    sheet.save(out / f"{renderer}-{name}.png")


class Collector:
    """What the page has sent so far, and what is still missing."""

    def __init__(self, names: list[str]) -> None:
        self.expected = {name: tiles.render_symbol(name) for name in names}
        self.names = names
        self.received: dict[tuple[str, str], bytes] = {}
        self.complete = threading.Event()
        self.lock = threading.Lock()

    def wanted(self) -> int:
        return len(self.names) * len(RENDERERS)

    def take(self, renderer: str, name: str, body: bytes) -> None:
        with self.lock:
            self.received[(renderer, name)] = body
            if len(self.received) >= self.wanted():
                self.complete.set()


def report(collector: Collector, pictures: Path | None) -> int:
    """The table, and a verdict on each renderer."""
    worst_case = {}
    print()
    for renderer, what in RENDERERS.items():
        print(f"=== {renderer} — {what}")
        print(f"    {'symbol':22} {'differing':>18}  {'>1 step':>10}   "
              f"{'max delta r/g/b':>16}  mean")
        peak_percent = peak_over = 0.0
        peak_delta = [0, 0, 0]
        for name in collector.names:
            actual = collector.received.get((renderer, name))
            if actual is None:
                print(f"    {name:22} {'never arrived':>18}")
                peak_percent = 100.0
                continue
            result = compare(collector.expected[name], actual)
            if "error" in result:
                print(f"    {name:22} {result['error']}")
                peak_percent = 100.0
                continue
            delta = result["max_delta"]
            print(f"    {name:22} {result['differing']:7} /{result['pixels']:6}"
                  f" {result['percent']:5.1f}%  {result['over_one_percent']:9.2f}%"
                  f"   {delta['r']:4} {delta['g']:4} {delta['b']:4}"
                  f"  {result['mean_delta']:.3f}")
            peak_percent = max(peak_percent, result["percent"])
            peak_over = max(peak_over, result["over_one_percent"])
            for i, key in enumerate("rgb"):
                peak_delta[i] = max(peak_delta[i], delta[key])
            if pictures:
                write_pictures(pictures, name, renderer,
                               collector.expected[name], actual)
        worst_case[renderer] = (peak_percent, peak_over, peak_delta)
        print(f"    worst: {peak_percent:.1f}% of pixels differ, "
              f"{peak_over:.2f}% by more than one step, "
              f"max delta r{peak_delta[0]} g{peak_delta[1]} b{peak_delta[2]}")
        print()

    if pictures:
        print(f"Python | browser | difference:  {pictures}")
    # Nothing here decides what is acceptable - that is a judgement, and it is
    # written down in docs/tile-rendering.md. The exit code only says whether
    # the run itself worked.
    return 0 if len(collector.received) == collector.wanted() else 1


def make_handler(collector: Collector, fixtures: Path):
    class Handler(SimpleHTTPRequestHandler):
        def do_PUT(self):
            parts = [p for p in self.path.split("/") if p]
            if len(parts) != 3 or parts[0] != "dump" or parts[1] not in RENDERERS:
                self.send_error(400, "expected /dump/<renderer>/<symbol>")
                return
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            collector.take(parts[1], parts[2], body)
            self.send_response(204)
            self.end_headers()
            done, want = len(collector.received), collector.wanted()
            sys.stderr.write(f"\r  {done}/{want} tiles received")
            sys.stderr.flush()

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                return self.serve(ROOT / "tools" / "tilecheck.html", "text/html")
            if self.path == "/tiles.js":
                return self.serve(ROOT / "static" / "tiles.js", "text/javascript")
            if self.path == "/plan.json":
                plan = json.dumps({"symbols": collector.names,
                                   "renderers": list(RENDERERS),
                                   "missing": MISSING,
                                   "size": tiles.TILE_SIZE}).encode()
                return self.body(plan, "application/json")
            if self.path.startswith("/fixtures/"):
                # Only ever a file name, so nothing can lead out of here.
                return self.serve(fixtures / Path(self.path).name, "image/png")
            self.send_error(404)

        def serve(self, path: Path, kind: str):
            if not path.is_file():
                return self.send_error(404)
            self.body(path.read_bytes(), kind)

        def body(self, data: bytes, kind: str):
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8799)
    parser.add_argument("--no-pictures", action="store_true",
                        help="skip the side-by-side PNGs")
    parser.add_argument("--timeout", type=int, default=300,
                        help="seconds to wait for the browser")
    args = parser.parse_args()

    with WORKSPACE:
        try:
            names = build_fixtures(Path(WORKSPACE.name) / "symbols")
        except ImportError:
            print("Pillow is missing - install requirements.txt", file=sys.stderr)
            return 1

        collector = Collector(names)
        pictures = None if args.no_pictures else Path(
            tempfile.mkdtemp(prefix="tilecheck-pictures-"))

        server = ThreadingHTTPServer(
            ("127.0.0.1", args.port), make_handler(collector, Path(WORKSPACE.name) / "symbols"))
        threading.Thread(target=server.serve_forever, daemon=True).start()

        print(f"{len(names)} symbols x {len(RENDERERS)} renderers "
              f"= {collector.wanted()} tiles")
        print(f"Open  http://127.0.0.1:{args.port}/  and leave it open.")
        arrived = collector.complete.wait(args.timeout)
        server.shutdown()
        if not arrived:
            print(f"\nOnly {len(collector.received)} of {collector.wanted()} "
                  f"arrived within {args.timeout}s.", file=sys.stderr)
        return report(collector, pictures)


if __name__ == "__main__":
    raise SystemExit(main())
