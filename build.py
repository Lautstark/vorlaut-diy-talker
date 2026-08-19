#!/usr/bin/env python3
"""Baut aus layout.json alles, was die Firmware braucht, nach firmware/data/.

Erzeugt pro Set S (1-basiert) und Slot N (1-basiert):
  set<S>_slot<N>.wav   gesprochener Satz, 16 kHz mono 16 bit
  set<S>_slot<N>.bin   128x128 RGB565 big-endian, mit Set-Farbe als Rahmen
  set<S>_label.bin     dasselbe fuer das Set-Symbol
und dazu firmware/layout.h mit allen Konstanten fuer die Firmware.
"""

from __future__ import annotations

import argparse
import datetime
import json
import shutil
import sys
from pathlib import Path

import tts

ROOT = Path(__file__).resolve().parent
LAYOUT_FILE = ROOT / "layout.json"
SYMBOLS_DIR = ROOT / "symbols"
# Arduino verlangt, dass der Sketch-Ordner so heisst wie die .ino-Datei, und
# der LittleFS-Uploader sucht data/ direkt daneben. Deshalb diese Ebene.
BACKUP_DIR = ROOT / "cache" / "layout-backups"
KEEP_BACKUPS = 60
SKETCH_DIR = ROOT / "firmware" / "mitreden"
DATA_DIR = SKETCH_DIR / "data"
HEADER_FILE = SKETCH_DIR / "layout.h"

MAX_SETS = 5
SLOTS_PER_SET = 4
IMG_SIZE = 128
BORDER = 6
DEFAULT_COLOR = "#3B5BDB"
# Vorschlaege fuer neue Sets, in dieser Reihenfolge vergeben. Die Oberflaeche
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


def load_layout(path: Path = LAYOUT_FILE) -> dict:
    """Liest layout.json und bringt es in eine garantiert vollstaendige Form."""
    if not path.exists():
        raise BuildError(f"{path.name} nicht gefunden.")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"{path.name} ist kein gueltiges JSON: {exc}") from exc
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
        raise BuildError(f"Hoechstens {MAX_SETS} Sets, gefunden: {len(sets)}.")

    clean_sets = []
    for index, entry in enumerate(sets):
        entry = entry if isinstance(entry, dict) else {}
        slots = entry.get("slots") or []
        if not isinstance(slots, list):
            slots = []
        # Genau 4 Slots: fehlende auffuellen, ueberzaehlige sind ein Fehler.
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
    """Legt den bisherigen Stand beiseite, bevor er ueberschrieben wird.

    Billige Versicherung: die Oberflaeche speichert immer die ganze Datei, und
    ein Fehlgriff ist damit sonst endgueltig.
    """
    if not path.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    shutil.copyfile(path, BACKUP_DIR / f"layout-{stamp}.json")
    alte = sorted(BACKUP_DIR.glob("layout-*.json"))
    for veraltet in alte[:-KEEP_BACKUPS]:
        veraltet.unlink()


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


def render_tile(symbol: str, color: str) -> bytes:
    """128x128 Kachel: Symbol auf Weiss, ringsum ein Rahmen in der Set-Farbe.

    Rueckgabe sind rohe RGB565-Daten, big-endian, wie sie das ST7735-Panel
    erwartet.
    """
    Image, ImageDraw = _require_pillow()

    tile = Image.new("RGB", (IMG_SIZE, IMG_SIZE), hex_to_rgb(color))
    inner_size = IMG_SIZE - 2 * BORDER
    inner = Image.new("RGB", (inner_size, inner_size), (255, 255, 255))

    source_path = SYMBOLS_DIR / symbol if symbol else None
    if source_path and source_path.exists():
        with Image.open(source_path) as raw:
            picture = raw.convert("RGBA")
        picture.thumbnail((inner_size, inner_size), Image.LANCZOS)
        # Transparenz auf Weiss legen, sonst wird sie schwarz.
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

    tile.paste(inner, (BORDER, BORDER))
    return to_rgb565_be(tile)


def to_rgb565_be(image) -> bytes:
    pixels = image.tobytes("raw", "RGB")
    out = bytearray(IMG_SIZE * IMG_SIZE * 2)
    write = 0
    for read in range(0, len(pixels), 3):
        value = rgb_to_565(pixels[read], pixels[read + 1], pixels[read + 2])
        out[write] = value >> 8
        out[write + 1] = value & 0xFF
        write += 2
    return bytes(out)


# --- layout.h ----------------------------------------------------------------

def c_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    # Umlaute als UTF-8 im Quelltext sind fuer den Compiler in Ordnung.
    return f'"{escaped}"'


def render_header(layout: dict) -> str:
    sets = layout["sets"]
    count = len(sets)
    lines: list[str] = []
    add = lines.append

    add("// AUTOMATISCH ERZEUGT von build.py - nicht von Hand aendern.")
    add("// Quelle: layout.json")
    add("#pragma once")
    add("#include <stdint.h>")
    add("")
    add(f"#define SET_COUNT {count}")
    add(f"#define SLOT_COUNT {SLOTS_PER_SET}")
    add(f"#define SLEEP_TIMEOUT_SECONDS {layout['sleep_timeout_seconds']}")
    add(f"#define DISPLAY_W {IMG_SIZE}")
    add(f"#define DISPLAY_H {IMG_SIZE}")
    add("")

    if count == 0:
        add("// layout.json enthaelt noch keine Sets.")
        return "\n".join(lines) + "\n"

    add("static const char* const SET_NAMES[SET_COUNT] = {")
    for entry in sets:
        add(f"  {c_string(entry['name'])},")
    add("};")
    add("")

    add("// Rahmenfarbe des Sets, bereits als RGB565 fuer das Panel.")
    add("static const uint16_t SET_COLORS[SET_COUNT] = {")
    for entry in sets:
        add(f"  0x{rgb_to_565(*hex_to_rgb(entry['color'])):04X},  // {entry['color']}")
    add("};")
    add("")

    add("static const char* const SET_LABEL_IMAGE[SET_COUNT] = {")
    for index in range(count):
        add(f'  "/set{index + 1}_label.bin",')
    add("};")
    add("")

    add("static const char* const SLOT_IMAGE[SET_COUNT][SLOT_COUNT] = {")
    for index in range(count):
        files = ", ".join(
            f'"/set{index + 1}_slot{slot + 1}.bin"' for slot in range(SLOTS_PER_SET)
        )
        add(f"  {{ {files} }},")
    add("};")
    add("")

    add("static const char* const SLOT_AUDIO[SET_COUNT][SLOT_COUNT] = {")
    for index in range(count):
        files = ", ".join(
            f'"/set{index + 1}_slot{slot + 1}.wav"' for slot in range(SLOTS_PER_SET)
        )
        add(f"  {{ {files} }},")
    add("};")
    add("")

    add("// Nur zur Anzeige im seriellen Log.")
    add("static const char* const SLOT_TEXT[SET_COUNT][SLOT_COUNT] = {")
    for entry in sets:
        texts = ", ".join(c_string(slot["text"]) for slot in entry["slots"])
        add(f"  {{ {texts} }},")
    add("};")
    add("")

    return "\n".join(lines) + "\n"


# --- Bauen -------------------------------------------------------------------

def build(with_audio: bool = True, force_audio: bool = False) -> list[str]:
    """Baut alles und liefert das Protokoll als Liste von Zeilen."""
    log: list[str] = []

    def note(message: str) -> None:
        log.append(message)
        print(message, flush=True)

    layout = load_layout()
    sets = layout["sets"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not sets:
        note("layout.json enthaelt keine Sets - es gibt nichts zu bauen.")

    expected: set[str] = set()
    audio_ok = True

    if with_audio and sets and not tts.have_key():
        audio_ok = False
        note(
            "WARNUNG: AZURE_SPEECH_KEY fehlt - Bilder und layout.h werden "
            "gebaut, die WAVs nicht."
        )

    for index, entry in enumerate(sets, start=1):
        color = entry["color"]

        # Set-Kachel
        label_name = f"set{index}_label.bin"
        expected.add(label_name)
        (DATA_DIR / label_name).write_bytes(render_tile(entry["symbol"], color))
        if not entry["symbol"]:
            note(f"Set {index} ({entry['name']}): noch kein Set-Symbol gewaehlt.")
        elif not (SYMBOLS_DIR / entry["symbol"]).exists():
            note(f"Set {index}: Symbol {entry['symbol']} fehlt in symbols/.")

        for slot_index, slot in enumerate(entry["slots"], start=1):
            image_name = f"set{index}_slot{slot_index}.bin"
            audio_name = f"set{index}_slot{slot_index}.wav"
            expected.add(image_name)
            expected.add(audio_name)

            (DATA_DIR / image_name).write_bytes(render_tile(slot["symbol"], color))
            if slot["symbol"] and not (SYMBOLS_DIR / slot["symbol"]).exists():
                note(
                    f"Set {index} Slot {slot_index}: Symbol {slot['symbol']} "
                    "fehlt in symbols/."
                )

            if not slot["text"]:
                note(f"Set {index} Slot {slot_index}: kein Text - kein Ton.")
                (DATA_DIR / audio_name).unlink(missing_ok=True)
                expected.discard(audio_name)
                continue

            if not (with_audio and audio_ok):
                expected.discard(audio_name)
                continue

            try:
                cached = tts.synthesize(slot["text"], force=force_audio)
            except tts.TTSError as exc:
                audio_ok = False
                note(f"WARNUNG: TTS fehlgeschlagen bei \"{slot['text']}\": {exc}")
                expected.discard(audio_name)
                continue

            target = DATA_DIR / audio_name
            # Aus dem Cache kopieren; gerendert wurde nur, falls noetig.
            if not target.exists() or target.stat().st_size != cached.stat().st_size:
                shutil.copyfile(cached, target)
            note(f"Set {index} Slot {slot_index}: \"{slot['text']}\"")

    # Reste frueherer Laeufe entfernen, damit kein altes Set uebrig bleibt.
    for existing in DATA_DIR.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
            note(f"entfernt: {existing.name}")

    HEADER_FILE.write_text(render_header(layout), encoding="utf-8")
    note(f"geschrieben: {HEADER_FILE.relative_to(ROOT)}")

    total = sum(f.stat().st_size for f in DATA_DIR.iterdir() if f.is_file())
    note(
        f"Fertig: {len(sets)} Set(s), "
        f"{sum(1 for f in DATA_DIR.iterdir() if f.is_file())} Dateien, "
        f"{total / 1024:.0f} KiB in {DATA_DIR.relative_to(ROOT)}/"
    )
    if not audio_ok:
        note("Hinweis: Es fehlen Tondateien - siehe Warnungen oben.")
    return log


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="mitreden: firmware/data bauen")
    parser.add_argument(
        "--no-audio", action="store_true", help="nur Bilder und layout.h bauen"
    )
    parser.add_argument(
        "--force-audio", action="store_true", help="alle WAVs neu rendern"
    )
    args = parser.parse_args(argv[1:])
    try:
        build(with_audio=not args.no_audio, force_audio=args.force_audio)
    except (BuildError, tts.TTSError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
