# Betrieb: vom Handy, auf einem NAS

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

Sinnvoller als ein Rechner, der nur manchmal an ist. Es liegt ein `Dockerfile` und
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
Am Rechner dieselbe Freigabe einhängen und dort mit git weiterarbeiten -
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
- Geflasht wird weiter vom Rechner aus - dafür braucht es USB.

Ins offene Internet gehört die Oberfläche nicht: sie braucht einen
laufenden Python-Prozess, schreibt Dateien und hat den Azure-Schlüssel. Auf
GitHub Pages läuft sie deshalb nicht - das ist reines Ausliefern fertiger
Dateien, ohne Server dahinter.

Ohne Azure-Key lässt sich schon alles außer dem Ton benutzen: Symbole
suchen, Layout bearbeiten, Bilder bauen.

---
