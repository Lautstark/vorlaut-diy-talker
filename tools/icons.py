#!/usr/bin/env python3
"""Produces the PNG icons from assets/icon.svg.

    python3 tools/icons.py

Needs cairosvg (and therefore the cairo library). That is why the generated
PNGs are in the repo: whoever only uses them needs none of it. Only whoever
changes the SVG runs this once.
"""

from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
GROESSEN = (192, 512)


def main() -> None:
    try:
        import cairosvg
    except ImportError:
        raise SystemExit(
            "cairosvg fehlt.  pip install cairosvg\n"
            "On macOS additionally:  brew install cairo")

    quelle = ASSETS / "icon.svg"
    for groesse in GROESSEN:
        ziel = ASSETS / f"icon-{groesse}.png"
        cairosvg.svg2png(url=str(quelle), write_to=str(ziel),
                         output_width=groesse, output_height=groesse)
        print(f"  {ziel.name}  {ziel.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
