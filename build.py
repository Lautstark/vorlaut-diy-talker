#!/usr/bin/env python3
"""Baut aus layout.json alles, was die Firmware braucht, nach firmware/data/.

Erzeugt pro Set S (1-basiert) und Slot N (1-basiert):
  set<S>_slot<N>.wav   gesprochener Satz, 16 kHz mono 16 bit
  set<S>_slot<N>.bin   128x128 RGB565 big-endian, mit Set-Farbe als Rahmen
  set<S>_label.bin     dasselbe für das Set-Symbol
und dazu firmware/layout.h mit allen Konstanten für die Firmware.
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

import tts

ROOT = Path(__file__).resolve().parent

# Alles, was dir gehört - Layout, Symbole, gesprochene Sätze - liegt unter
# content/ und ist bewusst nicht versioniert. Der Ort lässt sich verlegen,
# etwa auf eine Netzfreigabe:  VORLAUT_CONTENT=/volume1/talker
CONTENT = Path(os.environ.get("VORLAUT_CONTENT") or ROOT / "content").resolve()
EXAMPLE = ROOT / "example"

LAYOUT_FILE = CONTENT / "layout.json"
SYMBOLS_DIR = CONTENT / "symbols"
# Arduino verlangt, dass der Sketch-Ordner so heißt wie die .ino-Datei, und
# der LittleFS-Uploader sucht data/ direkt daneben. Deshalb diese Ebene.
BACKUP_DIR = CONTENT / "cache" / "layout-backups"
KEEP_BACKUPS = 60
SKETCH_DIR = ROOT / "firmware" / "vorlaut"
DATA_DIR = SKETCH_DIR / "data"

MAX_SETS = 5
SLOTS_PER_SET = 4
IMG_SIZE = 128           # Displayfläche
BORDER = 6               # Rahmenbreite, wird von der Firmware gezeichnet
TILE_SIZE = IMG_SIZE - 2 * BORDER   # 116, was tatsächlich als Datei anfällt
TILE_CACHE = CONTENT / "cache" / "tiles"
TILE_INDEX = TILE_CACHE / "index.json"
TILE_PIPELINE = 1        # hochzählen, wenn sich das Rendern ändert
DEFAULT_COLOR = "#3B5BDB"
# Vorschläge für neue Sets, in dieser Reihenfolge vergeben. Die Oberfläche
# holt sich dieselbe Liste, damit sie nicht doppelt gepflegt werden muss.
DEFAULT_PALETTE = ["#3B5BDB", "#159947", "#9B7BFF", "#FF8BC7", "#FF6B35"]
DEFAULT_SLEEP_TIMEOUT = 600


class BuildError(RuntimeError):
    pass


# --- layout.json -------------------------------------------------------------

def empty_set(index: int = 0) -> dict:
    return {
        "name": f"Set {index + 1}",
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
    """Legt content/ an und füllt es beim ersten Mal aus example/.

    So zeigt ein frisch geklontes Projekt sofort etwas an, ohne dass jemand
    von Hand Dateien anlegen muss.
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
    """Liest layout.json und bringt es in eine garantiert vollständige Form."""
    if not path.exists():
        raise BuildError(f"{path.name} nicht found.")
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

    sets = raw.get("sets") or []
    if not isinstance(sets, list):
        raise BuildError("\"sets\" muss eine Liste sein.")
    if len(sets) > MAX_SETS:
        raise BuildError(f"Höchstens {MAX_SETS} Sets, found: {len(sets)}.")

    clean_sets = []
    for index, entry in enumerate(sets):
        entry = entry if isinstance(entry, dict) else {}
        slots = entry.get("slots") or []
        if not isinstance(slots, list):
            slots = []
        # Genau 4 Slots: fehlende auffüllen, überzählige sind ein Fehler.
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
                "symbol": str(entry.get("symbol") or "").strip(),
                "color": normalize_color(entry.get("color") or empty_set(index)["color"]),
                "slots": clean_slots,
            }
        )

    return {"sleep_timeout_seconds": timeout, "sets": clean_sets}


def backup_layout(path: Path = LAYOUT_FILE) -> None:
    """Legt den bisherigen Stand beiseite, bevor er überschrieben wird.

    Billige Versicherung: die Oberfläche speichert immer die ganze Datei, und
    ein Fehlgriff ist damit sonst endgültig.
    """
    if not path.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
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


def render_symbol(symbol: str) -> bytes:
    """116x116 Symbolfläche auf Weiß, ohne Rahmen.

    Der farbige Rahmen kommt nicht mit ins Bild - den zeichnet die Firmware
    aus SET_COLORS. Dadurch hängt diese Datei nur am Symbol: dasselbe Bild in
    zwei verschieden farbigen Sets ist genau eine Datei.

    Rückgabe sind rohe RGB565-Daten, big-endian, wie sie das ST7735-Panel
    expected_size.
    """
    Image, ImageDraw = _require_pillow()

    inner_size = TILE_SIZE
    inner = Image.new("RGB", (inner_size, inner_size), (255, 255, 255))

    source_path = SYMBOLS_DIR / symbol if symbol else None
    if source_path and source_path.exists():
        with Image.open(source_path) as raw:
            picture = raw.convert("RGBA")
        picture.thumbnail((inner_size, inner_size), Image.LANCZOS)
        # Transparenz auf Weiß legen, sonst wird sie schwarz.
        backdrop = Image.new("RGBA", picture.size, (255, 255, 255, 255))
        backdrop.alpha_composite(picture)
        offset = (
            (inner_size - picture.width) // 2,
            (inner_size - picture.height) // 2,
        )
        inner.paste(backdrop.convert("RGB"), offset)
    else:
        # Platzhalter: leeres Feld mit grauem Kreuz, damit man sofort sieht,
        # dass hier noch ein Symbol fehlt.
        draw = ImageDraw.Draw(inner)
        pad = inner_size // 4
        grey = (200, 200, 200)
        draw.line((pad, pad, inner_size - pad, inner_size - pad), fill=grey, width=4)
        draw.line((inner_size - pad, pad, pad, inner_size - pad), fill=grey, width=4)

    return to_rgb565_be(inner)


def tile_fingerprint(symbol: str) -> str:
    """Hängt nur am Inhalt des Symbols, nicht an Name, Set oder Farbe."""
    source = SYMBOLS_DIR / symbol if symbol else None
    if source and source.exists():
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
    breite, höhe = image.size
    pixels = image.tobytes("raw", "RGB")
    out = bytearray(breite * höhe * 2)
    write = 0
    for read in range(0, len(pixels), 3):
        value = rgb_to_565(pixels[read], pixels[read + 1], pixels[read + 2])
        out[write] = value >> 8
        out[write + 1] = value & 0xFF
        write += 2
    return bytes(out)


# --- layout.bin --------------------------------------------------------------
#
# Die Tabelle - wie viele Sets, welche Farben, welche Datei je Taste - liegt
# beim Inhalt und nicht in der Firmware. Sonst müsste man ein neues Set mit
# Kabel aufspielen.
#
# Bewusst eine feste Binärstruktur und kein JSON: die Firmware liest damit
# Feld für Feld, ohne Parser.
#
#   Kopf   4  Kennung "MTRD"
#          1  Version
#          1  Anzahl Sets
#          1  Tasten je Set
#          1  frei
#          4  Schlafzeit in Sekunden
#   je Set 2  Farbe als RGB565
#         32  Name, mit Nullbytes aufgefüllt
#         16  Hash der Set-Kachel
#            je Taste (4x):
#         16     Hash des Bildes
#         16     Hash des Tons
#          1     1 = Ton vorhanden
#          1     frei
LAYOUT_BIN = "layout.bin"
LAYOUT_MAGIC = b"MTRD"
LAYOUT_VERSION = 1
NAME_BYTES = 32
HASH_BYTES = 16
# Feste Schrittweiten - die Firmware rechnet mit denselben Zahlen.
SLOT_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1        # 34
SET_BYTES = 2 + NAME_BYTES + HASH_BYTES + SLOTS_PER_SET * SLOT_BYTES   # 186
HEADER_BYTES = 4 + 4 + 4                            # 12


def _hash_bytes(dateiname: str) -> bytes:
    """Aus "t3bd7a62….bin" die 16 rohen Hash-Bytes."""
    if not dateiname:
        return b"\x00" * HASH_BYTES
    core = Path(dateiname).stem[1:]          # führendes t oder a weg
    return bytes.fromhex(core)[:HASH_BYTES].ljust(HASH_BYTES, b"\x00")


def render_layout_bin(layout: dict, label_files, tile_files, audio_files) -> bytes:
    sets = layout["sets"]
    data = bytearray()
    data += LAYOUT_MAGIC
    data += struct.pack("<BBBB", LAYOUT_VERSION, len(sets), SLOTS_PER_SET, 0)
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


# --- Bauen -------------------------------------------------------------------

def build(with_audio: bool = True, force_audio: bool = False) -> list[str]:
    """Baut alles und liefert das Protokoll als Liste von Zeilen."""
    log: list[str] = []

    def note(message: str) -> None:
        log.append(message)
        print(message, flush=True)

    ensure_content()
    layout = load_layout()
    sets = layout["sets"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not sets:
        note("layout.json enthält keine Sets - es gibt nichts zu bauen.")

    expected: set[str] = set()
    audio_ok = True

    # Ohne Key lässt sich nichts Neues sprechen - aber alles, was schon im
    # Cache liegt, kann trotzdem verwendet werden. Genau das macht einen
    # frischen Klon des Repos ohne Azure-Zugang brauchbar.
    no_key = with_audio and not tts.have_key()

    # Die Dateinamen auf dem Gerät sind Hashes des Inhalts. Damit liegt
    # dasselbe Symbol oder derselbe Satz dort genau einmal, egal in wie vielen
    # Sets er vorkommt - und eine Datei kann nie veralten, ohne dass sich ihr
    # Name mitändert.
    tile_files: list[list[str]] = []   # [set][slot] -> Dateiname
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
        # Set-Kachel
        label_files.append(store_tile(entry["symbol"]))
        if not entry["symbol"]:
            note(f"Set {index} ({entry['name']}): noch kein Set-Symbol gewählt.")
        elif not (SYMBOLS_DIR / entry["symbol"]).exists():
            note(f"Set {index}: Symbol {entry['symbol']} fehlt in symbols/.")

        tile_names: list[str] = []
        audio_names: list[str] = []
        for slot_index, slot in enumerate(entry["slots"], start=1):
            tile_names.append(store_tile(slot["symbol"]))
            if slot["symbol"] and not (SYMBOLS_DIR / slot["symbol"]).exists():
                note(
                    f"Set {index} Slot {slot_index}: Symbol {slot['symbol']} "
                    "fehlt in symbols/."
                )

            if not slot["text"]:
                note(f"Set {index} Slot {slot_index}: kein Text - kein Ton.")
                audio_names.append("")
                continue

            if not with_audio:
                audio_names.append("")
                continue

            in_cache = tts.cache_path(slot["text"]).exists()
            if no_key and (not in_cache or force_audio):
                audio_ok = False
                note(
                    f"Set {index} Slot {slot_index}: \"{slot['text']}\" liegt "
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
            note(f"Set {index} Slot {slot_index}: \"{slot['text']}\"")

        tile_files.append(tile_names)
        audio_files.append(audio_names)

    # Reste früherer Läufe entfernen, damit kein altes Set übrig bleibt.
    for existing in DATA_DIR.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
            note(f"removed: {existing.name}")

    expected.add(LAYOUT_BIN)
    (DATA_DIR / LAYOUT_BIN).write_bytes(
        render_layout_bin(layout, label_files, tile_files, audio_files))
    note(f"geschrieben: {(DATA_DIR / LAYOUT_BIN).relative_to(ROOT)}")

    total = sum(f.stat().st_size for f in DATA_DIR.iterdir() if f.is_file())
    note(
        f"Fertig: {len(sets)} Set(s), "
        f"{sum(1 for f in DATA_DIR.iterdir() if f.is_file())} Dateien, "
        f"{total / 1024:.0f} KiB in {DATA_DIR.relative_to(ROOT)}/"
    )
    if not audio_ok:
        note("Hinweis: Es fehlen Tondateien - siehe Warnungen oben.")

    # Das Bauen erzeugt nur Dateien. Auf dem Gerät ändert sich davon nichts -
    # das ist ein eigener Schritt, und ohne diesen Hinweis wundert man sich.
    note("")
    note("Aufs Gerät kommen die Dateien damit noch nicht. Dafür:")
    note("  python build.py --fs-image   und der Befehl, den es ausgibt")
    note("  Einzelheiten in docs/firmware.md")
    return log


# Werte aus default_8MB.csv des ESP32-Cores - dort heißt die Partition
# "spiffs", und genau die hängt LittleFS ein.
FS_SIZE = 0x180000       # 1536 KiB
FS_OFFSET = 0x670000
FS_IMAGE = SKETCH_DIR / "littlefs.bin"


def find_tool(name: str) -> Path | None:
    """Sucht ein Werkzeug im ESP32-Core der Arduino-IDE."""
    for basis in (
        Path.home() / "Library/Arduino15/packages/esp32/tools",
        Path.home() / ".arduino15/packages/esp32/tools",
    ):
        ordner = basis / ("esptool_py" if name == "esptool" else name)
        if ordner.exists():
            hits = sorted(ordner.glob(f"*/{name}"))
            if hits:
                return hits[-1]
    return None


def build_fs_image() -> list[str]:
    """Packt firmware/vorlaut/data/ in ein LittleFS-Image zum Flashen."""
    log: list[str] = []
    tool = find_tool("mklittlefs")
    if not tool:
        raise BuildError(
            "mklittlefs nicht found. Es kommt mit dem ESP32-Core der "
            "Arduino-IDE; ohne den lässt sich kein Image bauen."
        )
    used = sum(f.stat().st_size for f in DATA_DIR.iterdir() if f.is_file())
    if used > FS_SIZE:
        raise BuildError(
            f"Die Daten sind {used / 1024:.0f} KiB groß, der Dateibereich "
            f"fasst nur {FS_SIZE / 1024:.0f} KiB."
        )
    result = subprocess.run(
        [str(tool), "-c", str(DATA_DIR), "-b", "4096", "-p", "256",
         "-s", str(FS_SIZE), str(FS_IMAGE)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise BuildError(f"mklittlefs fehlgeschlagen: {result.stderr.strip()[:300]}")
    esptool = find_tool("esptool")
    call = str(esptool) if esptool else "esptool"
    for line in [
        f"Image: {FS_IMAGE.relative_to(ROOT)}  "
        f"({used / 1024:.0f} von {FS_SIZE / 1024:.0f} KiB used)",
        "Port suchen mit:  arduino-cli board list",
        "Schreiben mit:",
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
    parser = argparse.ArgumentParser(description="vorlaut: firmware/data bauen")
    parser.add_argument(
        "--no-audio", action="store_true", help="nur Bilder und layout.h bauen"
    )
    parser.add_argument(
        "--force-audio", action="store_true", help="alle WAVs neu rendern"
    )
    parser.add_argument(
        "--fs-image",
        action="store_true",
        help="zusätzlich ein LittleFS-Image zum Flashen bauen",
    )
    parser.add_argument(
        "--prune-cache",
        action="store_true",
        help="Sprachdateien löschen, die in layout.json nicht mehr vorkommen",
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
