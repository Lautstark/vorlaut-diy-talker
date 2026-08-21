# vorlaut

Ein kleiner Talker zum Selberbauen. Fünf Tasten, die gleichzeitig Displays
sind: vier sprechen einen hinterlegten Satz, die fünfte schaltet zwischen
Sets um.

Ich baue das für meine dreieinhalbjährige Tochter, die noch nicht spricht.

> **In Arbeit.** Noch nicht auf echter Hardware gelaufen.

## Was es tut

- Vier Sprechtasten pro Set, bis zu fünf Sets
- Jedes Set hat eine Farbe, die als Rahmen um alle Displays läuft
- Bearbeitet wird im Browser: Symbol suchen, Satz eintippen, vorhören
- Ein Befehl macht daraus Bilder und Sprachdateien fürs Gerät
- Schläft von selbst ein, wacht auf jeden Tastendruck auf

## Woraus

Ein **ESP32-S3 Feather** treibt fünf **Waveshare ScreenKeys** — 0,85-Zoll-Displays mit 128×128 Pixeln und eingebautem Taster — über einen gemeinsamen
SPI-Bus. Der Ton geht über einen **MAX98357A** an einen 40-mm-Lautsprecher,
Strom kommt aus einem LiPo, geladen über USB-C am Feather. Die Firmware ist
ein Arduino-Sketch.

Bearbeitet wird am Rechner: eine Weboberfläche aus der Python-Standardbibliothek, Piktogramme von [ARASAAC](https://arasaac.org), Sprachausgabe
über Azure. Der Build rechnet daraus RGB565-Bilder und 16-kHz-WAVs und
packt sie in ein LittleFS-Image für den Flash.

## Schnellstart

```bash
git clone https://github.com/SteffiPeTaffy/vorlaut.git
cd vorlaut
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Ob alles Nötige da ist, sagt:

```bash
python3 doctor.py
```

Dann [localhost:8771](http://localhost:8771) öffnen. Beim ersten Start füllt
sich `content/` aus `example/`, es ist also gleich ein Set mit vier Tasten da.

Zusätzlich wird `ffmpeg` gebraucht (`brew install ffmpeg` beziehungsweise
`apt install ffmpeg`).

Für die Sprachausgabe braucht es einen eigenen **Azure-Speech-Schlüssel** —
ein kostenloses Konto genügt, die Stufe F0 enthält 0,5 Mio. Zeichen im
Monat. Schlüssel und Region kommen in `.env`, Vorlage ist `.env.example`.
Stimme und Sprechtempo lassen sich dort ebenfalls einstellen;
`.venv/bin/python tts.py --voices` zeigt, was zur Auswahl steht.

## Sprachen im Projekt

Das **Produkt** gibt es auf Deutsch und auf Englisch — Oberfläche, Bauprotokoll
und die Beschriftungen auf dem Gerät. Umgeschaltet wird oben rechts in der
Oberfläche; gespeichert ist das als `"language"` in `layout.json`.

Es ist absichtlich **eine** Einstellung für alles. Ein Talker, dessen Menü
`back` sagt, während der Rechner daneben `zurück` sagt, wäre nur eine weitere
Sache, die man synchron halten muss.

Die **Inhalte** bleiben davon unberührt: Setnamen, die Wörter auf den Tasten
und alles Gesprochene sind, was jemand eingetippt hat. Wer die Oberfläche auf
Englisch stellt, behält ein deutsches Set. Die Stimme wird getrennt in `.env`
gewählt.

Die Texte liegen als Tabelle pro Sprache in [`texts.py`](texts.py) für Rechner
und Oberfläche und in
[`firmware/vorlaut/texts.h`](firmware/vorlaut/texts.h) fürs Gerät. Standard ist
Englisch.

Der eingebaute Font ist dabei kein Unicode, sondern Codepage 437: `zurück` wäre
als `zur├╝ck` auf dem Display gelandet. Was sich zeichnen lässt und was nicht,
steht in [docs/firmware.md](docs/firmware.md); ein Test prüft jede Übersetzung
gegen die Breite eines Displays.

**Code und Dokumentation sind englisch** — Bezeichner, Kommentare,
Commit-Nachrichten, `docs/` und die Kommandozeile. Nur diese README bleibt
deutsch, als Einstieg ins Projekt.

Die Kommandozeile bleibt auch dann englisch, wenn die Oberfläche deutsch
steht: `build.py` reicht Meldungen als Schlüssel weiter, und wer sie anzeigt,
entscheidet über die Sprache. Derselbe Fehler steht im Terminal auf Englisch
und im Browser auf Deutsch.

Die Trennung verläuft also nicht nach Datei, sondern danach, wer es liest:
was jemand benutzt, gibt es in seiner Sprache; was beim Weiterentwickeln
gelesen wird, ist englisch.

## Weiter

| | |
|---|---|
| [docs/hardware.md](docs/hardware.md) | Bauteile, Pinbelegung, Gehäusemaße |
| [docs/software.md](docs/software.md) | Weboberfläche, layout.json, Build, Sprachausgabe |
| [docs/bring-up.md](docs/bring-up.md) | Erstaufbau in Stufen, mit kleinen Testsketchen |
| [docs/firmware.md](docs/firmware.md) | Fertiges Image oder selbst übersetzen, Partition Scheme, Flashen |
| [docs/operation.md](docs/operation.md) | Im Container starten, vom Handy bearbeiten, Betrieb auf einem NAS |

## Lizenz

Code unter [MIT](LICENSE).

Die Piktogramme in `example/symbols/` fallen nicht darunter: sie stammen von
[ARASAAC](https://arasaac.org), Urheber **Sergio Palao**, Lizenz
**CC BY-NC-SA**. Dasselbe gilt für alle Symbole, die über die Suche in der
Weboberfläche geladen werden. Einzelheiten in
[`example/symbols/LIZENZ.md`](example/symbols/LIZENZ.md).
