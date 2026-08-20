# Firmware übersetzen und aufs Gerät bringen

## Firmware

`firmware/mitreden/mitreden.ino`, Arduino-Framework.

Der Sketch liegt in einem eigenen Unterordner, weil Arduino verlangt, dass der
Ordner so heißt wie die `.ino`-Datei - und weil der LittleFS-Uploader `data/`
direkt daneben sucht. Beides zeigt auf dieselbe Struktur.

### Was gebraucht wird

- **Arduino ESP32 Core 3.x** (Board: *Adafruit Feather ESP32-S3 No PSRAM*)
- Bibliotheken: `Adafruit GFX Library`, `Adafruit ST7735 and ST7789 Library`
- `mklittlefs` und `esptool` für den Dateibereich - beide kommen mit dem
  ESP32-Core, `build.py --fs-image` findet sie von selbst

Board-Einstellung: USB CDC On Boot **an**.

### Aufs Gerät bringen

Es sind zwei getrennte Dinge, die in getrennte Flash-Bereiche gehen: das
**Programm** (der Sketch) und die **Daten** (Bilder und Töne). Aendert sich nur
ein Wort oder ein Symbol, muss das Programm nicht neu drauf - dann reichen die
Schritte 3 und 4.

**1. Port finden.** Feather per USB-C anstecken, dann:

```bash
arduino-cli board list
```

Gesucht ist etwas wie `/dev/cu.usbmodem1101`. Diesen Port unten überall
statt `/dev/cu.usbmodemXXXX` einsetzen.

**2a. Ohne Arduino: fertiges Image nehmen.**

Bei jedem Push baut CI die Firmware und hängt sie als Artifact an den Workflow-Lauf.
Unter *Actions* den neuesten grünen Lauf öffnen und `firmware` herunterladen.
Darin liegt `mitreden.ino.merged.bin` - Bootloader, Partition Table und
Programm in einer Datei, geschrieben an Adresse 0:

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX write-flash 0x0 mitreden.ino.merged.bin
```

Damit braucht es weder Arduino-Core noch Bibliotheken - nur esptool. Das
Partition Scheme steckt schon im Image, es lässt sich also auch nicht falsch
einstellen.

**2b. Selbst übersetzen und schreiben:**

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/mitreden
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/mitreden
```

Meldet der Upload, dass er das Board nicht findet: **BOOT** gedrückt halten,
kurz **RESET** tippen, **BOOT** loslassen. Dann hängt der Feather im
Bootloader und der Befehl geht durch. Danach einmal RESET drücken.

**3. Daten packen:**

```bash
.venv/bin/python build.py --fs-image
```

**4. Daten schreiben** - den Befehl gibt Schritt 3 mit vollem Pfad aus:

```bash
~/Library/Arduino15/packages/esp32/tools/esptool_py/*/esptool \
  --chip esp32s3 --port /dev/cu.usbmodemXXXX \
  write-flash 0x670000 firmware/mitreden/littlefs.bin
```

Die Adresse `0x670000` ist der Anfang der `spiffs`-Partition aus
`default_8MB.csv`. Sie gilt nur für dieses Partition Scheme - mit einem
anderen landen die Daten an der falschen Stelle.

**Mitlesen, was das Gerät sagt:**

```bash
arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=115200
```

Dort steht beim Start, welches Set geladen wurde, welche Taste gedrückt wurde
und ob LittleFS sich einhängen ließ.

### Wie das Image entsteht

`build.py --fs-image` packt `firmware/mitreden/data/` mit `mklittlefs` in ein
Image von 1536 KiB - genau die Größe der `spiffs`-Partition. Passen die
Daten nicht hinein, bricht es mit einer klaren Meldung ab, statt ein zu großes
Image zu erzeugen.

Das Image selbst ist gitignored: es entsteht in Sekunden neu aus `data/`.

Übersetzen:

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/mitreden
```

> **Das Partition Scheme ist nicht optional.** Die Voreinstellung des Boards
> heißt *tinyuf2* und legt den Datenbereich als `ffat` an - `LittleFS.begin()`
> sucht aber eine Partition namens `spiffs` und scheitert daran. Das Gerät
> bootet dann mit schwarzen Displays. In der Arduino-IDE unter
> *Werkzeuge > Partition Scheme* auf **"Default (3MB APP/1.5MB SPIFFS)"**
> stellen, auf der Kommandozeile `PartitionScheme=default_8MB` anhängen.

Getestet mit ESP32-Core 3.3.11, Adafruit GFX 1.12.0, ST7735 1.11.0:
470 KB Programm (14 % von 3 MB), 57 KB RAM (17 %).

Der Dateibereich fasst 1536 KiB. Ein volles Layout mit fünf Sets belegt
davon rund 630 KiB, also gut 40 %.

> Der Sketch **compiliert**, ist aber noch nie auf echter Hardware gelaufen.
> Vor dem ersten Flashen die Pinbelegung gegen die echten Boards prüfen.

### Verhalten

- **Wach:** alle fünf Displays sind durchgehend an. Sie muss sehen können,
  was zur Auswahl steht.
- **Taste 1-4:** das zugehörige WAV wird abgespielt.
- **Taste 5:** nächstes Set (1→2→3→4→5→1), alle Displays werden neu gezeichnet.
  Das aktuelle Set überlebt den Schlaf.
- **Nach `sleep_timeout_seconds` ohne Eingabe:** Displays aus, Deep Sleep.

### Menü

**Set-Taste und Taste 2 fünf Sekunden gleichzeitig halten.** Die beiden liegen
diagonal am weitesten auseinander - mit einer Kinderhand kaum gleichzeitig zu
treffen. Während des Haltens zählen alle Displays herunter; wer loslässt,
bricht ab, ohne dass etwas passiert.

Im Menü beschriften sich die Tasten selbst. Derzeit:

| Taste | |
|---|---|
| 1 | **Info** - Anzahl der Sets, ist das Dateisystem da |
| Set | **zurück** in den Normalbetrieb |

Die übrigen bleiben leer. Einträge kommen dazu, wenn es die Funktion dahinter
gibt - WLAN einrichten und Inhalte holen, sobald der Abgleich steht.

Das Menü zeichnet sich ohne Dateien, aus Text und Rechtecken. Es funktioniert
also auch auf einem frisch geflashten Gerät, auf dem noch nichts liegt - und
genau dort braucht man es zuerst. Der Rahmen ist grau statt in der Set-Farbe,
damit man auf einen Blick sieht, dass das nicht der Talker ist.

**Nach 30 Sekunden ohne Eingabe geht es von selbst zurück.** Ein Gerät, das im
Menü hängenbleibt, spricht nicht mehr - das darf nicht passieren.

### Aufwachen

Jede der fünf Tasten weckt das Gerät (EXT1 auf allen Taster-Pins).

**Der Druck, der aufweckt, löst nichts aus** - kein Wort, kein Umschalten.
Er holt nur die Displays zurück. Danach wartet die Firmware, bis die Taste
losgelassen wurde, bevor wieder auf Eingaben reagiert wird. Sonst spräche das
Gerät ein Wort, das sie gar nicht sagen wollte: bei dunklen Displays drückt
sie ja blind.

Entprellt wird über eine Mindest-Druckdauer: **80 ms** für die Sprechtasten,
**400 ms** für die Set-Taste (`DEBOUNCE_MS` und `SET_HOLD_MS` im Sketch). Die
Set-Taste braucht länger, weil ein versehentlicher Wechsel ihr das Wort
wegnimmt, das sie gerade sagen wollte - sie muss dann erst wiederfinden, wo sie
ist. Das ist ärgerlicher als ein falsch getroffenes Wort.
