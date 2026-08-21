#!/usr/bin/env python3
"""Checks that the firmware reads layout.bin exactly as build.py writes it.

Compiles the C reader from the sketch on this machine and compares its output
field by field with what build.py wrote in. Finds mistakes in strides, byte
order and alignment without a device having to be connected.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


def expected(layout, label, images, sounds) -> list[str]:
    """The same fields the C reader prints, seen from Python."""
    lines = [f"sets {len(layout['sets'])}",
             f"language {build.LANGUAGE_CODES[layout['language']]}",
             f"sleep {layout['sleep_timeout_seconds']}"]
    for i, entry in enumerate(layout["sets"]):
        colour = build.rgb_to_565(*build.hex_to_rgb(entry["color"]))
        name = entry["name"].encode("utf-8")[:build.NAME_BYTES].decode("utf-8", "ignore")
        lines.append(f"set {i} color {colour:04x} name {name} "
                     f"label {build._hash_bytes(label[i]).hex()}")
        for j in range(build.SLOTS_PER_SET):
            sound = sounds[i][j]
            lines.append(
                f"slot {i} {j} image {build._hash_bytes(images[i][j]).hex()} "
                f"audio {build._hash_bytes(sound).hex()} has {1 if sound else 0}")
    return lines


def build_reader(target: Path) -> None:
    source = ROOT / "tests" / "layout_dump.cpp"
    result = subprocess.run(
        ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(source)],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit("C reader does not compile:\n" + result.stderr)


def cases():
    """Several layouts, so more than the one normal case gets checked."""
    yield "empty", {"sleep_timeout_seconds": 600, "sets": []}
    yield "one set", {
        "sleep_timeout_seconds": 30,
        "sets": [{"name": "Grundset", "symbol": "a.png", "color": "#3B5BDB",
                  "slots": [{"text": "Ja", "symbol": "j.png"},
                            {"text": "", "symbol": ""},
                            {"text": "Stopp", "symbol": "s.png"},
                            {"text": "", "symbol": ""}]}]}
    yield "five sets, long names, extreme colours", {
        "sleep_timeout_seconds": 86400,
        "sets": [{"name": f"Ein sehr langer Name {i} mit Umlauten äöü",
                  "symbol": f"s{i}.png", "color": c,
                  "slots": [{"text": f"Satz {i}{j}", "symbol": f"b{i}{j}.png"}
                            for j in range(4)]}
                 for i, c in enumerate(["#000000", "#FFFFFF", "#FF0000",
                                        "#00FF00", "#0000FF"])]}
    # The language rides in a single byte of the header. Every value build.py
    # can write has to arrive, and something it cannot write has to end up as
    # the default rather than as a wrong index.
    for name in build.LANGUAGE_CODES:
        yield f"language {name}", {"sleep_timeout_seconds": 600,
                                   "language": name, "sets": []}
    yield "unknown language", {"sleep_timeout_seconds": 600,
                               "language": "kl", "sets": []}
    yield "no language field", {"sleep_timeout_seconds": 600, "sets": []}


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        reader = Path(tmp) / "layout_dump"
        build_reader(reader)
        failures = 0
        for name, raw in cases():
            layout = build.normalize_layout(raw)
            n = len(layout["sets"])
            label = [f"t{'%032x' % (i + 1)}.bin" for i in range(n)]
            images = [[f"t{'%032x' % (i * 10 + j + 100)}.bin" for j in range(4)]
                      for i in range(n)]
            sounds = [[f"a{'%032x' % (i * 10 + j + 200)}.wav"
                       if layout["sets"][i]["slots"][j]["text"] else ""
                       for j in range(4)] for i in range(n)]

            path = Path(tmp) / "layout.bin"
            path.write_bytes(build.render_layout_bin(layout, label, images, sounds))

            result = subprocess.run([str(reader), str(path)],
                                    capture_output=True, text=True)
            if result.returncode != 0:
                print(f"  {name}: C reader reports {result.stdout.strip()}")
                failures += 1
                continue

            got = [l for l in result.stdout.strip().split("\n")
                   if not l.startswith("bytes")]
            want = expected(layout, label, images, sounds)
            if got == want:
                print(f"  {name}: {len(want)} fields agree")
            else:
                failures += 1
                print(f"  {name}: DIFFERENT")
                for a, b in zip(want, got):
                    if a != b:
                        print(f"    Python: {a}")
                        print(f"    C:      {b}")
                if len(want) != len(got):
                    print(f"    lines: Python {len(want)}, C {len(got)}")

        # A layout.bin from before the language byte existed still has to
        # read, and has to come out as the default rather than as garbage.
        old = bytearray(build.render_layout_bin(
            build.normalize_layout({"sleep_timeout_seconds": 600, "sets": []}),
            [], [], []))
        old[7] = 0                      # what the reserved byte always held
        path = Path(tmp) / "old.bin"
        path.write_bytes(bytes(old))
        result = subprocess.run([str(reader), str(path)],
                                capture_output=True, text=True)
        if "language 0" not in result.stdout:
            print("  a layout.bin from before the language byte does not read "
                  "as English")
            failures += 1
        else:
            print("  older layout.bin still reads, language falls back to English")

        # And the size has to match the calculated structure
        for n in range(6):
            want_size = build.HEADER_BYTES + n * build.SET_BYTES
            layout = build.normalize_layout({"sleep_timeout_seconds": 600, "sets": [
                {"name": "x", "symbol": "", "color": "#000000",
                 "slots": [{"text": "", "symbol": ""}] * 4} for _ in range(n)]})
            data = build.render_layout_bin(layout, [""] * n, [[""] * 4] * n,
                                           [[""] * 4] * n)
            if len(data) != want_size:
                print(f"  size at {n} sets: {len(data)}, expected {want_size}")
                failures += 1
        print("  sizes for 0 to 5 sets are right")

        if failures:
            print(f"\n  {failures} difference(s)")
            return 1
        print("\n  All good.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
