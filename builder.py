#!/usr/bin/env python3
"""Builds everything the firmware needs from layout.json into data/.

The orchestration, and the command line that drives it. Everything it needs
is somewhere else - the layout is read in layout.py, the pictures are made in
tiles.py, the sentences in tts.py, the table in layout_format.py - so what is
left here is the order they happen in, what gets skipped, and what the log
says about it.

Per active set and slot it puts into data/:

  t<hash>.bin   116x116 RGB565 big-endian, the symbol area without a border
  a<hash>.wav   spoken sentence, 16 kHz mono 16 bit
  layout.bin    the table the firmware reads all of it back out of

The file names are hashes of the content, which is what makes the same symbol
in three sets one file on the device, and what makes a stale file impossible:
change the content and the name changes with it.

--prune-cache is here for the same reason build() is: it reaches across the
tile cache and the speech cache at once, and neither of those two modules is
in a position to decide what the other one no longer needs.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import texts
import tts
from buildbase import BuildError, short, write_json
from config import DATA_DIR
from flashing import build_fs_image, merge_fs_image
from layout import active_sets, chosen_voice, ensure_content, load_layout
from layout_format import LAYOUT_BIN, render_layout_bin
from manifest import _remember_build
from tiles import (
    TILE_CACHE,
    TILE_INDEX,
    _index_lock,
    load_tile_index,
    missing_hint,
    symbol_path,
    tile_bytes,
    tile_fingerprint,
)


def build(with_audio: bool = True, force_audio: bool = False,
          lang: str = texts.DEFAULT, require_audio: bool = False) -> list[str]:
    """Builds everything and returns the log as a list of lines.

    The language decides how the log reads, nothing else. On the command line
    it stays English; the web interface passes what layout.json asks for, so
    the log matches the rest of the page.
    """
    log: list[str] = []

    def note(key: str, **params) -> None:
        message = texts.t(key, lang, **params) if key else ""
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
        note("build.no_sets")
    elif not sets:
        note("build.none_active")
    elif len(sets) != len(layout["sets"]):
        note("build.active_count", active=len(sets), total=len(layout["sets"]))

    expected: set[str] = set()
    audio_ok = True

    # Without a voice nothing new can be spoken - but everything already in
    # the cache can still be used. That is exactly what makes a
    # fresh clone of the repo usable without Azure access.
    voice = chosen_voice(layout)
    silent = with_audio and not tts.can_speak()

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
        # the set tile
        label_files.append(store_tile(entry["symbol"]))
        if not entry["symbol"]:
            note("build.no_set_symbol", label=label)
        elif symbol_path(entry["symbol"]) is None:
            note("build.missing_prefixed", label=label,
                 what=texts.t(missing_hint(entry["symbol"]), lang,
                              symbol=entry["symbol"]))

        tile_names: list[str] = []
        audio_names: list[str] = []
        for slot_index, slot in enumerate(entry["slots"], start=1):
            tile_names.append(store_tile(slot["symbol"]))
            if slot["symbol"] and symbol_path(slot["symbol"]) is None:
                note("build.missing_in_slot", label=label, slot=slot_index,
                     what=texts.t(missing_hint(slot["symbol"]), lang,
                                  symbol=slot["symbol"]))

            if not slot["text"]:
                note("build.no_text", label=label, slot=slot_index)
                audio_names.append("")
                continue

            if not with_audio:
                audio_names.append("")
                continue

            in_cache = tts.cache_path(slot["text"], voice).exists()
            if silent and (not in_cache or force_audio):
                audio_ok = False
                note("build.slot_no_voice", label=label, slot=slot_index,
                     text=slot["text"], reason=texts.t("build.err.no_voice", lang))
                audio_names.append("")
                continue

            try:
                cached = tts.synthesize(slot["text"], voice, force=force_audio)
            except tts.TTSError as exc:
                audio_ok = False
                note("build.tts_failed", text=slot["text"],
                     reason=exc.message(lang))
                audio_names.append("")
                continue

            name = f"a{tts.fingerprint(slot['text'], voice)}.wav"
            expected.add(name)
            target = DATA_DIR / name
            if not target.exists() or target.stat().st_size != cached.stat().st_size:
                shutil.copyfile(cached, target)
            audio_names.append(name)
            note("build.slot_text", label=label, slot=slot_index,
                 text=slot["text"])

        tile_files.append(tile_names)
        audio_files.append(audio_names)

    # Remove leftovers from earlier runs, so no old set stays behind.
    for existing in DATA_DIR.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
            note("build.removed", name=existing.name)

    expected.add(LAYOUT_BIN)
    (DATA_DIR / LAYOUT_BIN).write_bytes(
        render_layout_bin(layout, label_files, tile_files, audio_files))
    note("build.written", name=short(DATA_DIR / LAYOUT_BIN))

    total = sum(f.stat().st_size for f in DATA_DIR.iterdir() if f.is_file())
    _remember_build(layout)
    note("build.done", sets=len(sets),
         files=sum(1 for f in DATA_DIR.iterdir() if f.is_file()),
         size=f"{total / 1024:.0f}", where=f"{short(DATA_DIR)}/")
    if not audio_ok:
        note("build.audio_missing")
        # Normally a missing sentence is a warning: a build without a key is
        # still worth having, everything except the sound is in it. For a
        # release it is not - an image that flashes cleanly and then says
        # nothing is the exact failure this whole path exists to prevent, and
        # nobody would find out until a device is on the table.
        if require_audio:
            raise BuildError("build.err.audio_required")

    # Building only produces files. Nothing changes on the device from that -
    # it is a separate step, and without this note one wonders why.
    note("")
    note("build.next_steps")
    note("build.next_command")
    note("build.next_docs")
    return log


def prune_cache() -> list[str]:
    """Removes speech files and tiles that layout.json no longer mentions."""
    log: list[str] = []
    ensure_content()
    layout = load_layout()

    # Tiles
    needed_tiles = {
        tile_fingerprint(sym)
        for entry in layout["sets"]
        for sym in [entry["symbol"], *(slot["symbol"] for slot in entry["slots"])]
    }
    # The same read-modify-write as in tile_bytes, and under the same lock:
    # deleting the files and dropping their entries has to be one step, or a
    # preview rendered in between would put back an entry whose file is gone.
    with _index_lock:
        tile_index = load_tile_index()
        tiles_removed = 0
        for file in sorted(TILE_CACHE.glob("*.bin")):
            if file.stem not in needed_tiles:
                symbol = tile_index.pop(file.stem, None)
                log.append(f"removed: tile {symbol or file.name}")
                file.unlink()
                tiles_removed += 1
        if tiles_removed:
            write_json(TILE_INDEX, tile_index)

    voice = chosen_voice(layout)
    needed = {
        tts.fingerprint(slot["text"], voice)
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
        # tts.remember() guards this file with a lock of its own, which is no
        # help here: prune runs from the command line, so the thread holding
        # that lock is in the other process. Writing whole is what protects it
        # from there.
        write_json(tts.INDEX_FILE, index)
    log.append(
        f"{removed} orphaned speech file(s) and "
        f"{tiles_removed} tile(s) removed."
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
        "--require-audio",
        action="store_true",
        help="stop if any sentence stayed silent, instead of warning",
    )
    parser.add_argument(
        "--merge-into",
        metavar="IMAGE",
        help="write the LittleFS image into a whole-flash image (e.g. "
             "vorlaut.ino.merged.bin), so that one write-flash at 0 carries "
             "program and content",
    )
    parser.add_argument(
        "--prune-cache",
        action="store_true",
        help="delete speech files no longer referenced by layout.json",
    )
    args = parser.parse_args(argv[1:])
    # Together these two would come out as "no sound was asked for, so none is
    # missing" - a green build that guarantees exactly nothing.
    if args.require_audio and args.no_audio:
        parser.error("--require-audio and --no-audio contradict each other")
    if args.prune_cache:
        try:
            prune_cache()
        except (BuildError, tts.TTSError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        return 0
    try:
        build(with_audio=not args.no_audio, force_audio=args.force_audio,
              require_audio=args.require_audio)
        # --merge-into needs an image, so it implies --fs-image. Asking for
        # both would only be a way to get it wrong.
        if args.fs_image or args.merge_into:
            build_fs_image()
        if args.merge_into:
            merge_fs_image(Path(args.merge_into))
    except (BuildError, tts.TTSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0
