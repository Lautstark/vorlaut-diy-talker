#!/usr/bin/env python3
"""Checks that the firmware reads layout.bin exactly as the build writes it -
and that the browser writes the same file.

Compiles the C reader from the sketch on this machine and compares its output
field by field with what layout_format.py wrote in. Finds mistakes in strides,
byte order and alignment without a device having to be connected.

Since the app is becoming a static site, the same table is also written by
static/layout_format.js. Every case here goes through both writers, and the
bytes have to be identical - not merely readable, identical, because the
firmware is fixed and the whole worth of that port is that nothing about the
file changes. The C reader then reads the file JavaScript produced as well.
Three implementations of one structure, and this is the place where they have
to agree; if they do, the browser can replace the server without anybody
touching the firmware.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from layout import (LANGUAGE_CODES, SLOTS_PER_SET, active_sets,  # noqa: E402
                    hex_to_rgb, normalize_layout)
from layout_format import (HEADER_BYTES, NAME_BYTES, SET_BYTES,  # noqa: E402
                           _hash_bytes, render_layout_bin)
from tiles import rgb_to_565  # noqa: E402


def expected(layout, label, images, sounds) -> list[str]:
    """The same fields the C reader prints, seen from Python."""
    sets = active_sets(layout)
    lines = [f"sets {len(sets)}",
             f"language {LANGUAGE_CODES[layout['language']]}",
             f"sleep {layout['sleep_timeout_seconds']}"]
    for i, entry in enumerate(sets):
        colour = rgb_to_565(*hex_to_rgb(entry["color"]))
        name = entry["name"].encode("utf-8")[:NAME_BYTES].decode("utf-8", "ignore")
        lines.append(f"set {i} color {colour:04x} name {name} "
                     f"label {_hash_bytes(label[i]).hex()}")
        for j in range(SLOTS_PER_SET):
            sound = sounds[i][j]
            lines.append(
                f"slot {i} {j} image {_hash_bytes(images[i][j]).hex()} "
                f"audio {_hash_bytes(sound).hex()} has {1 if sound else 0}")
    return lines


def build_reader(target: Path) -> None:
    source = ROOT / "tests" / "layout_dump.cpp"
    result = subprocess.run(
        ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(source)],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit("C reader does not compile:\n" + result.stderr)


def render_with_node(cases: list[tuple]) -> list[bytes | str]:
    """The same layouts, written by static/layout_format.js.

    All of them in one run: starting Node costs more than writing every case
    in this file. A case the writer refused comes back as the message instead
    of as bytes, so that one bad case reads as one failure and not as a
    missing line for every case after it.
    """
    node = shutil.which("node")
    if not node:
        raise SystemExit(
            "Node is needed to check the JavaScript writer against this one, "
            "and is not on the PATH.")
    payload = [{"layout": layout, "label": label, "images": images,
                "sounds": sounds} for _, layout, label, images, sounds in cases]
    result = subprocess.run([node, str(ROOT / "tests" / "layout_node.mjs")],
                            input=json.dumps(payload), capture_output=True,
                            text=True)
    if result.returncode != 0:
        raise SystemExit("the JavaScript writer does not run:\n" + result.stderr)
    lines = result.stdout.strip().split("\n")
    if len(lines) != len(cases):
        raise SystemExit(f"the JavaScript writer answered with {len(lines)} "
                         f"lines for {len(cases)} cases")
    return [line if line.startswith("error ") else bytes.fromhex(line)
            for line in lines]


def read_back(reader: Path, tmp: Path, name: str, data: bytes) -> list[str] | str:
    """What the firmware's reader makes of these bytes.

    Decoded leniently, because one of the cases below cuts a name in the
    middle of a character on purpose. The device draws those 32 bytes as they
    are, so the reader here takes them rather than falling over them.
    """
    path = tmp / name
    path.write_bytes(data)
    result = subprocess.run([str(reader), str(path)], capture_output=True)
    output = result.stdout.decode("utf-8", "replace")
    if result.returncode != 0:
        return f"the C reader reports {output.strip()}"
    return [l for l in output.strip().split("\n") if not l.startswith("bytes")]


def js_difference(data: bytes, js: bytes | str) -> str | None:
    """What is wrong with what JavaScript wrote, or None if nothing is.

    Byte for byte, not field by field: the firmware is fixed, so the only
    right answer is the file Python already produces.
    """
    if isinstance(js, str):
        return f"the JavaScript writer refused it - {js[6:]}"
    if js == data:
        return None
    if len(js) != len(data):
        return f"JavaScript writes {len(js)} bytes instead of {len(data)}"
    for i, (a, b) in enumerate(zip(data, js)):
        if a != b:
            return (f"JavaScript writes different bytes, first at {i}: "
                    f"Python {a:02x}, JavaScript {b:02x}")
    return None


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
    # Switched-off sets stay in layout.json and do not go onto the device.
    # Both writers have to leave out the same ones, and setCount has to be
    # what is left rather than what the file holds.
    yield "a switched-off set in the middle", {
        "sleep_timeout_seconds": 600,
        "sets": [{"name": "Erstes", "color": "#3B5BDB", "slots": []},
                 {"name": "Ausgeschaltet", "active": False,
                  "color": "#159947", "slots": []},
                 {"name": "Drittes", "color": "#FF6B35", "slots": []}]}
    # The layout a fresh clone starts with. Everything else here was written
    # for the test; this is the one case that actually ships.
    yield "the example content", json.loads(
        (ROOT / "example" / "layout.json").read_text(encoding="utf-8"))
    # The language rides in a single byte of the header. Every value the build
    # can write has to arrive, and something it cannot write has to end up as
    # the default rather than as a wrong index.
    for name in LANGUAGE_CODES:
        yield f"language {name}", {"sleep_timeout_seconds": 600,
                                   "language": name, "sets": []}
    yield "unknown language", {"sleep_timeout_seconds": 600,
                               "language": "kl", "sets": []}
    yield "no language field", {"sleep_timeout_seconds": 600, "sets": []}


def prepared(raw_cases) -> list[tuple]:
    """Each case with the file lists the build would hand in.

    One entry per active set and in its order - that is how builder.py builds
    them, and the writer reads them by that index.
    """
    out = []
    for name, raw in raw_cases:
        layout = normalize_layout(raw)
        sets = active_sets(layout)
        n = len(sets)
        label = [f"t{'%032x' % (i + 1)}.bin" for i in range(n)]
        images = [[f"t{'%032x' % (i * 10 + j + 100)}.bin" for j in range(4)]
                  for i in range(n)]
        sounds = [[f"a{'%032x' % (i * 10 + j + 200)}.wav"
                   if sets[i]["slots"][j]["text"] else ""
                   for j in range(4)] for i in range(n)]
        out.append((name, layout, label, images, sounds))
    return out


def writer_cases() -> list[tuple]:
    """Cases aimed at the writer rather than at the reader.

    These skip normalize_layout on purpose: they are the edges where two
    implementations of the same rule drift apart, and normalize_layout would
    file most of them off before the writer ever saw them. Nothing here is
    compared field by field with the C reader - a name cut in the middle of a
    character is not text any more, and the point of the case is precisely
    that both writers cut in the same place.
    """
    empty = ["", "", "", ""]
    hashes = [f"t{'%032x' % (j + 1)}.bin" for j in range(4)]
    return [
        # 41 bytes, and the cut lands inside the sixteenth accented letter.
        # Cutting the string instead of the bytes takes 32 characters, which
        # is a different name - and on the device a broken last glyph.
        ("a name cut in the middle of a character",
         {"sleep_timeout_seconds": 600, "language": "en",
          "sets": [{"name": "x" + "é" * 20, "color": "#3B5BDB"}]},
         [""], [empty], [empty]),
        # Exactly full, without a byte to spare and without padding.
        ("a name of exactly 32 bytes",
         {"sleep_timeout_seconds": 600, "language": "en",
          "sets": [{"name": "é" * 16, "color": "#3B5BDB"}]},
         [""], [empty], [empty]),
        # A name far longer than the field. Nothing stops one being typed,
        # and what it must not do is reach past the 32 bytes it has.
        ("a name of 300 characters",
         {"sleep_timeout_seconds": 600, "language": "en",
          "sets": [{"name": "A whole sentence as a name " * 12,
                    "color": "#3B5BDB"}]},
         [""], [empty], [empty]),
        # Hashed names of shapes the build does not produce, but which a hand
        # edited or half-migrated content folder can. The longest of them is
        # the audio of the last slot on purpose: that is the one place where
        # too many bytes cannot be quietly covered by the next field.
        ("hashes shorter and longer than the field",
         {"sleep_timeout_seconds": 600, "language": "en",
          "sets": [{"name": "Kurz und lang", "color": "#159947"}]},
         ["t0a.bin"],
         [["t" + "ab" * 20 + ".bin", "t" + "cd" * 16, "", "t00.bin"]],
         [["a" + "ef" * 16 + ".wav", "", "a0011.wav", "a" + "9d" * 20 + ".wav"]]),
        # A sleep timeout at the top of the range. normalize_layout clamps to
        # a day, but the writer is what is being checked here, and the top end
        # is where a signed write would show.
        ("sleep at both ends of the uint32",
         {"sleep_timeout_seconds": 0xFFFFFFFF, "language": "de",
          "sets": [{"name": "Lang wach", "color": "#FFFFFF",
                    "slots": []}]},
         [hashes[0]], [hashes], [hashes]),
        ("sleep of zero",
         {"sleep_timeout_seconds": 0, "sets": []}, [], [], []),
        # Colours as they arrive before anybody normalizes them.
        ("colours that still need normalizing",
         {"sleep_timeout_seconds": 600, "language": "en",
          "sets": [{"name": "Kurzform", "color": "#abc"},
                   {"name": "Ohne Raute", "color": "3B5BDB"},
                   {"name": "Leer", "color": ""},
                   {"name": "Unsinn", "color": "keine Farbe"},
                   {"name": "Mit Leerzeichen", "color": "  #ff8bc7  "}]},
         [""] * 5, [empty] * 5, [empty] * 5),
        # A layout with no language field at all, which is what a file from
        # before that byte looks like once it is read back in.
        ("no language field and no sets",
         {"sleep_timeout_seconds": 600, "sets": []}, [], [], []),
    ]


def main() -> int:
    with tempfile.TemporaryDirectory() as raw_tmp:
        tmp = Path(raw_tmp)
        reader = tmp / "layout_dump"
        build_reader(reader)
        failures = 0

        # The first list is compared field by field with the C reader, the
        # second byte for byte between the two writers. Both go through both
        # writers, and through Node in a single run.
        field_cases = prepared(cases())
        byte_cases = writer_cases()
        from_js = render_with_node(field_cases + byte_cases)

        for index, (name, layout, label, images, sounds) in enumerate(field_cases):
            data = render_layout_bin(layout, label, images, sounds)
            want = expected(layout, label, images, sounds)

            got = read_back(reader, tmp, "python.bin", data)
            if isinstance(got, str):
                print(f"  {name}: {got}")
                failures += 1
                continue
            if got != want:
                failures += 1
                print(f"  {name}: DIFFERENT")
                for a, b in zip(want, got):
                    if a != b:
                        print(f"    Python: {a}")
                        print(f"    C:      {b}")
                if len(want) != len(got):
                    print(f"    lines: Python {len(want)}, C {len(got)}")
                continue

            problem = js_difference(data, from_js[index])
            if problem:
                print(f"  {name}: {problem}")
                failures += 1
                continue
            js = from_js[index]

            # The same bytes read by the firmware's own reader. Implied by the
            # comparison above, and run all the same: this is the step that
            # says the browser may replace the server, and it should be a
            # thing the test does rather than a thing the reader infers.
            got = read_back(reader, tmp, "js.bin", js)
            if got != want:
                failures += 1
                print(f"  {name}: the C reader reads the JavaScript file "
                      f"differently")
                print(f"    {got}")
                continue

            print(f"  {name}: {len(want)} fields agree, in Python, in "
                  f"JavaScript and in C")

        for offset, (name, layout, label, images, sounds) in enumerate(byte_cases):
            data = render_layout_bin(layout, label, images, sounds)
            js = from_js[len(field_cases) + offset]
            problem = js_difference(data, js)
            if problem:
                print(f"  {name}: {problem}")
                failures += 1
                continue
            # No field comparison for these, but the firmware still has to
            # accept what came out - a length or a set count that does not
            # add up would be refused here.
            got = read_back(reader, tmp, "js.bin", js)
            if isinstance(got, str):
                print(f"  {name}: {got}")
                failures += 1
                continue
            print(f"  {name}: {len(data)} identical bytes, and the C reader "
                  f"takes them")

        # A layout.bin from before the language byte existed still has to
        # read, and has to come out as the default rather than as garbage.
        old = bytearray(render_layout_bin(
            normalize_layout({"sleep_timeout_seconds": 600, "sets": []}),
            [], [], []))
        old[7] = 0                      # what the reserved byte always held
        got = read_back(reader, tmp, "old.bin", bytes(old))
        if isinstance(got, str) or "language 0" not in "\n".join(got):
            print("  a layout.bin from before the language byte does not read "
                  "as English")
            failures += 1
        else:
            print("  older layout.bin still reads, language falls back to English")

        # And the size has to match the calculated structure
        for n in range(6):
            want_size = HEADER_BYTES + n * SET_BYTES
            layout = normalize_layout({"sleep_timeout_seconds": 600, "sets": [
                {"name": "x", "symbol": "", "color": "#000000",
                 "slots": [{"text": "", "symbol": ""}] * 4} for _ in range(n)]})
            data = render_layout_bin(layout, [""] * n, [[""] * 4] * n,
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
