#!/usr/bin/env python3
"""Checks that the firmware reads layout.bin exactly as build.py writes it.

Compiles the C reader from the sketch on this machine and compares its output
field by field with what build.py wrote in. Finds mistakes in strides, byte
order and alignment without a device having to be connected.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


def erwartung(layout, label, bilder, toene) -> list[str]:
    """Dieselben Angaben wie der C-Leser sie ausgibt, aus Python-Sicht."""
    zeilen = [f"sets {len(layout['sets'])}",
              f"sleep {layout['sleep_timeout_seconds']}"]
    for i, entry in enumerate(layout["sets"]):
        farbe = build.rgb_to_565(*build.hex_to_rgb(entry["color"]))
        name = entry["name"].encode("utf-8")[:build.NAME_BYTES].decode("utf-8", "ignore")
        zeilen.append(f"set {i} color {farbe:04x} name {name} "
                      f"label {build._hash_bytes(label[i]).hex()}")
        for j in range(build.SLOTS_PER_SET):
            ton = toene[i][j]
            zeilen.append(
                f"slot {i} {j} image {build._hash_bytes(bilder[i][j]).hex()} "
                f"audio {build._hash_bytes(ton).hex()} has {1 if ton else 0}")
    return zeilen


def baue_leser(ziel: Path) -> None:
    quelle = ROOT / "tests" / "layout_dump.cpp"
    ergebnis = subprocess.run(
        ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(ziel), str(quelle)],
        capture_output=True, text=True)
    if ergebnis.returncode != 0:
        raise SystemExit("C-Leser übersetzt nicht:\n" + ergebnis.stderr)


def faelle():
    """Verschiedene Layouts, damit nicht nur der eine Normalfall geprüft wird."""
    yield "leer", {"sleep_timeout_seconds": 600, "sets": []}
    yield "ein Set", {
        "sleep_timeout_seconds": 30,
        "sets": [{"name": "Grundset", "symbol": "a.png", "color": "#3B5BDB",
                  "slots": [{"text": "Ja", "symbol": "j.png"},
                            {"text": "", "symbol": ""},
                            {"text": "Stopp", "symbol": "s.png"},
                            {"text": "", "symbol": ""}]}]}
    yield "fünf Sets, lange Namen, Randfarben", {
        "sleep_timeout_seconds": 86400,
        "sets": [{"name": f"Ein sehr langer Name {i} mit Umlauten äöü",
                  "symbol": f"s{i}.png", "color": c,
                  "slots": [{"text": f"Satz {i}{j}", "symbol": f"b{i}{j}.png"}
                            for j in range(4)]}
                 for i, c in enumerate(["#000000", "#FFFFFF", "#FF0000",
                                        "#00FF00", "#0000FF"])]}


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        leser = Path(tmp) / "layout_dump"
        baue_leser(leser)
        fehler = 0
        for name, roh in faelle():
            layout = build.normalize_layout(roh)
            n = len(layout["sets"])
            label = [f"t{'%032x' % (i + 1)}.bin" for i in range(n)]
            bilder = [[f"t{'%032x' % (i * 10 + j + 100)}.bin" for j in range(4)]
                      for i in range(n)]
            toene = [[f"a{'%032x' % (i * 10 + j + 200)}.wav"
                      if layout["sets"][i]["slots"][j]["text"] else ""
                      for j in range(4)] for i in range(n)]

            datei = Path(tmp) / "layout.bin"
            datei.write_bytes(build.render_layout_bin(layout, label, bilder, toene))

            ergebnis = subprocess.run([str(leser), str(datei)],
                                      capture_output=True, text=True)
            if ergebnis.returncode != 0:
                print(f"  {name}: C-Leser meldet {ergebnis.stdout.strip()}")
                fehler += 1
                continue

            gelesen = [z for z in ergebnis.stdout.strip().split("\n")
                       if not z.startswith("bytes")]
            soll = erwartung(layout, label, bilder, toene)
            if gelesen == soll:
                print(f"  {name}: {len(soll)} Angaben stimmen überein")
            else:
                fehler += 1
                print(f"  {name}: UNTERSCHIED")
                for a, b in zip(soll, gelesen):
                    if a != b:
                        print(f"    Python: {a}")
                        print(f"    C:      {b}")
                if len(soll) != len(gelesen):
                    print(f"    Zeilen: Python {len(soll)}, C {len(gelesen)}")

        # And the size has to match the calculated structure
        for n in range(6):
            erwartet = build.HEADER_BYTES + n * build.SET_BYTES
            leer = build.normalize_layout({"sleep_timeout_seconds": 600, "sets": [
                {"name": "x", "symbol": "", "color": "#000000",
                 "slots": [{"text": "", "symbol": ""}] * 4} for _ in range(n)]})
            daten = build.render_layout_bin(leer, [""] * n, [[""] * 4] * n, [[""] * 4] * n)
            if len(daten) != erwartet:
                print(f"  Größe bei {n} Sets: {len(daten)}, erwartet {erwartet}")
                fehler += 1
        print(f"  Größen für 0 bis 5 Sets stimmen")

        if fehler:
            print(f"\n  {fehler} Abweichung(en)")
            return 1
        print("\n  Alles in Ordnung.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
