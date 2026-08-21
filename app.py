#!/usr/bin/env python3
"""Web interface for vorlaut - runs on http://localhost:8771

Deliberately without a framework: the Python standard library only. The page
looks like the device - tabs for the sets on top, below them the four speech
keys in a 2x2 grid with the set tile next to them.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import os
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
import metacom
import tts

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
SYMBOLS_DIR = build.SYMBOLS_DIR
THUMB_CACHE = build.CONTENT / "cache" / "thumbs"
PORT = 8771
HOST = "127.0.0.1"   # default: this machine only
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB is plenty for any symbol

ARASAAC_SEARCH = "https://api.arasaac.org/api/pictograms/de/search/"
ARASAAC_IMAGE = "https://api.arasaac.org/api/pictograms/"
ARASAAC_RESOLUTION = 500  # the API allows only 500 or 2500
# House size for everything in symbols/. The device renders 116x116 pixels;
# 500 leaves plenty of room and keeps the repo small.
SYMBOL_MAX_PX = 500
# Per source, not in total - otherwise one crowds out the other.
SEARCH_LIMIT = 40


# --- Hilfsfunktionen ---------------------------------------------------------

def device_token() -> str:
    """Key for the device endpoints: environment first, then .env.

    Without a key the endpoints stay shut. Deliberately that way round: what
    lies behind them are the recordings and pictures of your child, and a sync
    nobody set up should not hand anything out either.
    """
    value = (os.environ.get("VORLAUT_DEVICE_TOKEN") or "").strip()
    if value:
        return value
    try:
        return (tts.load_env_file().get("VORLAUT_DEVICE_TOKEN") or "").strip()
    except Exception:
        return ""


def build_current_flag() -> str:
    """"1" when data/ matches the current layout - otherwise "0".

    The interface shows from this whether a build is due. A failure here must
    not disturb loading and saving, so when in doubt it answers "0".
    """
    try:
        return "1" if build.build_is_current() else "0"
    except Exception:
        return "0"


def layout_version() -> str:
    """Identifier of the current file state, so that a stale tab does not
    silently overwrite someone else's work."""
    if not build.LAYOUT_FILE.exists():
        return "empty"
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
    request = urllib.request.Request(url, headers={"User-Agent": "vorlaut"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # ARASAAC answers a word without hits with 404 and an empty list.
        # That is not an error, just no result.
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
                "source": "arasaac",
                "id": pictogram_id,
                "label": label,
                # through our own server, so the page does not have to make
                # requests to the outside
                "url": f"/api/thumb?id={pictogram_id}",
            }
        )
    return results


def preview_png(symbol: str, color: str) -> bytes:
    """What the display will really show, as a PNG.

    Not the source image: this contains the scaling down to 116x116, the
    quantisation to RGB565 and the border the firmware draws. On 15.21 mm of
    visible area that makes a difference.
    """
    Image, _ = build._require_pillow()
    raw = build.tile_bytes(symbol)          # 116x116, RGB565 big-endian
    kante = build.TILE_SIZE
    innen = Image.new("RGB", (kante, kante))
    px = innen.load()
    for i in range(kante * kante):
        value = (raw[i * 2] << 8) | raw[i * 2 + 1]
        r = (value >> 11) << 3
        g = ((value >> 5) & 0x3F) << 2
        b = (value & 0x1F) << 3
        # Pad the low bits the way a panel does
        px[i % kante, i // kante] = (r | r >> 5, g | g >> 6, b | b >> 5)

    tile = Image.new("RGB", (build.IMG_SIZE, build.IMG_SIZE),
                       build.hex_to_rgb(color))
    tile.paste(innen, (build.BORDER, build.BORDER))
    buffer = io.BytesIO()
    tile.save(buffer, "PNG")
    return buffer.getvalue()


def save_upload(data: bytes, original_name: str) -> str:
    """Nimmt ein hochgeladenes Bild an und legt es als PNG in symbols/ ab."""
    Image, _ = build._require_pillow()
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            picture = opened.convert("RGBA")
    except Exception as exc:  # Pillow wirft je nach Format Verschiedenes
        raise ValueError("Das ist kein lesbares Bild.") from exc

    # Crop to square, centred. The tile is square - without this a white bar
    # would remain on two sides and the picture would be smaller than needed.
    # Crop first, then scale down: that costs less sharpness than the other
    # way round.
    if picture.width != picture.height:
        seite = min(picture.size)
        links = (picture.width - seite) // 2
        oben = (picture.height - seite) // 2
        picture = picture.crop((links, oben, links + seite, oben + seite))

    # Phone photos arrive with several thousand pixels. Scale down right on
    # acceptance, so no huge image ever lands in symbols/.
    if max(picture.size) > SYMBOL_MAX_PX:
        picture.thumbnail((SYMBOL_MAX_PX, SYMBOL_MAX_PX), Image.LANCZOS)

    stem = slugify(Path(original_name).stem)
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    # Do not overwrite existing symbols, number them instead.
    filename = f"{stem}.png"
    counter = 2
    while (SYMBOLS_DIR / filename).exists():
        filename = f"{stem}-{counter}.png"
        counter += 1
    picture.save(SYMBOLS_DIR / filename, "PNG", optimize=True)
    return filename


def arasaac_fetch(pictogram_id: int) -> bytes:
    """Fetches a pictogram as PNG and puts it into the cache.

    The API allows the resolutions 500 and 2500 only; we take 500 both for the
    preview in search and for the file in symbols/.
    """
    identifier = int(pictogram_id)
    THUMB_CACHE.mkdir(parents=True, exist_ok=True)
    cached = THUMB_CACHE / f"{identifier}.png"
    if cached.exists():
        return cached.read_bytes()
    url = f"{ARASAAC_IMAGE}{identifier}?resolution={ARASAAC_RESOLUTION}"
    request = urllib.request.Request(url, headers={"User-Agent": "vorlaut"})
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
    server_version = "vorlaut"

    def log_message(self, fmt, *args):  # ruhiger Log
        if self.path.startswith("/api/"):
            print(f"  {self.command} {self.path}", flush=True)

    # -- Device sync --

    def _device_allowed(self) -> bool:
        """Schlüssel prüfen. Antwortet selbst, wenn etwas nicht stimmt."""
        token = device_token()
        if not token:
            self._error(
                "Der Geräte-Abgleich ist nicht eingerichtet - "
                "VORLAUT_DEVICE_TOKEN fehlt.", 503)
            return False
        # Nur als Kopfzeile, nie im Adressteil: Adressen landen in
        # logs, headers do not.
        sent = self.headers.get("X-Vorlaut-Token", "")
        # compare_digest instead of ==, so the response time gives nothing away.
        if not hmac.compare_digest(sent, token):
            self._error("Falscher oder fehlender Schlüssel.", 401)
            return False
        return True

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
            page = (PAGE
                    .replace("__PALETTE__", json.dumps(build.DEFAULT_PALETTE))
                    .replace("__LIMITS__", json.dumps({
                        "maxSets": build.MAX_SETS,
                        "maxActive": build.MAX_ACTIVE_SETS,
                    })))
            self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/api/layout":
            try:
                self._json(
                    build.load_layout(),
                    extra={
                        "X-Layout-Version": layout_version(),
                        "X-Build-Current": build_current_flag(),
                    },
                )
            except build.BuildError as exc:
                self._error(str(exc), 500)
            return

        if path == "/api/search":
            word = (query.get("q") or [""])[0].strip()
            # Without a value, both sources. The interface asks for them
            # separately so the licensed collection is there at once instead of
            # Antwort aus dem Netz wartet.
            source = (query.get("source") or [""])[0].strip()
            if not word:
                self._json([])
                return

            results: list[dict] = []
            if source in ("", "metacom"):
                results.extend(metacom.search(word, limit=SEARCH_LIMIT))
            if source in ("", "arasaac"):
                try:
                    results.extend(arasaac_search(word)[:SEARCH_LIMIT])
                except (urllib.error.URLError, json.JSONDecodeError,
                        TimeoutError) as exc:
                    # Hits from one's own collection are worth more than an
                    # error message - that comes only when nothing else is there.
                    if not results:
                        self._error(f"ARASAAC nicht erreichbar: {exc}", 502)
                        return
            self._json(results)
            return

        if path == "/api/device/manifest":
            if not self._device_allowed():
                return
            try:
                self._json(build.device_manifest())
            except build.BuildError as exc:
                self._error(str(exc), 500)
            return

        if path == "/api/device/file":
            if not self._device_allowed():
                return
            # The file name only, nothing before it - the request comes from outside.
            name = Path((query.get("name") or [""])[0]).name
            target = build.DATA_DIR / name
            if not name or not target.is_file():
                self._error("Datei nicht gefunden.", 404)
                return
            self._send(200, target.read_bytes(), "application/octet-stream")
            return

        if path == "/api/sources":
            self._json({
                "metacom": metacom.available(),
                "metacomKeywords": metacom.has_keywords(),
                "metacomCount": metacom.count(),
            })
            return

        if path in ("/icon.svg", "/icon-192.png", "/icon-512.png"):
            file = ASSETS / Path(path).name
            if not file.exists():
                self._error("Symbol nicht gefunden.", 404)
                return
            art = "image/svg+xml" if path.endswith(".svg") else "image/png"
            self._send(200, file.read_bytes(), art)
            return

        if path == "/manifest.webmanifest":
            # So the page can be placed on the home screen as an app.
            # Deliberately without a service worker: the interface is useless
            # without the server anyway, and cached JavaScript has caused
            # enough trouble already.
            self._json({
                "name": "vorlaut",
                "short_name": "vorlaut",
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
            colour = (query.get("color") or ["#000000"])[0]
            try:
                self._send(200, preview_png(symbol, colour), "image/png")
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
            # The reference can be "bild.png" or "metacom:name" - which file
            # is meant is decided by build.symbol_path.
            reference = urllib.parse.unquote(path[len("/symbols/"):])
            target = build.symbol_path(reference)
            if target is None:
                self._error("Symbol nicht gefunden.", 404)
                return
            self._send(200, target.read_bytes(), "image/png")
            return

        self._error("Nicht gefunden.", 404)

    def do_POST(self):
        route = urllib.parse.urlparse(self.path)
        path = route.path

        # The upload sends raw image data, not JSON - so it leaves early.
        if path == "/api/upload":
            self._upload(urllib.parse.parse_qs(route.query))
            return

        try:
            body = self._body()
        except json.JSONDecodeError:
            self._error("Ungültiges JSON.")
            return

        if path == "/api/layout":
            sent = self.headers.get("X-Layout-Version")
            current = layout_version()
            if sent and sent != current:
                # This page knows an older state. Do not overwrite.
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
            self._json(saved, extra={
                "X-Layout-Version": layout_version(),
                "X-Build-Current": build_current_flag(),
            })
            return

        if path == "/api/pick":
            # METACOM symbols are neither downloaded nor copied: they stay in
            # the licensed collection, the layout only holds the reference.
            if (body.get("source") or "") == "metacom":
                reference = str(body.get("ref") or "")
                if build.symbol_path(reference) is None:
                    self._error("Dieses METACOM-Symbol gibt es nicht.", 404)
                    return
                name = reference[len(build.METACOM_PREFIX):]
                self._json({"symbol": reference, "label": metacom.label_for(name)})
                return
            label = body.get("label") or "symbol"
            try:
                filename = arasaac_download(body.get("id"), label)
            except (urllib.error.URLError, ValueError, TypeError, TimeoutError) as exc:
                self._error(f"Download fehlgeschlagen: {exc}", 502)
                return
            self._json({"symbol": filename, "label": label})
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
<title>vorlaut</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#16181d">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="vorlaut">
<style>
  :root {
    --bg: #16181d;
    --panel: #1f2229;
    --panel-2: #262a33;
    --line: #343a45;
    --text: #eceff4;
    --muted: #9aa3b2;
    --accent: #9B7BFF;   /* the purple from the icon */
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
  /* Set slightly narrower so that "#4A90D9" fits in completely. */
  .colorRow input[type=text] {
    flex: 1 1 auto; padding: 8px 6px; font-family: ui-monospace, monospace;
    font-size: 13px;
  }
  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 14px;
  }
  button:hover { background: #303540; }
  /* Dark type on the purple: 5.5:1 instead of 3.2:1 with white. */
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
  /* Toggle switch. HTML has no such thing - Safari 17.4 renders
     <input type="checkbox" switch> natively that way, elsewhere there is only
     the box. So it is built from the box: that stays underneath, and with it
     keyboard operation and screen readers. */
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
  /* Original size: 15.21 mm are visible on the device. Roughly life-size on
     screen, so one can judge whether a symbol is recognisable on it at all. */
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
  /* Left column: set tile with the delete button below it. */
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

  /* Three columns do not fit on a phone - then the set tile across the full
     width and the four speech keys as a 2x2 below it. The spatial
     correspondence is preserved that way. */
  @media (max-width: 620px) {
    /* Side by side the header needs 493px - on a 375px wide display
       "Speichern" and "Bauen" fell outside, with no way to scroll
       scrollen liess. Also umbrechen statt stauchen:
       Row 1  logo, name, the two buttons on the right
       Row 2  device preview, status text on the right */
    header { flex-wrap: wrap; gap: 10px; padding: 10px 14px; }
    header h1 { margin-right: auto; }
    .schalter { order: 1; }
    header .status { order: 2; margin-left: auto; }

    /* With 20 sets, wrapping tabs eat half the display before any content
       appears. On a phone therefore a single row to swipe. */
    .tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin;
      margin-bottom: 8px; }
    .tabs .tab { flex: none; }

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
  /* The buttons keep their width, the search field yields - otherwise the
     labels wrap and get cut off. */
  .dlgHead button { flex: none; white-space: nowrap; }
  .dlgHead input[type=text] { flex: 1 1 auto; width: auto; min-width: 4rem; }
  .results {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px; padding: 16px; max-height: 60vh; overflow: auto;
  }
  /* Messages are not results - they should not be squeezed into a 96px
     column. */
  .results p { grid-column: 1 / -1; margin: 4px 2px; color: var(--muted); }
  .results figure { margin: 0; cursor: pointer; text-align: center; }
  .results img {
    width: 100%; aspect-ratio: 1/1; object-fit: contain; background: #fff;
    border-radius: 8px; padding: 4px; border: 2px solid transparent;
  }
  .results figure:hover img { border-color: var(--accent); }
  .results figcaption { font-size: 11px; color: var(--muted); margin-top: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Separates the sources: the licensed collection on top, ARASAAC below. */
  .results .group { grid-column: 1 / -1; margin: 10px 2px 0; font-size: 11px;
    letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
    border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  .results .group:first-child { margin-top: 0; }
  /* Inactive sets stay visible but recede - one should be able to read off
     Leiste ablesen koennen, was gerade aufs Geraet geht. */
  .tab.off { opacity: .45; }
  .tab.off .dot { box-shadow: inset 0 0 0 2px var(--panel); }
  .slots { color: var(--muted); font-size: 12px; margin: -8px 2px 14px; }
  /* No active set is allowed - the device catches it and shows a notice.
     It is rarely intended though, hence the same warning colour as for the
     save conflict, only as a narrow field instead of a banner. */
  .slots.empty {
    color: #f0d7d9; background: #3a2224; border: 1px solid #7a3a3f;
    border-radius: 8px; padding: 6px 10px; display: inline-block;
  }
  .schalter.onDevice { font-size: 13px; }
  /* Set apart from the rest of the tile: above it says how the set looks,
     here it says whether it goes onto the device. */
  .activeRow {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line);
  }
  .activeRow .note { color: var(--muted); font-size: 12px; }
  .hint { padding: 0 16px 16px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <img src="/icon.svg" alt="" class="logo">
  <h1>vorlaut</h1>
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
  <div class="slots" id="slots"></div>
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
  <div class="hint" id="quellen">Piktogramme: ARASAAC, Urheber Sergio Palao, Lizenz CC BY-NC-SA.</div>
</dialog>

<script>
let layout = { sleep_timeout_seconds: 600, sets: [] };
let current = 0;
let pickTarget = null;      // {kind: "set"} oder {kind: "slot", index: n}
let sources = { metacom: false };
let searchToken = 0;        // so a slow answer cannot overtake a newer one
let dragSet = null;         // index of the dragged set
let dragSlot = null;        // index of the dragged key
let saveTimer = null;
let layoutVersion = null;   // Stand, den diese Seite geladen hat
let unsaved = false;        // there are changes not yet in the file
let preview = false;       // show tiles the way the display shows them

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
  markBuildState(response.headers.get("X-Build-Current"));
  layout = await response.json();
  if (current >= layout.sets.length) current = Math.max(0, layout.sets.length - 1);
  $("conflict").classList.remove("show");
  unsaved = false;
  status("");
  render();
}

// One second after the last keystroke. Shorter gains nothing - it does not
// feel faster but produces markedly more writes.
// The build button says for itself whether it is due: highlighted while
// data/ does not match the layout, subdued otherwise. That way nobody has to
// remember when a build is needed.
function markBuildState(flag) {
  if (flag === null || flag === undefined) return;
  const needed = flag !== "1";
  const button = $("buildBtn");
  button.classList.toggle("primary", needed);
  button.title = needed
    ? "Das Gerät bekommt erst durch Bauen und Aufspielen den neuen Stand"
    : "Die Dateien in data/ entsprechen dem Layout";
}

function saveSoon() {
  clearTimeout(saveTimer);
  unsaved = true;
  status("noch nicht gespeichert");
  saveTimer = setTimeout(save, 1000);
}

// Brings layout into the same shape the server makes of it. Only then can
// the two states be compared meaningfully.
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

// Process saves one after another. Two at once would reject each other via
// the state check - and the caller could no longer wait for the write to have
// actually happened.
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
  markBuildState(response.headers.get("X-Build-Current"));
    // Do NOT replace layout with the answer here. The input fields hang off
    // exactly these objects; a fresh graph from the server would leave their
    // handlers pointing at nothing, and everything typed afterwards would be
    // lost until the next render() rebuilds the fields.
    const gespeichert = await response.json();

    // Verify instead of trust: does the file really hold what is on screen?
    // If not, better to say so loudly than to lose it quietly.
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
  markBuildState(response.headers.get("X-Build-Current"));
  await response.json();
  await save();
};
$("reloadBtn").onclick = () => load();

$("previewToggle").onchange = () => {
  preview = $("previewToggle").checked;
  render();
};

$("saveBtn").onclick = async () => {
  clearTimeout(saveTimer);
  await save();
};

// Whoever closes the window while something is outstanding should notice.
window.addEventListener("beforeunload", (event) => {
  if (!unsaved) return;
  event.preventDefault();
  event.returnValue = "";
});

function clearDragMarks() {
  document.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
}

// Injected by the server, so the list is maintained in build.py only.
const palette = __PALETTE__;
const limits = __LIMITS__;

function activeCount() {
  return layout.sets.filter((s) => s.active !== false).length;
}

function emptySet(index, active) {
  return {
    name: "Set " + (index + 1),
    active: !!active,
    symbol: "",
    color: palette[index % palette.length],
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  };
}

// The visible area of the ScreenKeys is only 15.21 mm. Whether a pictogram
// is recognisable on it shows only at this size - and shown the way the
// display shows it: scaled to 116x116 and rounded to RGB565.
//
// The large tile above deliberately stays the source image. It is there for
// picking and should be sharp.
function echtgross(symbol, colour) {
  const line = document.createElement("div");
  line.className = "echtgross";
  const bild = document.createElement("img");
  bild.src = "/api/preview?symbol=" + encodeURIComponent(symbol || "")
           + "&color=" + encodeURIComponent(colour || "#000000");
  line.append(bild, document.createTextNode("so groß auf dem Gerät"));
  return line;
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
    tab.className = "tab" + (index === current ? " active" : "")
                  + (entry.active === false ? " off" : "");
    tab.title = entry.active === false ? "Nicht auf dem Gerät" : "Geht aufs Gerät";
    tab.style.borderColor = index === current ? entry.color : "transparent";
    tab.innerHTML = '<span class="dot" style="background:' + entry.color + '"></span>';
    tab.append(entry.name || "Set " + (index + 1));
    tab.onclick = () => { current = index; render(); };

    // Reorder sets: the order determines how the set key cycles through.
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
  if (layout.sets.length < limits.maxSets) {
    const add = document.createElement("div");
    add.className = "tab add";
    add.textContent = "+ Set";
    add.onclick = async () => {
      // A new set is active straight away only when a slot is still free -
      // otherwise the layout could not be saved at all.
      layout.sets.push(emptySet(layout.sets.length, activeCount() < limits.maxActive));
      current = layout.sets.length - 1;
      await save();
      render();
    };
    tabs.appendChild(add);
  }

  const used = activeCount();
  $("slots").classList.toggle("empty", used === 0 && layout.sets.length > 0);
  $("slots").textContent = used === 0 && layout.sets.length > 0
    ? "Kein Set aktiv - das Gerät zeigt dann nur einen Hinweis an. "
      + layout.sets.length + " Sets liegen bereit."
    : used + " von " + limits.maxActive + " Plätzen auf dem Gerät belegt"
      + (layout.sets.length > used
         ? "  ·  " + layout.sets.length + " Sets angelegt" : "");

  const device = $("device");
  device.innerHTML = "";
  removeSetBtn.style.display = layout.sets.length ? "" : "none";
  const entry = layout.sets[current];
  if (!entry) {
    device.innerHTML = '<p style="color:var(--muted)">Noch keine Sets. Oben auf "+ Set" klicken.</p>';
    return;
  }
  const color = entry.color;

  // Set tile on the left, then the four speech keys in a 2x2 grid.
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

  if (preview) setTile.appendChild(echtgross(entry.symbol, color));

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = entry.name;
  nameInput.placeholder = "Name des Sets";
  nameInput.oninput = () => { entry.name = nameInput.value; saveSoon(); renderTabsOnly(); };
  setTile.appendChild(nameInput);

  // Only five sets fit onto the device - creating more is allowed. The
  // entscheidet, welche davon gerade mitkommen.
  const activeToggle = document.createElement("label");
  activeToggle.className = "schalter onDevice";
  // Short, because "Gerätevorschau" already sits next to it - twice "Gerät"
  // in one view reads like the same thing. The title says what it means.
  activeToggle.title = "Aktive Sets gehen aufs Gerät - höchstens "
                   + limits.maxActive + " gleichzeitig";
  const activeBox = document.createElement("input");
  activeBox.type = "checkbox";
  activeBox.checked = entry.active !== false;
  const activePill = document.createElement("span");
  activePill.className = "pille";
  activeToggle.append(activeBox, activePill, document.createTextNode("Aktiv"));
  activeBox.onchange = async () => {
    if (activeBox.checked && activeCount() >= limits.maxActive) {
      activeBox.checked = false;
      status("Es sind schon " + limits.maxActive + " Sets aktiv - erst eins abschalten.");
      return;
    }
    entry.active = activeBox.checked;
    await save();
    status("");
    render();
  };

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
  // Directly below the name field: the quick picks are the normal case, the
  // colour picker below them the exception.
  setTile.insertBefore(swatches, colorRow);

  // At the very bottom and set apart: name and colour describe the set,
  // "Aktiv" decides what happens to it - the same corner as the delete button
  // below. Deliberately not in its red: switching off is reversible.
  const activeRow = document.createElement("div");
  activeRow.className = "activeRow";
  activeRow.appendChild(activeToggle);
  if (entry.active === false) {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = "liegt bereit, nicht auf dem Gerät";
    activeRow.appendChild(note);
  }
  setTile.appendChild(activeRow);

  setCol.append(setTile, removeSetBtn);
  device.appendChild(setCol);

  entry.slots.forEach((slot, index) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.style.borderColor = color;

    const caption = document.createElement("div");
    caption.className = "slotNr";
    caption.textContent = "TASTE " + (index + 1);

    // Swap keys: in the fixed 2x2 grid swapping is less ambiguous than
    // inserting - the other key moves exactly where this one came from.
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

    if (preview) tile.appendChild(echtgross(slot.symbol, color));
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

async function ask(word, source) {
  const url = "/api/search?source=" + source + "&q=" + encodeURIComponent(word);
  return await (await api(url)).json();
}

function say(box, text) {
  box.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = text;
  box.appendChild(note);
}

async function doSearch() {
  const word = $("q").value.trim();
  if (!word) return;
  const box = $("results");
  const mine = ++searchToken;
  say(box, "sucht ...");

  let cleared = false;
  let total = 0;
  const show = (title, items) => {
    if (!cleared) { box.innerHTML = ""; cleared = true; }
    if (!items.length) return;
    const head = document.createElement("div");
    head.className = "group";
    head.textContent = title;
    box.appendChild(head);
    items.forEach((item) => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = item.url;
      image.loading = "lazy";
      image.alt = "";
      const caption = document.createElement("figcaption");
      // textContent instead of innerHTML: the caption comes from a foreign
      // data source and is not markup.
      caption.textContent = item.label || item.id;
      figure.append(image, caption);
      figure.onclick = () => pick(item);
      box.appendChild(figure);
    });
    total += items.length;
  };

  try {
    // The licensed collection sits locally and is there at once. ARASAAC
    // goes over the network and comes afterwards - that way something is
    // already on screen while the second source is still answering.
    if (sources.metacom) {
      const hits = await ask(word, "metacom");
      if (mine !== searchToken) return;
      show("METACOM", hits);
    }
    const remote = await ask(word, "arasaac");
    if (mine !== searchToken) return;
    show("ARASAAC", remote);
    if (!total) say(box, "Nichts gefunden zu „" + word + "“.");
  } catch (error) {
    if (mine !== searchToken) return;
    if (total) {
      const note = document.createElement("p");
      note.textContent = "ARASAAC nicht erreichbar - nur METACOM-Treffer.";
      box.appendChild(note);
    } else {
      say(box, error.message);
    }
  }
}

// Enters a finished symbol where the dialog was opened.
// label is the word for the symbol, if the source supplies one.
async function applySymbol(filename, label) {
  const entry = layout.sets[current];
  const word = (label || "").trim();
  if (pickTarget.kind === "set") {
    entry.symbol = filename;
    // Only prefill an empty field, never overwrite anything: the symbol is
    // called "zustimmen", but your key should say "Ja!".
    if (word && !entry.name.trim()) entry.name = word;
  } else {
    const slot = entry.slots[pickTarget.index];
    slot.symbol = filename;
    if (word && !slot.text.trim()) slot.text = word;
  }
  await save();
  $("picker").close();
  render();
}

async function pick(item) {
  status(item.source === "metacom" ? "übernimmt Symbol ..." : "lädt Symbol ...");
  try {
    const result = await (await api("/api/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: item.source,
        id: item.id,
        ref: item.ref,
        label: item.label || $("q").value,
      }),
    })).json();
    await applySymbol(result.symbol, result.label);
    status("");
  } catch (error) {
    status("Symbol konnte nicht geladen werden: " + error.message);
  }
}

// Own picture: the file goes to the server raw, the name sits in the query
// string. That way no multipart form is needed.
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
    markBuildState("1");
    status("fertig gebaut");
  } catch (error) {
    $("log").textContent = "Fehler: " + error.message;
    status("Bauen fehlgeschlagen");
  } finally {
    $("buildBtn").disabled = false;
  }
};

// Which symbol sources exist is fixed at start - asking once is enough.
// If that fails, it stays with ARASAAC alone.
async function loadSources() {
  try {
    sources = await (await api("/api/sources")).json();
  } catch (error) {
    sources = { metacom: false };
  }
  $("q").placeholder = sources.metacom
    ? "METACOM und ARASAAC durchsuchen, z.B. trinken"
    : "ARASAAC durchsuchen, z.B. trinken";
  if (sources.metacom) {
    $("quellen").textContent =
      "Symbole: METACOM 9 (Annette Kitzinger), lizenziert für diesen Rechner - "
      + "sie werden nur verwiesen, nicht ins Projekt kopiert. "
      + "Piktogramme: ARASAAC, Urheber Sergio Palao, Lizenz CC BY-NC-SA.";
  }
}

loadSources();
load().catch((error) => status("Laden fehlgeschlagen: " + error.message));
</script>
</body>
</html>
"""


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def local_addresses() -> list[str]:
    """IP-Adressen, unter denen dieser Rechner im Netz erreichbar ist."""
    import socket
    adressen = set()
    try:
        # No connection is made - the kernel only reveals which
        # Schnittstelle er hinauswollte.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            adressen.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(adressen)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="vorlaut: Weboberfläche")
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
        print(f"vorlaut läuft auf Port {args.port}", flush=True)
        if Path("/.dockerenv").exists():
            # Inside a container our own address would be the Docker
            # network's and therefore useless from outside.
            print("  Im Container: die Adresse des NAS mit dem freigegebenen "
                  "Port verwenden.", flush=True)
        else:
            print(f"  http://localhost:{args.port}", flush=True)
            for adresse in local_addresses():
                print(f"  http://{adresse}:{args.port}   <- diese im Handy eingeben",
                      flush=True)
        print("Achtung: Es gibt keine Anmeldung - wer den Port erreicht, kann "
              "die Inhalte ändern.", flush=True)
    else:
        print(f"vorlaut läuft auf http://{args.host}:{args.port}", flush=True)
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
