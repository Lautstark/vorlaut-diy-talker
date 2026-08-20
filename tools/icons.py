#!/usr/bin/env python3
"""Erzeugt die PNG-Symbole aus assets/icon.svg.

    python3 tools/icons.py

Braucht cairosvg (und damit die cairo-Bibliothek). Deshalb liegen die
erzeugten PNGs mit im Repo: wer sie nur benutzt, braucht nichts davon.
Nur wer das SVG ändert, lässt das hier einmal laufen.
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
            "Unter macOS zusätzlich:  brew install cairo")

    quelle = ASSETS / "icon.svg"
    for groesse in GROESSEN:
        ziel = ASSETS / f"icon-{groesse}.png"
        cairosvg.svg2png(url=str(quelle), write_to=str(ziel),
                         output_width=groesse, output_height=groesse)
        print(f"  {ziel.name}  {ziel.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
