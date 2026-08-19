# mitreden

Kleiner, robuster Talker fuer unterwegs: fuenf Tasten, die gleichzeitig
Displays sind. Vier davon sprechen, die fuenfte schaltet zwischen den Sets um.
Gedacht als Ergaenzung zum grossen Talker (MetaTalk 3x5 auf dem iPad), nicht
als Ersatz.

Alles, was auf dem Geraet landet, kommt aus `layout.json`. Bearbeitet wird das
ueber eine kleine Weboberflaeche, gebaut wird mit `build.py`.

---

## Schnellstart

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # und den Azure-Key eintragen
.venv/bin/python app.py     # http://localhost:8771
```

Ausserdem wird `ffmpeg` gebraucht (`brew install ffmpeg`).

Ohne Azure-Key laesst sich schon alles ausser dem Ton benutzen: Symbole
suchen, Layout bearbeiten, Bilder bauen.

---

## Weboberflaeche

`app.py` startet auf <http://localhost:8771> und sieht aus wie das Geraet:
oben die Reiter fuer die Sets, darunter die Set-Kachel und die vier
Sprechtasten im 2x2-Raster. Der Rahmen jeder Kachel hat die Farbe des Sets.

- **Auf ein Symbol klicken** oeffnet die ARASAAC-Suche. Ein Klick auf ein
  Ergebnis laedt das PNG nach `symbols/` und traegt es in `layout.json` ein.
  Im selben Dialog liegt **Eigenes Bild** - damit laesst sich ein Foto oder
  eine eigene Zeichnung hochladen. Alles, was Pillow lesen kann (PNG, JPG,
  HEIC-Export, GIF ...), wird nach PNG gewandelt und in `symbols/` abgelegt.
  Bestehende Dateien werden nie ueberschrieben, gleiche Namen bekommen `-2`
  angehaengt. Hoechstens 10 MB pro Bild.

  Nicht-quadratische Bilder werden **mittig auf quadratisch beschnitten**, damit
  sie die Kachel randlos fuellen - sonst bliebe an zwei Seiten ein weisser
  Balken. Bei einem Hochformat faellt dabei oben und unten je ein Stueck weg.
  Wenn es auf den Bildausschnitt ankommt, das Foto vorher in der Fotos-App
  quadratisch zuschneiden; dann bleibt es unangetastet.

  Grosse Bilder werden beim Annehmen auf **500 Pixel lange Kante** verkleinert
  (`SYMBOL_MAX_PX` in `app.py`) - dasselbe Mass, in dem ARASAAC seine
  Piktogramme liefert. Ein Handyfoto mit 3024x4032 wiegt danach ein paar
  Kilobyte statt mehrerer Megabyte. Das ist Absicht: `symbols/` liegt im Repo,
  und das Geraet rendert ohnehin nur 116x116 Pixel.
- **Textfeld**: was Gisela sagt. Das darf vom Symbolwort abweichen - das
  Symbol zeigt "anhalten", gesagt wird "Stopp".
- **▶** hoert den Satz vorher ab (geht ueber Azure, braucht also den Key).
- **Bauen** oben rechts ruft `build.py` und zeigt das Protokoll an.

**Umsortieren per Ziehen:** jede Sprechtaste hat oben rechts einen Griff (⠿).
Zieht man ihn auf eine andere Taste, **tauschen** die beiden die Plaetze - im
festen 2x2-Raster ist das eindeutiger als Einsortieren. Die Reiter oben lassen
sich ebenfalls ziehen; deren Reihenfolge bestimmt, wie die Set-Taste am Geraet
durchschaltet.

Umsortieren kostet nichts: die Sprachdateien haengen im Cache am Text, nicht an
der Position. Es wird also nichts neu gesprochen.

Aenderungen werden automatisch in `layout.json` gespeichert.

---

## layout.json

Die einzige Quelle der Wahrheit. Hoechstens 5 Sets, genau 4 Slots pro Set.

```json
{
  "sleep_timeout_seconds": 600,
  "sets": [
    {
      "name": "Grundset",
      "symbol": "start.png",
      "color": "#4A90D9",
      "slots": [
        { "text": "Ja",       "symbol": "ja.png" },
        { "text": "Nein",     "symbol": "nein.png" },
        { "text": "Stopp",    "symbol": "stopp.png" },
        { "text": "Hilf mir", "symbol": "hilfe.png" }
      ]
    }
  ]
}
```

`color` ist die Farbe, die als Rahmen um alle fuenf Bilder gerendert wird -
damit sie am Farbeindruck erkennt, in welchem Set sie gerade ist. Neue Sets
bekommen der Reihe nach eine Farbe aus `DEFAULT_PALETTE` in `build.py`; die
Weboberflaeche holt sich dieselbe Liste von dort.

Ein leerer `text` bedeutet: diese Taste bleibt stumm. Ein leeres `symbol`
ergibt eine Platzhalter-Kachel mit grauem Kreuz.

---

## Bauen

```bash
.venv/bin/python build.py
```

Schreibt nach `firmware/mitreden/data/` (gitignored, wird auf das Geraet
hochgeladen):

| Datei                  | Inhalt                                              |
|------------------------|-----------------------------------------------------|
| `set<S>_slot<N>.wav`   | gesprochener Satz, 16 kHz mono 16 bit               |
| `set<S>_slot<N>.bin`   | 128x128 RGB565 big-endian, mit Rahmen in Set-Farbe  |
| `set<S>_label.bin`     | dasselbe fuer das Set-Symbol                        |

und dazu `firmware/mitreden/layout.h` mit Anzahl der Sets, Dateinamen, Farben und
`sleep_timeout_seconds` als Konstanten fuer die Firmware.

`S` und `N` sind 1-basiert. Dateien aus frueheren Laeufen, die nicht mehr
gebraucht werden, raeumt `build.py` selbst weg.

Nuetzliche Schalter:

```bash
.venv/bin/python build.py --no-audio      # nur Bilder und layout.h
.venv/bin/python build.py --force-audio   # alle WAVs neu rendern
```

---

## Was im Repo liegt und was nicht

Faustregel: was Geld oder einen Schluessel kostet, kommt mit. Was sich gratis
in Sekunden neu erzeugen laesst, bleibt draussen.

| | im Repo | warum |
|---|---|---|
| `layout.json`, `symbols/` | ja | deine Arbeit |
| `cache/tts/` | **ja** | gesprochene Saetze kosten Azure-Guthaben und den Key |
| `firmware/mitreden/layout.h` | ja | winzig, und Aenderungen sind im Diff lesbar |
| `firmware/mitreden/data/` | nein | 800 KB Bilder, gratis aus `symbols/` neu gebaut |
| `cache/thumbs/`, `cache/layout-backups/` | nein | rein oertlich |
| `.env` | nein | der Schluessel |

Dadurch ist ein frischer Klon **ohne Azure-Zugang vollstaendig baubar**, solange
sich die Texte nicht geaendert haben: `build.py` nimmt die Saetze aus
`cache/tts/`, statt sie neu sprechen zu lassen. Erst ein *neuer* Text braucht
wieder den Key - und sagt das dann auch deutlich.

Die Dateinamen im Cache sind Pruefsummen und damit unlesbar. Deshalb fuehrt
`tts.py` daneben `cache/tts/index.json`, das jede Pruefsumme ihrem Text
zuordnet. Damit ist auch nach Monaten nachvollziehbar, was da eigentlich liegt.

Aufraeumen, wenn der Cache zu viel Altes angesammelt hat:

```bash
.venv/bin/python build.py --prune-cache
```

Das loescht alle Sprachdateien, die in `layout.json` nicht mehr vorkommen.
Vorsicht: darunter ist auch alles, was du frueher einmal eingetragen und
spaeter wieder entfernt hast.

---

## Sprachausgabe

`tts.py` spricht ueber die Azure Speech REST API mit **de-DE-GiselaNeural**,
Region **germanywestcentral**, Sprechtempo **-5 %**.

Danach durch ffmpeg: Stille am Anfang und Ende weg, dann
`loudnorm I=-16:TP=-1.5:LRA=11`, Ausgabe als 16 kHz mono 16 bit WAV. Dadurch
sind alle Tasten gleich laut - wichtig, weil es am Geraet keinen
Lautstaerkeregler gibt.

Der Key kommt aus der Umgebungsvariablen `AZURE_SPEECH_KEY`, ersatzweise aus
`.env`. Eine gesetzte Umgebungsvariable gewinnt.

Gerendert wird nur, was sich geaendert hat: ueber Text und Stimm-Konfiguration
wird ein Fingerprint gebildet, fertige Dateien liegen unter `cache/tts/`.
Wer die Stimme oder die ffmpeg-Kette aendert, aendert damit auch den
Fingerprint - dann wird automatisch alles neu gerendert.

Einzeln testen geht auch:

```bash
.venv/bin/python tts.py "Ich moechte nach draussen" probe.wav
```

---

## Firmware

`firmware/mitreden/mitreden.ino`, Arduino-Framework.

Der Sketch liegt in einem eigenen Unterordner, weil Arduino verlangt, dass der
Ordner so heisst wie die `.ino`-Datei - und weil der LittleFS-Uploader `data/`
direkt daneben sucht. Beides zeigt auf dieselbe Struktur.

### Was gebraucht wird

- **Arduino ESP32 Core 3.x** (Board: *Adafruit Feather ESP32-S3 No PSRAM*)
- Bibliotheken: `Adafruit GFX Library`, `Adafruit ST7735 and ST7789 Library`
- Ein LittleFS-Upload-Werkzeug, um `firmware/mitreden/data/` auf den Flash zu
  bringen
  (z.B. *arduino-esp32 littlefs plugin* oder `mklittlefs` + `esptool`)

Board-Einstellungen: USB CDC On Boot **an**, Partition Scheme so waehlen, dass
genug SPIFFS/LittleFS-Platz bleibt. Bei 5 vollen Sets sind es rund
25 × 32 KiB Bilder plus die WAVs, also grob 1-2 MB.

Uebersetzen:

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram firmware/mitreden
```

Getestet mit ESP32-Core 3.3.11, Adafruit GFX 1.12.0, ST7735 1.11.0:
469 KB Programm (22 %), 57 KB RAM (17 %) - reichlich Luft.

> Der Sketch **compiliert**, ist aber noch nie auf echter Hardware gelaufen.
> Vor dem ersten Flashen die Pinbelegung gegen die echten Boards pruefen.

### Pinbelegung (Vorschlag)

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
nur ueber GPIO 0 bis 21. GPIO 14 bis 18 liegen in diesem Bereich und sind auf
dem Feather als A0-A4 sauber herausgefuehrt.

**Verkabelung:**

- Taster gegen **GND**, die internen Pull-ups sind aktiv. Gedrueckt = LOW.
- MISO wird nicht gebraucht, die Displays werden nur beschrieben.
- `SD` am MAX98357A haengt an GPIO 4: der Verstaerker ist stumm, ausser waehrend
  ein Wort laeuft. Das spart Strom und das leise Rauschen im Ruhezustand.
- Das Backlight aller fuenf Displays an einem GPIO funktioniert nur, wenn der
  BL-Eingang der Screenkeys ein Logikeingang ist. Zieht er den LED-Strom
  direkt, gehoert ein kleiner MOSFET dazwischen - fuenf Backlights sind mehr,
  als ein GPIO treiben darf.
- Beim Verloeten die tatsaechliche Screenkey-Belegung pruefen; die Tabelle oben
  beschreibt die Seite des Feathers.

Falls das Bild um ein paar Pixel verschoben ist oder ein Rand stehen bleibt:
`PANEL_COL_OFFSET` und `PANEL_ROW_OFFSET` oben im Sketch anpassen.

### Verhalten

- **Wach:** alle fuenf Displays sind durchgehend an. Sie muss sehen koennen,
  was zur Auswahl steht.
- **Taste 1-4:** das zugehoerige WAV wird abgespielt.
- **Taste 5:** naechstes Set (1→2→3→4→5→1), alle Displays werden neu gezeichnet.
  Das aktuelle Set ueberlebt den Schlaf.
- **Nach `sleep_timeout_seconds` ohne Eingabe:** Displays aus, Deep Sleep.

### Aufwachen

Jede der fuenf Tasten weckt das Geraet (EXT1 auf allen Taster-Pins).

**Der Druck, der aufweckt, loest nichts aus** - kein Wort, kein Umschalten.
Er holt nur die Displays zurueck. Danach wartet die Firmware, bis die Taste
losgelassen wurde, bevor wieder auf Eingaben reagiert wird. Sonst spraeche das
Geraet ein Wort, das sie gar nicht sagen wollte: bei dunklen Displays drueckt
sie ja blind.

Entprellt wird ueber eine Mindest-Druckdauer von 80 ms, damit Streifschuesse
nichts ausloesen.

---

## Symbole

Die Piktogramme stammen von **[ARASAAC](https://arasaac.org)**.

> Urheber der Piktogramme: **Sergio Palao**. Herkunft:
> [ARASAAC](https://arasaac.org), Regierung von Aragonien (Spanien).
> Lizenz: **CC BY-NC-SA**.

Die Suche in der Weboberflaeche nutzt die offene ARASAAC-API ohne
Anmeldung. Heruntergeladene Symbole liegen in `symbols/` und liegen im Repo
mit; welches Symbol woher kommt, steht in `symbols/QUELLEN.md`.

---

## Struktur

```
mitreden/
├── layout.json          Quelle der Wahrheit
├── symbols/             heruntergeladene PNGs
├── tts.py               Azure TTS
├── app.py               Weboberflaeche, localhost:8771
├── build.py             erzeugt data/ und layout.h im Sketchordner
├── firmware/
│   └── mitreden/        Arduino-Sketchordner
│       ├── mitreden.ino
│       ├── layout.h     generiert
│       └── data/        generiert, gitignored
├── .env                 AZURE_SPEECH_KEY, gitignored
└── cache/
    ├── tts/             gesprochene Saetze, im Repo
    ├── thumbs/          Suchvorschauen, gitignored
    └── layout-backups/  letzte 60 Staende von layout.json, gitignored
```
