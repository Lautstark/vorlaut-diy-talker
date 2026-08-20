#!/usr/bin/env python3
"""Weboberfläche für mitreden - läuft auf http://localhost:8771

Bewusst ohne Framework: nur die Python-Standardbibliothek. Die Seite sieht aus
wie das Gerät - oben die Reiter für die Sets, darunter die vier Sprechtasten
im 2x2-Raster und daneben die Set-Kachel.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build
import tts

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
SYMBOLS_DIR = build.SYMBOLS_DIR
THUMB_CACHE = build.CONTENT / "cache" / "thumbs"
PORT = 8771
HOST = "127.0.0.1"   # Voreinstellung: nur dieser Rechner
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB reichen für jedes Symbol

ARASAAC_SEARCH = "https://api.arasaac.org/api/pictograms/de/search/"
ARASAAC_IMAGE = "https://api.arasaac.org/api/pictograms/"
ARASAAC_RESOLUTION = 500  # die API erlaubt nur 500 oder 2500
# Hausmaß für alles in symbols/. Das Gerät rendert 116x116 Pixel, 500 lässt
# reichlich Luft und hält den Repo klein - Symbole werden mitcommittet.
SYMBOL_MAX_PX = 500


# --- Hilfsfunktionen ---------------------------------------------------------

def layout_version() -> str:
    """Kennung des aktuellen Dateistands, damit ein veralteter Tab nicht
    stillschweigend die Arbeit eines anderen überschreibt."""
    if not build.LAYOUT_FILE.exists():
        return "leer"
    return hashlib.sha256(build.LAYOUT_FILE.read_bytes()).hexdigest()[:16]


def slugify(value: str) -> str:
    value = value.strip().lower()
    for source, replacement in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        value = value.replace(source, replacement)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "symbol"


def arasaac_search(word: str) -> list[dict]:
    url = ARASAAC_SEARCH + urllib.parse.quote(word.strip())
    request = urllib.request.Request(url, headers={"User-Agent": "mitreden"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # ARASAAC antwortet auf ein Wort ohne Treffer mit 404 und einer leeren
        # Liste. Das ist kein Fehler, sondern schlicht kein Ergebnis.
        if exc.code == 404:
            return []
        raise
    if not isinstance(payload, list):
        return []
    results = []
    for item in payload[:60]:
        pictogram_id = item.get("_id") or item.get("id")
        if pictogram_id is None:
            continue
        keywords = item.get("keywords") or []
        label = ""
        if keywords and isinstance(keywords[0], dict):
            label = keywords[0].get("keyword") or ""
        results.append(
            {
                "id": pictogram_id,
                "label": label,
                # über den eigenen Server, damit die Seite keine Anfragen
                # nach draußen stellen muss
                "url": f"/api/thumb?id={pictogram_id}",
            }
        )
    return results


def preview_png(symbol: str, color: str) -> bytes:
    """Was das Display wirklich zeigen wird, als PNG.

    Nicht das Quellbild: hier steckt die Verkleinerung auf 116x116, die
    Quantisierung auf RGB565 und der Rahmen drin, den die Firmware zeichnet.
    Auf 15,21 mm sichtbarer Fläche macht das einen Unterschied.
    """
    Image, _ = build._require_pillow()
    roh = build.tile_bytes(symbol)          # 116x116, RGB565 big-endian
    kante = build.TILE_SIZE
    innen = Image.new("RGB", (kante, kante))
    px = innen.load()
    for i in range(kante * kante):
        wert = (roh[i * 2] << 8) | roh[i * 2 + 1]
        r = (wert >> 11) << 3
        g = ((wert >> 5) & 0x3F) << 2
        b = (wert & 0x1F) << 3
        # Die unteren Bits so auffüllen, wie ein Panel es tut
        px[i % kante, i // kante] = (r | r >> 5, g | g >> 6, b | b >> 5)

    kachel = Image.new("RGB", (build.IMG_SIZE, build.IMG_SIZE),
                       build.hex_to_rgb(color))
    kachel.paste(innen, (build.BORDER, build.BORDER))
    puffer = io.BytesIO()
    kachel.save(puffer, "PNG")
    return puffer.getvalue()


def save_upload(data: bytes, original_name: str) -> str:
    """Nimmt ein hochgeladenes Bild an und legt es als PNG in symbols/ ab."""
    Image, _ = build._require_pillow()
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            picture = opened.convert("RGBA")
    except Exception as exc:  # Pillow wirft je nach Format Verschiedenes
        raise ValueError("Das ist kein lesbares Bild.") from exc

    # Auf quadratisch beschneiden, mittig. Die Kachel ist quadratisch - ohne
    # das bliebe an zwei Seiten ein weißer Balken stehen, und das Bild wäre
    # kleiner als nötig. Zuerst schneiden, dann verkleinern: das kostet
    # weniger Schärfe, als andersherum.
    if picture.width != picture.height:
        seite = min(picture.size)
        links = (picture.width - seite) // 2
        oben = (picture.height - seite) // 2
        picture = picture.crop((links, oben, links + seite, oben + seite))

    # Handyfotos kommen mit mehreren tausend Pixeln an. Direkt beim Annehmen
    # verkleinern, damit nie ein Riesenbild in symbols/ landet.
    if max(picture.size) > SYMBOL_MAX_PX:
        picture.thumbnail((SYMBOL_MAX_PX, SYMBOL_MAX_PX), Image.LANCZOS)

    stem = slugify(Path(original_name).stem)
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    # Vorhandene Symbole nicht überschreiben, sondern durchnummerieren.
    filename = f"{stem}.png"
    counter = 2
    while (SYMBOLS_DIR / filename).exists():
        filename = f"{stem}-{counter}.png"
        counter += 1
    picture.save(SYMBOLS_DIR / filename, "PNG", optimize=True)
    return filename


def arasaac_fetch(pictogram_id: int) -> bytes:
    """Holt ein Piktogramm als PNG und legt es im Cache ab.

    Die API erlaubt nur die Auflösungen 500 und 2500; wir nehmen 500 sowohl
    für die Vorschau in der Suche als auch für die Datei in symbols/.
    """
    identifier = int(pictogram_id)
    THUMB_CACHE.mkdir(parents=True, exist_ok=True)
    cached = THUMB_CACHE / f"{identifier}.png"
    if cached.exists():
        return cached.read_bytes()
    url = f"{ARASAAC_IMAGE}{identifier}?resolution={ARASAAC_RESOLUTION}"
    request = urllib.request.Request(url, headers={"User-Agent": "mitreden"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    if not data.startswith(b"\x89PNG"):
        raise ValueError("ARASAAC hat kein PNG geliefert.")
    cached.write_bytes(data)
    return data


def arasaac_download(pictogram_id: int, label: str) -> str:
    """Legt ein Piktogramm in symbols/ ab und liefert den Dateinamen."""
    data = arasaac_fetch(pictogram_id)
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{slugify(label)}-{int(pictogram_id)}.png"
    (SYMBOLS_DIR / filename).write_bytes(data)
    return filename


# --- HTTP --------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "mitreden"

    def log_message(self, fmt, *args):  # ruhiger Log
        if self.path.startswith("/api/"):
            print(f"  {self.command} {self.path}", flush=True)

    # -- Antworten --

    def _send(self, code: int, body: bytes, content_type: str, extra=None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload, code: int = 200, extra=None) -> None:
        self._send(
            code,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
            extra,
        )

    def _error(self, message: str, code: int = 400) -> None:
        self._json({"error": message}, code)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _upload(self, query) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._error("Es kamen keine Bilddaten an.")
            return
        if length > MAX_UPLOAD:
            self._error(f"Das Bild ist zu groß (höchstens {MAX_UPLOAD // 1048576} MB).")
            return
        data = self.rfile.read(length)
        name = (query.get("name") or ["bild"])[0]
        try:
            self._json({"symbol": save_upload(data, name)})
        except (ValueError, build.BuildError) as exc:
            self._error(str(exc))

    # -- Routen --

    def do_GET(self):
        route = urllib.parse.urlparse(self.path)
        path = route.path
        query = urllib.parse.parse_qs(route.query)

        if path in ("/", "/index.html"):
            page = PAGE.replace("__PALETTE__", json.dumps(build.DEFAULT_PALETTE))
            self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/api/layout":
            try:
                self._json(
                    build.load_layout(),
                    extra={"X-Layout-Version": layout_version()},
                )
            except build.BuildError as exc:
                self._error(str(exc), 500)
            return

        if path == "/api/search":
            word = (query.get("q") or [""])[0].strip()
            if not word:
                self._json([])
                return
            try:
                self._json(arasaac_search(word))
            except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
                self._error(f"ARASAAC nicht erreichbar: {exc}", 502)
            return

        if path in ("/icon.svg", "/icon-192.png", "/icon-512.png"):
            datei = ASSETS / Path(path).name
            if not datei.exists():
                self._error("Symbol nicht gefunden.", 404)
                return
            art = "image/svg+xml" if path.endswith(".svg") else "image/png"
            self._send(200, datei.read_bytes(), art)
            return

        if path == "/manifest.webmanifest":
            # Damit sich die Seite als App auf den Startbildschirm legen
            # lässt. Bewusst ohne Service Worker: die Oberfläche ist ohne
            # Server ohnehin nutzlos, und zwischengespeichertes JavaScript
            # hätte schon genug Ärger gemacht.
            self._json({
                "name": "mitreden",
                "short_name": "mitreden",
                "description": "Inhalte für den Talker bearbeiten",
                "start_url": "/",
                "display": "standalone",
                "orientation": "portrait",
                "background_color": "#16181d",
                "theme_color": "#16181d",
                "icons": [
                    {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
                    {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
                    {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png",
                     "purpose": "maskable"},
                ],
            })
            return

        if path == "/api/preview":
            symbol = (query.get("symbol") or [""])[0]
            farbe = (query.get("color") or ["#000000"])[0]
            try:
                self._send(200, preview_png(symbol, farbe), "image/png")
            except build.BuildError as exc:
                self._error(str(exc), 500)
            return

        if path == "/api/thumb":
            try:
                identifier = int((query.get("id") or ["0"])[0])
                self._send(200, arasaac_fetch(identifier), "image/png")
            except (urllib.error.URLError, ValueError, TimeoutError) as exc:
                self._error(f"Vorschau nicht ladbar: {exc}", 502)
            return

        if path.startswith("/symbols/"):
            name = Path(urllib.parse.unquote(path[len("/symbols/"):])).name
            target = SYMBOLS_DIR / name
            if not name or not target.exists():
                self._error("Symbol nicht gefunden.", 404)
                return
            self._send(200, target.read_bytes(), "image/png")
            return

        self._error("Nicht gefunden.", 404)

    def do_POST(self):
        route = urllib.parse.urlparse(self.path)
        path = route.path

        # Der Upload schickt rohe Bilddaten, kein JSON - deshalb vorher raus.
        if path == "/api/upload":
            self._upload(urllib.parse.parse_qs(route.query))
            return

        try:
            body = self._body()
        except json.JSONDecodeError:
            self._error("Ungültiges JSON.")
            return

        if path == "/api/layout":
            gesendet = self.headers.get("X-Layout-Version")
            aktuell = layout_version()
            if gesendet and gesendet != aktuell:
                # Diese Seite kennt einen älteren Stand. Nicht überschreiben.
                self._json(
                    {
                        "error": "Diese Seite hat einen veralteten Stand - "
                                 "layout.json wurde zwischenzeitlich woanders "
                                 "geändert.",
                        "conflict": True,
                    },
                    409,
                )
                return
            try:
                saved = build.save_layout(body)
            except build.BuildError as exc:
                self._error(str(exc))
                return
            self._json(saved, extra={"X-Layout-Version": layout_version()})
            return

        if path == "/api/pick":
            try:
                filename = arasaac_download(body.get("id"), body.get("label") or "symbol")
            except (urllib.error.URLError, ValueError, TypeError, TimeoutError) as exc:
                self._error(f"Download fehlgeschlagen: {exc}", 502)
                return
            self._json({"symbol": filename})
            return

        if path == "/api/speak":
            text = (body.get("text") or "").strip()
            try:
                wav = tts.synthesize(text)
            except tts.TTSError as exc:
                self._error(str(exc))
                return
            self._send(200, wav.read_bytes(), "audio/wav")
            return

        if path == "/api/build":
            try:
                log = build.build()
            except (build.BuildError, tts.TTSError) as exc:
                self._error(str(exc), 500)
                return
            self._json({"log": log})
            return

        self._error("Nicht gefunden.", 404)


PAGE = r"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>mitreden</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#16181d">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="mitreden">
<style>
  :root {
    --bg: #16181d;
    --panel: #1f2229;
    --panel-2: #262a33;
    --line: #343a45;
    --text: #eceff4;
    --muted: #9aa3b2;
    --accent: #9B7BFF;   /* das Lila aus dem Symbol */
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 16px;
    padding: 12px 24px; border-bottom: 1px solid var(--line);
  }
  header h1 { font-size: 19px; margin: 0; font-weight: 600; letter-spacing: .3px; }
  .logo { width: 26px; height: 26px; flex: none; }
  header .status { margin-left: auto; }
  main { max-width: 640px; margin: 0 auto; padding: 14px 20px; }

  .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .tab {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 14px; border-radius: 10px; cursor: pointer;
    background: var(--panel); border: 2px solid transparent; color: var(--muted);
    font-size: 14px;
  }
  .tab .dot { width: 12px; height: 12px; border-radius: 3px; }
  .tab.active { color: var(--text); background: var(--panel-2); }
  .tab.add { border: 1px dashed var(--line); }

  .device { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .tile {
    background: var(--panel); border-radius: 14px; padding: 10px;
    display: flex; flex-direction: column; gap: 8px; justify-content: flex-start;
    border: 3px solid var(--accent);
  }
  .swatches { display: flex; gap: 6px; flex-wrap: wrap; }
  .swatch {
    width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box;
  }
  .swatch:hover { border-color: var(--muted); }
  .swatch.active { border-color: var(--text); }
  .thumb {
    aspect-ratio: 1/1; flex: 0 0 auto; background: #fff; border-radius: 8px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    position: relative;
  }
  .thumb img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
  .thumb .empty { color: #b9bfc9; font-size: 13px; text-align: center; padding: 8px; }
  .thumb:hover::after {
    content: "Symbol wählen"; position: absolute; inset: auto 0 0 0;
    background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 4px;
    text-align: center;
  }
  .row { display: flex; gap: 8px; }
  input[type=text] {
    width: 100%; min-width: 0; background: var(--panel-2); border: 1px solid var(--line);
    color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 14px;
    flex: 0 1 auto; align-self: flex-start;
  }
  .row input[type=text] { flex: 1 1 auto; }
  .colorRow { display: flex; gap: 8px; }
  input[type=color] {
    width: 42px; height: 36px; flex: none; padding: 2px; background: var(--panel-2);
    border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
  }
  input[type=color]:hover { border-color: var(--muted); }
  /* Etwas schmaler gesetzt, damit "#4A90D9" vollständig hineinpasst. */
  .colorRow input[type=text] {
    flex: 1 1 auto; padding: 8px 6px; font-family: ui-monospace, monospace;
    font-size: 13px;
  }
  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 14px;
  }
  button:hover { background: #303540; }
  /* Dunkle Schrift auf dem Lila: 5,5:1 statt 3,2:1 mit Weiß. */
  button.primary {
    background: var(--accent); border-color: transparent; color: #1b1b20;
    font-weight: 600;
  }
  button.primary:hover { background: #ac91ff; }
  button.danger { color: #e88; }
  .play { width: 40px; flex: none; }
  .slotNr {
    color: var(--muted); font-size: 12px; letter-spacing: .5px;
    display: flex; align-items: center; gap: 6px;
  }
  .grip {
    margin-left: auto; cursor: grab; font-size: 15px; line-height: 1;
    color: var(--muted); opacity: .55; padding: 0 2px;
  }
  .grip:hover { opacity: 1; }
  .grip:active { cursor: grabbing; }
  .tile.dragover { border-style: dashed; }
  .tab.dragover { outline: 2px dashed var(--muted); outline-offset: 2px; }
  .tab[draggable=true] { cursor: grab; }

  .status { color: var(--muted); font-size: 13px; }
  /* Schiebeschalter. HTML kennt so etwas nicht - Safari 17.4 rendert
     <input type="checkbox" switch> nativ so, sonst gibt es nur das Kästchen.
     Also aus dem Kästchen gebaut: das bleibt darunter erhalten und damit auch
     Tastaturbedienung und Vorlesen. */
  .schalter {
    display: flex; align-items: center; gap: 8px; cursor: pointer;
    color: var(--muted); font-size: 13px; white-space: nowrap;
  }
  .schalter input { position: absolute; opacity: 0; width: 0; height: 0; }
  .pille {
    width: 38px; height: 22px; border-radius: 11px; flex: none;
    background: var(--line); position: relative; transition: background .15s;
  }
  .pille::after {
    content: ""; position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .45); transition: transform .15s;
  }
  .schalter input:checked + .pille { background: var(--accent); }
  .schalter input:checked + .pille::after { transform: translateX(16px); }
  .schalter input:focus-visible + .pille {
    outline: 2px solid var(--muted); outline-offset: 2px;
  }
  header .status { margin-left: auto; }
  /* Originalgröße: 15,21 mm sind auf dem Gerät sichtbar. Auf dem Bildschirm
     ungefähr lebensgroß, damit man beurteilen kann, ob ein Symbol darauf
     überhaupt erkennbar ist. */
  .echtgross {
    display: flex; align-items: center; gap: 8px;
    color: var(--muted); font-size: 11px;
  }
  .echtgross img {
    width: 15.21mm; height: 15.21mm; image-rendering: pixelated;
    border-radius: 2px;
  }
  .conflict {
    display: none; gap: 10px; align-items: center; flex-wrap: wrap;
    background: #3a2224; border: 1px solid #7a3a3f; color: #f0d7d9;
    border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px;
  }
  .conflict.show { display: flex; }
  .conflict button { background: #4d2b2e; border-color: #7a3a3f; color: #f0d7d9; }
  /* Linke Spalte: Set-Kachel und darunter der Löschen-Knopf. */
  .setCol {
    grid-row: span 2; display: flex; flex-direction: column; gap: 10px;
    justify-content: flex-start;
  }
  #removeSet { width: 100%; }
  pre.log {
    margin-top: 12px; background: #101216; border: 1px solid var(--line);
    border-radius: 10px; padding: 14px; font-size: 12.5px; color: #c8d0dc;
    max-height: 260px; overflow: auto; white-space: pre-wrap; display: none;
  }

  /* Auf dem Handy passen drei Spalten nicht - dann die Set-Kachel über die
     volle Breite und die vier Sprechtasten als 2x2 darunter. Die räumliche
     Zuordnung bleibt damit erhalten. */
  @media (max-width: 620px) {
    main { padding: 12px; }
    .device { grid-template-columns: 1fr 1fr; }
    .setCol { grid-row: auto; grid-column: 1 / -1; }
    #removeSet { width: auto; align-self: flex-start; }
  }

  dialog {
    background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 14px; padding: 0; width: min(760px, 92vw);
  }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  .dlgHead {
    display: flex; gap: 8px; padding: 16px; border-bottom: 1px solid var(--line);
    align-items: center;
  }
  /* Die Knöpfe behalten ihre Breite, das Suchfeld gibt nach - sonst bricht
     die Beschriftung um und wird abgeschnitten. */
  .dlgHead button { flex: none; white-space: nowrap; }
  .dlgHead input[type=text] { flex: 1 1 auto; width: auto; min-width: 4rem; }
  .results {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px; padding: 16px; max-height: 60vh; overflow: auto;
  }
  /* Meldungen sind keine Ergebnisse - sie sollen nicht in eine 96px-Spalte
     gequetscht werden. */
  .results p { grid-column: 1 / -1; margin: 4px 2px; color: var(--muted); }
  .results figure { margin: 0; cursor: pointer; text-align: center; }
  .results img {
    width: 100%; aspect-ratio: 1/1; object-fit: contain; background: #fff;
    border-radius: 8px; padding: 4px; border: 2px solid transparent;
  }
  .results figure:hover img { border-color: var(--accent); }
  .results figcaption { font-size: 11px; color: var(--muted); margin-top: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { padding: 0 16px 16px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <img src="/icon.svg" alt="" class="logo">
  <h1>mitreden</h1>
  <span class="status" id="status"></span>
  <label class="schalter"
         title="Zeigt zusätzlich, wie groß und wie grob es auf dem Display ankommt">
    <input type="checkbox" id="previewToggle">
    <span class="pille"></span>
    Gerätevorschau
  </label>
  <button id="saveBtn">Speichern</button>
  <button class="primary" id="buildBtn">Bauen</button>
</header>

<main>
  <div class="conflict" id="conflict">
    <span id="conflictText"></span>
    <button id="overwriteBtn">Meinen Stand behalten</button>
    <button id="reloadBtn">Neu laden</button>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="device" id="device"></div>

  <button id="removeSet" class="danger">Dieses Set löschen</button>
  <pre class="log" id="log"></pre>
<input type="file" id="fileInput" accept="image/*" hidden>
</main>

<dialog id="picker">
  <div class="dlgHead">
    <input type="text" id="q" placeholder="ARASAAC durchsuchen, z.B. trinken">
    <button id="searchBtn">Suchen</button>
    <button id="uploadBtn">Eigenes Bild</button>
    <button id="closeBtn">Schließen</button>
  </div>
  <div class="results" id="results"></div>
  <div class="hint">Piktogramme: ARASAAC, Urheber Sergio Palao, Lizenz CC BY-NC-SA.</div>
</dialog>

<script>
let layout = { sleep_timeout_seconds: 600, sets: [] };
let current = 0;
let pickTarget = null;      // {kind: "set"} oder {kind: "slot", index: n}
let dragSet = null;         // Index des gezogenen Sets
let dragSlot = null;        // Index der gezogenen Taste
let saveTimer = null;
let layoutVersion = null;   // Stand, den diese Seite geladen hat
let unsaved = false;        // es gibt Änderungen, die noch nicht in der Datei sind
let vorschau = false;       // Kacheln so zeigen, wie das Display sie anzeigt

const $ = (id) => document.getElementById(id);
const removeSetBtn = $("removeSet");
const status = (text) => { $("status").textContent = text; };

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = response.statusText;
    try { message = (await response.json()).error || message; } catch (e) {}
    throw new Error(message);
  }
  return response;
}

async function load() {
  const response = await api("/api/layout");
  layoutVersion = response.headers.get("X-Layout-Version");
  layout = await response.json();
  if (current >= layout.sets.length) current = Math.max(0, layout.sets.length - 1);
  $("conflict").classList.remove("show");
  unsaved = false;
  status("");
  render();
}

function saveSoon() {
  clearTimeout(saveTimer);
  unsaved = true;
  status("noch nicht gespeichert");
  saveTimer = setTimeout(save, 400);
}

// Bringt layout in dieselbe Form, die der Server daraus macht. Nur so lassen
// sich die beiden Stände sinnvoll vergleichen.
function vergleichbar(l) {
  return JSON.stringify({
    sets: (l.sets || []).map((entry) => ({
      name: (entry.name || "").trim(),
      symbol: (entry.symbol || "").trim(),
      color: (entry.color || "").trim().toUpperCase(),
      slots: (entry.slots || []).map((slot) => ({
        text: (slot.text || "").trim(),
        symbol: (slot.symbol || "").trim(),
      })),
    })),
  });
}

// Speichervorgänge nacheinander abarbeiten. Zwei gleichzeitige würden sich
// mit dem Stand-Abgleich gegenseitig abweisen - und der Aufrufer könnte nicht
// mehr darauf warten, dass wirklich geschrieben wurde.
let saveChain = Promise.resolve();

function save() {
  saveChain = saveChain.then(doSave, doSave);
  return saveChain;
}

async function doSave() {
  clearTimeout(saveTimer);
  try {
    const response = await fetch("/api/layout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Layout-Version": layoutVersion || "",
      },
      body: JSON.stringify(layout),
    });
    if (response.status === 409) {
      // Nichts geschrieben. Sie entscheidet, welcher Stand gilt.
      $("conflictText").textContent =
        "Nicht gespeichert: layout.json wurde zwischenzeitlich woanders " +
        "geändert. Was hier auf dem Bildschirm steht, ist noch da.";
      $("conflict").classList.add("show");
      status("nicht gespeichert");
      return;
    }
    if (!response.ok) {
      let message = response.statusText;
      try { message = (await response.json()).error || message; } catch (e) {}
      throw new Error(message);
    }
    layoutVersion = response.headers.get("X-Layout-Version");
    // layout hier NICHT durch die Antwort ersetzen. Die Eingabefelder hängen
    // an genau diesen Objekten; ein frisches Geflecht vom Server würde ihre
    // Handler ins Leere zeigen lassen, und alles weitere Getippte ginge
    // verloren, bis das nächste render() die Felder neu aufbaut.
    const gespeichert = await response.json();

    // Nachprüfen statt vertrauen: steht in der Datei wirklich das, was auf
    // dem Bildschirm steht? Wenn nicht, lieber laut sagen als still verlieren.
    if (vergleichbar(gespeichert) !== vergleichbar(layout)) {
      $("conflictText").textContent =
        "Achtung: Die Datei enthält nicht das, was hier steht. Bitte den " +
        "Text prüfen und melden - das ist ein Fehler im Programm.";
      $("conflict").classList.add("show");
      status("NICHT richtig gespeichert");
      return;
    }

    unsaved = false;
    $("conflict").classList.remove("show");
    status("gespeichert");
  } catch (error) {
    status("Fehler beim Speichern: " + error.message);
  }
}

// Bewusst den Stand dieser Seite durchsetzen.
$("overwriteBtn").onclick = async () => {
  const response = await api("/api/layout");
  layoutVersion = response.headers.get("X-Layout-Version");
  await response.json();
  await save();
};
$("reloadBtn").onclick = () => load();

$("previewToggle").onchange = () => {
  vorschau = $("previewToggle").checked;
  render();
};

$("saveBtn").onclick = async () => {
  clearTimeout(saveTimer);
  await save();
};

// Wer das Fenster schließt, während noch etwas aussteht, soll das merken.
window.addEventListener("beforeunload", (event) => {
  if (!unsaved) return;
  event.preventDefault();
  event.returnValue = "";
});

function clearDragMarks() {
  document.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
}

// Vom Server eingesetzt, damit die Liste nur in build.py gepflegt wird.
const palette = __PALETTE__;

function emptySet(index) {
  return {
    name: "Set " + (index + 1),
    symbol: "",
    color: palette[index % palette.length],
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  };
}

// Die sichtbare Fläche der ScreenKeys ist nur 15,21 mm. Ob ein Piktogramm
// darauf erkennbar ist, sieht man erst in dieser Größe - und zwar so, wie das
// Display es zeigt: auf 116x116 verkleinert und auf RGB565 gerundet.
//
// Die große Kachel darüber bleibt bewusst das Quellbild. Sie ist zum
// Aussuchen da und soll scharf sein.
function echtgross(symbol, farbe) {
  const zeile = document.createElement("div");
  zeile.className = "echtgross";
  const bild = document.createElement("img");
  bild.src = "/api/preview?symbol=" + encodeURIComponent(symbol || "")
           + "&color=" + encodeURIComponent(farbe || "#000000");
  zeile.append(bild, document.createTextNode("so groß auf dem Gerät"));
  return zeile;
}

function thumb(symbol, onClick) {
  const box = document.createElement("div");
  box.className = "thumb";
  if (symbol) {
    const image = document.createElement("img");
    image.src = "/symbols/" + encodeURIComponent(symbol) + "?v=" + Date.now();
    image.onerror = () => { box.innerHTML = '<div class="empty">' + symbol + '<br>fehlt in symbols/</div>'; };
    box.appendChild(image);
  } else {
    box.innerHTML = '<div class="empty">kein Symbol</div>';
  }
  box.onclick = onClick;
  return box;
}

function render() {
  const tabs = $("tabs");
  tabs.innerHTML = "";
  layout.sets.forEach((entry, index) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (index === current ? " active" : "");
    tab.style.borderColor = index === current ? entry.color : "transparent";
    tab.innerHTML = '<span class="dot" style="background:' + entry.color + '"></span>';
    tab.append(entry.name || "Set " + (index + 1));
    tab.onclick = () => { current = index; render(); };

    // Sets umsortieren: die Reihenfolge bestimmt, wie die Set-Taste durchschaltet.
    tab.draggable = true;
    tab.ondragstart = (event) => {
      dragSet = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    };
    tab.ondragover = (event) => {
      if (dragSet === null || dragSet === index) return;
      event.preventDefault();
      tab.classList.add("dragover");
    };
    tab.ondragleave = () => tab.classList.remove("dragover");
    tab.ondrop = async (event) => {
      event.preventDefault();
      clearDragMarks();
      if (dragSet === null || dragSet === index) return;
      const moved = layout.sets.splice(dragSet, 1)[0];
      layout.sets.splice(index, 0, moved);
      current = index;
      dragSet = null;
      await save();
      render();
    };
    tab.ondragend = () => { dragSet = null; clearDragMarks(); };

    tabs.appendChild(tab);
  });
  if (layout.sets.length < 5) {
    const add = document.createElement("div");
    add.className = "tab add";
    add.textContent = "+ Set";
    add.onclick = async () => {
      layout.sets.push(emptySet(layout.sets.length));
      current = layout.sets.length - 1;
      await save();
      render();
    };
    tabs.appendChild(add);
  }

  const device = $("device");
  device.innerHTML = "";
  removeSetBtn.style.display = layout.sets.length ? "" : "none";
  const entry = layout.sets[current];
  if (!entry) {
    device.innerHTML = '<p style="color:var(--muted)">Noch keine Sets. Oben auf "+ Set" klicken.</p>';
    return;
  }
  const color = entry.color;

  // Set-Kachel links, danach die vier Sprechtasten im 2x2-Raster.
  const setCol = document.createElement("div");
  setCol.className = "setCol";
  const setTile = document.createElement("div");
  setTile.className = "tile setTile";
  setTile.style.borderColor = color;
  const setLabel = document.createElement("div");
  setLabel.className = "slotNr";
  setLabel.textContent = "SET-TASTE";
  setTile.appendChild(setLabel);
  setTile.appendChild(thumb(entry.symbol, () => openPicker({ kind: "set" }, entry.name)));

  if (vorschau) setTile.appendChild(echtgross(entry.symbol, color));

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = entry.name;
  nameInput.placeholder = "Name des Sets";
  nameInput.oninput = () => { entry.name = nameInput.value; saveSoon(); renderTabsOnly(); };
  setTile.appendChild(nameInput);

  const colorRow = document.createElement("div");
  colorRow.className = "colorRow";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = color;
  colorInput.title = "Farbe des Sets wählen";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.value = color;
  const applyColor = (value) => {
    entry.color = value.toUpperCase();
    saveSoon();
    render();
  };
  colorInput.oninput = () => applyColor(colorInput.value);
  hexInput.onchange = () => applyColor(hexInput.value);
  colorRow.append(colorInput, hexInput);
  setTile.appendChild(colorRow);

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  palette.forEach((hex) => {
    const feld = document.createElement("span");
    const aktiv = hex.toUpperCase() === (color || "").toUpperCase();
    feld.className = "swatch" + (aktiv ? " active" : "");
    feld.style.background = hex;
    feld.title = hex;
    feld.onclick = () => applyColor(hex);
    swatches.appendChild(feld);
  });
  // Direkt unter das Namensfeld: die Schnellauswahl ist der Normalfall,
  // der Farbwähler darunter die Ausnahme.
  setTile.insertBefore(swatches, colorRow);

  setCol.append(setTile, removeSetBtn);
  device.appendChild(setCol);

  entry.slots.forEach((slot, index) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.style.borderColor = color;

    const caption = document.createElement("div");
    caption.className = "slotNr";
    caption.textContent = "TASTE " + (index + 1);

    // Tasten tauschen: im festen 2x2-Raster ist Tauschen eindeutiger als
    // Einsortieren - die andere Taste rückt genau dorthin, wo diese herkam.
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "\u283F";
    grip.title = "Ziehen, um mit einer anderen Taste zu tauschen";
    grip.draggable = true;
    grip.ondragstart = (event) => {
      dragSlot = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      event.dataTransfer.setDragImage(tile, 40, 40);
    };
    grip.ondragend = () => { dragSlot = null; clearDragMarks(); };
    caption.appendChild(grip);
    tile.appendChild(caption);

    tile.ondragover = (event) => {
      if (dragSlot === null || dragSlot === index) return;
      event.preventDefault();
      tile.classList.add("dragover");
    };
    tile.ondragleave = () => tile.classList.remove("dragover");
    tile.ondrop = async (event) => {
      event.preventDefault();
      clearDragMarks();
      if (dragSlot === null || dragSlot === index) return;
      const slots = entry.slots;
      [slots[dragSlot], slots[index]] = [slots[index], slots[dragSlot]];
      dragSlot = null;
      await save();
      render();
    };

    tile.appendChild(thumb(slot.symbol, () => openPicker({ kind: "slot", index }, slot.text)));

    const row = document.createElement("div");
    row.className = "row";
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = slot.text;
    textInput.placeholder = "Was gesagt wird";
    textInput.oninput = () => { slot.text = textInput.value; saveSoon(); };
    const playBtn = document.createElement("button");
    playBtn.className = "play";
    playBtn.textContent = "▶";
    playBtn.title = "Vorhören";
    playBtn.onclick = () => speak(slot.text, playBtn);
    row.append(textInput, playBtn);
    tile.appendChild(row);

    if (vorschau) tile.appendChild(echtgross(slot.symbol, color));
    device.appendChild(tile);
  });
}

function renderTabsOnly() {
  layout.sets.forEach((entry, index) => {
    const tab = $("tabs").children[index];
    if (tab) { tab.lastChild.textContent = entry.name || "Set " + (index + 1); }
  });
}

async function speak(text, button) {
  if (!text.trim()) { status("Erst einen Text eintragen."); return; }
  const before = button.textContent;
  button.textContent = "···";
  try {
    const response = await api("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    status("");
  } catch (error) {
    status("Vorhören nicht möglich: " + error.message);
  } finally {
    button.textContent = before;
  }
}

function openPicker(target, seed) {
  pickTarget = target;
  $("q").value = (seed || "").trim();
  $("results").innerHTML = "";
  $("picker").showModal();
  $("q").focus();
  if ($("q").value) doSearch();
}

async function doSearch() {
  const word = $("q").value.trim();
  if (!word) return;
  $("results").innerHTML = '<p>sucht ...</p>';
  try {
    const items = await (await api("/api/search?q=" + encodeURIComponent(word))).json();
    if (!items.length) {
      $("results").innerHTML = '<p>Nichts gefunden zu „' + word + '“.</p>';
      return;
    }
    $("results").innerHTML = "";
    items.forEach((item) => {
      const figure = document.createElement("figure");
      figure.innerHTML =
        '<img src="' + item.url + '" alt="" loading="lazy">' +
        '<figcaption>' + (item.label || item.id) + '</figcaption>';
      figure.onclick = () => pick(item);
      $("results").appendChild(figure);
    });
  } catch (error) {
    $("results").innerHTML = '<p>' + error.message + '</p>';
  }
}

// Trägt ein fertiges Symbol dort ein, wo der Dialog geöffnet wurde.
async function applySymbol(filename) {
  const entry = layout.sets[current];
  if (pickTarget.kind === "set") entry.symbol = filename;
  else entry.slots[pickTarget.index].symbol = filename;
  await save();
  $("picker").close();
  render();
}

async function pick(item) {
  status("lädt Symbol ...");
  try {
    const result = await (await api("/api/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, label: item.label || $("q").value }),
    })).json();
    await applySymbol(result.symbol);
    status("");
  } catch (error) {
    status("Symbol konnte nicht geladen werden: " + error.message);
  }
}

// Eigenes Bild: die Datei geht roh an den Server, der Name steht im
// Query-String. So braucht es kein Multipart-Formular.
$("uploadBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = async () => {
  const file = $("fileInput").files[0];
  $("fileInput").value = "";
  if (!file) return;
  status("lädt Bild hoch ...");
  try {
    const result = await (await api(
      "/api/upload?name=" + encodeURIComponent(file.name),
      { method: "POST", body: file }
    )).json();
    await applySymbol(result.symbol);
    status("Bild übernommen");
  } catch (error) {
    status("Upload fehlgeschlagen: " + error.message);
  }
};

$("searchBtn").onclick = doSearch;
$("q").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); doSearch(); } };
$("closeBtn").onclick = () => $("picker").close();

removeSetBtn.onclick = async () => {
  if (!layout.sets.length) return;
  if (!confirm("Set \"" + (layout.sets[current].name || "") + "\" wirklich löschen?")) return;
  layout.sets.splice(current, 1);
  current = Math.max(0, current - 1);
  await save();
  render();
};

$("buildBtn").onclick = async () => {
  await save();
  $("buildBtn").disabled = true;
  status("baut ...");
  $("log").style.display = "block";
  $("log").textContent = "läuft ...";
  try {
    const result = await (await api("/api/build", { method: "POST" })).json();
    $("log").textContent = result.log.join("\n");
    status("fertig gebaut");
  } catch (error) {
    $("log").textContent = "Fehler: " + error.message;
    status("Bauen fehlgeschlagen");
  } finally {
    $("buildBtn").disabled = false;
  }
};

load().catch((error) => status("Laden fehlgeschlagen: " + error.message));
</script>
</body>
</html>
"""


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def eigene_adressen() -> list[str]:
    """IP-Adressen, unter denen dieser Rechner im Netz erreichbar ist."""
    import socket
    adressen = set()
    try:
        # Kein Verbindungsaufbau - der Kernel verrät nur, über welche
        # Schnittstelle er hinauswollte.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            adressen.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(adressen)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="mitreden: Weboberfläche")
    parser.add_argument(
        "--host",
        default=HOST,
        help='Voreinstellung 127.0.0.1 (nur dieser Rechner). Für Zugriff vom '
             'Handy im selben WLAN: --host 0.0.0.0',
    )
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    build.ensure_content()
    server = Server((args.host, args.port), Handler)
    if args.host in ("0.0.0.0", "::"):
        print(f"mitreden läuft auf Port {args.port}", flush=True)
        if Path("/.dockerenv").exists():
            # Im Container wäre die eigene Adresse die des Docker-Netzes und
            # damit von außen nutzlos.
            print("  Im Container: die Adresse des NAS mit dem freigegebenen "
                  "Port verwenden.", flush=True)
        else:
            print(f"  http://localhost:{args.port}", flush=True)
            for adresse in eigene_adressen():
                print(f"  http://{adresse}:{args.port}   <- diese im Handy eingeben",
                      flush=True)
        print("Achtung: Es gibt keine Anmeldung - wer den Port erreicht, kann "
              "die Inhalte ändern.", flush=True)
    else:
        print(f"mitreden läuft auf http://{args.host}:{args.port}", flush=True)
    print("(Strg+C beendet)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbeendet.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
