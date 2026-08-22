#!/usr/bin/env python3
"""Freezes what obf.py says a board becomes, in both directions.

    python3 tools/obffreeze.py            # rewrite tests/reference/obf.lock.json
    python3 tools/obffreeze.py --check    # convert again, change nothing, report

static/obf.js was ported from obf.py and measured against it document by
document in tests/test_obf_js.py. That test compares live: it imports obf and
layout, runs the JavaScript under node, and holds the two answers together.
Which is the right check while there are two halves, and evaporates the moment
there is one - not loudly, either. The file imports obf at the top, so the day
obf.py goes the test does not report an unchecked converter; it fails to start,
gets deleted along with the Python it named, and nothing is left that has an
opinion about static/obf.js at all.

There is no C reader here to fall back on and no second implementation
anywhere. A board is JSON that vorlaut invented the mapping for, so obf.py and
layout.py are the entire outside opinion, and the two of them are:

  the answers       every helper, every document a layout becomes, every
                    layout a document becomes - including the foreign ones,
                    which is where the mapping is actually hard.
  the shape         normalize_layout() in layout.py, which decides what a
                    complete layout is. static/obf.js has a copy of it now,
                    and a copy checked against nothing is a copy that drifts.
  the container     what write_obz() puts in a .obz, member by member, and
                    the files a reader has to survive being handed.

So all three are written down here while there is still something to write
them down from, and afterwards tests/test_obf_frozen.py asks the real question
- does the browser still map a board the way the format says - with nothing
but node.

The cases are not written out again. They are the ones in
tests/test_obf_js.py, imported, so that there is one list and not two drifting
copies of it - the same arrangement tools/layoutfreeze.py has with
tests/test_layout_format.py. That file stays as it is and keeps doing the live
comparison for as long as there is an obf.py to compare against; what is added
to it is a check that these frozen answers are still the ones it would give.

What this does not do is make obf.py removable. A live oracle answers for any
input; a fixture answers for what was recorded. See docs/frozen-references.md,
which says so at more length and is worth reading before anybody cites this
file as permission.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

REFERENCE = ROOT / "tests" / "reference"
LOCK = REFERENCE / "obf.lock.json"
# The container fixtures, as files rather than as base64 in the lock: they are
# zips, somebody will want to open one, and a zip inside a JSON string is a
# zip nobody can look at.
FIXTURES = REFERENCE / "obf"

import obf  # noqa: E402
import test_obf_js as suite  # noqa: E402
from buildbase import BuildError, short  # noqa: E402
from layout import normalize_layout  # noqa: E402


def answered(work) -> dict:
    """What obf.py says, or what it refused with - in the shape the node
    driver answers in, so that the two can be compared without a translation
    step in between."""
    try:
        return {"value": suite.plain(work())}
    except BuildError as exc:
        return {"error": str(exc)}


def freeze(fixtures: Path) -> dict:
    """Everything obf.py answers, with the container fixtures written into
    `fixtures`.

    Which directory that is matters: --check writes them somewhere temporary
    and compares, so that asking whether the lock is current cannot quietly
    repair a fixture somebody edited. Only a real freeze touches
    tests/reference/.
    """
    def recorded(path: Path) -> str:
        """The path as the lock names it, whichever directory it went in."""
        return f"{FIXTURES.name}/{path.relative_to(fixtures).as_posix()}"

    frozen: dict = {}

    frozen["helpers"] = []
    for call, args in suite.helper_calls():
        frozen["helpers"].append({
            "call": call, "args": suite.plain(args),
            **answered(lambda: suite.HELPERS[call](*args)),
        })
    print(f"  {len(frozen['helpers']):>3} helper call(s)")

    frozen["exports"] = []
    for name, layout in suite.export_cases():
        document = obf.layout_to_document(layout)
        frozen["exports"].append({
            "name": name, "layout": suite.plain(layout),
            "document": suite.plain({"root": document.root,
                                     "boards": document.boards, "files": {}}),
        })
    print(f"  {len(frozen['exports']):>3} layout(s) on the way out")

    # The documents the exporter just wrote, and then the foreign ones. Both
    # go in as import cases, because a converter that only ever meets its own
    # documents is as untested as one that only ever meets somebody else's.
    imports = [(f"back from {name}",
                {"root": obf.layout_to_document(layout).root,
                 "boards": obf.layout_to_document(layout).boards})
               for name, layout in suite.export_cases()]
    imports += suite.foreign_cases()
    frozen["imports"] = []
    for name, raw in imports:
        frozen["imports"].append({
            "name": name, "document": suite.plain(raw),
            **answered(lambda: obf.document_to_layout(suite.document_of(raw))),
        })
    print(f"  {len(frozen['imports']):>3} document(s) on the way in")

    frozen["licensing"] = []
    for name, raw in suite.licensing_cases():
        def refuse(raw=raw):
            obf.check_licensing(suite.document_of(raw))
            return ""
        frozen["licensing"].append({"name": name, "document": suite.plain(raw),
                                    **answered(refuse)})
    refused = sum(1 for one in frozen["licensing"] if "error" in one)
    print(f"  {len(frozen['licensing']):>3} licensing case(s), "
          f"{refused} of them refused")

    # The container, out. Not the bytes of the zip - two deflate
    # implementations do not agree about those and never will - but everything
    # inside it, which is what has to be identical.
    frozen["zips"] = []
    for name, layout in suite.export_cases():
        path = fixtures / "written" / f"{suite.slug(name)}.obz"
        path.parent.mkdir(parents=True, exist_ok=True)
        obf.write_obz(obf.layout_to_document(normalize_layout(layout)), path)
        with zipfile.ZipFile(path) as bundle:
            members = [{"name": info.filename,
                        "text": bundle.read(info.filename).decode("utf-8"),
                        "date_time": list(info.date_time),
                        "external_attr": info.external_attr,
                        "compress_type": info.compress_type}
                       for info in bundle.infolist()]
        frozen["zips"].append({
            "name": name,
            # The layout as the exporter is really given it: app.py's route
            # calls export_obz() with no layout, which calls load_layout(),
            # which normalizes. exportObz() reads the store and does the same.
            "layout": suite.plain(normalize_layout(layout)),
            "file": recorded(path),
            "members": members,
        })
    print(f"  {len(frozen['zips']):>3} zip(s) written, member by member")

    # And in. These are the files a reader has to survive: nothing compressed,
    # no manifest, a manifest naming a root nobody packed, ids that are not
    # file names, a board that is not an object, and three that have to be
    # refused rather than answered with an empty layout.
    frozen["containers"] = []
    for name, path, wording in suite.container_cases(fixtures):
        payload = path.read_bytes()
        entry = {
            "name": name,
            "file": recorded(path),
            "sha256": hashlib.sha256(payload).hexdigest(),
            # Whether the exact refusal can be held against the JavaScript's:
            # a file that is not a zip is refused by both, and the reason
            # inside the message is whichever library said so.
            "wording": wording,
        }
        try:
            document = suite.read_with_python(path)
            entry["document"] = suite.plain(suite.document_as_json(document))
            entry["layout"] = suite.plain(obf.document_to_layout(document))
        except BuildError as exc:
            # The message names the file, and obf.py names it relative to the
            # project when it lies inside it and absolutely when it does not.
            # Neither is a fact about the document, and the browser is handed
            # a name rather than a path - so both forms come down to the file
            # name here, and the frozen sentence is one the JavaScript can be
            # held to.
            entry["error"] = (str(exc).replace(short(path), path.name)
                              .replace(str(path), path.name))
        frozen["containers"].append(entry)
    print(f"  {len(frozen['containers']):>3} file(s) to read back")

    return {
        "what": "what obf.py makes of a board in both directions - the "
                "helpers, the documents, the layouts, and what write_obz() "
                "puts in a .obz - frozen so that static/obf.js can still be "
                "checked once the Python half is gone.",
        "produced_by": "tools/obffreeze.py",
        "produced_on": date.today().isoformat(),
        "python": sys.version.split()[0],
        "oracle": {name: hashlib.sha256(
            (ROOT / name).read_bytes()).hexdigest()[:16]
            for name in ("obf.py", "layout.py")},
        "format": obf.FORMAT,
        "invalidated_by": [
            "a change to the mapping in obf.py - which is the point of the "
            "file: these are its answers",
            "a change to normalize_layout() in layout.py, which decides what "
            "a complete layout is and therefore what every import ends as",
            "a change to what write_obz() puts in a .obz - the member names, "
            "their order, the JSON inside them or the fixed timestamp",
        ],
        "not_invalidated_by": [
            "changes to static/obf.js - that is the thing being checked. "
            "Refreezing to make a red test green would leave the browser "
            "compared against itself, which is what this file exists to stop",
            "the compressed bytes of a .obz differing between Python and the "
            "browser. Only what comes out of the members is frozen, because "
            "zlib and CompressionStream are two compressors",
        ],
        **frozen,
    }


def differences(old: dict, fresh: dict) -> list[str]:
    """Which frozen answers obf.py no longer gives."""
    moved = []
    for group in ("helpers", "exports", "imports", "licensing", "zips",
                  "containers"):
        before, after = old.get(group) or [], fresh.get(group) or []
        if len(before) != len(after):
            moved.append(f"{group}: {len(before)} frozen, {len(after)} now")
            continue
        for one, two in zip(before, after):
            if one != two:
                moved.append(f"{group}: {one.get('name') or one.get('call')}")
    return moved


def main(argv: list[str]) -> int:
    check = "--check" in argv
    print("Converting." if check else "Converting and freezing.")
    if check:
        with tempfile.TemporaryDirectory() as raw:
            fresh = freeze(Path(raw))
    else:
        FIXTURES.mkdir(parents=True, exist_ok=True)
        fresh = freeze(FIXTURES)

    if not check:
        LOCK.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        total = sum(len(fresh[group]) for group in
                    ("helpers", "exports", "imports", "licensing", "zips",
                     "containers"))
        print(f"\n  {total} answers in {LOCK.relative_to(ROOT)}, "
              f"fixtures in {FIXTURES.relative_to(ROOT)}")
        print("  git add -A before running the suite - test_language.py and "
              "test_links.py read git ls-files, and these arrived as a folder.")
        return 0

    if not LOCK.exists():
        print("\n  nothing frozen yet - run without --check")
        return 1
    moved = differences(json.loads(LOCK.read_text(encoding="utf-8")), fresh)
    if moved:
        print(f"\n  {len(moved)} answer(s) come out differently:")
        for one in moved:
            print(f"    {one}")
        return 1
    print("\n  unchanged - obf.py still says what is frozen")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
