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
            page = (PAGE
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


PAGE = r"""<!doctype html>
<html lang="__LANG__">
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
  /* "vorlaut" is the name of the thing, not a label: it stays this word in
     every language and therefore stands in the markup, not in texts.py. */
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
    content: var(--pick-label); position: absolute; inset: auto 0 0 0;
    background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 4px;
    text-align: center;
  }
  .row { display: flex; gap: 8px; }
  input[type=text], input[type=password] {
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
  /* The language picker looks like the buttons next to it. Left to itself a
     select brings the operating system's own look, which on a dark header is
     a white rectangle. */
  /* Form elements do not inherit the page font by themselves - without this
     the header sits in the browser's default face while everything around it
     is the system font. */
  button, select, input, textarea { font-family: inherit; }

  /* appearance: none, because otherwise the operating system draws its own
     arrow and imposes its own height: 35.5 px next to 34 px buttons, and a
     chevron sitting wherever macOS likes. Everything below matches the
     buttons - same padding, same radius, same border. */
  #langPick {
    appearance: none; -webkit-appearance: none;
    /* The chevron only, on nothing. Box and border appear when the thing is
       pointed at - see below. Note the order: the background shorthand resets
       background-color, so transparent has to come after it, not before. */
    background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239aa3b2' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
      no-repeat right 11px center;
    background-color: transparent;
    color: var(--muted); border: 1px solid transparent;
    border-radius: 8px; padding: 8px 30px 8px 12px; cursor: pointer;
    font-size: 14px; line-height: normal;   /* like the button next to it */
    transition: background-color .12s, border-color .12s, color .12s;
  }
  #langPick:hover, #langPick:focus-visible {
    background-color: var(--panel-2); border-color: var(--line);
    color: var(--text);
  }
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
    /* Here the wordmark is hidden, not deleted: it costs 64px next to a
       logo that carries the same brand, and the bar has to fit one line.
       Screen readers and the page outline keep the heading. */
    header h1 {
      position: absolute; width: 1px; height: 1px; margin: -1px;
      overflow: hidden; clip-path: inset(50%); white-space: nowrap;
    }
    /* Same order as on a wide screen: settings first, the action last, and
       the whole group against the right edge. On a wide screen the status
       carries the auto margin that pushes them there; here it sits next to
       the logo instead, so the margin moves to the first control. */
    /* All scoped to the header: .schalter is also the "Aktiv" switch on the
       set tile, and an auto margin sent that one to the right edge too. */
    header .status { order: 1; margin-left: 0; }
    header .schalter { order: 2; margin-left: auto; }
    header #gear { order: 3; }
    header #langPick { order: 4; }
    header #releaseBtn { order: 5; }

    /* Wrapping, not a scrolling row. A row that scrolls sideways hides the
       sets past the edge with nothing to say they are there - and the sets
       are the navigation. Several lines cost height, but only as many lines
       as there are actually sets. */
    .tabs { flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .tabs .tab { flex: none; padding: 8px 12px; }

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

  /* Pairing. Shown only while a talker is actually waiting - see openPair. */
  .pairing {
    display: none; background: var(--panel); border: 1px solid var(--accent);
    border-radius: 12px; padding: 14px; margin-bottom: 14px;
  }
  .pairing.show { display: block; }
  .pairHead { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .pairing .note { color: var(--muted); font-size: 12px; }
  /* The five boxes stand where the keys stand: the set key on the left under
     the speaker, 1 and 2 above, 3 and 4 below - the same grid as the editor
     above, so nobody has to be told which digit goes where. */
  .pairKeys {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
    max-width: 300px; margin: 12px 0;
  }
  .pairKeys input {
    width: 100%; text-align: center; font-size: 22px; padding: 10px 0;
    font-family: ui-monospace, monospace;
    /* The general rule for text fields pins them to the top of their line;
       here they should fill the box they are in. */
    align-self: stretch;
  }
  /* The set key sits under the speaker, beside both rows of keys - so its box
     spans both and its digit sits level with the gap between them. */
  .pairKeys .setBox { grid-row: span 2; display: flex; align-items: center; }
  .pairKeys .setBox input { align-self: center; }
  .pairFoot { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  /* Beside the name, where a setting for the whole page belongs - and small,
     because it is not something anybody comes here to do. mitreden has the
     same gear in the same corner. */
  .gear {
    font-size: 21px; line-height: 1; padding: 7px 13px; border-radius: 999px;
    color: var(--muted); border-color: transparent; background: transparent;
  }
  .gear:hover, .gear:focus-visible {
    color: var(--text); background: var(--panel-2); border-color: var(--line);
  }
  /* Narrower than the symbol picker: that one shows a grid of tiles, this one
     reads as a list of settings. */
  dialog.sheet {
    width: min(520px, 92vw); max-height: 88vh;
  }
  /* Only while it is open. An unqualified display here would beat the
     browser's own dialog:not([open]) { display: none } - the sheet would then
     sit in the page for good, below everything else, and closing it would
     take the open attribute away without taking the sheet away. */
  dialog.sheet[open] { display: flex; flex-direction: column; }
  dialog.sheet .dlgHead, dialog.sheet .sheetFoot { flex: none; }
  /* One scrolling area for the whole sheet, rather than a scrolling list
     inside a scrolling dialog - two of them nested is a way to lose the Save
     button without noticing it is there. */
  .sheetBody { overflow-y: auto; }
  .sheet .section {
    padding: 16px 16px 0; font-size: 12px; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted);
  }
  .sheet .voiceList { padding-top: 10px; }
  .field { padding: 10px 16px 4px; display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 13px; color: var(--muted); }
  .field .lead { margin: 0 0 6px; font-size: 13px; color: var(--muted); }
  .field .note { margin: 0; font-size: 12px; color: var(--muted); }
  .field input { width: 100%; }
  .field input[type=password] { font-family: ui-monospace, monospace; }
  .sheetFoot {
    display: flex; gap: 8px; padding: 0 16px 16px; justify-content: flex-end;
  }
  /* A cross, not the word - it sits in the corner where one reaches for it,
     and it needs no room for a translation. The word stays as the label for
     anything that reads the page out. */
  .closeX {
    font-size: 20px; line-height: 1; padding: 4px 10px; border-radius: 999px;
    color: var(--muted); border-color: transparent; background: transparent;
  }
  .closeX:hover, .closeX:focus-visible {
    color: var(--text); background: var(--panel-2); border-color: var(--line);
  }

  /* The voice list. Two buttons per row on purpose: hearing a voice and
     choosing it are two different decisions, and the first should not commit
     to the second. */
  .dlgHead strong { flex: 1 1 auto; font-weight: 600; }
  .voiceList {
    display: flex; flex-direction: column; gap: 6px;
    padding: 16px; max-height: 60vh; overflow: auto;
  }
  .voiceRow {
    display: flex; align-items: center; gap: 10px; padding: 6px;
    border-radius: 10px; border: 2px solid transparent; background: var(--panel-2);
  }
  .voiceRow.on { border-color: var(--accent); }
  /* Looks like a row, behaves like a button - so it can be reached with the
     keyboard like everything else. */
  .voiceRow .pick {
    flex: 1 1 auto; min-width: 0; text-align: left; background: none;
    border: none; padding: 4px 2px; color: var(--text);
  }
  .voiceRow .pick:hover { background: none; color: var(--accent); }
  .voiceRow .note { color: var(--muted); font-size: 12px; }
  .voiceRow.empty { background: none; color: var(--muted); display: block; }
</style>
</head>
<body>
<header>
  <img src="/icon.svg" alt="" class="logo">
  <h1>vorlaut</h1>
  <button id="gear" class="gear">⚙</button>
  <span class="status" id="status"></span>
  <label class="schalter" id="previewLabel">
    <input type="checkbox" id="previewToggle">
    <span class="pille"></span>
    <span id="previewText"></span>
  </label>
  <select id="langPick"></select>
  <button class="primary" id="releaseBtn"></button>
</header>

<main>
  <div class="conflict" id="conflict">
    <span id="conflictText"></span>
    <button id="overwriteBtn"></button>
    <button id="reloadBtn"></button>
  </div>
  <div class="pairing" id="pairing">
    <div class="pairHead">
      <strong id="pairTitle"></strong>
      <span class="note" id="pairNote"></span>
    </div>
    <div class="pairKeys" id="pairKeys"></div>
    <div class="pairFoot">
      <button class="primary" id="pairConfirm"></button>
      <span class="note" id="pairError"></span>
    </div>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="slots" id="slots"></div>
  <div class="device" id="device"></div>

  <button id="removeSet" class="danger"></button>
  <pre class="log" id="log"></pre>
<input type="file" id="fileInput" accept="image/*" hidden>
</main>

<dialog id="picker">
  <div class="dlgHead">
    <input type="text" id="q">
    <button id="searchBtn"></button>
    <button id="uploadBtn"></button>
    <button id="closeBtn"></button>
  </div>
  <div class="results" id="results"></div>
  <div class="hint" id="quellen"></div>
</dialog>

<dialog id="voices" class="sheet">
  <div class="dlgHead">
    <strong id="settingsHeading"></strong>
    <button id="voiceClose" class="closeX">×</button>
  </div>
  <div class="sheetBody">
  <div class="section" id="voiceSection"></div>
  <div class="voiceList" id="voiceList"></div>
  <div class="hint" id="voiceHint"></div>

  <div class="section" id="azureSection"></div>
  <div class="field">
    <p class="lead" id="azureIntro"></p>
    <label id="azureKeyLabel" for="azureKey"></label>
    <input type="password" id="azureKey" autocomplete="off">
    <p class="note" id="azureKeyState"></p>
    <label id="azureRegionLabel" for="azureRegion"></label>
    <input type="text" id="azureRegion" autocomplete="off">
  </div>

  <div class="section" id="symbolsSection"></div>
  <div class="field">
    <p class="lead" id="metacomIntro"></p>
    <label id="metacomLabel" for="metacomPath"></label>
    <input type="text" id="metacomPath" autocomplete="off">
    <p class="note" id="metacomState"></p>
  </div>

  </div>

  <div class="sheetFoot">
    <button class="primary" id="voiceSave"></button>
    <button id="voiceCancel"></button>
  </div>
</dialog>

<script>
let layout = { sleep_timeout_seconds: 600, sets: [] };
let current = 0;
let pickTarget = null;      // {kind: "set"} or {kind: "slot", index: n}
let sources = { metacom: false };
let searchToken = 0;        // so a slow answer cannot overtake a newer one
let dragSet = null;         // index of the dragged set
let dragSlot = null;        // index of the dragged key
let saveTimer = null;
let layoutVersion = null;   // the state this page loaded
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
  markReleaseState(response.headers.get("X-Build-Current"));
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
function markReleaseState(flag) {
  if (flag === null || flag === undefined) return;
  const needed = flag !== "1";
  const button = $("releaseBtn");
  button.classList.toggle("primary", needed);
  button.title = needed
    ? t("ui.release_needed")
    : t("ui.release_current");
}

function saveSoon() {
  clearTimeout(saveTimer);
  unsaved = true;
  status(t("ui.unsaved"));
  saveTimer = setTimeout(save, 1000);
}

// Brings layout into the same shape the server makes of it. Only then can
// the two states be compared meaningfully.
function comparable(l) {
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
        t("ui.conflict_elsewhere");
      $("conflict").classList.add("show");
      status(t("ui.not_saved"));
      return;
    }
    if (!response.ok) {
      let message = response.statusText;
      try { message = (await response.json()).error || message; } catch (e) {}
      throw new Error(message);
    }
    layoutVersion = response.headers.get("X-Layout-Version");
  markReleaseState(response.headers.get("X-Build-Current"));
    // Do NOT replace layout with the answer here. The input fields hang off
    // exactly these objects; a fresh graph from the server would leave their
    // handlers pointing at nothing, and everything typed afterwards would be
    // lost until the next render() rebuilds the fields.
    const gespeichert = await response.json();

    // Verify instead of trust: does the file really hold what is on screen?
    // If not, better to say so loudly than to lose it quietly.
    if (comparable(gespeichert) !== comparable(layout)) {
      $("conflictText").textContent =
        t("ui.conflict_mismatch");
      $("conflict").classList.add("show");
      status(t("ui.saved_wrong"));
      return;
    }

    unsaved = false;
    $("conflict").classList.remove("show");
    status(t("ui.saved"));
  } catch (error) {
    status(t("ui.save_failed", { error: error.message }));
  }
}

// Deliberately force through what this page holds.
$("overwriteBtn").onclick = async () => {
  const response = await api("/api/layout");
  layoutVersion = response.headers.get("X-Layout-Version");
  markReleaseState(response.headers.get("X-Build-Current"));
  await response.json();
  await save();
};
$("reloadBtn").onclick = () => load();

$("previewToggle").onchange = () => {
  preview = $("previewToggle").checked;
  render();
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

// Injected by the server, so the lists are maintained in Python only.
const palette = __PALETTE__;
const limits = __LIMITS__;

// Only the ui.* entries of the chosen language - see texts.py. Every label on
// this page goes through t(), so no string sits in the markup twice.
const TEXTS = __TEXTS__;
const LANGUAGES = __LANGUAGES__;
const LANG = "__LANG__";

function t(key, params) {
  let out = TEXTS[key] || key;
  if (params) {
    for (const name in params) {
      out = out.split("{" + name + "}").join(params[name]);
    }
  }
  return out;
}

// Fills in every fixed label. Runs once - the page is served in one language
// and reloads when it changes, so nothing here has to react later.
function applyTexts() {
  document.documentElement.style.setProperty(
    "--pick-label", JSON.stringify(t("ui.pick_symbol")));
  $("previewLabel").title = t("ui.preview_title");
  $("previewText").textContent = t("ui.preview");
  $("releaseBtn").textContent = t("ui.release");
  $("overwriteBtn").textContent = t("ui.keep_mine");
  $("reloadBtn").textContent = t("ui.reload");
  $("removeSet").textContent = t("ui.remove_set");
  $("searchBtn").textContent = t("ui.search");
  $("uploadBtn").textContent = t("ui.own_image");
  $("closeBtn").textContent = t("ui.close");
  $("q").placeholder = t("ui.search_arasaac");
  $("quellen").textContent = t("ui.credits_arasaac");
  $("settingsHeading").textContent = t("ui.settings");
  $("voiceSection").textContent = t("ui.voice");
  $("azureSection").textContent = t("ui.azure");
  $("azureIntro").textContent = t("ui.azure_intro");
  $("azureKeyLabel").textContent = t("ui.azure_key");
  $("azureKey").placeholder = t("ui.azure_key_placeholder");
  $("azureRegionLabel").textContent = t("ui.azure_region");
  $("symbolsSection").textContent = t("ui.symbols");
  $("metacomIntro").textContent = t("ui.metacom_intro");
  $("metacomLabel").textContent = t("ui.metacom_path");
  $("gear").title = t("ui.settings");
  $("gear").setAttribute("aria-label", t("ui.settings"));
  $("voiceSave").textContent = t("ui.save");
  $("voiceCancel").textContent = t("ui.cancel");
  $("voiceClose").setAttribute("aria-label", t("ui.close"));
  $("voiceClose").title = t("ui.close");
  $("pairTitle").textContent = t("ui.pair_title");
  $("pairNote").textContent = t("ui.pair_note");
  $("pairConfirm").textContent = t("ui.pair_confirm");

  // Just the code. "Deutsch" and "English" read nicer but cost a third of
  // the header on a phone, and a two-letter language code is the one label
  // that needs no translation. The title says what the thing is.
  const names = { de: "DE", en: "EN" };
  const pick = $("langPick");
  pick.title = t("ui.language_title");
  for (const code of LANGUAGES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = names[code] || code;
    option.selected = code === LANG;
    pick.appendChild(option);
  }
  // Saved like any other change, then reloaded: the labels are baked into the
  // page by the server, so switching them in place would mean a second copy
  // of every string in the browser.
  pick.onchange = async () => {
    layout.language = pick.value;
    await save();
    location.reload();
  };
}

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
  line.append(bild, document.createTextNode(t("ui.device_size")));
  return line;
}

function thumb(symbol, onClick) {
  const box = document.createElement("div");
  box.className = "thumb";
  if (symbol) {
    const image = document.createElement("img");
    image.src = "/symbols/" + encodeURIComponent(symbol) + "?v=" + Date.now();
    image.onerror = () => { box.innerHTML = '<div class="empty">' + symbol + '<br>' + t("ui.symbol_missing") + '</div>'; };
    box.appendChild(image);
  } else {
    box.innerHTML = '<div class="empty">' + t("ui.no_symbol") + '</div>';
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
    tab.title = entry.active === false ? t("ui.tab_off") : t("ui.tab_on");
    tab.style.borderColor = index === current ? entry.color : "transparent";
    tab.innerHTML = '<span class="dot" style="background:' + entry.color + '"></span>';
    tab.append(entry.name || t("ui.set_n", { n: index + 1 }));
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
    add.textContent = t("ui.add_set");
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
    ? t("ui.none_active", { n: layout.sets.length })
    : t("ui.slots_used", { used: used, max: limits.maxActive })
      + (layout.sets.length > used
         ? "  ·  " + t("ui.sets_created", { n: layout.sets.length }) : "");

  const device = $("device");
  device.innerHTML = "";
  removeSetBtn.style.display = layout.sets.length ? "" : "none";
  const entry = layout.sets[current];
  if (!entry) {
    device.innerHTML = '<p style="color:var(--muted)"></p>';
    device.firstChild.textContent = t("ui.no_sets");
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
  setLabel.textContent = t("ui.set_key");
  setTile.appendChild(setLabel);
  setTile.appendChild(thumb(entry.symbol, () => openPicker({ kind: "set" }, entry.name)));

  if (preview) setTile.appendChild(echtgross(entry.symbol, color));

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = entry.name;
  nameInput.placeholder = t("ui.set_name");
  nameInput.oninput = () => { entry.name = nameInput.value; saveSoon(); renderTabsOnly(); };
  setTile.appendChild(nameInput);

  // Only five sets fit onto the device - creating more is allowed. The
  // entscheidet, welche davon gerade mitkommen.
  const activeToggle = document.createElement("label");
  activeToggle.className = "schalter onDevice";
  // Short, because the device-preview switch sits right next to it - the same
  // word twice in one view reads like the same thing. The title says what it
  // means.
  activeToggle.title = t("ui.active_title", { max: limits.maxActive });
  const activeBox = document.createElement("input");
  activeBox.type = "checkbox";
  activeBox.checked = entry.active !== false;
  const activePill = document.createElement("span");
  activePill.className = "pille";
  activeToggle.append(activeBox, activePill, document.createTextNode(t("ui.active")));
  activeBox.onchange = async () => {
    if (activeBox.checked && activeCount() >= limits.maxActive) {
      activeBox.checked = false;
      status(t("ui.active_full", { max: limits.maxActive }));
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
  colorInput.title = t("ui.colour_title");
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
    note.textContent = t("ui.ready_not_on_device");
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
    caption.textContent = t("ui.key_n", { n: index + 1 });

    // Swap keys: in the fixed 2x2 grid swapping is less ambiguous than
    // inserting - the other key moves exactly where this one came from.
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "\u283F";
    grip.title = t("ui.grip_title");
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
    textInput.placeholder = t("ui.text_placeholder");
    textInput.oninput = () => { slot.text = textInput.value; saveSoon(); };
    const playBtn = document.createElement("button");
    playBtn.className = "play";
    playBtn.textContent = "▶";
    playBtn.title = t("ui.play_title");
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
    if (tab) { tab.lastChild.textContent = entry.name || t("ui.set_n", { n: index + 1 }); }
  });
}

// A voice given here is listened to instead of the saved one - that is what
// lets the picker play a voice before it is chosen.
async function speak(text, button, voice) {
  if (!text.trim()) { status(t("ui.need_text")); return; }
  const before = button.textContent;
  button.textContent = "···";
  try {
    const response = await api("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voice || "" }),
    });
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    status("");
  } catch (error) {
    status(t("ui.play_failed", { error: error.message }));
  } finally {
    button.textContent = before;
  }
}

// --- Pairing -----------------------------------------------------------------
// A talker showing five digits wants its key. The boxes stand where the keys
// stand - set key on the left under the speaker, 1 and 2 above it, 3 and 4
// below - so nobody has to be told an order. As one string the code runs
// key1 key2 key3 key4 setkey; that order is the whole agreement with the
// device, and it is written down in docs/software.md.

const PAIR_ORDER = ["1", "2", "3", "4", "S"];
let pairBoxes = [];
let pairShown = false;

function buildPairKeys() {
  const grid = $("pairKeys");
  grid.innerHTML = "";
  pairBoxes = PAIR_ORDER.map(() => {
    const box = document.createElement("input");
    box.type = "text";
    box.inputMode = "numeric";
    box.maxLength = 1;
    box.autocomplete = "off";
    // Typing runs on by itself, and a backspace on an empty box steps back -
    // five separate fields should not mean five separate clicks.
    box.oninput = () => {
      box.value = box.value.replace(/[^0-9]/g, "").slice(0, 1);
      if (box.value) {
        const next = pairBoxes[pairBoxes.indexOf(box) + 1];
        if (next) next.focus();
      }
    };
    box.onkeydown = (event) => {
      if (event.key === "Backspace" && !box.value) {
        const previous = pairBoxes[pairBoxes.indexOf(box) - 1];
        if (previous) { previous.focus(); event.preventDefault(); }
      }
      if (event.key === "Enter") confirmPair();
    };
    return box;
  });

  // The set key first: it is the left-hand column and spans both rows, the
  // same shape the editor draws above.
  const setBox = document.createElement("div");
  setBox.className = "setBox";
  setBox.appendChild(pairBoxes[4]);
  grid.appendChild(setBox);
  for (let i = 0; i < 4; i++) grid.appendChild(pairBoxes[i]);
}

function pairCode() {
  return pairBoxes.map((box) => box.value).join("");
}

async function confirmPair() {
  const code = pairCode();
  if (code.length !== PAIR_ORDER.length) return;
  $("pairError").textContent = "";
  try {
    const response = await fetch("/api/pair/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const answer = await response.json();
    if (!response.ok) {
      $("pairError").textContent = answer.left
        ? answer.error + " (" + t("ui.pair_left", { left: answer.left }) + ")"
        : answer.error;
      pairBoxes.forEach((box) => { box.value = ""; });
      pairBoxes[0].focus();
      return;
    }
    hidePair();
    status(t("ui.pair_done"));
  } catch (error) {
    $("pairError").textContent = t("ui.pair_failed", { error: error.message });
  }
}

function hidePair() {
  pairShown = false;
  $("pairing").classList.remove("show");
}

// Asked for regularly, because nobody tells the page that somebody has just
// walked up to the talker and started a pairing.
//
// Deliberately without a check on document.hidden. It would save a few bytes
// on a local network and buy a failure that looks like nothing at all: a page
// the browser considers hidden - a second window, another desktop - would sit
// there while somebody stands at the device reading out digits.
async function watchPair() {
  try {
    const answer = await (await api("/api/pair")).json();
    const waiting = (answer.waiting || []).length > 0;
    if (waiting && !pairShown) {
      pairShown = true;
      buildPairKeys();
      $("pairError").textContent = "";
      $("pairing").classList.add("show");
      pairBoxes[0].focus();
    } else if (!waiting && pairShown) {
      // Gave up at the device, or the code ran out.
      hidePair();
    }
  } catch (error) {
    // A pairing nobody can ask about is not worth an error on screen.
  }
  setTimeout(watchPair, 5000);
}

// --- The voice ---------------------------------------------------------------
// The chosen voice stands in layout.json next to the language and is saved
// with everything else. What can be spoken with here is a different question,
// answered by the server on every open: a key entered in the meantime, or a
// model that has arrived, should show up without reloading the page.

let voices = { voices: [], active: "", chosen: "" };
// What is ticked in the sheet. Separate from voices.chosen, which is what
// stands in layout.json - between opening and pressing Save the two differ,
// and that difference is the whole point of having a Save.
let pendingVoice = "";

// Empty for a voice this installation does not have. That happens on a fresh
// machine, where the answer is a name nothing can speak yet, and after a key
// was withdrawn. Either way the raw id is not a label - nobody should have to
// read "azure:de-DE-GiselaNeural".
function labelOf(id) {
  const hit = voices.voices.find((voice) => voice.id === id);
  return hit ? hit.label : "";
}

async function loadVoices() {
  try {
    voices = await (await api("/api/voices")).json();
  } catch (error) {
    status(t("ui.voice_failed", { error: error.message }));
  }
}

// What a voice is tried out on: a sentence from the set being worked on, so
// one hears the actual content rather than a specimen. Only if there is none
// does the sample step in.
function sampleText() {
  const set = layout.sets[current];
  const slot = (set ? set.slots || [] : []).find((entry) => (entry.text || "").trim());
  return slot ? slot.text.trim() : t("ui.voice_sample");
}

function voiceRow(id, name, note, mute, on) {
  const row = document.createElement("div");
  row.className = "voiceRow" + (on ? " on" : "");

  const play = document.createElement("button");
  play.className = "play";
  play.textContent = "▶";
  play.title = t("ui.play_title");
  // Nothing to listen to for a voice that is not here. The button stays, so
  // the row keeps its shape, but it cannot be pressed.
  play.disabled = !!mute;
  // The voice of this row, not the saved one - otherwise trying one out would
  // mean committing to it first.
  play.onclick = () => speak(sampleText(), play, id || voices.active);

  const pick = document.createElement("button");
  pick.className = "pick";
  const naming = document.createElement("span");
  naming.textContent = name;
  pick.appendChild(naming);
  if (note) {
    const extra = document.createElement("span");
    extra.className = "note";
    extra.textContent = " " + note;
    pick.appendChild(extra);
  }
  pick.onclick = () => chooseVoice(id);

  row.appendChild(play);
  row.appendChild(pick);
  return row;
}

// The button that fetches what is missing. Sits under the list when there is
// one and in place of it when there is not - a machine that cannot speak at
// all should not have to be told about a command line.
function fetchRow() {
  const row = document.createElement("div");
  row.className = "voiceRow empty";
  const button = document.createElement("button");
  button.textContent = t("ui.voice_fetch");
  button.disabled = fetching.running;
  button.onclick = startFetch;
  row.appendChild(button);
  return row;
}

function renderVoices() {
  const list = $("voiceList");
  list.innerHTML = "";
  if (!voices.voices.length) {
    const empty = document.createElement("div");
    empty.className = "voiceRow empty";
    empty.textContent = t("ui.voice_none");
    list.appendChild(empty);
    if (fetching.missing) list.appendChild(fetchRow());
    $("voiceHint").textContent = fetchNote() || t("ui.voice_none_hint");
    return;
  }
  // An empty entry in layout.json means "whatever works here", and that is
  // the normal case for a fresh one. It is not shown as a choice of its own:
  // "Automatic" tells nobody anything, and a row that has to explain itself
  // is a row too many. Instead the voice it comes out as stands marked, with
  // a word to say nobody picked it by hand. Choosing any row writes it down,
  // and from then on the layout carries a decision instead of a default.
  const marked = pendingVoice || voices.active;
  for (const voice of voices.voices) {
    list.appendChild(voiceRow(
      voice.id, voice.label,
      !pendingVoice && voice.id === voices.active ? t("ui.voice_auto_note") : "",
      false, voice.id === marked));
  }
  // A voice can be chosen and not be here: a key withdrawn, a model deleted,
  // a layout carried over from another machine. It stays chosen on purpose -
  // so it has to be visible, or the list would show nothing as chosen and the
  // next save would quietly drop a deliberate decision.
  if (pendingVoice && !voices.voices.some((v) => v.id === pendingVoice)) {
    list.appendChild(voiceRow(pendingVoice, pendingVoice,
                              t("ui.voice_gone"), true, true));
  }
  if (fetching.missing) list.appendChild(fetchRow());
  $("voiceHint").textContent = fetchNote() || t("ui.voice_rebuild");
}

// --- Fetching the offline voices ---------------------------------------------
// About 130 MB, so the server downloads in the background and is asked how far
// it has got. Polling rather than a held-open request: this server answers one
// request per thread, and the interface should stay usable meanwhile.

let fetching = { running: false, done: 0, total: 0, name: "", error: "",
                 missing: 0 };
let fetchDone = false;   // finished in this dialog - worth saying so

// What the hint line says while a download runs, or "" when it has nothing
// to add and the usual note applies.
function fetchNote() {
  if (fetching.error) return fetching.error;
  if (fetching.running) {
    return t("ui.voice_fetching", {
      name: fetching.name,
      done: fetching.done + 1,
      total: fetching.total,
    });
  }
  return fetchDone ? t("ui.voice_fetch_done") : "";
}

async function readFetch() {
  try {
    fetching = await (await api("/api/voices/fetch")).json();
  } catch (error) {
    fetching = { running: false, done: 0, total: 0, name: "",
                 error: error.message, missing: 0 };
  }
}

async function startFetch() {
  fetchDone = false;
  try {
    await api("/api/voices/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
    fetching.error = error.message;
    renderVoices();
    return;
  }
  await readFetch();
  renderVoices();
  pollFetch();
}

// Stops by itself when the download is over. Two seconds is plenty: this is
// minutes of downloading, not milliseconds.
//
// One loop at a time: closing the dialog does not stop it, so opening it again
// would otherwise leave two of them polling and rendering over each other.
let polling = false;

function pollFetch() {
  if (polling) return;
  polling = true;
  setTimeout(async () => {
    polling = false;
    await readFetch();
    if (fetching.running) {
      renderVoices();
      pollFetch();
      return;
    }
    fetchDone = !fetching.error;
    // The voices themselves have to be asked for again - the list was empty
    // when the dialog opened.
    await loadVoices();
    renderVoices();
  }, 2000);
}

// Ticks a row. Nothing is written until Save - a voice changed by accident
// would mean every recording spoken again on the next release.
function chooseVoice(id) {
  pendingVoice = id;
  renderVoices();
}

// --- The rest of the settings ------------------------------------------------
// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.

let settings = { azureKey: { set: false, hint: "" }, azureRegion: "",
                 metacom: { path: "", ok: false, count: 0, keywords: false },
                 local: true };

function renderSettings() {
  $("azureRegion").value = settings.azureRegion || "";
  $("metacomPath").value = settings.metacom.path || "";
  $("azureKeyState").textContent = settings.azureKey.set
    ? t("ui.azure_key_set", { hint: settings.azureKey.hint })
    : t("ui.azure_key_none");
  // The key is never sent back to the page, so the field starts empty and
  // means "leave it alone" until somebody types in it.
  $("azureKey").value = "";
  $("azureKey").disabled = !settings.local;
  if (!settings.local) $("azureKeyState").textContent = t("ui.azure_local_only");

  const where = settings.metacom;
  $("metacomState").textContent = !where.path
    ? t("ui.metacom_none")
    : (where.ok
        ? t("ui.metacom_ok", {
            count: where.count,
            kind: t(where.keywords ? "ui.metacom_keywords" : "ui.metacom_names"),
          })
        : t("ui.metacom_bad"));
}

async function loadSettings() {
  try {
    settings = await (await api("/api/settings")).json();
    renderSettings();
  } catch (error) {
    status(t("ui.voice_failed", { error: error.message }));
  }
}

async function saveSettings() {
  const wanted = {
    azureRegion: $("azureRegion").value.trim(),
    metacom: $("metacomPath").value.trim(),
  };
  // Only when something was typed: an untouched field must not wipe the key.
  const typed = $("azureKey").value.trim();
  if (typed) wanted.azureKey = typed;
  const answer = await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wanted),
  });
  settings = await answer.json();
  renderSettings();
}

// One Save for the whole sheet, because that is how it reads: two panels and
// one button. The voice goes into layout.json, the rest into .env - which is
// the server's business, not something the page should make anybody think
// about.
async function saveVoice() {
  try {
    await saveSettings();
  } catch (error) {
    status(t("ui.save_failed", { error: error.message }));
    return;                       // stay open, the message is in the header
  }
  if (pendingVoice && pendingVoice !== voices.chosen) {
    layout.voice = pendingVoice;
    await save();
    // The server decides what the entry resolves to, so ask rather than guess -
    // and the release button has to light up, which save() already did.
  }
  // A key that has just arrived can mean Azure voices that were not there
  // when the sheet opened.
  await loadVoices();
  status(t("ui.settings_saved"));
  $("voices").close();
}

async function openVoices() {
  $("voiceList").innerHTML = "";
  $("voiceHint").textContent = "";
  fetchDone = false;
  $("voices").showModal();
  await Promise.all([loadVoices(), readFetch(), loadSettings()]);
  pendingVoice = voices.chosen;
  renderVoices();
  // A download started before this dialog was opened - in another tab, or
  // before a reload - still has something to report.
  if (fetching.running) pollFetch();
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
    if (!total) say(box, t("ui.nothing_found", { word: word }));
  } catch (error) {
    if (mine !== searchToken) return;
    if (total) {
      const note = document.createElement("p");
      note.textContent = t("ui.arasaac_down");
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
  status(t(item.source === "metacom" ? "ui.taking_symbol" : "ui.loading_symbol"));
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
    status(t("ui.symbol_failed", { error: error.message }));
  }
}

// Own picture: the file goes to the server raw, the name sits in the query
// string. That way no multipart form is needed.
$("uploadBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = async () => {
  const file = $("fileInput").files[0];
  $("fileInput").value = "";
  if (!file) return;
  status(t("ui.uploading"));
  try {
    const result = await (await api(
      "/api/upload?name=" + encodeURIComponent(file.name),
      { method: "POST", body: file }
    )).json();
    await applySymbol(result.symbol);
    status(t("ui.upload_done"));
  } catch (error) {
    status(t("ui.upload_failed", { error: error.message }));
  }
};

$("searchBtn").onclick = doSearch;
$("q").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); doSearch(); } };
$("closeBtn").onclick = () => $("picker").close();

removeSetBtn.onclick = async () => {
  if (!layout.sets.length) return;
  if (!confirm(t("ui.confirm_delete", { name: layout.sets[current].name || "" }))) return;
  layout.sets.splice(current, 1);
  current = Math.max(0, current - 1);
  await save();
  render();
};

$("releaseBtn").onclick = async () => {
  // Releasing what is on screen, not what the last debounce happened to
  // catch: save now and cancel the pending one, otherwise it fires
  // afterwards and writes the same thing a second time.
  clearTimeout(saveTimer);
  await save();
  $("releaseBtn").disabled = true;
  status(t("ui.releasing"));
  $("log").style.display = "block";
  $("log").textContent = t("ui.running");
  try {
    const result = await (await api("/api/build", { method: "POST" })).json();
    $("log").textContent = result.log.join("\n");
    markReleaseState("1");
    status(t("ui.released"));
  } catch (error) {
    $("log").textContent = t("ui.log_error", { error: error.message });
    status(t("ui.release_failed"));
  } finally {
    $("releaseBtn").disabled = false;
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
  $("q").placeholder = t(sources.metacom ? "ui.search_both" : "ui.search_arasaac");
  if (sources.metacom) {
    $("quellen").textContent = t("ui.credits_both");
  } else {
    // Where somebody is standing when they wish the pictograms were better.
    // Nobody opens settings to find out that a licence they own would be
    // searched too.
    $("quellen").textContent =
      t("ui.metacom_offer") + " " + t("ui.credits_arasaac");
  }
}

$("pairConfirm").onclick = confirmPair;
$("gear").onclick = openVoices;
$("voiceClose").onclick = () => $("voices").close();
$("voiceSave").onclick = saveVoice;
$("voiceCancel").onclick = () => $("voices").close();

// Labels first: without them the page shows empty buttons for as long as
// the first request takes.
applyTexts();
loadSources();
// The voices are not asked for here: nothing outside the settings shows them,
// and the sheet fetches them itself when it opens.
watchPair();
load().catch((error) => status(t("ui.load_failed", { error: error.message })));
</script>
</body>
</html>
"""


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
