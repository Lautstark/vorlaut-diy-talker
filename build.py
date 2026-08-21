#!/usr/bin/env python3
"""Builds everything the firmware needs from layout.json into firmware/data/.

Produces, per set S (1-based) and slot N (1-based):
  set<S>_slot<N>.wav   gesprochener Satz, 16 kHz mono 16 bit
  set<S>_slot<N>.bin   128x128 RGB565 big-endian, mit Set-Farbe als Rahmen
  set<S>_label.bin     the same for the set symbol
plus firmware/layout.h with all constants for the firmware.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import metacom

import tts

ROOT = Path(__file__).resolve().parent

# Everything that belongs to you - layout, symbols, spoken sentences - sits
# content/ and is deliberately not versioned. The location can be moved,
# for instance onto a network share:  VORLAUT_CONTENT=/volume1/talker
CONTENT = Path(os.environ.get("VORLAUT_CONTENT") or ROOT / "content").resolve()
EXAMPLE = ROOT / "example"

LAYOUT_FILE = CONTENT / "layout.json"
SYMBOLS_DIR = CONTENT / "symbols"
# Arduino requires the sketch folder to have the same name as the .ino file,
# and the LittleFS uploader looks for data/ right next to it. Hence this level.
BACKUP_DIR = CONTENT / "cache" / "layout-backups"
KEEP_BACKUPS = 60
# The web interface saves shortly after the last keystroke, so continuously
# while typing. Without a minimum interval the 60 slots fill up with snapshots
# of single words, and yesterday's state drops off the end.
BACKUP_MIN_INTERVAL = 5 * 60
SKETCH_DIR = ROOT / "firmware" / "vorlaut"
DATA_DIR = SKETCH_DIR / "data"

# How many go onto the device at once. Not arbitrary: a fully filled set
# costs around 300 KiB and the file area holds 1536 KiB. The same number
# steht als MAX_SETS in firmware/vorlaut/layout_format.h.
MAX_ACTIVE_SETS = 5
# Wie viele insgesamt in layout.json stehen duerfen. Keine Geraetegrenze -
# the collection lives on the computer. Just a guard against a file that
# niemand mehr ueberblickt.
MAX_SETS = 25
SLOTS_PER_SET = 4
IMG_SIZE = 128           # display area
BORDER = 6               # border width, drawn by the firmware
TILE_SIZE = IMG_SIZE - 2 * BORDER   # 116, what actually ends up as a file
TILE_CACHE = CONTENT / "cache" / "tiles"
TILE_INDEX = TILE_CACHE / "index.json"
# Haelt fest, welcher Stand zuletzt nach data/ gebaut wurde.
BUILD_STATE = CONTENT / "cache" / "build-state.json"
TILE_PIPELINE = 2        # bump when the rendering changes
DEFAULT_COLOR = "#3B5BDB"
# Suggestions for new sets, handed out in this order. The web interface
# fetches the same list so it does not have to be maintained twice.
DEFAULT_PALETTE = ["#3B5BDB", "#159947", "#9B7BFF", "#FF8BC7", "#FF6B35"]
DEFAULT_SLEEP_TIMEOUT = 600


METACOM_PREFIX = "metacom:"


def symbol_path(symbol: str) -> Path | None:
    """The image file for a symbol reference - or None when it does not exist.

    Two origins: a bare file name means symbols/ and therefore something that
    belongs to you. The prefix "metacom:" means the licensed collection, which
    lives outside the project and is only reachable through
    VORLAUT_METACOM_DIR. If that is missing, None comes back just like for any
    other missing symbol - the placeholder gets rendered instead.
    """
    if not symbol:
        return None
    if symbol.startswith(METACOM_PREFIX):
        return metacom.resolve(symbol[len(METACOM_PREFIX):])
    # The name comes from layout.json: discard everything but the file name,
    # so that "../" cannot lead out of symbols/.
    candidate = SYMBOLS_DIR / Path(symbol).name
    return candidate if candidate.exists() else None


def missing_hint(symbol: str) -> str:
    """Warum ein Symbol nicht auflösbar ist - als Satz fürs Bauprotokoll."""
    if symbol.startswith(METACOM_PREFIX):
        if not metacom.available():
            return (f"Symbol {symbol} kommt aus der METACOM-Sammlung, aber "
                    "VORLAUT_METACOM_DIR ist nicht gesetzt.")
        return f"Symbol {symbol} steht nicht in der METACOM-Sammlung."
    return f"Symbol {symbol} fehlt in symbols/."


class BuildError(RuntimeError):
    pass


# --- layout.json -------------------------------------------------------------

def empty_set(index: int = 0) -> dict:
    return {
        "name": f"Set {index + 1}",
        "active": True,
        "symbol": "",
        "color": DEFAULT_PALETTE[index % len(DEFAULT_PALETTE)],
        "slots": [{"text": "", "symbol": ""} for _ in range(SLOTS_PER_SET)],
    }


def normalize_color(value: str) -> str:
    value = (value or "").strip()
    if not value.startswith("#"):
        value = "#" + value
    if len(value) == 4:  # #abc -> #aabbcc
        value = "#" + "".join(ch * 2 for ch in value[1:])
    if len(value) != 7:
        return DEFAULT_COLOR
    try:
        int(value[1:], 16)
    except ValueError:
        return DEFAULT_COLOR
    return value.upper()


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = normalize_color(value)
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def rgb_to_565(r: int, g: int, b: int) -> int:
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def ensure_content() -> None:
    """Creates content/ and fills it from example/ the first time round.

    That way a freshly cloned project shows something right away, without
    anyone having to create files by hand.
    """
    CONTENT.mkdir(parents=True, exist_ok=True)
    SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    if LAYOUT_FILE.exists():
        return
    example_file = EXAMPLE / "layout.json"
    if example_file.exists():
        shutil.copyfile(example_file, LAYOUT_FILE)
        for file in sorted((EXAMPLE / "symbols").glob("*")):
            target = SYMBOLS_DIR / file.name
            if not target.exists():
                shutil.copyfile(file, target)
        print(f"content/ mit den Beispielen aus example/ gefüllt.", flush=True)
    else:
        LAYOUT_FILE.write_text(
            json.dumps({"sleep_timeout_seconds": DEFAULT_SLEEP_TIMEOUT, "sets": []},
                       indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_layout(path: Path = LAYOUT_FILE) -> dict:
    """Reads layout.json and brings it into a guaranteed complete shape."""
    if not path.exists():
        raise BuildError(f"{path.name} nicht gefunden.")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"{path.name} ist kein gültiges JSON: {exc}") from exc
    return normalize_layout(raw)


def normalize_layout(raw: dict) -> dict:
    timeout = raw.get("sleep_timeout_seconds", DEFAULT_SLEEP_TIMEOUT)
    try:
        timeout = int(timeout)
    except (TypeError, ValueError):
        timeout = DEFAULT_SLEEP_TIMEOUT
    timeout = max(10, min(timeout, 24 * 3600))

    language = str(raw.get("language") or DEFAULT_LANGUAGE).strip().lower()
    if language not in LANGUAGE_CODES:
        # Not an error: an unknown language costs the menu labels, not the
        # content. The device would fall back to English by itself, and it is
        # better to say so than to stop a build over it.
        language = DEFAULT_LANGUAGE

    sets = raw.get("sets") or []
    if not isinstance(sets, list):
        raise BuildError("\"sets\" muss eine Liste sein.")
    if len(sets) > MAX_SETS:
        raise BuildError(f"Höchstens {MAX_SETS} Sets, gefunden: {len(sets)}.")

    clean_sets = []
    for index, entry in enumerate(sets):
        entry = entry if isinstance(entry, dict) else {}
        slots = entry.get("slots") or []
        if not isinstance(slots, list):
            slots = []
        # Exactly 4 slots: pad the missing ones, surplus ones are an error.
        if len(slots) > SLOTS_PER_SET:
            raise BuildError(
                f"Set {index + 1} hat {len(slots)} Slots, erlaubt sind genau "
                f"{SLOTS_PER_SET}."
            )
        while len(slots) < SLOTS_PER_SET:
            slots.append({"text": "", "symbol": ""})
        clean_slots = []
        for slot in slots:
            slot = slot if isinstance(slot, dict) else {}
            clean_slots.append(
                {
                    "text": str(slot.get("text") or "").strip(),
                    "symbol": str(slot.get("symbol") or "").strip(),
                }
            )
        clean_sets.append(
            {
                "name": str(entry.get("name") or f"Set {index + 1}").strip(),
                # If the field is absent the set is active - that keeps
                # layouts from before this distinction valid unchanged.
                "active": bool(entry.get("active", True)),
                "symbol": str(entry.get("symbol") or "").strip(),
                "color": normalize_color(entry.get("color") or empty_set(index)["color"]),
                "slots": clean_slots,
            }
        )

    active = sum(1 for entry in clean_sets if entry["active"])
    if active > MAX_ACTIVE_SETS:
        raise BuildError(
            f"Höchstens {MAX_ACTIVE_SETS} Sets gleichzeitig aktiv, "
            f"gewählt sind {active}. Mehr passen nicht aufs Gerät."
        )

    return {
        "sleep_timeout_seconds": timeout,
        "language": language,
        "sets": clean_sets,
    }


def active_sets(layout: dict) -> list[dict]:
    """The sets that go onto the device, in the order of the layout."""
    return [entry for entry in layout["sets"] if entry.get("active", True)]


def built_fingerprint(layout: dict) -> str:
    """Identifier of what actually ends up in data/.

    Deliberately the active sets only: working on a switched-off set changes
    nothing on the device and should therefore not be reported as a rebuild.
    """
    payload = {
        "sleep": layout["sleep_timeout_seconds"],
        "language": layout.get("language", DEFAULT_LANGUAGE),
        "sets": active_sets(layout),
        "pipeline": TILE_PIPELINE,
        "format": LAYOUT_VERSION,
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def device_manifest() -> dict:
    """What should sit on the device: version stamp and file list.

    The file names are hashes of their content - so this list is all the
    device needs to know what it is missing and what it can throw away. Only
    layout.bin always has the same name and gets fetched every time.
    """
    layout = load_layout()
    files = [
        {"name": f.name, "size": f.stat().st_size}
        for f in sorted(DATA_DIR.iterdir()) if f.is_file()
    ] if DATA_DIR.is_dir() else []
    return {
        "version": built_fingerprint(layout),
        "sets": len(active_sets(layout)),
        "files": files,
        "bytes": sum(f["size"] for f in files),
    }


def _remember_build(layout: dict) -> None:
    """Haelt fest, welcher Stand gerade nach data/ gebaut wurde."""
    try:
        BUILD_STATE.parent.mkdir(parents=True, exist_ok=True)
        BUILD_STATE.write_text(
            json.dumps({"fingerprint": built_fingerprint(layout)}) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass   # without the note the interface says "rebuild" more often


def build_is_current(layout: dict | None = None) -> bool:
    """Entspricht data/ dem aktuellen Layout?

    What goes undetected is a symbol file changing under the same name - that
    would mean hashing every image on every query.
    """
    if not (DATA_DIR / "layout.bin").exists():
        return False
    try:
        stored = json.loads(BUILD_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if layout is None:
        try:
            layout = load_layout()
        except BuildError:
            return False
    return stored.get("fingerprint") == built_fingerprint(layout)


def backup_layout(path: Path = LAYOUT_FILE) -> None:
    """Puts the previous state aside before it gets overwritten.

    Cheap insurance: the web interface always saves the whole file, so a
    misstep would otherwise be final.

    Not on every save: unchanged content needs no backup, and shortly after
    the last one the older state is the more valuable - pushing it out with a
    snapshot from ten seconds ago helps nobody.
    """
    if not path.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    previous = sorted(BACKUP_DIR.glob("layout-*.json"))
    if previous:
        latest = previous[-1]
        try:
            if latest.read_bytes() == path.read_bytes():
                return
            age = datetime.datetime.now().timestamp() - latest.stat().st_mtime
            if age < BACKUP_MIN_INTERVAL:
                return
        except OSError:
            pass   # unreadable: then rather back up than not

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    shutil.copyfile(path, BACKUP_DIR / f"layout-{stamp}.json")
    old_files = sorted(BACKUP_DIR.glob("layout-*.json"))
    for stale in old_files[:-KEEP_BACKUPS]:
        stale.unlink()


def save_layout(layout: dict, path: Path = LAYOUT_FILE) -> dict:
    layout = normalize_layout(layout)
    backup_layout(path)
    path.write_text(
        json.dumps(layout, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return layout


# --- Bilder ------------------------------------------------------------------

def _require_pillow():
    try:
        from PIL import Image, ImageDraw  # noqa: F401
    except ImportError as exc:
        raise BuildError(
            "Pillow fehlt. Installieren mit:  pip install -r requirements.txt"
        ) from exc
    from PIL import Image, ImageDraw
    return Image, ImageDraw


def fill_colour(picture) -> tuple[int, int, int]:
    """The colour for the area left over next to a symbol.

    Not every symbol is square - METACOM ships 706x589 - so in the square tile
    a strip remains at the top and bottom. White is right there as long as the
    symbol is drawn on a light background. With the edge-to-edge coloured
    symbols - "ja" is green throughout, "nein" red - it would instead produce
    a visible white bar.

    Hence: no alpha channel and all four corners the same colour means
    edge-to-edge coloured, and that colour continues into the strip.
    Otherwise it stays white - dark line art needs the light ground, and a
    colourful ground would take the contrast away.
    """
    if picture.getchannel("A").getextrema()[0] < 255:
        return (255, 255, 255)
    width, height = picture.size
    corners = {picture.getpixel(xy)[:3] for xy in
               ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))}
    return corners.pop() if len(corners) == 1 else (255, 255, 255)


def render_symbol(symbol: str) -> bytes:
    """116x116 symbol area on white, without a border.

    The coloured border does not go into the image - the firmware draws it
    from SET_COLORS. That makes this file depend on the symbol alone: the same
    picture in two differently coloured sets is exactly one file.

    Returns raw RGB565 data, big-endian, in the form the ST7735 panel
    expected_size.
    """
    Image, ImageDraw = _require_pillow()

    inner_size = TILE_SIZE
    inner = Image.new("RGB", (inner_size, inner_size), (255, 255, 255))

    source_path = symbol_path(symbol)
    if source_path:
        with Image.open(source_path) as raw:
            picture = raw.convert("RGBA")
        ground = fill_colour(picture)
        inner = Image.new("RGB", (inner_size, inner_size), ground)
        picture.thumbnail((inner_size, inner_size), Image.LANCZOS)
        # Composite transparency onto the ground, otherwise it turns black.
        backdrop = Image.new("RGBA", picture.size, ground + (255,))
        backdrop.alpha_composite(picture)
        offset = (
            (inner_size - picture.width) // 2,
            (inner_size - picture.height) // 2,
        )
        inner.paste(backdrop.convert("RGB"), offset)
    else:
        # Placeholder: empty field with a grey cross, so one sees at once
        # that a symbol is still missing here.
        draw = ImageDraw.Draw(inner)
        pad = inner_size // 4
        grey = (200, 200, 200)
        draw.line((pad, pad, inner_size - pad, inner_size - pad), fill=grey, width=4)
        draw.line((inner_size - pad, pad, pad, inner_size - pad), fill=grey, width=4)

    return to_rgb565_be(inner)


def tile_fingerprint(symbol: str) -> str:
    """Hängt nur am Inhalt des Symbols, nicht an Name, Set oder Farbe."""
    source = symbol_path(symbol)
    if source:
        content = hashlib.sha256(source.read_bytes()).hexdigest()
    else:
        content = "platzhalter"
    raw = json.dumps(
        {"content": content, "size": TILE_SIZE, "pipeline": TILE_PIPELINE},
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def load_tile_index() -> dict:
    if not TILE_INDEX.exists():
        return {}
    try:
        data = json.loads(TILE_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def tile_bytes(symbol: str) -> bytes:
    """Gerenderte Symbolfläche, aus dem Cache oder frisch erzeugt."""
    key = tile_fingerprint(symbol)
    path = TILE_CACHE / f"{key}.bin"
    index = load_tile_index()
    if index.get(key) != (symbol or ""):
        index[key] = symbol or ""
        TILE_CACHE.mkdir(parents=True, exist_ok=True)
        TILE_INDEX.write_text(
            json.dumps(index, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    if path.exists():
        return path.read_bytes()
    data = render_symbol(symbol)
    TILE_CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def to_rgb565_be(image) -> bytes:
    width, height = image.size
    pixels = image.tobytes("raw", "RGB")
    out = bytearray(width * height * 2)
    write = 0
    for read in range(0, len(pixels), 3):
        value = rgb_to_565(pixels[read], pixels[read + 1], pixels[read + 2])
        out[write] = value >> 8
        out[write + 1] = value & 0xFF
        write += 2
    return bytes(out)


# --- layout.bin --------------------------------------------------------------
#
# The table - how many sets, which colours, which file per key - sits with
# the content and not in the firmware. Otherwise a new set would mean
# reflashing over a cable.
#
# Deliberately a fixed binary structure and not JSON: it lets the firmware
# read field by field, without a parser.
#
#   header  4  magic "MTRD"
#           1  version
#           1  number of sets
#           1  keys per set
#           1  language (index into LANGUAGES in firmware/vorlaut/texts.h)
#           4  sleep timeout in seconds
#   per set 2  colour as RGB565
#          32  name, padded with null bytes
#          16  hash of the set tile
#             per key (4x):
#          16     hash of the image
#          16     hash of the audio
#           1     1 = audio present
#           1     reserved
LAYOUT_BIN = "layout.bin"
LAYOUT_MAGIC = b"MTRD"
LAYOUT_VERSION = 1

# The language the device labels its own menu in. The order has to match
# LANGUAGES in firmware/vorlaut/texts.h - the file carries the index, not
# the name, because there is exactly one byte for it.
#
# That byte used to be reserved and written as zero. Zero is English, so an
# older layout.bin stays readable and the format version can stay at 1.
#
# This says nothing about the content: the words on the keys are whatever
# somebody typed. It is only about the four labels the firmware draws itself.
LANGUAGE_CODES = {"en": 0, "de": 1}
DEFAULT_LANGUAGE = "en"
NAME_BYTES = 32
HASH_BYTES = 16
# Fixed strides - the firmware works with the same numbers.
SLOT_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1        # 34
SET_BYTES = 2 + NAME_BYTES + HASH_BYTES + SLOTS_PER_SET * SLOT_BYTES   # 186
HEADER_BYTES = 4 + 4 + 4                            # 12


def _hash_bytes(filename: str) -> bytes:
    """The 16 raw hash bytes out of "t3bd7a62….bin"."""
    if not filename:
        return b"\x00" * HASH_BYTES
    core = Path(filename).stem[1:]           # drop the leading t or a
    return bytes.fromhex(core)[:HASH_BYTES].ljust(HASH_BYTES, b"\x00")


def render_layout_bin(layout: dict, label_files, tile_files, audio_files) -> bytes:
    # The active sets only - the file lists are built the same way, and
    # setCount in the header has to match them.
    sets = active_sets(layout)
    data = bytearray()
    data += LAYOUT_MAGIC
    language = LANGUAGE_CODES.get(layout.get("language", DEFAULT_LANGUAGE),
                                  LANGUAGE_CODES[DEFAULT_LANGUAGE])
    data += struct.pack("<BBBB", LAYOUT_VERSION, len(sets), SLOTS_PER_SET,
                        language)
    data += struct.pack("<I", layout["sleep_timeout_seconds"])
    for index, entry in enumerate(sets):
        data += struct.pack("<H", rgb_to_565(*hex_to_rgb(entry["color"])))
        data += entry["name"].encode("utf-8")[:NAME_BYTES].ljust(NAME_BYTES, b"\x00")
        data += _hash_bytes(label_files[index])
        for slot in range(SLOTS_PER_SET):
            ton = audio_files[index][slot]
            data += _hash_bytes(tile_files[index][slot])
            data += _hash_bytes(ton)
            data += struct.pack("<BB", 1 if ton else 0, 0)
    return bytes(data)


# --- Building -------------------------------------------------------------------

def build(with_audio: bool = True, force_audio: bool = False) -> list[str]:
    """Builds everything and returns the log as a list of lines."""
    log: list[str] = []

    def note(message: str) -> None:
        log.append(message)
        print(message, flush=True)

    ensure_content()
    layout = load_layout()
    # Only the selection goes onto the device. The rest stays in layout.json,
    # tiles and audio included in the cache - switching one back on therefore
    # costs neither compute time nor an Azure call.
    sets = active_sets(layout)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not layout["sets"]:
        note("layout.json enthält keine Sets - es gibt nichts zu bauen.")
    elif not sets:
        note("Kein Set ist aktiv - das Gerät hätte nichts anzuzeigen.")
    elif len(sets) != len(layout["sets"]):
        note(f"{len(sets)} von {len(layout['sets'])} Sets aktiv.")

    expected: set[str] = set()
    audio_ok = True

    # Without a key nothing new can be spoken - but everything already in
    # the cache can still be used. That is exactly what makes a
    # frischen Klon des Repos ohne Azure-Zugang brauchbar.
    no_key = with_audio and not tts.have_key()

    # The file names on the device are hashes of the content. That means the
    # same symbol or the same sentence sits there exactly once, no matter how
    # many sets it appears in - and a file can never go stale without its name
    # changing along with it.
    tile_files: list[list[str]] = []   # [set][slot] -> file name
    audio_files: list[list[str]] = []
    label_files: list[str] = []

    def store_tile(symbol: str) -> str:
        key = tile_fingerprint(symbol)
        name = f"t{key}.bin"
        expected.add(name)
        target = DATA_DIR / name
        if not target.exists():
            target.write_bytes(tile_bytes(symbol))
        return name

    for index, entry in enumerate(sets, start=1):
        # The number is the position in the order on the device, not the one
        # in layout.json - with switched-off sets the two drift apart, which
        # is why the name is always alongside.
        label = (f"Set {index}" if entry["name"] == f"Set {index}"
                 else f"Set {index} ({entry['name']})")
        # Set-Kachel
        label_files.append(store_tile(entry["symbol"]))
        if not entry["symbol"]:
            note(f"{label}: noch kein Set-Symbol gewählt.")
        elif symbol_path(entry["symbol"]) is None:
            note(f"{label}: {missing_hint(entry['symbol'])}")

        tile_names: list[str] = []
        audio_names: list[str] = []
        for slot_index, slot in enumerate(entry["slots"], start=1):
            tile_names.append(store_tile(slot["symbol"]))
            if slot["symbol"] and symbol_path(slot["symbol"]) is None:
                note(f"{label} Slot {slot_index}: {missing_hint(slot['symbol'])}")

            if not slot["text"]:
                note(f"{label} Slot {slot_index}: kein Text - kein Ton.")
                audio_names.append("")
                continue

            if not with_audio:
                audio_names.append("")
                continue

            in_cache = tts.cache_path(slot["text"]).exists()
            if no_key and (not in_cache or force_audio):
                audio_ok = False
                note(
                    f"{label} Slot {slot_index}: \"{slot['text']}\" liegt "
                    "nicht im Cache und ohne AZURE_SPEECH_KEY lässt es sich "
                    "nicht sprechen."
                )
                audio_names.append("")
                continue

            try:
                cached = tts.synthesize(slot["text"], force=force_audio)
            except tts.TTSError as exc:
                audio_ok = False
                note(f"WARNUNG: TTS fehlgeschlagen bei \"{slot['text']}\": {exc}")
                audio_names.append("")
                continue

            name = f"a{tts.fingerprint(slot['text'])}.wav"
            expected.add(name)
            target = DATA_DIR / name
            if not target.exists() or target.stat().st_size != cached.stat().st_size:
                shutil.copyfile(cached, target)
            audio_names.append(name)
            note(f"{label} Slot {slot_index}: \"{slot['text']}\"")

        tile_files.append(tile_names)
        audio_files.append(audio_names)

    # Remove leftovers from earlier runs, so no old set stays behind.
    for existing in DATA_DIR.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
            note(f"entfernt: {existing.name}")

    expected.add(LAYOUT_BIN)
    (DATA_DIR / LAYOUT_BIN).write_bytes(
        render_layout_bin(layout, label_files, tile_files, audio_files))
    note(f"geschrieben: {(DATA_DIR / LAYOUT_BIN).relative_to(ROOT)}")

    total = sum(f.stat().st_size for f in DATA_DIR.iterdir() if f.is_file())
    _remember_build(layout)
    note(
        f"Fertig: {len(sets)} Set(s), "
        f"{sum(1 for f in DATA_DIR.iterdir() if f.is_file())} Dateien, "
        f"{total / 1024:.0f} KiB in {DATA_DIR.relative_to(ROOT)}/"
    )
    if not audio_ok:
        note("Hinweis: Es fehlen Tondateien - siehe Warnungen oben.")

    # Building only produces files. Nothing changes on the device from that -
    # it is a separate step, and without this note one wonders why.
    note("")
    note("Aufs Gerät kommen die Dateien damit noch nicht. Dafür:")
    note("  python build.py --fs-image   und der Befehl, den es ausgibt")
    note("  Einzelheiten in docs/firmware.md")
    return log


# Values from default_8MB.csv of the ESP32 core - the partition is called
# "spiffs" there, and that is exactly the one LittleFS mounts.
FS_SIZE = 0x180000       # 1536 KiB
FS_OFFSET = 0x670000
FS_IMAGE = SKETCH_DIR / "littlefs.bin"


def find_tool(name: str) -> Path | None:
    """Sucht ein Werkzeug im ESP32-Core der Arduino-IDE."""
    for base in (
        Path.home() / "Library/Arduino15/packages/esp32/tools",
        Path.home() / ".arduino15/packages/esp32/tools",
    ):
        folder = base / ("esptool_py" if name == "esptool" else name)
        if folder.exists():
            hits = sorted(folder.glob(f"*/{name}"))
            if hits:
                return hits[-1]
    return None


def build_fs_image() -> list[str]:
    """Packs firmware/vorlaut/data/ into a LittleFS image for flashing."""
    log: list[str] = []
    tool = find_tool("mklittlefs")
    if not tool:
        raise BuildError(
            "mklittlefs not found. It comes with the ESP32 core of the "
            "Arduino IDE; without it no image can be built."
        )
    used = sum(f.stat().st_size for f in DATA_DIR.iterdir() if f.is_file())
    if used > FS_SIZE:
        raise BuildError(
            f"The data is {used / 1024:.0f} KiB, the file area holds only "
            f"{FS_SIZE / 1024:.0f} KiB."
        )
    result = subprocess.run(
        [str(tool), "-c", str(DATA_DIR), "-b", "4096", "-p", "256",
         "-s", str(FS_SIZE), str(FS_IMAGE)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise BuildError(f"mklittlefs failed: {result.stderr.strip()[:300]}")
    esptool = find_tool("esptool")
    call = str(esptool) if esptool else "esptool"
    for line in [
        f"Image: {FS_IMAGE.relative_to(ROOT)}  "
        f"({used / 1024:.0f} of {FS_SIZE / 1024:.0f} KiB used)",
        "Find the port with:  arduino-cli board list",
        "Write it with:",
        f"  {call} \\",
        f"    --chip esp32s3 --port /dev/cu.usbmodemXXXX \\",
        f"    write-flash 0x{FS_OFFSET:X} {FS_IMAGE.relative_to(ROOT)}",
    ]:
        log.append(line)
        print(line, flush=True)
    return log


def prune_cache() -> list[str]:
    """Entfernt Sprachdateien und Kacheln, die in layout.json nicht mehr vorkommen."""
    log: list[str] = []
    ensure_content()
    layout = load_layout()

    # Kacheln
    needed_tiles = {
        tile_fingerprint(sym)
        for entry in layout["sets"]
        for sym in [entry["symbol"], *(slot["symbol"] for slot in entry["slots"])]
    }
    tile_index = load_tile_index()
    tiles_removed = 0
    for file in sorted(TILE_CACHE.glob("*.bin")):
        if file.stem not in needed_tiles:
            symbol = tile_index.pop(file.stem, None)
            log.append(f"removed: Kachel {symbol or file.name}")
            file.unlink()
            tiles_removed += 1
    if tiles_removed:
        TILE_INDEX.write_text(
            json.dumps(tile_index, indent=2, ensure_ascii=False, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )

    needed = {
        tts.fingerprint(slot["text"])
        for entry in layout["sets"]
        for slot in entry["slots"]
        if slot["text"]
    }
    index = tts.load_index()
    removed = 0
    for file in sorted(tts.CACHE_DIR.glob("*.wav")):
        if file.stem not in needed:
            text = index.pop(file.stem, None)
            log.append(f"removed: {text!r}" if text else f"removed: {file.name}")
            file.unlink()
            removed += 1
    if removed:
        tts.INDEX_FILE.write_text(
            json.dumps(index, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    log.append(
        f"{removed} verwaiste Sprachdatei(en) und {tiles_removed} Kachel(n) removed."
    )
    for line in log:
        print(line, flush=True)
    return log


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="vorlaut: build firmware/data")
    parser.add_argument(
        "--no-audio", action="store_true", help="build images and layout only"
    )
    parser.add_argument(
        "--force-audio", action="store_true", help="re-render all WAVs"
    )
    parser.add_argument(
        "--fs-image",
        action="store_true",
        help="also build a LittleFS image for flashing",
    )
    parser.add_argument(
        "--prune-cache",
        action="store_true",
        help="delete speech files no longer referenced by layout.json",
    )
    args = parser.parse_args(argv[1:])
    if args.prune_cache:
        try:
            prune_cache()
        except (BuildError, tts.TTSError) as exc:
            print(f"Fehler: {exc}", file=sys.stderr)
            return 1
        return 0
    try:
        build(with_audio=not args.no_audio, force_audio=args.force_audio)
        if args.fs_image:
            build_fs_image()
    except (BuildError, tts.TTSError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
