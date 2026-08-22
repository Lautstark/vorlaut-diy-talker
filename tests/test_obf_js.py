#!/usr/bin/env python3
"""Checks that static/obf.js maps a board exactly as obf.py maps it.

The app is becoming a static site, so the Open Board Format converter exists
twice now. obf.py is the oracle: it is not touched while it is being measured
against, for the same reason tiles.py was left alone while tiles.js was proven
against it - a changed oracle makes every measurement meaningless.

What is compared here is the document, field for field. That is the whole
reason this stage can stand on its own: a .obf is JSON, so both halves can be
asked the same question and their answers compared without a zip, without a
browser and without a byte of the container being written yet.

Three questions, and they are not the same question:

  the helpers      split_symbol, join_symbol, image_id, symbol_of, css_color,
                   the locale fallback, the grid, the order boards come back in
                   and normalize_layout - each on a table of awkward
                   arguments, because these are where two implementations of
                   one rule quietly drift apart.
  layout -> board  every layout below through both, compared field for field.
  board -> layout  the documents that came out of that, and a set of documents
                   nothing here would ever write: a third row of keys, links
                   by path and by name, an orphan, a picture carried as pixels,
                   a locale nobody has heard of. Through normalize_layout(),
                   which is where a foreign board is given the colour, the four
                   slots and the timeout it did not come with - it is in
                   layout.py rather than in obf.py, and leaving it out would
                   leave documentToLayout() answering with a layout nobody may
                   save.

The last group is the one that matters most and is the easiest to leave out.
An export only ever meets its own documents; an import meets whatever a
therapist's software wrote.

And then the container, which is bytes rather than JSON and is measured
differently on purpose. Python's zlib and the browser's deflate agree about
the format and not about the output, so byte-identical .obz files are not the
bar and cannot be: what has to be identical is what comes out of them. Every
zip the JavaScript writes is opened with Python's own zipfile and compared
member by member - names, order, timestamps, permissions and the bytes inside
- and every zip Python writes is handed to the JavaScript to read back.

What is not here: validate(), the profiles and estimate_bytes(). They are not
in static/obf.js either - see the note at the top of it.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Set before the project modules are imported: config.py resolves the content
# directory once, at import time, and nothing in this test should be able to
# reach the developer's own.
WORKSPACE = tempfile.TemporaryDirectory()
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name
os.environ.pop("VORLAUT_DATA", None)
os.environ.pop("VORLAUT_METACOM_DIR", None)

import obf  # noqa: E402
from buildbase import BuildError  # noqa: E402
from layout import load_layout, normalize_layout  # noqa: E402

DRIVER = ROOT / "tests" / "obf_node.mjs"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def plain(value):
    """A Python answer as the JSON it would travel as.

    Tuples become lists and dictionaries lose their order, which is what makes
    the comparison below about the values and not about how each language
    happens to hold them.
    """
    return json.loads(json.dumps(value))


def difference(want, got, path: str = "") -> str | None:
    """Where two answers stop agreeing, as one line naming the field.

    A dict comparison that fails prints two screenfuls of JSON and leaves the
    reader to diff them by eye. This says which board, which button and which
    field, which is the whole of what one wants to know.
    """
    where = path or "the answer"
    if isinstance(want, dict) and isinstance(got, dict):
        for key in sorted(set(want) | set(got)):
            if key not in want:
                return f"{where}: JavaScript adds {key!r}"
            if key not in got:
                return f"{where}: JavaScript is missing {key!r}"
            found = difference(want[key], got[key], f"{path}.{key}" if path else key)
            if found:
                return found
        return None
    if isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            return f"{where}: {len(want)} entries in Python, {len(got)} in JavaScript"
        for index, (one, two) in enumerate(zip(want, got)):
            found = difference(one, two, f"{path}[{index}]")
            if found:
                return found
        return None
    if want != got:
        return f"{where}: {want!r} in Python, {got!r} in JavaScript"
    return None


# --- The helpers -------------------------------------------------------------

def document_of(raw: dict) -> obf.Document:
    return obf.Document(root=raw.get("root", ""), boards=raw.get("boards") or {},
                        files={})


HELPERS = {
    "splitSymbol": obf.split_symbol,
    "joinSymbol": obf.join_symbol,
    "imageId": obf.image_id,
    "imageEntry": obf.image_entry,
    "symbolOf": obf.symbol_of,
    "cssColor": obf.css_color,
    "boardPath": obf.board_path,
    "localeToLanguage": obf._locale_to_language,
    "gridOrder": obf._grid_order,
    "grid": obf._grid,
    "order": lambda raw: document_of(raw).order(),
    # layout.py's, and the second half of this port - see the docstring.
    "normalizeLayout": normalize_layout,
}


def helper_calls() -> list[tuple[str, list]]:
    """Every rule that is small enough to state, on the arguments that bite.

    The escaped characters are deliberate and are not decoration: image_id is
    a hash over UTF-8, so a name outside ASCII is the one input that catches an
    encoder doing something else. U+00E4 is two bytes, U+20AC three and
    U+1F600 four - one of each, and the last is a surrogate pair in JavaScript
    and one character in Python, which is exactly the difference being checked.
    """
    names = ["", "ja.png", "metacom:essen", "metacom:", ":bare", "a:b:c",
             "vorlaut:own.png", "\u00e4\u20ac\U0001F600.png",
             "metacom:\u00e4\u20ac\U0001F600"]
    calls: list[tuple[str, list]] = []
    for name in names:
        calls.append(("splitSymbol", [name]))
        calls.append(("imageId", [name]))
        calls.append(("imageEntry", [name]))
    for symbol_set in ["", "vorlaut", "metacom", "arasaac", "\u20ac"]:
        for filename in ["", "ja.png", "\U0001F600"]:
            calls.append(("joinSymbol", [symbol_set, filename]))
    for image in [{}, {"symbol": None}, {"symbol": "ja.png"}, {"symbol": []},
                  {"symbol": {"set": "vorlaut", "filename": "ja.png"}},
                  {"symbol": {"set": "metacom", "filename": "essen"}},
                  {"symbol": {"set": "arasaac", "filename": "2349"}},
                  {"symbol": {"filename": "ja.png"}},
                  {"symbol": {"set": "metacom"}},
                  {"symbol": {"set": "", "filename": ""}},
                  {"url": "https://example.invalid/a.png"}]:
        calls.append(("symbolOf", [image]))
    for colour in ["#3B5BDB", "#abc", "3B5BDB", "", "  #ff8bc7  ", "#000000",
                   "#FFFFFF", "no colour at all", "#12345", "#ABCDEF"]:
        calls.append(("cssColor", [colour]))
    for board_id in ["set-1", "set-12", "a board", "\U0001F600"]:
        calls.append(("boardPath", [board_id]))
        calls.append(("grid", [board_id]))
    for locale in ["de", "en", "de-DE", "DE_de", "  De  ", "kl", "", None,
                   "en-GB-oed", "-de"]:
        calls.append(("localeToLanguage", [locale]))
    # The order boards come back in, asked directly as well as through an
    # import: it is what makes a round trip a round trip, and a difference in
    # it reads as every set having moved.
    for document in [{"root": "a", "boards": {"a": {}, "b": {}}},
                     {"root": "", "boards": {"b": {}, "a": {}}},
                     {"root": "gone", "boards": {"b": {}, "a": {}}},
                     {"root": "a", "boards": {"a": {"buttons": [
                         {"id": "go", "load_board": {"id": "b"}}]}, "b": {}}}]:
        calls.append(("order", [document]))
    for board in [{}, {"grid": {"order": [[None, "a"], ["b", None]]},
                       "buttons": [{"id": "b"}, {"id": "a"}, {"id": "c"}]},
                  {"buttons": [{"id": "one"}, {"id": ""}, {}]},
                  {"grid": {"order": [None, [], ["x"]]}, "buttons": []},
                  {"grid": {"order": [["a", "a"]]}, "buttons": [{"id": "a"}]}]:
        calls.append(("gridOrder", [board]))
    calls.extend(("normalizeLayout", [raw]) for raw in normalize_cases())
    return calls


def normalize_cases() -> list[dict]:
    """Files in every shape normalize_layout() is there to survive.

    Half of these cannot come out of an import at all - a layout with 26 sets,
    a `sets` that is a dictionary - and they are here because this is the
    function that decides what a layout is, and the browser now has a second
    copy of that decision. The other half is exactly what a foreign board
    becomes on the way in: no colour, a timeout somebody wrote as a string,
    more sets switched on than the device can hold.
    """
    cases: list[dict] = [{}, {"sets": []}]
    for timeout in [900, "900", " 900 ", 900.9, -900.9, True, None, "",
                    "9_0_0", "1e3", "0x10", "900.5", 0, 5, 10, 86400, 86401,
                    2 ** 40, [900], {"seconds": 900}]:
        cases.append({"sleep_timeout_seconds": timeout, "sets": []})
    for language in ["de", "en", "DE", " de ", "de-DE", "kl", "", None, 5]:
        cases.append({"language": language, "sets": []})
    for voice in ["piper:de_DE-thorsten-low", " azure:de-DE-KatjaNeural ",
                  "piper:", "espeak:x", "", None, 5]:
        cases.append({"voice": voice, "sets": []})
    cases.append({"sets": [{}]})
    cases.append({"sets": [{}, {}, {}, {}, {}, {}]})          # six, five active
    cases.append({"sets": [{"active": False}] * 6})
    cases.append({"sets": [{"active": None}, {"active": 0}, {"active": "no"}]})
    cases.append({"sets": [{"name": " Spaced "}, {"name": ""}, {"name": 5},
                           {"name": None}]})
    cases.append({"sets": [{"color": c} for c in
                           ["#abc", "3B5BDB", "", "not a colour", "  #ff8bc7  ",
                            "#ABCDEF"]]})
    # A palette colour per index, which is what a board with no colour of its
    # own is given - and the seventh set starts round again.
    cases.append({"sets": [{} for _ in range(7)]})
    cases.append({"sets": [{"slots": []}, {"slots": [{"text": " a "}]},
                           {"slots": [{}, {}, {}, {}]},
                           {"slots": [{"text": 5, "symbol": None}]},
                           {"slots": ["not a slot", None, 5, []]}]})
    cases.append({"sets": [{"slots": {"a": 1}}]})     # not a list: no slots
    cases.append({"sets": [{"slots": [{}, {}, {}, {}, {}]}]})     # five: refused
    cases.append({"sets": ["not a set", None, 5, []]})
    cases.append({"sets": [{} for _ in range(25)]})
    cases.append({"sets": [{} for _ in range(26)]})               # refused
    cases.append({"sets": {"one": {}}})                           # refused
    cases.append({"sets": None})
    cases.append({"sets": [{"symbol": " ja.png "}, {"symbol": None},
                           {"symbol": 5}]})
    return cases


# --- Layouts to drive through both -------------------------------------------

def export_cases() -> list[tuple[str, dict]]:
    """Layouts on the way out. Normalized, which is what the exporter is given.

    Two are not: layout_to_document reads `language` and `voice` with a
    default, and a layout that never had them is what a half-migrated file
    looks like. Both implementations have to answer that the same way.
    """
    awkward = {
        "sleep_timeout_seconds": 900,
        "language": "de",
        "voice": "piper:de_DE-thorsten-low",
        "sets": [
            {
                "name": "Basics",
                "color": "#3B5BDB",
                "symbol": "start.png",
                "slots": [
                    {"text": "Yes!", "symbol": "ja.png"},
                    # Not ASCII, and not an accident: the text goes through
                    # JSON and a zip, and both have an encoding somebody can
                    # get wrong.
                    {"text": "No \u2014 I don\u2019t want that",
                     "symbol": "metacom:nein"},
                    {"text": "Stop", "symbol": ""},        # words, no picture
                    {"text": "", "symbol": "hilfe.png"},   # picture, no words
                ],
            },
            {
                "name": "Going out to play",
                "color": "#159947",
                "symbol": "metacom:spielen",
                "active": False,                           # stays in the file
                "slots": [{"text": "More of that", "symbol": "mehr.png"}],
            },
            {
                "name": "Outdoors",
                "color": "#9B7BFF",
                "symbol": "",                              # no set symbol
                "slots": [],                               # normalize fills in
            },
        ],
    }
    repeated = {
        "sleep_timeout_seconds": 600,
        "language": "en",
        "voice": "",
        # The same picture in two sets is one images[] entry per board and the
        # same id in both - which is what makes it one file on the device.
        "sets": [{"name": f"Set {i + 1}", "color": c, "symbol": "ja.png",
                  "slots": [{"text": f"Line {i}{j}", "symbol": "ja.png"}
                            for j in range(4)]}
                 for i, c in enumerate(["#000000", "#FFFFFF", "#FF0000",
                                        "#00FF00", "#0000FF"])]}
    outside_ascii = {
        "sleep_timeout_seconds": 10,
        "language": "en",
        "voice": "azure:de-DE-KatjaNeural",
        "sets": [{"name": "\u00e4\u20ac\U0001F600", "color": "#ff8bc7",
                  "symbol": "\U0001F600.png",
                  "slots": [{"text": "\u2014\u2019\u00a0", "symbol": "\u00e4.png"},
                            {"text": "\U0001F600", "symbol": "metacom:\u00e4"}]}],
    }
    return [
        ("nothing at all", normalize_layout({"sets": []})),
        ("one set", normalize_layout(
            {"sleep_timeout_seconds": 30, "language": "en",
             "sets": [{"name": "Only", "color": "#3B5BDB", "symbol": "a.png",
                       "slots": [{"text": "Hello", "symbol": "b.png"}]}]})),
        ("the awkward one", normalize_layout(awkward)),
        ("the same symbol in five sets", normalize_layout(repeated)),
        ("names and symbols outside ASCII", normalize_layout(outside_ascii)),
        ("the example content", load_layout(ROOT / "example" / "layout.json")),
        # Not normalized on purpose - see the docstring.
        ("no language and no voice",
         {"sleep_timeout_seconds": 600,
          "sets": [{"name": "Bare", "color": "#3B5BDB", "symbol": "",
                    "active": True, "slots": [{"text": "x", "symbol": ""}]}]}),
        ("an empty language rather than a missing one",
         {"sleep_timeout_seconds": 600, "language": "", "voice": "",
          "sets": [{"name": "Bare", "color": "#3B5BDB", "symbol": "",
                    "active": True, "slots": []}]}),
    ]


def foreign_cases() -> list[tuple[str, dict]]:
    """Documents nothing here would ever write, which is the point.

    An export only ever meets its own boards. An import meets whatever
    somebody else's software wrote, and every row of the "what does not
    survive" table in docs/obf.md is a shape that has to arrive without the
    two implementations disagreeing about what it became.
    """
    def board(board_id, **fields):
        return {"format": obf.FORMAT, "id": board_id, "locale": "en",
                "name": board_id, "buttons": [], "images": [], **fields}

    def key(button_id, label, **fields):
        return {"id": button_id, "label": label, **fields}

    cases = []

    # A grid this device does not have, and more speech keys than it has keys.
    cases.append(("a third row of keys", {
        "root": "big",
        "boards": {"big": board("big", name="Nine keys", grid={
            "rows": 3, "columns": 3,
            "order": [[f"k{i * 3 + j}" for j in range(3)] for i in range(3)]},
            buttons=[key(f"k{i}", f"Key {i}") for i in range(9)])}}))

    # Buttons the grid does not name are appended rather than dropped, and the
    # grid's order is the order - not the order of buttons[].
    cases.append(("a button the grid leaves out", {
        "root": "a",
        "boards": {"a": board("a", grid={"rows": 1, "columns": 2,
                                         "order": [["two", "one"]]},
                              buttons=[key("one", "One"), key("two", "Two"),
                                       key("three", "Three")])}}))

    # No vocalization, which is the common case elsewhere, and no grid at all.
    cases.append(("labels without vocalizations and no grid", {
        "root": "a",
        "boards": {"a": board("a", buttons=[
            key("one", "Spoken?"), key("two", "", vocalization="Said this"),
            key("three", "Label", vocalization=""),
            key("four", "", vocalization="")])}}))

    # The two fields saying different things, which is the whole reason both
    # are written: the vocalization wins and the label is what an editor draws.
    # Everything this project exports has the same sentence in both, so
    # without this case the rule is not being checked at all.
    cases.append(("a label and a vocalization that disagree", {
        "root": "a",
        "boards": {"a": board("a", buttons=[
            key("one", "Shortened for the key",
                vocalization="The whole sentence, spoken")])}}))

    # Three ways to name a link and one that names nothing. The ids are not
    # the file names, which is what makes the path lookup the answer.
    cases.append(("links by id, by path and by name", {
        "root": "first",
        "boards": {
            "first": board("first", name="First", buttons=[
                key("go", "By id", load_board={"id": "second"})]),
            "second": board("second", name="Second", buttons=[
                key("go", "By path",
                    load_board={"id": "not-here",
                                "path": obf.board_path("third")})]),
            "third": board("third", name="Third", buttons=[
                key("go", "By name", load_board={"name": "First"})]),
        }}))
    cases.append(("a link that leads nowhere", {
        "root": "a",
        "boards": {"a": board("a", buttons=[
            key("go", "Gone", load_board={"id": "deleted"})])}}))
    cases.append(("two boards with the same name, named rather than linked", {
        "root": "a",
        "boards": {
            "a": board("a", name="Same", buttons=[
                key("go", "Which one", load_board={"name": "Same"})]),
            "b": board("b", name="Same"),
        }}))

    # Nothing links to it, so it comes last, in id order. That is what makes a
    # round trip a round trip rather than a set of boards in whatever order a
    # dictionary happened to hold them.
    cases.append(("orphans, which come last and sorted", {
        "root": "start",
        "boards": {
            "start": board("start", buttons=[
                key("go", "On", load_board={"id": "zzz"})]),
            "zzz": board("zzz"),
            "mmm": board("mmm"),
            "aaa": board("aaa"),
        }}))
    cases.append(("a root that is not in the document", {
        "root": "missing",
        "boards": {"b": board("b"), "a": board("a")}}))
    cases.append(("no root at all", {
        "root": "", "boards": {"a": board("a")}}))

    # Legal OBF, unreachable here: the first link out is the set key and the
    # rest are keys nobody can press.
    cases.append(("several links out of one board", {
        "root": "a",
        "boards": {
            "a": board("a", buttons=[
                key("one", "First", load_board={"id": "b"}),
                key("two", "Second", load_board={"id": "c"}),
                key("say", "Words")]),
            "b": board("b"), "c": board("c"),
        }}))
    cases.append(("a ring that closes on itself", {
        "root": "a",
        "boards": {
            "a": board("a", buttons=[key("go", "On", load_board={"id": "b"})]),
            "b": board("b", buttons=[key("go", "On", load_board={"id": "a"})]),
        }}))

    # Pictures that are not references. There is nowhere to put them, so the
    # key comes back with no symbol rather than with something invented.
    cases.append(("images carried as pixels", {
        "root": "a",
        "boards": {"a": board(
            "a",
            buttons=[key("one", "Data", image_id="img-1"),
                     key("two", "Path", image_id="img-2"),
                     key("three", "Missing", image_id="img-nowhere"),
                     key("four", "Named", image_id="img-4")],
            images=[{"id": "img-1", "data": "data:image/png;base64,iVBORw0KGgo="},
                    {"id": "img-2", "path": "images/one.png",
                     "symbol": {"set": "vorlaut", "filename": "one.png"}},
                    {"id": "img-4", "symbol": {"set": "arasaac",
                                               "filename": "2349"}},
                    {"id": "", "symbol": {"set": "vorlaut",
                                          "filename": "nameless.png"}}])}}))

    # Everything vorlaut writes on a board, absent. A foreign board has no
    # colour, no active flag, no timeout and a locale of its own.
    for locale in ("de-DE", "fr", None):
        cases.append((f"a foreign board with locale {locale!r}", {
            "root": "a",
            "boards": {"a": {"format": "open-board-0.1", "id": "a",
                             "name": "Theirs", "locale": locale,
                             "buttons": [key("one", "Hello")],
                             "images": []}}}))
    cases.append(("vorlaut's own fields in shapes they never take", {
        "root": "a",
        "boards": {"a": board(
            "a", ext_vorlaut_color="", ext_vorlaut_active=None,
            ext_vorlaut_voice=None, ext_vorlaut_sleep_timeout_seconds=None,
            buttons=[key("one", "Hello")])}}))
    cases.append(("a colour that is not a string", {
        "root": "a",
        "boards": {"a": board("a", ext_vorlaut_color=59, ext_vorlaut_active=0,
                              ext_vorlaut_sleep_timeout_seconds=45,
                              buttons=[key("one", "Hello")])}}))
    cases.append(("a board with nothing on it at all", {
        "root": "a", "boards": {"a": {}}}))
    return cases


def licensing_cases() -> list[tuple[str, dict]]:
    """Documents the writer has to refuse, and ones it has to let past.

    The licence is per person: a file carrying METACOM pixels has already
    handed the collection to whoever received it. Both implementations have to
    refuse the same documents, and say the same sentence while doing it.
    """
    def with_image(image):
        return {"root": "a", "boards": {"a": {"id": "a", "images": [image]}}}

    return [
        ("a reference is fine",
         with_image({"id": "img-1", "symbol": {"set": "metacom",
                                               "filename": "essen"}})),
        ("your own symbols may carry pixels",
         with_image({"id": "img-2", "path": "images/ja.png",
                     "symbol": {"set": "vorlaut", "filename": "ja.png"}})),
        ("METACOM as a data URL is refused",
         with_image({"id": "img-3", "data": "data:image/png;base64,iVBORw0KGgo=",
                     "symbol": {"set": "metacom", "filename": "essen"}})),
        ("METACOM as a file in the zip is refused",
         with_image({"id": "img-4", "path": "images/essen.png",
                     "symbol": {"set": "metacom", "filename": "essen"}})),
        ("METACOM as a URL is refused",
         with_image({"id": "img-5", "url": "https://example.invalid/essen.png",
                     "symbol": {"set": "metacom", "filename": "essen"}})),
        ("all three at once are all three named",
         with_image({"id": "img-6", "data": "x", "url": "y", "path": "z",
                     "symbol": {"set": "metacom", "filename": "essen"}})),
        ("an image with no id is named by its file name",
         with_image({"data": "x", "symbol": {"set": "metacom",
                                             "filename": "essen"}})),
        ("and one with neither is still refused",
         with_image({"data": "x", "symbol": {"set": "metacom"}})),
        ("the board that is refused is the first in id order",
         {"root": "b",
          "boards": {
              "b": {"id": "b", "images": [
                  {"id": "late", "data": "x",
                   "symbol": {"set": "metacom", "filename": "later"}}]},
              "a": {"id": "a", "images": [
                  {"id": "early", "data": "x",
                   "symbol": {"set": "metacom", "filename": "earlier"}}]}}}),
    ]


# --- The container -----------------------------------------------------------

def wav(seconds: float = 0.25) -> bytes:
    """A real 16 kHz mono WAV, so a sound in the zip is a sound.

    Bytes that are not text and do not compress to nothing, which is what the
    binary half of the container has to survive.
    """
    frames = int(16000 * seconds)
    body = bytes((i * 37) % 256 for i in range(frames * 2))
    fmt = struct.pack("<HHIIHH", 1, 1, 16000, 32000, 2, 16)
    chunks = b"fmt " + struct.pack("<I", len(fmt)) + fmt \
        + b"data" + struct.pack("<I", len(body)) + body
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks


def hand_built(path: Path, members: list[tuple[str, bytes]], *,
               method=zipfile.ZIP_DEFLATED) -> Path:
    """A zip written without going through write_obz().

    Which is the point: everything below is a shape obf.py can read and would
    never write, and a reader that has only ever been handed its own output is
    a reader that has not been tested.
    """
    with zipfile.ZipFile(path, "w", method) as bundle:
        for name, payload in members:
            info = zipfile.ZipInfo(name, date_time=obf.ZIP_DATE)
            info.compress_type = method
            bundle.writestr(info, payload)
    return path


def board_json(board: dict) -> bytes:
    return (json.dumps(board, indent=2, ensure_ascii=False,
                       sort_keys=True) + "\n").encode("utf-8")


def container_cases(work: Path) -> list[tuple[str, Path, bool]]:
    """Files for the JavaScript to read, and whether obf.py can read them.

    Each is written by Python alone. The third value says whether the exact
    refusal can be compared: a file that is not a zip is refused by both, but
    the reason inside the message is whichever library said so, and holding
    zipfile's wording against DecompressionStream's would be a test about two
    error strings rather than about a document.
    """
    cases = []

    # What this project writes, with a payload in it. attach_images() is not
    # ported, so the files are put in by hand - which is what it would have
    # done, and what a document from a therapist who embedded her symbols
    # looks like.
    document = obf.layout_to_document(normalize_layout(export_cases()[2][1]))
    document.files["images/ja.png"] = b"\x89PNG\r\n\x1a\n" + bytes(range(256))
    document.files["images/empty.png"] = b""
    document.files["sounds/one.wav"] = wav()
    cases.append(("a document with pictures and sound in it",
                  obf.write_obz(document, work / "payload.obz"), True))

    board = {"format": obf.FORMAT, "id": "one", "locale": "en", "name": "One",
             "buttons": [{"id": "k", "label": "Hello"}], "images": [],
             "ext_vorlaut_color": "#159947",
             "ext_vorlaut_sleep_timeout_seconds": 45}
    other = {"format": obf.FORMAT, "id": "two", "locale": "en", "name": "Two",
             "buttons": [], "images": []}

    # Stored rather than deflated. Legal, common enough in the wild, and a
    # reader that only inflates reads none of it.
    cases.append(("a zip with nothing compressed in it", hand_built(
        work / "stored.obz",
        [(obf.MANIFEST_NAME, board_json(
            {"format": obf.FORMAT, "root": "boards/one.obf",
             "paths": {"boards": {"one": "boards/one.obf"}}})),
         ("boards/one.obf", board_json(board))],
        method=zipfile.ZIP_STORED), True))

    # No manifest at all: every .obf in the zip is taken instead.
    cases.append(("a zip with no manifest", hand_built(
        work / "nomanifest.obz",
        [("boards/two.obf", board_json(other)),
         ("boards/one.obf", board_json(board))]), True))

    # A manifest that is wrong in the two ways a hand-written one is wrong.
    cases.append(("a manifest naming a root nobody packed", hand_built(
        work / "noroot.obz",
        [(obf.MANIFEST_NAME, board_json(
            {"format": obf.FORMAT, "root": "boards/gone.obf",
             "paths": {"boards": {"b": "boards/two.obf",
                                  "a": "boards/one.obf"}}})),
         ("boards/one.obf", board_json(board)),
         ("boards/two.obf", board_json(other))]), True))
    cases.append(("a manifest naming boards that are not in the zip", hand_built(
        work / "missing.obz",
        [(obf.MANIFEST_NAME, board_json(
            {"format": obf.FORMAT, "root": "boards/one.obf",
             "paths": {"boards": {"one": "boards/one.obf",
                                  "gone": "boards/gone.obf"}}})),
         ("boards/one.obf", board_json(board))]), True))

    # The root the manifest names, rather than the first board that was
    # packed. Without a case where those two are different boards, believing
    # the manifest and ignoring it look the same.
    cases.append(("a manifest whose root is not the first board", hand_built(
        work / "secondroot.obz",
        [(obf.MANIFEST_NAME, board_json(
            {"format": obf.FORMAT, "root": "boards/two.obf",
             "paths": {"boards": {"one": "boards/one.obf",
                                  "two": "boards/two.obf"}}})),
         ("boards/one.obf", board_json(board)),
         ("boards/two.obf", board_json(other))]), True))

    # Board ids that are whole numbers, and no root to be had. Python falls
    # back to the first board it packed; a JavaScript object with keys like
    # these does not iterate in the order they went in, which is why the
    # reader keeps that order beside them.
    cases.append(("boards whose ids are numbers, and no root", hand_built(
        work / "numbered.obz",
        [(obf.MANIFEST_NAME, board_json(
            {"format": obf.FORMAT, "root": "boards/gone.obf",
             "paths": {"boards": {"a": "boards/ten.obf",
                                  "b": "boards/two.obf"}}})),
         ("boards/ten.obf", board_json({**board, "id": "10"})),
         ("boards/two.obf", board_json({**other, "id": "2"}))]), True))

    # Ids that are not the file names, which is what the path lookup in a
    # load_board is for, and a folder entry beside them.
    cases.append(("board ids that are not the file names", hand_built(
        work / "renamed.obz",
        [(obf.MANIFEST_NAME, board_json(
            {"format": obf.FORMAT, "root": "boards/first.obf",
             "paths": {"boards": {"first": "boards/first.obf",
                                  "second": "boards/second.obf"}}})),
         ("images/", b""),
         ("boards/first.obf", board_json(
             {**board, "id": "01", "name": "First", "buttons": [
                 {"id": "go", "label": "On",
                  "load_board": {"path": "boards/second.obf"}}]})),
         ("boards/second.obf", board_json({**other, "id": "02"}))]), True))

    # A board that is not an object, and a board file that is not JSON.
    cases.append(("an .obf holding a list rather than a board", hand_built(
        work / "list.obz", [("boards/one.obf", b"[1, 2, 3]\n")]), True))
    cases.append(("an .obf that is not JSON at all", hand_built(
        work / "broken.obz", [("boards/one.obf", b"{not json\n")]), False))

    # Nothing to read. Both have to refuse rather than answer with an empty
    # layout, which is what would quietly replace somebody's sets with nothing.
    cases.append(("a zip with no board in it", hand_built(
        work / "empty.obz", [("images/ja.png", b"x")]), False))
    not_a_zip = work / "notazip.obz"
    not_a_zip.write_bytes(b"this is not a zip file, it is a sentence")
    cases.append(("a file that is not a zip", not_a_zip, False))

    # The format's other half: one board, as itself. obf.py cannot read this
    # one - see readObf() in static/obf.js, which says why the browser does.
    only = work / "one.obf"
    only.write_bytes(board_json(board))
    cases.append(("a single .obf, which is where the browser goes further",
                  only, True))
    return cases


def document_as_json(document: obf.Document) -> dict:
    return {"root": document.root, "boards": document.boards,
            "files": {name: base64.b64encode(data).decode("ascii")
                      for name, data in document.files.items()}}


def read_with_python(path: Path) -> obf.Document:
    """What obf.py makes of the same file.

    A single .obf has no answer in obf.py - read_obz() reads zips - so the
    document is built the way readObf() builds it and obf.py is asked the
    question it does have: what does this board become. The container step is
    the browser's own and is the only part of this that is not measured.
    """
    if path.suffix == ".obf":
        board = json.loads(path.read_text(encoding="utf-8"))
        return obf.Document(root=str(board.get("id") or path.stem),
                            boards={str(board.get("id") or path.stem): board},
                            files={})
    return obf.read_obz(path)


# --- Asking the JavaScript ---------------------------------------------------

def ask_node(jobs: dict) -> dict:
    node = shutil.which("node")
    if not node:
        raise SystemExit(
            "Node is needed to check static/obf.js against obf.py, and is not "
            "on the PATH.")
    result = subprocess.run([node, str(DRIVER)], input=json.dumps(jobs),
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit("static/obf.js does not run:\n" + result.stderr)
    return json.loads(result.stdout)


def compare(name: str, want, answer: dict) -> None:
    """One Python answer against one JavaScript answer."""
    if "error" in answer:
        check(name, False, f"JavaScript refused it: {answer['error']}")
        return
    found = difference(plain(want), answer["value"])
    check(name, found is None, found or "")


def compare_refusal(name: str, want: BuildError | None, answer: dict) -> None:
    """The same, for a case one of them is meant to refuse."""
    got = answer.get("error")
    if want is None:
        check(name, got is None,
              "" if got is None else f"JavaScript refused it: {got}")
        return
    if got is None:
        check(name, False, f"Python refused it ({want}), JavaScript did not")
        return
    check(name, str(want) == got, "" if str(want) == got else
          f"Python says {str(want)!r}, JavaScript says {got!r}")


def main() -> int:
    if not (ROOT / "static" / "obf.js").is_file():
        print("  static/obf.js is missing")
        return 1
    with tempfile.TemporaryDirectory() as raw_work:
        return run(Path(raw_work))


def run(work: Path) -> int:
    helpers = helper_calls()
    exports = export_cases()
    foreign = foreign_cases()
    licensing = licensing_cases()

    # The documents the exporter just wrote go back in as import cases. A
    # converter that only ever meets foreign documents is as untested as one
    # that only ever meets its own.
    exported = []
    for _, layout in exports:
        document = obf.layout_to_document(layout)
        exported.append({"root": document.root, "boards": document.boards})
    imports = [(f"back from {name}", raw)
               for (name, _), raw in zip(exports, exported)] + foreign

    containers = container_cases(work)
    answers = ask_node({
        "helpers": [{"call": call, "args": args} for call, args in helpers],
        "exports": [layout for _, layout in exports],
        "imports": [raw for _, raw in imports],
        "licensing": [raw for _, raw in licensing],
        "obz": [layout for _, layout in exports],
        "unobz": [{"name": path.name,
                   "base64": base64.b64encode(path.read_bytes()).decode("ascii")}
                  for _, path, _ in containers],
    })

    print("\n--- the helpers, on the arguments that bite --------------------")
    for (call, args), answer in zip(helpers, answers["helpers"]):
        name = f"{call}({', '.join(repr(a) for a in args)})"
        if len(name) > 90:
            name = name[:87] + "...)"
        try:
            want = HELPERS[call](*args)
        except BuildError as exc:
            compare_refusal(name, exc, answer)
            continue
        compare(name, want, answer)

    print("\n--- a layout becomes the same document -------------------------")
    for (name, layout), answer in zip(exports, answers["exports"]):
        document = obf.layout_to_document(layout)
        compare(name, {"root": document.root, "boards": document.boards,
                       "files": {}}, answer)

    print("\n--- and a document the same layout -----------------------------")
    for (name, raw), answer in zip(imports, answers["imports"]):
        # The whole of it, normalize_layout() included: that is what turns a
        # board from somewhere else into a layout that may be saved, and until
        # both halves ran it this comparison stopped one function short.
        try:
            want = obf.document_to_layout(document_of(raw))
        except BuildError as exc:
            compare_refusal(name, exc, answer)
            continue
        # compare() reports a JavaScript refusal as the failure it is, so a
        # case Python accepted needs no second line about it.
        compare(name, want, answer)

    print("\n--- METACOM cannot be handed over as pixels --------------------")
    for (name, raw), answer in zip(licensing, answers["licensing"]):
        try:
            obf.check_licensing(document_of(raw))
            compare_refusal(name, None, answer)
        except BuildError as exc:
            compare_refusal(name, exc, answer)

    print("\n--- and the same zip, member by member -------------------------")
    for (name, layout), answer in zip(exports, answers["obz"]):
        check_written_zip(name, layout, answer, work)

    print("\n--- reading what Python packed ---------------------------------")
    for (name, path, wording), answer in zip(containers, answers["unobz"]):
        check_read_zip(name, path, wording, answer)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


def check_written_zip(name: str, layout: dict, answer: dict, work: Path) -> None:
    """One .obz written by the JavaScript, against the one Python writes.

    Not byte for byte - two deflate implementations are two compressors - so
    what is compared is everything else: the members, their order, what is
    inside each of them, and the fixed timestamp and permissions that make the
    same document the same file twice.
    """
    if "error" in answer:
        check(f"{name}: the zip was written", False,
              f"JavaScript refused it: {answer['error']}")
        return
    theirs = work / "js.obz"
    theirs.write_bytes(base64.b64decode(answer["value"]))
    # normalize_layout() first, because that is the path: app.py's export
    # route calls export_obz() with no layout, which calls load_layout(),
    # which normalizes what is on disk. exportObz() reads the store and does
    # the same, so the layout the two are given has to be the same one.
    mine = obf.write_obz(obf.layout_to_document(normalize_layout(layout)),
                         work / "py.obz")

    try:
        with zipfile.ZipFile(mine) as want, zipfile.ZipFile(theirs) as got:
            same_names = want.namelist() == got.namelist()
            check(f"{name}: the same members in the same order", same_names,
                  "" if same_names else
                  f"{want.namelist()} vs {got.namelist()}")
            if not same_names:
                return
            for member in want.namelist():
                one, two = want.read(member), got.read(member)
                if one != two:
                    check(f"{name}: {member} is byte for byte the same", False,
                          difference(json.loads(one), json.loads(two))
                          if member.endswith((".obf", ".json"))
                          else f"{len(one)} bytes vs {len(two)}")
                    return
            check(f"{name}: every member is byte for byte the same", True,
                  f"{len(want.namelist())} member(s)")
            stamps = {(i.date_time, i.external_attr, i.compress_type)
                      for i in got.infolist()}
            wanted = {(i.date_time, i.external_attr, i.compress_type)
                      for i in want.infolist()}
            check(f"{name}: the fixed timestamp and mode came through",
                  stamps == wanted, "" if stamps == wanted else
                  f"{sorted(stamps)} vs {sorted(wanted)}")
    except zipfile.BadZipFile as exc:
        check(f"{name}: the zip opens", False, str(exc))
        return

    # And the whole way round: what Python reads out of the file the browser
    # wrote has to be the layout that went in. A layout with no sets at all is
    # a document with no board in it, which obf.py refuses to read - including
    # the one it wrote itself - so the two files are held to answering the
    # same way rather than to answering.
    try:
        back = plain(obf.import_obz(theirs))
    except BuildError as exc:
        back = f"refused: {exc}"
    try:
        want = plain(obf.import_obz(mine))
    except BuildError as exc:
        want = f"refused: {exc}".replace(str(mine), str(theirs))
    found = difference(want, back)
    check(f"{name}: obf.py reads it back as the layout that went in",
          found is None, found or "")


def check_read_zip(name: str, path: Path, wording: bool, answer: dict) -> None:
    """One file written by Python, read by the JavaScript."""
    try:
        document = read_with_python(path)
        layout = obf.document_to_layout(document)
    except BuildError as exc:
        if wording:
            compare_refusal(name, exc, answer)
        else:
            # Both refuse; the reason inside the message is zipfile's on one
            # side and DecompressionStream's on the other, and holding one
            # library's wording against the other's would be a test about
            # error strings.
            check(f"{name}: refused by both", "error" in answer,
                  answer.get("error", "JavaScript read it anyway"))
        return
    if "error" in answer:
        check(name, False, f"JavaScript refused it: {answer['error']}")
        return
    found = difference(plain(document_as_json(document)),
                       {k: v for k, v in answer["value"].items()
                        if k != "layout"})
    check(f"{name}: the same document", found is None, found or "")
    found = difference(plain(layout), answer["value"]["layout"])
    check(f"{name}: and the same layout", found is None, found or "")


if __name__ == "__main__":
    raise SystemExit(main())
