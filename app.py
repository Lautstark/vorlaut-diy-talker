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
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build
import config
import discovery
import metacom
import texts
import tts

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
UI = ROOT / "ui.html"    # the page itself, part of the program
SYMBOLS_DIR = build.SYMBOLS_DIR
THUMB_CACHE = build.CONTENT / "cache" / "thumbs"
PORT = 8771
HOST = "127.0.0.1"   # default: this machine only
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB is plenty for any symbol
# Everything that arrives as JSON. A layout with all 25 sets in it is a few
# kilobytes, so this is roomy. It exists because Content-Length is believed
# before the body is read, and an unchecked number is memory somebody else
# gets to spend.
MAX_BODY = 256 * 1024

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
    return config.value("VORLAUT_DEVICE_TOKEN")


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


# The version above is read, compared and written in one go in do_POST, and
# this server answers in threads. Without the lock two tabs saving in the same
# moment both find the version current, both write, and one of the two is
# gone - the exact loss the version was put there to catch. The page
# serialises its own saves, which helps only within that one page.
_save_lock = threading.Lock()

# A second one for the build, which empties data/ before it fills it again:
# two at once and one deletes what the other has just written. Deliberately
# not the lock above - a build takes minutes, and a tab's autosave has no
# business waiting behind one.
_build_lock = threading.Lock()


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
    except Exception as exc:  # Pillow raises different things per format
        raise build.BuildError("err.not_an_image") from exc

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
    """Puts a pictogram into symbols/ and returns the file name."""
    data = arasaac_fetch(pictogram_id)
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{slugify(label)}-{int(pictogram_id)}.png"
    (SYMBOLS_DIR / filename).write_bytes(data)
    return filename


# --- Fetching voices ---------------------------------------------------------
# About 130 MB over somebody else's network - too long to answer a request
# with. So it runs in a thread and the page asks how far it has got. Only one
# at a time: two of them would write the same files.

_fetch_lock = threading.Lock()
_fetch = {"running": False, "done": 0, "total": 0, "name": "",
          "error": "", "params": {}}


def fetch_state() -> dict:
    with _fetch_lock:
        return dict(_fetch)


def fetch_voices(lang: str) -> bool:
    """Starts the download. False when one is already running."""
    missing = tts.missing_voices(lang)
    with _fetch_lock:
        if _fetch["running"]:
            return False
        _fetch.update(running=True, done=0, total=len(missing), name="",
                      error="", params={})

    def work() -> None:
        try:
            for entry in missing:
                name = entry.rsplit("/", 1)[-1]
                with _fetch_lock:
                    _fetch["name"] = tts.pretty_piper(name)
                tts.download_voice(entry)
                with _fetch_lock:
                    _fetch["done"] += 1
        except tts.TTSError as exc:
            # The message, not the exception: this is read in the browser, in
            # the language of the page.
            with _fetch_lock:
                _fetch["error"] = exc.key
                _fetch["params"] = exc.params
        finally:
            with _fetch_lock:
                _fetch["running"] = False
                _fetch["name"] = ""

    threading.Thread(target=work, daemon=True).start()
    return True


# --- Pairing -----------------------------------------------------------------
# How the key gets onto the device without anybody typing it: the device shows
# five digits, one per display, and whoever stands in front of it types them
# in here. A device that has never been paired holds no shared secret, so it
# cannot prove anything - but being able to read its displays is proof enough
# of standing in the room with it. The protocol is in docs/software.md.

PAIR_LIFETIME = 180      # seconds a code is good for
PAIR_INTERVAL = 3        # how often the device should ask, in seconds
PAIR_ATTEMPTS = 5        # wrong codes before a pairing gives up
PAIR_MAX_PENDING = 8     # more than this at once is not a household

_pair_lock = threading.Lock()
_pairings: dict[str, dict] = {}

HEX12 = re.compile(r"^[0-9a-f]{12}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
DIGITS5 = re.compile(r"^[0-9]{5}$")


def parse_lines(body: str) -> dict[str, str]:
    """"keyword value" lines into a dictionary.

    The device speaks this instead of JSON - a parser on the ESP32 means a
    library, a heap and a class of failure a fixed line format does not have.
    Unknown keywords are ignored on both sides, so either can gain a field
    without the other falling over.
    """
    values: dict[str, str] = {}
    for line in body.replace("\r\n", "\n").split("\n"):
        keyword, _, value = line.strip().partition(" ")
        if keyword and value:
            values[keyword] = value.strip()
    return values


def pair_expired(entry: dict, now: float) -> bool:
    return now - entry["since"] > PAIR_LIFETIME


def pair_sweep(now: float) -> None:
    """Drops what is too old. Called from every pairing route rather than by a
    timer: nothing here is urgent enough to keep a thread awake for."""
    for device in [d for d, e in _pairings.items()
                   if pair_expired(e, now) and not e["ready"]]:
        del _pairings[device]


def pair_start(device: str, code: str, secret: str) -> str:
    """Remembers a device that is showing a code. The answer is the state to
    send back: "ok" or why not."""
    now = time.time()
    with _pair_lock:
        pair_sweep(now)
        # A device that starts again replaces its own pairing - it may have
        # been restarted, and its old code is gone from the displays anyway.
        if device not in _pairings and len(_pairings) >= PAIR_MAX_PENDING:
            return "busy"
        _pairings[device] = {
            "code": code,
            "secret": secret,
            "since": now,
            "left": PAIR_ATTEMPTS,
            "ready": False,
        }
    return "ok"


def pair_poll(device: str, secret: str) -> tuple[str, str]:
    """(state, token) for a device asking whether somebody typed its code.

    An unknown device and a wrong secret answer the same way on purpose: the
    id is the Wi-Fi MAC and anybody on the network can read it, so a wrong
    secret must not be distinguishable from a pairing that was never started.
    """
    now = time.time()
    with _pair_lock:
        entry = _pairings.get(device)
        if entry is None or not hmac.compare_digest(entry["secret"], secret):
            return ("unknown", "")
        if entry["ready"]:
            # Handed over once. From here the device carries the token itself.
            del _pairings[device]
            return ("ready", device_token())
        if entry["left"] <= 0:
            del _pairings[device]
            return ("denied", "")
        if pair_expired(entry, now):
            del _pairings[device]
            return ("expired", "")
        return ("waiting", "")


def pair_waiting() -> list[dict]:
    """What the interface offers boxes for. Without this it would have to show
    five empty fields to somebody who has no device on the table."""
    now = time.time()
    with _pair_lock:
        pair_sweep(now)
        return [{"device": device, "since": int(now - entry["since"])}
                for device, entry in _pairings.items() if not entry["ready"]]


def pair_confirm(code: str) -> tuple[str, str, int]:
    """(result, device, attempts left) for five digits somebody typed.

    A code matching nothing counts against every pairing currently waiting.
    With one device on the table that is exactly right, and with two it is
    still the only thing that can be meant - the person is typing at one of
    them and getting it wrong.
    """
    now = time.time()
    with _pair_lock:
        pair_sweep(now)
        pending = {d: e for d, e in _pairings.items() if not e["ready"]}
        if not pending:
            return ("none", "", 0)
        for device, entry in pending.items():
            if hmac.compare_digest(entry["code"], code):
                entry["ready"] = True
                return ("ok", device, entry["left"])
        left = 0
        for entry in pending.values():
            entry["left"] -= 1
            left = max(left, entry["left"])
        return ("wrong", "", left)


# --- Settings ----------------------------------------------------------------
# What the gear writes. Two of these are secrets and one is a path, and the
# difference decides who may set them - see _may_set_secrets().

def secret_hint(value: str) -> str:
    """Enough to recognise a key by, not enough to use it."""
    return value[-4:] if len(value) >= 8 else ""


def settings_state() -> dict:
    key = config.value("AZURE_SPEECH_KEY")
    where = metacom.configured()
    return {
        "azureKey": {"set": bool(key), "hint": secret_hint(key)},
        "azureRegion": config.value("AZURE_SPEECH_REGION", "germanywestcentral"),
        "metacom": {
            "path": where,
            "ok": metacom.available(),
            "count": metacom.count() if metacom.available() else 0,
            "keywords": metacom.has_keywords() if metacom.available() else False,
        },
    }


# --- HTTP --------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "vorlaut"

    def log_message(self, fmt, *args):  # ruhiger Log
        if self.path.startswith("/api/"):
            print(f"  {self.command} {self.path}", flush=True)

    # -- Device sync --

    def _device_allowed(self) -> bool:
        """Check the key. Answers by itself when something is wrong."""
        token = device_token()
        if not token:
            self._error("err.no_device_sync", 503)
            return False
        # Nur als Kopfzeile, nie im Adressteil: Adressen landen in
        # logs, headers do not.
        sent = self.headers.get("X-Vorlaut-Token", "")
        # compare_digest instead of ==, so the response time gives nothing away.
        if not hmac.compare_digest(sent, token):
            self._error("err.bad_token", 401)
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

    def _language(self) -> str:
        """The language for anything the browser is going to show.

        Read per request rather than kept: the file is small, and a language
        picked in one tab should reach the next one without a restart. If it
        cannot be read at all, English - an error message about a broken
        layout.json must not itself depend on layout.json.
        """
        try:
            return build.load_layout().get("language", texts.DEFAULT)
        except (build.BuildError, OSError):
            return texts.DEFAULT

    def _error(self, key: str, code: int = 400, **params) -> None:
        self._json({"error": texts.t(key, self._language(), **params)}, code)

    def _failed(self, exc: Exception, code: int = 400) -> None:
        """An exception, in the language of the page.

        BuildError and TTSError carry a key and can be translated; anything
        else - a ValueError from a broken upload, say - only has the text it
        was raised with.
        """
        message = getattr(exc, "message", None)
        self._json({"error": message(self._language()) if message else str(exc)},
                   code)

    def _from_here(self, origin: str) -> bool:
        """Whether that Origin is this server.

        Compared against the request's own Host header rather than a list of
        addresses: with --host 0.0.0.0 the page is opened at whatever address
        the phone in the kitchen can reach, and none of those are knowable
        here. The scheme is not compared for the same reason - behind a proxy
        the page is https and this server never learns of it.
        """
        host = self.headers.get("Host", "")
        sent = urllib.parse.urlsplit(origin)
        return bool(host) and sent.scheme in ("http", "https") and sent.netloc == host

    def _refused(self, reason: str, code: int) -> None:
        """A request the interface itself never sends, and the answer says so.

        These reasons are not in texts.py on purpose. Every one of them means
        the request did not come from this page, so there is nobody reading
        the interface's language at the other end to translate for.
        """
        self._json({"error": reason}, code)
        # Whatever body was announced is still in the socket unread, so this
        # connection must not carry a second request after this one.
        self.close_connection = True

    def _body(self) -> dict | None:
        """The JSON body - or None, and then the request is already answered.

        Three checks before a byte is read, because everything behind here
        writes something: a layout, a build, and .env with the Azure key in
        it. A page on another site can POST to this server without asking
        anybody first, and the gear answers from 127.0.0.1 - which is exactly
        where the browser of whoever opened that page is sitting.

        The content type is what closes that door. A cross-origin POST that
        needs no permission first may carry three content types, all of them
        ones a form could have sent; application/json is not among them, so
        the browser has to ask, and this server answers no such ask at all.
        The Origin check is the second lock on the same door, and the size cap
        keeps a made-up Content-Length from being believed.

        The device endpoints and the upload never come through here - they
        speak lines and raw bytes, and are checked where they are read.
        """
        origin = self.headers.get("Origin")
        if origin and not self._from_here(origin):
            self._refused("This request came from another site.", 403)
            return None
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._refused("Content-Length is not a number.", 400)
            return None
        if length <= 0:
            return {}
        if length > MAX_BODY:
            self._refused(f"The body is longer than {MAX_BODY} bytes.", 413)
            return None
        kind = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if kind.lower() != "application/json":
            self._refused("This endpoint reads application/json.", 415)
            return None
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _upload(self, query) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._error("err.no_image_data")
            return
        if length > MAX_UPLOAD:
            self._error("err.image_too_big", mb=MAX_UPLOAD // 1048576)
            return
        data = self.rfile.read(length)
        name = (query.get("name") or ["bild"])[0]
        try:
            self._json({"symbol": save_upload(data, name)})
        except (ValueError, build.BuildError) as exc:
            self._failed(exc)

    # -- Routen --

    def do_GET(self):
        route = urllib.parse.urlparse(self.path)
        path = route.path
        query = urllib.parse.parse_qs(route.query)

        if path in ("/", "/index.html"):
            lang = self._language()
            page = (read_ui()
                    .replace("__LANG__", lang)
                    .replace("__TEXTS__", json.dumps(texts.ui_texts(lang),
                                                     ensure_ascii=False))
                    .replace("__LANGUAGES__", json.dumps(sorted(texts.TEXTS)))
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
                self._failed(exc, 500)
            return

        if path == "/api/search":
            word = (query.get("q") or [""])[0].strip()
            # Without a value, both sources. The interface asks for them
            # separately so the licensed collection is there at once
            # instead of waiting for an answer from the network.
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
                        self._error("err.arasaac_unreachable", 502, reason=str(exc))
                        return
            self._json(results)
            return

        if path == "/api/device/manifest":
            if not self._device_allowed():
                return
            try:
                # Lines, not JSON - the device has no parser, see
                # build.manifest_text(). Also nicer with curl.
                body = build.manifest_text(build.device_manifest())
            except build.BuildError as exc:
                self._failed(exc, 500)
                return
            self._send(200, body.encode("utf-8"), "text/plain; charset=utf-8")
            return

        if path == "/api/device/file":
            if not self._device_allowed():
                return
            # The file name only, nothing before it - the request comes from outside.
            name = Path((query.get("name") or [""])[0]).name
            target = build.DATA_DIR / name
            if not name or not target.is_file():
                self._error("err.file_not_found", 404)
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

        if path == "/api/voices":
            # The voices this installation can actually speak with. Read-only:
            # a chosen voice is written to layout.json like the menu language,
            # through /api/layout, so one save covers both.
            #
            # "active" is the one the layout is spoken in right now - either
            # what stands in it, or, for an empty entry, what was picked for
            # it. Labels are names and are not translated.
            try:
                layout = build.load_layout()
            except build.BuildError as exc:
                self._failed(exc, 500)
                return
            active = build.chosen_voice(layout)
            self._json({
                "voices": [dict(voice, active=voice["id"] == active)
                           for voice in tts.available_voices()],
                "active": active,
                "chosen": layout.get("voice", ""),
            })
            return

        if path == "/api/settings":
            self._json(dict(settings_state(), local=self._may_set_secrets()))
            return

        if path == "/api/pair":
            # So the page can offer the five boxes only when a device is
            # actually waiting. "since" is seconds, so it can also say how
            # much of the code's life is left.
            self._json({"waiting": pair_waiting()})
            return

        if path == "/api/voices/fetch":
            # How far the download has got. The error is rendered here, where
            # the language of the page is known - the thread only kept the key.
            state = fetch_state()
            self._json({
                "running": state["running"],
                "done": state["done"],
                "total": state["total"],
                "name": state["name"],
                "error": (texts.t(state["error"], self._language(),
                                  **state["params"])
                          if state["error"] else ""),
                # So the page knows whether there is anything left to offer.
                # A look at the folder, not at the network.
                "missing": len(tts.missing_voices("")),
            })
            return

        if path in ("/icon.svg", "/icon-192.png", "/icon-512.png"):
            file = ASSETS / Path(path).name
            if not file.exists():
                self._error("err.symbol_not_found", 404)
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
                "description": texts.t("ui.app_description",
                                       self._language()),
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
                self._failed(exc, 500)
            return

        if path == "/api/thumb":
            try:
                identifier = int((query.get("id") or ["0"])[0])
                self._send(200, arasaac_fetch(identifier), "image/png")
            except (urllib.error.URLError, ValueError, TimeoutError) as exc:
                self._error("err.preview_failed", 502, reason=str(exc))
            return

        if path.startswith("/symbols/"):
            # The reference can be "bild.png" or "metacom:name" - which file
            # is meant is decided by build.symbol_path.
            reference = urllib.parse.unquote(path[len("/symbols/"):])
            target = build.symbol_path(reference)
            if target is None:
                self._error("err.symbol_not_found", 404)
                return
            self._send(200, target.read_bytes(), "image/png")
            return

        self._error("err.not_found", 404)

    # -- Settings --

    def _may_set_secrets(self) -> bool:
        """Whether this request may write the Azure key.

        Editing content from a phone is the point of --host 0.0.0.0, and none
        of that is worth protecting from the household. The key is: it is
        somebody's bill and it can be read back out. So it is set at the
        machine itself.

        In a container the question cannot be answered - what arrives is the
        bridge gateway, never 127.0.0.1 - and refusing there would lock
        somebody out of their own NAS. Then it is allowed, and docs/operation.md
        says so.
        """
        if Path("/.dockerenv").exists():
            return True
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    # -- Pairing --

    def _lines_body(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 4096:
            return {}
        return parse_lines(self.rfile.read(length).decode("utf-8", "replace"))

    def _pair_answer(self, lines: list[str], code: int = 200) -> None:
        self._send(code, ("\n".join(lines) + "\n").encode("utf-8"),
                   "text/plain; charset=utf-8")

    def _device_pair(self) -> None:
        """A device announcing the code it is showing. No key here - this is
        where a device that has none comes to get one."""
        if not device_token():
            self._pair_answer(["error no_token"], 503)
            return
        sent = self._lines_body()
        device = sent.get("device", "").lower()
        code = sent.get("code", "")
        secret = sent.get("secret", "").lower()
        if not (HEX12.match(device) and DIGITS5.match(code)
                and HEX32.match(secret)):
            self._pair_answer(["error bad_request"], 400)
            return
        if pair_start(device, code, secret) == "busy":
            self._pair_answer(["error too_many"], 429)
            return
        self._pair_answer(["ok 1", f"expires {PAIR_LIFETIME}",
                           f"interval {PAIR_INTERVAL}"])

    def _device_pair_poll(self) -> None:
        """Has anybody typed it yet - and if so, here is the key."""
        if not device_token():
            self._pair_answer(["error no_token"], 503)
            return
        sent = self._lines_body()
        device = sent.get("device", "").lower()
        secret = sent.get("secret", "").lower()
        if not (HEX12.match(device) and HEX32.match(secret)):
            self._pair_answer(["error bad_request"], 400)
            return
        state, token = pair_poll(device, secret)
        if state == "unknown":
            self._pair_answer(["error unknown"], 404)
            return
        if state == "ready":
            self._pair_answer(["state ready", f"token {token}"])
            return
        self._pair_answer([f"state {state}"])

    def do_POST(self):
        route = urllib.parse.urlparse(self.path)
        path = route.path

        # The upload sends raw image data, not JSON - so it leaves early.
        if path == "/api/upload":
            self._upload(urllib.parse.parse_qs(route.query))
            return

        # The device speaks lines, not JSON - so these leave early too.
        if path == "/api/device/pair":
            self._device_pair()
            return
        if path == "/api/device/pair/poll":
            self._device_pair_poll()
            return

        try:
            body = self._body()
        except json.JSONDecodeError:
            self._error("err.bad_json")
            return
        if body is None:
            return                      # refused, and already answered

        if path == "/api/layout":
            sent = self.headers.get("X-Layout-Version")
            with _save_lock:
                # Reading the version, comparing it and writing belong
                # together: another tab getting in between is the whole thing
                # the comparison exists to notice.
                stale = bool(sent) and sent != layout_version()
                if not stale:
                    try:
                        saved = build.save_layout(body)
                    except build.BuildError as exc:
                        self._failed(exc)
                        return
                    extra = {
                        "X-Layout-Version": layout_version(),
                        "X-Build-Current": build_current_flag(),
                    }
            if stale:
                # This page knows an older state. Nothing was written.
                self._json(
                    {
                        "error": texts.t("err.stale_page", self._language()),
                        "conflict": True,
                    },
                    409,
                )
                return
            self._json(saved, extra=extra)
            return

        if path == "/api/pick":
            # METACOM symbols are neither downloaded nor copied: they stay in
            # the licensed collection, the layout only holds the reference.
            if (body.get("source") or "") == "metacom":
                reference = str(body.get("ref") or "")
                if build.symbol_path(reference) is None:
                    self._error("err.no_such_metacom", 404)
                    return
                name = reference[len(build.METACOM_PREFIX):]
                self._json({"symbol": reference, "label": metacom.label_for(name)})
                return
            label = body.get("label") or "symbol"
            try:
                filename = arasaac_download(body.get("id"), label)
            except (urllib.error.URLError, ValueError, TypeError, TimeoutError) as exc:
                self._error("err.download_failed", 502, reason=str(exc))
                return
            self._json({"symbol": filename, "label": label})
            return

        if path == "/api/settings":
            updates: dict[str, str] = {}
            if "azureKey" in body:
                if not self._may_set_secrets():
                    self._error("err.settings_local_only", 403)
                    return
                updates["AZURE_SPEECH_KEY"] = str(body.get("azureKey") or "").strip()
            if "azureRegion" in body:
                updates["AZURE_SPEECH_REGION"] = str(
                    body.get("azureRegion") or "").strip()
            if "metacom" in body:
                updates["VORLAUT_METACOM_DIR"] = str(body.get("metacom") or "").strip()
            try:
                config.write(updates)
            except OSError as exc:
                self._error("err.settings_write", 500, reason=str(exc))
                return
            # Read back rather than echo: what the file says is the truth, and
            # a path that turned out unusable should say so here and not on
            # the next build.
            self._json(dict(settings_state(), local=self._may_set_secrets()))
            return

        if path == "/api/pair/confirm":
            # Five digits and nothing else - no device is picked. The server
            # looks for the pairing carrying that code.
            code = str(body.get("code") or "").strip()
            if not DIGITS5.match(code):
                self._error("err.pair_wrong_code")
                return
            result, device, left = pair_confirm(code)
            if result == "none":
                self._error("err.pair_expired", 410)
                return
            if result == "wrong":
                self._json({"error": texts.t("err.pair_wrong_code",
                                             self._language()),
                            "left": left}, 400)
                return
            self._json({"ok": True, "device": device})
            return

        if path == "/api/voices/fetch":
            # Without a language, everything that is missing. The answer says
            # only whether it started - how it goes is asked for separately.
            lang = (body.get("lang") or "").strip()
            if lang and lang not in tts.VOICE_CATALOGUE:
                self._error("err.not_found", 404)
                return
            self._json({"started": fetch_voices(lang)})
            return

        if path == "/api/speak":
            text = (body.get("text") or "").strip()
            # A voice sent along is listened to, so the page can play a voice
            # before it is saved. Without one it is the layout's.
            voice = (body.get("voice") or "").strip()
            try:
                if not voice:
                    voice = build.chosen_voice(build.load_layout())
                wav = tts.synthesize(text, voice)
            except (build.BuildError, tts.TTSError) as exc:
                self._failed(exc)
                return
            self._send(200, wav.read_bytes(), "audio/wav")
            return

        if path == "/api/build":
            # One at a time: data/ is emptied and refilled in there.
            with _build_lock:
                try:
                    log = build.build(lang=self._language())
                except (build.BuildError, tts.TTSError) as exc:
                    self._failed(exc, 500)
                    return
            self._json({"log": log})
            return

        self._error("err.not_found", 404)


def read_ui() -> str:
    """The interface, read fresh so that editing ui.html needs no restart.

    It lives beside the program the way assets/ does: it is part of vorlaut,
    not of what you build with it. As a string in this file it was 1666 lines
    of HTML, CSS and JavaScript that no editor could colour, check or indent,
    and that every search through this file had to be scrolled past.

    Not called page(): the route already has a local of that name, and a
    function shadowed by it fails only when somebody asks for the page.
    """
    try:
        return UI.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise RuntimeError(f"ui.html is missing from {ROOT}. It belongs next "
                           f"to app.py, like assets/ does.")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def local_addresses() -> list[str]:
    """The addresses this computer can be reached at on the network."""
    import socket
    addresses = set()
    try:
        # No connection is made - the kernel only reveals which
        # Schnittstelle er hinauswollte.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            addresses.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(addresses)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="vorlaut: web interface")
    parser.add_argument(
        "--host",
        default=HOST,
        help="default 127.0.0.1 (this machine only). For access from a "
             "phone on the same Wi-Fi: --host 0.0.0.0",
    )
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    build.ensure_content()
    server = Server((args.host, args.port), Handler)
    finder = None
    if args.host in ("0.0.0.0", "::"):
        print(f"vorlaut is listening on port {args.port}", flush=True)
        if Path("/.dockerenv").exists():
            # Inside a container our own address would be the Docker
            # network's and therefore useless from outside.
            print("  In a container: use the address of the NAS with the "
                  "published port.", flush=True)
        else:
            print(f"  http://localhost:{args.port}", flush=True)
            for address in local_addresses():
                print(f"  http://{address}:{args.port}   <- type this one into "
                      "the phone", flush=True)
        # Only from here on is there anything to find: bound to 127.0.0.1
        # neither the device nor the phone could reach us anyway.
        finder = discovery.start(args.port)
        if Path("/.dockerenv").exists():
            print("  Neither of those two crosses a bridge network - "
                  "see docker-compose.yml.", flush=True)
        print("Careful: there is no sign-in - whoever reaches the port can "
              "change the content.", flush=True)
    else:
        print(f"vorlaut is running on http://{args.host}:{args.port}", flush=True)
    print("(Ctrl+C stops it)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        if finder:
            finder.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
