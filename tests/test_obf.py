#!/usr/bin/env python3
"""Checks that a layout survives the trip through the Open Board Format.

The converter in obf.py has one job that matters more than the rest: what goes
out has to come back. A format swap is only worth doing if nobody's sets, keys,
colours or symbol references quietly change shape on the way through - and
every one of those is a field somebody typed once and would not notice the
loss of until the device was in a child's hands.

So the layout below is deliberately awkward. A switched-off set, a set with no
symbol, a key with a picture and no words, a key with words and no picture, a
METACOM reference next to a plain file name, punctuation that is not ASCII, a
set with fewer slots than there are keys. Everything here has been a bug in something at some
point, and a round trip of the tidy example alone would pass while losing all
of it. The example goes through too, further down, because it is the file a
fresh clone actually starts from.

The other half is the licensing invariant, which is not about fidelity at all.
A METACOM board must be structurally impossible to store as pixels - the
licence is per person, and a file carrying the pixels has already handed the
collection to whoever it was sent to. There are three ways that could break
(the exporter writing pixels, the embedder copying them in, the writer letting
a doctored document past) and all three are checked, because a licence
condition that holds by convention holds until somebody is in a hurry.

Then the parts that have no user yet and will: link integrity across a board
graph, and the two target profiles. Nothing on this device can produce an
orphaned board or a 6x11 grid. A phone companion app with the same designer in
front of it does nothing else, and the time to find out whether the model can
say so is before it exists, not after.
"""

from __future__ import annotations

import copy
import json
import os
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Set before the project modules are imported: config.py resolves the content
# directory once, at import time. Without this the symbols and the TTS cache
# this test writes would be the developer's own.
WORKSPACE = tempfile.TemporaryDirectory()
os.environ["VORLAUT_CONTENT"] = WORKSPACE.name
os.environ.pop("VORLAUT_DATA", None)
os.environ.pop("VORLAUT_METACOM_DIR", None)

import obf  # noqa: E402
import tiles  # noqa: E402
import tts  # noqa: E402
from buildbase import BuildError  # noqa: E402
from layout import load_layout, normalize_layout  # noqa: E402

failures: list[str] = []
# Every finding this run produced, so check_messages() can render the real
# ones rather than a guess at what they might be.
seen: list[obf.Problem] = []


def validated(document: obf.Document, profile: obf.Profile) -> list[obf.Problem]:
    problems = obf.validate(document, profile)
    seen.extend(problems)
    return problems


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def difference(before: dict, after: dict) -> str:
    """Where two layouts stop agreeing, as one line.

    A dict comparison that fails prints two screenfuls of JSON and leaves the
    reader to diff them by eye. This says which set and which field, which is
    the whole of what one wants to know.
    """
    if before.keys() != after.keys():
        return f"keys {sorted(before)} vs {sorted(after)}"
    for key in before:
        if key != "sets" and before[key] != after[key]:
            return f"{key}: {before[key]!r} vs {after[key]!r}"
    if len(before["sets"]) != len(after["sets"]):
        return f"{len(before['sets'])} sets vs {len(after['sets'])}"
    for index, (one, two) in enumerate(zip(before["sets"], after["sets"])):
        for field in sorted(set(one) | set(two)):
            if one.get(field) != two.get(field):
                return (f"set {index + 1} ({one.get('name')!r}) {field}: "
                        f"{one.get(field)!r} vs {two.get(field)!r}")
    return "identical by field, unequal as a whole"


# Awkward on purpose - see the docstring. Every oddity in here is a shape the
# web interface can really produce.
RAW = {
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
                # Not ASCII, and not an accident: the text goes through JSON
                # and then through a zip, and both have an encoding somebody
                # can get wrong. An em dash and a curly quote are what a real
                # sentence picks up on the way in from a phone keyboard.
                {"text": "No \u2014 I don\u2019t want that", "symbol": "metacom:nein"},
                {"text": "Stop", "symbol": ""},           # words, no picture
                {"text": "", "symbol": "hilfe.png"},      # picture, no words
            ],
        },
        {
            "name": "Going out to play",
            "color": "#159947",
            "symbol": "metacom:spielen",
            "active": False,                              # stays in the file
            "slots": [{"text": "More of that", "symbol": "mehr.png"}],
        },
        {
            "name": "Outdoors",
            "color": "#9B7BFF",
            "symbol": "",                                 # no set symbol
            "slots": [],                                  # filled in by normalize
        },
    ],
}


def round_trip(layout: dict, path: Path, **kwargs) -> tuple[dict, obf.Document]:
    """Layout -> .obz -> layout, through a real file on disk."""
    document = obf.layout_to_document(layout)
    for step, wanted in (("with_images", obf.attach_images),
                         ("with_sounds", obf.attach_sounds)):
        if kwargs.get(step):
            wanted(document)
    obf.write_obz(document, path)
    return obf.document_to_layout(obf.read_obz(path)), document


def check_round_trip(work: Path) -> None:
    print("\n--- what goes out comes back -----------------------------------")
    before = normalize_layout(RAW)
    after, document = round_trip(before, work / "awkward.obz")
    check("the awkward layout comes back unchanged", after == before,
          "" if after == before else difference(before, after))

    # Named individually as well, so a failure says which promise broke rather
    # than only that something did.
    check("the switched-off set is still in the file and still off",
          len(after["sets"]) == 3 and after["sets"][1]["active"] is False)
    check("a METACOM reference stays a METACOM reference",
          after["sets"][0]["slots"][1]["symbol"] == "metacom:nein")
    check("a bare file name stays a bare file name",
          after["sets"][0]["slots"][0]["symbol"] == "ja.png")
    check("a key with words and no picture keeps its words",
          after["sets"][0]["slots"][2] == {"text": "Stop", "symbol": ""})
    check("a sentence that is not ASCII comes back character for character",
          after["sets"][0]["slots"][1]["text"] == RAW["sets"][0]["slots"][1]["text"],
          repr(after["sets"][0]["slots"][1]["text"]))
    check("a key with a picture and no words keeps its picture",
          after["sets"][0]["slots"][3] == {"text": "", "symbol": "hilfe.png"})
    check("the sleep timeout survives",
          after["sleep_timeout_seconds"] == 900)
    check("the chosen voice survives",
          after["voice"] == "piper:de_DE-thorsten-low")
    check("the language survives", after["language"] == "de")
    check("the colours survive exactly",
          [s["color"] for s in after["sets"]] == ["#3B5BDB", "#159947", "#9B7BFF"])
    check("the set order survives",
          [s["name"] for s in after["sets"]]
          == ["Basics", "Going out to play", "Outdoors"])

    # The file a fresh clone starts from. A converter that only ever sees its
    # own test data is a converter that has never met real content.
    example = load_layout(ROOT / "example" / "layout.json")
    back, _ = round_trip(example, work / "example.obz")
    check("example/layout.json comes back unchanged", back == example,
          "" if back == example else difference(example, back))

    problems = validated(document, obf.ESP32)
    check("what the exporter writes passes its own validation",
          not problems, "; ".join(str(p) for p in problems))


def check_the_zip(work: Path) -> None:
    print("\n--- the container ----------------------------------------------")
    path = work / "shape.obz"
    obf.write_obz(obf.layout_to_document(normalize_layout(RAW)), path)
    with zipfile.ZipFile(path) as bundle:
        names = bundle.namelist()
        manifest = json.loads(bundle.read(obf.MANIFEST_NAME))

    check("there is a manifest", obf.MANIFEST_NAME in names)
    check("the manifest declares the format",
          manifest.get("format") == obf.FORMAT, str(manifest.get("format")))
    check("the root names a member that is really there",
          manifest.get("root") in names, str(manifest.get("root")))
    boards = manifest.get("paths", {}).get("boards", {})
    check("every board in paths is really there",
          bool(boards) and all(member in names for member in boards.values()),
          str(sorted(boards.values())))
    check("one board per set", len(boards) == len(RAW["sets"]), str(len(boards)))

    # The same document has to write the same bytes, or "did anything change"
    # cannot be answered without unpacking both files.
    twin = work / "shape-again.obz"
    obf.write_obz(obf.layout_to_document(normalize_layout(RAW)), twin)
    check("the same document writes the same bytes",
          path.read_bytes() == twin.read_bytes())


def check_metacom_stays_a_reference(work: Path) -> None:
    print("\n--- METACOM cannot be handed over as pixels --------------------")
    document = obf.layout_to_document(normalize_layout(RAW))

    metacom = [image for board in document.boards.values()
               for image in board.get("images") or []
               if (image.get("symbol") or {}).get("set") == obf.METACOM_SET]
    check("the METACOM symbols came through as references", len(metacom) == 2,
          f"{len(metacom)} found")
    check("and none of them carries a picture",
          all(not any(image.get(f) for f in ("data", "url", "path"))
              for image in metacom))
    check("each one says whose collection it is",
          all(image.get("license", {}).get("author_name") == "Annette Kitzinger"
              for image in metacom))

    # The symbols that are yours may be embedded. Make them real files first -
    # attach_images() only takes what content/symbols/ actually has.
    tiles.SYMBOLS_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("start.png", "ja.png", "hilfe.png", "mehr.png"):
        (tiles.SYMBOLS_DIR / name).write_bytes(b"\x89PNG\r\n\x1a\n" + name.encode())
    added = obf.attach_images(document)
    check("embedding takes the symbols that are yours",
          sorted(Path(p).name for p in added)
          == ["hilfe.png", "ja.png", "mehr.png", "start.png"], str(sorted(added)))
    check("and leaves the METACOM ones as references",
          all(not any(image.get(f) for f in ("data", "url", "path"))
              for image in metacom))
    obf.write_obz(document, work / "embedded.obz")
    with zipfile.ZipFile(work / "embedded.obz") as bundle:
        inside = [n for n in bundle.namelist() if n.startswith(obf.IMAGE_DIR + "/")]
    check("the embedded symbols are in the zip", len(inside) == 4, str(inside))
    check("and nothing METACOM is",
          not any("nein" in n or "spielen" in n for n in inside), str(inside))

    # The backstop. Whatever a caller thinks it is doing, the file must not
    # come into existence.
    doctored = obf.Document(root=document.root,
                            boards=copy.deepcopy(document.boards),
                            files=dict(document.files))
    for board in doctored.boards.values():
        for image in board.get("images") or []:
            if (image.get("symbol") or {}).get("set") == obf.METACOM_SET:
                image["data"] = "data:image/png;base64,iVBORw0KGgo="
    refused = work / "refused.obz"
    try:
        obf.write_obz(doctored, refused)
        check("writing METACOM pixels is refused", False, "it was written")
    except BuildError as exc:
        check("writing METACOM pixels is refused", True, exc.key)
    check("and no half a file is left behind", not refused.exists())
    check("validation says the same thing on its own",
          any(p.key == "obf.check.metacom_pixels"
              for p in validated(doctored, obf.ESP32)))


def wav(seconds: float) -> bytes:
    """A real 16 kHz mono WAV, so wav_seconds() has something to read."""
    frames = int(tts.SAMPLE_RATE * seconds)
    body = b"\x00\x00" * frames
    fmt = struct.pack("<HHIIHH", 1, 1, tts.SAMPLE_RATE,
                      tts.SAMPLE_RATE * 2, 2, 16)
    chunks = b"fmt " + struct.pack("<I", len(fmt)) + fmt \
        + b"data" + struct.pack("<I", len(body)) + body
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks


def check_sounds(work: Path) -> None:
    print("\n--- audio is build output, text is the source ------------------")
    layout = normalize_layout(RAW)
    voice = layout["voice"]
    spoken = [slot["text"] for slot in layout["sets"][0]["slots"][:3]]
    tts.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for text in spoken:
        tts.cache_path(text, voice).write_bytes(wav(0.5))

    document = obf.layout_to_document(layout)
    added = obf.attach_sounds(document)
    check("only the sentences that are really in the cache are attached",
          len(added) == len(spoken), f"{len(added)} attached")

    board = document.board("set-1")
    sounds = {s["id"]: s for s in board["sounds"]}
    check("the buttons point at them",
          all(b.get("sound_id") in sounds for b in board["buttons"][:3]),
          str([b.get("sound_id") for b in board["buttons"][:3]]))
    check("a silent key gets no sound_id",
          board["buttons"][3].get("sound_id") is None)
    check("the duration is read out of the file itself",
          all(abs(s["duration"] - 0.5) < 0.01 for s in sounds.values()),
          str(sorted(s["duration"] for s in sounds.values())))
    check("each recording says which voice made it",
          all(s["ext_vorlaut_voice"] == voice for s in sounds.values()))

    path = work / "spoken.obz"
    obf.write_obz(document, path)
    with zipfile.ZipFile(path) as bundle:
        inside = [n for n in bundle.namelist() if n.startswith(obf.SOUND_DIR + "/")]
    check("the WAVs travel in the zip", len(inside) == len(spoken), str(inside))

    # And coming back the other way they are ignored: the text is what the
    # build renders from, so a recording is never the thing that decides.
    back = obf.document_to_layout(obf.read_obz(path))
    check("importing a document with audio gives the same layout",
          back == layout, "" if back == layout else difference(layout, back))

    check("a byte estimate now counts the audio",
          obf.estimate_bytes(document)
          > obf.estimate_bytes(obf.layout_to_document(layout)))


def check_graph(work: Path) -> None:
    print("\n--- boards are a graph -----------------------------------------")
    document = obf.layout_to_document(normalize_layout(RAW))
    check("nothing this device makes is an orphan", obf.orphans(document) == [],
          str(obf.orphans(document)))
    check("nor has a link that leads nowhere", obf.broken_links(document) == [])
    check("every board is reachable from the root",
          obf.reachable(document) == set(document.boards))

    # A board nobody links to, which is what deleting a set from the middle of
    # a phone layout leaves behind.
    stranded = obf.Document(root=document.root,
                            boards=copy.deepcopy(document.boards),
                            files={})
    stranded.boards["set-9"] = {"format": obf.FORMAT, "id": "set-9",
                                "name": "Bedtime", "buttons": [], "images": [],
                                "grid": {"rows": 2, "columns": 3, "order": []}}
    check("an orphan is found", obf.orphans(stranded) == ["set-9"],
          str(obf.orphans(stranded)))
    check("and reported by validation",
          any(p.key == "obf.check.orphan" for p in validated(stranded, obf.PHONE)))

    # A link to a board that is not there, which is what deleting one without
    # touching what pointed at it leaves behind.
    dangling = obf.Document(root=document.root,
                            boards=copy.deepcopy(document.boards), files={})
    del dangling.boards["set-2"]
    broken = obf.broken_links(dangling)
    check("a link to a deleted board is found", len(broken) == 1, str(broken))
    check("and it says which key it was",
          bool(broken) and broken[0][1] == "set-1-set", str(broken))
    check("validation reports it too",
          any(p.key == "obf.check.broken_link"
              for p in validated(dangling, obf.PHONE)))

    # Copying a subtree: the board and everything it can reach, nothing else.
    # In a ring that is all of them, so build a small tree to ask it properly.
    tree = obf.Document(root="top", boards={}, files={})
    for name, target in (("top", "left"), ("left", None), ("right", None)):
        tree.boards[name] = {
            "format": obf.FORMAT, "id": name, "name": name, "images": [],
            "buttons": ([{"id": f"{name}-go",
                          "load_board": {"id": target}}] if target else []),
            "grid": {"rows": 1, "columns": 1,
                     "order": [[f"{name}-go" if target else None]]},
        }
    part = obf.subtree(tree, "top")
    check("a subtree takes what it can reach",
          set(part.boards) == {"top", "left"}, str(sorted(part.boards)))
    check("and is rooted at the board that was copied", part.root == "top")
    part.boards["top"]["name"] = "changed"
    check("and is a copy, not a view",
          tree.boards["top"]["name"] == "top")


def phone_board(rows: int, columns: int, index: int) -> dict:
    """One board of the size a phone companion app would draw."""
    board_id = f"phone-{index}"
    buttons, order = [], []
    for row in range(rows):
        line = []
        for column in range(columns):
            button_id = f"{board_id}-{row}-{column}"
            buttons.append({"id": button_id, "label": f"w{row}{column}",
                            "vocalization": f"word {row} {column}"})
            line.append(button_id)
        order.append(line)
    return {"format": obf.FORMAT, "id": board_id, "name": board_id,
            "locale": "de", "buttons": buttons, "images": [], "sounds": [],
            "grid": {"rows": rows, "columns": columns, "order": order}}


def check_profiles(work: Path) -> None:
    print("\n--- two targets, one document ----------------------------------")
    # Six boards of 6x11, all nested off the first: nothing this device could
    # ever show, and an ordinary week's work on a phone.
    document = obf.Document(root="phone-0", boards={}, files={})
    for index in range(6):
        document.boards[f"phone-{index}"] = phone_board(6, 11, index)
    top = document.boards["phone-0"]
    for index in range(1, 6):
        top["buttons"].append({"id": f"phone-0-to-{index}",
                               "label": f"more {index}",
                               "load_board": {"id": f"phone-{index}"}})

    check("the phone profile takes it", validated(document, obf.PHONE) == [],
          "; ".join(str(p) for p in validated(document, obf.PHONE)))

    keys = {p.key for p in validated(document, obf.ESP32)}
    for wanted in ("obf.check.too_many_boards", "obf.check.too_many_keys",
                   "obf.check.grid", "obf.check.not_a_ring"):
        check(f"the ESP32 profile refuses it: {wanted.rsplit('.', 1)[1]}",
              wanted in keys, str(sorted(keys)))

    check("and says so per board rather than stopping at the first",
          len([p for p in validated(document, obf.ESP32)
               if p.key == "obf.check.grid"]) == 6)

    # Converting it anyway has to stop rather than drop 62 keys per board.
    try:
        obf.document_to_layout(document)
        check("converting a phone board to layout.json stops", False,
              "it converted")
    except BuildError as exc:
        check("converting a phone board to layout.json stops", True, exc.key)

    # The flash budget. Five sets of five distinct symbols is what the device
    # was measured for; five sets of nothing but different symbols is not.
    big = obf.Document(root="set-1", boards={}, files={})
    for index in range(5):
        board = {"format": obf.FORMAT, "id": f"set-{index + 1}",
                 "name": f"Set {index + 1}", "ext_vorlaut_active": True,
                 "buttons": [], "images": [], "sounds": [],
                 "grid": {"rows": 2, "columns": 3, "order": []}}
        for slot in range(4):
            symbol = f"pic-{index}-{slot}.png"
            board["images"].append(obf.image_entry(symbol))
            board["buttons"].append({"id": f"b{index}{slot}", "label": "x",
                                     "image_id": obf.image_id(symbol)})
            board["grid"]["order"].append([f"b{index}{slot}"])
        board["sounds"] = [{"id": f"snd-{index}", "duration": 6.0,
                            "ext_vorlaut_bytes": 300_000}]
        big.boards[f"set-{index + 1}"] = board
    check("an oversized document is flagged before anything is built",
          any(p.key == "obf.check.too_big" for p in validated(big, obf.ESP32)),
          f"{obf.estimate_bytes(big) / 1024:.0f} KiB estimated")
    check("and the phone profile has no such limit",
          not any(p.key == "obf.check.too_big"
                  for p in validated(big, obf.PHONE)))


def check_foreign(work: Path) -> None:
    print("\n--- a board written somewhere else -----------------------------")
    # No ext_vorlaut_* at all, a label with no vocalization, a geometry this
    # device does not use, and a link by path rather than by id. All legal
    # OBF, none of it produced here.
    board = {
        "format": obf.FORMAT, "id": "home", "name": "Home", "locale": "en-GB",
        "buttons": [
            {"id": "a", "label": "yes", "image_id": "i1"},
            {"id": "b", "label": "more", "vocalization": "I want more"},
            {"id": "c", "label": "next", "load_board": {"path": "boards/two.obf"}},
        ],
        "images": [{"id": "i1", "symbol": {"set": "vorlaut", "filename": "yes.png"}}],
        "grid": {"rows": 3, "columns": 1, "order": [["a"], ["b"], ["c"]]},
    }
    second = {"format": obf.FORMAT, "id": "two", "name": "Two", "buttons": [],
              "images": [], "grid": {"rows": 1, "columns": 1, "order": [[None]]}}
    document = obf.Document(root="home", boards={"home": board, "two": second},
                            files={})

    layout = obf.document_to_layout(document)
    check("a foreign board becomes a set", len(layout["sets"]) == 2)
    check("a label with no vocalization is what gets spoken",
          layout["sets"][0]["slots"][0]["text"] == "yes")
    check("a vocalization wins over the label when there is one",
          layout["sets"][0]["slots"][1]["text"] == "I want more")
    check("en-GB comes in as en", layout["language"] == "en")
    check("a set with no colour gets one from the palette",
          layout["sets"][0]["color"].startswith("#")
          and len(layout["sets"][0]["color"]) == 7)
    check("the missing slots are filled in",
          len(layout["sets"][0]["slots"]) == 4)
    check("a link by path still resolves",
          obf.broken_links(document) == [], str(obf.broken_links(document)))

    # A picture carried as pixels: there is nowhere for it in layout.json, so
    # it has to come back as no symbol and be said out loud.
    board["images"][0] = {"id": "i1", "url": "https://example.invalid/yes.png"}
    check("a picture carried as pixels comes back as no symbol",
          obf.document_to_layout(document)["sets"][0]["slots"][0]["symbol"] == "")
    check("and validation says which image it was",
          any(p.key == "obf.check.not_a_reference"
              for p in validated(document, obf.PHONE)))


def check_messages() -> None:
    print("\n--- every finding can be read ----------------------------------")
    # A Problem carries a key and its values the way BuildError does, and
    # texts.t() answers an unknown key with the key itself. So a finding
    # nobody wrote a sentence for still prints, still looks like output, and
    # says "obf.check.orphan" to somebody who wanted to know what was wrong.
    # Same for a placeholder the caller does not fill: "{profile}" comes
    # through literally rather than failing.
    import texts
    check("this run produced findings to look at", len(seen) > 10,
          f"{len(seen)} findings")

    bad = []
    for problem in seen:
        for lang in sorted(texts.TEXTS):
            rendered = problem.message(lang)
            if rendered == problem.key or "{" in rendered:
                bad.append(f"{lang}:{problem.key}")
    check("every finding renders to a sentence in both languages",
          not bad, ", ".join(sorted(set(bad))))

    # The other direction: a key in the table that obf.py never names is a
    # sentence nobody will ever read, and usually the leftover of a check that
    # was renamed.
    source = (ROOT / "obf.py").read_text(encoding="utf-8")
    written = {key for key in texts.TEXTS[texts.DEFAULT] if key.startswith("obf.")}
    named = {key for key in written if f'"{key}"' in source}
    check("every message key is one obf.py actually raises",
          written == named, str(sorted(written - named)))
    check("and each one exists in German too",
          not [k for k in sorted(written) if k not in texts.TEXTS["de"]])


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        check_round_trip(work)
        check_the_zip(work)
        check_metacom_stays_a_reference(work)
        check_sounds(work)
        check_graph(work)
        check_profiles(work)
        check_foreign(work)
        check_messages()

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
