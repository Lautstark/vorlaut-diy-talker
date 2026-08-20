# mitreden

Kleiner, robuster Talker für unterwegs: fünf Tasten, die gleichzeitig
Displays sind. Vier davon sprechen, die fünfte schaltet zwischen den Sets um.
Gedacht als Ergänzung zum großen Talker (MetaTalk 3x5 auf dem iPad), nicht
als Ersatz.

Alles, was auf dem Gerät landet, kommt aus `content/layout.json`. Bearbeitet wird das
über eine kleine Weboberfläche, gebaut wird mit `build.py`.

---

## Schnellstart

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # und den Azure-Key eintragen
.venv/bin/python app.py     # http://localhost:8771
```

Außerdem wird `ffmpeg` gebraucht (`brew install ffmpeg`).

### Vom Handy aus bearbeiten

Voreingestellt hört der Server nur auf diesem Rechner. Für den Zugriff aus
dem eigenen WLAN:

```bash
.venv/bin/python app.py --host 0.0.0.0
```

Beim Start nennt er die Adresse, die ins Handy gehört, etwa
`http://192.168.0.25:8771`. Die Oberfläche bricht auf schmalen Bildschirmen
um: Set-Kachel oben über die volle Breite, die vier Sprechtasten als 2x2
darunter.

**Das ist ohne Anmeldung.** Wer im selben WLAN ist, kann die Inhalte ändern
und über die Vorhör-Taste Azure-Guthaben verbrauchen. Für zuhause in
Ordnung, in einem fremden oder öffentlichen Netz nicht.

### Auf einem NAS betreiben

Sinnvoller als ein Mac, der nur manchmal an ist. Es liegt ein `Dockerfile` und
eine `docker-compose.yml` bei:

```bash
docker compose up -d
```

Das Abbild bringt nur Python, ffmpeg und Pillow mit. Das Projektverzeichnis
selbst wird hineingereicht - `content/layout.json`, `content/symbols/` und `content/cache/` bleiben
damit auf dem NAS und laufen in dessen Sicherung mit.

Geprüft: Azure-Sprachausgabe, ffmpeg (7.1.5 im Abbild), ARASAAC-Suche und
`build.py` laufen im Container durch.

#### Vorher lokal ausprobieren

Sinnvoll, bevor du dich mit DSM herumschlägst - dieselbe Datei, derselbe
Container:

```bash
docker compose up -d --build
docker compose logs -f          # was der Container sagt
docker compose down             # wieder weg
```

Läuft schon ein `app.py` auf 8771, kann der Container einen anderen Port am
Rechner bekommen:

```bash
MITREDEN_PORT=8798 docker compose up -d --build
```

Achtung: Container und `app.py` arbeiten auf **denselben Dateien**. Beide
gleichzeitig laufen zu lassen ist möglich, aber es sollte immer nur einer
davon bedient werden.

Geprüft mit `docker compose` 2.x und dem älteren `docker-compose` 1.29 -
beide nehmen die Datei an.

> Stolperstein: `docker compose` liest die `.env` im Projektordner für
> Variablen mit. Steht darin etwas anderes als `SCHLUESSEL=WERT`, bricht es
> mit *"Can't separate key from value"* ab. Die `.env` gehört also nur dem
> Azure-Schlüssel.

#### Auf einer Synology

1. Gemeinsamen Ordner anlegen, üblich ist `docker`, darin `mitreden` -
   der Pfad ist dann `/volume1/docker/mitreden`.
2. Das Projekt dorthin kopieren, am einfachsten über die Netzfreigabe im
   Finder. **Die `.env` gehört nicht ins Repo und muss von Hand mit.**
3. **Container Manager** öffnen (DSM 7.2 und neuer; davor heißt das Paket
   *Docker*) -> *Projekt* -> *Anlegen* -> als Pfad den Ordner wählen. Die
   `docker-compose.yml` wird erkannt, das Abbild baut er selbst.
4. Aufrufen unter `http://<NAS>:8771`.

Damit liegt der ganze Bestand auf dem NAS und läuft in dessen Sicherung mit.
Am Mac hängst du dieselbe Freigabe ein und arbeitest dort mit git weiter -
es ist ein einziger Ordner, keine zweite Kopie.

Was dabei erfahrungsgemäß zuerst klemmt:

- **Dateirechte.** Der Container läuft als root, alles was er anlegt gehört
  danach root, und über die Netzfreigabe kommst du nicht mehr dran. In der
  `docker-compose.yml` steht eine auskommentierte `user:`-Zeile dafür; die
  eigene Kennung liefert `id` über SSH.
- **Aelteres DSM.** Das alte *Docker*-Paket bringt Compose 1 mit und will eine
  Zeile `version: "3.8"` ganz oben in der `docker-compose.yml`. Container
  Manager braucht sie nicht.
- **ARM-Modelle** bauen das Abbild spürbar langsamer als die Intel-Modelle.
  Einmalig, danach läuft es.

Zu bedenken:

- **Keine Anmeldung.** Wer den Port erreicht, kann die Inhalte ändern. Im
  Heimnetz in Ordnung, aber **nicht im Router freigeben**. Für unterwegs
  lieber ein privates Netz wie Tailscale, dann braucht es keine Anmeldung.
- Der Azure-Schlüssel steckt bewusst **nicht** im Abbild - `.dockerignore`
  schließt `.env` aus. Zur Laufzeit kommt er aus dem eingehängten Ordner.
- Geflasht wird weiter vom Mac aus - dafür braucht es USB.

Ins offene Internet gehört die Oberfläche nicht: sie braucht einen
laufenden Python-Prozess, schreibt Dateien und hat den Azure-Schlüssel. Auf
GitHub Pages läuft sie deshalb nicht - das ist reines Ausliefern fertiger
Dateien, ohne Server dahinter.

Ohne Azure-Key lässt sich schon alles außer dem Ton benutzen: Symbole
suchen, Layout bearbeiten, Bilder bauen.

---

## Weboberfläche

`app.py` startet auf <http://localhost:8771> und sieht aus wie das Gerät:
oben die Reiter für die Sets, darunter die Set-Kachel und die vier
Sprechtasten im 2x2-Raster. Der Rahmen jeder Kachel hat die Farbe des Sets.

- **Auf ein Symbol klicken** öffnet die ARASAAC-Suche. Ein Klick auf ein
  Ergebnis lädt das PNG nach `content/symbols/` und trägt es in `content/layout.json` ein.
  Im selben Dialog liegt **Eigenes Bild** - damit lässt sich ein Foto oder
  eine eigene Zeichnung hochladen. Alles, was Pillow lesen kann (PNG, JPG,
  HEIC-Export, GIF ...), wird nach PNG gewandelt und in `content/symbols/` abgelegt.
  Bestehende Dateien werden nie überschrieben, gleiche Namen bekommen `-2`
  angehängt. Höchstens 10 MB pro Bild.

  Nicht-quadratische Bilder werden **mittig auf quadratisch beschnitten**, damit
  sie die Kachel randlos füllen - sonst bliebe an zwei Seiten ein weißer
  Balken. Bei einem Hochformat fällt dabei oben und unten je ein Stück weg.
  Wenn es auf den Bildausschnitt ankommt, das Foto vorher in der Fotos-App
  quadratisch zuschneiden; dann bleibt es unangetastet.

  Große Bilder werden beim Annehmen auf **500 Pixel lange Kante** verkleinert
  (`SYMBOL_MAX_PX` in `app.py`) - dasselbe Maß, in dem ARASAAC seine
  Piktogramme liefert. Ein Handyfoto mit 3024x4032 wiegt danach ein paar
  Kilobyte statt mehrerer Megabyte. Das ist Absicht: `content/symbols/` liegt im Repo,
  und das Gerät rendert ohnehin nur 116x116 Pixel.
- **Textfeld**: was Gisela sagt. Das darf vom Symbolwort abweichen - das
  Symbol zeigt "anhalten", gesagt wird "Stopp".
- **▶** hört den Satz vorher ab (geht über Azure, braucht also den Key).
- **Bauen** oben rechts ruft `build.py` und zeigt das Protokoll an.

**Umsortieren per Ziehen:** jede Sprechtaste hat oben rechts einen Griff (⠿).
Zieht man ihn auf eine andere Taste, **tauschen** die beiden die Plätze - im
festen 2x2-Raster ist das eindeutiger als Einsortieren. Die Reiter oben lassen
sich ebenfalls ziehen; deren Reihenfolge bestimmt, wie die Set-Taste am Gerät
durchschaltet.

Umsortieren kostet nichts: die Sprachdateien hängen im Cache am Text, nicht an
der Position. Es wird also nichts neu gesprochen.

Änderungen werden automatisch in `content/layout.json` gespeichert.

---

## layout.json

Die einzige Quelle der Wahrheit. Höchstens 5 Sets, genau 4 Slots pro Set.

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

`color` ist die Farbe, die als Rahmen um alle fünf Bilder gerendert wird -
damit sie am Farbeindruck erkennt, in welchem Set sie gerade ist. Neue Sets
bekommen der Reihe nach eine Farbe aus `DEFAULT_PALETTE` in `build.py`; die
Weboberfläche holt sich dieselbe Liste von dort.

Ein leerer `text` bedeutet: diese Taste bleibt stumm. Ein leeres `symbol`
ergibt eine Platzhalter-Kachel mit grauem Kreuz.

---

## Bauen

```bash
.venv/bin/python build.py
```

Schreibt nach `firmware/mitreden/data/` (gitignored, wird auf das Gerät
hochgeladen):

| Datei              | Inhalt                                          |
|--------------------|-------------------------------------------------|
| `a<prüfsumme>.wav` | gesprochener Satz, 16 kHz mono 16 bit          |
| `t<prüfsumme>.bin` | 116x116 Symbolfläche, RGB565 big-endian       |

und dazu `firmware/mitreden/layout.h` mit Anzahl der Sets, Dateinamen, Farben und
`sleep_timeout_seconds` als Konstanten für die Firmware.

**Die Dateinamen sind Prüfsummen des Inhalts, nicht der Position.** Das hat
zwei Folgen:

- Kommt dasselbe Symbol oder derselbe Satz in mehreren Sets vor, liegt er auf
  dem Gerät trotzdem nur **einmal**. `layout.h` lässt dann einfach mehrere
  Einträge auf dieselbe Datei zeigen.
- Eine Datei kann nicht veralten, ohne dass sich ihr Name mitändert. Ein
  Name kann also nie auf einen falschen Inhalt zeigen.

**Der farbige Rahmen steckt nicht im Bild.** Die Datei enthält nur die
116x116 Symbolfläche; die sechs Pixel Rahmen zeichnet die Firmware selbst aus
`SET_COLORS`. Sonst hänge das Bild am Set, in dem es gerade liegt - dasselbe
Symbol wäre in einem blauen und einem grünen Set zwei verschiedene Dateien,
und eine Farbänderung würde sämtliche Bilder eines Sets neu schreiben. So
kostet ein Farbwechsel **null** Bilddaten.

Dateien aus früheren Läufen, die nicht mehr gebraucht werden, räumt
`build.py` selbst weg.

Nützliche Schalter:

```bash
.venv/bin/python build.py --no-audio      # nur Bilder und layout.h
.venv/bin/python build.py --force-audio   # alle WAVs neu rendern
```

---

## Was im Repo liegt und was nicht

Im Repo liegt **nur Code und Dokumentation**. Alles, was ein Kind betrifft -
Layout, Symbole, Fotos, gesprochene Sätze - liegt unter `content/` und ist
bewusst nicht versioniert.

```
content/                 deine Inhalte, gitignored
├── layout.json
├── symbols/
└── cache/
    ├── tts/             gesprochene Sätze
    ├── tiles/           gerenderte Symbolflächen
    ├── thumbs/          Suchvorschauen
    └── layout-backups/  die letzten 60 Stände von layout.json

example/                 neutrale Beispielinhalte, im Repo
├── layout.json
└── symbols/
```

Beim ersten Start wird `content/` aus `example/` gefüllt. Ein frisch
geklontes Projekt zeigt also sofort ein Set mit vier Tasten an, ohne dass
jemand etwas anlegen muss.

Der Ort lässt sich verlegen, etwa auf eine Netzfreigabe:

```bash
MITREDEN_CONTENT=/volume1/talker/inhalte .venv/bin/python app.py
```

**Sichere `content/` selbst.** Da steckt deine ganze Arbeit drin, und Git
fängt sie absichtlich nicht mehr auf. Auf einem NAS läuft sie in dessen
Sicherung mit; auf einem Rechner gehört sie in dein übliches Backup.

Nicht im Repo sind ausserdem `firmware/mitreden/data/`, `layout.h` und das
LittleFS-Abbild - die entstehen in Sekunden neu aus `content/`. Und `.env`
mit dem Azure-Schlüssel.

## Sprachausgabe

`tts.py` spricht über die Azure Speech REST API mit **de-DE-GiselaNeural**,
Region **germanywestcentral**, Sprechtempo **-5 %**.

Danach durch ffmpeg: Stille am Anfang und Ende weg, dann
`loudnorm I=-16:TP=-1.5:LRA=11`, Ausgabe als 16 kHz mono 16 bit WAV. Dadurch
sind alle Tasten gleich laut - wichtig, weil es am Gerät keinen
Lautstärkeregler gibt.

Der Key kommt aus der Umgebungsvariablen `AZURE_SPEECH_KEY`, ersatzweise aus
`.env`. Eine gesetzte Umgebungsvariable gewinnt.

Gerendert wird nur, was sich geändert hat: über Text und Stimm-Konfiguration
wird ein Fingerprint gebildet, fertige Dateien liegen unter `content/cache/tts/`.
Wer die Stimme oder die ffmpeg-Kette ändert, ändert damit auch den
Fingerprint - dann wird automatisch alles neu gerendert.

Einzeln testen geht auch:

```bash
.venv/bin/python tts.py "Ich moechte nach draussen" probe.wav
```

---

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

**2. Programm übersetzen und schreiben:**

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
`default_8MB.csv`. Sie gilt nur für dieses Partitionsschema - mit einem
anderen landen die Daten an der falschen Stelle.

**Mitlesen, was das Gerät sagt:**

```bash
arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=115200
```

Dort steht beim Start, welches Set geladen wurde, welche Taste gedrückt wurde
und ob LittleFS sich einhängen ließ.

### Wie das Abbild entsteht

`build.py --fs-image` packt `firmware/mitreden/data/` mit `mklittlefs` in ein
Abbild von 1536 KiB - genau die Größe der `spiffs`-Partition. Passen die
Daten nicht hinein, bricht es mit einer klaren Meldung ab, statt ein zu großes
Abbild zu erzeugen.

Das Abbild selbst ist gitignored: es entsteht in Sekunden neu aus `data/`.

Übersetzen:

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/mitreden
```

> **Das Partitionsschema ist nicht optional.** Die Voreinstellung des Boards
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

### Verhalten

- **Wach:** alle fünf Displays sind durchgehend an. Sie muss sehen können,
  was zur Auswahl steht.
- **Taste 1-4:** das zugehörige WAV wird abgespielt.
- **Taste 5:** nächstes Set (1→2→3→4→5→1), alle Displays werden neu gezeichnet.
  Das aktuelle Set überlebt den Schlaf.
- **Nach `sleep_timeout_seconds` ohne Eingabe:** Displays aus, Deep Sleep.

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

### Gehäuse

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

## Symbole

Die Piktogramme stammen von **[ARASAAC](https://arasaac.org)**.

> Urheber der Piktogramme: **Sergio Palao**. Herkunft:
> [ARASAAC](https://arasaac.org), Regierung von Aragonien (Spanien).
> Lizenz: **CC BY-NC-SA**.

Die Suche in der Weboberfläche nutzt die offene ARASAAC-API ohne
Anmeldung. Heruntergeladene Symbole liegen in `content/symbols/` und liegen im Repo
mit; welches Symbol woher kommt, steht in `content/symbols/QUELLEN.md`.

---

## Struktur

```
mitreden/
├── app.py               Weboberfläche, localhost:8771
├── build.py             erzeugt data/ und layout.h im Sketchordner
├── tts.py               Sprachausgabe
├── example/             neutrale Beispielinhalte
├── content/             deine Inhalte, gitignored
├── firmware/mitreden/   Arduino-Sketch, data/ und layout.h generiert
├── Dockerfile           für den Betrieb auf einem NAS
└── .env                 AZURE_SPEECH_KEY, gitignored
```
