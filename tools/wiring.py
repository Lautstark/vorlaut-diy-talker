#!/usr/bin/env python3
"""Draws docs/wiring.png from the pin assignment.

    python3 tools/wiring.py

Kept as a script in the repo so the picture can be corrected as soon as the
real modules say something different - a PNG on its own nobody could change.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TARGET = Path(__file__).resolve().parent.parent / "docs" / "wiring.png"

BG = (252, 252, 252); TXT = (28, 30, 36); GREY = (125, 131, 142)
BOX = (240, 242, 246); FRAME = (200, 204, 212)
RED = (200, 60, 60); BLACK = (45, 47, 54); BLUE = (40, 100, 200)
ORANGE = (205, 125, 35); YELLOW = (175, 145, 30); GREEN = (30, 140, 75)
PURPLE = (135, 75, 185); TEAL = (25, 140, 160)

# --- Pin assignment. Change it here when something changes. -------------------
SHARED = [("3V", "VCC", RED), ("GND", "GND", BLACK), ("SCK", "CLK", BLUE),
          ("MO", "DIN", BLUE), ("D9", "DC", ORANGE), ("D10", "RST", ORANGE),
          ("SDA", "PWM", YELLOW)]
CS = ["D11", "D12", "MI", "D5", "D6"]
KEY = ["A0", "A1", "A2", "A3", "A4"]
AMPLIFIER = [("A5  / GPIO 8", "BCLK"), ("RX  / GPIO 38", "LRC"),
             ("TX  / GPIO 39", "DIN"), ("SCL / GPIO 4", "SD"),
             ("3V / GND", "Vin / GND")]
FEATHER = [
    ("3V", "3V", RED, "to all"), ("GND", "GND", BLACK, "to all"),
    ("SCK", "GPIO 36", BLUE, "to all"), ("MO", "GPIO 35", BLUE, "to all"),
    ("D9", "GPIO 9", ORANGE, "to all"), ("D10", "GPIO 10", ORANGE, "to all"),
    ("SDA", "GPIO 3", YELLOW, "to all"),
    ("D11", "GPIO 11", GREEN, "CS 1"), ("D12", "GPIO 12", GREEN, "CS 2"),
    ("MI", "GPIO 37", GREEN, "CS 3"), ("D5", "GPIO 5", GREEN, "CS 4"),
    ("D6", "GPIO 6", GREEN, "CS 5"),
    ("A0", "GPIO 18", PURPLE, "KEY 1"), ("A1", "GPIO 17", PURPLE, "KEY 2"),
    ("A2", "GPIO 16", PURPLE, "KEY 3"), ("A3", "GPIO 15", PURPLE, "KEY 4"),
    ("A4", "GPIO 14", PURPLE, "KEY 5"),
    ("A5", "GPIO 8", TEAL, "amplifier"), ("RX", "GPIO 38", TEAL, "amplifier"),
    ("TX", "GPIO 39", TEAL, "amplifier"), ("SCL", "GPIO 4", TEAL, "amplifier"),
]
NOTES = [
    ("RST is common to all five.", "The firmware pulses it once by hand and"),
    ("", "hands the drivers -1 - otherwise module 3 would reset modules 1"),
    ("", "and 2 while starting up."),
    ("PWM on one GPIO", "only if the BL input is a logic input."),
    ("", "If it draws the LED current directly, a MOSFET belongs in between."),
    ("Buttons against GND,", "the internal pull-ups are active. Pressed = LOW."),
    ("Buttons on GPIO 0 to 21 only.", "Only those wake it from deep sleep."),
    ("MISO carries CS 3.", "GPIO 13 is the built-in LED and stays free so it"),
    ("", "can serve as a sign of life. Nothing is read from the"),
    ("", "displays anyway."),
]


def font(size: int, bold: bool = False):
    for path in ("/System/Library/Fonts/HelveticaNeue.ttc" if bold
                 else "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
                 else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    W, H = 1420, 1000
    f, fk, fb, ft = font(13), font(11), font(16, True), font(22, True)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    def box(x, y, w, h, title, subtitle=None):
        d.rounded_rectangle([x, y, x + w, y + h], 10, fill=BOX,
                            outline=FRAME, width=2)
        d.text((x + 14, y + 11), title, font=fb, fill=TXT)
        if subtitle:
            d.text((x + 14, y + 33), subtitle, font=fk, fill=GREY)

    d.text((40, 26), "vorlaut - wiring", font=ft, fill=TXT)
    d.text((40, 56), "Seven lines go to all five modules. "
                     "Only CS and KEY are per module.", font=f, fill=GREY)

    fx, fy, fw = 40, 100, 250
    box(fx, fy, fw, 62 + len(FEATHER) * 24 + 14, "ESP32-S3 Feather",
        "charges the battery over USB-C")
    y = fy + 60
    for name, gpio, colour, purpose in FEATHER:
        d.rectangle([fx + 14, y + 3, fx + 24, y + 13], fill=colour)
        d.text((fx + 34, y), name, font=f, fill=TXT)
        d.text((fx + 82, y + 1), gpio, font=fk, fill=GREY)
        d.text((fx + 152, y), purpose, font=fk, fill=colour)
        y += 24

    gx, gy, gw = 360, 100, 300
    gh = 62 + len(SHARED) * 26 + 14
    box(gx, gy, gw, gh, "to all five modules", "wire once, connected everywhere")
    y = gy + 62
    for left, right, colour in SHARED:
        d.rectangle([gx + 14, y + 3, gx + 24, y + 13], fill=colour)
        d.text((gx + 34, y), left, font=f, fill=TXT)
        d.text((gx + 96, y), "->", font=f, fill=GREY)
        d.text((gx + 126, y), right, font=f, fill=colour)
        y += 26
    d.line([gx + gw, gy + gh // 2, 700, gy + gh // 2], fill=GREY, width=6)

    mx, mw, mh = 740, 300, 92
    for i in range(5):
        my = 100 + i * 104
        box(mx, my, mw, mh, f"ScreenKey {i + 1}",
            "set key" if i == 4 else f"speech key {i + 1}")
        d.line([700, my + 46, mx, my + 46], fill=GREY, width=4)
        d.rectangle([mx + 14, my + 56, mx + 24, my + 66], fill=GREEN)
        d.text((mx + 34, my + 53), f"CS  -> {CS[i]}", font=f, fill=GREEN)
        d.rectangle([mx + 150, my + 56, mx + 160, my + 66], fill=PURPLE)
        d.text((mx + 170, my + 53), f"KEY -> {KEY[i]}", font=f, fill=PURPLE)
        d.text((mx + 34, my + 72), "button goes to GND", font=fk, fill=GREY)
    d.line([700, 118, 700, 100 + 4 * 104 + 46], fill=GREY, width=6)

    ay = 660
    box(mx, ay, mw, 150, "MAX98357A", "amplifier")
    for i, (left, right) in enumerate(AMPLIFIER):
        yy = ay + 58 + i * 19
        d.rectangle([mx + 14, yy + 2, mx + 24, yy + 12], fill=TEAL)
        d.text((mx + 34, yy), left, font=fk, fill=TXT)
        d.text((mx + 150, yy), "->", font=fk, fill=GREY)
        d.text((mx + 176, yy), right, font=fk, fill=TEAL)
    box(mx + mw + 40, ay + 40, 220, 80, "Speaker", "40 mm, 4 Ω, 5 W")
    d.line([mx + mw, ay + 80, mx + mw + 40, ay + 80], fill=TEAL, width=4)

    hy = 700
    d.text((fx, hy), "What to watch out for", font=fb, fill=TXT)
    for i, (bold, rest) in enumerate(NOTES):
        yy = hy + 30 + i * 22
        if bold:
            d.text((fx, yy), "-", font=f, fill=GREY)
            d.text((fx + 14, yy), bold, font=f, fill=TXT)
            d.text((fx + 18 + d.textlength(bold, font=f), yy), rest, font=f, fill=GREY)
        else:
            d.text((fx + 14, yy), rest, font=f, fill=GREY)

    d.text((fx, H - 38), "Calculated, not measured. "
                         "Check against the real modules before soldering.",
           font=fk, fill=(190, 85, 85))

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    img.save(TARGET)
    print(f"written: {TARGET.relative_to(Path(__file__).resolve().parent.parent)}"
          f"  {W}x{H}")


if __name__ == "__main__":
    main()
