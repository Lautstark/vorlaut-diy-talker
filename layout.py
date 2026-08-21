#!/usr/bin/env python3
"""layout.json: reading it, checking it, writing it back.

The file is the whole of what you made - the sets, the words on the keys, the
symbols, the colours, the voice. Everything here is about that file and the
dictionary it turns into, and about nothing else: no picture is rendered, no
byte is packed, no folder in data/ is touched.

The shape that comes out of normalize_layout() is guaranteed complete. Every
set has a name, a colour and exactly four slots, and every slot has a text and
a symbol, whatever the file on disk happened to be missing. That is what lets
everything downstream stop checking - a slot is never None here, and the web
interface can hand in half a form without the build having to defend itself
against it.
"""

from __future__ import annotations

import datetime
import json
import shutil
from pathlib import Path
from typing import TypedDict

import config
import texts
import tiles
import tts
from buildbase import BuildError

# --- The shape -----------------------------------------------------------
# What the docstring above promises, written down so it can be read by a tool
# and not only by a person. These are the three dictionaries that travel
# through the whole build: the web interface posts them, normalize_layout()
# completes them, and the tiles, the manifest and layout.bin all read them.
#
# There is no type checker in this project and no plan for one, so nothing
# here is enforced at import time - an annotation alone would be a comment
# with a colon in it. tests/test_layout_types.py is what gives it teeth: it
# builds a layout through normalize_layout() and checks the keys that actually
# come out against the keys written here. Add a field to one and forget the
# other, and that test says so.


class Slot(TypedDict):
    """One speech key: the sentence and the picture above it."""

    text: str
    symbol: str


class SetEntry(TypedDict):
    """One set - four speech keys, plus the set key that switches to it."""

    name: str
    active: bool
    symbol: str
    color: str
    slots: list[Slot]


class Layout(TypedDict):
    """The whole of layout.json, after normalize_layout() has completed it."""

    sleep_timeout_seconds: int
    language: str
    voice: str
    sets: list[SetEntry]


EXAMPLE = config.ROOT / "example"
# The example sentences, already spoken. They go into the TTS cache, not into
# content/ - see seed_example_speech().
EXAMPLE_SPEECH = EXAMPLE / "speech"

LAYOUT_FILE = config.CONTENT / "layout.json"
BACKUP_DIR = config.CONTENT / "cache" / "layout-backups"
KEEP_BACKUPS = 60
# The web interface saves shortly after the last keystroke, so continuously
# while typing. Without a minimum interval the 60 slots fill up with snapshots
# of single words, and yesterday's state drops off the end.
BACKUP_MIN_INTERVAL = 5 * 60

# How many go onto the device at once. Not arbitrary: a fully filled set
# costs around 300 KiB and the file area holds 1536 KiB. The same number is
# MAX_SETS in firmware/vorlaut/layout_format.h.
MAX_ACTIVE_SETS = 5
# How many may be in layout.json in total. Not a device limit - the
# collection lives on the computer. Just a guard against a file nobody can
# take in any more.
MAX_SETS = 25
SLOTS_PER_SET = 4
DEFAULT_COLOR = "#3B5BDB"
# Suggestions for new sets, handed out in this order. The web interface
# fetches the same list so it does not have to be maintained twice.
DEFAULT_PALETTE = ["#3B5BDB", "#159947", "#9B7BFF", "#FF8BC7", "#FF6B35"]
DEFAULT_SLEEP_TIMEOUT = 600

# The language the device labels its own menu in. The order has to match
# LANGUAGES in firmware/vorlaut/texts.h - layout.bin carries the index, not
# the name, because there is exactly one byte for it.
#
# That byte used to be reserved and written as zero. Zero is English, so an
# older layout.bin stays readable and the format version can stay at 1.
#
# This says nothing about the content: the words on the keys are whatever
# somebody typed. It is only about the four labels the firmware draws itself.
LANGUAGE_CODES = {"en": 0, "de": 1}
DEFAULT_LANGUAGE = "en"


def empty_set(index: int = 0) -> SetEntry:
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


def example_voice() -> str:
    """The voice the example recordings were made with - or "" if they no
    longer match this installation.

    voice.json next to them holds the configuration they were rendered under.
    Everything in it goes into the fingerprint, so comparing it with what this
    version would produce answers both questions at once: which voice to file
    them under, and whether they are still usable at all. A changed ffmpeg
    chain or a bumped PIPELINE_VERSION makes the comparison fail, and then the
    recordings are ignored rather than filed under names nothing will read.
    """
    try:
        recorded = json.loads(
            (EXAMPLE_SPEECH / "voice.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    if recorded.get("backend") == "piper":
        voice = f"piper:{recorded.get('model', '')}"
    else:
        voice = f"azure:{recorded.get('voice', '')}"
    return voice if tts.voice_config(voice) == recorded else ""


def seed_example_speech() -> int:
    """Puts the already spoken example sentences into the TTS cache.

    Nothing more is needed to make them work: the build looks a sentence up by
    its fingerprint, and a file that is already lying there gets used as it is.
    That is the same path that lets a cached sentence be rebuilt without a key
    - the examples just arrive in the cache instead of being rendered into it.

    Which is the whole point: without this a fresh clone has the example
    sentences but no voice, and the first flash produces four silent keys.

    The file name carries the voice configuration, so a changed voice or a
    bumped PIPELINE_VERSION makes these files stop matching. They are then
    ignored rather than misused - tests/test_example_speech.py is what notices.
    """
    files = sorted(EXAMPLE_SPEECH.glob("*.wav"))
    if not files:
        return 0
    voice = example_voice()
    tts.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for file in files:
        target = tts.CACHE_DIR / file.name
        if not target.exists():
            shutil.copyfile(file, target)
            copied += 1

    # index.json makes the hashed names readable again. Merged rather than
    # copied: the cache may already know sentences of its own. Only entries
    # whose fingerprint still comes out the same are taken over - an index
    # that names files nobody can use is worse than a short one.
    index_file = EXAMPLE_SPEECH / "index.json"
    if index_file.exists():
        try:
            entries = json.loads(index_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            entries = {}
        for key, text in sorted(entries.items()):
            if voice and isinstance(text, str) \
                    and tts.fingerprint(text, voice) == key:
                tts.remember(text, voice)
    return copied


def ensure_content() -> None:
    """Creates content/ and fills it from example/ the first time round.

    That way a freshly cloned project shows something right away, without
    anyone having to create files by hand.
    """
    config.CONTENT.mkdir(parents=True, exist_ok=True)
    tiles.SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    if LAYOUT_FILE.exists():
        return
    example_file = EXAMPLE / "layout.json"
    if example_file.exists():
        shutil.copyfile(example_file, LAYOUT_FILE)
        for file in sorted((EXAMPLE / "symbols").glob("*")):
            target = tiles.SYMBOLS_DIR / file.name
            if not target.exists():
                shutil.copyfile(file, target)
        seed_example_speech()
        print(texts.t("build.filled_from_example"), flush=True)
    else:
        LAYOUT_FILE.write_text(
            json.dumps({"sleep_timeout_seconds": DEFAULT_SLEEP_TIMEOUT, "sets": []},
                       indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_layout(path: Path = LAYOUT_FILE) -> Layout:
    """Reads layout.json and brings it into a guaranteed complete shape."""
    if not path.exists():
        raise BuildError("build.err.not_found", name=path.name)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError("build.err.bad_json", name=path.name,
                         reason=str(exc)) from exc
    return normalize_layout(raw)


def normalize_layout(raw: dict) -> Layout:
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

    # Which voice speaks. Only the shape is checked here, not whether this
    # machine has that voice: a key that is gone for an afternoon, or a model
    # on the other computer, must not quietly overwrite a choice that was
    # made deliberately. What is missing shows up at build time, per slot.
    voice = str(raw.get("voice") or "").strip()
    if not voice.startswith(("piper:", "azure:")):
        # Empty means "whatever works here" - that is what a fresh layout
        # says, and it is answered in tts.default_voice().
        voice = ""

    sets = raw.get("sets") or []
    if not isinstance(sets, list):
        raise BuildError("build.err.sets_not_list")
    if len(sets) > MAX_SETS:
        raise BuildError("build.err.too_many_sets", max=MAX_SETS,
                         found=len(sets))

    clean_sets = []
    for index, entry in enumerate(sets):
        entry = entry if isinstance(entry, dict) else {}
        slots = entry.get("slots") or []
        if not isinstance(slots, list):
            slots = []
        # Exactly 4 slots: pad the missing ones, surplus ones are an error.
        if len(slots) > SLOTS_PER_SET:
            raise BuildError("build.err.too_many_slots", set=index + 1,
                             found=len(slots), expected=SLOTS_PER_SET)
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
        raise BuildError("build.err.too_many_active", max=MAX_ACTIVE_SETS,
                         found=active)

    return {
        "sleep_timeout_seconds": timeout,
        "language": language,
        "voice": voice,
        "sets": clean_sets,
    }


def active_sets(layout: Layout) -> list[SetEntry]:
    """The sets that go onto the device, in the order of the layout."""
    return [entry for entry in layout["sets"] if entry.get("active", True)]


def chosen_voice(layout: Layout) -> str:
    """The voice this layout is spoken in.

    An empty entry is not an error but the normal case for a fresh layout:
    then whatever is on offer here answers, and the device language decides
    which of several equal voices it is.
    """
    return (layout.get("voice")
            or tts.default_voice(layout.get("language", DEFAULT_LANGUAGE)))


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


def save_layout(layout: dict, path: Path = LAYOUT_FILE) -> Layout:
    layout = normalize_layout(layout)
    backup_layout(path)
    path.write_text(
        json.dumps(layout, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return layout
