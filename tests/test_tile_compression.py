#!/usr/bin/env python3
"""The browser compresses a tile and the firmware draws the same picture back.

The fourteen tiles in tests/reference/tiles/ are what Pillow rendered while
there was still a Pillow half to ask, and docs/frozen-references.md has what
they do and do not answer for. What they are used for here is a third opinion
that neither implementation of the *compression* had a hand in: the browser
encodes them, the firmware's own decoder - compiled from
firmware/vorlaut/tile_format.h on the machine running this - reads what it
wrote, and the frozen bytes say whether the picture came back.

That is the shape tests/test_layout_frozen.py has, and the same thing makes it
worth running: neither half is compared against itself. An encoder checked
only by its own decoder agrees with itself no matter what it does, and both of
them agreeing on the wrong pixels is exactly the fault that would reach a
child's talker looking like a working device.

  the round trip     encodeTile() in loader/src/tile_encode.ts, then
                     tileBegin()/tileNextRow() in tile_format.h, against the
                     frozen tile. Needs node and a C++ compiler.
  the two rules      that a compressed file is smaller than the raw one and
                     never exactly TILE_BYTES long - the length is the only
                     thing that tells the two forms apart.

What the *format* does with a file that is short, over-long or not a tile at
all is not here. That is device/fixtures/tile/, where the rest of this
boundary's behaviour is already stated, and tests/test_device_host.py and
tests/unit/device_fixtures.test.ts are the two halves that run it.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILES = ROOT / "tests" / "reference" / "tiles"
JS_RUNNER = ROOT / "node_modules" / ".bin" / "vite-node"
RAW_BYTES = 32768

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def build(target: Path) -> bool:
    """The firmware's decoder, compiled here rather than frozen."""
    compiler = shutil.which("g++") or shutil.which("clang++")
    if not compiler:
        return False
    result = subprocess.run(
        [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "device_host.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("the firmware's decoder compiles", False,
              result.stderr.strip()[:600])
        return False
    check("the firmware's decoder compiles", True)
    return True


def encoded_by_the_browser() -> dict[str, tuple[str, bytes]] | None:
    """Every frozen tile, run through loader/src/tile_encode.ts."""
    if not JS_RUNNER.exists():
        return None
    result = subprocess.run([str(JS_RUNNER), str(ROOT / "tests" / "tile_node.mjs")],
                            capture_output=True, text=True, cwd=ROOT)
    if result.returncode != 0:
        check("the browser's encoder runs", False, result.stderr.strip()[:600])
        return {}
    check("the browser's encoder runs", True)
    out: dict[str, tuple[str, bytes]] = {}
    for line in result.stdout.strip().split("\n"):
        name, verdict, hexed = line.split(" ")
        out[name] = (verdict, bytes.fromhex(hexed))
    return out


def main() -> int:
    frozen = sorted(TILES.glob("*.rgb565"))
    if not frozen:
        print(f"  {TILES} holds no tiles - restore it from git.")
        return 1

    written = encoded_by_the_browser()
    if written is None:
        print("  skipped: node_modules/.bin/vite-node is not there, so the "
              "browser's encoder was not run. `npm install` puts it there, "
              "and without it nothing below means anything.")
        return 0

    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        reader = tmp / "device_host"
        if not build(reader):
            print("  skipped: no C++ compiler, so the firmware's decoder was "
                  "not built. The browser's own round trip was checked and "
                  "nothing independent confirmed it.")
            reader = None

        smaller = 0
        for tile in frozen:
            name = tile.stem
            want = tile.read_bytes()
            if name not in written:
                check(f"{name}: the browser encoded it", False, "no line for it")
                continue
            verdict, bytes_written = written[name]

            # The browser reading back what the browser wrote. On its own this
            # says nothing about the device; what it separates is an encoder
            # that is wrong from a decoder that is.
            check(f"{name}: the browser reads its own {len(bytes_written)} bytes back",
                  verdict == "roundtrip", verdict)

            # The two rules that keep the forms apart. A compressed file of
            # exactly RAW_BYTES would be read as a raw one by every device.
            check(f"{name}: smaller than the {RAW_BYTES} raw bytes",
                  len(bytes_written) < RAW_BYTES,
                  f"{len(bytes_written)} bytes")
            if len(bytes_written) < RAW_BYTES:
                smaller += 1

            if reader is None:
                continue

            written_at = tmp / "tile.bin"
            written_at.write_bytes(bytes_written)
            decoded_at = tmp / "decoded.bin"
            result = subprocess.run(
                [str(reader), "tile", str(written_at), str(decoded_at)],
                input=b"", capture_output=True)
            said = {line.split(" ")[0]: line.partition(" ")[2]
                    for line in result.stdout.decode().strip().split("\n")}
            check(f"{name}: the firmware takes it as the compressed form",
                  said.get("accepts") == "1" and said.get("form") == "vt1",
                  f"accepts {said.get('accepts')}, form {said.get('form')}")
            got = decoded_at.read_bytes() if decoded_at.exists() else b""
            if got == want:
                check(f"{name}: and draws the frozen picture, byte for byte",
                      True, f"factor {RAW_BYTES / len(bytes_written):.2f}")
            else:
                first = next((i for i, (a, b) in enumerate(zip(want, got))
                              if a != b), min(len(want), len(got)))
                check(f"{name}: and draws the frozen picture, byte for byte",
                      False,
                      f"{len(got)} bytes back, first difference at byte {first}")

        total_raw = RAW_BYTES * len(frozen)
        total_now = sum(min(len(b), RAW_BYTES) for _, b in written.values())
        print(f"\n  {smaller} of {len(frozen)} tiles came out smaller: "
              f"{total_raw} bytes of pictures in {total_now}, "
              f"factor {total_raw / total_now:.2f} over the fourteen. The five "
              f"that are real symbols rather than gradients do better than "
              f"that - see adr/0019 for the measurement the format was chosen "
              f"on.")

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures[:6])}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
