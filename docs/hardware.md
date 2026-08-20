# Hardware: Bauteile, Verdrahtung, Gehäuse

## Bauteile

| Teil | Anzahl | Anmerkung |
|------|-------:|-----------|
| Adafruit ESP32-S3 Feather (8 MB Flash, ohne PSRAM) | 1 | WLAN und USB-C an Bord |
| Waveshare 0.85" ScreenKey (128×128, ST7735) | 5 | Display und Taster in einem |
| Adafruit MAX98357A I2S-Verstärker | 1 | |
| Lautsprecher 40 mm, 4 Ω | 1 | |
| LiPo-Akku 2500 mAh | 1 | Laden über USB-C am Feather |

Bewusst nicht vorgesehen: Lautstärkeregler und Ein-/Aus-Schalter. Das Gerät
schläft von selbst ein und wacht auf Tastendruck wieder auf; die Lautstärke
regelt die Normalisierung beim Bauen.

Gehäuse und Verdrahtung: siehe [Gehäuse](#gehäuse) und
[Pinbelegung](#pinbelegung-vorschlag).


## Pinbelegung (Vorschlag)

| Funktion                | GPIO | Beschriftung auf dem Feather |
|-------------------------|-----:|------------------------------|
| SPI SCK (alle Displays) |   36 | SCK                          |
| SPI MOSI (alle)         |   35 | MO                           |
| Display DC (alle)       |    9 | D9                           |
| Display RST (alle)      |   10 | D10                          |
| Backlight (alle)        |    3 | SDA                          |
| CS Display 1            |   11 | D11                          |
| CS Display 2            |   12 | D12                          |
| CS Display 3            |   13 | D13                          |
| CS Display 4            |    5 | D5                           |
| CS Display 5 (Set)      |    6 | D6                           |
| Taster 1                |   18 | A0                           |
| Taster 2                |   17 | A1                           |
| Taster 3                |   16 | A2                           |
| Taster 4                |   15 | A3                           |
| Taster 5 (Set)          |   14 | A4                           |
| I2S BCLK                |    8 | A5                           |
| I2S LRCLK (WS)          |   38 | RX                           |
| I2S DIN                 |   39 | TX                           |
| MAX98357A SD            |    4 | SCL                          |

Warum genau diese Taster-Pins: aufwecken aus dem Deep Sleep geht beim ESP32-S3
nur über GPIO 0 bis 21. GPIO 14 bis 18 liegen in diesem Bereich und sind auf
dem Feather als A0-A4 sauber herausgeführt.

**Verkabelung:**

- Taster gegen **GND**, die internen Pull-ups sind aktiv. Gedrückt = LOW.
- MISO wird nicht gebraucht, die Displays werden nur beschrieben.
- `SD` am MAX98357A hängt an GPIO 4: der Verstärker ist stumm, außer während
  ein Wort läuft. Das spart Strom und das leise Rauschen im Ruhezustand.
- Das Backlight aller fünf Displays an einem GPIO funktioniert nur, wenn der
  BL-Eingang der Screenkeys ein Logikeingang ist. Zieht er den LED-Strom
  direkt, gehört ein kleiner MOSFET dazwischen - fünf Backlights sind mehr,
  als ein GPIO treiben darf.
- Beim Verlöten die tatsächliche Screenkey-Belegung prüfen; die Tabelle oben
  beschreibt die Seite des Feathers.

Falls das Bild um ein paar Pixel verschoben ist oder ein Rand stehen bleibt:
`PANEL_COL_OFFSET` und `PANEL_ROW_OFFSET` oben im Sketch anpassen.

## Gehäuse

Gemessene Teile: Screenkey-Platine 25,94 x 35,29 mm, Tastenkappe 22,00 x
25,30 mm mit 8,6 mm Überstand, sichtbares Bild nur **15,21 x 15,21 mm**.
Lautsprecher 40,3 x 40,3 x 25,3 mm.

| | Maß |
|---|---|
| Raster der vier Sprechtasten | 37,0 x 45,3 mm |
| Spalt zwischen den Kappen | 15 mm seitlich, 20 mm zwischen den Reihen |
| Abstand Set-Taste zum Viererblock | 25 mm |
| Spalt Lautsprecher zur Set-Taste | 5 mm |
| Bauteile insgesamt | 117 x 81 mm |
| Gehäuse außen | etwa 131 x 95 x 35 mm |

Anordnung: Lautsprecher oben links, darunter die Set-Taste, rechts daneben die
vier Sprechtasten als 2x2-Block. Set-Taste und untere Tastenreihe schließen
unten bündig ab - das geht genau auf, weil Lautsprecher + 5 mm + Set-Platine
zusammen 80,6 mm ergeben und der Block bei diesem Raster ebenfalls 80,6 mm hoch
ist.

**Wichtig:** Die Platinen dürfen sich nicht berühren. Dann blieben seitlich
nur 25,94 - 22,00 = 3,9 mm zwischen den Kappen, und eine Kinderhand träfe zwei
Tasten auf einmal.

Die Tiefe bestimmt der Lautsprecher mit 25,3 mm; die Screenkeys brauchen hinter
der Frontplatte nur 15,4 mm. Hinter dem Tastenblock bleiben damit rund 10 mm
für den flach liegenden Akku, der Feather passt daneben.

Noch zu prüfen, wenn die Teile da sind: ob die Tastenkappe mittig auf der
Platine sitzt. Auf den Bildern liegen FPC- und Stiftleistenanschluss im unteren
Bereich - falls die Kappe nach oben versetzt ist, verschieben sich alle
Senkrechtmaße und damit die Frontausschnitte.

---
