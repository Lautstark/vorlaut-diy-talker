# mitreden

Ein kleiner Talker zum Selberbauen. Fünf Tasten, die gleichzeitig Displays
sind: vier sprechen einen hinterlegten Satz, die fünfte schaltet zwischen
Sets um.

Ich baue das für meine dreieinhalbjährige Tochter, die noch nicht spricht.
Ein Talker ist beantragt, aber noch nicht da — und für draußen wäre ein iPad
ohnehin unpraktisch. Das hier hat vier Wörter, hält etwas aus und ist sofort
an.

> **In Arbeit.** Die Software läuft, die Hardware ist bestellt und noch nicht
> aufgebaut. Alles zur Verdrahtung ist gerechnet, nicht gemessen.

## Was es tut

- Vier Sprechtasten pro Set, bis zu fünf Sets
- Jedes Set hat eine Farbe, die als Rahmen um alle Displays läuft
- Bearbeitet wird im Browser: Symbol suchen, Satz eintippen, vorhören
- Ein Befehl macht daraus Bilder und Sprachdateien fürs Gerät
- Schläft von selbst ein, wacht auf jeden Tastendruck auf

## Schnellstart

```bash
git clone https://github.com/SteffiPeTaffy/mitreden.git
cd mitreden
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Dann [localhost:8771](http://localhost:8771) öffnen. Beim ersten Start füllt
sich `content/` aus `example/`, es ist also gleich ein Set mit vier Tasten da.

Zusätzlich wird `ffmpeg` gebraucht (`brew install ffmpeg` beziehungsweise
`apt install ffmpeg`). Für die Sprachausgabe ein Azure-Speech-Schlüssel in
`.env` — Vorlage in `.env.example`.

## Weiter

| | |
|---|---|
| [docs/hardware.md](docs/hardware.md) | Bauteile, Pinbelegung, Gehäusemaße |
| [docs/software.md](docs/software.md) | Weboberfläche, layout.json, Bauvorgang, Sprachausgabe |
| [docs/firmware.md](docs/firmware.md) | Übersetzen, Partitionsschema, Flashen |
| [docs/betrieb.md](docs/betrieb.md) | Vom Handy bearbeiten, Betrieb auf einem NAS |

## Lizenz

Code unter [MIT](LICENSE).

Die Piktogramme in `example/symbols/` fallen nicht darunter: sie stammen von
[ARASAAC](https://arasaac.org), Urheber **Sergio Palao**, Lizenz
**CC BY-NC-SA**. Dasselbe gilt für alle Symbole, die über die Suche in der
Weboberfläche geladen werden. Einzelheiten in
[`example/symbols/LIZENZ.md`](example/symbols/LIZENZ.md).
