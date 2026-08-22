#!/usr/bin/env python3
"""Produces the PNG icons from assets/icon.svg.

    python3 tools/icons.py

Needs cairosvg (and therefore the cairo library). That is why the generated
PNGs are in the repo: whoever only uses them needs none of it. Only whoever
changes the SVG runs this once.
"""

from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
SIZES = (192, 512)


def main() -> None:
    try:
        import cairosvg
    except ImportError:
        raise SystemExit(
            "cairosvg is missing.  pip install cairosvg\n"
            "On macOS additionally:  brew install cairo")

    source = ASSETS / "icon.svg"
    for size in SIZES:
        target = ASSETS / f"icon-{size}.png"
        cairosvg.svg2png(url=str(source), write_to=str(target),
                         output_width=size, output_height=size)
        print(f"  {target.name}  {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
