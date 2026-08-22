#!/usr/bin/env python3
"""layout.json as an Open Board Format document, and back again.

The Open Board Format is what the rest of the AAC world writes its boards in:
a `.obf` is one board as JSON, a `.obz` is a zip of many of them with a
`manifest.json` naming the root. This module is the whole of the translation
between that and `layout.json` - what a set becomes, what a key becomes, how a
symbol stays a reference, and what has no home in the spec and therefore goes
into an `ext_vorlaut_*` field.

Why bother, when layout.json works: the format is the document you edit, and
a document that only one program can open is a document that dies with the
program. `docs/obf.md` is the field-by-field argument; this file is the part
of it a machine can run.

Three things this is deliberately not.

It is **not a change to the device.** `layout.bin` stays exactly what
`layout_format.py` writes, and the firmware never sees a curly brace - the
reasons are in docs/software.md and none of them have got any weaker. OBF
replaces the file somebody edits, not the file that gets flashed.

It is **not a picture container.** A symbol travels as `images[].symbol`, a
name in a collection, never as pixels. For METACOM that is a licence
condition rather than a preference, so it is checked on the way out and
`write_obz()` refuses rather than warns - see `check_licensing()`.

It is **not only about this device.** The same document has to survive a
designer who is aiming at a phone instead: an arbitrary graph of boards, grids
far bigger than five keys, speech at run time rather than pre-rendered. That
is what `Profile` is for. The ESP32 profile is the strict one and the phone
profile is the permissive one, and everything that would otherwise be an
`if` about the device is a field on the profile instead.
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
import zipfile
from pathlib import Path
from typing import NamedTuple

import texts
import tiles
import tts
from buildbase import BuildError, short
from flashing import FS_SIZE
from layout import (
    DEFAULT_LANGUAGE,
    LANGUAGE_CODES,
    MAX_ACTIVE_SETS,
    SLOTS_PER_SET,
    Layout,
    chosen_voice,
    hex_to_rgb,
    load_layout,
    normalize_layout,
    save_layout,
)
from layout_format import HEADER_BYTES, SET_BYTES

# --- What the spec calls things ---------------------------------------------

FORMAT = "open-board-0.1"
MANIFEST_NAME = "manifest.json"
BOARD_DIR = "boards"
IMAGE_DIR = "images"
SOUND_DIR = "sounds"

# The symbol set a bare file name in layout.json belongs to. layout.json says
# "ja.png" and means content/symbols/ja.png; OBF wants that written as a pair
# of collection and name, and this is the name of the collection that is
# yours. The prefixed form "metacom:essen" already carried its collection, so
# the rule reads the same in both directions: a bare name is this set, and
# "<set>:<name>" is that set. See docs/obf.md, "Symbols stay references".
OWN_SET = "vorlaut"
METACOM_SET = "metacom"

# What the project already declares about every pictogram the search loads -
# README says it once for the repository, and this says it per image, which is
# the only place a document handed to somebody else can carry it.
#
# Over-attribution is the known flaw: an uploaded photograph of your own
# kitchen gets the same line, because layout.json records where a symbol came
# from nowhere at all. The fix is provenance at download time, not a guess
# here from the shape of a file name - see docs/obf.md, "What is missing".
ARASAAC_LICENSE = {
    "type": "CC BY-NC-SA 4.0",
    "copyright_notice_url": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "author_name": "Sergio Palao",
    "author_url": "https://arasaac.org",
    "source_url": "https://arasaac.org",
}

# METACOM is licensed per person and lives outside the project. The licence
# block says so; check_licensing() is what makes it true.
METACOM_LICENSE = {
    "type": "Proprietary",
    "author_name": "Annette Kitzinger",
    "author_url": "https://www.metacom-symbole.de",
    "source_url": "https://www.metacom-symbole.de/en/licensing.html",
}

# 16 kHz, 16 bit, mono - tts.SAMPLE_RATE and what the firmware plays.
BYTES_PER_SECOND = tts.SAMPLE_RATE * 2
# One rendered symbol area on the device: 116x116 in RGB565.
TILE_BYTES = tiles.TILE_SIZE * tiles.TILE_SIZE * 2

# Zip entries get a fixed timestamp, so the same document always produces the
# same bytes. Otherwise "did anything actually change" is unanswerable without
# unpacking both files.
ZIP_DATE = (1980, 1, 1, 0, 0, 0)


# --- Target profiles ---------------------------------------------------------
# A profile is the answer to "what is this document going to run on". The
# ESP32 is one target among the ones this project expects to have, and the
# strictest by a distance: five boards, four keys, every syllable rendered in
# advance and the whole lot inside 1.5 MiB of flash. A phone companion app
# with the same designer in front of it has none of those limits and a real
# text-to-speech engine, so it wants an arbitrary graph of boards and grids
# the size of a screen.
#
# Both of those are the same document. What differs is what is allowed to be
# in it, and that is what is written down here rather than scattered through
# validate() as questions about which device we are on.


class Profile(NamedTuple):
    """What a target can take."""

    name: str
    # None means "no limit", throughout.
    max_boards: int | None          # boards that go on the target at once
    max_speech_keys: int | None     # per board
    grid: tuple[int, int] | None    # exactly these rows x columns
    single_ring: bool               # one link out per board, visiting all
    prerendered: bool               # audio is a file, not a run-time voice
    budget_bytes: int | None        # what the whole document has to fit in


ESP32 = Profile(
    name="esp32",
    max_boards=MAX_ACTIVE_SETS,
    max_speech_keys=SLOTS_PER_SET,
    grid=(2, 3),
    single_ring=True,
    prerendered=True,
    budget_bytes=FS_SIZE,
)

PHONE = Profile(
    name="phone",
    max_boards=None,
    max_speech_keys=None,
    grid=None,
    single_ring=False,
    prerendered=False,
    budget_bytes=None,
)

PROFILES = {profile.name: profile for profile in (ESP32, PHONE)}


class Problem(NamedTuple):
    """One thing wrong with a document, in a form that can still be translated.

    Same reasoning as BuildError in buildbase.py, and the same message table -
    but a list rather than an exception, because validation wants to say all
    of it at once. Somebody who has drawn eleven boards for a device that
    holds five wants the count, not the first board over the line.
    """

    key: str
    params: dict

    def message(self, lang: str = texts.DEFAULT) -> str:
        return texts.t(self.key, lang, **self.params)

    def __str__(self) -> str:
        return self.message()


def _problem(key: str, **params) -> Problem:
    return Problem(key, params)


# --- The document ------------------------------------------------------------

class Document(NamedTuple):
    """A whole .obz, unpacked: the boards, and the payload beside them.

    `boards` maps board id to the parsed .obf, kept as the plain dictionary it
    was rather than as objects. That is what makes a foreign document survive
    the trip: a field this project has never heard of is copied along instead
    of being dropped by a class that has no attribute for it.

    `files` is everything in the zip that is not a board - images and sounds -
    as bytes, keyed by the path inside the zip. Bytes rather than paths on
    disk, so that reading and writing are the same shape, and because the size
    argument does not apply: a real reference vocabulary of 81 linked boards
    is about 330 KB in total.

    The tuple is immutable, the two dictionaries in it are not. That is on
    purpose - attach_images() and attach_sounds() fill them in.
    """

    root: str
    boards: dict[str, dict]
    files: dict[str, bytes]

    def board(self, board_id: str) -> dict:
        return self.boards[board_id]

    def order(self) -> list[str]:
        """The boards, root first, then the way the links run.

        Deterministic, which is what makes a round trip a round trip: the same
        document has to come back with its sets in the same order. Boards that
        no link reaches come last, sorted by id, so an orphan is preserved
        rather than lost - orphans() is what says they are there.
        """
        seen: list[str] = []
        queue = [self.root] if self.root in self.boards else []
        while queue:
            current = queue.pop(0)
            if current in seen:
                continue
            seen.append(current)
            queue.extend(t for t in _targets(self, current) if t in self.boards)
        seen.extend(sorted(set(self.boards) - set(seen)))
        return seen


def board_path(board_id: str) -> str:
    return f"{BOARD_DIR}/{board_id}.obf"


# --- Symbol references -------------------------------------------------------
# The one invariant borrowed wholesale from bildhaft: a symbol is a name in a
# collection and never a picture. It has to be structurally impossible to hand
# somebody a METACOM board as pixels, because the licence is per person and a
# file that carries the pixels has already handed them over.
#
# So the two directions below deal in names only, and check_licensing() runs
# on the way out to make sure nothing else crept in.

def split_symbol(symbol: str) -> tuple[str, str]:
    """A layout.json symbol reference as (set, name).

    "ja.png" is the collection that is yours; "metacom:essen" names another
    one. The prefix that metacom.py already uses generalises: anything before
    a colon is a collection name, which is how a board from a phone that draws
    on some third collection stays readable here instead of being flattened.
    """
    if not symbol:
        return ("", "")
    collection, sep, name = symbol.partition(":")
    if not sep:
        return (OWN_SET, symbol)
    return (collection, name)


def join_symbol(symbol_set: str, filename: str) -> str:
    """(set, name) back into what layout.json writes."""
    if not filename:
        return ""
    if symbol_set in ("", OWN_SET):
        return filename
    return f"{symbol_set}:{filename}"


def image_id(symbol: str) -> str:
    """A stable id for a symbol reference.

    Derived from the reference and from nothing else, so the same picture in
    two differently coloured sets is the same id in both - which is the same
    reasoning tiles.py uses to make it exactly one file on the device.
    """
    digest = hashlib.sha256(symbol.encode("utf-8")).hexdigest()[:8]
    return f"img-{digest}"


def image_entry(symbol: str) -> dict:
    """The images[] entry for one symbol reference."""
    symbol_set, filename = split_symbol(symbol)
    entry = {
        "id": image_id(symbol),
        "symbol": {"set": symbol_set, "filename": filename},
    }
    if symbol_set == METACOM_SET:
        entry["license"] = dict(METACOM_LICENSE)
    return entry


def symbol_of(image: dict) -> str:
    """An images[] entry back to a layout.json reference - "" if it is pixels.

    A foreign board may carry its picture as a data URL or a file in the zip
    rather than as a name. There is nowhere to put that: layout.json holds
    references, and content/symbols/ is filled by the interface, not by an
    import. So it comes back empty and the key gets the placeholder, and
    validate() says which image it was.
    """
    symbol = image.get("symbol") or {}
    if not isinstance(symbol, dict):
        return ""
    return join_symbol(str(symbol.get("set") or ""),
                       str(symbol.get("filename") or ""))


def check_licensing(document: Document) -> None:
    """Refuses a document that carries a licensed collection as pixels.

    Not a Problem in a list but a BuildError: a warning would be a document
    that got written anyway, and the whole point is that the file cannot come
    into existence. Every path that writes a .obz goes through here.
    """
    for board_id in sorted(document.boards):
        for image in document.board(board_id).get("images") or []:
            symbol = image.get("symbol") or {}
            if (symbol.get("set") if isinstance(symbol, dict) else "") != METACOM_SET:
                continue
            carried = [field for field in ("data", "url", "path")
                       if image.get(field)]
            if carried:
                raise BuildError("obf.err.metacom_pixels",
                                 name=str(image.get("id") or symbol.get("filename")),
                                 field=", ".join(carried))


# --- Colours -----------------------------------------------------------------
# layout.json writes "#3B5BDB", OBF writes CSS. The hex form is the one that
# survives, and it survives in ext_vorlaut_color; the CSS one is written next
# to it so a foreign renderer has something to draw, and is ignored on the way
# back. Two fields, one of them derived, rather than one field and a
# conversion that has to come out bit for bit identical twice.

def css_color(value: str) -> str:
    red, green, blue = hex_to_rgb(value)
    return f"rgb({red}, {green}, {blue})"


# --- layout.json -> document -------------------------------------------------

def layout_to_document(layout: Layout, *,
                       image_license: dict | None = None) -> Document:
    """The whole of a layout as linked boards.

    Every set becomes a board, including the switched-off ones. They are part
    of the collection somebody made; only the build takes the active ones, the
    same way active_sets() is applied when the device image is packed and not
    when the file is read. The alternative - linking the active sets only -
    would leave every switched-off set as an orphan, and then the one useful
    thing orphan detection could say would be "yes, on purpose".

    So the ring runs through all of them in file order and wraps at the end,
    and ext_vorlaut_active says which ones go on the device.
    """
    if image_license is None:
        image_license = ARASAAC_LICENSE

    entries = layout["sets"] or []
    ids = [f"set-{index + 1}" for index in range(len(entries))]
    boards: dict[str, dict] = {}

    for index, entry in enumerate(entries):
        board_id = ids[index]
        # The ring: the set key switches to the next set and the last one
        # comes back round to the first, which is what the device does.
        following = ids[(index + 1) % len(ids)] if ids else board_id

        buttons = []
        images: dict[str, dict] = {}

        def remember(symbol: str) -> str | None:
            """Adds the images[] entry for a symbol and returns its id."""
            if not symbol:
                return None
            entry_for = image_entry(symbol)
            if entry_for.get("symbol", {}).get("set") == OWN_SET and image_license:
                entry_for["license"] = dict(image_license)
            images.setdefault(entry_for["id"], entry_for)
            return entry_for["id"]

        for slot_index, slot in enumerate(entry["slots"]):
            button = {
                "id": f"{board_id}-key-{slot_index + 1}",
                # Both, and the same text in both. The label is what any
                # other editor shows on the key; the vocalization is what
                # gets spoken. They are one sentence here because the device
                # writes no caption - but saying it twice is what keeps the
                # spoken half right if somebody later shortens the label.
                "label": slot["text"],
                "vocalization": slot["text"],
                # Derived, and ignored on the way back. The colour belongs to
                # the set, not to the key - the firmware draws it as a border
                # around all five displays - but OBF has nowhere to put a
                # colour that belongs to a board.
                "border_color": css_color(entry["color"]),
            }
            picture = remember(slot["symbol"])
            if picture:
                button["image_id"] = picture
            buttons.append(button)

        switch = {
            "id": f"{board_id}-set",
            "label": entry["name"],
            "border_color": css_color(entry["color"]),
            "load_board": {
                "id": following,
                "name": entries[(index + 1) % len(entries)]["name"],
                "path": board_path(following),
            },
        }
        picture = remember(entry["symbol"])
        if picture:
            switch["image_id"] = picture
        buttons.append(switch)

        boards[board_id] = {
            "format": FORMAT,
            "id": board_id,
            # The board's language, which on this device reaches only the four
            # menu labels the firmware draws itself. On a phone it is also
            # what picks the voice - see docs/obf.md.
            "locale": layout.get("language", DEFAULT_LANGUAGE),
            "name": entry["name"],
            "grid": _grid(board_id),
            "buttons": buttons,
            "images": [images[key] for key in sorted(images)],
            "sounds": [],
            # --- vorlaut's own ---------------------------------------------
            # ext_* is the spec's own way of carrying a field it has no
            # opinion about. These four are the ones with no home in OBF.
            "ext_vorlaut_color": entry["color"],
            "ext_vorlaut_active": entry["active"],
        }

    root = ids[0] if ids else ""
    document = Document(root=root, boards=boards, files={})
    if root:
        # Document-wide settings live on the root board rather than in the
        # manifest: the manifest is written by whoever zips the thing and gets
        # rebuilt by any tool that touches it, whereas a board is the
        # document. It also means a single .obf exported on its own still
        # knows how long to stay awake and which voice to speak in.
        boards[root]["ext_vorlaut_sleep_timeout_seconds"] = \
            layout["sleep_timeout_seconds"]
        boards[root]["ext_vorlaut_voice"] = layout.get("voice", "")
    return document


def _grid(board_id: str) -> dict:
    """The five keys where they really sit.

    Two rows of three, and the top left cell is empty because that is where
    the speaker is - docs/hardware.md, "Arrangement: speaker top left, the set
    key below it, the four speech keys to the right as a 2x2 block."

        .        key 1    key 2
        set      key 3    key 4

    A grid with a hole in it is what grid.order's nulls are for, and it beats
    a tidy 1x5 that no renderer could turn back into the thing on the table.
    Nothing downstream depends on it: the importer finds the set key by its
    load_board and the speech keys by not having one, so a board drawn
    elsewhere with another geometry still comes in.
    """
    return {
        "rows": 2,
        "columns": 3,
        "order": [
            [None, f"{board_id}-key-1", f"{board_id}-key-2"],
            [f"{board_id}-set", f"{board_id}-key-3", f"{board_id}-key-4"],
        ],
    }


# --- document -> layout.json -------------------------------------------------

def _grid_order(board: dict) -> list[str]:
    """The button ids in reading order, then anything the grid left out.

    Buttons not named in the grid are appended rather than dropped: OBF allows
    a board to carry more buttons than the grid shows, and losing one silently
    on import is how a sentence disappears without an error.
    """
    ordered: list[str] = []
    grid = board.get("grid") or {}
    for row in grid.get("order") or []:
        for cell in row or []:
            if cell:
                ordered.append(str(cell))
    for button in board.get("buttons") or []:
        button_id = str(button.get("id") or "")
        if button_id and button_id not in ordered:
            ordered.append(button_id)
    return ordered


def _buttons_in_order(board: dict) -> list[dict]:
    by_id = {str(b.get("id") or ""): b for b in board.get("buttons") or []}
    return [by_id[key] for key in _grid_order(board) if key in by_id]


def _images_by_id(board: dict) -> dict[str, dict]:
    return {str(i.get("id") or ""): i for i in board.get("images") or []}


def _targets(document: Document, board_id: str) -> list[str]:
    """Which boards this one links to, in button order."""
    board = document.boards.get(board_id) or {}
    found = []
    for button in _buttons_in_order(board):
        target = _link_target(document, button)
        if target:
            found.append(target)
    return found


def _link_target(document: Document, button: dict) -> str:
    """The board id a load_board points at, or "" if it points nowhere here.

    Three ways to say it and they are tried in that order: the id, the path
    inside the zip, and the name. The id is what this project writes; the path
    is what a document whose ids are not its file names uses; the name is the
    last resort and matches at most one board, because two boards with the
    same name make it meaningless.
    """
    link = button.get("load_board")
    if not isinstance(link, dict):
        return ""
    wanted = str(link.get("id") or "")
    if wanted in document.boards:
        return wanted
    path = str(link.get("path") or "")
    if path:
        for board_id in document.boards:
            if board_path(board_id) == path:
                return board_id
    name = str(link.get("name") or "")
    if name:
        matching = [b for b, board in document.boards.items()
                    if board.get("name") == name]
        if len(matching) == 1:
            return matching[0]
    return ""


def document_to_layout(document: Document) -> Layout:
    """The boards back into the file the build reads.

    Lossy in one direction only, and knowingly: everything OBF can hold that
    this device cannot do - a third row of keys, a button with an action, a
    picture carried as pixels - has no field in layout.json. What survives is
    what the device can show. validate() against the ESP32 profile is what
    says in advance whether a document is going to lose anything; this
    function stops only where carrying on would be a lie, which is a board
    with more speech keys than there are keys.
    """
    sets = []
    order = document.order()
    root_board = document.boards.get(document.root) or {}

    for board_id in order:
        board = document.boards[board_id]
        images = _images_by_id(board)
        slots = []
        switch: dict | None = None

        for button in _buttons_in_order(board):
            symbol = symbol_of(images.get(str(button.get("image_id") or ""), {}))
            if isinstance(button.get("load_board"), dict):
                # The first link out is the set key. A board with several is
                # legal OBF and normal on a phone; here the rest cannot be
                # reached and validate() says so.
                if switch is None:
                    switch = {"symbol": symbol}
                continue
            slots.append({
                # The vocalization is what gets spoken and therefore what a
                # slot's text is. The label stands in when there is none,
                # which is the common case in boards written elsewhere.
                "text": str(button.get("vocalization")
                            or button.get("label") or ""),
                "symbol": symbol,
            })

        if len(slots) > SLOTS_PER_SET:
            raise BuildError("build.err.too_many_slots",
                             set=str(board.get("name") or board_id),
                             found=len(slots), expected=SLOTS_PER_SET)

        colour = board.get("ext_vorlaut_color")
        sets.append({
            "name": str(board.get("name") or board_id),
            "active": bool(board.get("ext_vorlaut_active", True)),
            "symbol": (switch or {}).get("symbol", ""),
            # No ext_vorlaut_color means a board from somewhere else, and then
            # normalize_layout() hands out a colour from the palette. Reading
            # it back out of border_color was the alternative and it is worse:
            # rgb() through hex and back is a conversion that has to come out
            # identical twice for a file to look unchanged.
            "color": colour if isinstance(colour, str) and colour else "",
            "slots": slots,
        })

    raw = {
        "sets": sets,
        "language": _locale_to_language(root_board.get("locale")),
        "voice": str(root_board.get("ext_vorlaut_voice") or ""),
    }
    timeout = root_board.get("ext_vorlaut_sleep_timeout_seconds")
    if timeout is not None:
        raw["sleep_timeout_seconds"] = timeout
    return normalize_layout(raw)


def _locale_to_language(locale) -> str:
    """A BCP-47 locale down to the two codes this project has.

    "de-DE" and "de" are the same answer, and anything else falls back the way
    normalize_layout() already falls back: an unknown language costs the four
    menu labels, not the content, and that is not worth stopping an import
    over.
    """
    code = str(locale or "").strip().lower().replace("_", "-").partition("-")[0]
    return code if code in LANGUAGE_CODES else DEFAULT_LANGUAGE


# --- The graph ---------------------------------------------------------------
# Boards linking to boards is a directed graph, and once it is one the
# interesting questions are not about any single board. A phone layout with
# sixty of them has room for a board nothing reaches, a link to a board that
# was deleted, and a subtree somebody wants to copy into another document -
# none of which come up while there are five sets in a ring, and all of which
# have to be answerable before there are not.

def links(document: Document) -> dict[str, list[str]]:
    """Board id -> the boards it can reach in one press."""
    return {board_id: _targets(document, board_id)
            for board_id in document.boards}


def reachable(document: Document, start: str | None = None) -> set[str]:
    """Every board you can get to from the root without picking the device up."""
    start = document.root if start is None else start
    if start not in document.boards:
        return set()
    seen: set[str] = set()
    queue = [start]
    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)
        queue.extend(_targets(document, current))
    return seen


def orphans(document: Document) -> list[str]:
    """Boards nothing links to. Not an error - a question worth asking."""
    return sorted(set(document.boards) - reachable(document))


def broken_links(document: Document) -> list[tuple[str, str, str]]:
    """(board, button, what it asked for) for every link that leads nowhere."""
    found = []
    for board_id in sorted(document.boards):
        for button in _buttons_in_order(document.boards[board_id]):
            link = button.get("load_board")
            if not isinstance(link, dict):
                continue
            if not _link_target(document, button):
                asked = str(link.get("id") or link.get("path")
                            or link.get("name") or link.get("url") or "?")
                found.append((board_id, str(button.get("id") or ""), asked))
    return found


def subtree(document: Document, board_id: str) -> Document:
    """The part of the document that hangs off one board, as its own document.

    What copying a board into another collection has to mean: the board and
    everything it can reach, with nothing else along for the ride. Ids are
    kept as they are - renaming on copy is the caller's problem, and it has to
    be, because whether a collision matters depends on where it is going.
    """
    keep = reachable(document, board_id)
    boards = {key: json.loads(json.dumps(value))
              for key, value in document.boards.items() if key in keep}
    files = dict(document.files)
    return Document(root=board_id, boards=boards, files=files)


# --- Validation --------------------------------------------------------------

def estimate_bytes(document: Document) -> int:
    """What the active boards would cost in the flash - a floor, not a promise.

    Counted from what the document says rather than from files on disk, so it
    answers before anything is built. Distinct symbols only, because a tile
    depends on its symbol alone and the same picture in two sets is one file -
    that is tiles.py's rule and this has to use the same one or the number is
    wrong in the safe direction and therefore useless.

    Audio is whatever the sounds carry. A document with none - the normal
    case, since text is the source of truth and the WAVs are build output -
    contributes nothing here, which is exactly why this is a floor. The real
    check is flashing.py against the files that actually exist.
    """
    active = [b for b in document.boards.values()
              if bool(b.get("ext_vorlaut_active", True))]
    symbols: set[str] = set()
    total = HEADER_BYTES + SET_BYTES * len(active)
    for board in active:
        images = _images_by_id(board)
        for button in _buttons_in_order(board):
            symbols.add(symbol_of(images.get(str(button.get("image_id") or ""), {})))
        for sound in board.get("sounds") or []:
            stated = sound.get("ext_vorlaut_bytes")
            if isinstance(stated, int):
                total += stated
            else:
                try:
                    total += int(float(sound.get("duration") or 0) * BYTES_PER_SECOND)
                except (TypeError, ValueError):
                    pass
    return total + TILE_BYTES * len(symbols)


def validate(document: Document, profile: Profile = ESP32) -> list[Problem]:
    """Everything wrong with this document for this target, all at once.

    Two halves. The first is true of any OBF document at all - a link that
    leads nowhere, an image_id naming an image the board does not have, a
    licensed collection stored as pixels. The second is the profile's, and is
    the only place that knows there is such a thing as an ESP32.
    """
    problems: list[Problem] = []

    if not document.root or document.root not in document.boards:
        problems.append(_problem("obf.check.no_root", name=document.root or "-"))

    for board_id in sorted(document.boards):
        board = document.boards[board_id]
        if board.get("format") != FORMAT:
            problems.append(_problem("obf.check.format", board=board_id,
                                     found=str(board.get("format") or "-"),
                                     expected=FORMAT))
        images = _images_by_id(board)
        sounds = {str(s.get("id") or "") for s in board.get("sounds") or []}
        for button in _buttons_in_order(board):
            button_id = str(button.get("id") or "")
            picture = str(button.get("image_id") or "")
            if picture and picture not in images:
                problems.append(_problem("obf.check.no_image", board=board_id,
                                         button=button_id, image=picture))
            sound = str(button.get("sound_id") or "")
            if sound and sound not in sounds:
                problems.append(_problem("obf.check.no_sound", board=board_id,
                                         button=button_id, sound=sound))
        for image in board.get("images") or []:
            symbol = image.get("symbol")
            name = str(image.get("id") or "-")
            if not isinstance(symbol, dict) or not symbol.get("filename"):
                problems.append(_problem("obf.check.not_a_reference",
                                         board=board_id, image=name))
                continue
            collection = str(symbol.get("set") or "")
            if collection not in (OWN_SET, METACOM_SET):
                problems.append(_problem("obf.check.unknown_set",
                                         board=board_id, image=name,
                                         set=collection or "-"))
            if collection == METACOM_SET:
                carried = [f for f in ("data", "url", "path") if image.get(f)]
                if carried:
                    problems.append(_problem("obf.check.metacom_pixels",
                                             board=board_id, image=name,
                                             field=", ".join(carried)))

    for board_id, button_id, asked in broken_links(document):
        problems.append(_problem("obf.check.broken_link", board=board_id,
                                 button=button_id, target=asked))
    for board_id in orphans(document):
        problems.append(_problem("obf.check.orphan", board=board_id))

    problems.extend(_profile_problems(document, profile))
    return problems


def _profile_problems(document: Document, profile: Profile) -> list[Problem]:
    problems: list[Problem] = []

    active = [b for b in sorted(document.boards)
              if bool(document.boards[b].get("ext_vorlaut_active", True))]
    if profile.max_boards is not None and len(active) > profile.max_boards:
        problems.append(_problem("obf.check.too_many_boards",
                                 max=profile.max_boards, found=len(active),
                                 profile=profile.name))

    for board_id in sorted(document.boards):
        board = document.boards[board_id]
        buttons = _buttons_in_order(board)
        speech = [b for b in buttons if not isinstance(b.get("load_board"), dict)]
        outgoing = [b for b in buttons if isinstance(b.get("load_board"), dict)]

        if profile.max_speech_keys is not None \
                and len(speech) > profile.max_speech_keys:
            problems.append(_problem("obf.check.too_many_keys", board=board_id,
                                     found=len(speech),
                                     max=profile.max_speech_keys,
                                     profile=profile.name))
        if profile.grid is not None:
            grid = board.get("grid") or {}
            found = (grid.get("rows"), grid.get("columns"))
            if found != profile.grid:
                problems.append(_problem(
                    "obf.check.grid", board=board_id,
                    found=f"{found[0]}x{found[1]}",
                    expected=f"{profile.grid[0]}x{profile.grid[1]}",
                    profile=profile.name))
        if profile.single_ring and len(outgoing) != 1:
            problems.append(_problem("obf.check.not_a_ring", board=board_id,
                                     found=len(outgoing),
                                     profile=profile.name))
        if profile.prerendered:
            for button in buttons:
                action = button.get("action") or (button.get("actions") or [None])[0]
                if action:
                    problems.append(_problem(
                        "obf.check.action", board=board_id,
                        button=str(button.get("id") or ""), action=str(action),
                        profile=profile.name))
            for button in buttons:
                if button.get("hidden"):
                    problems.append(_problem(
                        "obf.check.hidden", board=board_id,
                        button=str(button.get("id") or ""), profile=profile.name))

    if profile.budget_bytes is not None:
        used = estimate_bytes(document)
        if used > profile.budget_bytes:
            problems.append(_problem("obf.check.too_big",
                                     used=f"{used / 1024:.0f}",
                                     fits=f"{profile.budget_bytes / 1024:.0f}",
                                     profile=profile.name))
    return problems


# --- Attaching the payload ---------------------------------------------------
# By default a .obz carries no pixels and no audio: it is the document, and
# the pictures are references while the sound is build output. Both of those
# are still worth being able to put in - a board handed to somebody who has
# neither content/symbols/ nor a voice is otherwise a list of file names.
#
# Which is why they are two separate steps rather than a flag on the writer.
# Embedding your own symbols is a decision; embedding METACOM is not available
# at any setting.

def attach_images(document: Document) -> list[str]:
    """Copies the symbols that are yours into the document. Returns what went in.

    The METACOM ones are skipped rather than refused, because skipping is the
    correct answer: the reference stays, the pixels do not travel, and the
    person at the other end resolves it against their own licensed copy or
    sees a placeholder. check_licensing() is the backstop for anything that
    tries the other way round.
    """
    added = []
    for board_id in sorted(document.boards):
        for image in document.board(board_id).get("images") or []:
            symbol = image.get("symbol") or {}
            if not isinstance(symbol, dict):
                continue
            if symbol.get("set") != OWN_SET:
                continue
            filename = str(symbol.get("filename") or "")
            source = tiles.symbol_path(filename)
            if source is None:
                continue
            inside = f"{IMAGE_DIR}/{Path(filename).name}"
            document.files[inside] = source.read_bytes()
            image["path"] = inside
            image["content_type"] = _content_type(source.suffix)
            added.append(inside)
    return added


def _content_type(suffix: str) -> str:
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".svg": "image/svg+xml",
            ".wav": "audio/wav", ".mp3": "audio/mpeg"}.get(
                suffix.lower(), "application/octet-stream")


def attach_sounds(document: Document, voice: str = "") -> list[str]:
    """Puts the already rendered sentences into the document.

    Only the ones that are in the TTS cache - nothing is spoken here. That is
    the whole shape of the arrangement: the text is the source of truth and
    the WAV is what a build made of it, so a missing recording is a build that
    has not run, not a document that is broken. Coming back the other way,
    document_to_layout() ignores sounds entirely for the same reason.
    """
    if not voice:
        root = document.boards.get(document.root) or {}
        voice = str(root.get("ext_vorlaut_voice") or "")
    if not voice:
        return []

    added = []
    for board_id in sorted(document.boards):
        board = document.board(board_id)
        found: dict[str, dict] = {str(s.get("id") or ""): s
                                  for s in board.get("sounds") or []
                                  if s.get("id")}
        for button in _buttons_in_order(board):
            text = str(button.get("vocalization") or button.get("label") or "")
            if not text:
                continue
            source = tts.cache_path(text, voice)
            if not source.exists():
                continue
            payload = source.read_bytes()
            inside = f"{SOUND_DIR}/{source.name}"
            document.files[inside] = payload
            sound_id = f"snd-{source.stem}"
            found[sound_id] = {
                "id": sound_id,
                "path": inside,
                "content_type": "audio/wav",
                "duration": round(wav_seconds(payload), 3),
                # Which voice made it, and how many bytes it is. The first is
                # what tells a second machine whether this recording still
                # matches its own settings; the second is what lets
                # estimate_bytes() answer without unpacking the zip.
                "ext_vorlaut_voice": voice,
                "ext_vorlaut_bytes": len(payload),
            }
            button["sound_id"] = sound_id
            added.append(inside)
        board["sounds"] = [found[key] for key in sorted(found)]
    return added


def wav_seconds(payload: bytes) -> float:
    """How long a RIFF/WAVE file plays, from its own header.

    Walks the chunks rather than assuming the canonical 44-byte header: ffmpeg
    writes a LIST chunk between fmt and data often enough that assuming would
    be wrong about a third of the time.
    """
    if len(payload) < 12 or payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
        return 0.0
    position = 12
    rate = channels = bits = 0
    while position + 8 <= len(payload):
        name = payload[position:position + 4]
        size = struct.unpack("<I", payload[position + 4:position + 8])[0]
        body = payload[position + 8:position + 8 + size]
        if name == b"fmt " and len(body) >= 16:
            channels, rate = struct.unpack("<HI", body[2:8])
            bits = struct.unpack("<H", body[14:16])[0]
        elif name == b"data":
            per_frame = channels * max(bits, 8) // 8
            return len(body) / (rate * per_frame) if rate and per_frame else 0.0
        position += 8 + size + (size % 2)
    return 0.0


# --- Reading and writing a .obz ----------------------------------------------

def manifest_of(document: Document) -> dict:
    """The manifest the spec asks for, and nothing beyond it.

    Deliberately thin. Everything about the document that is vorlaut's own
    sits on the root board instead - see layout_to_document(). A manifest is
    an index of a zip, and an index is the thing a tool rewrites without
    thinking about what it was carrying.
    """
    paths = {board_id: board_path(board_id) for board_id in document.order()}
    manifest = {
        "format": FORMAT,
        "root": board_path(document.root) if document.root else "",
        "paths": {"boards": paths},
    }
    images = {name: name for name in sorted(document.files)
              if name.startswith(IMAGE_DIR + "/")}
    sounds = {name: name for name in sorted(document.files)
              if name.startswith(SOUND_DIR + "/")}
    if images:
        manifest["paths"]["images"] = images
    if sounds:
        manifest["paths"]["sounds"] = sounds
    return manifest


def write_obz(document: Document, path: Path) -> Path:
    """Writes the document out as a .obz.

    check_licensing() first, always, whatever the caller thinks it is doing.
    That is the only reason this function exists rather than callers reaching
    for zipfile: there has to be exactly one door, so that the invariant can
    stand next to it.
    """
    check_licensing(document)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Fixed timestamps and a sorted order, so the same document always writes
    # the same bytes - "has anything changed" should be answerable with cmp.
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as bundle:
        _put(bundle, MANIFEST_NAME, _json_bytes(manifest_of(document)))
        for board_id in document.order():
            _put(bundle, board_path(board_id),
                 _json_bytes(document.boards[board_id]))
        for name in sorted(document.files):
            _put(bundle, name, document.files[name])
    return path


def _put(bundle: zipfile.ZipFile, name: str, payload: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    bundle.writestr(info, payload)


def _json_bytes(data: dict) -> bytes:
    return (json.dumps(data, indent=2, ensure_ascii=False,
                       sort_keys=True) + "\n").encode("utf-8")


def read_obz(path: Path) -> Document:
    """Reads a .obz back into a document.

    Tolerant about where the boards are: the manifest is believed first, and
    if it names nothing usable every .obf in the zip is taken instead. Both
    happen in the wild - a manifest written by hand tends to be the half of
    the file that is wrong, and the boards are still all there.
    """
    path = Path(path)
    if not path.exists():
        raise BuildError("build.err.not_found", name=short(path))
    try:
        bundle = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise BuildError("obf.err.not_a_zip", name=short(path),
                         reason=str(exc)) from exc

    with bundle:
        names = bundle.namelist()
        manifest = {}
        if MANIFEST_NAME in names:
            manifest = _read_json(bundle, MANIFEST_NAME, path)

        wanted = manifest.get("paths", {}).get("boards")
        if not isinstance(wanted, dict) or not wanted:
            wanted = {Path(n).stem: n for n in sorted(names)
                      if n.endswith(".obf")}

        boards: dict[str, dict] = {}
        by_member: dict[str, str] = {}
        for key, member in sorted(wanted.items()):
            if member not in names:
                continue
            board = _read_json(bundle, member, path)
            board_id = str(board.get("id") or key)
            boards[board_id] = board
            by_member[member] = board_id

        files = {name: bundle.read(name) for name in sorted(names)
                 if name != MANIFEST_NAME and not name.endswith(".obf")
                 and not name.endswith("/")}

    root_member = str(manifest.get("root") or "")
    root = by_member.get(root_member, "")
    if not root:
        # A manifest that names a board nobody packed. The document is still
        # readable and a root still has to be picked, so it is the first one
        # in the manifest's own order - which is the order it was written in.
        root = next(iter(boards), "")
    if not boards:
        raise BuildError("obf.err.no_boards", name=short(path))
    return Document(root=root, boards=boards, files=files)


def _read_json(bundle: zipfile.ZipFile, member: str, path: Path) -> dict:
    try:
        data = json.loads(bundle.read(member).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise BuildError("build.err.bad_json", name=f"{short(path)}:{member}",
                         reason=str(exc)) from exc
    return data if isinstance(data, dict) else {}


# --- The two ends ------------------------------------------------------------

def export_obz(path: Path, layout: Layout | None = None, *,
               with_images: bool = False, with_sounds: bool = False) -> Path:
    """content/layout.json out to a .obz."""
    if layout is None:
        layout = load_layout()
    document = layout_to_document(layout)
    if with_images:
        attach_images(document)
    if with_sounds:
        attach_sounds(document, chosen_voice(layout))
    return write_obz(document, path)


def import_obz(path: Path, *, save: bool = False) -> Layout:
    """A .obz in as content/layout.json.

    Does not write unless asked to. Reading somebody else's document and
    seeing what it would become is the common case, and it should not cost
    the file you already had.
    """
    layout = document_to_layout(read_obz(path))
    return save_layout(layout) if save else layout


# --- Command line ------------------------------------------------------------

def main(argv: list[str]) -> int:
    """python3 obf.py export out.obz [--images] [--sounds]
       python3 obf.py import in.obz [--save]
       python3 obf.py check in.obz [--profile esp32|phone]"""
    if len(argv) < 3 or argv[1] not in ("export", "import", "check"):
        print(main.__doc__)
        return 2
    command, path = argv[1], Path(argv[2])
    flags = argv[3:]

    if command == "export":
        written = export_obz(path, with_images="--images" in flags,
                             with_sounds="--sounds" in flags)
        print(f"Wrote {short(written)} ({written.stat().st_size} bytes).")
        return 0

    document = read_obz(path)
    if command == "import":
        layout = document_to_layout(document)
        if "--save" in flags:
            save_layout(layout)
            print(f"Saved {len(layout['sets'])} set(s) into layout.json.")
        else:
            print(json.dumps(layout, indent=2, ensure_ascii=False))
        return 0

    name = flags[flags.index("--profile") + 1] if "--profile" in flags else "esp32"
    profile = PROFILES.get(name)
    if profile is None:
        print(f"No such profile: {name}. Try {', '.join(sorted(PROFILES))}.")
        return 2
    problems = validate(document, profile)
    print(f"{len(document.boards)} board(s), "
          f"{estimate_bytes(document) / 1024:.0f} KiB estimated, "
          f"profile {profile.name}.")
    for problem in problems:
        print(f"  {problem}")
    print("  Nothing to report." if not problems
          else f"  {len(problems)} problem(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
