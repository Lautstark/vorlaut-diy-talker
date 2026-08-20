# Inbetriebnahme in Stufen

Wenn man alles zusammenlötet, flasht und nichts geht, hat man acht Fehlerquellen
gleichzeitig: Panel-Profil, Versatz, CS-Zuordnung, Taster-Pins, I2S, Verstärker,
Hintergrundlicht, Partition Scheme.

Gestaffelt wird daraus jeweils eine. Jede Stufe ist ein kleiner Sketch unter
`firmware/tests/`, der genau eine Sache prüft und im seriellen Monitor sagt,
worauf zu achten ist.

Alle benutzen dieselbe `pins.h` wie die richtige Firmware — sonst prüft man am
Ende etwas anderes, als man später betreibt.

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/tests/test1_board
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/tests/test1_board
arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=115200
```

---

## Stufe 1 — Lebt das Board?

`test1_board` — nur der Feather, nichts angeschlossen.

Die rote LED blinkt im Sekundentakt, im Monitor läuft alle zwei Sekunden eine
Zeile durch. Läuft das nicht, muss man an der Verkabelung gar nicht erst suchen.

Bleibt der Monitor stumm: *Werkzeuge > USB CDC On Boot* auf **Enabled**.

## Stufe 2 — Ein Display

`test2_display` — nur Display 1 anschließen, CS an D11.

Hier klären sich die **zwei Unbekannten, die sich nicht ausrechnen lassen**:

- **Panel-Profil.** Es zeigt nacheinander Rot, Grün, Blau. Erscheint Rot als
  Blau, sind die Farbkanäle vertauscht — dann eine andere `initR`-Variante
  probieren.
- **Versatz.** Danach ein weißer Rahmen genau am äußersten Bildrand, mit einem
  farbigen Quadrat in jeder Ecke und einem Fadenkreuz. Ist der Rahmen ringsum
  gleich breit und sind alle vier Ecken vollständig, stimmen
  `PANEL_COL_OFFSET` und `PANEL_ROW_OFFSET` in `pins.h`. Fehlt oben oder links
  etwas und bleibt unten oder rechts ein Streifen, dort nachstellen.

Bleibt es schwarz: CLK, DIN, DC, RST und die Versorgung prüfen.

## Stufe 3 — Alle fünf

`test3_displays` — erst wenn Stufe 2 sauber lief.

Jedes Display zeigt dauerhaft seine Nummer auf eigener Farbe: **1 rot, 2 grün,
3 blau, 4 gelb, S violett**. Die Anordnung muss zur Zeichnung in
[hardware.md](hardware.md) passen — 1 und 2 oben, 3 und 4 unten, S links unter
dem Lautsprecher.

Stimmt sie nicht, sind die CS-Leitungen vertauscht. Umlöten oder die Reihenfolge
in `pins.h` ändern; beides ist richtig, es muss nur zusammenpassen.

- Ein Display schwarz → dessen CS-Leitung.
- Alle schwarz, obwohl Stufe 2 lief → meist RST oder die Versorgung.

## Stufe 4 — Taster

`test4_tasten` — jedes Display zeigt seinen eigenen Taster: dunkel = offen,
grün = gedrückt.

- Leuchtet beim Drücken das Display **derselben** Taste auf? Wenn ein anderes
  reagiert, sind KEY- und CS-Leitungen unterschiedlich sortiert.
- Reagiert eine gar nicht → KEY-Leitung und GND.
- Reagieren alle gleichzeitig → vermutlich fehlt GND.
- Zeigt eine dauerhaft „gedrückt", ohne dass jemand sie berührt, liegt der
  Eingang fest auf GND.

## Stufe 5 — Ton

`test5_ton` — 440 Hz für zwei Sekunden, dann ein Durchlauf von 200 bis 2000 Hz.

- Kommt überhaupt etwas? Sonst BCLK, LRC, DIN, Versorgung und besonders **SD**
  prüfen — liegt der auf LOW, bleibt es still.
- Verzerrt es? Dann ist der Pegel zu hoch oder die Versorgung zu schwach.
- Knackt es beim Ein- und Ausschalten des Verstärkers? Dann in der Firmware die
  Ruhe vor dem Abschalten verlängern (`TAIL_PAD` in `tts.py`, und die Stille in
  `playWav`).
- **Wo wird der Durchlauf dünn?** Das ist die untere Grenze des Lautsprechers.
  Wichtig, weil das Gerät keinen Lautstärkeregler hat: was ankommt, ist was
  ankommt.

## Stufe 6 — Die richtige Firmware

Erst jetzt. Vorgehen in [firmware.md](firmware.md).

Beim allerersten Start ist das Dateisystem leer — das Gerät zeigt dann auf allen
fünf Displays **„keine Inhalte"**. Das ist richtig so und kein Fehler. Über das
Menü (Set-Taste und Taste 2 fünf Sekunden halten) zeigt **Info**, ob LittleFS
eingehängt ist.

---

## Was dabei zu notieren ist

Diese Werte sind gerechnet, nicht gemessen. Was sich in Stufe 2 bis 5 als anders
herausstellt, gehört zurück ins Repo:

| | wo |
|---|---|
| Panel-Profil und Versatz | `firmware/vorlaut/pins.h` |
| Reihenfolge der CS- und KEY-Leitungen | `firmware/vorlaut/pins.h` |
| Tatsächliche Bauteilmaße | `docs/hardware.md`, `tools/verdrahtung.py` |
