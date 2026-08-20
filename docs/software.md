# Inhalte bearbeiten und bauen

## Auf dem Rechner

| | wofür |
|---|---|
| Python 3.9 oder neuer | Weboberfläche und Bauvorgang |
| ffmpeg | Sprachdateien zuschneiden und normalisieren |
| Pillow | Bilder umrechnen (`requirements.txt`) |
| arduino-cli oder Arduino IDE | Firmware übersetzen und flashen |
| ESP32-Core 3.x | für den Feather |

Alternativ läuft die Weboberfläche im mitgelieferten Docker-Abbild — dann
braucht es lokal nur noch die Arduino-Werkzeuge fürs Flashen.

## Für die Sprachausgabe

Zurzeit **Azure Speech** mit der Stimme `de-DE-GiselaNeural`. Dafür wird ein
eigener Schlüssel gebraucht; die kostenlose Stufe F0 enthält 0,5 Mio.
Zeichen im Monat, was für einen Talker reichlich ist.

> Eine Variante ohne Cloud-Konto ist geplant (offline-TTS), damit das
> Projekt auch ohne Microsoft-Konto nachbaubar ist. Noch nicht umgesetzt.

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

**Gerätevorschau:** der Schiebeschalter oben zeigt unter jeder Kachel zusätzlich
an, wie es auf dem Gerät ankommt — auf 116x116 verkleinert, auf RGB565
gerundet, mit dem Rahmen den die Firmware zeichnet, und in der Größe der
tatsächlich sichtbaren Fläche von **15,21 x 15,21 mm**. Ein detailreiches
Piktogramm kann darauf unlesbar werden; besser vor dem Aussuchen sehen als
hinterher.

Die große Kachel bleibt dabei das Quellbild in voller Schärfe — sie ist zum
Aussuchen da.

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

und dazu `layout.bin` — eine kompakte Tabelle mit Anzahl der Sets, Farben,
Schlafzeit und den Prüfsummen, welche Datei zu welcher Taste gehört.

**Diese Tabelle liegt beim Inhalt, nicht in der Firmware.** Ein Set anlegen,
umbenennen oder umfärben ändert damit nichts am Programm — es muss nichts
neu übersetzt und nichts mit Kabel aufgespielt werden. Die Firmware ist für
alle dieselbe.

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

## Sprachausgabe

`tts.py` spricht über die Azure Speech REST API. Voreingestellt ist
**de-DE-GiselaNeural** in der Region **germanywestcentral** mit Sprechtempo
**-5 %**.

Alles drei lässt sich in `.env` ändern:

```
AZURE_SPEECH_REGION=westeurope
AZURE_SPEECH_VOICE=de-DE-KatjaNeural
AZURE_SPEECH_RATE=-10%
```

**Die Region ist keine Geschmacksfrage** - sie muss zu der passen, in der
der Schlüssel angelegt wurde, sonst antwortet Azure mit 401. Welche Stimmen
der eigene Schlüssel anbietet, zeigt:

```bash
.venv/bin/python tts.py --stimmen
```

Die Sprache wird aus dem Stimmnamen abgeleitet, `de-DE-GiselaNeural` ergibt
also `de-DE`. Eine englische Stimme funktioniert damit genauso.

Ein Stimmwechsel ändert den Fingerprint, also wird beim nächsten Bauen
automatisch alles neu gesprochen.

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

## Was im Repo liegt und was nicht

Im Repo liegt **nur Code und Dokumentation**. Alles, was ein Kind betrifft -
Layout, Symbole, Fotos, gesprochene Sätze - liegt unter `content/` und ist
bewusst nicht versioniert.

```
content/                 eigene Inhalte, gitignored
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

**`content/` muss selbst gesichert werden.** Da steckt die ganze Arbeit
drin, und Git fängt sie absichtlich nicht mehr auf. Auf einem NAS läuft sie in dessen
Sicherung mit; auf einem Rechner gehört sie in dein übliches Backup.

Nicht im Repo sind ausserdem `firmware/mitreden/data/`, `layout.h` und das
LittleFS-Abbild - die entstehen in Sekunden neu aus `content/`. Und `.env`
mit dem Azure-Schlüssel.
