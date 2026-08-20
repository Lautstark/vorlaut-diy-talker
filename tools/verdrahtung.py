#!/usr/bin/env python3
"""Zeichnet docs/verdrahtung.png aus der Pinbelegung.

    python3 tools/verdrahtung.py

Liegt als Skript im Repo, damit sich das Bild korrigieren lässt, sobald die
echten Module etwas anderes sagen - ein PNG allein könnte niemand ändern.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ZIEL = Path(__file__).resolve().parent.parent / "docs" / "verdrahtung.png"

BG = (252, 252, 252); TXT = (28, 30, 36); GRAU = (125, 131, 142)
KASTEN = (240, 242, 246); RAHMEN = (200, 204, 212)
ROT = (200, 60, 60); SCHWARZ = (45, 47, 54); BLAU = (40, 100, 200)
ORANGE = (205, 125, 35); GELB = (175, 145, 30); GRUEN = (30, 140, 75)
LILA = (135, 75, 185); TUERKIS = (25, 140, 160)

# --- Pinbelegung. Hier ändern, wenn sich etwas ändert. -----------------------
GEMEINSAM = [("3V", "VCC", ROT), ("GND", "GND", SCHWARZ), ("SCK", "CLK", BLAU),
             ("MO", "DIN", BLAU), ("D9", "DC", ORANGE), ("D10", "RST", ORANGE),
             ("SDA", "PWM", GELB)]
CS = ["D11", "D12", "MI", "D5", "D6"]
KEY = ["A0", "A1", "A2", "A3", "A4"]
VERSTAERKER = [("A5  / GPIO 8", "BCLK"), ("RX  / GPIO 38", "LRC"),
               ("TX  / GPIO 39", "DIN"), ("SCL / GPIO 4", "SD"),
               ("3V / GND", "Vin / GND")]
FEATHER = [
    ("3V", "3V", ROT, "an alle"), ("GND", "GND", SCHWARZ, "an alle"),
    ("SCK", "GPIO 36", BLAU, "an alle"), ("MO", "GPIO 35", BLAU, "an alle"),
    ("D9", "GPIO 9", ORANGE, "an alle"), ("D10", "GPIO 10", ORANGE, "an alle"),
    ("SDA", "GPIO 3", GELB, "an alle"),
    ("D11", "GPIO 11", GRUEN, "CS 1"), ("D12", "GPIO 12", GRUEN, "CS 2"),
    ("MI", "GPIO 37", GRUEN, "CS 3"), ("D5", "GPIO 5", GRUEN, "CS 4"),
    ("D6", "GPIO 6", GRUEN, "CS 5"),
    ("A0", "GPIO 18", LILA, "KEY 1"), ("A1", "GPIO 17", LILA, "KEY 2"),
    ("A2", "GPIO 16", LILA, "KEY 3"), ("A3", "GPIO 15", LILA, "KEY 4"),
    ("A4", "GPIO 14", LILA, "KEY 5"),
    ("A5", "GPIO 8", TUERKIS, "Verstärker"), ("RX", "GPIO 38", TUERKIS, "Verstärker"),
    ("TX", "GPIO 39", TUERKIS, "Verstärker"), ("SCL", "GPIO 4", TUERKIS, "Verstärker"),
]
HINWEISE = [
    ("RST liegt an allen fünf.", "Die Firmware pulst ihn einmal von Hand und gibt"),
    ("", "den Treibern -1 - sonst würde Modul 3 beim Starten die Module 1"),
    ("", "und 2 zurücksetzen."),
    ("PWM an einem GPIO", "nur, wenn der BL-Eingang ein Logikeingang ist."),
    ("", "Zieht er den LED-Strom direkt, gehört ein MOSFET dazwischen."),
    ("Taster gegen GND,", "die internen Pull-ups sind aktiv. Gedrückt = LOW."),
    ("Taster nur auf GPIO 0 bis 21.", "Nur die wecken aus dem Tiefschlaf."),
    ("MISO trägt CS 3.", "GPIO 13 ist die eingebaute LED und bleibt frei,"),
    ("", "damit sie als Lebenszeichen taugt. Gelesen wird von den"),
    ("", "Displays ohnehin nicht."),
]


def schrift(groesse: int, fett: bool = False):
    for pfad in ("/System/Library/Fonts/HelveticaNeue.ttc" if fett
                 else "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if fett
                 else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(pfad, groesse)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    W, H = 1420, 1000
    f, fk, fb, ft = schrift(13), schrift(11), schrift(16, True), schrift(22, True)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    def kasten(x, y, w, h, titel, unter=None):
        d.rounded_rectangle([x, y, x + w, y + h], 10, fill=KASTEN,
                            outline=RAHMEN, width=2)
        d.text((x + 14, y + 11), titel, font=fb, fill=TXT)
        if unter:
            d.text((x + 14, y + 33), unter, font=fk, fill=GRAU)

    d.text((40, 26), "vorlaut - Verdrahtung", font=ft, fill=TXT)
    d.text((40, 56), "Sieben Leitungen gehen an alle fünf Module. "
                     "Nur CS und KEY sind pro Modul einzeln.", font=f, fill=GRAU)

    fx, fy, fw = 40, 100, 250
    kasten(fx, fy, fw, 62 + len(FEATHER) * 24 + 14, "ESP32-S3 Feather",
           "Akku lädt über USB-C")
    y = fy + 60
    for name, gpio, farbe, wofuer in FEATHER:
        d.rectangle([fx + 14, y + 3, fx + 24, y + 13], fill=farbe)
        d.text((fx + 34, y), name, font=f, fill=TXT)
        d.text((fx + 82, y + 1), gpio, font=fk, fill=GRAU)
        d.text((fx + 152, y), wofuer, font=fk, fill=farbe)
        y += 24

    gx, gy, gw = 360, 100, 300
    gh = 62 + len(GEMEINSAM) * 26 + 14
    kasten(gx, gy, gw, gh, "an alle fünf Module", "einmal verdrahten, überall dran")
    y = gy + 62
    for links, rechts, farbe in GEMEINSAM:
        d.rectangle([gx + 14, y + 3, gx + 24, y + 13], fill=farbe)
        d.text((gx + 34, y), links, font=f, fill=TXT)
        d.text((gx + 96, y), "->", font=f, fill=GRAU)
        d.text((gx + 126, y), rechts, font=f, fill=farbe)
        y += 26
    d.line([gx + gw, gy + gh // 2, 700, gy + gh // 2], fill=GRAU, width=6)

    mx, mw, mh = 740, 300, 92
    for i in range(5):
        my = 100 + i * 104
        kasten(mx, my, mw, mh, f"ScreenKey {i + 1}",
               "Set-Taste" if i == 4 else f"Sprechtaste {i + 1}")
        d.line([700, my + 46, mx, my + 46], fill=GRAU, width=4)
        d.rectangle([mx + 14, my + 56, mx + 24, my + 66], fill=GRUEN)
        d.text((mx + 34, my + 53), f"CS  -> {CS[i]}", font=f, fill=GRUEN)
        d.rectangle([mx + 150, my + 56, mx + 160, my + 66], fill=LILA)
        d.text((mx + 170, my + 53), f"KEY -> {KEY[i]}", font=f, fill=LILA)
        d.text((mx + 34, my + 72), "Taster liegt gegen GND", font=fk, fill=GRAU)
    d.line([700, 118, 700, 100 + 4 * 104 + 46], fill=GRAU, width=6)

    ay = 660
    kasten(mx, ay, mw, 150, "MAX98357A", "Verstärker")
    for i, (links, rechts) in enumerate(VERSTAERKER):
        yy = ay + 58 + i * 19
        d.rectangle([mx + 14, yy + 2, mx + 24, yy + 12], fill=TUERKIS)
        d.text((mx + 34, yy), links, font=fk, fill=TXT)
        d.text((mx + 150, yy), "->", font=fk, fill=GRAU)
        d.text((mx + 176, yy), rechts, font=fk, fill=TUERKIS)
    kasten(mx + mw + 40, ay + 40, 220, 80, "Lautsprecher", "40 mm, 4 Ω, 5 W")
    d.line([mx + mw, ay + 80, mx + mw + 40, ay + 80], fill=TUERKIS, width=4)

    hy = 700
    d.text((fx, hy), "Worauf zu achten ist", font=fb, fill=TXT)
    for i, (fett, rest) in enumerate(HINWEISE):
        yy = hy + 30 + i * 22
        if fett:
            d.text((fx, yy), "-", font=f, fill=GRAU)
            d.text((fx + 14, yy), fett, font=f, fill=TXT)
            d.text((fx + 18 + d.textlength(fett, font=f), yy), rest, font=f, fill=GRAU)
        else:
            d.text((fx + 14, yy), rest, font=f, fill=GRAU)

    d.text((fx, H - 38), "Gerechnet, nicht gemessen. "
                         "Vor dem Löten gegen die echten Module prüfen.",
           font=fk, fill=(190, 85, 85))

    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    img.save(ZIEL)
    print(f"geschrieben: {ZIEL.relative_to(Path(__file__).resolve().parent.parent)}"
          f"  {W}x{H}")


if __name__ == "__main__":
    main()
