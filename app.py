#!/usr/bin/env python3
"""Weboberflaeche fuer mitreden - laeuft auf http://localhost:8771

Bewusst ohne Framework: nur die Python-Standardbibliothek. Die Seite sieht aus
wie das Geraet - oben die Reiter fuer die Sets, darunter die vier Sprechtasten
im 2x2-Raster und daneben die Set-Kachel.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build
import tts

ROOT = Path(__file__).resolve().parent
SYMBOLS_DIR = ROOT / "symbols"
THUMB_CACHE = ROOT / "cache" / "thumbs"
PORT = 8771
HOST = "127.0.0.1"
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB reichen fuer jedes Symbol

ARASAAC_SEARCH = "https://api.arasaac.org/api/pictograms/de/search/"
ARASAAC_IMAGE = "https://api.arasaac.org/api/pictograms/"
ARASAAC_RESOLUTION = 500


# --- Hilfsfunktionen ---------------------------------------------------------

def layout_version() -> str:
    """Kennung des aktuellen Dateistands, damit ein veralteter Tab nicht
    stillschweigend die Arbeit eines anderen ueberschreibt."""
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
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
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
                # ueber den eigenen Server, damit die Seite keine Anfragen
                # nach draussen stellen muss
                "url": f"/api/thumb?id={pictogram_id}",
            }
        )
    return results


def save_upload(data: bytes, original_name: str) -> str:
    """Nimmt ein hochgeladenes Bild an und legt es als PNG in symbols/ ab."""
    Image, _ = build._require_pillow()
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            picture = opened.convert("RGBA")
    except Exception as exc:  # Pillow wirft je nach Format Verschiedenes
        raise ValueError("Das ist kein lesbares Bild.") from exc

    stem = slugify(Path(original_name).stem)
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    # Vorhandene Symbole nicht ueberschreiben, sondern durchnummerieren.
    filename = f"{stem}.png"
    counter = 2
    while (SYMBOLS_DIR / filename).exists():
        filename = f"{stem}-{counter}.png"
        counter += 1
    picture.save(SYMBOLS_DIR / filename, "PNG")
    return filename


def arasaac_fetch(pictogram_id: int) -> bytes:
    """Holt ein Piktogramm als PNG und legt es im Cache ab.

    Die API erlaubt nur die Aufloesungen 500 und 2500; wir nehmen 500 sowohl
    fuer die Vorschau in der Suche als auch fuer die Datei in symbols/.
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
            self._error(f"Das Bild ist zu gross (hoechstens {MAX_UPLOAD // 1048576} MB).")
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
            self._error("Ungueltiges JSON.")
            return

        if path == "/api/layout":
            gesendet = self.headers.get("X-Layout-Version")
            aktuell = layout_version()
            if gesendet and gesendet != aktuell:
                # Diese Seite kennt einen aelteren Stand. Nicht ueberschreiben.
                self._json(
                    {
                        "error": "Diese Seite hat einen veralteten Stand - "
                                 "layout.json wurde zwischenzeitlich woanders "
                                 "geaendert.",
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mitreden</title>
<style>
  :root {
    --bg: #16181d;
    --panel: #1f2229;
    --panel-2: #262a33;
    --line: #343a45;
    --text: #eceff4;
    --muted: #9aa3b2;
    --accent: #4A90D9;
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
  /* Das Set-Symbol darf etwas kleiner sein als die Sprechtasten - es ist
     eine Beschriftung, keine Taste, die sie treffen muss. */
  .setTile .thumb { width: 82%; align-self: center; }
  .thumb {
    aspect-ratio: 1/1; flex: 0 0 auto; background: #fff; border-radius: 8px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    position: relative;
  }
  .thumb img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
  .thumb .empty { color: #b9bfc9; font-size: 13px; text-align: center; padding: 8px; }
  .thumb:hover::after {
    content: "Symbol waehlen"; position: absolute; inset: auto 0 0 0;
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
  /* Etwas schmaler gesetzt, damit "#4A90D9" vollstaendig hineinpasst. */
  .colorRow input[type=text] {
    flex: 1 1 auto; padding: 8px 6px; font-family: ui-monospace, monospace;
    font-size: 13px;
  }
  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 14px;
  }
  button:hover { background: #303540; }
  button.primary { background: var(--accent); border-color: transparent; color: #fff; }
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
  .conflict {
    display: none; gap: 10px; align-items: center; flex-wrap: wrap;
    background: #3a2224; border: 1px solid #7a3a3f; color: #f0d7d9;
    border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px;
  }
  .conflict.show { display: flex; }
  .conflict button { background: #4d2b2e; border-color: #7a3a3f; color: #f0d7d9; }
  /* Linke Spalte: Set-Kachel und darunter der Loeschen-Knopf. */
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

  dialog {
    background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 14px; padding: 0; width: min(760px, 92vw);
  }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  .dlgHead {
    display: flex; gap: 8px; padding: 16px; border-bottom: 1px solid var(--line);
    align-items: center;
  }
  /* Die Knoepfe behalten ihre Breite, das Suchfeld gibt nach - sonst bricht
     die Beschriftung um und wird abgeschnitten. */
  .dlgHead button { flex: none; white-space: nowrap; }
  .dlgHead input[type=text] { flex: 1 1 auto; width: auto; min-width: 4rem; }
  .results {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px; padding: 16px; max-height: 60vh; overflow: auto;
  }
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
  <h1>mitreden</h1>
  <span class="status" id="status"></span>
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

  <button id="removeSet" class="danger">Dieses Set loeschen</button>
  <pre class="log" id="log"></pre>
<input type="file" id="fileInput" accept="image/*" hidden>
</main>

<dialog id="picker">
  <div class="dlgHead">
    <input type="text" id="q" placeholder="ARASAAC durchsuchen, z.B. trinken">
    <button id="searchBtn">Suchen</button>
    <button id="uploadBtn">Eigenes Bild</button>
    <button id="closeBtn">Schliessen</button>
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
  render();
}

function saveSoon() {
  clearTimeout(saveTimer);
  status("speichert ...");
  saveTimer = setTimeout(save, 400);
}

async function save() {
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
        "geaendert. Was hier auf dem Bildschirm steht, ist noch da.";
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
    layout = await response.json();
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

function clearDragMarks() {
  document.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
}

function emptySet(index) {
  const palette = __PALETTE__;
  return {
    name: "Set " + (index + 1),
    symbol: "",
    color: palette[index % palette.length],
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  };
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
  colorInput.title = "Farbe des Sets waehlen";
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
    // Einsortieren - die andere Taste rueckt genau dorthin, wo diese herkam.
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
    playBtn.title = "Vorhoeren";
    playBtn.onclick = () => speak(slot.text, playBtn);
    row.append(textInput, playBtn);
    tile.appendChild(row);
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
    status("Vorhoeren nicht moeglich: " + error.message);
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
  $("results").innerHTML = '<p style="color:var(--muted)">sucht ...</p>';
  try {
    const items = await (await api("/api/search?q=" + encodeURIComponent(word))).json();
    if (!items.length) {
      $("results").innerHTML = '<p style="color:var(--muted)">Nichts gefunden.</p>';
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
    $("results").innerHTML = '<p style="color:var(--muted)">' + error.message + '</p>';
  }
}

// Traegt ein fertiges Symbol dort ein, wo der Dialog geoeffnet wurde.
async function applySymbol(filename) {
  const entry = layout.sets[current];
  if (pickTarget.kind === "set") entry.symbol = filename;
  else entry.slots[pickTarget.index].symbol = filename;
  await save();
  $("picker").close();
  render();
}

async function pick(item) {
  status("laedt Symbol ...");
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
  status("laedt Bild hoch ...");
  try {
    const result = await (await api(
      "/api/upload?name=" + encodeURIComponent(file.name),
      { method: "POST", body: file }
    )).json();
    await applySymbol(result.symbol);
    status("Bild uebernommen");
  } catch (error) {
    status("Upload fehlgeschlagen: " + error.message);
  }
};

$("searchBtn").onclick = doSearch;
$("q").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); doSearch(); } };
$("closeBtn").onclick = () => $("picker").close();

removeSetBtn.onclick = async () => {
  if (!layout.sets.length) return;
  if (!confirm("Set \"" + (layout.sets[current].name || "") + "\" wirklich loeschen?")) return;
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
  $("log").textContent = "laeuft ...";
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


def main() -> int:
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    server = Server((HOST, PORT), Handler)
    print(f"mitreden laeuft auf http://{HOST}:{PORT}  (Strg+C beendet)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbeendet.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
